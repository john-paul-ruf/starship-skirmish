// The public surface of `src/sim/trace/` — barrel proves every symbol the loop
// (S04) and future consumers rely on is exported, and `traceDigest` produces a
// stable arithmetic hash sensitive to any field change.

import { describe, expect, it } from 'vitest';
import * as trace from '../../../src/sim/trace/index.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type {
  AttackBeatRecord,
  MovementBeatRecord,
  TurnRecord,
} from '../../../src/sim/trace/index.js';
import type { Body, DestructionEvent } from '../../../src/sim/types.js';

describe('trace barrel — public surface', () => {
  // A drift-guard: the loop (S04) imports these from the barrel. A rename in
  // combatLog/trace/digest would break this well before S04 breaks.
  it('exports every builder and constructor the loop consumes', () => {
    expect(typeof trace.emptyTrace).toBe('function');
    expect(typeof trace.withTurn).toBe('function');
    expect(typeof trace.withOutcome).toBe('function');
    expect(typeof trace.emptyLog).toBe('function');
    expect(typeof trace.appendEntries).toBe('function');
    expect(typeof trace.logWeaponShot).toBe('function');
    expect(typeof trace.logCollision).toBe('function');
    expect(typeof trace.logAoe).toBe('function');
    expect(typeof trace.logIntercept).toBe('function');
    expect(typeof trace.logBoundaryExit).toBe('function');
    expect(typeof trace.traceDigest).toBe('function');
  });
});

// Fixtures — one ship, one contact, one entry each so a per-field diff test can
// tweak exactly one number and confirm the digest changes.
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

const buildTrace = (
  overrides: {
    seedHi?: number;
    seedLo?: number;
    withOutcome?: boolean;
    tweakShipMass?: number;
    tweakLogDamage?: number;
    extraTurn?: boolean;
  } = {},
): trace.ResolutionTrace => {
  const ship: Body = { ...shipA, mass: overrides.tweakShipMass ?? shipA.mass };
  const movement: MovementBeatRecord = {
    subStepCount: 4,
    keyframes: [[ship, shipB]],
    contacts: [
      {
        subStep: 0,
        toi: 0.5,
        idA: 1,
        idB: 2,
        normal: of(1, 0, 0),
        point: of(10, 0, 0),
        relSpeedNormal: 2,
        damage: 4,
      },
    ],
    log: [
      trace.logCollision({
        turn: 1,
        sourceId: 1,
        targetId: 2,
        damage: overrides.tweakLogDamage ?? 4,
        shieldBefore: 5,
        shieldAfter: 1,
        hullBefore: 10,
        hullAfter: 10,
        killed: false,
      }),
    ],
    destroyed: [],
    removedHazardIds: [3],
  };
  const destroyed: DestructionEvent = {
    bodyId: 2,
    chassisClass: 'frigate',
    position: of(15, 0, 0),
    velocity: of(0, 0, 0),
    cause: 'weapon',
    detonates: true,
  };
  const attack: AttackBeatRecord = {
    log: [
      trace.logWeaponShot({
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
        calledShot: { kind: 'weapon', index: 2 },
      }),
    ],
    destroyed: [destroyed],
    launchedMissileIds: [7, 9],
  };
  const t1: TurnRecord = { turn: 1, movement, attack };
  let out = trace.emptyTrace(overrides.seedHi ?? 1, overrides.seedLo ?? 2);
  out = trace.withTurn(out, t1);
  if (overrides.extraTurn) {
    out = trace.withTurn(out, { turn: 2, movement, attack });
  }
  if (overrides.withOutcome ?? true) {
    out = trace.withOutcome(out, { kind: 'victory', fleetId: 1, turns: 1 });
  }
  return out;
};

describe('traceDigest — stable + sensitive', () => {
  it('produces an 8-character lowercase hex string', () => {
    const d = trace.traceDigest(buildTrace());
    expect(d).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across two independent builds of the same trace', () => {
    // A drift-guard against accidental Date/Math.random leakage: identical
    // input MUST digest identically. Anything else means state escaped.
    const a = trace.traceDigest(buildTrace());
    const b = trace.traceDigest(buildTrace());
    expect(a).toBe(b);
  });

  it('empty trace has a stable, well-defined digest', () => {
    const d = trace.traceDigest(trace.emptyTrace(0, 0));
    expect(d).toMatch(/^[0-9a-f]{8}$/);
    // Two empty traces with the same seed digest identically.
    expect(d).toBe(trace.traceDigest(trace.emptyTrace(0, 0)));
  });

  it('differs when the seed halves differ', () => {
    expect(trace.traceDigest(buildTrace({ seedHi: 1, seedLo: 2 }))).not.toBe(
      trace.traceDigest(buildTrace({ seedHi: 1, seedLo: 3 })),
    );
    expect(trace.traceDigest(buildTrace({ seedHi: 1, seedLo: 2 }))).not.toBe(
      trace.traceDigest(buildTrace({ seedHi: 2, seedLo: 2 })),
    );
  });

  it('differs when a body mass in a keyframe changes (float field is hashed)', () => {
    expect(trace.traceDigest(buildTrace({ tweakShipMass: 100 }))).not.toBe(
      trace.traceDigest(buildTrace({ tweakShipMass: 100.0001 })),
    );
  });

  it('differs when a log-entry damage number changes', () => {
    expect(trace.traceDigest(buildTrace({ tweakLogDamage: 4 }))).not.toBe(
      trace.traceDigest(buildTrace({ tweakLogDamage: 5 })),
    );
  });

  it('differs when the outcome is set vs pending', () => {
    expect(trace.traceDigest(buildTrace({ withOutcome: false }))).not.toBe(
      trace.traceDigest(buildTrace({ withOutcome: true })),
    );
  });

  it('differs when a turn is appended', () => {
    expect(trace.traceDigest(buildTrace({ extraTurn: false }))).not.toBe(
      trace.traceDigest(buildTrace({ extraTurn: true })),
    );
  });

  it('mutual-destruction and victory produce different digests (Custom Rule 5)', () => {
    let t = trace.emptyTrace(1, 2);
    t = trace.withTurn(t, {
      turn: 1,
      movement: {
        subStepCount: 4,
        keyframes: [[shipA]],
        contacts: [],
        log: [],
        destroyed: [],
        removedHazardIds: [],
      },
      attack: { log: [], destroyed: [], launchedMissileIds: [] },
    });
    const victory = trace.traceDigest(
      trace.withOutcome(t, { kind: 'victory', fleetId: 1, turns: 1 }),
    );
    const mutual = trace.traceDigest(
      trace.withOutcome(t, { kind: 'mutual-destruction', turns: 1 }),
    );
    expect(victory).not.toBe(mutual);
  });
});
