// ghost — the plotting-ghost PURE helpers (placement + exit channels + merge). The
// three.js `Line2`/sprite drawing is screen-e2e; these tests lock the math: a mark sits
// at the fractional-index lerp of the supplied positions, `endsOutsideArena` emits all
// three exit channels, and the low-Δv threshold flags mark-merge (Gate 1 §2a). The ghost
// only ever DRAWS a supplied path — there is no integrator here to test.

import { describe, expect, it } from 'vitest';
import {
  EXIT_STATUS,
  GHOST_CYAN,
  GHOST_EXIT_RED,
  MERGE_RADIUS_FACTOR,
  computeMarks,
  exitStateFor,
  fromPreviewPath,
  ghostLineColor,
  isLowDeltaVArc,
  sampleAtIndex,
  type GhostDrawInput,
} from '../../../src/render/ghost.js';
import type { Vec3 } from '../../../src/sim/index.js';

// A straight arc along +x, 5 samples over 4 seconds: index i is at x = 10·i.
const straight = (n: number, step: number): Vec3[] =>
  Array.from({ length: n }, (_, i) => ({ x: i * step, y: 0, z: 0 }));

const input = (over: Partial<GhostDrawInput>): GhostDrawInput => ({
  positions: straight(5, 10),
  endsOutsideArena: false,
  deltaVMag: 40,
  ...over,
});

