// combatLog — append-only combat-log accumulator + typed event constructors (FR-21).
//
// This module is the *transcript builder*. It never reorders events; canonical ordering
// is the loop's job (S04 sorts by `(sourceId, shotIndex)` before it pushes into the log,
// so two runs of the same beat produce identical logs regardless of internal iteration).
// The accumulator is pure — no wall clock, no DOM — so it obeys the sim/** determinism
// ban-list by construction (§7.1).
//
// The typed constructors below fill in the fields that a given event kind ALWAYS sets
// the same way — `source`, `beat`, `result` for the fixed cases, `chance`/`roll` = 0
// for events without a seeded draw — so callers (rules, via the loop) can't accidentally
// mis-tag a collision as a weapon shot or vice versa. Every returned entry is frozen so
// the renderer (which reads traces but never mutates them, architecture §4/§6.2) has
// that guarantee structurally.

import type {
  BodyId,
  CalledShotTarget,
  CombatLogEntry,
  CombatLogResult,
} from '../types.js';

/** An append-only combat log — the wire format the loop hands the renderer + post-match. */
export interface CombatLog {
  readonly entries: readonly CombatLogEntry[];
}

/** Empty log. Frozen — appending returns a new log rather than mutating this one. */
export const emptyLog = (): CombatLog => Object.freeze({ entries: Object.freeze([]) });

/**
 * Append pre-built entries to a log in the caller's order.
 *
 * The accumulator NEVER reorders — this is what makes canonical order the loop's
 * responsibility, not a hidden side effect of this module. Callers push entries in
 * canonical `(sourceId, shotIndex)` order; two runs of the same beat therefore produce
 * bit-identical logs (determinism, §7.3). Input `log` is unchanged; the returned log
 * is a fresh frozen object with a fresh frozen entries array.
 */
export const appendEntries = (
  log: CombatLog,
  more: readonly CombatLogEntry[],
): CombatLog => {
  if (more.length === 0) return log;
  const entries = Object.freeze([...log.entries, ...more]);
  return Object.freeze({ entries });
};

// ---- Typed event constructors ------------------------------------------------
// Each constructor takes only the fields that vary per event and hardcodes what the
// event's kind always fixes. The point is compile-time safety: rules cannot claim a
// collision has a `weapon.accuracy`-derived hit chance, or forget to set `source`.
// Every returned entry is frozen (see file header).

/** A weapon shot in the attack beat — the primary path for hit/miss/crit/kill. */
export interface WeaponShotArgs {
  readonly turn: number;
  readonly shooterId: BodyId;
  readonly targetId: BodyId;
  /** Attack-beat outcomes: rolled shots resolve to one of these four. */
  readonly result: 'hit' | 'miss' | 'crit' | 'kill';
  readonly chance: number;
  readonly roll: number;
  readonly damage: number;
  readonly shieldBefore: number;
  readonly shieldAfter: number;
  readonly hullBefore: number;
  readonly hullAfter: number;
  readonly calledShot?: CalledShotTarget;
}

export const logWeaponShot = (args: WeaponShotArgs): CombatLogEntry => {
  const base = {
    turn: args.turn,
    beat: 'attack' as const,
    source: 'weapon' as const,
    sourceId: args.shooterId,
    targetId: args.targetId,
    result: args.result as CombatLogResult,
    chance: args.chance,
    roll: args.roll,
    damage: args.damage,
    shieldBefore: args.shieldBefore,
    shieldAfter: args.shieldAfter,
    hullBefore: args.hullBefore,
    hullAfter: args.hullAfter,
  };
  return Object.freeze(
    args.calledShot !== undefined
      ? { ...base, calledShot: args.calledShot }
      : base,
  );
};

/**
 * A collision in the movement beat — physics contact damage applied to one body.
 * Physics emits `StepContact` with a single `damage` scalar applied to BOTH bodies;
 * the rules layer records TWO log entries per contact (one per participant), which is
 * why this constructor takes exactly the (source, target) pair — not the pair-shape.
 * No seeded roll: `chance`/`roll` are 0.
 */
export interface CollisionArgs {
  readonly turn: number;
  readonly sourceId: BodyId;
  readonly targetId: BodyId;
  readonly damage: number;
  readonly shieldBefore: number;
  readonly shieldAfter: number;
  readonly hullBefore: number;
  readonly hullAfter: number;
  /** `'kill'` when this contact took the target below zero hull; else `'hit'`. */
  readonly killed: boolean;
}

