// Gate 1 prototype bootstrap (M18, disposable — FR-32).
//
// Wires the scene, camera, and turn loop. Consumes the REAL deterministic sim
// from `../../src/sim/**` — do NOT reimplement anything from there, and do NOT
// modify anything under `src/` from this file (session lease is prototypes/gate1
// only). If a piece of physics behavior seems wrong for the game, it belongs in
// FINDINGS.md as a tuning note, not a code patch here.
//
// CHECKPOINT 1 STATE:
//   * WebGLRenderer mounts into #canvas-mount.
//   * Scenery: boundary shell + inner haze + ground grid + origin axes.
//   * Two wireframe ships at fleet positions (cyan/magenta).
//   * Free orbit/pan/zoom camera; `R` resets to fleet view; `F` focuses selected ship.
//   * Animation loop draws at rAF cadence.
//
// CHECKPOINT 2 STATE:
//   * Numeric arc-plotting form (bearing / pitch / magnitude) — the accessible
//     baseline (design §7.2, NFR-Accessibility). Bearing/pitch are unbounded
//     text-numeric inputs; magnitude is a slider clamped by the Δv budget.
//   * Ship tabs — plot for each ship independently. `[1]` / `[2]` keys also swap.
//   * Ghost predicted path via `physics.previewPath()` — SAME integrator as
//     resolveMovement (see previewPath.ts header). We do NOT reimplement it.
//     When the path ends outside the arena, the ghost turns HOSTILE (red) and
//     an ✕ EXIT sprite drops at the crash point (design §4.1 three-channels).
//   * Δv budget enforced: magnitude is clamped to [0, MAX_DV_PER_TURN] at the
//     input layer AND at plan construction — over-spend is structurally
//     impossible from this HUD.
//
// CHECKPOINT 3 STATE:
//   * Full turn loop: plans commit → `resolveMovement()` → animate the returned
//     keyframes. Architecture §2 / §6.2 discipline: SIMULATE FULLY, THEN ANIMATE
//     THE TRACE. The renderer here plays back the pre-computed keyframes; it
//     does not run physics per frame.
//   * Debris persistence: every `StepContact` spawns two symmetric shards at
//     the contact point moving along the contact normal. Debris `Body`s live in
//     the world state and enter the next turn's `bodies` array — a shard flying
//     into a ship next turn will register as a StepContact next turn.
//   * Scripted scenarios (head-on, graze, chase) prime the fun-verdict probe.
//   * §7.4 marker-density stress toggle spawns 60 inert hazard sprites.
//
// CHECKPOINT 4 STATE (per-waypoint burns — prototype experiment):
//   * The single-burn-per-beat model is generalized to per-waypoint burns. The
//     MARKS interval sets the waypoint granularity (2s → four 2s segments; 1s →
//     eight 1s segments; Off → one dt-length segment = the classic single burn).
//     Each waypoint carries its own bearing / pitch / Δv, applied once at the
//     segment start, then ballistic for that segment.
//   * Trajectories are built by CHAINING the REAL previewPath / resolveMovement
//     at dt = segDur — never a hand-rolled integrator, so "preview must not lie"
//     still holds (each sub-beat is the real integrator; committing replays the
//     same chained resolution the ghost previewed).
//   * A burn in segment 0 with the rest coasting is IDENTICAL to the classic
//     single burn (velocity persists through coasting segments) — so Off and the
//     "edit only waypoint 1" case reproduce prior behavior exactly.
//   * NOTE: this DIVERGES from the shipping sim, which applies one Δv per beat.
//     It is a disposable Gate 1 experiment probing whether waypoint steering is
//     fun; the real multi-waypoint model, if adopted, is a Forge feature that
//     belongs in src/sim (new plan shape + multi-impulse integrator).

import { Vector3, WebGLRenderer } from 'three';

import { of as vec3Of, type Vec3 } from '../../src/sim/mathx/index.js';
import { dirFromBearingPitch } from '../../src/sim/mathx/index.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import {
  applyPlan,
  previewPath,
  resolveMovement,
  type StepContact,
} from '../../src/sim/physics/index.js';
import type {
  Body,
  BodyId,
  DebrisBody,
  MovementPlan,
  ShipBody,
} from '../../src/sim/types.js';

import { mountCamera, type CameraHandle } from './camera.js';
import { buildScene, type DebrisVisual, type FleetIdx, type ShipVisual, type TimeMark } from './scene.js';

