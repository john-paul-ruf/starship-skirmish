// M05 Domain — derivedStats (FR-6, specs/database.md §2.3 SCHEMA DECISION).
//
// The Shipyard readout: the single source of truth the UI shows for "what does
// this fit actually do". Every downstream (S03 resolveShip, F5 ai bot construction,
// F7 Shipyard UI) reuses this — the deltaV/mass formula in particular is not
// re-derived anywhere else so a single edit here changes it everywhere.
//
// Formulas (specs/database.md §2.3):
//   totalMass       = chassis.mass + Σ component.mass
//   deltaVPerTurn   = (Σ engine.thrustImpulse + Σ thrust-booster.thrustImpulseBonus) / totalMass
//   effectiveAccel  = deltaVPerTurn / tuning.match.turnDurationSeconds
//
// Passive special effects fold into the readout:
//   armor-plating  → maxHull += bonusHull
//   thrust-booster → included in deltaV numerator (before the divide)
//   damage-control → perTurnHullRepair
//
// Active specials are NOT folded — they're per-turn rules `sim/rules` owns:
//   decoy-launcher → evasionBonus is a timed, charge-limited effect (a rule),
//                    deliberately NOT added to `baseEvasion` (a UI showing
//                    it as permanent evasion would lie)
//   point-defense → interception is per-turn behaviour
//
// SHAPE DECISION: DerivedStats is declared here, not in ./types.ts. types.ts
// (S02's lease) holds a `{_s03Placeholder?: never}` stub that this file's real
// interface supersedes; the barrel `src/domain/index.ts` re-exports THIS
// declaration. See STATE.md Design Decisions.
//
// DEGENERATE FIT: no delta-V floor (specs/database.md §11 Q4). A cheapest-engine
// on a heaviest hull reports ~10 delta-V — a legal-but-bad ship. A floor is a
// data/tuning decision, not a code one.

import type { Catalog, EngineDef, MissileDef, ShieldDef, SpecialDef, WeaponDef } from '../catalog/index.js';
import type { ValidatedBuild } from './types.js';

/**
 * One row of the FR-6 weapon table. Base stats from the catalog — the full
 * hit-chance formula (range, evasion, decoy bonus) lives in `sim/rules` and is
 * never duplicated here or in the UI.
 */
export interface SimWeaponReadout {
  readonly name: string;
  readonly range: number;
  readonly damage: number;
  readonly shotsPerTurn: number;
  readonly accuracy: number;
}

/**
 * The FR-6 Shipyard readout for a validated build. Everything a player needs to
 * judge a fit — nothing more (no leftover/points-remaining surface here; the
 * Skirmish setup is where budget vs. spend is compared, FR-10).
 */
export interface DerivedStats {
  /** chassis.mass + Σ component.mass (§2.3). Always > 0 (chassis mass > 0). */
  readonly totalMass: number;
  /** chassis.hullPoints + Σ armor-plating.bonusHull. */
  readonly maxHull: number;
  /** Σ shield.capacity across fitted shields (0 for a fighter / no shield). */
  readonly shieldCapacity: number;
  /** Σ shield.regenPerTurn across fitted shields. */
  readonly shieldRegenPerTurn: number;
  /** (Σ engine.thrustImpulse + Σ thrust-booster.bonus) / totalMass. 0 = dead in space (legal). */
  readonly deltaVPerTurn: number;
  /** deltaVPerTurn / tuning.match.turnDurationSeconds. FR-6 separate readout. */
  readonly effectiveAcceleration: number;
  /** Σ missile-rack.ammo across fitted missile racks. */
  readonly totalMissileAmmo: number;
  /** Σ damage-control.hullRepairPerTurn across fitted specials. */
  readonly perTurnHullRepair: number;
  /**
   * Chassis base evasion (0 ≤ x < 1). Deliberately does NOT fold
   * decoy-launcher's evasionBonus — that is a per-turn timed effect owned by
   * `sim/rules`, not a static stat.
   */
  readonly baseEvasion: number;
  /** One entry per fitted weapon, in slot order. */
  readonly weapons: readonly SimWeaponReadout[];
}

