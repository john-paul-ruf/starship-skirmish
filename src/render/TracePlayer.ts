// TracePlayer — animate an already-final resolution trace (arch §9).
//
// "Simulate fully, then animate the trace." The sim has already computed the whole
// beat; playback only SHOWS it. Wall clock enters ONLY here (playback pacing) and never
// reaches `sim` — nothing in this file calls into the sim; it consumes a frozen
// `MovementBeatRecord`. `skip()` jumps to the final frame and `replay()` re-runs the
// same record; both leave identical final state (FR-19, outcome-invariant), because the
// sim outcome is fixed before the first frame paints.
//
// The pacing state machine takes an injectable clock + raf so it unit-tests
// deterministically in the node env; the three.js buffer pushes are screen-e2e.

import { AdditiveBlending, Color, Group, type Object3D, Sprite, SpriteMaterial } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type {
  AttackBeatRecord,
  BodyId,
  CombatLogEntry,
  CombatLogResult,
  DestructionEvent,
  Vec3,
} from '../sim/index.js';
import type { MovementBeatRecord } from '../sim/index.js';
import { type BlastFx, makeBlast } from './explosionFx.js';
import { bodyKindToGlyph, type HazardInput } from './hazards.js';
import { clamp01, easeInOutQuad, lerpBodyAt, projectileAt, type LerpedBody } from './interp.js';
import type { TrailLayer } from './trail.js';
import type { TacticalView } from './types.js';

/** Wall-clock source (ms). Real playback uses `Date.now`; tests inject a fake. */
export type PlaybackClock = () => number;
/** RAF scheduler / canceller — overridable so the loop steps deterministically in node. */
export type RafSchedule = (cb: (t: number) => void) => number;
export type RafCancel = (handle: number) => void;

/** Per-sub-step pacing target (Gate 1 §0 "beat lands with a thud", ~40–55 ms/sub-step). */
export const MS_PER_SUBSTEP = 48;
/** Floor so a 1-sub-step beat still reads as motion, not a jump-cut. */
export const MIN_MOVEMENT_MS = 120;

/** Attack beats sequence one shot at a time; per-shot dwell + a floor. */
export const MS_PER_SHOT = 90;
export const MIN_ATTACK_MS = 160;

/** Default movement duration from keyframe count (`keyframes.length = subStepCount + 1`). */
export const defaultMovementDurationMs = (keyframeCount: number): number =>
  Math.max(MIN_MOVEMENT_MS, Math.max(0, keyframeCount - 1) * MS_PER_SUBSTEP);

/** Default attack duration from shot count. */
export const defaultAttackDurationMs = (shotCount: number): number =>
  Math.max(MIN_ATTACK_MS, shotCount * MS_PER_SHOT);

/** Shot-beam color keyed to the resolution (Gate 1 palette; secondary to motion). */
export const beamColorFor = (result: CombatLogResult): number => {
  switch (result) {
    case 'crit':
      return 0xffef6b;
    case 'kill':
      return 0xff2d2d;
    case 'hit':
      return 0xff6b6b;
    case 'intercept':
      return 0x6bd7ff;
    default:
      return 0x51637a; // miss / boundary-exit — muted
  }
};

/** Options for one playback. Duration defaults from the record; clock/raf default real. */
export interface PlaybackOpts {
  readonly durationMs?: number;
  readonly clock?: PlaybackClock;
  readonly raf?: RafSchedule;
  readonly cancelRaf?: RafCancel;
  readonly onDone?: () => void;
  /**
   * S01: an attached `TrailLayer` — playback pushes one point per NEW keyframe
   * transition (never per RAF frame, so the trail matches the true flown cadence).
   * `beatSeconds` must be supplied alongside it to map keyframe index → sim-time.
   */
  readonly trail?: TrailLayer;
  /** Beat duration in sim-seconds (= `physicsConfig.dt`). Required for trail timing. */
  readonly beatSeconds?: number;
  /** Sim-time (seconds) the beat starts at. Defaults to 0 (single-beat playback). */
  readonly startSimTime?: number;
}

/** A running (or finished) playback. Every method is idempotent once disposed. */
export interface Playback {
  /** Jump straight to the final frame and fire `onDone` (outcome-invariant with a full play). */
  skip(): void;
  /** Restart the same record from the beginning. */
  replay(): void;
  /** Register a completion callback (fires immediately if already done). */
  onDone(cb: () => void): void;
  /** Cancel the raf loop and clear this playback's transient FX. */
  dispose(): void;
}

