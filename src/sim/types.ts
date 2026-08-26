// Sim-wide shared types (architecture §4).
//
// Intentionally minimal: this file holds only what physics needs AND what downstream
// sim modules (`sim/rules`, `sim/loop`) will inevitably need to agree on. Full
// MatchState / AttackPlan / ResolutionTrace shapes land with the modules that own
// them — putting them here now would prejudge those designs.

import type { Vec3 } from './mathx/index.js';

/**
 * Unique per-body identifier. Monotonic uint32 assigned at body creation.
 *
 * All iteration over bodies is sorted by this id (architecture §7.3 rule 1) — never
 * insertion order, never `Object.keys`, never `Set` iteration. This is the anchor that
 * makes the NFR-Correctness shuffle test pass by construction.
 */
export type BodyId = number;

interface BodyCommon {
  readonly id: BodyId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Kilograms (or arbitrary consistent unit); used in momentum exchange. Must be > 0. */
  readonly mass: number;
  /** Collision-sphere radius in world units. Must be > 0. */
  readonly radius: number;
}

/** A crewed combatant. Movement plans target ships; boundary exit destroys them (FR-26). */
export interface ShipBody extends BodyCommon {
  readonly kind: 'ship';
}

/** Inert wreckage created by ship destruction (FR-23). Boundary exit removes silently. */
export interface DebrisBody extends BodyCommon {
  readonly kind: 'debris';
}

/**
 * A tracking projectile (FR-24). Guidance is applied by `sim/rules` before physics
 * integrates; physics itself sees a plain moving sphere with a velocity vector.
 * Boundary exit removes silently.
 */
export interface MissileBody extends BodyCommon {
  readonly kind: 'missile';
}

/** Discriminated union covering everything physics knows how to move. */
export type Body = ShipBody | DebrisBody | MissileBody;

/**
 * One movement plan for one body. Emitted by a `Commander` (player or bot) and applied
 * by physics as a velocity delta at the start of a beat.
 *
 * Physics trusts the supplied delta. The caller (`domain.resolveFleet`) is responsible
 * for enforcing engine caps; putting that here would leak domain rules into the physics
 * layer.
 */
export interface MovementPlan {
  readonly bodyId: BodyId;
  readonly deltaV: Vec3;
}

/**
 * The bounded arena (design/tuning: sphere). Boundary containment is enforced per
 * sub-step in `sim/physics/boundary.ts`; ships crossing the shell are destroyed and
 * hazards are removed silently (FR-26).
 */
export interface Arena {
  readonly center: Vec3;
  readonly radius: number;
}

// ---- Sim input contract — the resolved fleet the loop consumes (SESSION-03) --
//
// `SimShip` / `SimFleet` are the "plain struct the sim consumes" seam
// (architecture §4). They are declared HERE, not in `src/domain/`, because the
// sim boundary forbids `sim → domain` — `sim/loop` (F4) must be able to hold
// a resolved fleet without importing domain. `domain.resolveFleet` produces
// these; the one-way `domain → sim types` import is allowed by the boundary.
//
// `ChassisClass` and the weapon/missile/special sub-shapes are declared FRESH
// here (not imported from `catalog/`), because sim may not import catalog.
// The unions are string-literal identical to the catalog's, so
// `domain.resolveShip` bridges them by plain assignment (no conversion, no
// cross-boundary import).
//
// Passive effects (armor-plating, thrust-booster, damage-control) are folded
// into the numeric fields by `domain.derivedStats` (S03). Active effects
// (point-defense, decoy-launcher) stay STRUCTURED in `pointDefense[]` /
// `decoys[]` for `sim/rules` (F4) to interpret per turn. F4 may extend
// `SimShip` additively (append-only) if new rule state is needed at construction
// time; existing fields never change type.

/**
 * The four ship classes (specs/database.md §2.1). Declared sim-local, structurally
 * identical to `catalog.ChassisClass` — see file header note.
 */
export type ChassisClass = 'fighter' | 'frigate' | 'cruiser' | 'mega-destroyer';

/**
 * Base weapon stats. The full hit-chance formula (range/evasion/decoy) lives in
 * `sim/rules` and is not duplicated in data or UI (Ruling H).
 */
export interface SimWeapon {
  readonly range: number;
  readonly damage: number;
  readonly shotsPerTurn: number;
  readonly accuracy: number;
}

/**
 * A launcher's per-rack stats. `bodyMass`/`bodyRadius` describe ONE missile in
 * flight (collidable); the rack's own carried mass is folded into `SimShip.mass`.
 */
export interface SimMissileRack {
  readonly ammo: number;
  readonly damage: number;
  readonly aoeRadius: number;
  readonly boostVelocity: number;
  readonly trackingTurnRate: number;
  readonly bodyMass: number;
  readonly bodyRadius: number;
}

/** Point-defense turret stats. Interception logic is a `sim/rules` concern (F4). */
export interface SimPointDefense {
  readonly interceptRange: number;
  readonly interceptChance: number;
  readonly interceptsPerTurn: number;
}

/**
 * Decoy launcher stats. A per-turn timed effect — `evasionBonus` is applied by
 * `sim/rules` during the beat a decoy is fired, NOT folded into a static
 * evasion number (see the design note in `src/domain/derivedStats.ts`).
 */
export interface SimDecoy {
  readonly charges: number;
  readonly evasionBonus: number;
  readonly durationTurns: number;
}

/**
 * The resolved, immutable combat profile of ONE build entering a match —
 * produced by `domain.resolveFleet`. `sim/loop` (F4) wraps this in the mutable
 * `MatchState`; this struct itself never mutates.
 */
export interface SimShip {
  /** Local roster id — the durable Build.id, NOT the share-token ordinal. */
  readonly buildId: string;
  readonly name: string;
  /** Keys `tuning.hazards.debrisPerDestruction` and `tuning.destruction.*ByClass`. */
  readonly chassisClass: ChassisClass;
  /** Total mass — chassis + Σ component (§2.3). Used in momentum + delta-V budget. */
  readonly mass: number;
  /** Sphere collider radius (`chassis.hullRadius`). */
  readonly radius: number;
  readonly maxHull: number;
  readonly shieldCapacity: number;
  readonly shieldRegenPerTurn: number;
  readonly deltaVPerTurn: number;
  /** Chassis base evasion. Decoy bonus is a rule, NOT folded here (see SimDecoy). */
  readonly baseEvasion: number;
  readonly hullRepairPerTurn: number;
  readonly weapons: readonly SimWeapon[];
  readonly missiles: readonly SimMissileRack[];
  readonly pointDefense: readonly SimPointDefense[];
  readonly decoys: readonly SimDecoy[];
}

/** A resolved fleet — ordered set of ships plus the roster id. */
export interface SimFleet {
  readonly fleetId: number;
  readonly ships: readonly SimShip[];
}
