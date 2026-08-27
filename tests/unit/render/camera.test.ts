// camera — the pure orbit-framing math (Gate 1 §7.1). No WebGL: only the free
// functions are exercised here; the OrbitControls wiring is a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import {
  DISTANCE_CLAMP,
  FLEET_VIEW,
  clampDistance,
  distanceBounds,
  fleetViewPosition,
  orbitToPosition,
} from '../../../src/render/camera.js';

const DEG = Math.PI / 180;
const mag = ([x, y, z]: readonly [number, number, number]): number =>
  Math.sqrt(x * x + y * y + z * z);

describe('orbitToPosition', () => {
  it('places the camera at the requested distance from the origin', () => {
    const p = orbitToPosition(35, 30, 240);
    expect(mag(p)).toBeCloseTo(240, 6);
  });

  it('encodes elevation as the y component and azimuth in the xz plane', () => {
    const [x, y, z] = orbitToPosition(35, 30, 240);
    expect(y).toBeCloseTo(240 * Math.sin(35 * DEG), 6);
    const planar = 240 * Math.cos(35 * DEG);
    expect(x).toBeCloseTo(planar * Math.cos(30 * DEG), 6);
    expect(z).toBeCloseTo(planar * Math.sin(30 * DEG), 6);
  });

  it('degenerates to the +y axis at 90° elevation', () => {
    const [x, y, z] = orbitToPosition(90, 30, 100);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(100, 6);
  });
});

describe('fleetViewPosition', () => {
  it('sits at the documented 35°/30° framing, 2.4× arena radius out', () => {
    const R = 2000;
    const p = fleetViewPosition(R);
    expect(mag(p)).toBeCloseTo(R * FLEET_VIEW.distanceFactor, 4);
    expect(p[1]).toBeCloseTo(R * FLEET_VIEW.distanceFactor * Math.sin(FLEET_VIEW.elevationDeg * DEG), 4);
  });

  it('scales linearly with arena radius', () => {
    expect(mag(fleetViewPosition(1000))).toBeCloseTo(2400, 4);
    expect(mag(fleetViewPosition(500))).toBeCloseTo(1200, 4);
  });
});

describe('distanceBounds / clampDistance', () => {
  it('derives min/max from the Gate 1 clamp ratios', () => {
    const R = 2000;
    const { min, max } = distanceBounds(R);
    expect(min).toBe(R * DISTANCE_CLAMP.minFactor);
    expect(max).toBe(R * DISTANCE_CLAMP.maxFactor);
  });

  it('clamps below min and above max, and passes interior values through', () => {
    const R = 1000;
    expect(clampDistance(10, R)).toBe(100); // min = 0.1 * R
    expect(clampDistance(999999, R)).toBe(12000); // max = 12 * R
    expect(clampDistance(3000, R)).toBe(3000);
  });
});
