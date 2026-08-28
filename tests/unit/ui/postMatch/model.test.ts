// M14 UI — Post-match model derivation (S07). Node-only (no JSX, no DOM):
// outcome headline for both union variants × player-won/lost, seed formatting,
// per-ship fate derivation, and combat-log flatten order + kind tagging.

import { describe, expect, it } from 'vitest';

import {
  CAUSE_LABEL,
  fateLabel,
  flattenCombatLog,
  formatSeed,
  logInvolves,
  logKindOf,
  nameByBodyId,
  outcomeHeadline,
  outcomeTone,
  perShipFates,
  playerBodyIds,
  shipFocusOptions,
} from '../../../../src/ui/screens/postMatch/model.js';
import type {
  CombatLogEntry,
  DestructionEvent,
  MatchOutcome,
  MatchState,
  ResolutionTrace,
  SimFleet,
  SimShip,
} from '../../../../src/sim/index.js';

// ---- Fixtures -------------------------------------------------------------

const ship = (name: string, over: Partial<SimShip> = {}): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'fighter',
  mass: 100,
  radius: 4,
  maxHull: 40,
  shieldCapacity: 20,
  shieldRegenPerTurn: 2,
  deltaVPerTurn: 30,
  baseEvasion: 0.2,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...over,
});

const entry = (over: Partial<CombatLogEntry>): CombatLogEntry => ({
  turn: 1,
  beat: 'attack',
  source: 'weapon',
  sourceId: 1,
  targetId: 2,
  result: 'hit',
  chance: 0.6,
  roll: 0.2,
  damage: 10,
  shieldBefore: 10,
  shieldAfter: 0,
  hullBefore: 40,
  hullAfter: 30,
  ...over,
});

const destroyed = (
  bodyId: number,
  cause: DestructionEvent['cause'],
): DestructionEvent => ({
  bodyId,
  chassisClass: 'fighter',
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  cause,
  detonates: false,
});

interface BeatFixture {
  readonly log: readonly CombatLogEntry[];
  readonly destroyed: readonly DestructionEvent[];
}

const turn = (
  turnNo: number,
  movement: BeatFixture,
  attack: BeatFixture,
): ResolutionTrace['turns'][number] =>
  ({ turn: turnNo, movement, attack }) as unknown as ResolutionTrace['turns'][number];

const trace = (turns: readonly ResolutionTrace['turns'][number][]): ResolutionTrace =>
  ({ seedHi: 0, seedLo: 0, turns, outcome: null }) as unknown as ResolutionTrace;

const survivorsState = (
  entries: readonly (readonly [number, SimShip, number, number])[],
): MatchState => {
  const ships = new Map<number, unknown>();
  for (const [bodyId, s, hull, shields] of entries) {
    ships.set(bodyId, { bodyId, ship: s, hull, shields });
  }
  return { ships } as unknown as MatchState;
};

// ---- Outcome headline (FR-27 / Custom Rule 5) -----------------------------

describe('outcomeHeadline — the exactly-two-variant union', () => {
  it('victory for the player fleet reads VICTORY', () => {
    const outcome: MatchOutcome = { kind: 'victory', fleetId: 0, turns: 7 };
    expect(outcomeHeadline(outcome, 0)).toBe('VICTORY');
    expect(outcomeTone(outcome, 0)).toBe('win');
  });

  it('victory for an opponent fleet reads DEFEAT', () => {
    const outcome: MatchOutcome = { kind: 'victory', fleetId: 1, turns: 7 };
    expect(outcomeHeadline(outcome, 0)).toBe('DEFEAT');
    expect(outcomeTone(outcome, 0)).toBe('loss');
  });

  it('mutual destruction reads MUTUAL DESTRUCTION', () => {
    const outcome: MatchOutcome = { kind: 'mutual-destruction', turns: 9 };
    expect(outcomeHeadline(outcome, 0)).toBe('MUTUAL DESTRUCTION');
    expect(outcomeTone(outcome, 0)).toBe('mutual');
  });
});

// ---- Seed formatting (§4.11) ----------------------------------------------

describe('formatSeed — SK-XXXX-XXXX-XXXX', () => {
  it('formats three uint16 groups (hi.hi / hi.lo / lo.hi)', () => {
    expect(formatSeed(0x7f3a9c21, 0xd4e80000)).toBe('SK-7F3A-9C21-D4E8');
  });

  it('zero-pads each group to four hex digits', () => {
    expect(formatSeed(1, 2)).toBe('SK-0000-0001-0000');
  });

  it('is stable — same seed always formats the same', () => {
    expect(formatSeed(0x12345678, 0xabcd0000)).toBe(formatSeed(0x12345678, 0xabcd0000));
  });
});

// ---- Per-ship fates -------------------------------------------------------

