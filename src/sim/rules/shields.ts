// shields — shield regen and called-shot legality gate (M09, FR-25 + Ruling E).
//
// Regen ticks EVERY turn regardless of damage (Ruling E; the corresponding tuning
// flag `shields.regenTicksRegardlessOfDamage` is loaded through CombatConfig and
// asserted here defensively). Kill the generator and capacity drops to zero for
// the rest of the match — the "generator kill" play from mocks/tactical-attack.html.
//
// Called shots are only legal against unshielded targets (Decision 4). The loop /
// UI gate on this; a plan that names a `calledShot` against a shielded target must
// be resolved by the attack beat as a hull shot (attack.ts handles the demotion).

import type { CombatConfig } from '../types.js';
import { cloneShipCombat, type ShipCombat } from './combatState.js';

/**
 * Tick per-turn shield regen. If the generator is alive, `shields` climbs by
 * `ship.shieldRegenPerTurn` up to `shieldCapacity`. If the generator is dead, capacity
 * is zero — no regen and shields clamp to zero even if a stale value sits in the field.
 *
 * Called by the loop ONCE per turn. `cfg.shields.regenTicksRegardlessOfDamage` is
 * pinned true per Ruling E; a caller that ever flips it to false would suppress the
 * tick — the `if` here honours it exactly.
 */
export const regenShields = (
  sc: ShipCombat,
  cfg: CombatConfig,
): ShipCombat => {
  const out = cloneShipCombat(sc);
  if (!out.shieldGenAlive) {
    // Dead generator: capacity is 0. Any stray positive value clamps to 0.
    if (out.shields > 0) out.shields = 0;
    return out;
  }
  if (!cfg.shields.regenTicksRegardlessOfDamage) return out;
  const cap = out.ship.shieldCapacity;
  const next = out.shields + out.ship.shieldRegenPerTurn;
  out.shields = next > cap ? cap : next;
  return out;
};

/**
 * True when the target's shields are at zero (Decision 4). The attack beat consults
 * this to decide whether an `AttackPlan.calledShot` resolves as a component hit or
 * is demoted to a plain hull shot.
 */
export const calledShotsUnlocked = (target: ShipCombat): boolean =>
  target.shields <= 0;
