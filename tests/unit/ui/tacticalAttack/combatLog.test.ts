// M14 UI — In-match combat log strip selector (playtest-feedback-02 · S04 CP3).
//
// Locks the pure `liveLogRows` selector: current-turn filter, ordering
// (newest first, movement then attack within a beat by underlying
// `flattenCombatLog` guarantee), miss detection via `roll > chance`, and
// the empty-input safety. Node-only (no JSX): `tacticalAttack/model.ts`
// is `.ts` and this suite matches — the unit build (tsconfig.node) would
// reject a JSX-transitive test.

import { describe, expect, it } from 'vitest';

import {
  lastResolvedLogRows,
  liveLogRows,
} from '../../../../src/ui/screens/tacticalAttack/model.js';
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

// ---- lastResolvedLogRows (playtest-feedback-04 · FB3 · D-LOG-LAST-RESOLVED) --
//
// The correct selector for the in-match combat log: the newest fully-resolved
// turn's rows + its turn number. The trace batches a turn at turn-end (see
// controller.driveTurn), so a `currentTurn`-based filter reads empty for the
// entire duration the player is present at that turn — this selector reads
// what actually happened. SESSION-02 consumes the same selector on the Move
// screen; the signature locked here is that session's contract.

describe('lastResolvedLogRows — newest resolved turn, empty-safe', () => {
  it('empty trace → { rows: [], turn: null } (drives NO COMBAT YET label)', () => {
    const { rows, turn: t } = lastResolvedLogRows(trace([]));
    expect(rows).toEqual([]);
    expect(t).toBeNull();
  });

  it('single-turn trace → that turn (whatever its number is)', () => {
    // A one-turn trace whose only turn is turn 4 → the selector returns turn 4.
    const t = trace([
      turn(4, [entry({ turn: 4, beat: 'movement', source: 'collision' })], [entry({ turn: 4 })]),
    ]);
    const result = lastResolvedLogRows(t);
    expect(result.turn).toBe(4);
    // Two rows total (one movement, one attack) — order newest-first, so
    // attack precedes movement (mirrors flattenCombatLog's mov→atk order).
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.entry.beat).toBe('attack');
    expect(result.rows[1]!.entry.beat).toBe('movement');
  });

  it('multi-turn trace → the NEWEST turn only (per turn.turns push order — FR-28)', () => {
    // Turns 1, 2, 3 — even if the caller thinks "the player is on turn 5",
    // the selector surfaces the freshest resolved turn (3), because that is
    // what the trace actually holds. The two older turns must not bleed in.
    const t = trace([
      turn(1, [], [entry({ turn: 1, sourceId: 1, targetId: 2 })]),
      turn(2, [], [entry({ turn: 2, sourceId: 3, targetId: 4 })]),
      turn(3, [], [
        entry({ turn: 3, sourceId: 5, targetId: 6, result: 'kill' }),
        entry({ turn: 3, sourceId: 7, targetId: 8 }),
      ]),
    ]);
    const result = lastResolvedLogRows(t);
    expect(result.turn).toBe(3);
    // Only turn-3 rows survive the slice.
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) expect(row.entry.turn).toBe(3);
    // Newest-first: the LAST flattened row of turn 3 comes first.
    expect(result.rows[0]!.entry.sourceId).toBe(7);
    expect(result.rows[1]!.entry.result).toBe('kill');
  });

  it('preserves LogRow.seq — stable renderer keys across the sliced turn', () => {
    const t = trace([
      turn(1, [], [entry({ turn: 1, sourceId: 11, targetId: 12 })]),
      turn(2, [], [entry({ turn: 2 }), entry({ turn: 2, sourceId: 21, targetId: 22 })]),
    ]);
    const result = lastResolvedLogRows(t);
    // Turn 2 lives at flatten seq 1 and 2 (turn 1 occupied seq 0).
    const seqs = result.rows.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2]);
  });

  it('a turn whose beats are both empty → empty rows + that turn number', () => {
    // The zero-fire commit case (playtest-feedback-04 e2e "legible resolve"):
    // turn N resolves with no combat. The selector must still return that
    // turn number so the panel reads "TURN N" (not "NO COMBAT YET"), and the
    // rows are empty so the empty-state note fires.
    const t = trace([turn(3, [], [])]);
    const result = lastResolvedLogRows(t);
    expect(result.turn).toBe(3);
    expect(result.rows).toEqual([]);
  });
});
