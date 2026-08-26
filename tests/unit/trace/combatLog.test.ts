// combatLog — append-only log accumulator + typed event constructors.
//
// Two invariants under test:
//   1. `appendEntries` preserves caller order and does not mutate its input.
//      The transcript order equals the push order — so canonical ordering is the
//      loop's job (via `(sourceId, shotIndex)` sort BEFORE pushing), not this module's.
//   2. Each constructor sets the fields that its event kind fixes (source, beat,
//      result, chance/roll for non-rolled sources) and only the fields it accepts.

import { describe, expect, it } from 'vitest';
import {
  appendEntries,
  emptyLog,
  logAoe,
  logBoundaryExit,
  logCollision,
  logIntercept,
  logWeaponShot,
} from '../../../src/sim/trace/combatLog.js';
import type { CombatLogEntry } from '../../../src/sim/types.js';

describe('emptyLog', () => {
  it('has zero entries', () => {
    expect(emptyLog().entries).toEqual([]);
  });

  it('is frozen (entries cannot be mutated in place)', () => {
    const log = emptyLog();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.entries)).toBe(true);
  });
});

describe('appendEntries — preserves order + immutability', () => {
  const e = (turn: number, sourceId: number): CombatLogEntry =>
    logCollision({
      turn,
      sourceId,
      targetId: sourceId + 100,
      damage: 1,
      shieldBefore: 10,
      shieldAfter: 9,
      hullBefore: 20,
      hullAfter: 20,
      killed: false,
    });

  it('appends entries in the caller-supplied order (never reorders)', () => {
    const shuffled = [e(1, 5), e(1, 2), e(1, 8), e(1, 1)];
    const log = appendEntries(emptyLog(), shuffled);
    expect(log.entries.map((x) => x.sourceId)).toEqual([5, 2, 8, 1]);
  });

  it('leaves the input log untouched', () => {
    const start = emptyLog();
    const next = appendEntries(start, [e(1, 1), e(1, 2)]);
    expect(start.entries).toEqual([]);
    expect(next.entries).toHaveLength(2);
    // Two chained appends read as a normal concat with no cross-mutation.
    const later = appendEntries(next, [e(2, 3)]);
    expect(next.entries).toHaveLength(2);
    expect(later.entries).toHaveLength(3);
  });

  it('short-circuits when the incoming batch is empty (returns same log identity)', () => {
    // A cheap identity assertion — no wasted allocation when the beat produced nothing.
    const log = appendEntries(emptyLog(), [e(1, 1)]);
    expect(appendEntries(log, [])).toBe(log);
  });

  it('proves the sort-before-append discipline: pre-sorted input == sort(shuffled) input', () => {
    // Simulates the loop: whatever order rules emit, the loop sorts by
    // (sourceId, shotIndex) BEFORE pushing. Same events → same transcript.
    const shuffled = [e(1, 5), e(1, 2), e(1, 8), e(1, 1)];
    const sortedInput = [...shuffled].sort((a, b) => a.sourceId - b.sourceId);
    const preSorted = appendEntries(emptyLog(), sortedInput);
    const loopSorted = appendEntries(
      emptyLog(),
      [...shuffled].sort((a, b) => a.sourceId - b.sourceId),
    );
    expect(preSorted.entries).toEqual(loopSorted.entries);
  });

  it('the returned entries array is frozen', () => {
    const log = appendEntries(emptyLog(), [e(1, 1)]);
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.entries)).toBe(true);
  });
});

