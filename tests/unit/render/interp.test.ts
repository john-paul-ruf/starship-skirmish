// interp — fractional-index keyframe lerp. Pure, node-testable (no WebGL): endpoints
// exact, a mid-beat value matches a hand-computed lerp, and appear/disappear bodies
// fade in/out. This is the "playback samples the sim's own keyframes" contract.

import { describe, expect, it } from 'vitest';
import { clamp01, easeInOutQuad, lerp, lerpBodyAt } from '../../../src/render/interp.js';
import type { Body } from '../../../src/sim/index.js';

const ship = (id: number, pos: readonly [number, number, number], vel: readonly [number, number, number] = [0, 0, 0]): Body => ({
  id,
  kind: 'ship',
  position: { x: pos[0], y: pos[1], z: pos[2] },
  velocity: { x: vel[0], y: vel[1], z: vel[2] },
  mass: 100,
  radius: 5,
});

const debris = (id: number, pos: readonly [number, number, number]): Body => ({
  id,
  kind: 'debris',
  position: { x: pos[0], y: pos[1], z: pos[2] },
  velocity: { x: 0, y: 0, z: 0 },
  mass: 10,
  radius: 2,
});

describe('clamp01 / lerp / easeInOutQuad', () => {
  it('clamp01 bounds to [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(2)).toBe(1);
  });

  it('lerp is exact at endpoints and midpoint', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('easeInOutQuad fixes the endpoints (skip stays outcome-invariant)', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOutQuad(-1)).toBe(0); // clamps first
  });
});

describe('lerpBodyAt', () => {
  const keyframes: readonly (readonly Body[])[] = [
    [ship(1, [0, 0, 0], [10, 0, 0]), ship(2, [0, 0, 100])],
    [ship(1, [10, 0, 0], [10, 0, 0]), ship(2, [0, 0, 100])],
    [ship(1, [20, 0, 0], [10, 0, 0]), ship(2, [0, 0, 100])],
  ];

  it('empty keyframes → empty result', () => {
    expect(lerpBodyAt([], 0.5)).toEqual([]);
  });

  it('a single keyframe returns that frame regardless of tNorm', () => {
    const single = [[ship(1, [3, 4, 5])]];
    const at0 = lerpBodyAt(single, 0);
    const at1 = lerpBodyAt(single, 1);
    expect(at0[0]!.position).toEqual({ x: 3, y: 4, z: 5 });
    expect(at1[0]!.position).toEqual({ x: 3, y: 4, z: 5 });
    expect(at0[0]!.alpha).toBe(1);
  });

  it('tNorm=0 is exactly frame 0', () => {
    const r = lerpBodyAt(keyframes, 0);
    expect(r.map((b) => b.position.x)).toEqual([0, 0]);
    expect(r.every((b) => b.alpha === 1)).toBe(true);
  });

  it('tNorm=1 is exactly the last frame', () => {
    const r = lerpBodyAt(keyframes, 1);
    const one = r.find((b) => b.id === 1)!;
    expect(one.position.x).toBe(20);
  });

  it('a mid-beat value matches a hand-computed lerp', () => {
    // n=3 → f = 0.25·2 = 0.5 → lo=0, hi=1, frac=0.5. Body 1: lerp(0,10,0.5)=5.
    const r = lerpBodyAt(keyframes, 0.25);
    const one = r.find((b) => b.id === 1)!;
    expect(one.position.x).toBeCloseTo(5, 6);
    // f = 0.75·2 = 1.5 → lo=1, hi=2, frac=0.5. Body 1: lerp(10,20,0.5)=15.
    const r2 = lerpBodyAt(keyframes, 0.75);
    expect(r2.find((b) => b.id === 1)!.position.x).toBeCloseTo(15, 6);
  });

  it('output is sorted by body id', () => {
    const unsorted = [
      [ship(9, [0, 0, 0]), ship(2, [0, 0, 0]), ship(5, [0, 0, 0])],
      [ship(9, [1, 0, 0]), ship(2, [1, 0, 0]), ship(5, [1, 0, 0])],
    ];
    const r = lerpBodyAt(unsorted, 0.5);
    expect(r.map((b) => b.id)).toEqual([2, 5, 9]);
  });

  it('a body destroyed mid-beat fades out at its last position', () => {
    // Body 2 present in frame0, gone from frame1.
    const frames = [
      [ship(1, [0, 0, 0]), ship(2, [7, 0, 0])],
      [ship(1, [10, 0, 0])],
    ];
    const mid = lerpBodyAt(frames, 0.5); // lo=0, hi=1, frac=0.5
    const two = mid.find((b) => b.id === 2)!;
    expect(two.position).toEqual({ x: 7, y: 0, z: 0 }); // holds last position
    expect(two.alpha).toBeCloseTo(0.5, 6); // 1 - frac
    // At the very end body 2 is gone entirely.
    expect(lerpBodyAt(frames, 1).some((b) => b.id === 2)).toBe(false);
  });

  it('a body spawned mid-beat fades in from its first-seen position', () => {
    // Debris 3 appears only in frame1.
    const frames = [
      [ship(1, [0, 0, 0])],
      [ship(1, [10, 0, 0]), debris(3, [4, 0, 0])],
    ];
    const mid = lerpBodyAt(frames, 0.5);
    const three = mid.find((b) => b.id === 3)!;
    expect(three.kind).toBe('debris');
    expect(three.position).toEqual({ x: 4, y: 0, z: 0 });
    expect(three.alpha).toBeCloseTo(0.5, 6); // frac
    // At the start it is not present.
    expect(lerpBodyAt(frames, 0).some((b) => b.id === 3)).toBe(false);
  });
});