// -------- config --------

const ARENA_RADIUS = 2000;
const SHIP_RADIUS = 60;
const SHIP_MASS = 100;
/** Δv budget per ship per WAYPOINT — the "engine cap" the plan UI clamps against. */
const MAX_DV_PER_TURN = 200;

const PHYSICS: PhysicsConfig = {
  // dt is sim-seconds per beat, not wall-clock. 8s per beat means a Δv=100 burn
  // moves ~800 units — a readable ~20% of the 4000-unit arena width, which is
  // where "one turn feels like a turn" lives. Real tuning owns this in
  // `catalog/tuning.json`; the prototype picks a number that reads.
  dt: 8,
  subStepMin: 4,
  // subStepMax = 64 is `catalog/tuning.json`'s stated default. At dt=8 and the
  // top-end Δv the CCD gap sits at ~7 units per sub-step — well inside the
  // 30-unit (half-hull-radius) budget the integrator needs.
  subStepMax: 64,
  restitution: 0.35,
  collisionDamageCoefficient: 0.0012,
  arena: { center: { x: 0, y: 0, z: 0 }, radius: ARENA_RADIUS },
};

// Fleet 0 = you (cyan), Fleet 1 = opponent (magenta). Set up so both start
// stationary — every observed motion is the player's plan, no confusing drift.
const INITIAL_POSITIONS: readonly [Vec3, Vec3] = [
  vec3Of(-800, 100, 0),
  vec3Of(800, 0, 300),
];

// -------- helpers --------

const toVec3 = (v: Vec3): Vector3 => new Vector3(v.x, v.y, v.z);

/** A single burn: bearing/pitch aim + Δv magnitude. One per waypoint-segment. */
interface PlanDraft {
  bearing: number;
  pitch: number;
  magnitude: number;
}

/** Clamp magnitude to the per-waypoint Δv budget — the enforcement point CP2 locks. */
const clampMag = (v: number): number => {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > MAX_DV_PER_TURN) return MAX_DV_PER_TURN;
  return v;
};

/**
 * Convert a numeric draft to a physics `MovementPlan`. Returns `null` when the
 * draft is a coast (zero magnitude) — physics accepts a null plan for the
 * preview path (see `previewPath.ts`), which keeps the "coast is not a plan"
 * distinction honest all the way down.
 */
const draftToPlan = (id: BodyId, draft: PlanDraft): MovementPlan | null => {
  const mag = clampMag(draft.magnitude);
  if (mag <= 0) return null;
  const dir = dirFromBearingPitch(draft.bearing, draft.pitch);
  return { bodyId: id, deltaV: { x: dir.x * mag, y: dir.y * mag, z: dir.z * mag } };
};

// -------- waypoint segmentation --------
//
// The beat (dt sim-seconds) is split into per-waypoint segments driven by the
// MARKS interval: interval 2s → four 2s segments, 1s → eight 1s segments, Off →
// a single dt-length segment (the classic single-burn model). Each segment
// carries its own burn, applied once at the segment start, then ballistic for
// that segment. Trajectories are built by CHAINING the real previewPath /
// resolveMovement at dt = segDur — never a hand-rolled integrator.

/** Seconds between waypoints along the ghost (UI `MARKS` selector). 0 = off (single burn). */
let markIntervalSec = 1;

const segCountFor = (intervalSec: number): number =>
  intervalSec > 0 ? Math.floor(PHYSICS.dt / intervalSec) : 1;
const segDurFor = (intervalSec: number): number =>
  intervalSec > 0 ? intervalSec : PHYSICS.dt;
const makeCoast = (bearing: number): PlanDraft => ({ bearing, pitch: 0, magnitude: 0 });

// -------- world model (prototype-local) --------

interface WorldShip {
  readonly id: BodyId;
  readonly fleet: FleetIdx;
  body: ShipBody;
  visual: ShipVisual;
  /** One burn per waypoint-segment (length = segCountFor(markIntervalSec)). */
  segments: PlanDraft[];
  /** Index of the waypoint the PLOT form currently edits. */
  activeSeg: number;
}

interface WorldDebris {
  readonly id: BodyId;
  body: DebrisBody;
  visual: DebrisVisual;
}

/** The waypoint-segment the PLOT form is currently bound to. */
const active = (ship: WorldShip): PlanDraft => ship.segments[ship.activeSeg]!;

// -------- boot --------