/**
 * Compute the FR-6 readout for a validated build.
 *
 * Requires `ValidatedBuild` — deriving stats for a fit whose chassis / slot
 * types haven't been proved legal is a category error (the validate → derive
 * pipeline order, §7.2, made into a compile-time gate). The Shipyard UI runs
 * `validateFit` before displaying stats; on failure it shows the error list,
 * not stats.
 */
export const derivedStats = (
  catalog: Catalog,
  validated: ValidatedBuild,
): DerivedStats => {
  const build = validated.build;

  // Chassis is guaranteed to resolve — validateFit already established this.
  // Under noUncheckedIndexedAccess we still handle undefined defensively (a
  // silent 0 is safer than a runtime throw across the domain boundary).
  const chassis = catalog.chassis(build.chassisId);
  const chassisMass = chassis?.mass ?? 0;
  const chassisHull = chassis?.hullPoints ?? 0;
  const baseEvasion = chassis?.baseEvasion ?? 0;

  let totalMass = chassisMass;
  let bonusHull = 0;
  let shieldCapacity = 0;
  let shieldRegenPerTurn = 0;
  let thrustImpulseSum = 0;
  let thrustBoosterBonus = 0;
  let totalMissileAmmo = 0;
  let perTurnHullRepair = 0;
  const weapons: SimWeaponReadout[] = [];

  for (const componentId of build.slots) {
    if (componentId === null) continue;
    const component = catalog.component(componentId);
    if (component === undefined) continue;

    totalMass += component.mass;

    switch (component.slotType) {
      case 'weapon': {
        const weapon = component as WeaponDef;
        weapons.push({
          name: weapon.name,
          range: weapon.stats.range,
          damage: weapon.stats.damage,
          shotsPerTurn: weapon.stats.shotsPerTurn,
          accuracy: weapon.stats.accuracy,
        });
        break;
      }
      case 'shield': {
        const shield = component as ShieldDef;
        shieldCapacity += shield.stats.capacity;
        shieldRegenPerTurn += shield.stats.regenPerTurn;
        break;
      }
      case 'missile': {
        const missile = component as MissileDef;
        totalMissileAmmo += missile.stats.ammo;
        break;
      }
      case 'engine': {
        const engine = component as EngineDef;
        thrustImpulseSum += engine.stats.thrustImpulse;
        break;
      }
      case 'special': {
        const special = component as SpecialDef;
        switch (special.stats.effect) {
          case 'armor-plating':
            bonusHull += special.stats.bonusHull;
            break;
          case 'thrust-booster':
            thrustBoosterBonus += special.stats.thrustImpulseBonus;
            break;
          case 'damage-control':
            perTurnHullRepair += special.stats.hullRepairPerTurn;
            break;
          // decoy-launcher and point-defense are per-turn rules (sim/rules) —
          // they are NOT folded into the static readout.
          case 'decoy-launcher':
          case 'point-defense':
            break;
        }
        break;
      }
    }
  }

  const turnDurationSeconds = catalog.tuning.match.turnDurationSeconds;
  // totalMass > 0 by construction (chassis.mass > 0). No divide-by-zero guard needed.
  const deltaVPerTurn = (thrustImpulseSum + thrustBoosterBonus) / totalMass;
  // turnDurationSeconds > 0 by tuning invariant; no guard.
  const effectiveAcceleration = deltaVPerTurn / turnDurationSeconds;

  return {
    totalMass,
    maxHull: chassisHull + bonusHull,
    shieldCapacity,
    shieldRegenPerTurn,
    deltaVPerTurn,
    effectiveAcceleration,
    totalMissileAmmo,
    perTurnHullRepair,
    baseEvasion,
    weapons,
  };
};