export const logCollision = (args: CollisionArgs): CombatLogEntry =>
  Object.freeze({
    turn: args.turn,
    beat: 'movement' as const,
    source: 'collision' as const,
    sourceId: args.sourceId,
    targetId: args.targetId,
    result: (args.killed ? 'kill' : 'hit') as CombatLogResult,
    chance: 0,
    roll: 0,
    damage: args.damage,
    shieldBefore: args.shieldBefore,
    shieldAfter: args.shieldAfter,
    hullBefore: args.hullBefore,
    hullAfter: args.hullAfter,
  });

/**
 * Area-of-effect damage from a destruction detonation (FR-23). Ownership-blind — the
 * `sourceId` is the destroyed body whose blast caused this damage, not a "shooter".
 * No seeded roll. Occurs in the movement beat that follows destruction.
 */
export interface AoeArgs {
  readonly turn: number;
  /** The exploded body — used only to attribute the blast in the log. */
  readonly sourceId: BodyId;
  readonly targetId: BodyId;
  readonly damage: number;
  readonly shieldBefore: number;
  readonly shieldAfter: number;
  readonly hullBefore: number;
  readonly hullAfter: number;
  readonly killed: boolean;
}

export const logAoe = (args: AoeArgs): CombatLogEntry =>
  Object.freeze({
    turn: args.turn,
    beat: 'movement' as const,
    source: 'aoe' as const,
    sourceId: args.sourceId,
    targetId: args.targetId,
    result: (args.killed ? 'kill' : 'hit') as CombatLogResult,
    chance: 0,
    roll: 0,
    damage: args.damage,
    shieldBefore: args.shieldBefore,
    shieldAfter: args.shieldAfter,
    hullBefore: args.hullBefore,
    hullAfter: args.hullAfter,
  });

/**
 * A point-defense intercept of an incoming missile. The defender's PD turret is the
 * `sourceId`, the missile body is the `targetId`. Interception is a seeded coin flip
 * (`chance`, `roll`), and on success the missile is removed — no damage to the
 * defender, so all shield/hull deltas are zero.
 */
export interface InterceptArgs {
  readonly turn: number;
  readonly beat: 'movement' | 'attack';
  /** The point-defense ship (shooter). */
  readonly sourceId: BodyId;
  /** The missile being intercepted. */
  readonly targetId: BodyId;
  readonly chance: number;
  readonly roll: number;
  /** True when the roll succeeded — otherwise the intercept missed. */
  readonly intercepted: boolean;
}

export const logIntercept = (args: InterceptArgs): CombatLogEntry =>
  Object.freeze({
    turn: args.turn,
    beat: args.beat,
    // A point-defense turret IS a weapon; the missile is the target, not the source.
    // 'missile' would misread as "damage from a missile"; the entry is damage TO one.
    source: 'weapon' as const,
    sourceId: args.sourceId,
    targetId: args.targetId,
    result: (args.intercepted ? 'intercept' : 'miss') as CombatLogResult,
    chance: args.chance,
    roll: args.roll,
    damage: 0,
    shieldBefore: 0,
    shieldAfter: 0,
    hullBefore: 0,
    hullAfter: 0,
  });

/**
 * A ship crossing the arena boundary (FR-26). Destroyed with no AoE/debris — the
 * detonation point is outside — but the exit itself IS logged (silent removal is for
 * hazards, which do not call this constructor at all). `sourceId === targetId` since
 * the exiting ship is both the actor and the subject of the event.
 */
export interface BoundaryExitArgs {
  readonly turn: number;
  readonly shipId: BodyId;
  /** Ship hull before removal — pool snapshot for UI parity with damage entries. */
  readonly hullBefore: number;
  readonly shieldBefore: number;
}

export const logBoundaryExit = (args: BoundaryExitArgs): CombatLogEntry =>
  Object.freeze({
    turn: args.turn,
    beat: 'movement' as const,
    source: 'boundary' as const,
    sourceId: args.shipId,
    targetId: args.shipId,
    result: 'boundary-exit' as CombatLogResult,
    chance: 0,
    roll: 0,
    damage: 0,
    shieldBefore: args.shieldBefore,
    shieldAfter: 0,
    hullBefore: args.hullBefore,
    hullAfter: 0,
  });
