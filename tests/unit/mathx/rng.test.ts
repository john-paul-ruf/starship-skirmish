// rng — the properties that matter for determinism (architecture §7.2, §7.3).
//
//   1. Order-independence.   Draw a fixed set of (seed, coords) values in normal
//      order and again in a shuffled order → identical results, per coord. This is
//      the unit-scale mirror of the NFR-Correctness whole-turn shuffle test.
//
//   2. Distribution sanity.  Mean of many draws is close to 0.5; bucketed histogram
//      is roughly uniform. Cheap smoke test that the mixer doesn't collapse.
//
//   3. Frozen vectors.       A hardcoded (seed, coords) → uint32 table is exact.
//      Any silent change to the RNG stream fails this test — which is exactly what
//      we want, because a stream change invalidates every recorded golden trace.

import { describe, it, expect } from 'vitest';
import { seedOf, hash, rand01, randRange, randInt, type Seed } from '../../../src/sim/mathx/rng.js';

const SEED_A: Seed = seedOf(0x12345678, 0x9abcdef0);
const SEED_B: Seed = seedOf(0xdeadbeef, 0xcafebabe);

// Deterministic in-place Fisher-Yates using a separate scramble sequence so the
// test's own shuffle order is stable across runs but not correlated with the RNG
// under test.
const shuffled = <T>(items: readonly T[]): T[] => {
  const out = items.slice();
  // Linear-congruential (Numerical Recipes) — good enough to permute a small array
  // without pulling in the RNG we're supposed to be testing.
  let s = 0x1a2b3c4d;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1)) | 0;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
};

describe('seedOf', () => {
  it('canonicalizes to uint32', () => {
    const s = seedOf(-1, -2); // -1 as uint32 == 0xFFFFFFFF
    expect(s.hi).toBe(0xffffffff);
    expect(s.lo).toBe(0xfffffffe);
  });
});

