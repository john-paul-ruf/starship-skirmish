// Gate 1 prototype bootstrap (M18, disposable — FR-32).
//
// Wires the scene, camera, and turn loop. Consumes the REAL deterministic sim
// from `../../src/sim/**` — do NOT reimplement anything from there, and do NOT
// modify anything under `src/` from this file (session lease is prototypes/gate1
// only). If a piece of physics behavior seems wrong for the game, it belongs in
// FINDINGS.md as a tuning note, not a code patch here.
//
// CHECKPOINT 1 STATE (this file):
//   * WebGLRenderer mounts into #canvas-mount.
//   * Scenery: boundary shell + inner haze + ground grid + origin axes.
//   * Two wireframe ships at fleet positions (cyan/magenta).
//   * Free orbit/pan/zoom camera; `R` resets to fleet view; `F` focuses selected ship.
//   * Animation loop draws at rAF cadence.
//
// Arc plotting + turn resolution land in Checkpoints 2 and 3 respectively; the
// scene shell above is what those checkpoints attach to.

import { Vector3, WebGLRenderer } from 'three';

import { of as vec3Of, type Vec3 } from '../../src/sim/mathx/index.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import type { BodyId, ShipBody } from '../../src/sim/types.js';

import { mountCamera, type CameraHandle } from './camera.js';
import { buildScene, type FleetIdx, type ShipVisual } from './scene.js';

// -------- config --------

const ARENA_RADIUS = 2000;
const SHIP_RADIUS = 60;
const SHIP_MASS = 100;

const PHYSICS: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
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

// -------- world model (prototype-local) --------

interface WorldShip {
  readonly id: BodyId;
  readonly fleet: FleetIdx;
  body: ShipBody;
  visual: ShipVisual;
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
  return { id, fleet, body, visual };
};

const ships: [WorldShip, WorldShip] = [
  makeShip(0, INITIAL_POSITIONS[0]),
  makeShip(1, INITIAL_POSITIONS[1]),
];

// Reference the config so the unused-var linter (in case this file is ever
// added to a stricter tsconfig) does not flag it. Physics is consumed by later
// checkpoints; we import + hold it here so the shape of the boot survives.
void PHYSICS;

// -------- top-bar HUD wiring (Checkpoint 1: status counters + turn label) --------

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
turnLabelEl.textContent = 'TURN 01 · SCENE ONLINE';

// -------- keyboard shortcuts --------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'r' || e.key === 'R') {
    cam.resetToFleet();
  } else if (e.key === 'f' || e.key === 'F') {
    const p = ships[0].body.position;
    cam.focus(new Vector3(p.x, p.y, p.z));
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
