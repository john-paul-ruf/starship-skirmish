// thrust — per-sub-step Δv schedule + peakSpeedSq (SESSION-01 checkpoint 2).
//
// Tests live outside `src/sim/**` so `Math.*` (transcendentals, `Math.sqrt`, etc.)
// is available as an oracle. The properties asserted here are the ones every
// downstream session (S02–S06) reads through:
//
//   1. Impulsive equivalence: `segments === undefined` → `[deltaV, 0, …, 0]`
//      exactly, so the pre-SESSION-01 `applyPlan`-at-start behaviour is
//      reproduced byte-for-byte (D-ADDITIVE-PLAN).
//   2. Finite-thrust sum: a schedule for a segmented plan sums (Σ per-sub-step Δv)
//      to the segments' total impulse (per component, within the maxAccel cap).
//   3. peakSpeedSq >= start speed AND >= end speed (running sum bound).

import { describe, it, expect } from 'vitest';
import { thrustSchedule, peakSpeedSq } from '../../../src/sim/physics/thrust.js';
import { of, ZERO, add, lengthSq } from '../../../src/sim/mathx/vec3.js';
import type { MovementPlan, WaypointBurn } from '../../../src/sim/types.js';

const seg = (dv: ReturnType<typeof of>): WaypointBurn => ({ deltaV: dv });

const sumSchedule = (schedule: readonly ReturnType<typeof of>[]): ReturnType<typeof of> => {
  let acc = ZERO;
  for (const dv of schedule) acc = add(acc, dv);
  return acc;
};

describe('thrustSchedule — impulsive branch (segments absent)', () => {
  it('returns [deltaV, 0, 0, …] with length N', () => {
    const plan: MovementPlan = { bodyId: 1, deltaV: of(3, -1, 2) };
    const s = thrustSchedule(plan, 5, 1, 25);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual({ x: 3, y: -1, z: 2 });
    for (let k = 1; k < s.length; k += 1) {
      expect(s[k]).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('is independent of maxAccel on the impulsive branch', () => {
    const plan: MovementPlan = { bodyId: 1, deltaV: of(10, 0, 0) };
    const a = thrustSchedule(plan, 4, 1, undefined);
    const b = thrustSchedule(plan, 4, 1, 25);
    const c = thrustSchedule(plan, 4, 1, 1_000_000);
    for (let k = 0; k < 4; k += 1) {
      expect(a[k]).toEqual(b[k]);
      expect(a[k]).toEqual(c[k]);
    }
  });

  it('empty `segments` array is treated as impulsive of plan.deltaV', () => {
    const plan: MovementPlan = { bodyId: 1, deltaV: of(4, 0, 0), segments: [] };
    const s = thrustSchedule(plan, 3, 1, 25);
    expect(s[0]).toEqual({ x: 4, y: 0, z: 0 });
    expect(s[1]).toEqual({ x: 0, y: 0, z: 0 });
    expect(s[2]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('N == 0 returns an empty schedule (degenerate short-circuit)', () => {
    const plan: MovementPlan = { bodyId: 1, deltaV: of(1, 0, 0) };
    expect(thrustSchedule(plan, 0, 1, 25)).toEqual([]);
  });
});

describe('thrustSchedule — finite-thrust branch (segments present)', () => {
  it('one-segment plan sums to the segment deltaV (within cap)', () => {
    // Segment slice = dt (only one segment). Burn cap = maxAccel · dt = 25 · 1 = 25.
    // Requested |deltaV| = 10 → uncapped → schedule sums to (10, 0, 0).
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(10, 0, 0))],
    };
    const s = thrustSchedule(plan, 8, 1, 25);
    const sum = sumSchedule(s);
    expect(sum.x).toBeCloseTo(10, 10);
    expect(sum.y).toBeCloseTo(0, 12);
    expect(sum.z).toBeCloseTo(0, 12);
  });

  it('two-segment plan sums to the segments summed deltaV (within cap)', () => {
    // 2 segments, each with slice = dt/2 = 0.5s. cap = 25 · 0.5 = 12.5 per segment.
    // Segment 0 |Δv|=6 (uncapped), segment 1 |Δv|=sqrt(3²+4²)=5 (uncapped).
    // Total expected: (6+3, 0+4, 0+0) = (9, 4, 0).
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(6, 0, 0)), seg(of(3, 4, 0))],
    };
    const s = thrustSchedule(plan, 32, 1, 25);
    const sum = sumSchedule(s);
    expect(sum.x).toBeCloseTo(9, 10);
    expect(sum.y).toBeCloseTo(4, 10);
    expect(sum.z).toBeCloseTo(0, 12);
  });

  it('per-segment magnitude is capped at maxAccel · segDur', () => {
    // 2 segments, slice = 0.5s, cap = 25 · 0.5 = 12.5. Ask for 100 along +x.
    // Schedule should sum to the cap × 2 = 25 along +x (each segment maxes out).
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(100, 0, 0)), seg(of(100, 0, 0))],
    };
    const s = thrustSchedule(plan, 32, 1, 25);
    const sum = sumSchedule(s);
    expect(sum.x).toBeCloseTo(25, 6);
    expect(sum.y).toBeCloseTo(0, 12);
    expect(sum.z).toBeCloseTo(0, 12);
  });

  it('a segment with |Δv| = 0 contributes zero (no NaN from a divide-by-zero)', () => {
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(ZERO), seg(of(4, 0, 0))],
    };
    const s = thrustSchedule(plan, 16, 1, 25);
    for (const dv of s) {
      expect(Number.isFinite(dv.x)).toBe(true);
      expect(Number.isFinite(dv.y)).toBe(true);
      expect(Number.isFinite(dv.z)).toBe(true);
    }
    const sum = sumSchedule(s);
    expect(sum.x).toBeCloseTo(4, 10);
    expect(sum.y).toBeCloseTo(0, 12);
  });

  it('missing / non-positive maxAccel folds segments into an impulsive sum at k=0', () => {
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(2, 0, 0)), seg(of(0, 3, 0))],
    };
    const withUndef = thrustSchedule(plan, 4, 1, undefined);
    expect(withUndef[0]).toEqual({ x: 2, y: 3, z: 0 });
    expect(withUndef[1]).toEqual({ x: 0, y: 0, z: 0 });

    const withZero = thrustSchedule(plan, 4, 1, 0);
    expect(withZero[0]).toEqual({ x: 2, y: 3, z: 0 });
  });

  it('a lateral single-segment burn changes velocity direction (curved arc)', () => {
    // Start velocity is x-only; a +y burn should produce a schedule whose running
    // sum builds up a +y velocity component monotonically. This is the "curves
    // while thrusting" property the whole feature exists to add.
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(0, 5, 0))],
    };
    const s = thrustSchedule(plan, 8, 1, 25);
    let vy = 0;
    let priorVy = 0;
    for (const dv of s) {
      vy += dv.y;
      // Monotonic non-decreasing: burn only ever adds +y.
      expect(vy).toBeGreaterThanOrEqual(priorVy);
      priorVy = vy;
    }
    // End vy sums to the segment's Δv (uncapped: 25·1=25 cap, request 5).
    expect(vy).toBeCloseTo(5, 10);
  });
});

