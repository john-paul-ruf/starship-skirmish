# M04 — Sim: Math Core (as built)

> Architecture-as-built detail for module M04. Session-marked; appended by Jikijitsu from each
> worker's arch fragment. Note: `program/` is gitignored, so this file is disk-only (not in git history).

<!-- SESSION-02 -->
### M04 — `src/sim/mathx/` (Sim: Math Core)

Leaf of the sim dependency tree. Imports nothing (not other modules, not npm). Every
export is a pure function of its arguments and uses only IEEE-exact primitives
(`+ - * /`, `Math.sqrt`, `Math.trunc`, `Math.imul`) — so identical inputs produce
bit-identical outputs on every JS engine.

#### Public surface — `src/sim/mathx/index.ts`

**Types**
- `Vec3` — `readonly { x: number; y: number; z: number }` (plain-number record, no
  `Float32Array`/mixed widths).
- `Seed` — `readonly { hi: number; lo: number }` uint32 pair. Constructed via
  `seedOf(hi, lo)`; the constructor canonicalizes both fields with `>>> 0`.

**Vec3 algebra** (`vec3.ts`)
- Constants: `ZERO`, `UNIT_X`, `UNIT_Y`, `UNIT_Z`
- Constructors: `of(x, y, z)`
- Ops: `add`, `sub`, `scale`, `neg`, `dot`, `cross`, `length`, `lengthSq`,
  `normalize`, `lerp`, `distance`, `distanceSq`, `clampLength(a, maxLen)`, `equals`
- `normalize(ZERO) === ZERO` (no NaN escapes); `clampLength` with non-positive
  `maxLen` collapses to `ZERO`.

**Deterministic transcendentals** (`trig.ts`)
- Constants: `PI`, `TAU`, `HALF_PI`, `QUARTER_PI`, `DEG_TO_RAD`, `RAD_TO_DEG`
- `sin(x)`, `cos(x)`: range-reduce to `[-π, π]` via `x - TAU * roundNearest(x/TAU)`
  (`Math.trunc`-based), fold to `[-π/2, π/2]`, then a degree-15 Taylor kernel.
  **Max |error| < 1e-9 verified over 10 001 samples on `[-4π, 4π]`.**
- `atan2(y, x)`: octant reduction so the kernel sees `|t| ≤ tan(π/8)`, then a
  degree-11 Taylor kernel with a `π/4 + atan((t-1)/(t+1))` half-angle shift.
  **Max |error| < 1e-6 verified on a 201×201 grid over `[-4, 4]²`.**
  *Signed-zero identities of `Math.atan2` are NOT preserved; callers must
  canonicalize inputs. `atan2(0, 0)` returns `0`.*
- `powi(base, exp)`: integer exponent via binary exponentiation (no
  `Math.pow`/`Math.exp`/`Math.log`). Handles negatives (reciprocal).
- `powHalf(base, halves)`: `base^(halves/2)` = `powi(base, halves >> 1)` × optional
  `Math.sqrt(base)`. Handles negatives.
- `dirFromBearingPitch(bearingDeg, pitchDeg): Vec3` — Y-up right-handed unit
  vector for arc plotting (FR-18). Convention: `(0, 0) → +X`, `(90°, 0) → +Z`,
  `(0, 90°) → +Y`.

**Counter-based RNG** (`rng.ts`)
- `seedOf(hi, lo): Seed`
- `hash(seed, ...coords: number[]): uint32` — SplitMix32-style avalanche (mixing
  constants `M1 = 0x21f0aaad`, `M2 = 0x735a2d97`, spacer `GOLDEN = 0x9e3779b9`),
  `Math.imul` for exact int32 multiplication. Every coord is `>>> 0`'d; coord
  count is folded into the final mix so `hash(s, 1) ≠ hash(s, 1, 0)`.
- `rand01(seed, ...coords)` → `[0, 1)` (uint32 / 2³²)
- `randRange(seed, min, max, ...coords)` → `[min, max)`; degenerate range → `min`
- `randInt(seed, minIncl, maxExcl, ...coords)` → integer; degenerate range → `minIncl`

#### Determinism guarantees

1. **Order independence.** No sequential internal state anywhere in this module.
   `hash(seed, ...coords)` is a pure function; two callers with the same inputs
   see the same value regardless of when they evaluate. This is the unit-scale
   root of the NFR-Correctness whole-turn shuffle test.
2. **Cross-engine identity.** All ops are `+ - * / sqrt trunc imul` — the ECMA
   spec pins these bit-exact. Physics/rules that build on `mathx` inherit the
   guarantee for free.
3. **Frozen RNG stream.** `tests/unit/mathx/rng.test.ts` locks seven
   `(seed, coords) → uint32` vectors. A silent stream change (mixing-constant
   edit, coord absorption reorder) fails CI on purpose — because it would
   invalidate every recorded golden trace downstream.

Note: `Math.imul` is banned in some determinism ban-lists but is fine here — its
result is spec-defined two's-complement int32, same on every engine. It is *not*
on the sim ban-list in `eslint.config.js`.