const mount = document.getElementById('canvas-mount');
if (mount === null) throw new Error('gate1: #canvas-mount missing from index.html');

const renderer = new WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(mount.clientWidth, mount.clientHeight, false);
mount.appendChild(renderer.domElement);

const scenery = buildScene(ARENA_RADIUS);
const cam: CameraHandle = mountCamera({
  arenaRadius: ARENA_RADIUS,
  domElement: mount,
  renderer,
});

const makeShip = (fleet: FleetIdx, position: Vec3): WorldShip => {
  const id: BodyId = fleet === 0 ? 1 : 2;
  const body: ShipBody = {
    kind: 'ship',
    id,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    mass: SHIP_MASS,
    radius: SHIP_RADIUS,
  };
  const visual = scenery.addShip(fleet, toVec3(position), SHIP_RADIUS);
  // Default aim points each ship away from the origin: cyan (leftmost) +X,
  // magenta (rightmost) −X. Every waypoint starts as coast (no Δv spent).
  const bearing = fleet === 0 ? 0 : 180;
  const segments = Array.from({ length: segCountFor(markIntervalSec) }, () => makeCoast(bearing));
  return { id, fleet, body, visual, segments, activeSeg: 0 };
};

const ships: [WorldShip, WorldShip] = [
  makeShip(0, INITIAL_POSITIONS[0]),
  makeShip(1, INITIAL_POSITIONS[1]),
];

/** Persistent debris — cleared only when it exits the arena. Body ids start at
 *  100 so they never collide with ship ids (2 today, an order of magnitude of
 *  headroom for prototype scenarios). Real sim owns a monotonic id source. */
const debris: WorldDebris[] = [];
let nextDebrisId = 100;

let turnIdx = 1;
let animating = false;
/** Cumulative committed sim-seconds — timestamps trail points so the last ~16 s show. */
let simClock = 0;

// -------- top-bar HUD wiring --------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`gate1: #${id} missing from index.html`);
  return el as T;
};

const shipsCountEl = $<HTMLElement>('ships-count');
const debrisCountEl = $<HTMLElement>('debris-count');
const bodiesCountEl = $<HTMLElement>('bodies-count');
const turnLabelEl = $<HTMLElement>('turn-label');

shipsCountEl.textContent = String(ships.length);
debrisCountEl.textContent = '0';
bodiesCountEl.textContent = String(ships.length);
turnLabelEl.textContent = 'TURN 01 · PLAN';

// -------- plan HUD wiring (Checkpoint 2) --------

const dvMag = $<HTMLInputElement>('dv-mag');
const dvMagOut = $<HTMLElement>('dv-mag-out');
const dvBearing = $<HTMLInputElement>('dv-bearing');
const dvPitch = $<HTMLInputElement>('dv-pitch');
const dvBudget = $<HTMLInputElement>('dv-budget');
const dvRemaining = $<HTMLElement>('dv-remaining');
const planStatus = $<HTMLElement>('plan-status');
const btnCoast = $<HTMLButtonElement>('btn-coast');
const btnCommit = $<HTMLButtonElement>('btn-commit');
const commitHint = $<HTMLElement>('commit-hint');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#hud-plan .tabs button'));
const stressBtn = $<HTMLButtonElement>('stress-toggle');
const presetSelect = $<HTMLSelectElement>('preset-select');
const marksInterval = $<HTMLSelectElement>('marks-interval');
const segSelect = $<HTMLSelectElement>('seg-select');
const segRow = $<HTMLElement>('seg-row');

// Cap the magnitude slider at the enforced budget so the DOM cannot present an
// input that violates the cap. Match the number-input caps for the same reason.
dvMag.max = String(MAX_DV_PER_TURN);
dvBudget.max = String(MAX_DV_PER_TURN);

let selectedFleet: FleetIdx = 0;

/**
 * Build a ship's full multi-waypoint trajectory by CHAINING the real integrator:
 * for each segment, apply that waypoint's burn and advance `segDur` seconds via
 * `previewPath`, then carry the post-burn state forward with the real `applyPlan`.
 * Returns the ghost polyline (one vertex per waypoint), the amber marks, and the
 * boundary-exit verdict. No sub-step integration is reimplemented here.
 */
