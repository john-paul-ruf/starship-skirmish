// tools/balance/scenario.ts — the harness's scenario primitive (Gate 1b, FR-33).
//
// A `Scenario` is a plain, JSON-serializable record: seed, physics config, initial
// bodies, per-beat movement plans, and how many beats to run. `runScenario` drives
// `resolveMovement` for that many beats, threading `finalBodies` from one beat into
// the next. That is the physics-scope surface.
//
// SHAPE STABILITY. This file's exported shapes are the surfaces fixtures serialize
// against and the CLI + aggregator depend on. F5 (S05) EXTENDS them additively —
// a NEW `MatchScenario` type sits alongside `PhysicsScenario`, and a NEW async
// `runMatchScenario` runs a full bot-vs-bot match. The pre-existing sync
// `runScenario`, `Scenario` alias, and physics-scope shapes stay BYTE-COMPATIBLE
// — physics callers see no signature change. (The F4 seam note predicted a
// widened `Scenario = PhysicsScenario | MatchScenario` union — the S05 deviation
// is documented at the `Scenario` alias below; the pre-S05 determinism tests
// read `.bodies` off a `Scenario` and are outside this session's lease, so the
// union widening is deferred to a follow-up that owns those files too.)
//
// The physics-scope runner and the digest (`./digest.ts`) are the harness core; the
// match-scope runner lives beside them for the FR-33 win-rate / usage-rate report.
//
// Import discipline (FR-33 / architecture §7.5):
//   - This module imports from `src/sim/**`, `src/ai/**` (the barrel — S05),
//     `src/domain/**`, `src/catalog/**`. All are pure / determinism-safe.
//   - Anything from `three`, `preact`, `document`, or any other npm runtime is a
//     structural violation caught by `purity-check.ts`. String literals in this
//     file MUST avoid those substrings too — the check greps the bundle text.

import type { Body, MovementPlan } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import type { Seed } from '../../src/sim/mathx/index.js';
import { hash } from '../../src/sim/mathx/index.js';
import { resolveMovement, type StepResult } from '../../src/sim/physics/index.js';

// ---- S05 match-scope imports (deliberately additive) ----------------------
import type { Catalog } from '../../src/catalog/index.js';
import type { Build } from '../../src/domain/index.js';
import {
  combatConfigFromTuning,
  physicsConfigFromTuning,
  resolveArena,
  resolveFleet,
  validateFit,
} from '../../src/domain/index.js';
import {
  buildInitialState,
  matchDigest,
  runTurn,
  type MatchConfig,
  type MatchOutcome,
} from '../../src/sim/index.js';
import type { Commander } from '../../src/sim/loop/index.js';
import { HeuristicCommander, generateBotFleet, type BotTier } from '../../src/ai/index.js';

/**
 * A recorded physics scenario. Everything here is `JSON.stringify`-safe by
 * construction: `Body` / `MovementPlan` / `Vec3` are all plain-number records; `Seed`
 * is `{ hi, lo }`; `PhysicsConfig` is a plain struct with a nested `Arena`.
 *
 * The `plansPerBeat[i]` list is applied on beat `i`. Missing / short arrays coast
 * the affected beats (empty plan list = ballistic advance under whatever momentum
 * survived the previous beat). This is the cheapest shape that covers "plan on
 * beat 0 only" (typical for a fixture) and "re-plan every beat" (typical for a
 * bot-vs-bot match, once F4 lands) without a schema change.
 */
export interface PhysicsScenario {
  readonly kind: 'physics';
  readonly name: string;
  readonly seed: Seed;
  readonly config: PhysicsConfig;
  readonly bodies: readonly Body[];
  readonly plansPerBeat: readonly (readonly MovementPlan[])[];
  readonly beats: number;
}

/**
 * Physics-scope alias for `PhysicsScenario`. Kept as a distinct name so
 * `runScenario(scenario: Scenario)` reads without depending on which concrete
 * variant is the physics one.
 *
 * S05 DEVIATION from the F4 seam note (`arch/M17-harness.md:98`) — the seam
 * predicted `Scenario = PhysicsScenario | MatchScenario`. The pre-S05
 * determinism tests (`tests/determinism/shuffle.test.ts`, `tunneling.test.ts`,
 * `fixtureLoader.ts`) read `.bodies` / `.plansPerBeat` off a `Scenario`, which
 * only exist on `PhysicsScenario`; widening the union would fail their
 * typecheck. Those files are OUTSIDE S05's lease, so the pragmatic choice is
 * to keep `Scenario = PhysicsScenario` and introduce `MatchScenario` as its
 * own peer type — `runMatchScenario(scenario: MatchScenario, catalog)` is the
 * match-scope entry. S06 (or a later refactor) can widen the union and
 * migrate the physics-scope tests in one lease.
 */
