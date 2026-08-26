// Public surface of src/sim/physics/ — deterministic movement resolution (M06).
//
// Physics is the second leaf inside `src/sim/`. Its dependency list is exactly:
//   - `src/sim/mathx/**` (vec3, deterministic trig, counter-RNG) — the leaf below it
//   - `src/sim/types.ts` (shared Body / MovementPlan / Arena)
// Nothing else. Boundary-lint enforces this at the module boundary.

export type { PhysicsConfig } from './config.js';
export { subStepCount, integrateBody, applyPlan } from './integrate.js';
export { broadphase, type Pair } from './broadphase.js';
