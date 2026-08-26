// M05 Domain — resolveFleet (architecture §4, the domain → sim seam).
//
// Turns validated builds into `SimShip`/`SimFleet` — the plain structs the sim
// consumes. The sim boundary forbids `sim → domain` (`sim/loop` (F4) cannot see
// a Catalog or a Build), so the resolved contract lives in `sim/types.ts` and
// this file crosses the seam by producing it.
//
// Passive effects have already been folded by `derivedStats` (S03 checkpoint 1)
// — we reuse those numbers rather than re-deriving the deltaV/mass formula in
// two places. Active effects (point-defense, decoy) are carried STRUCTURED in
// their own arrays for `sim/rules` (F4) to interpret per turn.
//
// The ValidatedBuild requirement is the pipeline order made into a compile-time
// gate (§7.2 validate → resolve). A caller cannot resolve a Build that hasn't
// been proved fit — the type system forbids it.
//
// `resolveArena` and `physicsConfigFromTuning` are the tuning → sim-config seam:
// physics never imports the catalog (see `src/sim/physics/config.ts`), so the
// caller reads tuning and passes a plain struct in. F4 `sim/loop` will assemble
// the full `MatchConfig` (seed + fleets + arena) on top of these.

import type {
  Catalog,
  EngineDef,
  MissileDef,
  ShieldDef,
  SpecialDef,
  Tuning,
  WeaponDef,
} from '../catalog/index.js';
import type { PhysicsConfig } from '../sim/physics/index.js';
import type {
  Arena,
  ChassisClass,
  CombatConfig,
  SimDecoy,
  SimFleet,
  SimMissileRack,
  SimPointDefense,
  SimShip,
  SimWeapon,
} from '../sim/types.js';
import { derivedStats } from './derivedStats.js';
import type { ValidatedBuild } from './types.js';

// The origin used for every match's arena centre. Kept as a module-local
// literal to avoid depending on `sim/mathx` at value level (types-only import
// keeps this file's dependency profile minimal).
const ARENA_CENTER = { x: 0, y: 0, z: 0 } as const;

// Function declaration so TS control-flow narrows past the guard (same S01
// handoff note that S02 followed). Used only for genuine caller bugs —
// unvalidated illegal input (bad budget, missing chassis) that should have
// been caught earlier in the pipeline.
function fail(message: string): never {
  throw new RangeError(message);
}

/**
 * Resolve one validated build into the immutable `SimShip` the sim consumes.
 * Reuses `derivedStats` for the folded numbers (mass, hull, shield, delta-V,
 * repair, base evasion). Iterates slots once more to carry the structured
 * active effects and per-weapon / per-missile stats the folded readout can't
 * express.
 */
export const resolveShip = (
  catalog: Catalog,
  validated: ValidatedBuild,
): SimShip => {
  const build = validated.build;

  // Chassis is guaranteed to resolve — validateFit already established this.
  // A missing chassis here would be a hard invariant break (someone constructed
  // a ValidatedBuild manually with a bad chassisId); fail loud, not silent.
  const chassis = catalog.chassis(build.chassisId);
  if (chassis === undefined) {
    fail(`resolveShip: chassis "${build.chassisId}" not in catalog (validated build invariant broken).`);
  }

  const stats = derivedStats(catalog, validated);

  const weapons: SimWeapon[] = [];
  const missiles: SimMissileRack[] = [];
  const pointDefense: SimPointDefense[] = [];
  const decoys: SimDecoy[] = [];

  for (const componentId of build.slots) {
    if (componentId === null) continue;
    const component = catalog.component(componentId);
    if (component === undefined) continue;

    switch (component.slotType) {
      case 'weapon': {
        const weapon = component as WeaponDef;
        weapons.push({
          range: weapon.stats.range,
          damage: weapon.stats.damage,
          shotsPerTurn: weapon.stats.shotsPerTurn,
          accuracy: weapon.stats.accuracy,
        });
        break;
      }
      case 'missile': {
        const rack = component as MissileDef;
        missiles.push({
          ammo: rack.stats.ammo,
          damage: rack.stats.damage,
          aoeRadius: rack.stats.aoeRadius,
          boostVelocity: rack.stats.boostVelocity,
          trackingTurnRate: rack.stats.trackingTurnRate,
          bodyMass: rack.stats.bodyMass,
          bodyRadius: rack.stats.bodyRadius,
        });
        break;
      }
      case 'special': {
        const special = component as SpecialDef;
        switch (special.stats.effect) {
          case 'point-defense':
            pointDefense.push({
              interceptRange: special.stats.interceptRange,
              interceptChance: special.stats.interceptChance,
              interceptsPerTurn: special.stats.interceptsPerTurn,
            });
            break;
          case 'decoy-launcher':
            decoys.push({
              charges: special.stats.charges,
              evasionBonus: special.stats.evasionBonus,
              durationTurns: special.stats.durationTurns,
            });
            break;
          // armor-plating, thrust-booster, damage-control are passive — folded
          // into `stats` above (maxHull, deltaVPerTurn, hullRepairPerTurn).
          case 'armor-plating':
          case 'thrust-booster':
          case 'damage-control':
            break;
        }
        break;
      }
      // Shield and engine are folded into stats — reference here to satisfy the
      // exhaustive-switch check while making no per-component contribution.
      case 'shield':
      case 'engine': {
        // shields/engines fold into `derivedStats` — nothing structured to carry.
        // Reference the discriminants to satisfy exhaustive-switch checking.
        void (component as ShieldDef | EngineDef);
        break;
      }
    }
  }

  return {
    buildId: build.id,
    name: build.name,
    // Structurally identical string-literal union — plain assignment across the
    // catalog/sim seam is legal (see file header note).
    chassisClass: chassis.classId,
    mass: stats.totalMass,
    radius: chassis.hullRadius,
    maxHull: stats.maxHull,
    shieldCapacity: stats.shieldCapacity,
    shieldRegenPerTurn: stats.shieldRegenPerTurn,
    deltaVPerTurn: stats.deltaVPerTurn,
    baseEvasion: stats.baseEvasion,
    hullRepairPerTurn: stats.perTurnHullRepair,
    weapons,
    missiles,
    pointDefense,
    decoys,
  };
};

