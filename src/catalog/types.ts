// Static, read-only catalog types (specs/database.md §2, §2.6 / architecture §4).
//
// Every id in every module resolves through the `Catalog` interface below. The
// catalog is Store 1 (trusted, CI-validated, read-only forever); chassis and
// components share ONE ordinal space so `byOrdinal(n)` is unambiguous (§2.5).

// The five slot types (§2.1). Closed set — the union is the fitting constraint.
export type SlotType = 'weapon' | 'shield' | 'missile' | 'engine' | 'special';

// The four ship classes (§2.1). Layouts are FROZEN and published per class.
export type ChassisClass = 'fighter' | 'frigate' | 'cruiser' | 'mega-destroyer';

export interface ClassDef {
  readonly id: ChassisClass;
  readonly name: string;
  /** Frozen positional layout (§2.1). May only grow at the tail, never reorder / shorten / retype. */
  readonly slots: readonly SlotType[];
  readonly addedInCatalogVersion: number;
}

export interface ChassisDef {
  /** `^[a-z]{3}-[a-z0-9-]+$`, permanent (FR-1). */
  readonly id: string;
  /** Unique across chassis + components; permanent (§2.5). */
  readonly ordinal: number;
  readonly name: string;
  readonly classId: ChassisClass;
  readonly pointCost: number;
  readonly hullPoints: number;
  /** Base mass; component masses add (FR-6). */
  readonly mass: number;
  /** Sphere collider radius. */
  readonly hullRadius: number;
  /** `0 ≤ x < 1`; feeds the Ruling H hit formula. */
  readonly baseEvasion: number;
  readonly addedInCatalogVersion: number;
}

interface ComponentCommon {
  /** `^(wpn|shd|mis|eng|spc)-[a-z0-9-]+$`, permanent. */
  readonly id: string;
  /** Unique across chassis + components; permanent (§2.5). */
  readonly ordinal: number;
  readonly name: string;
  readonly pointCost: number;
  /** Mass this component adds to the ship. */
  readonly mass: number;
  readonly addedInCatalogVersion: number;
}

export interface WeaponDef extends ComponentCommon {
  readonly slotType: 'weapon';
  readonly stats: {
    readonly range: number;
    readonly damage: number;
    readonly shotsPerTurn: number;
    readonly accuracy: number;
  };
}

export interface ShieldDef extends ComponentCommon {
  readonly slotType: 'shield';
  readonly stats: {
    readonly capacity: number;
    readonly regenPerTurn: number;
  };
}

export interface MissileDef extends ComponentCommon {
  readonly slotType: 'missile';
  readonly stats: {
    readonly ammo: number;
    readonly damage: number;
    readonly aoeRadius: number;
    readonly boostVelocity: number;
    readonly trackingTurnRate: number;
    /** Mass of one missile in flight (the rack's `mass` is on ComponentCommon). */
    readonly bodyMass: number;
    readonly bodyRadius: number;
  };
}

export interface EngineDef extends ComponentCommon {
  readonly slotType: 'engine';
  readonly stats: {
    /** Momentum per turn. Per-ship delta-V = (Σ thrustImpulse + Σ booster) / totalMass (§2.3). */
    readonly thrustImpulse: number;
  };
}

/**
 * Closed discriminant (§2.3). Each value maps to a rule implemented in `sim/rules`.
 * Adding a new value is the single catalog change that requires code.
 */
export type SpecialEffect =
  | { readonly effect: 'armor-plating'; readonly bonusHull: number }
  | {
      readonly effect: 'decoy-launcher';
      readonly charges: number;
      readonly evasionBonus: number;
      readonly durationTurns: number;
    }
  | { readonly effect: 'thrust-booster'; readonly thrustImpulseBonus: number }
  | {
      readonly effect: 'point-defense';
      readonly interceptRange: number;
      readonly interceptChance: number;
      readonly interceptsPerTurn: number;
    }
  | { readonly effect: 'damage-control'; readonly hullRepairPerTurn: number };

export interface SpecialDef extends ComponentCommon {
  readonly slotType: 'special';
  readonly stats: SpecialEffect;
}

export type ComponentDef = WeaponDef | ShieldDef | MissileDef | EngineDef | SpecialDef;

