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

import type { MatchScenarioResult, ScenarioResult } from './scenario.js';

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

// ===========================================================================
// S05 — Match-scope summary + FR-33 win-rate / usage-rate aggregation.
// ===========================================================================
//
// FR-33 acceptance: the harness reports per-chassis win-rate and per-component
// usage-rate across a batch of bot-vs-bot matches. Definitions below are the
// authoritative interpretation for the code + fixtures — same denominator
// choice across CI runs, so goldens stay comparable.
//
// Denominator choices (documented so downstream reports read the same math):
//
//   • win-rate BY CHASSIS: numerator = wins-per-appearance across all matches;
//     denominator = appearances (per ship). i.e. for each ship in the WINNING
//     fleet the chassis gets +1 win; for each ship in ANY fleet (winner OR
//     loser OR mutual-destruction) the chassis gets +1 appearance.
//     rate = wins / appearances. A chassis that never appears is omitted
//     (rate would be 0/0 — the report drops the entry so a reader can tell
//     "not in the sample" from "0% win rate").
//
//   • usage-rate BY COMPONENT: numerator = fleets-fielding-it; denominator =
//     total fleets. i.e. for each fleet, take the SET of component ids
//     appearing in ≥ 1 build; every id in that set counts +1 fleet; every
//     match contributes fleets.length to the denominator. rate =
//     fleets-with-id / total-fleets. Per-FLEET denominator (not per-build)
//     because "usage" is a fleet-composition metric — a fleet that fields
//     three copies of a shield still counts as 1 fleet using that shield.
//     A component that never appears is omitted (same rationale as above).
//
// Determinism: iterate ids in sorted order when building the maps so the
// report's key order is stable across runs (Object literal order is by
// insertion; sorting inputs makes JSON.stringify byte-comparable).

/**
 * Per-match summary — the reduce input for `aggregateMatches`. Emitted by
 * `summarizeMatch`. Carries only the data the aggregator needs (outcome +
 * turn count + per-fleet chassis/component id lists) so fixtures stay small.
 *
 * `chassisByFleet[fleetId][shipIndex]` is the ship's `chassisId`.
 * `componentsByFleet[fleetId]` is the SET (deduplicated, sorted) of
 * component ids fielded by ≥ 1 build in that fleet — usage-rate is a
 * per-fleet metric, so per-fleet dedup happens at summary time.
 */
export interface MatchSummary {
  readonly name: string;
  readonly outcome: 'victory' | 'mutual-destruction';
  readonly winnerFleetId: number | null;
  readonly turns: number;
  readonly chassisByFleet: readonly (readonly string[])[];
  readonly componentsByFleet: readonly (readonly string[])[];
}

/**
 * Cross-match aggregate — the FR-33 report shape. Written to stdout as JSON
 * by `cli.ts --mode match`. `winRateByChassisId` and `usageRateByComponentId`
 * are sorted-key objects (deterministic serialization).
 */
export interface MatchAggregate {
  readonly matchCount: number;
  readonly victories: number;
  readonly mutualDestructions: number;
  readonly avgTurns: number;
  readonly winRateByChassisId: Readonly<Record<string, number>>;
  readonly usageRateByComponentId: Readonly<Record<string, number>>;
}

/**
 * Reduce one `MatchScenarioResult` to a `MatchSummary`. Pure.
 *
 * Iterates `result.fleets` in `fleetId` order (already sorted by the runner —
 * fleets are constructed with `fleetId = i`). Per fleet: collect chassisIds
 * in ship order; collect the SET of non-null component ids (deduplicated by
 * per-fleet set semantics, sorted ascending for a stable report).
 */
export const summarizeMatch = (result: MatchScenarioResult): MatchSummary => {
  const chassisByFleet: string[][] = [];
  const componentsByFleet: string[][] = [];
  for (const fleet of result.fleets) {
    const chassisIds: string[] = [];
    const componentIdSet = new Set<string>();
    for (const build of fleet.builds) {
      chassisIds.push(build.chassisId);
      for (const slot of build.slots) {
        if (slot !== null) componentIdSet.add(slot);
      }
    }
    chassisByFleet.push(chassisIds);
    // Sorted so `JSON.stringify(summary)` is byte-stable across runs.
    componentsByFleet.push(Array.from(componentIdSet).sort());
  }
  return {
    name: result.scenario.name,
    outcome: result.outcome.kind,
    winnerFleetId:
      result.outcome.kind === 'victory' ? result.outcome.fleetId : null,
    turns: result.outcome.turns,
    chassisByFleet,
    componentsByFleet,
  };
};

/**
 * Fold per-match summaries into the FR-33 aggregate. Pure.
 *
 * See the file-level comment for the denominator choices. Empty input
 * returns `matchCount = 0` and empty maps — the CLI can call this
 * unconditionally without a length guard.
 */
export const aggregateMatches = (
  summaries: readonly MatchSummary[],
): MatchAggregate => {
  let victories = 0;
  let mutualDestructions = 0;
  let totalTurns = 0;

  // Chassis: wins / appearances. Numerators keyed by chassisId.
  const chassisWins = new Map<string, number>();
  const chassisAppearances = new Map<string, number>();

  // Components: fleets-fielding-it / total fleets.
  const componentFleetHits = new Map<string, number>();
  let totalFleets = 0;

  for (const s of summaries) {
    if (s.outcome === 'victory') victories += 1;
    else mutualDestructions += 1;
    totalTurns += s.turns;

    for (let fid = 0; fid < s.chassisByFleet.length; fid += 1) {
      const chassisIds = s.chassisByFleet[fid]!;
      const isWinner = s.winnerFleetId === fid;
      for (const chassisId of chassisIds) {
        chassisAppearances.set(
          chassisId,
          (chassisAppearances.get(chassisId) ?? 0) + 1,
        );
        if (isWinner) {
          chassisWins.set(chassisId, (chassisWins.get(chassisId) ?? 0) + 1);
        }
      }
    }

    for (const componentIds of s.componentsByFleet) {
      totalFleets += 1;
      for (const componentId of componentIds) {
        componentFleetHits.set(
          componentId,
          (componentFleetHits.get(componentId) ?? 0) + 1,
        );
      }
    }
  }

  const winRateByChassisId = mapToSortedRecord(chassisAppearances, (id, appearances) =>
    appearances === 0 ? null : (chassisWins.get(id) ?? 0) / appearances,
  );
  const usageRateByComponentId =
    totalFleets === 0
      ? Object.freeze({}) as Record<string, number>
      : mapToSortedRecord(componentFleetHits, (_id, hits) => hits / totalFleets);

  return {
    matchCount: summaries.length,
    victories,
    mutualDestructions,
    avgTurns: summaries.length === 0 ? 0 : totalTurns / summaries.length,
    winRateByChassisId,
    usageRateByComponentId,
  };
};

/**
 * Build a `Record<string, number>` with keys in ascending order. Object-
 * literal iteration order matches insertion order, so sorting the keys before
 * insertion gives byte-stable JSON serialisation. Values are computed via
 * `fn(id, count)`; returning `null` from `fn` omits the key (used to drop
 * the 0/0 chassis case).
 */
const mapToSortedRecord = (
  m: ReadonlyMap<string, number>,
  fn: (id: string, count: number) => number | null,
): Readonly<Record<string, number>> => {
  const sortedIds = Array.from(m.keys()).sort();
  const out: Record<string, number> = {};
  for (const id of sortedIds) {
    const rate = fn(id, m.get(id)!);
    if (rate !== null) out[id] = rate;
  }
  return out;
};
