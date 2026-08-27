// wireframes — the four ship silhouettes must be non-degenerate and mutually
// distinct (FR-13: distinguishable by outline at fleet zoom). Pure vertex-table
// checks only; the fat-line rendering is a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  FLEET_PALETTE,
  SHIP_DEFAULT_OPACITY,
  SHIP_GEOMETRY,
  boundingExtent,
  createShipInstances,
  expandSegments,
  fleetColorOf,
  type ShipInput,
} from '../../../src/render/wireframes.js';
import type { ChassisClass } from '../../../src/sim/index.js';

const CLASSES: readonly ChassisClass[] = ['fighter', 'frigate', 'cruiser', 'mega-destroyer'];

describe('SHIP_GEOMETRY', () => {
  it('defines all four chassis classes', () => {
    for (const cls of CLASSES) expect(SHIP_GEOMETRY[cls]).toBeDefined();
  });

  it('every class is non-degenerate: finite verts, valid edges, real extent', () => {
    for (const cls of CLASSES) {
      const geo = SHIP_GEOMETRY[cls];
      expect(geo.vertices.length).toBeGreaterThanOrEqual(3);
      expect(geo.edges.length).toBeGreaterThanOrEqual(3);
      for (const v of geo.vertices) {
        for (const c of v) expect(Number.isFinite(c)).toBe(true);
      }
      for (const [a, b] of geo.edges) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(geo.vertices.length);
        expect(b).toBeLessThan(geo.vertices.length);
        expect(a).not.toBe(b); // no zero-length segment
      }
      const [ex, ey, ez] = boundingExtent(geo);
      // Extent along at least two axes so the outline is a real silhouette.
      const nonZero = [ex, ey, ez].filter((e) => e > 0.01).length;
      expect(nonZero).toBeGreaterThanOrEqual(2);
    }
  });

  it('the four silhouettes are mutually distinct (segments + vertex count + extent)', () => {
    for (let i = 0; i < CLASSES.length; i += 1) {
      for (let j = i + 1; j < CLASSES.length; j += 1) {
        const a = SHIP_GEOMETRY[CLASSES[i]!];
        const b = SHIP_GEOMETRY[CLASSES[j]!];
        const segA = Array.from(expandSegments(a));
        const segB = Array.from(expandSegments(b));
        const sameSegments = segA.length === segB.length && segA.every((v, k) => v === segB[k]);
        expect(sameSegments).toBe(false);
      }
    }
    // Vertex counts are all different by construction (4 / 7 / 6 / 8).
    const counts = CLASSES.map((c) => SHIP_GEOMETRY[c].vertices.length);
    expect(new Set(counts).size).toBe(CLASSES.length);
  });

  it('expandSegments yields 6 floats per edge in [start,end] order', () => {
    const geo = SHIP_GEOMETRY.fighter;
    const flat = expandSegments(geo);
    expect(flat.length).toBe(geo.edges.length * 6);
    const [a, b] = geo.edges[0]!;
    const va = geo.vertices[a]!;
    const vb = geo.vertices[b]!;
    const expected = [va[0], va[1], va[2], vb[0], vb[1], vb[2]];
    for (let k = 0; k < 6; k += 1) expect(flat[k]).toBeCloseTo(expected[k]!, 5);
  });
});

describe('fleetColorOf / FLEET_PALETTE', () => {
  it('maps fleet ids into the five palette slots by modulo', () => {
    expect(fleetColorOf(0)).toBe(0);
    expect(fleetColorOf(4)).toBe(4);
    expect(fleetColorOf(5)).toBe(0);
    expect(fleetColorOf(7)).toBe(2);
  });

  it('handles negative fleet ids without going out of range', () => {
    for (let id = -10; id <= 10; id += 1) {
      const slot = fleetColorOf(id);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(4);
      expect(FLEET_PALETTE[slot]).toBeDefined();
    }
  });

  it('exposes five distinct palette colors', () => {
    const hexes = [0, 1, 2, 3, 4].map((f) => FLEET_PALETTE[f as 0 | 1 | 2 | 3 | 4]);
    expect(new Set(hexes).size).toBe(5);
  });
});

// Per-instance opacity: playback fades ONE ship without touching its fleetmates.
// The manager instantiates plain three objects (no WebGL touched) — safe in node.
describe('ShipInstances.setOpacity (S01 mid-beat fade)', () => {
  const shipInput = (id: number, fleet: 0 | 1 = 0): ShipInput => ({
    id,
    chassisClass: 'fighter',
    fleet,
    position: [0, 0, 0],
    radius: 5,
  });

  const materialOf = (ships: ReturnType<typeof createShipInstances>, index = 0): LineMaterial => {
    const object = ships.group.children[index] as LineSegments2;
    return object.material as LineMaterial;
  };

  it('a freshly-synced ship sits at the default silhouette opacity', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1)]);
    expect(materialOf(ships).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });

  it('setOpacity(id, alpha) scales the material opacity by alpha', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1)]);
    ships.setOpacity(1, 0.5);
    expect(materialOf(ships).opacity).toBeCloseTo(0.5 * SHIP_DEFAULT_OPACITY, 6);
    ships.setOpacity(1, 0);
    expect(materialOf(ships).opacity).toBe(0);
    ships.setOpacity(1, 1);
    expect(materialOf(ships).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });

  it('setOpacity clamps out-of-range alpha into [0,1]', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1)]);
    ships.setOpacity(1, -0.5);
    expect(materialOf(ships).opacity).toBe(0);
    ships.setOpacity(1, 2);
    expect(materialOf(ships).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });

  it('sync() resets a previously-faded ship back to the solid default', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1)]);
    ships.setOpacity(1, 0.25);
    expect(materialOf(ships).opacity).toBeCloseTo(0.25 * SHIP_DEFAULT_OPACITY, 6);
    ships.sync([shipInput(1)]);
    expect(materialOf(ships).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });

  it('setOpacity is a no-op for an unknown id', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1)]);
    expect(() => ships.setOpacity(999, 0.5)).not.toThrow();
    expect(materialOf(ships).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });

  it('fading one ship does not touch a fleetmate at the same fleet color', () => {
    const ships = createShipInstances();
    ships.sync([shipInput(1), shipInput(2)]);
    ships.setOpacity(1, 0.2);
    expect(materialOf(ships, 0).opacity).toBeCloseTo(0.2 * SHIP_DEFAULT_OPACITY, 6);
    expect(materialOf(ships, 1).opacity).toBeCloseTo(SHIP_DEFAULT_OPACITY, 6);
    ships.dispose();
  });
});