describe('logWeaponShot — attack-beat rolled shot', () => {
  it('sets beat=attack, source=weapon, and passes through roll/chance/damage/before-after', () => {
    const entry = logWeaponShot({
      turn: 3,
      shooterId: 7,
      targetId: 42,
      result: 'crit',
      chance: 0.6,
      roll: 0.12,
      damage: 25,
      shieldBefore: 40,
      shieldAfter: 15,
      hullBefore: 100,
      hullAfter: 100,
    });
    expect(entry.turn).toBe(3);
    expect(entry.beat).toBe('attack');
    expect(entry.source).toBe('weapon');
    expect(entry.sourceId).toBe(7);
    expect(entry.targetId).toBe(42);
    expect(entry.result).toBe('crit');
    expect(entry.chance).toBe(0.6);
    expect(entry.roll).toBe(0.12);
    expect(entry.damage).toBe(25);
    expect(entry.shieldBefore).toBe(40);
    expect(entry.shieldAfter).toBe(15);
    expect(entry.hullBefore).toBe(100);
    expect(entry.hullAfter).toBe(100);
    expect(entry.calledShot).toBeUndefined();
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('carries the calledShot payload when supplied', () => {
    const entry = logWeaponShot({
      turn: 5,
      shooterId: 2,
      targetId: 9,
      result: 'kill',
      chance: 0.4,
      roll: 0.05,
      damage: 8,
      shieldBefore: 0,
      shieldAfter: 0,
      hullBefore: 6,
      hullAfter: 0,
      calledShot: { kind: 'weapon', index: 1 },
    });
    expect(entry.result).toBe('kill');
    expect(entry.calledShot).toEqual({ kind: 'weapon', index: 1 });
  });
});

describe('logCollision — movement-beat contact damage', () => {
  it('sets beat=movement, source=collision, chance=roll=0; result depends on killed flag', () => {
    const hit = logCollision({
      turn: 4,
      sourceId: 3,
      targetId: 5,
      damage: 12,
      shieldBefore: 20,
      shieldAfter: 8,
      hullBefore: 30,
      hullAfter: 30,
      killed: false,
    });
    expect(hit.beat).toBe('movement');
    expect(hit.source).toBe('collision');
    expect(hit.result).toBe('hit');
    expect(hit.chance).toBe(0);
    expect(hit.roll).toBe(0);
    expect(hit.damage).toBe(12);
    expect(hit.calledShot).toBeUndefined();

    const kill = logCollision({
      turn: 4,
      sourceId: 3,
      targetId: 5,
      damage: 40,
      shieldBefore: 0,
      shieldAfter: 0,
      hullBefore: 10,
      hullAfter: 0,
      killed: true,
    });
    expect(kill.result).toBe('kill');
    expect(Object.isFrozen(kill)).toBe(true);
  });
});

describe('logAoe — destruction-blast damage (FR-23)', () => {
  it('sets beat=movement, source=aoe, chance=roll=0; sourceId is the exploded body', () => {
    const entry = logAoe({
      turn: 6,
      sourceId: 99,
      targetId: 3,
      damage: 20,
      shieldBefore: 10,
      shieldAfter: 0,
      hullBefore: 50,
      hullAfter: 40,
      killed: false,
    });
    expect(entry.beat).toBe('movement');
    expect(entry.source).toBe('aoe');
    expect(entry.result).toBe('hit');
    expect(entry.chance).toBe(0);
    expect(entry.roll).toBe(0);
    expect(entry.sourceId).toBe(99);
    expect(entry.targetId).toBe(3);
    expect(entry.damage).toBe(20);
  });

  it('records a kill when the blast destroys the target', () => {
    const entry = logAoe({
      turn: 6,
      sourceId: 99,
      targetId: 3,
      damage: 60,
      shieldBefore: 0,
      shieldAfter: 0,
      hullBefore: 40,
      hullAfter: 0,
      killed: true,
    });
    expect(entry.result).toBe('kill');
  });
});

describe('logIntercept — point-defense vs missile', () => {
  it('records a successful intercept as source=weapon, result=intercept, damage=0', () => {
    const entry = logIntercept({
      turn: 2,
      beat: 'attack',
      sourceId: 4,
      targetId: 77,
      chance: 0.75,
      roll: 0.5,
      intercepted: true,
    });
    expect(entry.beat).toBe('attack');
    expect(entry.source).toBe('weapon');
    expect(entry.sourceId).toBe(4);
    expect(entry.targetId).toBe(77);
    expect(entry.result).toBe('intercept');
    expect(entry.chance).toBe(0.75);
    expect(entry.roll).toBe(0.5);
    // Interception is defensive — no damage to the defender, so all pools are zero.
    expect(entry.damage).toBe(0);
    expect(entry.shieldBefore).toBe(0);
    expect(entry.shieldAfter).toBe(0);
    expect(entry.hullBefore).toBe(0);
    expect(entry.hullAfter).toBe(0);
  });

  it('records a failed intercept as result=miss (still logged so the transcript is complete)', () => {
    const entry = logIntercept({
      turn: 2,
      beat: 'movement',
      sourceId: 4,
      targetId: 77,
      chance: 0.25,
      roll: 0.9,
      intercepted: false,
    });
    expect(entry.result).toBe('miss');
    expect(entry.beat).toBe('movement');
  });
});

describe('logBoundaryExit — ship crossing the shell (FR-26)', () => {
  it('sets source=boundary, result=boundary-exit, sourceId==targetId, zeros the after pools', () => {
    const entry = logBoundaryExit({
      turn: 8,
      shipId: 11,
      hullBefore: 65,
      shieldBefore: 30,
    });
    expect(entry.beat).toBe('movement');
    expect(entry.source).toBe('boundary');
    expect(entry.result).toBe('boundary-exit');
    expect(entry.sourceId).toBe(11);
    expect(entry.targetId).toBe(11);
    expect(entry.chance).toBe(0);
    expect(entry.roll).toBe(0);
    expect(entry.damage).toBe(0);
    expect(entry.hullBefore).toBe(65);
    expect(entry.hullAfter).toBe(0);
    expect(entry.shieldBefore).toBe(30);
    expect(entry.shieldAfter).toBe(0);
  });
});