describe('perShipFates — survivors + casualties, every ship once', () => {
  const fleets: readonly SimFleet[] = [
    { fleetId: 0, ships: [ship('ALPHA'), ship('BRAVO')] },
    { fleetId: 1, ships: [ship('CHARLIE'), ship('DELTA')] },
  ];

  // Assignment: ALPHA=1, BRAVO=2, CHARLIE=3, DELTA=4.
  const state = survivorsState([
    [1, fleets[0]!.ships[0]!, 30, 5],
    [3, fleets[1]!.ships[0]!, 12, 0],
  ]);
  const t = trace([
    turn(
      1,
      { log: [], destroyed: [destroyed(4, 'boundary')] },
      { log: [], destroyed: [destroyed(2, 'weapon')] },
    ),
  ]);
  const result = perShipFates(state, t, fleets);

  it('groups rows by fleet in roster order', () => {
    expect(result.map((f) => f.fleetId)).toEqual([0, 1]);
  });

  it('enumerates every ship exactly once', () => {
    const names = result.flatMap((f) => f.rows.map((r) => r.name));
    expect(names).toEqual(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA']);
  });

  it('marks survivors alive with live hull from final state', () => {
    const alpha = result[0]!.rows[0]!;
    expect(alpha.fate).toBe('alive');
    expect(alpha.cause).toBeNull();
    expect(alpha.hull).toBe(30);
    expect(alpha.shields).toBe(5);
    expect(fateLabel(alpha)).toBe('SURVIVED');
  });

  it('marks casualties destroyed with the right cause', () => {
    const bravo = result[0]!.rows[1]!;
    expect(bravo.fate).toBe('destroyed');
    expect(bravo.cause).toBe('weapon');
    expect(bravo.hull).toBe(0);
    expect(fateLabel(bravo)).toBe(`DESTROYED · ${CAUSE_LABEL.weapon}`);

    const delta = result[1]!.rows[1]!;
    expect(delta.cause).toBe('boundary');
    expect(fateLabel(delta)).toBe(`DESTROYED · ${CAUSE_LABEL.boundary}`);
  });

  it('counts survivors per fleet', () => {
    expect(result[0]).toMatchObject({ survivors: 1, total: 2 });
    expect(result[1]).toMatchObject({ survivors: 1, total: 2 });
  });

  it('falls back to DESTROYED with null cause when no event recorded', () => {
    const lone: readonly SimFleet[] = [{ fleetId: 0, ships: [ship('GHOST')] }];
    const empty = survivorsState([]);
    const rows = perShipFates(empty, trace([]), lone);
    expect(rows[0]!.rows[0]).toMatchObject({ fate: 'destroyed', cause: null });
    expect(fateLabel(rows[0]!.rows[0]!)).toBe('DESTROYED');
  });

  it('carries ship names verbatim (no mangling — render layer makes them safe)', () => {
    const hostile: readonly SimFleet[] = [
      { fleetId: 0, ships: [ship('<img src=x onerror=alert(1)>')] },
    ];
    const rows = perShipFates(survivorsState([]), trace([]), hostile);
    expect(rows[0]!.rows[0]!.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('maps every body id to its ship name', () => {
    const names = nameByBodyId(fleets);
    expect(names.get(1)).toBe('ALPHA');
    expect(names.get(4)).toBe('DELTA');
  });
});

// ---- Combat log flatten + kind tagging (FR-28) ----------------------------

// ---- Ship-focus predicates (S02) -----------------------------------------

describe('playerBodyIds — selects only the player fleet', () => {
  const fleets: readonly SimFleet[] = [
    { fleetId: 0, ships: [ship('ALPHA'), ship('BRAVO')] },
    { fleetId: 1, ships: [ship('CHARLIE'), ship('DELTA')] },
  ];

  it('includes every body of the player fleet, in id order', () => {
    const ids = playerBodyIds(fleets, 0);
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('excludes bot fleet bodies entirely', () => {
    const ids = playerBodyIds(fleets, 0);
    expect(ids.has(3)).toBe(false);
    expect(ids.has(4)).toBe(false);
  });

  it('is empty when the player fleet id does not match any fleet', () => {
    const ids = playerBodyIds(fleets, 99);
    expect(ids.size).toBe(0);
  });
});

describe('logInvolves — shooter OR target in the id set', () => {
  const mine = new Set<number>([1, 2]);

  it('true when the shooter is in the set', () => {
    expect(logInvolves(entry({ sourceId: 1, targetId: 9 }), mine)).toBe(true);
  });

  it('true when the target is in the set', () => {
    expect(logInvolves(entry({ sourceId: 9, targetId: 2 }), mine)).toBe(true);
  });

  it('true when both ends are in the set (self-hit / same-fleet friendly)', () => {
    expect(logInvolves(entry({ sourceId: 1, targetId: 2 }), mine)).toBe(true);
  });

  it('false when neither end is in the set', () => {
    expect(logInvolves(entry({ sourceId: 8, targetId: 9 }), mine)).toBe(false);
  });

  it('false against an empty set', () => {
    expect(logInvolves(entry({ sourceId: 1, targetId: 2 }), new Set())).toBe(false);
  });
});

describe('shipFocusOptions — player ships first, every body once', () => {
  const fleets: readonly SimFleet[] = [
    { fleetId: 0, ships: [ship('ALPHA'), ship('BRAVO')] },
    { fleetId: 1, ships: [ship('CHARLIE'), ship('DELTA')] },
  ];

  it('orders player ships before opponent ships', () => {
    const opts = shipFocusOptions(fleets, 0);
    expect(opts.map((o) => o.name)).toEqual(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA']);
    expect(opts.map((o) => o.mine)).toEqual([true, true, false, false]);
  });

  it('preserves roster order within the player group', () => {
    const opts = shipFocusOptions(fleets, 0);
    expect(opts.slice(0, 2).map((o) => o.bodyId)).toEqual([1, 2]);
  });

  it('flips the mine flag when a different fleet is the player', () => {
    const opts = shipFocusOptions(fleets, 1);
    expect(opts.map((o) => o.name)).toEqual(['CHARLIE', 'DELTA', 'ALPHA', 'BRAVO']);
    expect(opts.every((o, i) => o.mine === (i < 2))).toBe(true);
  });

  it('carries each body id exactly once', () => {
    const opts = shipFocusOptions(fleets, 0);
    expect(opts.map((o) => o.bodyId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe('logKindOf — one salient kind per entry', () => {
  it('tags weapon hit/miss as SHOT', () => {
    expect(logKindOf(entry({ source: 'weapon', result: 'hit' }))).toBe('SHOT');
    expect(logKindOf(entry({ source: 'weapon', result: 'miss' }))).toBe('SHOT');
  });

  it('tags crit and kill by result over source', () => {
    expect(logKindOf(entry({ source: 'weapon', result: 'crit' }))).toBe('CRIT');
    expect(logKindOf(entry({ source: 'weapon', result: 'kill' }))).toBe('KILL');
    expect(logKindOf(entry({ source: 'collision', result: 'kill' }))).toBe('KILL');
  });

  it('tags missile and collision by source', () => {
    expect(logKindOf(entry({ source: 'missile', result: 'hit' }))).toBe('MISSILE');
    expect(logKindOf(entry({ source: 'collision', result: 'hit' }))).toBe('COLLISION');
  });

  it('shares the COLLISION lane for AoE blast hits', () => {
    expect(logKindOf(entry({ source: 'aoe', result: 'hit' }))).toBe('COLLISION');
  });

  it('tags boundary-exit and intercept by result', () => {
    expect(logKindOf(entry({ source: 'boundary', result: 'boundary-exit' }))).toBe('BOUNDARY');
    expect(logKindOf(entry({ source: 'weapon', result: 'intercept' }))).toBe('INTERCEPT');
  });
});

describe('flattenCombatLog — order preserved, seq monotonic', () => {
  const t = trace([
    turn(
      1,
      {
        log: [
          entry({ turn: 1, beat: 'movement', source: 'collision', result: 'hit' }),
          entry({ turn: 1, beat: 'movement', source: 'boundary', result: 'boundary-exit' }),
        ],
        destroyed: [],
      },
      {
        log: [
          entry({ turn: 1, source: 'weapon', result: 'hit' }),
          entry({ turn: 1, source: 'weapon', result: 'crit' }),
          entry({ turn: 1, source: 'weapon', result: 'kill' }),
          entry({ turn: 1, source: 'missile', result: 'hit' }),
          entry({ turn: 1, source: 'weapon', result: 'intercept' }),
          entry({ turn: 1, source: 'aoe', result: 'hit' }),
        ],
        destroyed: [],
      },
    ),
    turn(
      2,
      { log: [], destroyed: [] },
      { log: [entry({ turn: 2, source: 'weapon', result: 'miss' })], destroyed: [] },
    ),
  ]);
  const rows = flattenCombatLog(t);

  it('walks movement then attack, turn by turn', () => {
    expect(rows.map((r) => r.kind)).toEqual([
      'COLLISION',
      'BOUNDARY',
      'SHOT',
      'CRIT',
      'KILL',
      'MISSILE',
      'INTERCEPT',
      'COLLISION',
      'SHOT',
    ]);
  });

  it('assigns a monotonic seq starting at 0', () => {
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('preserves each entry reference intact', () => {
    expect(rows[0]!.entry.source).toBe('collision');
    expect(rows[8]!.entry.turn).toBe(2);
  });
});
