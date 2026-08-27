// M16 App — the match-config assembly seam (S01 CP3).
//
// `assembleMatchConfig` is the pure domain seam that turns a chosen player
// fleet + a set of `BotSpec`s into the sim's `MatchConfig`. It is the exact
// analog of the balance harness's `runMatchScenario` prologue (generate →
// validate → resolve → assemble), kept in `app` because it composes catalog +
// domain + ai (all of which `app` may import) into the plain sim struct the
// controller drives.
//
// Seed minting lives here too (`mintSeed`) because `crypto.getRandomValues` is
// an `app`-only capability (arch §7.2) — the ONE site in the match pipeline.
// The setup screen never mints a seed; it hands `startMatch` a `MatchSetup`
// and the app mints + assembles.

import type { Catalog, Tuning } from '../../catalog/index.js';
import {
  combatConfigFromTuning,
  physicsConfigFromTuning,
  resolveArena,
  resolveFleet,
  validateFit,
  type Build,
  type ValidatedBuild,
} from '../../domain/index.js';
import { generateBotFleet } from '../../ai/index.js';
import { seedOf, type MatchConfig, type Seed, type SimFleet } from '../../sim/index.js';
import type { BotSpec } from '../../ui/matchContext.js';

/** The player's fleet is always roster 0; bot fleets take `1..N` in order. */
export const PLAYER_FLEET_ID = 0;

/**
 * Mint a fresh match seed. The single `crypto.getRandomValues` site in the
 * match pipeline (arch §7.2 — RNG entropy is an `app`-only capability). Two
 * uint32 draws become the `Seed`'s `hi` / `lo` halves; everything downstream
 * (placement, rolls) is a pure function of this seed, so `mintSeed` is the
 * only non-determinism in a whole match.
 */
export const mintSeed = (): Seed => {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return seedOf(buf[0]!, buf[1]!);
};

/**
 * Validate every build in a roster, throwing on the first illegal one. A build
 * that fails here is a CALLER bug — the setup screen (S04) must gate LAUNCH on
 * fit-legality (FR-5), and `generateBotFleet` is legal by construction (FR-31).
 * Reaching this throw means an invariant upstream broke, so failing loud (not a
 * silent drop) is correct.
 */
const validateRoster = (
  catalog: Catalog,
  builds: readonly Build[],
  label: string,
): ValidatedBuild[] => {
  const validated: ValidatedBuild[] = [];
  for (let i = 0; i < builds.length; i += 1) {
    const fit = validateFit(catalog, builds[i]!);
    if (!fit.ok) {
      throw new Error(
        `assembleMatchConfig: ${label} build ${i} failed validateFit — ` +
          `${fit.error.map((e) => e.code).join(', ')} (setup must gate on fit-legality).`,
      );
    }
    validated.push(fit.value);
  }
  return validated;
};

/**
 * Assemble the sim's `MatchConfig` from a chosen player fleet + bot specs. Pure
 * (the only entropy is the `seed` argument, minted by `mintSeed` at the call
 * site). Steps mirror `tools/balance/scenario.ts::runMatchScenario`:
 *
 *   1. `validateFit` every player build (fleetId 0) → `resolveFleet`.
 *   2. Per `BotSpec i` (fleetId `i + 1`): `generateBotFleet(catalog, budget,
 *      tier, rngKey)` → validate → `resolveFleet`.
 *   3. `resolveArena` / `physicsConfigFromTuning` / `combatConfigFromTuning`
 *      from the budget.
 *   4. Return `{ seed, fleets, arena, physics, combat }`.
 *
 * `tuning` is `catalog.tuning`; it is passed explicitly so the seam reads as a
 * pure function of its inputs (mirrors the domain resolvers' signatures).
 */
export const assembleMatchConfig = (
  catalog: Catalog,
  tuning: Tuning,
  budget: number,
  seed: Seed,
  playerBuilds: readonly Build[],
  botSpecs: readonly BotSpec[],
): MatchConfig => {
  const fleets: SimFleet[] = [];

  // Player fleet — roster 0.
  const validatedPlayer = validateRoster(catalog, playerBuilds, 'player');
  fleets.push(resolveFleet(catalog, PLAYER_FLEET_ID, validatedPlayer));

  // Bot fleets — roster 1..N, in setup order.
  for (let i = 0; i < botSpecs.length; i += 1) {
    const spec = botSpecs[i]!;
    const fleetId = PLAYER_FLEET_ID + 1 + i;
    const botBuilds = generateBotFleet(catalog, budget, spec.tier, spec.rngKey);
    const validatedBot = validateRoster(catalog, botBuilds, `bot ${fleetId}`);
    fleets.push(resolveFleet(catalog, fleetId, validatedBot));
  }

  return {
    seed,
    fleets,
    arena: resolveArena(tuning, budget),
    physics: physicsConfigFromTuning(tuning, budget),
    combat: combatConfigFromTuning(tuning),
  };
};
