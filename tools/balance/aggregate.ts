// tools/balance/aggregate.ts — result aggregation skeleton (FR-33 acceptance).
//
// SESSION SCOPE. At physics scope there is no notion of "win", "chassis", or "fleet"
// yet — those concepts live in `sim/rules` and `sim/loop`, which land in F4. This
// module is the SHAPE that F4 will extend, plus the physics-scope aggregations we can
// compute today: per-scenario beat count, contact count, boundary-exit count.
//
// FR-33 promises "per-match outcome, turn count, and per-chassis/per-component
// win-rate and usage-rate aggregates." F4 grows this file:
//
//   `PerScenarioSummary`  → adds { winner, turns, chassisUsed[], componentsUsed[] }
//   `AggregateSummary`    → adds win-rate and usage-rate maps keyed by permanent id
//   `aggregate(results)`  → adds a reduce over those maps
//
// None of that changes the current API — extensions land as additional fields, not
// renamed ones. The physics-scope caller (`cli.ts`) reads only the fields defined here.

import type { ScenarioResult } from './scenario.js';

/**
 * Physics-scope summary of one scenario run. Fields present here survive into F4;
 * the match-scope additions (winner / turns) land as new optional fields.
 */
export interface PerScenarioSummary {
  readonly name: string;
  readonly beats: number;
  readonly contactCount: number;
  readonly exitCount: number;
  readonly survivors: number;
}

/**
 * Aggregation across many scenarios. Skeleton — F4 layers on win-rate and usage-rate
 * maps. Kept as a plain interface so `JSON.stringify` on this is a well-formed report.
 */
export interface AggregateSummary {
  readonly scenarioCount: number;
  readonly totalBeats: number;
  readonly totalContacts: number;
  readonly totalExits: number;
}

/** Reduce one scenario to its physics-scope summary. Pure. */
export const summarize = (result: ScenarioResult): PerScenarioSummary => {
  let contactCount = 0;
  let exitCount = 0;
  for (const beat of result.beats) {
    contactCount += beat.step.contacts.length;
    exitCount += beat.step.exits.length;
  }
  return {
    name: result.scenario.name,
    beats: result.beats.length,
    contactCount,
    exitCount,
    survivors: result.finalBodies.length,
  };
};

/** Fold per-scenario summaries into an aggregate. Pure. */
export const aggregate = (summaries: readonly PerScenarioSummary[]): AggregateSummary => {
  let totalBeats = 0;
  let totalContacts = 0;
  let totalExits = 0;
  for (const s of summaries) {
    totalBeats += s.beats;
    totalContacts += s.contactCount;
    totalExits += s.exitCount;
  }
  return {
    scenarioCount: summaries.length,
    totalBeats,
    totalContacts,
    totalExits,
  };
};