export type Scenario = PhysicsScenario;

/**
 * One beat's worth of output, plus the input plan snapshot. Keeping the plans on
 * the result makes the trace self-describing for the digest and for future combat-
 * log emission (M11) without needing to re-derive them.
 */
export interface BeatOutcome {
  readonly beat: number;
  readonly plans: readonly MovementPlan[];
  readonly step: StepResult;
}

/**
 * Full deterministic result of a scenario. `beats.length` is always equal to the
 * scenario's `beats` count; if bodies die mid-run the later beats just have a
 * shrinking `step.finalBodies` list.
 */
export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly beats: readonly BeatOutcome[];
  /** `beats[last].step.finalBodies` — surfaced for convenience. */
  readonly finalBodies: readonly Body[];
}

/**
 * Deterministic scenario runner. Pure function of its input scenario.
 *
 * Contract (physics-scope, byte-compatible with pre-S05 callers):
 *   - `scenario.bodies` is the pre-beat-0 snapshot.
 *   - For beat `i` in `[0, scenario.beats)`:
 *       plans_i = scenario.plansPerBeat[i] ?? []
 *       step_i  = resolveMovement(current, plans_i, scenario.config)
 *       current = step_i.finalBodies
 *   - The scenario struct itself is never mutated.
 *
 * The seed is carried but not consumed — physics is deterministic without it.
 * `MatchScenario` uses the seed to drive fleet generation + missile targeting;
 * its runner is the separate async `runMatchScenario` below (D-MATCH-SCENARIO).
 */
export const runScenario = (scenario: Scenario): ScenarioResult => {
  let current: readonly Body[] = scenario.bodies;
  const beats: BeatOutcome[] = [];
  for (let i = 0; i < scenario.beats; i += 1) {
    const plans = scenario.plansPerBeat[i] ?? [];
    const step = resolveMovement(current, plans, scenario.config);
    beats.push({ beat: i, plans, step });
    current = step.finalBodies;
  }
  return { scenario, beats, finalBodies: current };
};

// ===========================================================================
// S05 — Match scenario (bot-vs-bot, FR-33).
// ===========================================================================
//
// D-MATCH-SCENARIO: a `MatchScenario` carries `{ seed, budget, fleetTiers[] }` —
// tiers, NOT serialized builds. `runMatchScenario` REGENERATES fleets via
// `generateBotFleet` so the whole generate → validate → resolve → run pipeline
// is under one determinism lock and fixtures stay tiny (S06 anchor).
//
// The runner is ASYNC — `runTurn` is async (M10) because the `Commander`
// interface accepts sync-or-Promise plans (FR-17). Keeping a separate async
// entry point leaves the sync physics `runScenario` byte-compatible for its
// existing callers (STATE.md D-MATCH-SCENARIO — small deviation from the F4
// seam note, which predated knowing `runTurn` is async).

/**
 * A bot-vs-bot match recipe. Deterministic in `(seed, budget, fleetTiers,
 * catalog)`: same recipe ⇒ same fleets ⇒ same plans ⇒ byte-identical per-turn
 * digests. Fixture-sized: tiers + seed + budget only, no serialized builds.
 *
 * `fleetTiers.length` is the number of fleets in the match (2..maxFleets).
 * Each fleet is drawn from the ONE shared catalog at the same numeric budget
 * — FR-29 / FR-30 (tiers are variety-only inputs, no stat advantage).
 */
export interface MatchScenario {
  readonly kind: 'match';
  readonly name: string;
  readonly seed: Seed;
  readonly budget: number;
  readonly fleetTiers: readonly BotTier[];
}

/**
 * One resolved bot fleet as it entered the match. Carried in the result so the
 * aggregator can key win-rate by `chassisId` and usage-rate by `componentId`
 * without re-running `generateBotFleet` (which is deterministic but not free).
 */
export interface MatchFleetSnapshot {
  readonly fleetId: number;
  readonly tier: BotTier;
  readonly builds: readonly Build[];
}

/**
 * Full deterministic result of a match run. `outcome` is the M10 victory
 * discriminant (`victory` | `mutual-destruction`) plus its turn count.
 * `turnDigests[i]` is `matchDigest(state after turn i)` — the exact shape the
 * combat golden replays against (S06 anchors on this).
 */
