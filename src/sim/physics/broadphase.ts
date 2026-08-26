// broadphase — uniform spatial hash yielding candidate collision pairs.
//
// Cell size = `2 · maxRadius` so a body only overlaps at most two cells per axis;
// therefore a pair whose spheres could intersect always sits within each other's
// 27-cell (3³) neighborhood. Iterating bodies in id order and only emitting pairs
// (a, b) with `a.id < b.id` yields a canonical, id-sorted pair list — the ordering
// that the narrowphase and momentum stages inherit for determinism (architecture
// §7.3 rule 1, §7.4).
//
// The uniform hash is chosen over a KD-tree/BVH because at 60 ships + 300 hazards
// (the design budget) it is O(n) with tiny constants, has no rebuild cost between
// sub-steps, and — importantly — has no insertion-order-dependent structural state.

import type { Body, BodyId } from '../types.js';

export interface Pair {
  readonly a: BodyId;
  readonly b: BodyId;
}

/**
 * Encode a 3D cell coordinate as a string key. Coord magnitude stays well within
 * JS's safe-int precision even for the largest arena (~4200 units / cellSize).
 */
const cellKey = (cx: number, cy: number, cz: number): string => `${cx}|${cy}|${cz}`;

const cellCoord = (v: number, cellSize: number): number => Math.floor(v / cellSize);

/**
 * Emit unique unordered pairs `(a, b)` (with `a < b`) for bodies whose spheres COULD
 * overlap this sub-step. The result is sorted ascending by `(a, b)`.
 *
 * `bodies` need not be pre-sorted — broadphase does its own id-order iteration and
 * inserts into buckets in id order, so bucket contents are also id-sorted.
 */
export const broadphase = (bodies: readonly Body[]): readonly Pair[] => {
  if (bodies.length < 2) return [];

  // Determine cell size from the LARGEST body. If every body has zero radius (a
  // degenerate preview scene, say), fall back to 1 to avoid a divide-by-zero.
  let maxRadius = 0;
  for (let i = 0; i < bodies.length; i += 1) {
    const r = bodies[i]!.radius;
    if (r > maxRadius) maxRadius = r;
  }
  const cellSize = maxRadius > 0 ? maxRadius * 2 : 1;

  // Sort bodies by id once; every downstream iteration inherits this order.
  const sorted = bodies.slice().sort((a, b) => a.id - b.id);

  // Bucket bodies by cell. Because inserts happen in id order, each bucket's id list
  // is already ascending — no per-bucket resort needed.
  const buckets = new Map<string, BodyId[]>();
  // Cache each body's cell coord so the neighbor scan below doesn't recompute it.
  const cellByBody = new Map<BodyId, { cx: number; cy: number; cz: number }>();

  for (let i = 0; i < sorted.length; i += 1) {
    const body = sorted[i]!;
    const cx = cellCoord(body.position.x, cellSize);
    const cy = cellCoord(body.position.y, cellSize);
    const cz = cellCoord(body.position.z, cellSize);
    cellByBody.set(body.id, { cx, cy, cz });
    const key = cellKey(cx, cy, cz);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [body.id]);
    else bucket.push(body.id);
  }

  const pairs: Pair[] = [];
  // Iterate bodies in id order. For each, scan its 27-cell neighborhood; only emit
  // pair `(body.id, otherId)` when `otherId > body.id`. This guarantees each pair
  // is emitted exactly once. Pairs are collected in neighborhood-scan order (dx→dy→dz
  // per body), then sorted below into the canonical (a, b) ascending order the
  // downstream narrowphase and momentum stages expect.
  for (let i = 0; i < sorted.length; i += 1) {
    const body = sorted[i]!;
    const cell = cellByBody.get(body.id)!;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = buckets.get(cellKey(cell.cx + dx, cell.cy + dy, cell.cz + dz));
          if (bucket === undefined) continue;
          for (let j = 0; j < bucket.length; j += 1) {
            const otherId = bucket[j]!;
            if (otherId > body.id) pairs.push({ a: body.id, b: otherId });
          }
        }
      }
    }
  }
  pairs.sort((p, q) => (p.a === q.a ? p.b - q.b : p.a - q.a));
  return pairs;
};
