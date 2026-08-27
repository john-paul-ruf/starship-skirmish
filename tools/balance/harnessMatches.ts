// tools/balance/harnessMatches.ts — the seeded match-scenario factory (S05 CP2).
//
// Mirrors `harnessScenarios.ts` for the match scope. `seedToMatch(n, catalog,
// opts?)` turns one integer `n` into a full `MatchScenario` — reproducible per
// seed, distinct across seeds. The CLI iterates `n = start..end` to run a batch
// of matches; S06 records goldens off the same factory so a fixture is a small
// integer plus a legal budget + a tier list, not a serialized `Build[]`.
//
// Determinism:
//   • Uses only `mathx.rng` (`seedOf` / `hash` / `randInt`) — no wall clock,
//     no `Math.random`. Same `n` + same `opts` ⇒ same `MatchScenario`.
//   • The `Seed` is derived by the SAME twice-hash pattern as
//     `harnessScenarios.deriveSeed` (`hash(BASE, n, tag_hi)` for `hi`,
//     `hash(BASE, n, tag_lo)` for `lo`) — a naive `seedOf(n, ~n ^ c)` aliases
//     across `n` and `n + 4` in the mixer.
//   • Budget and fleet count are drawn from `n` when not supplied; both
//     draws use their own sub-stream tag so a budget flip and a fleet-count
//     flip stay independent.
//
// Catalog is a required second argument because legal budgets and fleet-count
// bounds live in `tuning.match`; the negative-space invariant (Custom Rule 4)
// forbids inventing a private budget table here.
//
// Import discipline (FR-33 / architecture §7.5):
//   Imports only from `src/sim/mathx`, `src/ai` (barrel), `src/catalog` types,
//   and this directory's `scenario.ts`. No npm runtime, no render, no DOM.

import { hash, randInt, seedOf, type Seed } from '../../src/sim/mathx/index.js';
import { BOT_TIERS, type BotTier } from '../../src/ai/index.js';
import type { Catalog } from '../../src/catalog/index.js';
import type { MatchScenario } from './scenario.js';

// Fixed base seed for deriving a well-mixed 64-bit match seed from one
// integer. See `harnessScenarios.DERIVE_BASE` for the aliasing rationale;
// this is the match-scope peer, with distinct bit constants so match seeds
// and physics-scenario seeds never coincide by accident.
const MATCH_DERIVE_BASE = seedOf(0xb01dface, 0x0ff1cec0);

/** Sub-stream tags for the per-scenario derived draws. Distinct uint32s so
 *  budget and fleet-count draws never collide with the seed halves. */
const SUB_SEED_HI = 0xa;
const SUB_SEED_LO = 0xb;
const SUB_BUDGET = 0xc;
const SUB_FLEET_COUNT = 0xd;
const SUB_TIER = 0xe;

/** Derive a match Seed from `n`, using two independent hash draws to fill
 *  the two uint32 halves — inherits the sim's own avalanche. */
export const deriveMatchSeed = (n: number): Seed =>
  seedOf(
    hash(MATCH_DERIVE_BASE, n >>> 0, SUB_SEED_HI),
    hash(MATCH_DERIVE_BASE, n >>> 0, SUB_SEED_LO),
  );

/**
 * Optional overrides for `seedToMatch`. Any field left undefined is drawn
 * from `n` — the whole scenario stays a pure function of its inputs.
 *
 *   • `budget`      — if omitted, drawn uniformly from
 *     `catalog.tuning.match.legalBudgets`.
 *   • `fleetTiers`  — if omitted, drawn as: fleet count in
 *     `[minFleets, maxFleets]` (uniform), each tier drawn independently
 *     from `BOT_TIERS` (uniform).
 */
export interface SeedToMatchOpts {
  readonly budget?: number;
  readonly fleetTiers?: readonly BotTier[];
}

/**
 * Turn one integer `n` into a full `MatchScenario`. Deterministic in
 * `(n, opts, catalog.tuning.match)`. The name is `match-${n}` — stable in
 * `n` so a CLI batch's output stays sortable and diff-friendly (mirrors
 * `harnessScenarios.seedToScenario` naming).
 *
 * Runs pure — no filesystem, no wall clock.
 */
export const seedToMatch = (
  n: number,
  catalog: Catalog,
  opts: SeedToMatchOpts = {},
): MatchScenario => {
  const seed = deriveMatchSeed(n);
  const tuning = catalog.tuning.match;

  const budget = opts.budget ?? pickLegalBudget(seed, tuning.legalBudgets);
  const fleetTiers =
    opts.fleetTiers ?? pickFleetTiers(seed, tuning.minFleets, tuning.maxFleets);

  // Guardrails on caller-supplied opts — helpful error over silent misuse.
  if (fleetTiers.length < tuning.minFleets || fleetTiers.length > tuning.maxFleets) {
    throw new Error(
      `seedToMatch: fleetTiers length ${fleetTiers.length} outside [${tuning.minFleets}, ${tuning.maxFleets}].`,
    );
  }
  if (!tuning.legalBudgets.includes(budget)) {
    throw new Error(
      `seedToMatch: budget ${budget} not in tuning.match.legalBudgets.`,
    );
  }

  return {
    kind: 'match',
    name: `match-${n}`,
    seed,
    budget,
    fleetTiers,
  };
};

/** Uniform pick over the legal budgets, seeded. */
const pickLegalBudget = (seed: Seed, legalBudgets: readonly number[]): number => {
  // `randInt` returns integer in [0, hi). Legal budgets are a small, ordered
  // list authored in tuning; a uniform index is the right prior.
  const idx = randInt(seed, 0, legalBudgets.length, SUB_BUDGET);
  return legalBudgets[idx]!;
};

/** Fleet-count in `[minFleets, maxFleets]` + independently seeded per-fleet
 *  tier picks from `BOT_TIERS`. */
const pickFleetTiers = (
  seed: Seed,
  minFleets: number,
  maxFleets: number,
): readonly BotTier[] => {
  // `randInt(seed, min, max, ...)` returns [min, max). Add 1 to make the
  // upper bound inclusive per the semantic range `[minFleets, maxFleets]`.
  const count = randInt(seed, minFleets, maxFleets + 1, SUB_FLEET_COUNT);
  const tiers: BotTier[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = randInt(seed, 0, BOT_TIERS.length, SUB_TIER, i);
    tiers.push(BOT_TIERS[idx]!);
  }
  return tiers;
};
