// sweep — continuous swept sphere-sphere collision detection (architecture §7.4).
//
// Given two spheres A and B, each moving linearly from `p` to `p + d` over one sub-step
// (parametrize with τ ∈ [0, 1]), solve for the earliest τ at which their surfaces touch:
//
//   p = pA − pB          (initial separation)
//   d = dA − dB          (relative displacement across the sub-step)
//   R = rA + rB          (contact distance)
//   |p + τ·d|² = R²
//   ⇒  |d|² τ² + 2(p·d) τ + (|p|² − R²) = 0
//
// Return the smallest τ ∈ [0, 1], or `null` if the spheres do not touch this sub-step.
// Deterministic by construction — every operation is `+ − · /` or `Math.sqrt` (both
// exactly specified by IEEE-754 and permitted in `src/sim/**` per §7.1).

import type { Vec3 } from '../mathx/index.js';
import { dot, lengthSq, sub } from '../mathx/index.js';

export interface SweepHit {
  /** Sub-step-local time of first surface contact, τ ∈ [0, 1]. */
  readonly toi: number;
}

/**
 * Time-of-impact of the first surface contact between two spheres over one sub-step.
 *
 * @param pA start position of sphere A
 * @param dA displacement A traverses during this sub-step (= velocity · subDt)
 * @param rA radius of A
 * @param pB start position of sphere B
 * @param dB displacement of B
 * @param rB radius of B
 * @returns a `SweepHit` with τ ∈ [0, 1], or `null` if no contact this sub-step
 */
export const sweepSphereSphere = (
  pA: Vec3,
  dA: Vec3,
  rA: number,
  pB: Vec3,
  dB: Vec3,
  rB: number,
): SweepHit | null => {
  const p = sub(pA, pB);
  const d = sub(dA, dB);
  const R = rA + rB;
  const RSq = R * R;
  const pSq = lengthSq(p);

  // Already overlapping at τ = 0. Report entry now — the narrowphase caller (momentum)
  // then applies the impulse immediately, which is the correct answer for penetration.
  if (pSq <= RSq) return { toi: 0 };

  const A_coef = lengthSq(d);
  // No relative motion: separation stays at √pSq > R for the whole sub-step.
  if (A_coef === 0) return null;

  const B_coef = 2 * dot(p, d);
  const C_coef = pSq - RSq;
  const disc = B_coef * B_coef - 4 * A_coef * C_coef;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  // Take the ENTRY root: t1 = (−B − √disc) / (2A). Since |p| > R and A > 0, t1 is the
  // moment the surfaces first touch (t2 is the later separation). Because pSq > RSq,
  // the two roots have the same sign — either both in the past (moving away) or both
  // in the future (approaching). We only care about t1 being in [0, 1].
  const t1 = (-B_coef - sqrtDisc) / (2 * A_coef);
  if (t1 < 0 || t1 > 1) return null;
  return { toi: t1 };
};
