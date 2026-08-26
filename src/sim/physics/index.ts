// Public surface of src/sim/physics/ — deterministic movement resolution (M06).
//
// Physics is the second leaf inside `src/sim/`. Its dependency list is exactly:
//   - `src/sim/mathx/**` (vec3, deterministic trig, counter-RNG) — the leaf below it
//   - `src/sim/types.ts` (shared Body / MovementPlan / Arena)
// Nothing else. Boundary-lint enforces this at the module boundary.

export type { PhysicsConfig } from './config.js';
export { subStepCount, integrateBody, applyPlan } from './integrate.js';
export { broadphase, type Pair } from './broadphase.js';
export { sweepSphereSphere, type SweepHit } from './sweep.js';
export { resolveCollision, type CollisionResolve } from './momentum.js';
export {
  isOutsideArena,
  classifyExit,
  type BoundaryExit,
  type BoundaryExitKind,
} from './boundary.js';
export { previewPath, type PreviewPath } from './previewPath.js';
export { resolveMovement, type StepContact, type StepResult } from './resolveMovement.js';
