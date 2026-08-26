// damage — hit chance, seeded rolls, order-independent damage application (M09).
//
// The hit-chance formula and its coefficients (D-HITCHANCE in STATE.md) live HERE
// per Ruling H (architecture §13.3). The UI reads the published `HitChanceBreakdown`
// from `sim/types.ts`; nothing else recomputes hit chance.
//
// Determinism (architecture §7.2, §7.3):
//   - RNG is counter-based via `mathx/rng.ts`. Every draw is a pure function of
//     (seed, turn, streamTag, shooterId, targetId, shotIndex) — order-of-call
//     independent. STREAM_ATTACK below is the fixed uint32 stream tag for weapon
//     rolls; other rules files pick distinct constants for their own streams.
//   - Damage bundles are sorted by `(sourceId, shotIndex)` BEFORE summation.
//     Float addition is not associative, so the sort is load-bearing (not cosmetic).
//   - No transcendentals — `powi` from `mathx/trig.ts` covers the integer exponent.

import { powi } from '../mathx/index.js';
import { rand01, type Seed } from '../mathx/index.js';
import type { BodyId, HitChanceBreakdown, SimWeapon } from '../types.js';
import { cloneShipCombat, type Damage, type ShipCombat } from './combatState.js';

// ---- D-HITCHANCE (design default, harness-tunable) ---------------------------------
// The exponent applied to `range / weapon.range` in the range factor. Higher →
// steeper falloff (hits stay strong deep into a weapon's envelope, then die off fast
// near max). 2 = pure quadratic falloff, uses `powi` (no `Math.pow`).
// PROMOTION SEAM: when the harness settles the curve, these move into a future
// `tuning.combat` block — same values, different home. Do NOT invent a catalog field
// or a CombatConfig.hitChance seat yet (SESSION-02 envelope).
export const RANGE_EXP = 2;

/** Reference speed at which a target's velocity factor reaches zero. Approximates the
 *  top speed a mega-destroyer + thrust-booster combo can hold — anything past this
 *  clamps to zero contribution, not negative. */
export const VELOCITY_REF = 800;

/** Absolute floor on the final hit chance — even a maxed-out target can be hit ~5%
 *  of the time by a shot that would otherwise resolve at 0. */
export const HIT_FLOOR = 0.05;

/** Absolute ceiling on the final hit chance — even point-blank on a stationary hulk,
 *  no shot is a guaranteed hit. */
export const HIT_CEIL = 0.95;

/** Fixed uint32 stream tag for weapon hit rolls. Distinct tags separate the RNG
 *  streams so a stray reorder of PD interception can't corrupt an attack roll and
 *  vice versa (see missiles.ts, calledShot.ts for their own tags). */
export const STREAM_ATTACK = 0xa77c0000;

// ---- Local arithmetic helpers (no transcendentals) ---------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const clampTo = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

// ---- Hit chance --------------------------------------------------------------------

/**
 * The complete hit-chance formula (Ruling H). Terms are fixed by spec (range, target
 * velocity, target evasion); coefficients are D-HITCHANCE constants above.
 *
 * `targetEvasion` MUST already include any decoy bonus (attack.ts adds it in). Passing
 * "raw" evasion here loses the decoy effect — the caller owns that combination so this
 * function stays a pure formula, not a state peek.
 */
export const hitChance = (
  weapon: SimWeapon,
  range: number,
  targetSpeed: number,
  targetEvasion: number,
): HitChanceBreakdown => {
  const base = weapon.accuracy;

  // Range factor: 1 at point-blank, 0 at max range, RANGE_EXP-th power falloff.
  // A shot ordered beyond weapon.range still evaluates here — the caller (attack.ts)
  // is what refuses out-of-range assignments; this formula stays a pure clamp.
  const rangeRatio = weapon.range > 0 ? range / weapon.range : 1;
  const rangeFactor = clamp01(1 - powi(rangeRatio, RANGE_EXP));

  // Velocity factor: fast movers are harder. Zero-speed reference gives 1.
  const velocityFactor =
    VELOCITY_REF > 0 ? clamp01(1 - targetSpeed / VELOCITY_REF) : 1;

  // Evasion factor: 0..~0.6 typical chassis + up to 0.4 active decoy — the sum can
  // exceed 1, so clamp01 protects the multiplier.
  const evasionFactor = clamp01(1 - targetEvasion);

  const raw = base * rangeFactor * velocityFactor * evasionFactor;
  const final = clampTo(raw, HIT_FLOOR, HIT_CEIL);

  return { base, rangeFactor, velocityFactor, evasionFactor, final };
};

