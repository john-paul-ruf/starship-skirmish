// trail — the flown-path trail PURE helpers. The three.js `Line` layer is a
// screen-e2e concern; these tests lock the fade math (monotone decrease, 0 at the
// window edge) and the window drop (`nowSimTime - at > window` boundary).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAIL_WINDOW_SECONDS,
  pruneTrail,
  trailAlphaFor,
} from '../../../src/render/trail.js';

describe('trailAlphaFor', () => {
  it('is 1 at age 0 (a freshly-pushed point)', () => {
    expect(trailAlphaFor(0, 16)).toBe(1);
  });

  it('is 0 at (and past) the window edge', () => {
    expect(trailAlphaFor(16, 16)).toBe(0);
    expect(trailAlphaFor(100, 16)).toBe(0);
  });

  it('is monotonically decreasing with age across the window', () => {
    const w = 16;
    let prev = trailAlphaFor(0, w);
    for (let age = 1; age <= w; age += 1) {
      const now = trailAlphaFor(age, w);
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
  });

  it('linearly interpolates: half-window age → alpha 0.5', () => {
    expect(trailAlphaFor(8, 16)).toBeCloseTo(0.5, 6);
    expect(trailAlphaFor(4, 16)).toBeCloseTo(0.75, 6);
    expect(trailAlphaFor(12, 16)).toBeCloseTo(0.25, 6);
  });

  it('degenerate window (0 or negative) → 0 alpha', () => {
    expect(trailAlphaFor(0, 0)).toBe(0);
    expect(trailAlphaFor(1, -5)).toBe(0);
  });

  it('exposes the FINDINGS §2a "last ~16 s" default window constant', () => {
    expect(DEFAULT_TRAIL_WINDOW_SECONDS).toBe(16);
  });
});

describe('pruneTrail', () => {
  const pts = [
    { id: 1 as const, at: 0 },
    { id: 1 as const, at: 5 },
    { id: 1 as const, at: 10 },
    { id: 1 as const, at: 15 },
  ];

  it('keeps every point when the window covers the whole history', () => {
    expect(pruneTrail(pts, 15, 16)).toEqual(pts);
  });

  it('drops points strictly past the window (nowSimTime - at > window)', () => {
    // window=8, now=15 → drop at ∈ {0, 5} (ages 15, 10). Keep at ∈ {10, 15} (ages 5, 0).
    expect(pruneTrail(pts, 15, 8)).toEqual([
      { id: 1, at: 10 },
      { id: 1, at: 15 },
    ]);
  });

  it('keeps a point exactly at the window edge (age === window)', () => {
    // at=0, now=8, window=8 → age = 8, kept (nowSimTime - at <= window).
    expect(pruneTrail([{ id: 1, at: 0 }], 8, 8)).toEqual([{ id: 1, at: 0 }]);
  });

  it('window=0 drops everything but points at exact now', () => {
    expect(pruneTrail(pts, 15, 0)).toEqual([{ id: 1, at: 15 }]);
  });

  it('returns a fresh array (input is not mutated)', () => {
    const input = [{ id: 1 as const, at: 0 }];
    const out = pruneTrail(input, 100, 10);
    expect(out).not.toBe(input);
    expect(input).toHaveLength(1); // unchanged
  });
});