const planPreview = (
  ship: WorldShip,
): { verts: Vector3[]; marks: TimeMark[]; hostile: boolean; exitAt: Vector3 | null } => {
  const segDur = segDurFor(markIntervalSec);
  const segConfig: PhysicsConfig = { ...PHYSICS, dt: segDur };
  const showMarks = markIntervalSec > 0;
  let state: Body = ship.body;
  const verts: Vector3[] = [toVec3(state.position)];
  const marks: TimeMark[] = [];
  let hostile = false;
  let exitAt: Vector3 | null = null;
  for (let k = 0; k < ship.segments.length; k += 1) {
    const plan = draftToPlan(ship.id, ship.segments[k]!);
    const path = previewPath(state, plan, segConfig);
    const endVec = path.positions[path.positions.length - 1]!;
    const endV = toVec3(endVec);
    verts.push(endV);
    if (showMarks) marks.push({ position: endV, second: (k + 1) * segDur });
    if (path.endsOutsideArena && !hostile) {
      hostile = true;
      exitAt = endV;
    }
    // Advance to the segment end: real applyPlan for the post-burn velocity,
    // real integrated endpoint for the position.
    const burned = plan === null ? state : applyPlan(state, plan);
    state = { ...burned, position: endVec };
  }
  // Stationary guard: no ruler / no exit when the ship never actually moves
  // (marks would stack on the hull) — mirrors the old computeTimeMarks guard.
  const a = verts[0]!;
  const b = verts[verts.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  if (dx * dx + dy * dy + dz * dz < 1) {
    marks.length = 0;
    hostile = false;
    exitAt = null;
  }
  return { verts, marks, hostile, exitAt };
};

const refreshGhost = (ship: WorldShip) => {
  const { verts, marks, hostile, exitAt } = planPreview(ship);
  ship.visual.setGhost(verts, hostile);
  ship.visual.setTimeMarks(marks);
  ship.visual.setExit(hostile && exitAt !== null, exitAt);
};

const refreshAllGhosts = () => {
  for (const s of ships) refreshGhost(s);
};

const shipHasBurn = (s: WorldShip): boolean => s.segments.some((seg) => clampMag(seg.magnitude) > 0);

/**
 * Update the status line under the form. Three channels per design §4.1: the
 * color of the ghost + the ✕ EXIT sprite in-scene + this text line. Now also
 * names the active waypoint so per-mark editing is legible.
 */
const renderStatusText = () => {
  const s = ships[selectedFleet];
  const seg = active(s);
  const { hostile } = planPreview(s);
  const burnAt = s.activeSeg * segDurFor(markIntervalSec); // segment start = burn instant
  const segLabel =
    markIntervalSec > 0
      ? ` · waypoint ${s.activeSeg + 1}/${s.segments.length} (burn @ t=${burnAt}s)`
      : '';
  if (!shipHasBurn(s)) {
    planStatus.classList.remove('is-hostile');
    planStatus.textContent = `Coast — no thrust plotted.${segLabel}`;
  } else if (hostile) {
    planStatus.classList.add('is-hostile');
    planStatus.textContent = `✕ Predicted exit — arc leaves the arena. Δv ${seg.magnitude} / brg ${seg.bearing}° / pitch ${seg.pitch}°${segLabel}.`;
  } else {
    planStatus.classList.remove('is-hostile');
    planStatus.textContent = `Planned — Δv ${seg.magnitude} / brg ${seg.bearing}° / pitch ${seg.pitch}°${segLabel}.`;
  }
  renderCommitState();
};

const renderCommitState = () => {
  if (animating) {
    btnCommit.disabled = true;
    btnCommit.textContent = 'Resolving…';
    btnCommit.classList.remove('is-hostile');
    return;
  }
  const anyHostile = ships.some((sh) => planPreview(sh).hostile);
  btnCommit.disabled = false;
  btnCommit.classList.toggle('is-hostile', anyHostile);
  btnCommit.textContent = anyHostile ? '✕ Commit — Boundary Exit' : 'Commit — Resolve Beat';
  commitHint.textContent = anyHostile
    ? 'At least one arc exits the arena — legal but lethal. Blind: both plans resolve together.'
    : 'Both plans commit simultaneously — blind. Contact spawns debris that persists into the next turn.';
};

/** Repopulate + show/hide the waypoint selector for the selected ship. */
const syncSegUI = () => {
  const s = ships[selectedFleet];
  const multi = markIntervalSec > 0 && s.segments.length > 1;
  segRow.style.display = multi ? '' : 'none';
  if (!multi) return;
  const segDur = segDurFor(markIntervalSec);
  if (segSelect.options.length !== s.segments.length) {
    segSelect.replaceChildren();
    for (let k = 0; k < s.segments.length; k += 1) {
      const o = document.createElement('option');
      o.value = String(k);
      // Label by the burn INSTANT (segment start) so the option matches where the
      // arc bends: t=0 is the launch burn (== the classic single arc); t=k·segDur
      // is a mid-course correction at mark k.
      o.textContent = k === 0 ? 't = 0 s · launch' : `t = ${k * segDur} s`;
      segSelect.appendChild(o);
    }
  }
  segSelect.value = String(s.activeSeg);
};

const loadDraftIntoForm = () => {
  const s = ships[selectedFleet];
  const seg = active(s);
  const mag = clampMag(seg.magnitude);
  dvMag.value = String(mag);
  dvMagOut.textContent = String(mag);
  dvBearing.value = String(seg.bearing);
  dvPitch.value = String(seg.pitch);
  dvBudget.value = String(mag);
  dvRemaining.textContent = String(MAX_DV_PER_TURN - mag);
  syncSegUI();
  renderStatusText();
};

const setSelectedFleet = (f: FleetIdx) => {
  selectedFleet = f;
  for (const t of tabs) {
    const on = Number(t.dataset['fleet']) === f;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  }
  loadDraftIntoForm();
};

for (const t of tabs) {
  t.addEventListener('click', () =>
    setSelectedFleet(Number(t.dataset['fleet']) as FleetIdx),
  );
}

/**
 * Re-segment a ship's plan for the current interval. Changing granularity moves
 * where each burn fires in time (a 2s-segment burn starts at a different instant
 * than a 1s-segment one), so burns can't map cleanly across it — reset to coast
 * (predictable) but keep the last aim so the form doesn't jump.
 */
const rebuildSegments = (ship: WorldShip) => {
  const n = segCountFor(markIntervalSec);
  const bearing = active(ship).bearing; // old activeSeg still valid here
  ship.segments = Array.from({ length: n }, () => makeCoast(bearing));
  ship.activeSeg = Math.min(ship.activeSeg, n - 1);
};

/** Set a ship to a single first-waypoint burn (== the classic single-arc plan). */
const setSingleBurn = (ship: WorldShip, bearing: number, pitch: number, magnitude: number) => {
  const n = segCountFor(markIntervalSec);
  ship.segments = Array.from({ length: n }, (_unused, k) =>
    k === 0 ? { bearing, pitch, magnitude } : makeCoast(bearing),
  );
  ship.activeSeg = 0;
};

segSelect.addEventListener('change', () => {
  const s = ships[selectedFleet];
  const k = Number(segSelect.value);
  if (Number.isInteger(k) && k >= 0 && k < s.segments.length) s.activeSeg = k;
  loadDraftIntoForm();
  refreshGhost(s);
});

dvMag.addEventListener('input', () => {
  const s = ships[selectedFleet];
  const seg = active(s);
  seg.magnitude = clampMag(Number(dvMag.value));
  // Reflect the clamped value back into the slider — if a `value` outside
  // [0, MAX] is ever pushed programmatically we do not want it to render.
  dvMag.value = String(seg.magnitude);
  dvMagOut.textContent = String(seg.magnitude);
  dvBudget.value = String(seg.magnitude);
  dvRemaining.textContent = String(MAX_DV_PER_TURN - seg.magnitude);
  refreshGhost(s);
  renderStatusText();
});

const clampPitch = (p: number): number => {
  if (!Number.isFinite(p)) return 0;
  if (p > 90) return 90;
  if (p < -90) return -90;
  return p;
};

for (const el of [dvBearing, dvPitch] as const) {
  el.addEventListener('input', () => {
    const s = ships[selectedFleet];
    const seg = active(s);
    const bearing = Number(dvBearing.value);
    const pitch = clampPitch(Number(dvPitch.value));
    if (Number.isFinite(bearing)) seg.bearing = bearing;
    seg.pitch = pitch;
    refreshGhost(s);
    renderStatusText();
  });
}

btnCoast.addEventListener('click', () => {
  const s = ships[selectedFleet];
  active(s).magnitude = 0;
  loadDraftIntoForm();
  refreshGhost(s);
});

// -------- turn resolution & playback (Checkpoint 3) --------

/** All bodies the physics layer needs to know about this beat. */
const collectBodies = (): Body[] => {
  const out: Body[] = [];
  for (const s of ships) out.push(s.body);
  for (const d of debris) out.push(d.body);
  return out;
};

const spawnDebrisAt = (position: Vec3, velocity: Vec3): WorldDebris => {
  const id: BodyId = nextDebrisId;
  nextDebrisId += 1;
  const body: DebrisBody = {
    kind: 'debris',
    id,
    position,
    velocity,
    mass: 20,
    radius: 22,
  };
  const visual = scenery.addDebris(toVec3(position), 22);
  return { id, body, visual };
};

/**
 * Play the pre-computed keyframes back in wall time. This is the design intent
 * from architecture §2/§6.2: "simulate fully, then animate the trace". Wall
 * clock never enters the sim — every physics number is fixed before the first
 * frame paints; the loop below just interpolates between snapshots.
 */
const animateResolution = (keyframes: readonly (readonly Body[])[]): Promise<Body[]> => {
  return new Promise((resolve) => {
    // 55 ms per keyframe reads as chunky-but-tense at 30–60 real fps. Real
    // playback in M13 will interpolate more smoothly; this is prototype-scale.
    const kfMs = 55;
    let idx = 0;
    let acc = 0;
    let last = performance.now();
    let lastTrailIdx = -1;
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= kfMs && idx < keyframes.length - 1) {
        idx += 1;
        acc -= kfMs;
      }
      const frame = keyframes[idx]!;
      // Sample the flown path once per NEW keyframe (not per rAF) for the trail.
      const recordTrail = idx !== lastTrailIdx;
      lastTrailIdx = idx;
      const progress = keyframes.length > 1 ? idx / (keyframes.length - 1) : 1;
      const trailSimTime = simClock + progress * PHYSICS.dt;
      const seen = new Set<BodyId>();
      for (const b of frame) {
        seen.add(b.id);
        if (b.kind === 'ship') {
          const ship = ships.find((s) => s.id === b.id);
          if (ship !== undefined) {
            const p = toVec3(b.position);
            ship.visual.moveTo(p);
            if (recordTrail) ship.visual.pushTrail(p, trailSimTime);
          }
        } else if (b.kind === 'debris') {
          const d = debris.find((x) => x.id === b.id);
          if (d !== undefined) d.visual.moveTo(toVec3(b.position));
        }
      }
      // Anything missing from the frame was boundary-culled this sub-step.
      for (const s of ships) if (!seen.has(s.id)) s.visual.group.visible = false;
      if (idx < keyframes.length - 1) {
        requestAnimationFrame(step);
      } else {
        resolve(frame.slice());
      }
    };
    requestAnimationFrame(step);
  });
};

