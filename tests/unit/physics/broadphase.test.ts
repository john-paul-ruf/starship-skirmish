// broadphase — candidate pair generation from a uniform spatial hash.
// The pair list must be deterministic and independent of input order.

import { describe, it, expect } from 'vitest';
import { broadphase } from '../../../src/sim/physics/broadphase.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Body } from '../../../src/sim/types.js';

const ship = (id: number, pos = of(0, 0, 0), radius = 10): Body => ({
  kind: 'ship',
  id,
  position: pos,
  velocity: of(0, 0, 0),
  radius,
  mass: 1,
});

// All scenes below use radius 10 → the smallest sound cellSize is 20 (twice maxRadius,
// with zero velocity). See broadphase.ts for the cellSize contract.
const CELL_SIZE = 20;

describe('broadphase — trivial cases', () => {
  it('returns [] for 0 bodies', () => {
    expect(broadphase([], CELL_SIZE)).toEqual([]);
  });

  it('returns [] for 1 body', () => {
    expect(broadphase([ship(1)], CELL_SIZE)).toEqual([]);
  });
});

describe('broadphase — cell adjacency', () => {
  it('pairs bodies in the same cell', () => {
    const pairs = broadphase([ship(1, of(0, 0, 0)), ship(2, of(5, 0, 0))], CELL_SIZE);
    expect(pairs).toEqual([{ a: 1, b: 2 }]);
  });

  it('pairs bodies in adjacent cells (one cell apart)', () => {
    // Cells 0 and 1 along x — direct neighbors in the 27-cell scan.
    const pairs = broadphase([ship(1, of(0, 0, 0)), ship(2, of(25, 0, 0))], CELL_SIZE);
    expect(pairs).toEqual([{ a: 1, b: 2 }]);
  });

  it('does NOT pair bodies more than one cell apart', () => {
    // Body 2 sits three cells away — outside every neighborhood.
    const pairs = broadphase([ship(1, of(0, 0, 0)), ship(2, of(60, 0, 0))], CELL_SIZE);
    expect(pairs).toEqual([]);
  });
});

describe('broadphase — canonical ordering', () => {
  it('emits pairs ascending by (a, b) regardless of input order', () => {
    // Three ships all within adjacent cells; input intentionally out of id order.
    const scene = [ship(3, of(0, 0, 0)), ship(1, of(5, 0, 0)), ship(2, of(-5, 0, 0))];
    expect(broadphase(scene, CELL_SIZE)).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
      { a: 2, b: 3 },
    ]);
  });

  it('is fully order-independent: shuffled input yields identical output', () => {
    const bodies = [
      ship(1, of(0, 0, 0)),
      ship(2, of(5, 0, 0)),
      ship(3, of(100, 0, 0)), // far from 1/2/4, near 5
      ship(4, of(-5, 0, 0)),
      ship(5, of(105, 0, 0)), // near 3
    ];
    const ref = broadphase(bodies, CELL_SIZE);
    expect(ref).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 4 },
      { a: 2, b: 4 },
      { a: 3, b: 5 },
    ]);
    // Every non-trivial permutation of the same bodies must produce the same list.
    const permutations: Body[][] = [
      [bodies[4]!, bodies[3]!, bodies[2]!, bodies[1]!, bodies[0]!],
      [bodies[2]!, bodies[0]!, bodies[4]!, bodies[1]!, bodies[3]!],
      [bodies[1]!, bodies[4]!, bodies[0]!, bodies[3]!, bodies[2]!],
    ];
    for (const perm of permutations) expect(broadphase(perm, CELL_SIZE)).toEqual(ref);
  });

  it('handles negative-coordinate cells (floor rounds toward −∞)', () => {
    // Body at x=-25 → cell (-2,0,0). Body at x=-45 → cell (-3,0,0). Neighbors → pair.
    // Body at x=-85 → cell (-5,0,0). Not a neighbor of (-2,0,0).
    const pairs = broadphase(
      [ship(1, of(-25, 0, 0)), ship(2, of(-45, 0, 0)), ship(3, of(-85, 0, 0))],
      CELL_SIZE,
    );
    expect(pairs).toEqual([{ a: 1, b: 2 }]);
  });
});

describe('broadphase — cellSize input contract', () => {
  it('caller-supplied cellSize governs adjacency (larger cell → wider pairing radius)', () => {
    // With radius 10 alone, cellSize 20 → bodies at 0 and 60 are 3 cells apart, no pair.
    // With cellSize 40 (e.g. accounting for high per-sub-step displacement), same bodies
    // are only 1 cell apart → pair.
    const scene = [ship(1, of(0, 0, 0)), ship(2, of(60, 0, 0))];
    expect(broadphase(scene, 20)).toEqual([]);
    expect(broadphase(scene, 40)).toEqual([{ a: 1, b: 2 }]);
  });

  it('non-positive cellSize falls back to 1 (defensive)', () => {
    const scene = [ship(1, of(0, 0, 0)), ship(2, of(0.5, 0, 0))];
    // With cellSize 1: both in cell 0 (same cell), so they pair.
    expect(broadphase(scene, 0)).toEqual([{ a: 1, b: 2 }]);
    expect(broadphase(scene, -5)).toEqual([{ a: 1, b: 2 }]);
  });
});
