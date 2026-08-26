// momentum — elastic-ish impulse exchange along the line of centers (architecture
// §7.4). Given two spheres in contact (positions at TOI, pre-collision velocities,
// masses, radii) plus restitution `e` and damage coefficient `k`, return post-
// collision velocities, contact geometry, and the collision-damage magnitude.
//
// Physics computes damage as a magnitude; the sim/rules module (later feature) is
// what applies it to hull/shields. Keeping the value here means the geometric truth
// lives once, in the place that already knows the impulse.
//
// Impulse (1D along the contact normal):
//   n         = normalize(pA − pB)               // unit vector from B toward A
//   vRelN     = dot(vA − vB, n)                  // < 0 when approaching along n
//   j         = −(1 + e) · vRelN / (1/mA + 1/mB) // scalar impulse magnitude
//   vA'       = vA + (j / mA) · n
//   vB'       = vB − (j / mB) · n
//   damage    = k · reducedMass · vRelN²         (reducedMass = mA·mB / (mA + mB))
//
// Everything reduces to `+ − · /` and `Math.sqrt` (via `normalize`), so the result is
// bit-identical across engines.

import type { Vec3 } from '../mathx/index.js';
import { UNIT_X, add, dot, lengthSq, normalize, scale, sub } from '../mathx/index.js';

export interface CollisionResolve {
  readonly newVelA: Vec3;
  readonly newVelB: Vec3;
  /** Unit normal from B toward A at contact. */
  readonly normal: Vec3;
  /** World-space contact point, on the line of centers between the two spheres. */
  readonly point: Vec3;
  /** Magnitude of pre-collision closing speed along the normal (≥ 0). Zero when the
   *  bodies were grazing/separating at contact — no impulse is applied then. */
  readonly relSpeedNormal: number;
  /** Collision damage magnitude — `k · reducedMass · relSpeedNormal²` (≥ 0). Rules
   *  layer decides how to apply this to shields/hull; physics only reports the value. */
  readonly damage: number;
  /** True when the collision was actually resolved (bodies were approaching). When
   *  false, `newVelA`/`newVelB` equal the inputs and `damage`/`relSpeedNormal` are 0. */
  readonly applied: boolean;
}

/**
 * Resolve one sphere-sphere collision.
 *
 * @param pA position of A at TOI      (post-swept-advance)
 * @param vA velocity of A pre-collision
 * @param mA mass of A (> 0)
 * @param rA radius of A (> 0)
 * @param pB position of B at TOI
 * @param vB velocity of B pre-collision
 * @param mB mass of B (> 0)
 * @param rB radius of B (> 0)
 * @param restitution coefficient in [0, 1] — 0 = perfectly inelastic, 1 = elastic
 * @param damageCoefficient the `k` in `k · reducedMass · vRelN²`
 */
export const resolveCollision = (
  pA: Vec3,
  vA: Vec3,
  mA: number,
  rA: number,
  pB: Vec3,
  vB: Vec3,
  mB: number,
  rB: number,
  restitution: number,
  damageCoefficient: number,
): CollisionResolve => {
  const diff = sub(pA, pB);
  // If pA === pB exactly (numerically degenerate — should not happen in a well-formed
  // scene, but sim never crashes: fall back to +X). normalize() also returns ZERO for
  // a zero-length vector, so guard explicitly.
  const normal = lengthSq(diff) > 0 ? normalize(diff) : UNIT_X;
  // Contact point on the line of centers, weighted by radius. Equivalent to
  // `pA − normal · rA` — matches when surfaces are tangent (|pA − pB| = rA + rB).
  const point = add(pB, scale(normal, rB));

  const relVel = sub(vA, vB);
  const vRelN = dot(relVel, normal);

  if (vRelN >= 0) {
    // Grazing or separating — no impulse, no damage.
    return {
      newVelA: vA,
      newVelB: vB,
      normal,
      point,
      relSpeedNormal: 0,
      damage: 0,
      applied: false,
    };
  }

  const invMassSum = 1 / mA + 1 / mB;
  const jScalar = (-(1 + restitution) * vRelN) / invMassSum;
  const newVelA = add(vA, scale(normal, jScalar / mA));
  const newVelB = sub(vB, scale(normal, jScalar / mB));

  const reducedMass = (mA * mB) / (mA + mB);
  const absRelSpeed = -vRelN; // vRelN < 0 here, so absRelSpeed > 0
  const damage = damageCoefficient * reducedMass * absRelSpeed * absRelSpeed;

  return {
    newVelA,
    newVelB,
    normal,
    point,
    relSpeedNormal: absRelSpeed,
    damage,
    applied: true,
  };
};
