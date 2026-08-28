// camera — the pure orbit-framing math (Gate 1 §7.1). No WebGL: only the free
// functions are exercised here; the OrbitControls wiring is a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import {
  DISTANCE_CLAMP,
  FLEET_VIEW,
  clampDistance,
  distanceBounds,
  fleetViewPosition,
  focusBodyFor,
  focusSourceFor,
  moveStep,
  orbitToPosition,
  panAxesFor,
  projectToViewport,
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

describe('projectToViewport (S01 world → CSS-px)', () => {
  // Camera at (0,0,100) looking at origin. Manually update matrices so the pure
  // helper has fresh world/projection state (no RAF in node).
  const makeCamera = (): PerspectiveCamera => {
    const cam = new PerspectiveCamera(50, 1, 1, 1000);
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  };

  it('projects the origin to the viewport center', () => {
    const cam = makeCamera();
    const px = projectToViewport([0, 0, 0], cam, 800, 600);
    expect(px).not.toBeNull();
    expect(px!.x).toBeCloseTo(400, 3);
    expect(px!.y).toBeCloseTo(300, 3);
  });

  it('a point behind the camera projects to null', () => {
    const cam = makeCamera();
    // (0, 0, 200) sits behind the camera at (0, 0, 100) looking down -z.
    expect(projectToViewport([0, 0, 200], cam, 800, 600)).toBeNull();
  });

  it('a point above the horizon lands in the upper half of the viewport', () => {
    const cam = makeCamera();
    const px = projectToViewport([0, 20, 0], cam, 800, 600);
    expect(px).not.toBeNull();
    expect(px!.x).toBeCloseTo(400, 3);
    expect(px!.y).toBeLessThan(300); // y flipped: smaller y-px = higher on screen
  });

  it('a point to the right of the eye lands on the right half of the viewport', () => {
    const cam = makeCamera();
    const px = projectToViewport([20, 0, 0], cam, 800, 600);
    expect(px).not.toBeNull();
    expect(px!.x).toBeGreaterThan(400);
    expect(px!.y).toBeCloseTo(300, 3);
  });
});

describe('focusSourceFor loosened to Vec3-like (S01)', () => {
  it('accepts a plain-object positionOf lookup (no three import needed)', () => {
    // `positionOf` returns { x, y, z } — no `Vector3` value in sight.
    let selected: number | null = 42;
    const positions = new Map<number, { x: number; y: number; z: number }>([
      [42, { x: 1, y: 2, z: 3 }],
    ]);
    const source = focusSourceFor(
      () => selected,
      (id) => positions.get(id) ?? null,
    );
    expect(source()).toEqual([1, 2, 3]);
    selected = null;
    expect(source()).toBeNull();
    selected = 99; // unknown id
    expect(source()).toBeNull();
  });
});

describe('panAxesFor (SESSION-03 keyboard translation)', () => {
  // The `onKeyDown` handler lowercases the key before calling `panAxesFor` — the
  // pure map keys itself lowercase to match that contract.

  it('W and ArrowUp both truck forward along the ground-projected look direction', () => {
    expect(panAxesFor('w')).toEqual({ forward: 1, right: 0, up: 0 });
    expect(panAxesFor('arrowup')).toEqual({ forward: 1, right: 0, up: 0 });
  });

  it('S and ArrowDown both truck back', () => {
    expect(panAxesFor('s')).toEqual({ forward: -1, right: 0, up: 0 });
    expect(panAxesFor('arrowdown')).toEqual({ forward: -1, right: 0, up: 0 });
  });

  it('A and ArrowLeft strafe left in the camera-relative frame', () => {
    expect(panAxesFor('a')).toEqual({ forward: 0, right: -1, up: 0 });
    expect(panAxesFor('arrowleft')).toEqual({ forward: 0, right: -1, up: 0 });
  });

  it('D and ArrowRight strafe right', () => {
    expect(panAxesFor('d')).toEqual({ forward: 0, right: 1, up: 0 });
    expect(panAxesFor('arrowright')).toEqual({ forward: 0, right: 1, up: 0 });
  });

  it('Q pedestals up the world-Y axis; E pedestals down', () => {
    expect(panAxesFor('q')).toEqual({ forward: 0, right: 0, up: 1 });
    expect(panAxesFor('e')).toEqual({ forward: 0, right: 0, up: -1 });
  });

  it('non-movement keys return null (r/f live on separate branches, letters are ignored)', () => {
    expect(panAxesFor('r')).toBeNull();
    expect(panAxesFor('f')).toBeNull();
    expect(panAxesFor('z')).toBeNull();
    expect(panAxesFor(' ')).toBeNull();
    expect(panAxesFor('shift')).toBeNull();
    expect(panAxesFor('')).toBeNull();
  });

  it('opposite keys cancel to a zero delta when their axes are summed', () => {
    const sum = (a: string, b: string) => {
      const axA = panAxesFor(a)!;
      const axB = panAxesFor(b)!;
      return {
        forward: axA.forward + axB.forward,
        right: axA.right + axB.right,
        up: axA.up + axB.up,
      };
    };
    expect(sum('w', 's')).toEqual({ forward: 0, right: 0, up: 0 });
    expect(sum('a', 'd')).toEqual({ forward: 0, right: 0, up: 0 });
    expect(sum('q', 'e')).toEqual({ forward: 0, right: 0, up: 0 });
    expect(sum('arrowup', 'arrowdown')).toEqual({ forward: 0, right: 0, up: 0 });
    expect(sum('arrowleft', 'arrowright')).toEqual({ forward: 0, right: 0, up: 0 });
  });
});

describe('moveStep (SESSION-03 per-frame pan speed)', () => {
  it('scales linearly with arena radius', () => {
    const distance = 500;
    const at1000 = moveStep(1000, distance);
    const at2000 = moveStep(2000, distance);
    // Δ per doubled radius is exactly one arena factor's worth: 1000 * 0.012.
    expect(at2000 - at1000).toBeCloseTo(1000 * 0.012, 10);
  });

  it('scales linearly with orbit distance (fast when zoomed out, slow when zoomed in)', () => {
    const arenaRadius = 1000;
    const near = moveStep(arenaRadius, 100);
    const far = moveStep(arenaRadius, 1100);
    // Δ per 1000 units of distance is exactly the distance factor: 1000 * 0.010.
    expect(far - near).toBeCloseTo(1000 * 0.010, 10);
  });

  it('is positive for any positive arena/distance so held keys always pan', () => {
    expect(moveStep(1, 1)).toBeGreaterThan(0);
    expect(moveStep(1000, 100)).toBeGreaterThan(0);
  });
});

describe('focusBodyFor (S01 roster click-to-focus)', () => {
  it('focus is called with the body position for a known id', () => {
    const focusCalls: Array<readonly [number, number, number]> = [];
    const positions = new Map<number, { x: number; y: number; z: number }>([
      [7, { x: 4, y: 5, z: 6 }],
    ]);
    const focusBody = focusBodyFor(
      (id) => positions.get(id) ?? null,
      (at) => focusCalls.push(at),
    );
    focusBody(7);
    expect(focusCalls).toEqual([[4, 5, 6]]);
  });

  it('an unknown id is a no-op — focus is not called', () => {
    const focusCalls: Array<readonly [number, number, number]> = [];
    const focusBody = focusBodyFor(
      () => null,
      (at) => focusCalls.push(at),
    );
    focusBody(999);
    expect(focusCalls).toEqual([]);
  });
});