/** The playback surface `attachTracePlayer` returns. */
export interface TracePlayer {
  playMovement(record: MovementBeatRecord, opts?: PlaybackOpts): Playback;
  playAttack(record: AttackBeatRecord, opts?: PlaybackOpts): Playback;
  dispose(): void;
}

const nowDefault: PlaybackClock = () => (typeof Date !== 'undefined' ? Date.now() : 0);

const rafDefault: RafSchedule = (cb) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0;

const cancelDefault: RafCancel = (h) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h);
};

interface PlaybackDeps {
  readonly durationMs: number;
  readonly clock: PlaybackClock;
  readonly raf: RafSchedule;
  readonly cancelRaf: RafCancel;
  /** Apply one frame at `tNorm` and render it. */
  readonly renderAt: (tNorm: number) => void;
  /** Tear down transient FX for this playback (called on dispose). */
  readonly cleanup: () => void;
  readonly onDone?: () => void;
}

/** The shared pacing state machine driving playback. */
const createPlayback = (deps: PlaybackDeps): Playback => {
  const doneCbs: Array<() => void> = [];
  if (deps.onDone !== undefined) doneCbs.push(deps.onDone);

  let handle = 0;
  let start = deps.clock();
  let finished = false;
  let disposed = false;

  const fireDone = (): void => {
    for (const cb of doneCbs.slice()) cb();
  };

  const finish = (): void => {
    if (finished || disposed) return;
    finished = true;
    deps.renderAt(1); // land exactly on the final frame
    fireDone();
  };

  const frame = (): void => {
    if (finished || disposed) return;
    const elapsed = deps.clock() - start;
    const raw = deps.durationMs <= 0 ? 1 : elapsed / deps.durationMs;
    if (raw >= 1) {
      finish();
      return;
    }
    deps.renderAt(raw);
    handle = deps.raf(frame);
  };

  const begin = (): void => {
    start = deps.clock();
    finished = false;
    handle = deps.raf(frame);
  };
  begin();

  return {
    skip: () => {
      if (disposed) return;
      deps.cancelRaf(handle);
      finish();
    },
    replay: () => {
      if (disposed) return;
      deps.cancelRaf(handle);
      begin();
    },
    onDone: (cb) => {
      if (finished) cb();
      else doneCbs.push(cb);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      deps.cancelRaf(handle);
      deps.cleanup();
    },
  };
};

/** Fraction of the beat reserved for detonation blasts on in-arena deaths. Deaths are
 *  applied after motion, so their blast starts in the last part of the beat and lands
 *  terminal (opacity ~0) at `tNorm = 1` — skip/reduced-motion stays outcome-invariant. */
const MOVEMENT_DEATH_START = 0.7;

/** Minimum playback span for a contact blast, in beat-normalized units. A very-late
 *  contact (`subStep = last`, `toi ≈ 1`) has almost no beat left; pulling its start
 *  earlier by this amount guarantees the blast is visibly present at least this long
 *  before `tNorm = 1` (session guidance: "a blast that starts a hair early is fine,
 *  one that never appears is not"). */
const MIN_CONTACT_BLAST_SPAN = 0.35;

/** Contact-blast radius range (world units) and reference closing-speed used to scale
 *  the read. A gentle graze reads smaller than a full ram; a full ram lands near the
 *  fighter-class detonation size (~30). Speed is `StepContact.relSpeedNormal`. */
const CONTACT_BLAST_MIN_RADIUS = 6;
const CONTACT_BLAST_MAX_RADIUS = 30;
const CONTACT_BLAST_REF_SPEED = 40;

/**
 * Attach the playback engine to a live `TacticalView`. Movement playback pushes
 * interpolated transforms into the SESSION-02 instance buffers (`scene.ships` /
 * `scene.hazards`), overlays transient contact + detonation blasts, missile tracers,
 * and PD-intercept FX into `scene.context.scene`, and renders through `scene.render()`.
 */
