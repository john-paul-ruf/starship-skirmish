// tunneling — the FR-19/FR-22 regression that swept CCD must catch.
//
// Two ships at high closing speed with hull radius 1 must register a contact even
// when the sub-step count clamps to `subStepMax` and per-sub-step relative
// displacement exceeds the sum of radii — the case where naive endpoint-only
// detection SILENTLY misses the collision (that is the defect this test guards).

import { describe, it, expect } from 'vitest';
import { resolveMovement } from '../../../src/sim/physics/resolveMovement.js';
import { subStepCount } from '../../../src/sim/physics/integrate.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Body } from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/config.js';

const config: PhysicsConfig = {
  dt: 0.1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 10_000 },
};

const ship = (id: number, x: number, vx: number): Body => ({
  kind: 'ship',
  id,
  position: of(x, 0, 0),
  velocity: of(vx, 0, 0),
  mass: 1,
  radius: 1,
});

describe('tunneling regression (FR-19, FR-22)', () => {
  // Scenario: A and B closing head-on at 4000 units/sec relative speed. Radii 1 each,
  // sum = 2. With dt=0.1s the naive N = ceil(4000·0.1 / (1·0.5)) = 800 → clamped to 64.
  // Per-sub-step relative displacement = 4000·(0.1/64) = 6.25 units — over 3× the
  // sum-of-radii, so endpoint-only detection can (and does, with the geometry below)
  // skip right over the contact.
  //
  // Positions chosen so coincidence happens partway through a sub-step, NOT on a
  // boundary: coincidence at t = 0.05075s = 32.48·subDt (subDt = 0.1/64 = 0.0015625).
  //
  // A: start -101, vel +2000 → end +99;   at sub-step 32 (t=0.05):   pos -1
  // B: start +102, vel -2000 → end -98;   at sub-step 32 (t=0.05):   pos +2
  //   distance at sub-step 32 boundary = 3 > 2 → NAIVE ENDPOINT SEES NO CONTACT.
  // A: at sub-step 33 (t=0.0515625): pos +2.125
  // B: at sub-step 33 (t=0.0515625): pos -1.125
  //   distance at sub-step 33 boundary = 3.25 > 2 → NAIVE ENDPOINT SEES NO CONTACT.

  it('sub-step count clamps to subStepMax for this scene', () => {
    // Max |v| = 2000. maxRelSpeed = 2·2000 = 4000 (upper bound used by resolveMovement).
    // N = ceil(4000·0.1 / 0.5) = 800 → clamp to 64.
    expect(subStepCount(4000, 0.1, 1, 4, 64)).toBe(64);
  });

  it('per-sub-step endpoint distances stay > sum-of-radii near the crossing (proving endpoint-only misses)', () => {
    const subDt = config.dt / 64;
    const gapAt = (k: number): number => {
      const ax = -101 + 2000 * k * subDt;
      const bx = 102 - 2000 * k * subDt;
      return Math.abs(bx - ax);
    };
    // 2·radius = 2 is the contact threshold. The two sub-steps that BRACKET the true
    // crossing both leave the endpoint distance strictly above the threshold.
    expect(gapAt(32)).toBeCloseTo(3, 10);
    expect(gapAt(33)).toBeCloseTo(3.25, 10);
    for (let k = 0; k <= 64; k += 1) {
      expect(gapAt(k)).toBeGreaterThan(2);
    }
  });

  it('resolveMovement DOES detect the contact (swept CCD is doing its job)', () => {
    const result = resolveMovement([ship(1, -101, 2000), ship(2, 102, -2000)], [], config);
    expect(result.subStepCount).toBe(64);
    expect(result.contacts.length).toBeGreaterThanOrEqual(1);
    // The first contact must be the (1, 2) pair — nothing else exists in the scene.
    expect(result.contacts[0]!.idA).toBe(1);
    expect(result.contacts[0]!.idB).toBe(2);
    // And it must fall in the sub-step that brackets the true crossing (τ ≈ 0.0503125s).
    // subDt = 1/640s. Crossing at k = 32.48 → sub-step index 32.
    expect(result.contacts[0]!.subStep).toBe(32);
    expect(result.contacts[0]!.toi).toBeGreaterThan(0);
    expect(result.contacts[0]!.toi).toBeLessThan(1);
  });
});
