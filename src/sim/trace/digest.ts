// traceDigest — arithmetic-only hash of a ResolutionTrace (S05 goldens).
//
// The determinism suite (S05) compares whole traces cheaply by digest rather than by
// deep-equal. Two runs of the same seed + plans must produce byte-identical traces;
// a stable, sensitive hash gives that a one-line assertion. This module ships the
// hash and nothing else — the loop's `matchDigest` (S04) is a separate hash over
// `MatchState` and is the authoritative gate; this is a convenience over the RECORDING.
//
// The scheme is FNV-1a-32 over a fixed field schedule. `Math.imul` gives us bit-exact
// int32 multiplication across V8/SpiderMonkey/JSC (see rng.ts), and `DataView` with an
// explicit little-endian byte order pins the float64 → uint32 reinterpretation the
// same way on every engine (the raw typed-array views inherit platform byte order and
// would drift on a big-endian host). No transcendentals, no wall clock, no DOM —
// obeys the sim/** determinism ban-list (architecture §7.1).

import type { Vec3 } from '../mathx/index.js';
import type {
  Body,
  ChassisClass,
  CombatLogEntry,
  CombatLogResult,
  DamageSourceKind,
  DestructionEvent,
  CalledShotTarget,
} from '../types.js';
import type { StepContact } from '../physics/index.js';
import type {
  AttackBeatRecord,
  MatchOutcome,
  MovementBeatRecord,
  ResolutionTrace,
  TurnRecord,
} from './trace.js';

const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 0x01000193 | 0;

/** Mix one uint32 into the running hash, one byte at a time (FNV-1a). */
const mixU32 = (h: number, value: number): number => {
  let acc = h >>> 0;
  const v = value >>> 0;
  acc = acc ^ (v & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 8) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 16) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 24) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  return acc >>> 0;
};

/**
 * Mix a float64 by reinterpreting its IEEE-754 bit pattern as two uint32 halves.
 * DataView with `littleEndian: true` gives the same two words on every engine.
 */
const makeFloatMixer = () => {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  return (h: number, v: number): number => {
    view.setFloat64(0, v, true);
    return mixU32(mixU32(h, view.getUint32(0, true)), view.getUint32(4, true));
  };
};

/** Fixed enum → uint32 mappings so the schedule stays stable across TS refactors. */
const KIND_CODE: Readonly<Record<Body['kind'], number>> = {
  ship: 1,
  debris: 2,
  missile: 3,
};
const CLASS_CODE: Readonly<Record<ChassisClass, number>> = {
  fighter: 1,
  frigate: 2,
  cruiser: 3,
  'mega-destroyer': 4,
};
const BEAT_CODE: Readonly<Record<CombatLogEntry['beat'], number>> = {
  movement: 1,
  attack: 2,
};
const SOURCE_CODE: Readonly<Record<DamageSourceKind, number>> = {
  weapon: 1,
  missile: 2,
  collision: 3,
  aoe: 4,
  boundary: 5,
};
const RESULT_CODE: Readonly<Record<CombatLogResult, number>> = {
  hit: 1,
  miss: 2,
  crit: 3,
  kill: 4,
  intercept: 5,
  'boundary-exit': 6,
};
const CALLED_SHOT_CODE: Readonly<Record<CalledShotTarget['kind'], number>> = {
  weapon: 1,
  missile: 2,
  special: 3,
  'shield-generator': 4,
  engine: 5,
};
const OUTCOME_CODE: Readonly<Record<MatchOutcome['kind'], number>> = {
  victory: 1,
  'mutual-destruction': 2,
};

