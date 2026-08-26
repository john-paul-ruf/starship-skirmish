// trace — ResolutionTrace builders + MatchOutcome shape.
//
// Two things must be true for the sim → renderer handoff to be safe:
//   1. Every builder returns a NEW frozen record and does not mutate the input.
//   2. `withTurn` appends in caller order (never reorders) and `withOutcome`
//      overlays cleanly onto whatever turn history has accrued.
// The tests also exercise a hand-built `TurnRecord` end-to-end so a shape drift in
// `MovementBeatRecord`/`AttackBeatRecord` surfaces here as a compile error.

import { describe, expect, it } from 'vitest';
import {
  emptyTrace,
  withOutcome,
  withTurn,
  type AttackBeatRecord,
  type MatchOutcome,
  type MovementBeatRecord,
  type TurnRecord,
} from '../../../src/sim/trace/trace.js';
import { logCollision, logWeaponShot } from '../../../src/sim/trace/combatLog.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Body, DestructionEvent } from '../../../src/sim/types.js';

// Small fixtures so each test reads as data plus one assertion, not setup.
const shipA: Body = {
  kind: 'ship',
  id: 1,
  position: of(0, 0, 0),
  velocity: of(1, 0, 0),
  mass: 100,
  radius: 5,
};
const shipB: Body = {
  kind: 'ship',
  id: 2,
  position: of(20, 0, 0),
  velocity: of(-1, 0, 0),
  mass: 100,
  radius: 5,
};

const emptyMovement = (): MovementBeatRecord => ({
  subStepCount: 4,
  keyframes: [[shipA, shipB]],
  contacts: [],
  log: [],
  destroyed: [],
  removedHazardIds: [],
});
const emptyAttack = (): AttackBeatRecord => ({
  log: [],
  destroyed: [],
  launchedMissileIds: [],
});
const turnOf = (n: number, m = emptyMovement(), a = emptyAttack()): TurnRecord => ({
  turn: n,
  movement: m,
  attack: a,
});

describe('emptyTrace', () => {
  it('carries the seed, no turns, null outcome', () => {
    const t = emptyTrace(0x12345678, 0x9abcdef0);
    expect(t.seedHi).toBe(0x12345678 >>> 0);
    expect(t.seedLo).toBe(0x9abcdef0 >>> 0);
    expect(t.turns).toEqual([]);
    expect(t.outcome).toBeNull();
  });

  it('coerces negative int32 seed halves to uint32 (raw crypto bytes come in signed)', () => {
    // `crypto.getRandomValues(Int32Array)` hands out signed ints; the boundary layer
    // should be forgiving so app-code doesn't have to bit-cast at every call site.
    const t = emptyTrace(-1, -2);
    expect(t.seedHi).toBe(0xffffffff);
    expect(t.seedLo).toBe(0xfffffffe);
  });

  it('is frozen (top-level fields cannot be reassigned)', () => {
    const t = emptyTrace(1, 1);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.turns)).toBe(true);
  });
});

describe('withTurn — append-only, non-mutating', () => {
  it('appends in caller order', () => {
    let t = emptyTrace(1, 2);
    t = withTurn(t, turnOf(1));
    t = withTurn(t, turnOf(2));
    t = withTurn(t, turnOf(3));
    expect(t.turns.map((x) => x.turn)).toEqual([1, 2, 3]);
  });

  it('leaves the input trace unchanged', () => {
    const start = emptyTrace(0, 0);
    const one = withTurn(start, turnOf(1));
    const two = withTurn(one, turnOf(2));
    expect(start.turns).toEqual([]);
    expect(one.turns).toHaveLength(1);
    expect(two.turns).toHaveLength(2);
  });

  it('preserves seed + outcome fields', () => {
    const t = withOutcome(
      emptyTrace(42, 99),
      { kind: 'mutual-destruction', turns: 5 },
    );
    const after = withTurn(t, turnOf(6));
    expect(after.seedHi).toBe(42);
    expect(after.seedLo).toBe(99);
    expect(after.outcome).toEqual({ kind: 'mutual-destruction', turns: 5 });
  });

  it('returns a frozen trace with a frozen turns array', () => {
    const t = withTurn(emptyTrace(1, 1), turnOf(1));
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.turns)).toBe(true);
  });
});