const onCommit = async () => {
  if (animating) return;
  animating = true;
  turnLabelEl.textContent = `TURN ${String(turnIdx).padStart(2, '0')} · RESOLVE`;
  // Hide all ghosts + exit markers — plans are locked and we're playing back.
  for (const s of ships) {
    s.visual.setGhost([], false);
    s.visual.setExit(false, null);
    s.visual.setTimeMarks([]); // planning overlay — gone during resolve playback
  }
  renderCommitState();

  // Resolve the beat as a CHAIN of per-waypoint sub-beats: each segment applies
  // that waypoint's burn, then `resolveMovement` advances `segDur` seconds (with
  // collisions/boundary), and its `finalBodies` seed the next segment — momentum
  // stays continuous. At interval Off this is a single dt=8 beat, identical to
  // the classic model.
  const segDur = segDurFor(markIntervalSec);
  const segCount = ships[0].segments.length;
  const segConfig: PhysicsConfig = { ...PHYSICS, dt: segDur };

  let bodies: Body[] = collectBodies();
  const keyframes: (readonly Body[])[] = [];
  const contacts: StepContact[] = [];
  for (let k = 0; k < segCount; k += 1) {
    const plans: MovementPlan[] = [];
    for (const s of ships) {
      const p = draftToPlan(s.id, s.segments[k]!);
      if (p !== null) plans.push(p);
    }
    const step = resolveMovement(bodies, plans, segConfig);
    // Skip the first frame of every segment after the first — it duplicates the
    // previous segment's final frame.
    const frames = k === 0 ? step.keyframes : step.keyframes.slice(1);
    for (const f of frames) keyframes.push(f);
    for (const c of step.contacts) contacts.push(c);
    bodies = [...step.finalBodies];
  }
  const final = await animateResolution(keyframes);

  // Adopt the resolved bodies FIRST. Ships keep their `WorldShip` wrappers;
  // only `body` swaps out. Debris survivors — carry forward; boundary-culled
  // shards have their visuals removed. Debris spawned by contact THIS beat
  // is added below — it never participated in this beat's sim, so filtering
  // it against `final` would incorrectly cull every new shard.
  const byId = new Map<BodyId, Body>();
  for (const b of final) byId.set(b.id, b);
  for (const s of ships) {
    const post = byId.get(s.id);
    if (post !== undefined && post.kind === 'ship') s.body = post;
  }
  const survivors: WorldDebris[] = [];
  for (const d of debris) {
    const post = byId.get(d.id);
    if (post !== undefined && post.kind === 'debris') {
      d.body = post;
      survivors.push(d);
    } else {
      scenery.scene.remove(d.visual.point);
      d.visual.dispose();
    }
  }
  debris.length = 0;
  debris.push(...survivors);

  // Spawn shard debris at each contact (collected across all sub-beats). Two
  // shards per contact, symmetric along the contact normal — the prototype's
  // stand-in for rules-layer wreckage (F4 owns the real spawn rules). Shard
  // velocity is a scaled contact-normal so the debris radiates outward.
  const shardSpeed = 40;
  for (const c of contacts) {
    const nPlus: Vec3 = {
      x: c.point.x + c.normal.x * 30,
      y: c.point.y + c.normal.y * 30,
      z: c.point.z + c.normal.z * 30,
    };
    const nMinus: Vec3 = {
      x: c.point.x - c.normal.x * 30,
      y: c.point.y - c.normal.y * 30,
      z: c.point.z - c.normal.z * 30,
    };
    const vPlus: Vec3 = {
      x: c.normal.x * shardSpeed,
      y: c.normal.y * shardSpeed,
      z: c.normal.z * shardSpeed,
    };
    const vMinus: Vec3 = { x: -vPlus.x, y: -vPlus.y, z: -vPlus.z };
    debris.push(spawnDebrisAt(nPlus, vPlus));
    debris.push(spawnDebrisAt(nMinus, vMinus));
  }

  // Reset every waypoint to coast for the next turn. Presets re-seed velocities
  // separately; this only zeroes the burns.
  for (const s of ships) for (const seg of s.segments) seg.magnitude = 0;

  turnIdx += 1;
  simClock += PHYSICS.dt;
  animating = false;

  debrisCountEl.textContent = String(debris.length);
  bodiesCountEl.textContent = String(ships.length + debris.length);
  turnLabelEl.textContent = `TURN ${String(turnIdx).padStart(2, '0')} · PLAN`;
  loadDraftIntoForm();
  refreshAllGhosts();
};