describe('peakSpeedSq — running sum bounds', () => {
  it('is |startVelocity + deltaV|² for an impulsive schedule', () => {
    // schedule = [deltaV, 0, 0, …]. Post-impulse velocity = (13, 0, 0) → |v|² = 169.
    // Matches what the pre-SESSION-01 resolver used as its maxSpeedSq.
    const plan: MovementPlan = { bodyId: 1, deltaV: of(3, 0, 0) };
    const schedule = thrustSchedule(plan, 4, 1, 25);
    const peak = peakSpeedSq(of(10, 0, 0), schedule);
    expect(peak).toBeCloseTo(169, 10);
  });

  it('is >= starting speed² whenever the schedule accelerates the body', () => {
    // Start (10, 0, 0), pure +x burn → end speed > start speed → peak = end².
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(5, 0, 0))],
    };
    const schedule = thrustSchedule(plan, 8, 1, 25);
    const peak = peakSpeedSq(of(10, 0, 0), schedule);
    // Final speed ~15, |v|² ~225. Peak >= final².
    expect(peak).toBeCloseTo(225, 6);
    expect(peak).toBeGreaterThanOrEqual(lengthSq(of(15, 0, 0)) - 1e-9);
  });

  it('is >= end speed² over any schedule (running-sum invariant)', () => {
    // Multi-segment: start (0,0,0), burn +x then +y.
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: ZERO,
      segments: [seg(of(4, 0, 0)), seg(of(0, 3, 0))],
    };
    const schedule = thrustSchedule(plan, 16, 1, 25);
    const start = of(0, 0, 0);
    let end = start;
    for (const dv of schedule) end = add(end, dv);
    const peak = peakSpeedSq(start, schedule);
    expect(peak).toBeGreaterThanOrEqual(lengthSq(end) - 1e-9);
  });

  it('an empty schedule yields peak = 0 (degenerate scene short-circuit)', () => {
    expect(peakSpeedSq(of(5, 5, 5), [])).toBe(0);
  });
});
