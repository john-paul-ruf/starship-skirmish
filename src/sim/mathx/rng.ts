// rng — counter-based RNG (architecture §7.2, §7.3).
//
// Every draw is a pure function of (seed, ...coords). NO sequential internal state —
// which means draw order is not observable, so the whole-turn shuffle test that
// NFR-Correctness demands passes by construction rather than by luck.
//
// The one-way mixing function is a SplitMix32-style avalanche implemented with
// `Math.imul` for exact int32 multiplication. `Math.imul` is defined by the ECMAScript
// spec to two's-complement wrap — one of the very few 32-bit-integer operations that
// IS bit-identical across V8 / SpiderMonkey / JSC. Multiplication with `*` on numbers
// > 2³² would silently lose precision; imul is the correct primitive here.
//
// Coordinate convention (from architecture §7.2):
//   coords = (turn, beat, streamTag, entityId, drawIndex)
// but the primitive accepts an arbitrary number of uint32s so future streams can add
// their own dimensions without a signature change. All coords are coerced with `>>> 0`
// to their unsigned-32-bit interpretation.

/**
 * A match seed — a pair of uint32s, generated once at match start from
 * `crypto.getRandomValues` (in `src/app/`, never in sim/ai). Displayed and recorded
 * per FR-12 so any match can be replayed by (seed, plans).
 */
export interface Seed {
  readonly hi: number;
  readonly lo: number;
}

/** Construct a Seed from any two 32-bit numbers, canonicalized to uint32. */
export const seedOf = (hi: number, lo: number): Seed => ({ hi: hi >>> 0, lo: lo >>> 0 });

// Mixing constants — SplitMix32 avalanche (Chris Wellons / bryc). Chosen for good
// bit diffusion across the low bits, which is what determines `rand01` uniformity.
const M1 = 0x21f0aaad | 0;
const M2 = 0x735a2d97 | 0;
const GOLDEN = 0x9e3779b9 | 0; // 2^32 / φ, used to space out identical inputs

/** Absorb one uint32 into the accumulator. Pure — no closure state. */
const mix32 = (acc: number, next: number): number => {
  let a = (acc + GOLDEN) | 0;
  a = a ^ (next >>> 0);
  a = Math.imul(a ^ (a >>> 16), M1);
  a = Math.imul(a ^ (a >>> 15), M2);
  return (a ^ (a >>> 15)) >>> 0;
};

/**
 * Hash (seed, ...coords) to a uint32. Deterministic, order-of-*call* independent —
 * two callers passing the same seed and coords see the same value regardless of
 * when they run relative to each other.
 *
 * The coord count is folded in at the end so `hash(seed, 1, 0)` ≠ `hash(seed, 1)`,
 * which matters when a variadic stream sometimes omits trailing zeros.
 */
export const hash = (seed: Seed, ...coords: number[]): number => {
  let acc = mix32(seed.hi >>> 0, seed.lo >>> 0);
  for (let i = 0; i < coords.length; i += 1) {
    acc = mix32(acc, coords[i]! >>> 0);
  }
  return mix32(acc, coords.length >>> 0);
};

// 2^32 — every hash is a uint32 in [0, 2^32), so dividing gives a uniform [0, 1).
const TWO_POW_32 = 4294967296;

/** Uniform double in [0, 1). Pure function of (seed, coords). */
export const rand01 = (seed: Seed, ...coords: number[]): number =>
  hash(seed, ...coords) / TWO_POW_32;

/** Uniform double in [min, max). If `max <= min`, returns `min`. */
export const randRange = (
  seed: Seed,
  min: number,
  max: number,
  ...coords: number[]
): number => {
  if (max <= min) return min;
  return min + rand01(seed, ...coords) * (max - min);
};

/**
 * Uniform integer in [minInclusive, maxExclusive). `Math.trunc` on the scaled
 * float is exact for the argument range we care about. If the interval is empty,
 * returns `minInclusive`.
 */
export const randInt = (
  seed: Seed,
  minInclusive: number,
  maxExclusive: number,
  ...coords: number[]
): number => {
  if (maxExclusive <= minInclusive) return minInclusive;
  const span = maxExclusive - minInclusive;
  return minInclusive + Math.trunc(rand01(seed, ...coords) * span);
};
