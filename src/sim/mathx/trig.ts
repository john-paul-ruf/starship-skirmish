// trig — deterministic transcendentals, arithmetic-only (architecture §7.1).
//
// The JS engines legitimately disagree on Math.sin/cos/tan/atan2/pow past ~ULP boundaries,
// so those are ban-listed inside src/sim. This file replaces them with fixed-degree
// polynomial approximations built from IEEE-exact ops only: `+ - * /` plus `Math.sqrt`
// (which IS specified). Range reduction uses `Math.trunc`, which is bit-exact.
//
// Accuracy bounds (verified in tests/unit/mathx/trig.test.ts):
//   sin, cos   max |error| < 1e-9 across the sampled domain [-4π, 4π]
//   atan2      max |error| < 1e-6 across a 200×200 grid on [-4, 4]²
//   powi       exact for integer exponents (repeated multiplication)
//   powHalf    exact for integer part × sqrt (single sqrt call)
//
// LIMITATIONS
//   * Range reduction via `x - TAU * round(x / TAU)` degrades for |x| >> 1e8
//     (Cody-Waite-style multi-part reduction is not implemented). The sim's angles
//     are bearings/pitches in [-360°, 360°] → radians in [-4π, 4π], well inside safe range.
//   * Signed-zero identities of Math.atan2 (e.g. atan2(-0, -1) === -π) are NOT preserved;
//     the sim does not use signed zeros as directional data. Callers that need it should
//     canonicalize inputs.

import type { Vec3 } from './vec3.js';

// Angle constants — all `+ - * /` derivable from these primitives.
export const PI = 3.141592653589793;
export const TAU = 6.283185307179586; // 2π
export const HALF_PI = 1.5707963267948966; // π/2
export const QUARTER_PI = 0.7853981633974483; // π/4

export const DEG_TO_RAD = TAU / 360;
export const RAD_TO_DEG = 360 / TAU;

const INV_TAU = 1 / TAU;

// sqrt(2) - 1 = tan(π/8). Threshold for the atan half-angle reduction below.
const TAN_PI_8 = 0.4142135623730951;

/** Round-to-nearest-integer, implemented via `Math.trunc` (IEEE-exact) plus a bias. */
const roundNearest = (v: number): number =>
  v >= 0 ? Math.trunc(v + 0.5) : Math.trunc(v - 0.5);

/**
 * Sin polynomial valid for x in [-π/2, π/2] — degree-15 Taylor series (Horner form).
 * Alternating-series bound at |x| = π/2 is |(π/2)^17 / 17!| ≈ 9e-12; that leaves
 * sin² + cos² identities inside 2 × ULP-scale headroom for the ≤ 1e-9 sim tolerance.
 */
const sinKernel = (x: number): number => {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
};

/** sin(x) for any real x — deterministic across engines by construction. */
export const sin = (x: number): number => {
  // Reduce to r in [-π, π] via r = x - TAU * round(x / TAU).
  const r = x - TAU * roundNearest(x * INV_TAU);
  // Fold to r' in [-π/2, π/2] using sin(π - r) = sin(r) and sin(-π - r) = sin(r).
  if (r > HALF_PI) return sinKernel(PI - r);
  if (r < -HALF_PI) return sinKernel(-PI - r);
  return sinKernel(r);
};

/** cos(x) via the co-function identity cos(x) = sin(π/2 - x). */
export const cos = (x: number): number => sin(HALF_PI - x);

/**
 * atan on the *reduced* interval [-tan(π/8), tan(π/8)] ≈ [-0.414, 0.414].
 * Degree-11 Taylor; alternating-series bound gives max |error| ≈ 8e-7 at the endpoints.
 */
const atanKernel = (x: number): number => {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 3 +
          x2 * (1 / 5 + x2 * (-1 / 7 + x2 * (1 / 9 + x2 * (-1 / 11))))))
  );
};

/**
 * atan for t in [0, 1]. For t > tan(π/8) we shift via the half-angle identity
 * atan(t) = π/4 + atan((t - 1) / (t + 1)), which brings the argument back into
 * [-tan(π/8), 0] so the kernel error bound applies.
 */
const atanUnit = (t: number): number => {
  if (t > TAN_PI_8) {
    const u = (t - 1) / (t + 1);
    return QUARTER_PI + atanKernel(u);
  }
  return atanKernel(t);
};

/**
 * atan2(y, x): angle in radians from the positive x-axis to (x, y), range (-π, π].
 * Octant-reduced so the kernel only sees |t| ≤ 1.
 */
export const atan2 = (y: number, x: number): number => {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  // Magnitude of angle from the positive x-axis, in [0, π].
  let a: number;
  if (ax >= ay) {
    a = atanUnit(ay / ax); // [0, π/4]
  } else {
    a = HALF_PI - atanUnit(ax / ay); // [π/4, π/2]
  }
  if (x < 0) a = PI - a; // reflect into [π/2, π]
  return y < 0 ? -a : a;
};

/**
 * Integer power via binary exponentiation. `exp` is coerced to a 32-bit integer;
 * negative exponents return `1 / powi(base, -exp)`. Uses `+ - * /` only.
 */
export const powi = (base: number, exp: number): number => {
  const e0 = exp | 0;
  if (e0 < 0) return 1 / powi(base, -e0);
  let result = 1;
  let b = base;
  let e = e0;
  while (e > 0) {
    if ((e & 1) === 1) result = result * b;
    e = e >>> 1;
    if (e > 0) b = b * b;
  }
  return result;
};

/**
 * Half-integer power: base^(halves / 2). E.g. `powHalf(x, 3)` = x · √x.
 * Composed from `powi` and a single `Math.sqrt` — never `Math.pow`.
 * `halves` is coerced to a 32-bit integer; negatives take the reciprocal.
 */
export const powHalf = (base: number, halves: number): number => {
  const h = halves | 0;
  if (h < 0) return 1 / powHalf(base, -h);
  const intPart = h >> 1;
  const hasHalfBit = (h & 1) === 1;
  const p = powi(base, intPart);
  return hasHalfBit ? p * Math.sqrt(base) : p;
};

/**
 * Convert an aim expressed as bearing (horizontal, degrees) and pitch (elevation, degrees)
 * to a unit direction vector — needed for arc plotting (FR-18) and firing-arc math.
 *
 * Convention (Y-up, right-handed):
 *   bearing = 0°, pitch = 0° → +X
 *   bearing = +90° → +Z         (right when looking along +Y)
 *   pitch   = +90° → +Y         (up)
 * Downstream physics/render pins its own axis basis; this is just a stable mapping.
 */
export const dirFromBearingPitch = (bearingDeg: number, pitchDeg: number): Vec3 => {
  const b = bearingDeg * DEG_TO_RAD;
  const p = pitchDeg * DEG_TO_RAD;
  const cb = cos(b);
  const sb = sin(b);
  const cp = cos(p);
  const sp = sin(p);
  return { x: cp * cb, y: sp, z: cp * sb };
};
