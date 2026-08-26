// Public surface of `src/sim/mathx/` — the deterministic-math leaf of the sim tree.
// Everything below this line is `+ - * /` (+ `Math.sqrt`, + `Math.trunc`, + `Math.imul`)
// arithmetic only; no transcendentals, no wall-clock, no npm.

export type { Vec3 } from './vec3.js';
export {
  ZERO,
  UNIT_X,
  UNIT_Y,
  UNIT_Z,
  of,
  add,
  sub,
  scale,
  neg,
  dot,
  cross,
  lengthSq,
  length,
  normalize,
  lerp,
  distance,
  distanceSq,
  clampLength,
  equals,
} from './vec3.js';

export {
  PI,
  TAU,
  HALF_PI,
  QUARTER_PI,
  DEG_TO_RAD,
  RAD_TO_DEG,
  sin,
  cos,
  atan2,
  powi,
  powHalf,
  dirFromBearingPitch,
} from './trig.js';

export type { Seed } from './rng.js';
export { seedOf, hash, rand01, randRange, randInt } from './rng.js';