/** `catalog/tuning.json` shape (§2.4). Pure numbers, harness-tunable. */
export interface Tuning {
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly arena: {
    readonly shape: string;
    /** Keyed by budget-as-string (JSON limitation); C9 asserts keys ≡ `match.legalBudgets`. */
    readonly radiusByBudget: Readonly<Record<string, number>>;
    readonly startVelocity: number;
    readonly fleetStartInsetFraction: number;
    readonly minFleetSeparationFraction: number;
  };
  readonly match: {
    readonly legalBudgets: readonly number[];
    readonly minFleets: number;
    readonly maxFleets: number;
    readonly minBots: number;
    readonly maxBots: number;
    readonly fleetHullCap: number;
    readonly fieldShipCap: number;
    readonly turnDurationSeconds: number;
    readonly movementSubStepMin: number;
    readonly movementSubStepMax: number;
  };
  readonly hazards: {
    readonly maxSimultaneousBodies: number;
    readonly debrisLifetimeTurns: number;
    readonly debrisPerDestruction: Readonly<Record<string, number>>;
    readonly debrisScatterImpulse: number;
    readonly debrisMassFractionOfHull: number;
    readonly debrisRadius: number;
  };
  readonly destruction: {
    readonly aoeRadiusByClass: Readonly<Record<string, number>>;
    readonly aoeDamageByClass: Readonly<Record<string, number>>;
    /** Attack-beat kill contributes AoE + debris to the NEXT movement beat (FR-21). */
    readonly cascadeToNextMovement: boolean;
  };
  readonly collision: {
    readonly damageCoefficient: number;
    readonly restitution: number;
  };
  readonly missiles: {
    readonly trackingBeats: number;
    readonly spentRemainsArmed: boolean;
    readonly reacquireOnTargetLoss: boolean;
    /** Missile spawns offset ahead of its launcher so it cannot detonate on itself. */
    readonly launchClearsLauncher: boolean;
  };
  readonly shields: {
    readonly regenTicksRegardlessOfDamage: boolean;
  };
}

/**
 * `catalog/lock/catalog-vN.json` shape (§2.5). Append-only frozen snapshot of the
 * `{id → permanent ordinal}` contract. Share tokens encode ordinals, so an edit
 * silently reinterprets every token ever generated.
 */
export interface CatalogLock {
  readonly catalogVersion: number;
  readonly lockedAt: string;
  readonly reservedOrdinals: Readonly<Record<string, string>>;
  readonly nextOrdinal: number;
  readonly ordinals: Readonly<Record<string, number>>;
  /** Historical layout length per class; C8 checks `currentLayout.length >= lockCount`. */
  readonly classSlotCounts: Readonly<Record<string, number>>;
}

/**
 * The single interface every downstream module resolves ids through
 * (architecture §4 + specs/database.md §4 / §8).
 */
export interface Catalog {
  readonly catalogVersion: number;
  readonly tuning: Tuning;
  /** Q1 — resolve a chassis by permanent id. */
  chassis(id: string): ChassisDef | undefined;
  /** Q1 — resolve a component by permanent id. */
  component(id: string): ComponentDef | undefined;
  /** Q4 — encode a build to a token (permanent id → ordinal). */
  ordinalOf(id: string): number | undefined;
  /** Q5 — decode a token (ordinal → chassis or component; shared space). */
  byOrdinal(n: number): ChassisDef | ComponentDef | undefined;
  /** Resolve a class by id. */
  classOf(classId: ChassisClass): ClassDef | undefined;
  /** Q3 — the frozen slot layout for a class, or undefined if unknown. */
  slotLayout(classId: ChassisClass): readonly SlotType[] | undefined;
  /** Q2 — components fittable in a slot of this type (ordinal-sorted). */
  componentsForSlot(type: SlotType): readonly ComponentDef[];
  /** Q3 — chassis of a class (ordinal-sorted). */
  chassisOfClass(classId: ChassisClass): readonly ChassisDef[];
  /** All chassis, ordinal-sorted. Stable output. */
  allChassis(): readonly ChassisDef[];
  /** All components, ordinal-sorted. Stable output. */
  allComponents(): readonly ComponentDef[];
}