// ---- Seeded roll -------------------------------------------------------------------

/**
 * Roll a single shot's hit outcome from the counter-based RNG. Coordinates are
 * `(turn, STREAM_ATTACK, shooterId, targetId, shotIndex)` — including `targetId`
 * separates two shots by the same shooter at different targets in the same beat,
 * preventing accidental correlation.
 */
export const rollHit = (
  chance: number,
  seed: Seed,
  turn: number,
  shooterId: BodyId,
  targetId: BodyId,
  shotIndex: number,
): { hit: boolean; roll: number } => {
  const roll = rand01(seed, turn, STREAM_ATTACK, shooterId, targetId, shotIndex);
  return { hit: roll < chance, roll };
};

// ---- Damage application ------------------------------------------------------------

/**
 * Sort a damage bundle by `(sourceId, shotIndex)`. Both `sourceId` and `shotIndex`
 * are finite integers, so `-` is safe; ties are impossible in well-formed bundles
 * (one shot per (shooter, shotIndex) pair) but the comparator is total either way.
 */
const sortBundle = (bundle: readonly Damage[]): Damage[] => {
  const out = bundle.slice();
  out.sort((a, b) => {
    if (a.sourceId !== b.sourceId) return a.sourceId - b.sourceId;
    return a.shotIndex - b.shotIndex;
  });
  return out;
};

export interface ApplyDamageResult {
  readonly after: ShipCombat;
  readonly shieldBefore: number;
  readonly shieldAfter: number;
  readonly hullBefore: number;
  readonly hullAfter: number;
  /** Damage sunk into shields this bundle. */
  readonly shieldDamage: number;
  /** Damage sunk into hull this bundle (overflow past shields). */
  readonly hullDamage: number;
}

/**
 * Apply a bundle of `Damage` to a target — shields first, overflow to hull (FR-25),
 * ONE pass after the load-bearing sort. Returns the mutated `ShipCombat` clone plus
 * before/after pools so the caller can build `CombatLogEntry` deltas.
 *
 * Order independence: `applyDamageBundle(target, shuffle(bundle))` yields the same
 * `after` for identical `bundle` contents. The shuffle test in the S05 determinism
 * suite exercises this by construction.
 */
export const applyDamageBundle = (
  target: ShipCombat,
  bundle: readonly Damage[],
): ApplyDamageResult => {
  const after = cloneShipCombat(target);
  const shieldBefore = after.shields;
  const hullBefore = after.hull;

  const sorted = sortBundle(bundle);
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) total += sorted[i]!.amount;

  const shieldsTaken = total <= after.shields ? total : after.shields;
  after.shields = after.shields - shieldsTaken;
  const overflow = total - shieldsTaken;
  after.hull = after.hull - overflow;

  return {
    after,
    shieldBefore,
    shieldAfter: after.shields,
    hullBefore,
    hullAfter: after.hull,
    shieldDamage: shieldsTaken,
    hullDamage: overflow,
  };
};

// ---- Area-of-effect falloff --------------------------------------------------------

/**
 * Linear AoE falloff. `centerDamage` at `distance == 0`, zero at `distance >= radius`.
 * Clamped ≥ 0 — a distance past the radius returns 0, not a negative amount.
 * Ownership is NOT checked (FR-23, Decision 13) — the caller applies the result to
 * every body in range, friendly or not.
 */
export const aoeFalloff = (
  centerDamage: number,
  distance: number,
  radius: number,
): number => {
  if (radius <= 0) return 0;
  if (distance <= 0) return centerDamage;
  if (distance >= radius) return 0;
  return centerDamage * (1 - distance / radius);
};