export const attachTracePlayer = (view: TacticalView): TracePlayer => {
  const scene = view.scene.context.scene;

  // Push one interpolated instant into the ship / hazard buffers. Ships move in place;
  // hazards re-sync (they have no per-instance seam) from the beat's live hazard set.
  // The interp `alpha` drives per-ship presence (S01 mid-beat fade) — a ship gone by
  // `hi` fades at its last position instead of freezing.
  const pushFrame = (bodies: readonly LerpedBody[]): void => {
    const hazardInputs: HazardInput[] = [];
    for (const b of bodies) {
      if (b.kind === 'ship') {
        view.scene.ships.setPosition(b.id, b.position.x, b.position.y, b.position.z);
        view.scene.ships.setOpacity(b.id, b.alpha);
      } else {
        hazardInputs.push({
          id: b.id,
          glyph: bodyKindToGlyph(b.kind),
          position: [b.position.x, b.position.y, b.position.z],
          radius: b.radius,
        });
      }
    }
    view.scene.hazards.sync(hazardInputs);
  };

  const playMovement = (record: MovementBeatRecord, opts: PlaybackOpts = {}): Playback => {
    const keyframes = record.keyframes;
    const durationMs = opts.durationMs ?? defaultMovementDurationMs(keyframes.length);

    // CP3 — every recorded contact becomes an animated blast at its impact point. The
    // pre-CP3 bare `CONTACT_FLASH_COLOR` sprite (which faded linearly across the whole
    // beat) is replaced by `makeBlast`, sized + intensified by collision energy so a
    // gentle graze reads smaller than a full ram ("explosions on collisions of anything").
    // Each blast's local window starts near the recorded contact instant `(subStep + toi)
    // / subStepCount` — pulled earlier when needed so a late-beat contact still has
    // MIN_CONTACT_BLAST_SPAN of play time before `tNorm = 1` (session guidance).
    interface ContactBlast {
      readonly fx: BlastFx;
      readonly windowStart: number;
    }
    const contactBlasts: ContactBlast[] = [];
    const contactBlastGroup = new Group();
    const subN = Math.max(1, record.subStepCount);
    for (const contact of record.contacts) {
      const rawStart = (contact.subStep + contact.toi) / subN;
      const startClamped = clamp01(rawStart);
      const windowStart = Math.min(startClamped, Math.max(0, 1 - MIN_CONTACT_BLAST_SPAN));
      const energy = Math.max(0, contact.relSpeedNormal);
      const speedNorm = Math.min(1, energy / CONTACT_BLAST_REF_SPEED);
      const radius =
        CONTACT_BLAST_MIN_RADIUS + (CONTACT_BLAST_MAX_RADIUS - CONTACT_BLAST_MIN_RADIUS) * speedNorm;
      const intensity = 0.5 + 0.5 * speedNorm;
      const fx = makeBlast(contact.point, { radius, intensity });
      contactBlasts.push({ fx, windowStart });
      contactBlastGroup.add(fx.object);
    }
    if (contactBlastGroup.children.length > 0) scene.add(contactBlastGroup);

    // CP3 — every detonating in-arena death (missile-vs-ship AoE, ship rams, secondary
    // AoE) becomes an expanding blast at the death position. Boundary deaths
    // (`detonates: false`, FR-26) leave the arena and get NO blast — matches the sim.
    // Deaths land after motion, so their blast plays in the last `1 - MOVEMENT_DEATH_
    // START` of the beat and is terminal (opacity ~0) at `tNorm = 1`.
    const deathBlasts: BlastFx[] = [];
    const deathBlastGroup = new Group();
    for (const dead of record.destroyed) {
      if (!dead.detonates) continue;
      const fx = makeBlast(dead.position, { radius: AOE_RING_RADIUS[dead.chassisClass] });
      deathBlasts.push(fx);
      deathBlastGroup.add(fx.object);
    }
    if (deathBlastGroup.children.length > 0) scene.add(deathBlastGroup);

    const disposeBlasts = (): void => {
      if (contactBlastGroup.children.length > 0) scene.remove(contactBlastGroup);
      for (const b of contactBlasts) b.fx.dispose();
      contactBlastGroup.clear();
      if (deathBlastGroup.children.length > 0) scene.remove(deathBlastGroup);
      for (const b of deathBlasts) b.dispose();
      deathBlastGroup.clear();
    };

    // CP2 — Missile tracers. The AttackBeatRecord's launchedMissileIds carries no
    // shooter/target correlation (readonly BodyId[] only, and missile launches emit
    // no log entry), so "missiles in motion" during the ATTACK beat cannot be drawn
    // from that record. What CAN be drawn is missile FLIGHT during the movement beat,
    // where every keyframe already carries missile bodies (position + velocity). Each
    // missile gets a bright additive head sprite AND a short velocity-aligned tail
    // line — the ➤ hazard glyph beneath keeps the "tracking missile" cue; the tracer
    // adds the "projectile is FLYING" cue the hazard glyph alone can't convey.
    const missileIds = new Set<BodyId>();
    for (const frame of keyframes) {
      for (const b of frame) if (b.kind === 'missile') missileIds.add(b.id);
    }
    const tracers = new Map<BodyId, MissileTracerFx>();
    const tracerGroup = new Group();
    const orderedMissileIds = Array.from(missileIds).sort((a, b) => a - b);
    for (const id of orderedMissileIds) {
      const tracer = makeMissileTracer();
      tracers.set(id, tracer);
      tracerGroup.add(tracer.head);
      tracerGroup.add(tracer.tail);
    }
    if (tracerGroup.children.length > 0) scene.add(tracerGroup);

    const disposeTracers = (): void => {
      scene.remove(tracerGroup);
      for (const tracer of tracers.values()) tracer.dispose();
      tracers.clear();
      tracerGroup.clear();
    };

    // CP3 — Intercept read. Movement-beat log entries with `result === 'intercept'`
    // record a successful PD kill: sourceId is the defending ship, targetId is the
    // (now-removed) missile body. Draw a short cyan tracer defender→intercept-point
    // and a cyan spark at the intercept point so "my missile got shot down" is legible.
    // Intercept point = the missile's LAST-known keyframe position (missiles vanish
    // at the end of the beat; the last keyframe carrying the id is our best proxy).
    const intercepts: InterceptFx[] = [];
    const interceptGroup = new Group();
    for (const entry of record.log) {
      if (entry.result !== 'intercept') continue;
      const defender = view.scene.ships.positionOf(entry.sourceId);
      if (defender === null) continue;
      let missilePos: Vec3 | null = null;
      for (let i = keyframes.length - 1; i >= 0; i -= 1) {
        const frame = keyframes[i]!;
        for (const b of frame) {
          if (b.id === entry.targetId && b.kind === 'missile') {
            missilePos = b.position;
            break;
          }
        }
        if (missilePos !== null) break;
      }
      if (missilePos === null) continue;
      const fx = makeInterceptFx(
        { x: defender.x, y: defender.y, z: defender.z },
        missilePos,
      );
      intercepts.push(fx);
      interceptGroup.add(fx.object);
    }
    if (interceptGroup.children.length > 0) scene.add(interceptGroup);

    const disposeIntercepts = (): void => {
      scene.remove(interceptGroup);
      for (const fx of intercepts) fx.dispose();
      interceptGroup.clear();
    };

    const cleanupAll = (): void => {
      disposeBlasts();
      disposeTracers();
      disposeIntercepts();
    };

    // S01: record one trail point per NEW keyframe transition so a skip and a full
    // play leave the trail in the same state (mirroring the FR-19 outcome-invariance).
    let lastKeyframeIdx = -1;
    const flushKeyframes = (currentIdx: number): void => {
      if (opts.trail === undefined || opts.beatSeconds === undefined) return;
      const start = opts.startSimTime ?? 0;
      for (let idx = lastKeyframeIdx + 1; idx <= currentIdx; idx += 1) {
        const at = start + idx * opts.beatSeconds;
        const frame = keyframes[idx];
        if (frame === undefined) continue;
        for (const b of frame) {
          if (b.kind === 'ship') {
            opts.trail.push(b.id, [b.position.x, b.position.y, b.position.z], at);
          }
        }
      }
      lastKeyframeIdx = currentIdx;
    };

    return createPlayback({
      durationMs,
      clock: opts.clock ?? nowDefault,
      raf: opts.raf ?? rafDefault,
      cancelRaf: opts.cancelRaf ?? cancelDefault,
      renderAt: (tNorm) => {
        const easedT = easeInOutQuad(tNorm);
        const bodies = lerpBodyAt(keyframes, easedT);
        pushFrame(bodies);
        const n = keyframes.length;
        if (n >= 2) {
          const currentIdx = Math.min(Math.floor(easedT * (n - 1)), n - 1);
          if (currentIdx > lastKeyframeIdx) flushKeyframes(currentIdx);
        }
        // CP3 — contact blasts: each blast's localT is the beat progress since its
        // recorded impact instant, normalized against `1 - windowStart`. Hidden before
        // its window opens (localT ≤ 0) and terminal (opacity ~0) at `tNorm = 1`, so
        // skip/reduced-motion lands clean.
        for (const cb of contactBlasts) {
          const span = 1 - cb.windowStart;
          const localT = span <= 0 ? 1 : (tNorm - cb.windowStart) / span;
          cb.fx.renderAt(localT);
        }
        // CP3 — death blasts play across the final `1 - MOVEMENT_DEATH_START` of the
        // beat; before that window opens they are hidden; at `tNorm = 1` they are spent.
        const deathSpan = 1 - MOVEMENT_DEATH_START;
        const deathLocalT = deathSpan <= 0 ? 1 : (tNorm - MOVEMENT_DEATH_START) / deathSpan;
        for (const fx of deathBlasts) fx.renderAt(deathLocalT);
        // Drive per-missile tracers off the same interpolated body list — position on
        // the missile head, tail streamed BACK along the velocity vector. Missiles not
        // present this frame (removed / never spawned yet) stay hidden.
        for (const tracer of tracers.values()) tracer.hide();
        for (const b of bodies) {
          if (b.kind !== 'missile') continue;
          const tracer = tracers.get(b.id);
          if (tracer === undefined) continue;
          tracer.updateAt(b.position, b.velocity, b.alpha);
        }
        // Intercept FX pulse in a short window centered around mid-beat — approximates
        // the moment the PD burst catches the missile. Transient; fades to 0 by end.
        for (const fx of intercepts) fx.renderAt(tNorm);
        view.scene.render();
      },
      cleanup: cleanupAll,
      ...(opts.onDone !== undefined ? { onDone: opts.onDone } : {}),
    });
  };

  const playAttack = (record: AttackBeatRecord, opts: PlaybackOpts = {}): Playback => {
    const shots = record.log;
    const durationMs = opts.durationMs ?? defaultAttackDurationMs(shots.length);

    // Shot beams (shooter→target, colored by result) sequence over the beat; each
    // beam SWEEPS its endpoint out over the first half of its per-shot window, lands
    // (or falls short, for misses) with a head-flash keyed to `result`, then fades.
    // Kill flashes + detonation blasts land in the final fifth of the beat — a bigger
    // hull ⇒ bigger blast radius (`AOE_RING_RADIUS` encodes class scale). The old
    // static AoE ring (visibility toggle at ≥ 0.8) is replaced by `makeBlast`, driven
    // over the finale window so a detonation reads as an expanding shockwave, not a pop.
    const group = new Group();
    const beams: BeamFx[] = [];
    for (const entry of shots) {
      const beam = makeBeam(view, entry);
      if (beam !== null) beams.push(beam);
    }
    const kills: FxHandle[] = [];
    const blasts: BlastFx[] = [];
    for (const dead of record.destroyed) {
      // Boundary deaths (detonates=false — FR-26) get only a kill flash: they leave the
      // arena, no AoE. In-arena deaths get flash + animated blast at the class radius.
      kills.push(makeKillFlash(dead));
      if (dead.detonates) {
        blasts.push(
          makeBlast(dead.position, { radius: AOE_RING_RADIUS[dead.chassisClass] }),
        );
      }
    }
    for (const fx of beams) group.add(fx.object);
    for (const fx of kills) group.add(fx.object);
    for (const fx of blasts) group.add(fx.object);
    if (group.children.length > 0) scene.add(group);

    const disposeFx = (): void => {
      scene.remove(group);
      for (const fx of beams) fx.dispose();
      for (const fx of kills) fx.dispose();
      for (const fx of blasts) fx.dispose();
      group.clear();
    };

    return createPlayback({
      durationMs,
      clock: opts.clock ?? nowDefault,
      raf: opts.raf ?? rafDefault,
      cancelRaf: opts.cancelRaf ?? cancelDefault,
      renderAt: (tNorm) => {
        // Drive each beam through its per-shot window. The window for shot `i` runs
        // `[i / N, (i + 1) / N]` — sequencing preserved from the pre-CP1 reveal loop.
        const n = beams.length;
        for (let i = 0; i < n; i += 1) {
          const windowStart = n === 0 ? 0 : i / n;
          const windowEnd = n === 0 ? 1 : (i + 1) / n;
          const span = windowEnd - windowStart;
          const localT = span <= 0 ? 1 : clamp01((tNorm - windowStart) / span);
          beams[i]!.renderAt(localT);
        }
        // Kill flashes retain the binary visibility toggle (a peach sprite pop). Blasts
        // drive over the finale window — hidden before it opens, terminal (opacity ~0)
        // at `tNorm = 1`, so `skip()`/reduced-motion (which lands on renderAt(1)) never
        // freezes a half-expanded shockwave (FR-19 outcome-invariance).
        const finaleShown = tNorm >= ATTACK_FINALE_START;
        for (const fx of kills) fx.object.visible = finaleShown;
        const finaleSpan = 1 - ATTACK_FINALE_START;
        const blastLocalT = finaleSpan <= 0 ? 1 : (tNorm - ATTACK_FINALE_START) / finaleSpan;
        for (const fx of blasts) fx.renderAt(blastLocalT);
        view.scene.render();
      },
      cleanup: disposeFx,
      ...(opts.onDone !== undefined ? { onDone: opts.onDone } : {}),
    });
  };

  return {
    playMovement,
    playAttack,
    dispose: () => {
      /* transient FX are owned per-Playback; nothing persistent to tear down here. */
    },
  };
};

