// tools/balance/scenario.ts — the harness's scenario primitive (Gate 1b, FR-33).
//
// A `Scenario` is a plain, JSON-serializable record: seed, physics config, initial
// bodies, per-beat movement plans, and how many beats to run. `runScenario` drives
// `resolveMovement` for that many beats, threading `finalBodies` from one beat into
// the next. Nothing else — this is the whole surface at physics scope.
//
// SHAPE STABILITY. This file's exported shapes (`Scenario`, `ScenarioResult`) are
// what fixtures serialize against and what F4's full-`Match` runner will extend
// WITHOUT rewriting. F4 adds a discriminated-union sibling `MatchScenario` alongside
// this `PhysicsScenario`; the fixture format grows a `kind` tag and the runner
// dispatches. That evolution costs a `Scenario = Physics | Match` union in the type
// and a two-branch switch in `runScenario` — nothing here needs to change.
//
// The runner and the digest (`./digest.ts`) between them ARE the harness. Everything
// else (CLI, aggregator, purity check, tests) is scaffolding around this core.
//
// Import discipline (FR-33 / architecture §7.5):
//   - This module imports from `src/sim/**` ONLY.
//   - Anything from `three`, `preact`, `document`, or any other npm runtime is a
//     structural violation caught by `purity-check.ts`.

import type { Body, MovementPlan } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import type { Seed } from '../../src/sim/mathx/index.js';
import { resolveMovement, type StepResult } from '../../src/sim/physics/index.js';

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
 * Discriminated-union alias so downstream fixtures + the digest module never bind
 * to the concrete `PhysicsScenario` name. When F4 introduces `MatchScenario`, this
 * becomes `Scenario = PhysicsScenario | MatchScenario` and `runScenario` gains a
 * `kind`-switch — no consumer signature changes.
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
 * Contract:
 *   - `scenario.bodies` is the pre-beat-0 snapshot.
 *   - For beat `i` in `[0, scenario.beats)`:
 *       plans_i = scenario.plansPerBeat[i] ?? []
 *       step_i  = resolveMovement(current, plans_i, scenario.config)
 *       current = step_i.finalBodies
 *   - The scenario struct itself is never mutated.
 *
 * The seed is currently carried but not consumed — physics is deterministic without
 * it. F4's `MatchScenario` uses the seed to drive missile targeting / bot draws;
 * putting it on `Scenario` now keeps the shape stable across that extension.
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