/** Deterministic 8-character hex digest of a trace. */
export const traceDigest = (trace: ResolutionTrace): string => {
  const mixF = makeFloatMixer();
  const mixVec = (h: number, v: Vec3): number =>
    mixF(mixF(mixF(h, v.x), v.y), v.z);

  const mixBody = (h: number, b: Body): number => {
    let acc = mixU32(h, b.id);
    acc = mixU32(acc, KIND_CODE[b.kind]);
    acc = mixVec(acc, b.position);
    acc = mixVec(acc, b.velocity);
    acc = mixF(acc, b.mass);
    acc = mixF(acc, b.radius);
    return acc;
  };

  const mixContact = (h: number, c: StepContact): number => {
    let acc = mixU32(h, c.subStep);
    acc = mixF(acc, c.toi);
    acc = mixU32(acc, c.idA);
    acc = mixU32(acc, c.idB);
    acc = mixVec(acc, c.normal);
    acc = mixVec(acc, c.point);
    acc = mixF(acc, c.relSpeedNormal);
    acc = mixF(acc, c.damage);
    return acc;
  };

  const mixLogEntry = (h: number, e: CombatLogEntry): number => {
    let acc = mixU32(h, e.turn);
    acc = mixU32(acc, BEAT_CODE[e.beat]);
    acc = mixU32(acc, SOURCE_CODE[e.source]);
    acc = mixU32(acc, e.sourceId);
    acc = mixU32(acc, e.targetId);
    acc = mixU32(acc, RESULT_CODE[e.result]);
    acc = mixF(acc, e.chance);
    acc = mixF(acc, e.roll);
    acc = mixF(acc, e.damage);
    acc = mixF(acc, e.shieldBefore);
    acc = mixF(acc, e.shieldAfter);
    acc = mixF(acc, e.hullBefore);
    acc = mixF(acc, e.hullAfter);
    if (e.calledShot === undefined) {
      acc = mixU32(acc, 0);
    } else {
      acc = mixU32(acc, CALLED_SHOT_CODE[e.calledShot.kind]);
      // `index` exists on weapon/missile/special variants only.
      const withIndex = e.calledShot as { readonly index?: number };
      acc = mixU32(acc, withIndex.index ?? 0);
    }
    return acc;
  };

  const mixDestruction = (h: number, d: DestructionEvent): number => {
    let acc = mixU32(h, d.bodyId);
    acc = mixU32(acc, CLASS_CODE[d.chassisClass]);
    acc = mixVec(acc, d.position);
    acc = mixVec(acc, d.velocity);
    acc = mixU32(acc, SOURCE_CODE[d.cause]);
    acc = mixU32(acc, d.detonates ? 1 : 0);
    return acc;
  };

  const mixMovement = (h: number, m: MovementBeatRecord): number => {
    let acc = mixU32(h, m.subStepCount);
    acc = mixU32(acc, m.keyframes.length);
    for (let k = 0; k < m.keyframes.length; k += 1) {
      const frame = m.keyframes[k]!;
      acc = mixU32(acc, frame.length);
      for (let i = 0; i < frame.length; i += 1) acc = mixBody(acc, frame[i]!);
    }
    acc = mixU32(acc, m.contacts.length);
    for (let i = 0; i < m.contacts.length; i += 1) acc = mixContact(acc, m.contacts[i]!);
    acc = mixU32(acc, m.log.length);
    for (let i = 0; i < m.log.length; i += 1) acc = mixLogEntry(acc, m.log[i]!);
    acc = mixU32(acc, m.destroyed.length);
    for (let i = 0; i < m.destroyed.length; i += 1) {
      acc = mixDestruction(acc, m.destroyed[i]!);
    }
    acc = mixU32(acc, m.removedHazardIds.length);
    for (let i = 0; i < m.removedHazardIds.length; i += 1) {
      acc = mixU32(acc, m.removedHazardIds[i]!);
    }
    return acc;
  };

  const mixAttack = (h: number, a: AttackBeatRecord): number => {
    let acc = mixU32(h, a.log.length);
    for (let i = 0; i < a.log.length; i += 1) acc = mixLogEntry(acc, a.log[i]!);
    acc = mixU32(acc, a.destroyed.length);
    for (let i = 0; i < a.destroyed.length; i += 1) {
      acc = mixDestruction(acc, a.destroyed[i]!);
    }
    acc = mixU32(acc, a.launchedMissileIds.length);
    for (let i = 0; i < a.launchedMissileIds.length; i += 1) {
      acc = mixU32(acc, a.launchedMissileIds[i]!);
    }
    return acc;
  };

  const mixTurn = (h: number, t: TurnRecord): number => {
    let acc = mixU32(h, t.turn);
    acc = mixMovement(acc, t.movement);
    acc = mixAttack(acc, t.attack);
    return acc;
  };

  let acc = FNV_OFFSET >>> 0;
  acc = mixU32(acc, trace.seedHi);
  acc = mixU32(acc, trace.seedLo);
  if (trace.outcome === null) {
    acc = mixU32(acc, 0);
  } else {
    acc = mixU32(acc, OUTCOME_CODE[trace.outcome.kind]);
    if (trace.outcome.kind === 'victory') acc = mixU32(acc, trace.outcome.fleetId);
    acc = mixU32(acc, trace.outcome.turns);
  }
  acc = mixU32(acc, trace.turns.length);
  for (let i = 0; i < trace.turns.length; i += 1) acc = mixTurn(acc, trace.turns[i]!);

  // 8 hex chars, zero-padded — the digest is a uint32.
  const hex = (acc >>> 0).toString(16);
  return '00000000'.slice(hex.length) + hex;
};
