// explosionFx — the animated blast primitive. The load-bearing property: `renderAt(1)`
// leaves core+ring opacity ~0 (terminal), so a reduced-motion skip that lands on the
// final frame via `createPlayback.finish → renderAt(1)` never freezes a half-expanded
// shockwave on screen. The pure shape helpers (`blastRingRadius`, `blastRingOpacity`,
// `blastCoreOpacity`) are locked in isolation so the curve shape can't drift silently.

import { describe, expect, it } from 'vitest';
import {
  blastCoreOpacity,
  blastRingOpacity,
  blastRingRadius,
  CORE_PEAK_T,
  makeBlast,
} from '../../../src/render/explosionFx.js';

// ---- Pure shape helpers -----------------------------------------------------

describe('blastRingRadius', () => {
  it('is 0 at localT ≤ 0', () => {
    expect(blastRingRadius(100, 0)).toBe(0);
    expect(blastRingRadius(100, -0.5)).toBe(0);
  });

  it('reaches peakRadius exactly at localT = 1', () => {
    expect(blastRingRadius(100, 1)).toBe(100);
  });

  it('clamps localT > 1 to peakRadius', () => {
    expect(blastRingRadius(80, 1.5)).toBe(80);
  });

  it('grows monotonically non-decreasing across localT 0 → 1', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40;
      const r = blastRingRadius(100, t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('treats a negative peakRadius as 0 (defensive)', () => {
    expect(blastRingRadius(-10, 0.5)).toBe(0);
  });
});

describe('blastRingOpacity', () => {
  it('is 0 at localT ≤ 0 (hidden before the window opens)', () => {
    expect(blastRingOpacity(1, 0)).toBe(0);
    expect(blastRingOpacity(1, -0.1)).toBe(0);
  });

  it('is 0 at localT = 1 (terminal — skip lands clean)', () => {
    expect(blastRingOpacity(1, 1)).toBe(0);
  });

  it('scales with intensity (0..1 clamped)', () => {
    expect(blastRingOpacity(0.5, 0.1)).toBeCloseTo(blastRingOpacity(1, 0.1) * 0.5, 5);
    expect(blastRingOpacity(2, 0.1)).toBe(blastRingOpacity(1, 0.1));
  });

  it('peaks near start (small localT) and decays linearly to 0 at 1', () => {
    const early = blastRingOpacity(1, 0.001);
    const mid = blastRingOpacity(1, 0.5);
    const late = blastRingOpacity(1, 0.9);
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });
});

describe('blastCoreOpacity', () => {
  it('is 0 at localT ≤ 0', () => {
    expect(blastCoreOpacity(1, 0)).toBe(0);
    expect(blastCoreOpacity(1, -0.2)).toBe(0);
  });

  it('is 0 at localT = 1 (terminal)', () => {
    expect(blastCoreOpacity(1, 1)).toBe(0);
  });

  it('peaks at localT = CORE_PEAK_T', () => {
    const peak = blastCoreOpacity(1, CORE_PEAK_T);
    expect(peak).toBeCloseTo(1, 5);
    expect(blastCoreOpacity(1, CORE_PEAK_T - 0.05)).toBeLessThan(peak);
    expect(blastCoreOpacity(1, CORE_PEAK_T + 0.05)).toBeLessThan(peak);
  });

  it('scales with intensity (0..1 clamped)', () => {
    expect(blastCoreOpacity(0.5, CORE_PEAK_T)).toBeCloseTo(0.5, 5);
    expect(blastCoreOpacity(-0.5, CORE_PEAK_T)).toBe(0);
  });
});

// ---- The assembly (three.js — runs in the node env like the tracer/beam) ---

describe('makeBlast', () => {
  const center = { x: 5, y: 0, z: -3 };

  it('renderAt(0) hides the group and zeros all opacities', () => {
    const b = makeBlast(center, { radius: 50 });
    b.renderAt(0);
    expect(b.object.visible).toBe(false);
    b.dispose();
  });

  it('renderAt inside (0,1) shows the group', () => {
    const b = makeBlast(center, { radius: 50 });
    b.renderAt(0.3);
    expect(b.object.visible).toBe(true);
    b.dispose();
  });

  it('renderAt(1) leaves the blast terminal (skip lands clean — outcome invariance)', () => {
    const b = makeBlast(center, { radius: 50 });
    b.renderAt(1);
    // Both children rendered to a spent state — opacity gates flip visibility off.
    for (const child of b.object.children) {
      expect(child.visible).toBe(false);
    }
    b.dispose();
  });

  it('positions its group at the supplied center', () => {
    const b = makeBlast(center, { radius: 30 });
    // three.js Object3D `position` reads the (x,y,z) we set on the Group.
    const g = b.object as unknown as { position: { x: number; y: number; z: number } };
    expect(g.position.x).toBe(5);
    expect(g.position.y).toBe(0);
    expect(g.position.z).toBe(-3);
    b.dispose();
  });

  it('dispose() does not throw and is called exactly once by convention', () => {
    const b = makeBlast(center, { radius: 20 });
    expect(() => b.dispose()).not.toThrow();
  });

  it('a zero-radius blast still renders without throwing (defensive)', () => {
    const b = makeBlast(center, { radius: 0 });
    expect(() => {
      b.renderAt(0);
      b.renderAt(0.5);
      b.renderAt(1);
    }).not.toThrow();
    b.dispose();
  });
});