/** A transient scene object plus its geometry/material disposer. */
interface FxHandle {
  readonly object: Object3D;
  dispose(): void;
}

/** An animated per-shot beam FX. Drives itself over `localT ∈ [0,1]` (its shot window). */
interface BeamFx extends FxHandle {
  renderAt(localT: number): void;
}

const KILL_FLASH_COLOR = 0xffd0a0;
/** Muzzle flash color — warm white; keyed to shooter, not resolution. */
const MUZZLE_FLASH_COLOR = 0xfff0c0;
/** Fraction of the shot window spent sweeping the beam outward; the remainder fades. */
const BEAM_SWEEP_FRAC = 0.5;
/** How far a MISS beam extends toward the target before fading — reads as "fell short". */
const MISS_ENDPOINT_FRAC = 0.62;
/** Nominal AoE ring radius per class (world units). True per-class AoE radius lives in
 *  `CombatConfig`, which the record does not carry, so playback draws a class-scaled
 *  legibility ring — bigger hull ⇒ bigger blast read. */
const AOE_RING_RADIUS: Readonly<Record<DestructionEvent['chassisClass'], number>> = {
  fighter: 30,
  frigate: 50,
  cruiser: 80,
  'mega-destroyer': 120,
};
/** Fraction of the attack beat reserved for the finale — kill flashes pop, blasts
 *  expand — from `tNorm ≥ ATTACK_FINALE_START` through `tNorm = 1`. */