btnCommit.addEventListener('click', () => {
  void onCommit();
});

// -------- scripted scenarios (§7 fun-verdict probe) --------
//
// The Gate 1 exit question is *"is that turn fun?"* — the fun verdict can't be
// answered by clicking sliders into a happy accident. These presets seed a few
// known-interesting starting positions/velocities that make each verdict
// reproducible: a head-on collision, a graze (both ships close but do not
// collide), and a chase set-up where the trailing ship can catch shrapnel from
// the leader's contact-turn debris next beat.

const clearAllDebris = () => {
  for (const d of debris) {
    scenery.scene.remove(d.visual.point);
    d.visual.dispose();
  }
  debris.length = 0;
};

const teleport = (ship: WorldShip, position: Vec3, velocity: Vec3) => {
  ship.body = { ...ship.body, position, velocity };
  ship.visual.moveTo(toVec3(position));
  ship.visual.group.visible = true;
  ship.visual.clearTrail();
  const bearing = active(ship).bearing;
  ship.segments = Array.from({ length: segCountFor(markIntervalSec) }, () => makeCoast(bearing));
  ship.activeSeg = 0;
};

type PresetName = 'stationary' | 'headOn' | 'graze' | 'debrisRun';

const applyPreset = (name: PresetName) => {
  if (animating) return;
  clearAllDebris();
  turnIdx = 1;
  simClock = 0;
  if (name === 'stationary') {
    teleport(ships[0], INITIAL_POSITIONS[0], { x: 0, y: 0, z: 0 });
    teleport(ships[1], INITIAL_POSITIONS[1], { x: 0, y: 0, z: 0 });
    setSingleBurn(ships[0], 0, 0, 0);
    setSingleBurn(ships[1], 180, 0, 0);
  } else if (name === 'headOn') {
    teleport(ships[0], vec3Of(-1200, 0, 0), { x: 0, y: 0, z: 0 });
    teleport(ships[1], vec3Of(1200, 0, 0), { x: 0, y: 0, z: 0 });
    // Both burn toward one another at Δv=100 → 100 units/s velocity → over 8s
    // beats they close ~800 units per side → head-on contact by beat 2.
    setSingleBurn(ships[0], 0, 0, 100);
    setSingleBurn(ships[1], 180, 0, 100);
  } else if (name === 'graze') {
    teleport(ships[0], vec3Of(-1200, 0, -80), { x: 0, y: 0, z: 0 });
    teleport(ships[1], vec3Of(1200, 0, 80), { x: 0, y: 0, z: 0 });
    setSingleBurn(ships[0], 0, 0, 120);
    setSingleBurn(ships[1], 180, 0, 120);
  } else {
    // Chase — cyan trails magenta at a fair speed; commit two beats with a
    // straight burn to catch up + collide, then next turn debris carries into
    // wherever magenta drifts. Fires the "debris hits ship next turn" clause.
    teleport(ships[0], vec3Of(-400, 0, 0), { x: 60, y: 0, z: 0 });
    teleport(ships[1], vec3Of(400, 0, 0), { x: 40, y: 0, z: 0 });
    setSingleBurn(ships[0], 0, 0, 90);
    setSingleBurn(ships[1], 0, 0, 0);
  }
  debrisCountEl.textContent = String(debris.length);
  bodiesCountEl.textContent = String(ships.length + debris.length);
  turnLabelEl.textContent = `TURN 01 · PLAN`;
  loadDraftIntoForm();
  refreshAllGhosts();
};

