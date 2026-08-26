// momentum — impulse math and damage magnitude at contact.

import { describe, it, expect } from 'vitest';
import { resolveCollision } from '../../../src/sim/physics/momentum.js';
import { of } from '../../../src/sim/mathx/vec3.js';

const K = 0.0012; // catalog/tuning.json: collision.damageCoefficient

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

describe('resolveCollision — geometry', () => {
  it('computes a unit normal from B toward A', () => {
    // A at (+1,0,0) touching B at (0,0,0), radii 0.5+0.5=1.
    const r = resolveCollision(
      of(1, 0, 0), of(0, 0, 0), 1, 0.5,
      of(0, 0, 0), of(0, 0, 0), 1, 0.5,
      0.15, K,
    );
    expect(r.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('places the contact point at pB + normal · rB', () => {
    // Radii 2 (A) and 1 (B); |pA − pB| = 3 (tangent).
    const r = resolveCollision(
      of(3, 0, 0), of(0, 0, 0), 1, 2,
      of(0, 0, 0), of(0, 0, 0), 1, 1,
      0.15, K,
    );
    expect(r.point).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('falls back to a stable normal when centers coincide (degenerate)', () => {
    const r = resolveCollision(
      of(0, 0, 0), of(0, 0, 0), 1, 1,
      of(0, 0, 0), of(0, 0, 0), 1, 1,
      0.15, K,
    );
    // With coincident centers and zero relative velocity, no impulse — but the
    // module must still return a unit normal and not NaN out.
    expect(r.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(r.applied).toBe(false);
  });
});

describe('resolveCollision — separation & grazing', () => {
  it('returns applied=false when bodies are already moving apart', () => {
    const r = resolveCollision(
      of(1, 0, 0), of(1, 0, 0), 1, 0.5,
      of(0, 0, 0), of(-1, 0, 0), 1, 0.5,
      0.15, K,
    );
    expect(r.applied).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.newVelA).toEqual({ x: 1, y: 0, z: 0 });
    expect(r.newVelB).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('returns applied=false when velocities are purely tangential (no normal component)', () => {
    // A moving +y, B moving −y along a shared line perpendicular to the contact normal (x).
    const r = resolveCollision(
      of(1, 0, 0), of(0, 5, 0), 1, 0.5,
      of(0, 0, 0), of(0, -5, 0), 1, 0.5,
      0.15, K,
    );
    expect(r.applied).toBe(false);
  });
});

describe('resolveCollision — impulse & conservation', () => {
  it('perfectly elastic (e=1), equal masses head-on: velocities swap', () => {
    const r = resolveCollision(
      of(1, 0, 0), of(-2, 0, 0), 1, 0.5,
      of(0, 0, 0), of(+3, 0, 0), 1, 0.5,
      1, K,
    );
    expect(r.applied).toBe(true);
    expect(r.newVelA).toEqual({ x: 3, y: 0, z: 0 });
    expect(r.newVelB).toEqual({ x: -2, y: 0, z: 0 });
  });

  it('inelastic (e=0), equal masses head-on: velocities meet at their average', () => {
    const r = resolveCollision(
      of(1, 0, 0), of(-4, 0, 0), 1, 0.5,
      of(0, 0, 0), of(+2, 0, 0), 1, 0.5,
      0, K,
    );
    // Both end with the same normal-component velocity = average = -1.
    expect(near(r.newVelA.x, -1)).toBe(true);
    expect(near(r.newVelB.x, -1)).toBe(true);
  });

  it('conserves linear momentum (any restitution, any mass ratio)', () => {
    for (const e of [0, 0.15, 0.5, 1]) {
      for (const [mA, mB] of [[1, 1], [1, 3], [7, 2]] as const) {
        const r = resolveCollision(
          of(1, 0, 0), of(-2, 0.5, -0.3), mA, 0.5,
          of(0, 0, 0), of(+3, -0.2, 0.1), mB, 0.5,
          e, K,
        );
        // p_total_x = mA · vA.x + mB · vB.x, before and after
        const pBeforeX = mA * -2 + mB * 3;
        const pAfterX = mA * r.newVelA.x + mB * r.newVelB.x;
        expect(near(pBeforeX, pAfterX, 1e-10)).toBe(true);
        // y and z components are tangential in this setup, must be unchanged
        expect(r.newVelA.y).toBe(0.5);
        expect(r.newVelA.z).toBe(-0.3);
      }
    }
  });
});

describe('resolveCollision — damage magnitude', () => {
  it('reports damage = k · reducedMass · relSpeedNormal²', () => {
    const mA = 2;
    const mB = 3;
    const closingSpeed = 5;
    const r = resolveCollision(
      of(1, 0, 0), of(-closingSpeed / 2, 0, 0), mA, 0.5,
      of(0, 0, 0), of(+closingSpeed / 2, 0, 0), mB, 0.5,
      0.15, K,
    );
    const reduced = (mA * mB) / (mA + mB);
    const expected = K * reduced * closingSpeed * closingSpeed;
    expect(r.relSpeedNormal).toBeCloseTo(closingSpeed, 10);
    expect(r.damage).toBeCloseTo(expected, 10);
  });

  it('damage is 0 when contact was grazing', () => {
    const r = resolveCollision(
      of(1, 0, 0), of(0, 5, 0), 1, 0.5,
      of(0, 0, 0), of(0, -5, 0), 1, 0.5,
      0.15, K,
    );
    expect(r.damage).toBe(0);
    expect(r.relSpeedNormal).toBe(0);
  });
});