const ATTACK_FINALE_START = 0.8;

/**
 * Return `1` for shot resolutions that LAND on the target (produce a head-flash), `0`
 * for those that don't — misses and boundary-exits fall short and fade silently.
 */
const beamLandsFor = (result: CombatLogResult): boolean => {
  switch (result) {
    case 'hit':
    case 'crit':
    case 'kill':
    case 'intercept':
      return true;
    default:
      return false; // miss / boundary-exit
  }
};

/**
 * Build one animated shot beam shooter→target, or `null` if either endpoint is already
 * gone. Composed of three transient objects:
 *   • a `Line2` beam whose endpoint sweeps out over the shot's window,
 *   • a `Sprite` muzzle flash that pops at the shooter as the beam ignites, and
 *   • a `Sprite` head flash that lands at the target on hits/crits/kills/intercepts.
 * Misses leave the head flash hidden and the beam endpoint falls short (see
 * `MISS_ENDPOINT_FRAC`), so "what missed" reads visibly without a landing pop.
 */
const makeBeam = (view: TacticalView, entry: CombatLogEntry): BeamFx | null => {
  const fromPos = view.scene.ships.positionOf(entry.sourceId);
  const toPos = view.scene.ships.positionOf(entry.targetId);
  if (fromPos === null || toPos === null) return null;

  const color = beamColorFor(entry.result);
  const lands = beamLandsFor(entry.result);
  const from: Vec3 = { x: fromPos.x, y: fromPos.y, z: fromPos.z };
  const to: Vec3 = { x: toPos.x, y: toPos.y, z: toPos.z };
  // Miss endpoint is a fixed fraction of the way to the target; hits sweep the full path.
  const endEnd: Vec3 = lands
    ? to
    : {
        x: from.x + (to.x - from.x) * MISS_ENDPOINT_FRAC,
        y: from.y + (to.y - from.y) * MISS_ENDPOINT_FRAC,
        z: from.z + (to.z - from.z) * MISS_ENDPOINT_FRAC,
      };

  const group = new Group();

  const geometry = new LineGeometry();
  geometry.setPositions([from.x, from.y, from.z, from.x, from.y, from.z]);
  const material = new LineMaterial({
    color,
    linewidth: 1.6,
    transparent: true,
    opacity: 0,
    depthTest: true,
  });
  const line = new Line2(geometry, material);
  line.visible = false;
  group.add(line);

  const muzzleMat = new SpriteMaterial({
    color: new Color(MUZZLE_FLASH_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const muzzle = new Sprite(muzzleMat);
  muzzle.position.set(from.x, from.y, from.z);
  muzzle.visible = false;
  group.add(muzzle);

  const headMat = new SpriteMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const head = new Sprite(headMat);
  head.position.set(endEnd.x, endEnd.y, endEnd.z);
  head.visible = false;
  group.add(head);

  return {
    object: group,
    renderAt: (localT: number) => {
      // Before the window opens, everything hidden. After it closes, everything faded.
      if (localT <= 0) {
        line.visible = false;
        muzzle.visible = false;
        head.visible = false;
        return;
      }

      // ── Beam sweep + opacity ──
      // Endpoint grows from shooter → endEnd over the first BEAM_SWEEP_FRAC of the
      // window (eased); the remainder holds full-extent while opacity fades out.
      const sweepT = clamp01(localT / BEAM_SWEEP_FRAC);
      const tip = projectileAt(from, endEnd, sweepT);
      geometry.setPositions([from.x, from.y, from.z, tip.x, tip.y, tip.z]);
      // Triangular opacity ramp — rises with sweep, falls after landing.
      const beamAlpha = localT <= BEAM_SWEEP_FRAC
        ? 0.9 * (localT / BEAM_SWEEP_FRAC)
        : 0.9 * (1 - (localT - BEAM_SWEEP_FRAC) / (1 - BEAM_SWEEP_FRAC));
      material.opacity = Math.max(0, beamAlpha);
      line.visible = material.opacity > 0.01;

      // ── Muzzle flash — bright at ignition, gone by ~30% of the window. ──
      const muzzleAlpha = localT < 0.3 ? 1 - localT / 0.3 : 0;
      muzzleMat.opacity = muzzleAlpha;
      muzzle.visible = muzzleAlpha > 0.01;

      // ── Head flash — only for landing shots; peaks at landing then fades. ──
      if (!lands || localT < BEAM_SWEEP_FRAC) {
        headMat.opacity = 0;
        head.visible = false;
      } else {
        // Peak at localT ≈ BEAM_SWEEP_FRAC, decay linearly to 0 at localT = 1.
        const decay = (localT - BEAM_SWEEP_FRAC) / (1 - BEAM_SWEEP_FRAC);
        headMat.opacity = Math.max(0, 1 - decay);
        head.visible = headMat.opacity > 0.01;
      }
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      muzzleMat.dispose();
      headMat.dispose();
    },
  };
};

// ---- Missile tracer (movement beat CP2) --------------------------------------

/** Warm-white missile tracer head — additive so it blooms bright against the ➤ glyph. */
const MISSILE_TRACER_COLOR = 0xffdca8;
/** Additional-scale multiplier on the head sprite (world units). Nominally 6 wu — a
 *  legibility choice, not a physical size; the sprite is billboarded and additive. */
const MISSILE_HEAD_SCALE = 6;
/** Line width for the velocity-aligned tail. Fat-line reads well against the dark scene. */
const MISSILE_TAIL_LINEWIDTH = 2.2;
/** Tail length as `velocity * MISSILE_TAIL_K` (velocity in world-units/sim-sec).
 *  Yields a visible ~short streak at typical missile speeds without swamping the head. */
const MISSILE_TAIL_K = 0.12;

/** Per-missile tracer FX bundle: a bright head + a velocity-aligned tail. */
interface MissileTracerFx {
  readonly head: Sprite;
  readonly tail: Line2;
  /** Reposition + fade at an interpolated instant. `alpha` is `LerpedBody.alpha`. */
  updateAt(position: Vec3, velocity: Vec3, alpha: number): void;
  /** Hide both head and tail — used before per-frame updates so absent missiles stay dark. */
  hide(): void;
  dispose(): void;
}

const makeMissileTracer = (): MissileTracerFx => {
  const headMat = new SpriteMaterial({
    color: new Color(MISSILE_TRACER_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const head = new Sprite(headMat);
  head.scale.setScalar(MISSILE_HEAD_SCALE);
  head.visible = false;

  const tailGeom = new LineGeometry();
  tailGeom.setPositions([0, 0, 0, 0, 0, 0]);
  const tailMat = new LineMaterial({
    color: MISSILE_TRACER_COLOR,
    linewidth: MISSILE_TAIL_LINEWIDTH,
    transparent: true,
    opacity: 0,
    depthTest: true,
  });
  const tail = new Line2(tailGeom, tailMat);
  tail.visible = false;

  return {
    head,
    tail,
    updateAt: (position, velocity, alpha) => {
      const effAlpha = clamp01(alpha);
      if (effAlpha <= 0.001) {
        head.visible = false;
        tail.visible = false;
        return;
      }
      head.position.set(position.x, position.y, position.z);
      headMat.opacity = effAlpha;
      head.visible = true;
      // Tail: from (position - k · velocity) → position. A stationary missile draws a
      // zero-length segment, which renders as nothing — no visual glitch.
      const tx = position.x - velocity.x * MISSILE_TAIL_K;
      const ty = position.y - velocity.y * MISSILE_TAIL_K;
      const tz = position.z - velocity.z * MISSILE_TAIL_K;
      tailGeom.setPositions([tx, ty, tz, position.x, position.y, position.z]);
      tailMat.opacity = effAlpha * 0.7;
      tail.visible = true;
    },
    hide: () => {
      head.visible = false;
      tail.visible = false;
    },
    dispose: () => {
      headMat.dispose();
      tailGeom.dispose();
      tailMat.dispose();
    },
  };
};

// ---- Intercept FX (movement beat CP3) ----------------------------------------

/** PD intercept cyan — the same hue the beam palette uses for `result: 'intercept'`. */
const INTERCEPT_COLOR = 0x6bd7ff;
/** Peak time within the movement beat when the intercept flashes — mid-beat. */
const INTERCEPT_PEAK = 0.5;
/** Half-width (in tNorm) of the intercept pulse window. */
const INTERCEPT_HALF_WINDOW = 0.15;
const INTERCEPT_TRACER_LINEWIDTH = 1.4;
/** Additional-scale for the intercept spark (world units). Legibility choice. */
const INTERCEPT_SPARK_SCALE = 8;

/** A per-intercept FX bundle: a defender→missile tracer + a spark at the intercept point. */
interface InterceptFx extends FxHandle {
  renderAt(tNorm: number): void;
}

/**
 * Triangular pulse peaking at `INTERCEPT_PEAK`, width `2 · INTERCEPT_HALF_WINDOW`.
 * Returns 0 outside the window, 1 at the peak. Used for both tracer and spark alpha.
 */
const interceptPulse = (tNorm: number): number => {
  const dist = Math.abs(tNorm - INTERCEPT_PEAK);
  if (dist >= INTERCEPT_HALF_WINDOW) return 0;
  return 1 - dist / INTERCEPT_HALF_WINDOW;
};

const makeInterceptFx = (defender: Vec3, missile: Vec3): InterceptFx => {
  const group = new Group();

  const tracerGeom = new LineGeometry();
  tracerGeom.setPositions([
    defender.x,
    defender.y,
    defender.z,
    missile.x,
    missile.y,
    missile.z,
  ]);
  const tracerMat = new LineMaterial({
    color: INTERCEPT_COLOR,
    linewidth: INTERCEPT_TRACER_LINEWIDTH,
    transparent: true,
    opacity: 0,
    depthTest: true,
  });
  const tracer = new Line2(tracerGeom, tracerMat);
  tracer.visible = false;
  group.add(tracer);

  const sparkMat = new SpriteMaterial({
    color: new Color(INTERCEPT_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const spark = new Sprite(sparkMat);
  spark.position.set(missile.x, missile.y, missile.z);
  spark.scale.setScalar(INTERCEPT_SPARK_SCALE);
  spark.visible = false;
  group.add(spark);

  return {
    object: group,
    renderAt: (tNorm) => {
      const pulse = interceptPulse(tNorm);
      if (pulse <= 0.001) {
        tracer.visible = false;
        spark.visible = false;
        tracerMat.opacity = 0;
        sparkMat.opacity = 0;
        return;
      }
      tracerMat.opacity = pulse * 0.75;
      sparkMat.opacity = pulse;
      tracer.visible = true;
      spark.visible = true;
    },
    dispose: () => {
      tracerGeom.dispose();
      tracerMat.dispose();
      sparkMat.dispose();
    },
  };
};

/** A brief flash sprite at a death position. */
const makeKillFlash = (dead: DestructionEvent): FxHandle => {
  const material = new SpriteMaterial({
    color: new Color(KILL_FLASH_COLOR),
    transparent: true,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.position.set(dead.position.x, dead.position.y, dead.position.z);
  sprite.visible = false;
  return { object: sprite, dispose: () => material.dispose() };
};
