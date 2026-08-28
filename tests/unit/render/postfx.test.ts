// postfx — the bloom pipeline's PURE helpers. The composer itself needs WebGL and
// is proven by `vite build` + the screen e2e. These tests lock the tier shape
// (`reduced` → bloom disabled + zero strength so the `scene.render()` fallback is
// byte-equivalent to the pre-bloom path) and the half-resolution sizing math.

import { describe, expect, it } from 'vitest';
import { bloomParamsFor, halfRes } from '../../../src/render/postfx.js';

describe('halfRes', () => {
  it('halves both dimensions and returns a readonly tuple', () => {
    expect(halfRes(1920, 1080)).toEqual([960, 540]);
    expect(halfRes(800, 600)).toEqual([400, 300]);
  });

  it('floors the halved dimensions (odd inputs)', () => {
    expect(halfRes(1921, 1081)).toEqual([960, 540]);
    expect(halfRes(3, 5)).toEqual([1, 2]);
  });

  it('floors to a minimum of 1 so a zero-sized canvas never yields a zero target', () => {
    expect(halfRes(0, 0)).toEqual([1, 1]);
    expect(halfRes(1, 1)).toEqual([1, 1]);
    expect(halfRes(-10, -20)).toEqual([1, 1]);
  });
});

describe('bloomParamsFor', () => {
  it('reduced tier returns disabled + zero strength (byte-equivalent fallback path)', () => {
    const params = bloomParamsFor('reduced');
    expect(params.enabled).toBe(false);
    expect(params.strength).toBe(0);
    expect(params.radius).toBe(0);
    // Threshold at 1 = nothing above unit luminance survives — a belt-and-braces
    // "no light bleeds" guarantee even if some caller ignored `enabled`.
    expect(params.threshold).toBe(1);
  });

  it('high tier enables bloom with sane bounds', () => {
    const params = bloomParamsFor('high');
    expect(params.enabled).toBe(true);
    // Strength must produce a visible glow but not blow out flat surfaces.
    expect(params.strength).toBeGreaterThan(0);
    expect(params.strength).toBeLessThanOrEqual(2);
    // Radius controls blur spread; keep it within UnrealBloomPass's stable range.
    expect(params.radius).toBeGreaterThanOrEqual(0);
    expect(params.radius).toBeLessThanOrEqual(1);
    // Threshold is a luminance cutoff in [0,1]; a strictly-positive value prevents
    // the low-alpha boundary shell / grid from bleeding into the arena.
    expect(params.threshold).toBeGreaterThan(0);
    expect(params.threshold).toBeLessThanOrEqual(1);
  });
});
