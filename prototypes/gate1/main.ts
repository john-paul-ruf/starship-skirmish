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
// CHECKPOINT 2 STATE (this iteration):
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
// Turn resolution and debris persistence land in Checkpoint 3.

import { Vector3, WebGLRenderer } from 'three';

import { of as vec3Of, type Vec3 } from '../../src/sim/mathx/index.js';
import { dirFromBearingPitch } from '../../src/sim/mathx/index.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import { previewPath } from '../../src/sim/physics/index.js';
import type { BodyId, MovementPlan, ShipBody } from '../../src/sim/types.js';

import { mountCamera, type CameraHandle } from './camera.js';
import { buildScene, type FleetIdx, type ShipVisual } from './scene.js';

// -------- config --------

const ARENA_RADIUS = 2000;
const SHIP_RADIUS = 60;
const SHIP_MASS = 100;
/** Δv budget per ship per turn — the "engine cap" the plan UI clamps against. */
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

/** A prospective plan the player is editing but has not yet committed. */
interface PlanDraft {
  bearing: number;
  pitch: number;
  magnitude: number;
}

/** Clamp magnitude to the Δv budget — the enforcement point the CP2 spec locks. */
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

// -------- world model (prototype-local) --------

interface WorldShip {
  readonly id: BodyId;
  readonly fleet: FleetIdx;
  body: ShipBody;
  visual: ShipVisual;
  draft: PlanDraft;
}

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
  // Default draft aims each ship away from the origin: cyan (leftmost) points
  // +X, magenta (rightmost) points −X. Neither has spent Δv yet.
  const bearing = fleet === 0 ? 0 : 180;
  return { id, fleet, body, visual, draft: { bearing, pitch: 0, magnitude: 0 } };
};

const ships: [WorldShip, WorldShip] = [
  makeShip(0, INITIAL_POSITIONS[0]),
  makeShip(1, INITIAL_POSITIONS[1]),
];

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
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#hud-plan .tabs button'));

// Cap the magnitude slider at the enforced budget so the DOM cannot present an
// input that violates the cap. Match the number-input caps for the same reason.
dvMag.max = String(MAX_DV_PER_TURN);
dvBudget.max = String(MAX_DV_PER_TURN);

let selectedFleet: FleetIdx = 0;

/**
 * Redraw a ship's ghost predicted path from its current draft. This is the
 * "same integrator as resolution" seam — we do NOT sample motion here, we
 * call `previewPath()`. Session brief: "⚠ do NOT write a separate integrator
 * in gate1; that silently breaks the tested 'preview vs resolution' invariant."
 */
const refreshGhost = (ship: WorldShip) => {
  const plan = draftToPlan(ship.id, ship.draft);
  const path = previewPath(ship.body, plan, PHYSICS);
  const positions = path.positions.map(toVec3);
  ship.visual.setGhost(positions, path.endsOutsideArena);
  if (path.endsOutsideArena && positions.length > 0) {
    ship.visual.setExit(true, positions[positions.length - 1]!);
  } else {
    ship.visual.setExit(false, null);
  }
};

const refreshAllGhosts = () => {
  for (const s of ships) refreshGhost(s);
};

/**
 * Update the status line under the form to reflect the current draft and
 * whether the ghost will crash. Three channels per design §4.1: the color of
 * the ghost + the ✕ EXIT sprite in-scene + this text line.
 */
const renderStatusText = () => {
  const s = ships[selectedFleet];
  const plan = draftToPlan(s.id, s.draft);
  const path = previewPath(s.body, plan, PHYSICS);
  if (s.draft.magnitude <= 0) {
    planStatus.classList.remove('is-hostile');
    planStatus.textContent = 'Coast — no thrust plotted. Δv = 0.';
  } else if (path.endsOutsideArena) {
    planStatus.classList.add('is-hostile');
    planStatus.textContent =
      `✕ Predicted exit — arc leaves the arena. Δv ${s.draft.magnitude} / brg ${s.draft.bearing}° / pitch ${s.draft.pitch}°.`;
  } else {
    planStatus.classList.remove('is-hostile');
    planStatus.textContent =
      `Planned — Δv ${s.draft.magnitude} / brg ${s.draft.bearing}° / pitch ${s.draft.pitch}°.`;
  }
};

const loadDraftIntoForm = () => {
  const s = ships[selectedFleet];
  const mag = clampMag(s.draft.magnitude);
  dvMag.value = String(mag);
  dvMagOut.textContent = String(mag);
  dvBearing.value = String(s.draft.bearing);
  dvPitch.value = String(s.draft.pitch);
  dvBudget.value = String(mag);
  dvRemaining.textContent = String(MAX_DV_PER_TURN - mag);
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

dvMag.addEventListener('input', () => {
  const s = ships[selectedFleet];
  s.draft.magnitude = clampMag(Number(dvMag.value));
  // Reflect the clamped value back into the slider — if a `value` outside
  // [0, MAX] is ever pushed programmatically we do not want it to render.
  dvMag.value = String(s.draft.magnitude);
  dvMagOut.textContent = String(s.draft.magnitude);
  dvBudget.value = String(s.draft.magnitude);
  dvRemaining.textContent = String(MAX_DV_PER_TURN - s.draft.magnitude);
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
    const bearing = Number(dvBearing.value);
    const pitch = clampPitch(Number(dvPitch.value));
    if (Number.isFinite(bearing)) s.draft.bearing = bearing;
    s.draft.pitch = pitch;
    refreshGhost(s);
    renderStatusText();
  });
}

btnCoast.addEventListener('click', () => {
  const s = ships[selectedFleet];
  s.draft.magnitude = 0;
  loadDraftIntoForm();
  refreshGhost(s);
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

// Initial paint: select cyan ship, load its draft into the form, prime both
// ships' ghost paths (both start at coast so the "ghost" is a short straight
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
