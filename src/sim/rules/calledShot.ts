// calledShot — resolve a called shot against component integrity (M09, FR-25).
//
// Called shots are the reward for stripping shields. Weapon damage lands on the
// named subsystem's D-INTEGRITY pool instead of the hull; at ≤ 0 the subsystem
// dies and its knockout effect fires:
//
//   shield-generator ⇒ shieldGenAlive = false, shields = 0, capacity 0 for the
//                      rest of the match. Does NOT restore already-depleted
//                      shields (a struck generator can't reboot mid-match) —
//                      the "signature" mechanic of FR-25.
//   engine           ⇒ engineAlive = false. The loop zeroes deltaV — the ship
//                      coasts. (Enforcement lives in the loop's plan gate; the
//                      flag is the truth this file records.)
//   weapon[i]        ⇒ weaponAlive[i] = false. Attack.ts skips the slot next beat.
//   missile[i]       ⇒ missileAlive[i] = false. No launches from that rack again.
//   special[i]       ⇒ pdAlive[k] or decoyAlive[k] = false, per the canonical
//                      `specialLayout` (see combatState.ts).
//
// Ownership + legality:
//   • The caller (attack.ts) has already checked `calledShotsUnlocked(target)`;
//     a called shot against a shielded target is DEMOTED to a hull shot before
//     ever reaching this file.
//   • An index past `ship.weapons.length` (or the equivalent) is an invalid plan;
//     we treat it as a no-op (`destroyed: false`, `after` unchanged) rather than
//     throwing — the sim never crashes on a malformed plan, it degrades cleanly.

import type { CalledShotTarget } from '../types.js';
import {
  cloneShipCombat,
  specialLayout,
  type ShipCombat,
} from './combatState.js';

export interface CalledShotResult {
  readonly after: ShipCombat;
  /** True when this shot's damage brought the named subsystem's integrity to ≤ 0
   *  and its knockout effect fired. */
  readonly destroyed: boolean;
}

/**
 * Apply `incoming` damage to the named subsystem's integrity pool. Returns the
 * mutated `ShipCombat` clone plus a boolean "did the subsystem die this shot?".
 *
 * `incoming` is negative-safe: a caller that passes ≤ 0 leaves the pool untouched
 * (a no-op). Damage past the pool's remaining integrity is NOT re-routed to hull —
 * called shots are a subsystem trade, hull damage is a plain-shot outcome (attack.ts
 * partitions these; this file does not).
 */
export const resolveCalledShot = (
  target: ShipCombat,
  which: CalledShotTarget,
  incoming: number,
): CalledShotResult => {
  const after = cloneShipCombat(target);
  if (incoming <= 0) return { after, destroyed: false };

  switch (which.kind) {
    case 'shield-generator': {
      if (!after.shieldGenAlive) return { after, destroyed: false };
      const remaining = after.componentIntegrity.shieldGenerator - incoming;
      after.componentIntegrity.shieldGenerator = remaining < 0 ? 0 : remaining;
      if (remaining <= 0) {
        after.shieldGenAlive = false;
        after.shields = 0;
        return { after, destroyed: true };
      }
      return { after, destroyed: false };
    }
    case 'engine': {
      if (!after.engineAlive) return { after, destroyed: false };
      const remaining = after.componentIntegrity.engine - incoming;
      after.componentIntegrity.engine = remaining < 0 ? 0 : remaining;
      if (remaining <= 0) {
        after.engineAlive = false;
        return { after, destroyed: true };
      }
      return { after, destroyed: false };
    }
    case 'weapon': {
      const i = which.index;
      if (i < 0 || i >= after.weaponAlive.length) return { after, destroyed: false };
      if (!after.weaponAlive[i]!) return { after, destroyed: false };
      const remaining = after.componentIntegrity.weapons[i]! - incoming;
      after.componentIntegrity.weapons[i] = remaining < 0 ? 0 : remaining;
      if (remaining <= 0) {
        after.weaponAlive[i] = false;
        return { after, destroyed: true };
      }
      return { after, destroyed: false };
    }
    case 'missile': {
      const i = which.index;
      if (i < 0 || i >= after.missileAlive.length) return { after, destroyed: false };
      if (!after.missileAlive[i]!) return { after, destroyed: false };
      const remaining = after.componentIntegrity.missiles[i]! - incoming;
      after.componentIntegrity.missiles[i] = remaining < 0 ? 0 : remaining;
      if (remaining <= 0) {
        after.missileAlive[i] = false;
        return { after, destroyed: true };
      }
      return { after, destroyed: false };
    }
    case 'special': {
      const layout = specialLayout(after.ship, which.index);
      if (layout === null) return { after, destroyed: false };
      // The special integrity pool is one flat array; the layout tells us which
      // per-subsystem alive flag to also flip on knockout.
      if (
        (layout.kind === 'pd' && !after.pdAlive[layout.subIndex]!) ||
        (layout.kind === 'decoy' && !after.decoyAlive[layout.subIndex]!)
      ) {
        return { after, destroyed: false };
      }
      const remaining = after.componentIntegrity.specials[which.index]! - incoming;
      after.componentIntegrity.specials[which.index] = remaining < 0 ? 0 : remaining;
      if (remaining <= 0) {
        if (layout.kind === 'pd') after.pdAlive[layout.subIndex] = false;
        else after.decoyAlive[layout.subIndex] = false;
        return { after, destroyed: true };
      }
      return { after, destroyed: false };
    }
  }
};