export interface MatchScenarioResult {
  readonly scenario: MatchScenario;
  readonly outcome: MatchOutcome;
  readonly turnDigests: readonly string[];
  readonly fleets: readonly MatchFleetSnapshot[];
}

// Sub-stream tag for deriving per-fleet `generateBotFleet` keys from the match
// seed. A distinct tag keeps fleet-key draws in their own RNG corner so they
// can never alias in-match streams (placement, planning, attack).
const STREAM_MATCH_FLEET_KEY = 0xf1eec0de;

/**
 * Runaway-test safety valve — NOT a game rule. FR-27 / Custom Rule 5 forbid a
 * turn cap; this bound only exists so a test bug (infinite match) fails fast
 * instead of hanging CI. Sized well above any plausible match length.
 */
const MATCH_RUNAWAY_GUARD = 500;

/**
 * Run one match scenario end-to-end. Regenerates fleets from the seed +
 * budget + tiers so a `MatchScenario` fully determines its outcome (given a
 * fixed catalog). Drives the pure `runTurn` loop and collects a `matchDigest`
 * per turn — the exact record shape S06's fixtures anchor against.
 *
 * Steps (deterministic in listed order):
 *   1. Per fleet `i`: `rngKey = hash(seed, i, STREAM_MATCH_FLEET_KEY)`;
 *      `builds = generateBotFleet(catalog, budget, tier, rngKey)`.
 *   2. Every build re-runs `validateFit` at the domain seam (S02 followUp
 *      — bot output is `Build[]`, not `ValidatedBuild[]`). A validation
 *      failure here signals a catalog-lock invariant break, not a bot bug;
 *      throw with the fleet index for diagnosis.
 *   3. `resolveFleet(catalog, i, validated)` per fleet.
 *   4. Assemble `MatchConfig` from `resolveArena` + `physicsConfigFromTuning`
 *      + `combatConfigFromTuning` (D-PHYSICS-INJECT: the SAME configs the
 *      match itself consumes, so the commander's boundary-safety previews
 *      match the runtime resolver exactly — FR-29 AoE parity).
 *   5. One `HeuristicCommander` per fleet, passing physics + combat
 *      uniformly (only ace consults combat; passing it everywhere is cheaper
 *      than per-tier branching and future-proof for veteran/rookie widening).
 *   6. Drive `runTurn` in a loop until the outcome is set; push
 *      `matchDigest(state)` per turn; break when outcome !== null.
 */
export const runMatchScenario = async (
  scenario: MatchScenario,
  catalog: Catalog,
): Promise<MatchScenarioResult> => {
  const tuning = catalog.tuning;
  const arena = resolveArena(tuning, scenario.budget);
  const physics = physicsConfigFromTuning(tuning, scenario.budget);
  const combat = combatConfigFromTuning(tuning);

  const fleets: MatchFleetSnapshot[] = [];
  const simFleets = [];
  const commanders: Commander[] = [];

  for (let i = 0; i < scenario.fleetTiers.length; i += 1) {
    const tier = scenario.fleetTiers[i]!;
    const rngKey = hash(scenario.seed, i >>> 0, STREAM_MATCH_FLEET_KEY);
    const builds = generateBotFleet(catalog, scenario.budget, tier, rngKey);

    const validated = [];
    for (let bi = 0; bi < builds.length; bi += 1) {
      const b = builds[bi]!;
      const fit = validateFit(catalog, b);
      if (!fit.ok) {
        throw new Error(
          `runMatchScenario: fleet ${i} build ${bi} failed validateFit — catalog-lock invariant break (bot output should be legal by construction).`,
        );
      }
      validated.push(fit.value);
    }

    simFleets.push(resolveFleet(catalog, i, validated));
    fleets.push({ fleetId: i, tier, builds });
    commanders.push(new HeuristicCommander(i, tier, physics, combat));
  }

  const config: MatchConfig = {
    seed: scenario.seed,
    fleets: simFleets,
    arena,
    physics,
    combat,
  };

  let state = buildInitialState(config);
  const turnDigests: string[] = [];
  let outcome: MatchOutcome | null = null;
  while (outcome === null) {
    if (turnDigests.length >= MATCH_RUNAWAY_GUARD) {
      throw new Error(
        `runMatchScenario: exceeded ${MATCH_RUNAWAY_GUARD} turns — runaway match (test-only guard, not a game rule per FR-27).`,
      );
    }
    const r = await runTurn(state, commanders);
    state = r.state;
    turnDigests.push(matchDigest(state));
    outcome = r.outcome;
  }

  return { scenario, outcome, turnDigests, fleets };
};