presetSelect.addEventListener('change', () => {
  applyPreset(presetSelect.value as PresetName);
});

// Waypoint granularity selector (was "time-mark interval") — 0 (Off, single
// burn) / 1 / 2 / 4 s. Changing it re-segments both ships' plans (burns are
// preserved by index) and re-plots live.
marksInterval.addEventListener('change', () => {
  markIntervalSec = Number(marksInterval.value);
  for (const s of ships) rebuildSegments(s);
  loadDraftIntoForm();
  refreshAllGhosts();
});

// -------- marker-density stress toggle (§7.4 probe) --------

stressBtn.addEventListener('click', () => {
  const isOn = stressBtn.getAttribute('aria-pressed') === 'true';
  if (isOn) {
    scenery.clearStressHazards();
    stressBtn.setAttribute('aria-pressed', 'false');
    stressBtn.classList.remove('is-active');
    stressBtn.textContent = '+ 60 hazards';
  } else {
    scenery.addStressHazards(60, ARENA_RADIUS);
    stressBtn.setAttribute('aria-pressed', 'true');
    stressBtn.classList.add('is-active');
    stressBtn.textContent = '− 60 hazards';
  }
  // The stress hazards are prototype-scale legibility probes only — they are
  // NOT `Body`s in the sim, so `debris`/`bodies` counters do not change.
});

// -------- keyboard shortcuts --------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'r' || e.key === 'R') {
    cam.resetToFleet();
  } else if (e.key === 'f' || e.key === 'F') {
    const p = ships[selectedFleet].body.position;
    cam.focus(new Vector3(p.x, p.y, p.z));
  } else if (e.key === '1') {
    setSelectedFleet(0);
  } else if (e.key === '2') {
    setSelectedFleet(1);
  }
});

// -------- resize --------

const onResize = () => {
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  renderer.setSize(w, h, false);
  cam.resize(w, h);
};
window.addEventListener('resize', onResize);

// -------- animation loop --------

const loop = () => {
  cam.update();
  renderer.render(scenery.scene, cam.camera);
  requestAnimationFrame(loop);
};

// Initial paint: select cyan ship, load its active waypoint into the form, prime
// both ships' ghost paths (both start at coast so the "ghost" is a short straight
// stub — but the pipeline is live from frame one).
setSelectedFleet(0);
refreshAllGhosts();
loop();

// Prototype-console handle used during findings capture. NOT a public API.
declare global {
  interface Window {
    __gate1?: {
      readonly renderer: WebGLRenderer;
      readonly camera: CameraHandle;
    };
  }
}
window.__gate1 = { renderer, camera: cam };