describe('sampleAtIndex', () => {
  const pts = straight(5, 10); // x = 0,10,20,30,40

  it('is exact at integer indices and clamps out-of-range', () => {
    expect(sampleAtIndex(pts, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(sampleAtIndex(pts, 4)).toEqual({ x: 40, y: 0, z: 0 });
    expect(sampleAtIndex(pts, 9).x).toBe(40); // clamp high
    expect(sampleAtIndex(pts, -3).x).toBe(0); // clamp low
  });

  it('lerps a fractional index', () => {
    expect(sampleAtIndex(pts, 1.5).x).toBeCloseTo(15, 6);
    expect(sampleAtIndex(pts, 2.25).x).toBeCloseTo(22.5, 6);
  });

  it('degenerate lengths do not throw', () => {
    expect(sampleAtIndex([], 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(sampleAtIndex([{ x: 7, y: 8, z: 9 }], 0.5)).toEqual({ x: 7, y: 8, z: 9 });
  });
});

describe('computeMarks (per-second placement)', () => {
  it('places floor(beatSeconds) marks at the exact time→index lerp', () => {
    // beatSeconds=4 → seconds 1..4. index s = s/4·(n-1) = s/4·4 = s. Position x = 10·s.
    const marks = computeMarks(input({ beatSeconds: 4, hullRadius: 3 }));
    expect(marks).toHaveLength(4);
    expect(marks.map((m) => m.second)).toEqual([1, 2, 3, 4]);
    expect(marks[0]!.index).toBeCloseTo(1, 6);
    expect(marks[0]!.position.x).toBeCloseTo(10, 6);
    expect(marks[3]!.position.x).toBeCloseTo(40, 6);
  });

  it('a fractional beatSeconds still maps time→index correctly', () => {
    // beatSeconds=2 → seconds 1,2. index s = s/2·4 = 2s. x = 10·(2s) = 20s.
    const marks = computeMarks(input({ beatSeconds: 2, hullRadius: 3 }));
    expect(marks.map((m) => m.second)).toEqual([1, 2]);
    expect(marks[0]!.position.x).toBeCloseTo(20, 6);
    expect(marks[1]!.position.x).toBeCloseTo(40, 6);
  });

  it('markIntervalSec: 2 places marks at 2s / 4s / 6s / 8s (S01 selector)', () => {
    // beatSeconds=8 → interval=2 → k=1..4 → t=2,4,6,8. n=9 so index = (t/8)·8 = t.
    const positions = Array.from({ length: 9 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
    const marks = computeMarks({
      positions,
      endsOutsideArena: false,
      deltaVMag: 40,
      beatSeconds: 8,
      markIntervalSec: 2,
    });
    expect(marks.map((m) => m.second)).toEqual([2, 4, 6, 8]);
    expect(marks.map((m) => m.position.x)).toEqual([20, 40, 60, 80]);
  });

  it('markIntervalSec: 4 places marks at 4s / 8s (fewer, sparser)', () => {
    const positions = Array.from({ length: 9 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
    const marks = computeMarks({
      positions,
      endsOutsideArena: false,
      deltaVMag: 40,
      beatSeconds: 8,
      markIntervalSec: 4,
    });
    expect(marks.map((m) => m.second)).toEqual([4, 8]);
  });

  it('markIntervalSec: 0 reproduces the per-second cadence exactly', () => {
    const positions = Array.from({ length: 9 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
    const withZero = computeMarks({
      positions,
      endsOutsideArena: false,
      deltaVMag: 40,
      beatSeconds: 8,
      markIntervalSec: 0,
    });
    const perSecond = computeMarks({
      positions,
      endsOutsideArena: false,
      deltaVMag: 40,
      beatSeconds: 8,
    });
    expect(withZero.map((m) => m.second)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(withZero.map((m) => m.second)).toEqual(perSecond.map((m) => m.second));
    expect(withZero.map((m) => m.position.x)).toEqual(perSecond.map((m) => m.position.x));
  });

  it('falls back to one mark per interior sample without beatSeconds', () => {
    const marks = computeMarks(input({}));
    // n=5 → interior samples 1..3.
    expect(marks.map((m) => m.second)).toEqual([1, 2, 3]);
    expect(marks[0]!.position.x).toBeCloseTo(10, 6);
  });

  it('flags mark-merge below the low-Δv threshold (§2a)', () => {
    // Nearly stationary arc: samples 1 unit apart, hullRadius 5 → threshold 6 > 1 ⇒ merged.
    const marks = computeMarks({
      positions: straight(5, 1),
      endsOutsideArena: false,
      deltaVMag: 1,
      beatSeconds: 4,
      hullRadius: 5,
    });
    expect(marks.every((m) => m.merged)).toBe(true);
  });

  it('does NOT flag merge on a well-separated arc', () => {
    const marks = computeMarks(input({ beatSeconds: 4, hullRadius: 3 }));
    // spacing 10 ≫ 1.2·3 = 3.6 ⇒ no merge.
    expect(marks.some((m) => m.merged)).toBe(false);
  });

  it('no merge flag when hullRadius is absent (fallback)', () => {
    const marks = computeMarks(input({ beatSeconds: 4 }));
    expect(marks.every((m) => m.merged === false)).toBe(true);
  });

  it('returns no marks for a degenerate (<2 sample) path', () => {
    expect(computeMarks(input({ positions: [{ x: 0, y: 0, z: 0 }] }))).toEqual([]);
  });
});

describe('three-channel exit signal (FR-16, §4.1)', () => {
  it('endsOutsideArena emits ALL THREE channels', () => {
    const exiting = input({ endsOutsideArena: true });
    // Channel 1: line red.
    expect(ghostLineColor(exiting)).toBe(GHOST_EXIT_RED);
    // Channel 2: ✕ crossing sprite anchor (predicted-outside endpoint).
    const state = exitStateFor(exiting);
    expect(state.active).toBe(true);
    expect(state.crossing).toEqual({ x: 40, y: 0, z: 0 });
    // Channel 3: status callout.
    expect(state.status).toBe(EXIT_STATUS);
  });

  it('a contained arc fires NO exit channel and draws cyan', () => {
    const contained = input({ endsOutsideArena: false });
    expect(ghostLineColor(contained)).toBe(GHOST_CYAN);
    const state = exitStateFor(contained);
    expect(state).toEqual({ active: false, crossing: null, status: '' });
  });
});

describe('isLowDeltaVArc + fromPreviewPath', () => {
  it('isLowDeltaVArc mirrors the §2a threshold', () => {
    expect(isLowDeltaVArc(1, 5)).toBe(true); // 1 < 6
    expect(isLowDeltaVArc(10, 5)).toBe(false); // 10 < 6 is false
    expect(MERGE_RADIUS_FACTOR).toBe(1.2);
  });

  it('fromPreviewPath maps the controller preview 1:1 and threads options', () => {
    const preview = { positions: straight(3, 5), endsOutsideArena: true };
    const built = fromPreviewPath(preview, 12, {
      beatSeconds: 3,
      hullRadius: 4,
      markIntervalSec: 2,
    });
    expect(built.positions).toBe(preview.positions);
    expect(built.endsOutsideArena).toBe(true);
    expect(built.deltaVMag).toBe(12);
    expect(built.beatSeconds).toBe(3);
    expect(built.hullRadius).toBe(4);
    expect(built.markIntervalSec).toBe(2);
  });

  it('fromPreviewPath omits optional fields when not supplied', () => {
    const built = fromPreviewPath({ positions: [], endsOutsideArena: false }, 0);
    expect('beatSeconds' in built).toBe(false);
    expect('hullRadius' in built).toBe(false);
    expect('markIntervalSec' in built).toBe(false);
  });
});