describe('hash — determinism and coord sensitivity', () => {
  it('is a pure function: same inputs → same output', () => {
    expect(hash(SEED_A, 1, 2, 3)).toBe(hash(SEED_A, 1, 2, 3));
    expect(hash(SEED_A)).toBe(hash(SEED_A));
  });

  it('every output is a uint32 (>=0, <2^32, integer)', () => {
    for (let i = 0; i < 200; i += 1) {
      const h = hash(SEED_A, i, i * 3, i ^ 0xa5);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('coord count matters — hash(seed, 1) ≠ hash(seed, 1, 0)', () => {
    expect(hash(SEED_A, 1)).not.toBe(hash(SEED_A, 1, 0));
  });

  it('coord order matters — hash(seed, 1, 2) ≠ hash(seed, 2, 1)', () => {
    expect(hash(SEED_A, 1, 2)).not.toBe(hash(SEED_A, 2, 1));
  });

  it('seed matters — different seeds ⇒ different streams', () => {
    // Not a guarantee for a single coord (collisions exist), so check many.
    let sameCount = 0;
    for (let i = 0; i < 100; i += 1) {
      if (hash(SEED_A, i) === hash(SEED_B, i)) sameCount += 1;
    }
    expect(sameCount).toBeLessThan(2); // expected collisions ≈ 100 / 2^32 ≈ 0
  });
});

describe('hash — ORDER INDEPENDENCE (the load-bearing property)', () => {
  it('draws computed in a shuffled order match draws computed in original order, per coord', () => {
    // Build a set of distinct (turn, beat, streamTag, entityId, drawIndex) coordinates.
    type Row = { readonly key: string; readonly coords: readonly number[] };
    const rows: Row[] = [];
    for (let entity = 0; entity < 20; entity += 1) {
      for (let draw = 0; draw < 5; draw += 1) {
        for (const stream of [0xaa, 0xbb, 0xcc]) {
          rows.push({
            key: `${entity}-${draw}-${stream}`,
            coords: [1, 2, stream, entity, draw],
          });
        }
      }
    }

    const inOrder = new Map<string, number>();
    for (const r of rows) inOrder.set(r.key, hash(SEED_A, ...r.coords));

    const shuffledRows = shuffled(rows);
    const outOfOrder = new Map<string, number>();
    for (const r of shuffledRows) outOfOrder.set(r.key, hash(SEED_A, ...r.coords));

    // Every key produced the same value regardless of evaluation order.
    expect(outOfOrder.size).toBe(inOrder.size);
    for (const [k, v] of inOrder) {
      expect(outOfOrder.get(k)).toBe(v);
    }
  });
});

describe('rand01 — range and distribution', () => {
  it('always in [0, 1)', () => {
    for (let i = 0; i < 5000; i += 1) {
      const r = rand01(SEED_A, i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('mean ≈ 0.5 over 10 000 draws', () => {
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i += 1) sum += rand01(SEED_A, i);
    const mean = sum / N;
    // Std of a uniform sample mean is sqrt(1/(12N)) ≈ 0.0029 for N=10000. 5σ ≈ 0.015.
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.015);
  });

  it('histogram is roughly uniform (each of 10 buckets holds 10 % ± 3 % of 10k draws)', () => {
    const N = 10000;
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < N; i += 1) {
      const r = rand01(SEED_A, i, 0xf0);
      const b = Math.min(9, Math.trunc(r * 10));
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    // Under uniform sampling, each bucket has p=0.1 with std sqrt(p(1-p)/N) ≈ 0.003.
    // ±3 % is ≈ 10σ — comfortable margin, still tight enough to catch a real defect.
    for (const b of buckets) {
      expect(b / N).toBeGreaterThan(0.07);
      expect(b / N).toBeLessThan(0.13);
    }
  });
});

describe('randRange', () => {
  it('always in [min, max)', () => {
    for (let i = 0; i < 500; i += 1) {
      const v = randRange(SEED_A, -3, 7, i);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('degenerate range returns min', () => {
    expect(randRange(SEED_A, 5, 5, 1)).toBe(5);
    expect(randRange(SEED_A, 5, 2, 1)).toBe(5);
  });
});

describe('randInt', () => {
  it('always integer in [minIncl, maxExcl)', () => {
    for (let i = 0; i < 500; i += 1) {
      const v = randInt(SEED_A, 0, 6, i);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('every value in the range is reachable', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(randInt(SEED_A, 0, 6, i));
    for (let k = 0; k < 6; k += 1) expect(seen.has(k)).toBe(true);
  });

  it('degenerate range returns minInclusive', () => {
    expect(randInt(SEED_A, 4, 4, 1)).toBe(4);
    expect(randInt(SEED_A, 4, 2, 1)).toBe(4);
  });
});

describe('FROZEN VECTORS — a stream change fails CI on purpose', () => {
  // These values were computed by the current mix32/hash implementation. If they
  // change, every recorded golden trace becomes stale — that is intentional. Update
  // this table ONLY as part of a documented, coordinated stream-version bump.
  const FROZEN: ReadonlyArray<{
    seed: Seed;
    coords: readonly number[];
    expected: number;
  }> = [
    { seed: SEED_A, coords: [], expected: 0x08ccdf3a },
    { seed: SEED_A, coords: [0], expected: 0x9e3d115e },
    { seed: SEED_A, coords: [1, 2, 3], expected: 0x607cbd04 },
    { seed: SEED_A, coords: [1, 2, 3, 4, 5], expected: 0x56c547b3 },
    { seed: SEED_B, coords: [0, 0, 0, 0, 0], expected: 0xa40a6479 },
    { seed: seedOf(0, 0), coords: [0], expected: 0x33ab0bbf },
    { seed: seedOf(1, 0), coords: [1, 1, 1], expected: 0xaaabf7b7 },
  ];

  it('has the expected uint32 for every (seed, coords) row', () => {
    const actual = FROZEN.map((row) => ({
      key: `seed(${row.seed.hi.toString(16)},${row.seed.lo.toString(16)}) coords=${JSON.stringify(row.coords)}`,
      got: hash(row.seed, ...row.coords),
      want: row.expected,
    }));
    // If the FROZEN.expected values are placeholder zeros, this test's failure message
    // will list the real values verbatim so the table can be updated.
    for (const a of actual) {
      expect(a.got, `FROZEN mismatch @ ${a.key} — actual=0x${a.got.toString(16)}`).toBe(a.want);
    }
  });
});
