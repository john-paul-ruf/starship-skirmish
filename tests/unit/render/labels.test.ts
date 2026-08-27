// labels — the world→screen projection and the collision/LOD declutter are the pure
// helpers behind the DOM overlay. The overlay DOM itself is a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import { declutterLabels, projectToScreen, type ScreenLabel } from '../../../src/render/labels.js';

// Column-major identity: clip = (x, y, z, 1). NDC == world for x,y in [-1,1].
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('projectToScreen', () => {
  it('maps the origin to the viewport centre', () => {
    const p = projectToScreen(IDENTITY, 0, 0, 0, 800, 600);
    expect(p.sx).toBeCloseTo(400, 6);
    expect(p.sy).toBeCloseTo(300, 6);
    expect(p.inFront).toBe(true);
  });

  it('flips y for screen space (top-left origin)', () => {
    const top = projectToScreen(IDENTITY, 0, 1, 0, 800, 600);
    const bottom = projectToScreen(IDENTITY, 0, -1, 0, 800, 600);
    expect(top.sy).toBeCloseTo(0, 6); // +y world → top of screen
    expect(bottom.sy).toBeCloseTo(600, 6);
  });

  it('maps NDC x to horizontal pixels', () => {
    expect(projectToScreen(IDENTITY, 1, 0, 0, 800, 600).sx).toBeCloseTo(800, 6);
    expect(projectToScreen(IDENTITY, -1, 0, 0, 800, 600).sx).toBeCloseTo(0, 6);
  });

  it('reports points behind the camera as not in front', () => {
    // A view-projection with w = -z: a point at +z lands behind the camera.
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];
    expect(projectToScreen(m, 0, 0, 1, 800, 600).inFront).toBe(false);
  });
});

const label = (id: number, sx: number, sy: number, depth: number, inFront = true): ScreenLabel => ({
  id,
  sx,
  sy,
  depth,
  inFront,
});

describe('declutterLabels', () => {
  it('keeps the nearer label when two collide within the gap', () => {
    const near = label(1, 100, 100, 0.2);
    const far = label(2, 108, 104, 0.5); // within 26px of `near`
    const kept = declutterLabels([far, near], 26);
    expect(kept.map((l) => l.id)).toEqual([1]);
  });

  it('keeps both when they are farther apart than the gap', () => {
    const a = label(1, 100, 100, 0.2);
    const b = label(2, 400, 300, 0.5);
    const kept = declutterLabels([a, b], 26);
    expect(new Set(kept.map((l) => l.id))).toEqual(new Set([1, 2]));
  });

  it('drops labels behind the camera before decluttering', () => {
    const front = label(1, 100, 100, 0.2, true);
    const behind = label(2, 400, 300, 0.5, false);
    const kept = declutterLabels([front, behind], 26);
    expect(kept.map((l) => l.id)).toEqual([1]);
  });

  it('is deterministic under equal depth (ties break by id)', () => {
    const a = label(2, 100, 100, 0.3);
    const b = label(1, 104, 102, 0.3); // collides with a
    const kept = declutterLabels([a, b], 26);
    expect(kept.map((l) => l.id)).toEqual([1]); // lower id wins the tie
  });
});