/**
 * Resolve a fleet: turn N validated builds into a `SimFleet` with the given
 * roster id. Requires `ValidatedBuild[]` so a fleet can never be resolved from
 * an unvalidated fit (the type system enforces the §7.2 validate → resolve
 * pipeline order).
 */
export const resolveFleet = (
  catalog: Catalog,
  fleetId: number,
  builds: readonly ValidatedBuild[],
): SimFleet => ({
  fleetId,
  ships: builds.map((b) => resolveShip(catalog, b)),
});

/**
 * The bounded arena for a match budget (`tuning.arena.radiusByBudget`, keyed by
 * budget-as-string per JSON limitation). Ratifies Ruling C — arena radius is a
 * function of budget, exposed as a pure data table (catalog lock C9 asserts the
 * keys match `match.legalBudgets`). An illegal budget throws — the Skirmish
 * setup pipeline must have already validated budget against `legalBudgets`
 * before reaching here.
 */
export const resolveArena = (tuning: Tuning, budget: number): Arena => {
  const radius = tuning.arena.radiusByBudget[String(budget)];
  if (radius === undefined) {
    fail(
      `resolveArena: budget ${budget} is not a legal match budget (see tuning.match.legalBudgets).`,
    );
  }
  return { center: ARENA_CENTER, radius };
};

/**
 * Build the `PhysicsConfig` the sim consumes from `tuning` + a match `budget`.
 * The Arena embedded here comes from the budget's `radiusByBudget` entry, so an
 * illegal budget throws (via `resolveArena`). F4 `sim/loop` builds the full
 * `MatchConfig` (seed + fleets + arena) on top of this.
 */
export const physicsConfigFromTuning = (
  tuning: Tuning,
  budget: number,
): PhysicsConfig => ({
  dt: tuning.match.turnDurationSeconds,
  subStepMin: tuning.match.movementSubStepMin,
  subStepMax: tuning.match.movementSubStepMax,
  restitution: tuning.collision.restitution,
  collisionDamageCoefficient: tuning.collision.damageCoefficient,
  arena: resolveArena(tuning, budget),
});

// The four chassis classes, in canonical enumeration order. Kept module-local
// so the per-class narrower below has a single source of truth for "which keys
// must be present" without importing the value from catalog (which would add a
// value-level dep this file doesn't otherwise need).
const CLASSES: readonly ChassisClass[] = [
  'fighter',
  'frigate',
  'cruiser',
  'mega-destroyer',
];

/**
 * Narrow a catalog-typed `Record<string, number>` per-class table to the four
 * known `ChassisClass` keys. A missing key is a tuning authoring error — fail
 * loud (same posture as `resolveArena` on an illegal budget), because the sim
 * layer downstream indexes these by class and a missing key would surface as a
 * silent `undefined` deep inside the beat resolver.
 */
const byClass = (
  table: Readonly<Record<string, number>>,
  label: string,
): Readonly<Record<ChassisClass, number>> => {
  const out = {} as Record<ChassisClass, number>;
  for (const c of CLASSES) {
    const v = table[c];
    if (v === undefined) {
      fail(`combatConfigFromTuning: ${label} missing class "${c}".`);
    }
    out[c] = v;
  }
  return out;
};

/**
 * Resolve the combat tuning the sim consumes. Mirrors `physicsConfigFromTuning`
 * — the sim never imports the catalog, so domain reads `tuning` and passes a
 * plain struct in. Reads ONLY existing tuning fields (no schema change is in
 * scope for the sim-combat seam session).
 *
 * The per-class tables (`debrisPerDestruction`, `aoeRadiusByClass`,
 * `aoeDamageByClass`) are narrowed from the catalog's `Record<string, number>`
 * to `Record<ChassisClass, number>` here — the sim expects the stricter type
 * and a missing class key would be a hard authoring error.
 */
export const combatConfigFromTuning = (tuning: Tuning): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: tuning.hazards.maxSimultaneousBodies,
    debrisLifetimeTurns: tuning.hazards.debrisLifetimeTurns,
    debrisPerDestruction: byClass(
      tuning.hazards.debrisPerDestruction,
      'debrisPerDestruction',
    ),
    debrisScatterImpulse: tuning.hazards.debrisScatterImpulse,
    debrisMassFractionOfHull: tuning.hazards.debrisMassFractionOfHull,
    debrisRadius: tuning.hazards.debrisRadius,
  },
  destruction: {
    aoeRadiusByClass: byClass(
      tuning.destruction.aoeRadiusByClass,
      'aoeRadiusByClass',
    ),
    aoeDamageByClass: byClass(
      tuning.destruction.aoeDamageByClass,
      'aoeDamageByClass',
    ),
  },
  missiles: {
    trackingBeats: tuning.missiles.trackingBeats,
    spentRemainsArmed: tuning.missiles.spentRemainsArmed,
    reacquireOnTargetLoss: tuning.missiles.reacquireOnTargetLoss,
  },
  shields: {
    regenTicksRegardlessOfDamage: tuning.shields.regenTicksRegardlessOfDamage,
  },
});
