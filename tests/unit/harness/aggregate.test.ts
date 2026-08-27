// tests/unit/harness/aggregate.test.ts — FR-33 win-rate / usage-rate locks (S05).
//
// Feeds hand-built `MatchScenarioResult`s to `summarizeMatch` +
// `aggregateMatches` so the assertion is against the aggregator math, not
// against a live match run. Pure unit tests — no `runMatchScenario` call here.
//
// Covers:
//   * `summarizeMatch` — extracts chassis-per-ship + component-set-per-fleet
//     from `result.fleets[*].builds`; carries outcome + turns + winnerFleetId.
//   * `aggregateMatches` win-rate BY CHASSIS:
//       chassis in winning fleet → +1 win; chassis in any fleet → +1 appearance;
//       rate = wins / appearances. Mutual-destruction contributes appearances only.
//   * `aggregateMatches` usage-rate BY COMPONENT (per-fleet denominator):
//       rate = fleets-fielding-it / total-fleets. A fleet with three copies of
//       the same component counts as 1 fleet.
//   * Determinism: byte-identical JSON across repeated calls (keys sorted).
//   * Empty input: matchCount=0, empty maps — the CLI can call unconditionally.

import { describe, expect, it } from 'vitest';
import type { Build } from '../../../src/domain/index.js';
import type { BotTier } from '../../../src/ai/index.js';
import type { MatchScenarioResult } from '../../../tools/balance/scenario.js';
import {
  aggregateMatches,
  summarizeMatch,
  type MatchSummary,
} from '../../../tools/balance/aggregate.js';
import { seedOf } from '../../../src/sim/mathx/index.js';

// ---------------------------------------------------------------------------
// Fixture builders — minimal Build stubs; only the fields aggregate reads.
// ---------------------------------------------------------------------------

const makeBuild = (
  chassisId: string,
  slots: readonly (string | null)[],
  idx = 0,
): Build => ({
  id: `test-${chassisId}-${idx}`,
  name: `Test ${chassisId}`,
  tags: [],
  chassisId,
  slots,
  storedCost: 0,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
});

const makeResult = (
  name: string,
  outcome:
    | { kind: 'victory'; fleetId: number; turns: number }
    | { kind: 'mutual-destruction'; turns: number },
  fleets: readonly {
    fleetId: number;
    tier: BotTier;
    builds: readonly Build[];
  }[],
): MatchScenarioResult => ({
  scenario: {
    kind: 'match',
    name,
    seed: seedOf(1, 2),
    budget: 25,
    fleetTiers: fleets.map((f) => f.tier),
  },
  outcome,
  turnDigests: Array.from({ length: outcome.turns }, (_, i) => (i + 1).toString(16).padStart(8, '0')),
  fleets,
});

// ---------------------------------------------------------------------------
// summarizeMatch
// ---------------------------------------------------------------------------

