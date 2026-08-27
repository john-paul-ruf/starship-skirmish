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

import { Color, Group, Sprite, SpriteMaterial } from 'three';
import type { MovementBeatRecord } from '../sim/index.js';
import { bodyKindToGlyph, type HazardInput } from './hazards.js';
import { easeInOutQuad, lerpBodyAt, type LerpedBody } from './interp.js';
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

/** Default movement duration from keyframe count (`keyframes.length = subStepCount + 1`). */
export const defaultMovementDurationMs = (keyframeCount: number): number =>
  Math.max(MIN_MOVEMENT_MS, Math.max(0, keyframeCount - 1) * MS_PER_SUBSTEP);

/** Options for one playback. Duration defaults from the record; clock/raf default real. */
export interface PlaybackOpts {
  readonly durationMs?: number;
  readonly clock?: PlaybackClock;
  readonly raf?: RafSchedule;
  readonly cancelRaf?: RafCancel;
  readonly onDone?: () => void;
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

const CONTACT_FLASH_COLOR = 0xfff0c0;

/**
 * Attach the playback engine to a live `TacticalView`. Movement playback pushes
 * interpolated transforms into the SESSION-02 instance buffers (`scene.ships` /
 * `scene.hazards`), overlays transient collision flashes into `scene.context.scene`,
 * and renders through `scene.render()`.
 */
export const attachTracePlayer = (view: TacticalView): TracePlayer => {
  const scene = view.scene.context.scene;

  // Push one interpolated instant into the ship / hazard buffers. Ships move in place;
  // hazards re-sync (they have no per-instance seam) from the beat's live hazard set.
  const pushFrame = (bodies: readonly LerpedBody[]): void => {
    const hazardInputs: HazardInput[] = [];
    for (const b of bodies) {
      if (b.kind === 'ship') {
        view.scene.ships.setPosition(b.id, b.position.x, b.position.y, b.position.z);
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

    // Transient collision flashes at each recorded contact point.
    const flashes = new Group();
    for (const contact of record.contacts) {
      const material = new SpriteMaterial({
        color: new Color(CONTACT_FLASH_COLOR),
        transparent: true,
        depthWrite: false,
      });
      const sprite = new Sprite(material);
      sprite.position.set(contact.point.x, contact.point.y, contact.point.z);
      flashes.add(sprite);
    }
    if (flashes.children.length > 0) scene.add(flashes);

    const disposeFlashes = (): void => {
      scene.remove(flashes);
      for (const child of flashes.children) (child as Sprite).material.dispose();
      flashes.clear();
    };

    return createPlayback({
      durationMs,
      clock: opts.clock ?? nowDefault,
      raf: opts.raf ?? rafDefault,
      cancelRaf: opts.cancelRaf ?? cancelDefault,
      renderAt: (tNorm) => {
        pushFrame(lerpBodyAt(keyframes, easeInOutQuad(tNorm)));
        // Fade flashes out over the beat; strongest at the start, gone by the end.
        const flashAlpha = 1 - tNorm;
        for (const child of flashes.children) (child as Sprite).material.opacity = flashAlpha;
        view.scene.render();
      },
      cleanup: disposeFlashes,
      ...(opts.onDone !== undefined ? { onDone: opts.onDone } : {}),
    });
  };

  return {
    playMovement,
    dispose: () => {
      /* transient FX are owned per-Playback; nothing persistent to tear down here. */
    },
  };
};
