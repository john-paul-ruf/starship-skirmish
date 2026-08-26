// integrate — sub-step count formula, ballistic advance, plan application.
// Tests live outside `src/sim/**` so `Math.*` is permitted here as an oracle.

import { describe, it, expect } from 'vitest';
import {
  subStepCount,
  integrateBody,
  applyPlan,
} from '../../../src/sim/physics/integrate.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Body, MovementPlan } from '../../../src/sim/types.js';

const ship = (
  id: number,
  pos = of(0, 0, 0),
  vel = of(0, 0, 0),
  radius = 10,
  mass = 1,
): Body => ({
  kind: 'ship',
  id,
  position: pos,
  velocity: vel,
  radius,
  mass,
});

describe('subStepCount — architecture §7.4 formula', () => {
  it('clamps to min when the scene is at rest', () => {
    expect(subStepCount(0, 1, 10, 4, 64)).toBe(4);
  });

  it('clamps to max when relative speed is huge', () => {
    expect(subStepCount(1_000_000, 1, 10, 4, 64)).toBe(64);
  });

  it('N = ceil(maxRelSpeed · dt / (minRadius · 0.5))', () => {
    // 20 · 1 / (10 · 0.5) = 4 → within [4, 64]
    expect(subStepCount(20, 1, 10, 4, 64)).toBe(4);
    // 40 · 1 / 5 = 8
    expect(subStepCount(40, 1, 10, 4, 64)).toBe(8);
    // 50 · 1 / 5 = 10 (exact) — no ceil bump
    expect(subStepCount(50, 1, 10, 4, 64)).toBe(10);
    // 51 · 1 / 5 = 10.2 → ceil → 11
    expect(subStepCount(51, 1, 10, 4, 64)).toBe(11);
  });

  it('degenerate inputs fall back to min instead of exploding', () => {
    expect(subStepCount(10, 0, 5, 4, 64)).toBe(4);
    expect(subStepCount(10, 1, 0, 4, 64)).toBe(4);
    expect(subStepCount(-1, 1, 5, 4, 64)).toBe(4);
  });

  it('is a pure function — same inputs → same output', () => {
    const args = [37, 0.5, 8, 4, 64] as const;
    const first = subStepCount(...args);
    for (let i = 0; i < 5; i += 1) {
      expect(subStepCount(...args)).toBe(first);
    }
  });
});

describe('integrateBody — ballistic advance', () => {
  it('advances position by vel · subDt', () => {
    const b = ship(1, of(0, 0, 0), of(10, 0, 0));
    const out = integrateBody(b, 0.5);
    expect(out.position).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('conserves velocity exactly with zero net force', () => {
    const b = ship(1, of(0, 0, 0), of(1.7, -3.14, 2.5));
    let out = b;
    for (let i = 0; i < 50; i += 1) out = integrateBody(out, 0.13);
    // Bit-identical velocity — the integrator does not touch it.
    expect(out.velocity).toEqual(b.velocity);
  });

  it('is bit-stable across independent runs', () => {
    const start = ship(1, of(0, 0, 0), of(1, 2, 3));
    let a = start;
    let b = start;
    for (let i = 0; i < 100; i += 1) a = integrateBody(a, 0.1);
    for (let i = 0; i < 100; i += 1) b = integrateBody(b, 0.1);
    expect(a.position).toEqual(b.position);
  });

  it('does not mutate the input body (architecture §7.3 rule 3)', () => {
    const input = ship(1, of(0, 0, 0), of(10, 0, 0));
    const snapshot = JSON.stringify(input);
    integrateBody(input, 1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('preserves body kind through the discriminated union', () => {
    const debris: Body = {
      kind: 'debris',
      id: 7,
      position: of(0, 0, 0),
      velocity: of(1, 0, 0),
      mass: 0.5,
      radius: 12,
    };
    const missile: Body = {
      kind: 'missile',
      id: 8,
      position: of(0, 0, 0),
      velocity: of(2, 0, 0),
      mass: 0.1,
      radius: 3,
    };
    expect(integrateBody(debris, 1).kind).toBe('debris');
    expect(integrateBody(missile, 1).kind).toBe('missile');
  });
});

describe('applyPlan — velocity delta', () => {
  it('adds deltaV to velocity componentwise', () => {
    const b = ship(1, of(0, 0, 0), of(1, 1, 1));
    const plan: MovementPlan = { bodyId: 1, deltaV: of(2, -1, 0) };
    expect(applyPlan(b, plan).velocity).toEqual({ x: 3, y: 0, z: 1 });
  });

  it('does not mutate the input body', () => {
    const input = ship(1, of(0, 0, 0), of(1, 1, 1));
    const snapshot = JSON.stringify(input);
    applyPlan(input, { bodyId: 1, deltaV: of(9, 9, 9) });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
