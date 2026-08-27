// Public surface of src/sim/physics/ — deterministic movement resolution (M06).
//
// Physics is the second leaf inside `src/sim/`. Its dependency list is exactly:
//   - `src/sim/mathx/**` (vec3, deterministic trig, counter-RNG) — the leaf below it
//   - `src/sim/types.ts` (shared Body / MovementPlan / Arena)
// Nothing else. Boundary-lint enforces this at the module boundary.

export type { PhysicsConfig } from './config.js';
export { subStepCount, integrateBody, applyPlan, applyThrust } from './integrate.js';
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
// Finite-thrust movement (feature `finite-thrust-movement`, SESSION-01). The
// schedule + peak-speed helper live in `thrust.ts`; `WaypointBurn` is the plan-
// shape primitive downstream sessions (S02-loop, S03-ai, S04-controller,
// S05-UI) construct and route through. `MovementPlan.segments` (declared in
// `src/sim/types.ts`) is the optional switch that opts a plan into the
// finite-thrust code path (D-ADDITIVE-PLAN).
export { thrustSchedule, peakSpeedSq } from './thrust.js';
export type { WaypointBurn } from '../types.js';