describe('summarizeMatch', () => {
  it('extracts chassis-per-ship in fleet order', () => {
    const r = makeResult(
      'm1',
      { kind: 'victory', fleetId: 0, turns: 3 },
      [
        {
          fleetId: 0,
          tier: 'rookie',
          builds: [
            makeBuild('chassis-a', [null, null]),
            makeBuild('chassis-b', [null]),
          ],
        },
        {
          fleetId: 1,
          tier: 'rookie',
          builds: [makeBuild('chassis-a', [null])],
        },
      ],
    );
    const s = summarizeMatch(r);
    expect(s.chassisByFleet).toEqual([
      ['chassis-a', 'chassis-b'],
      ['chassis-a'],
    ]);
  });

  it('collects component id SETS per fleet (deduplicated), sorted', () => {
    const r = makeResult(
      'm2',
      { kind: 'victory', fleetId: 0, turns: 1 },
      [
        {
          fleetId: 0,
          tier: 'rookie',
          builds: [
            // Same shield twice in one fleet: still counts as one component id
            // for that fleet.
            makeBuild('chassis-a', ['shield-x', 'weapon-y']),
            makeBuild('chassis-a', ['shield-x', null]),
          ],
        },
      ],
    );
    const s = summarizeMatch(r);
    // Sorted ascending, deduplicated, nulls dropped.
    expect(s.componentsByFleet).toEqual([['shield-x', 'weapon-y']]);
  });

  it('winnerFleetId is null on mutual-destruction', () => {
    const r = makeResult(
      'm3',
      { kind: 'mutual-destruction', turns: 5 },
      [
        { fleetId: 0, tier: 'rookie', builds: [makeBuild('chassis-a', [])] },
        { fleetId: 1, tier: 'rookie', builds: [makeBuild('chassis-a', [])] },
      ],
    );
    const s = summarizeMatch(r);
    expect(s.outcome).toBe('mutual-destruction');
    expect(s.winnerFleetId).toBeNull();
    expect(s.turns).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// aggregateMatches — win-rate by chassis
// ---------------------------------------------------------------------------

describe('aggregateMatches — win-rate by chassis', () => {
  it('a chassis that only ever wins has rate 1.0', () => {
    // 2 matches, chassis-w is always in the winning fleet.
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['chassis-w'], ['chassis-l']],
        componentsByFleet: [[], []],
      },
      {
        name: 'm2',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['chassis-w'], ['chassis-l']],
        componentsByFleet: [[], []],
      },
    ];
    const agg = aggregateMatches(summaries);
    expect(agg.winRateByChassisId['chassis-w']).toBe(1);
    expect(agg.winRateByChassisId['chassis-l']).toBe(0);
  });

  it('mutual-destruction contributes appearances only (no wins)', () => {
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'mutual-destruction',
        winnerFleetId: null,
        turns: 4,
        chassisByFleet: [['chassis-a'], ['chassis-b']],
        componentsByFleet: [[], []],
      },
    ];
    const agg = aggregateMatches(summaries);
    expect(agg.winRateByChassisId['chassis-a']).toBe(0);
    expect(agg.winRateByChassisId['chassis-b']).toBe(0);
    expect(agg.mutualDestructions).toBe(1);
    expect(agg.victories).toBe(0);
  });

  it('multiple ships of the same chassis in a winning fleet each count as +1 win / +1 appearance', () => {
    // Fleet 0 wins with two ships both chassis-w → 2 wins, 2 appearances → 1.0.
    // Fleet 1 loses with one chassis-l → 0 wins, 1 appearance → 0.
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['chassis-w', 'chassis-w'], ['chassis-l']],
        componentsByFleet: [[], []],
      },
    ];
    const agg = aggregateMatches(summaries);
    expect(agg.winRateByChassisId['chassis-w']).toBe(1);
    expect(agg.winRateByChassisId['chassis-l']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateMatches — usage-rate by component (per-fleet denominator)
// ---------------------------------------------------------------------------

describe('aggregateMatches — usage-rate by component', () => {
  it('a component in every fleet has usage 1.0', () => {
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['x'], ['x']],
        componentsByFleet: [['shield-x'], ['shield-x']],
      },
      {
        name: 'm2',
        outcome: 'mutual-destruction',
        winnerFleetId: null,
        turns: 3,
        chassisByFleet: [['x'], ['x']],
        componentsByFleet: [['shield-x'], ['shield-x']],
      },
    ];
    const agg = aggregateMatches(summaries);
    expect(agg.usageRateByComponentId['shield-x']).toBe(1);
  });

  it('per-fleet denominator: 2 fleets out of 4 use component-y → 0.5', () => {
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['x'], ['x']],
        componentsByFleet: [['weapon-y'], []],
      },
      {
        name: 'm2',
        outcome: 'victory',
        winnerFleetId: 1,
        turns: 1,
        chassisByFleet: [['x'], ['x']],
        componentsByFleet: [['weapon-y'], []],
      },
    ];
    const agg = aggregateMatches(summaries);
    // 2 fleets fielded 'weapon-y' out of 4 total fleets.
    expect(agg.usageRateByComponentId['weapon-y']).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// aggregateMatches — determinism + degenerate inputs
// ---------------------------------------------------------------------------

describe('aggregateMatches — determinism + degenerate inputs', () => {
  it('emits sorted-key maps → byte-identical JSON on repeated calls', () => {
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 1,
        chassisByFleet: [['zebra', 'alpha'], ['beta']],
        componentsByFleet: [['zeta-comp', 'alpha-comp'], ['beta-comp']],
      },
    ];
    const a = aggregateMatches(summaries);
    const b = aggregateMatches(summaries);
    // Keys sorted → JSON is byte-stable.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Chassis map keys are sorted ascending.
    expect(Object.keys(a.winRateByChassisId)).toEqual(['alpha', 'beta', 'zebra']);
    expect(Object.keys(a.usageRateByComponentId)).toEqual([
      'alpha-comp',
      'beta-comp',
      'zeta-comp',
    ]);
  });

  it('empty input → matchCount 0, empty maps, no divide-by-zero', () => {
    const agg = aggregateMatches([]);
    expect(agg.matchCount).toBe(0);
    expect(agg.victories).toBe(0);
    expect(agg.mutualDestructions).toBe(0);
    expect(agg.avgTurns).toBe(0);
    expect(agg.winRateByChassisId).toEqual({});
    expect(agg.usageRateByComponentId).toEqual({});
  });

  it('avgTurns is total turns / matchCount', () => {
    const summaries: MatchSummary[] = [
      {
        name: 'm1',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 4,
        chassisByFleet: [['x']],
        componentsByFleet: [[]],
      },
      {
        name: 'm2',
        outcome: 'victory',
        winnerFleetId: 0,
        turns: 6,
        chassisByFleet: [['x']],
        componentsByFleet: [[]],
      },
    ];
    const agg = aggregateMatches(summaries);
    expect(agg.avgTurns).toBe(5);
    expect(agg.matchCount).toBe(2);
  });
});
