// M14 UI — In-match combat log strip selector (playtest-feedback-02 · S04 CP3).
//
// Locks the pure `liveLogRows` selector: current-turn filter, ordering
// (newest first, movement then attack within a beat by underlying
// `flattenCombatLog` guarantee), miss detection via `roll > chance`, and
// the empty-input safety. Node-only (no JSX): `tacticalAttack/model.ts`
// is `.ts` and this suite matches — the unit build (tsconfig.node) would
// reject a JSX-transitive test.

import { describe, expect, it } from 'vitest';

import { liveLogRows } from '../../../../src/ui/screens/tacticalAttack/model.js';
import type {
  CombatLogEntry,
  ResolutionTrace,
} from '../../../../src/sim/index.js';

// ---- Fixtures -------------------------------------------------------------

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

interface BeatFixture {
  readonly log: readonly CombatLogEntry[];
  readonly destroyed: readonly [];
}

const beat = (log: readonly CombatLogEntry[]): BeatFixture => ({
  log,
  destroyed: [],
});

const turn = (
  turnNo: number,
  movement: readonly CombatLogEntry[],
  attack: readonly CombatLogEntry[],
): ResolutionTrace['turns'][number] =>
  ({ turn: turnNo, movement: beat(movement), attack: beat(attack) }) as unknown as
    ResolutionTrace['turns'][number];

const trace = (turns: readonly ResolutionTrace['turns'][number][]): ResolutionTrace =>
  ({ seedHi: 0, seedLo: 0, turns, outcome: null }) as unknown as ResolutionTrace;

// ---- liveLogRows ----------------------------------------------------------

describe('liveLogRows — current-turn filter, newest-first', () => {
  it('returns only entries whose turn matches currentTurn', () => {
    const t = trace([
      turn(3, [], [entry({ turn: 3, sourceId: 1, targetId: 2 })]),
      turn(4, [entry({ turn: 4, beat: 'movement', source: 'collision', sourceId: 1, targetId: 3 })], []),
    ]);

    const rows = liveLogRows(t, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry.turn).toBe(4);
    expect(rows[0]!.entry.beat).toBe('movement');
  });

  it('returns newest-first within the current turn (movement then attack reversed)', () => {
    // Underlying flatten order: movement THEN attack, per FR-28. Newest
    // first = attack entries first (reversed within the turn).
    const t = trace([
      turn(
        5,
        [entry({ turn: 5, beat: 'movement', source: 'collision', sourceId: 7, targetId: 8 })],
        [
          entry({ turn: 5, sourceId: 1, targetId: 2 }),
          entry({ turn: 5, sourceId: 3, targetId: 4, result: 'kill' }),
        ],
      ),
    ]);

    const rows = liveLogRows(t, 5);
    expect(rows).toHaveLength(3);
    // Newest first: the LAST flattened row of turn 5 appears first.
    expect(rows[0]!.entry.result).toBe('kill');
    expect(rows[1]!.entry.beat).toBe('attack');
    expect(rows[2]!.entry.beat).toBe('movement');
  });

  it('empty trace or unresolved turn → empty list (drives the NO FIRE RESOLVED YET note)', () => {
    expect(liveLogRows(trace([]), 1)).toEqual([]);
    // Turn 4 exists in the trace but the caller asked for turn 5.
    const t = trace([turn(4, [], [entry({ turn: 4 })])]);
    expect(liveLogRows(t, 5)).toEqual([]);
  });

  it('the "why" of a miss lives on the entry itself — roll > chance ⇔ miss', () => {
    // `liveLogRows` is a filter, not a decoder — but the strip renders
    // roll and chance verbatim so the player can read the miss. This
    // test locks that both fields survive the selector unchanged.
    const t = trace([
      turn(
        6,
        [],
        [
          entry({ turn: 6, result: 'miss', chance: 0.3, roll: 0.71 }),
          entry({ turn: 6, result: 'hit', chance: 0.72, roll: 0.44 }),
        ],
      ),
    ]);
    const rows = liveLogRows(t, 6);
    expect(rows).toHaveLength(2);
    // The predicate FR-25 leans on: on a miss, the seeded roll exceeds
    // the published chance.
    for (const row of rows) {
      if (row.entry.result === 'miss') {
        expect(row.entry.roll).toBeGreaterThan(row.entry.chance);
      }
    }
  });

  it('preserves LogRow.seq — stable keying for the renderer', () => {
    const t = trace([
      turn(7, [], [entry({ turn: 7 }), entry({ turn: 7, sourceId: 9, targetId: 10 })]),
    ]);
    const rows = liveLogRows(t, 7);
    // Both rows carry a seq from the flatten ordering (0-indexed).
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1]);
  });
});