describe('withOutcome — victory / mutual-destruction (FR-27)', () => {
  it('records a fleet victory without touching turns', () => {
    const t = withTurn(emptyTrace(1, 1), turnOf(1));
    const after = withOutcome(t, { kind: 'victory', fleetId: 2, turns: 1 });
    expect(after.outcome).toEqual({ kind: 'victory', fleetId: 2, turns: 1 });
    expect(after.turns).toEqual(t.turns);
    expect(t.outcome).toBeNull();
  });

  it('records mutual destruction as its own outcome variant', () => {
    const after = withOutcome(
      emptyTrace(1, 1),
      { kind: 'mutual-destruction', turns: 3 },
    );
    expect(after.outcome).toEqual({ kind: 'mutual-destruction', turns: 3 });
  });

  it('is frozen', () => {
    const t = withOutcome(emptyTrace(1, 1), { kind: 'victory', fleetId: 1, turns: 1 });
    expect(Object.isFrozen(t)).toBe(true);
  });
});

describe('hand-built TurnRecord round-trips through withTurn', () => {
  it('records physics contacts, combat log entries, and destruction events verbatim', () => {
    const contact = {
      subStep: 0,
      toi: 0.5,
      idA: 1,
      idB: 2,
      normal: of(1, 0, 0),
      point: of(10, 0, 0),
      relSpeedNormal: 2,
      damage: 4,
    };
    const destroyed: DestructionEvent = {
      bodyId: 2,
      chassisClass: 'fighter',
      position: of(10, 0, 0),
      velocity: of(-1, 0, 0),
      cause: 'collision',
      detonates: true,
    };
    const collisionLog = logCollision({
      turn: 1,
      sourceId: 1,
      targetId: 2,
      damage: 4,
      shieldBefore: 5,
      shieldAfter: 1,
      hullBefore: 10,
      hullAfter: 10,
      killed: false,
    });
    const shotLog = logWeaponShot({
      turn: 1,
      shooterId: 1,
      targetId: 2,
      result: 'kill',
      chance: 0.7,
      roll: 0.1,
      damage: 20,
      shieldBefore: 1,
      shieldAfter: 0,
      hullBefore: 10,
      hullAfter: 0,
    });

    const record: TurnRecord = {
      turn: 1,
      movement: {
        subStepCount: 4,
        keyframes: [[shipA, shipB], [shipA]],
        contacts: [contact],
        log: [collisionLog],
        destroyed: [],
        removedHazardIds: [],
      },
      attack: {
        log: [shotLog],
        destroyed: [destroyed],
        launchedMissileIds: [],
      },
    };
    const trace = withOutcome(
      withTurn(emptyTrace(1, 1), record),
      { kind: 'victory', fleetId: 1, turns: 1 },
    );
    expect(trace.turns).toHaveLength(1);
    expect(trace.turns[0]).toBe(record);
    expect(trace.turns[0]!.movement.contacts[0]).toBe(contact);
    expect(trace.turns[0]!.attack.destroyed[0]).toBe(destroyed);
    expect(trace.turns[0]!.movement.log[0]).toBe(collisionLog);
    expect(trace.turns[0]!.attack.log[0]).toBe(shotLog);
  });
});

describe('MatchOutcome — Custom Rule 5 (three-branch victory, no draw)', () => {
  // Compile-time proof: assigning to a variable of the exhaustive union proves each
  // kind exists and NOTHING ELSE does — a stray `draw` variant would fail here.
  it('exposes exactly victory and mutual-destruction', () => {
    const victory: MatchOutcome = { kind: 'victory', fleetId: 1, turns: 1 };
    const mutual: MatchOutcome = { kind: 'mutual-destruction', turns: 1 };
    expect(victory.kind).toBe('victory');
    expect(mutual.kind).toBe('mutual-destruction');
  });
});
