// Sim-wide shared types (architecture §4).
//
// Intentionally minimal: this file holds only what physics needs AND what downstream
// sim modules (`sim/rules`, `sim/loop`, `sim/trace`) inevitably need to agree on.
// `MatchState` and `ResolutionTrace` proper land with the modules that own them
// (`sim/loop`, `sim/trace`) — putting those shapes here would prejudge those designs.
//
// The *combat vocabulary* — `AttackPlan`, `CalledShotTarget`, `CombatLogEntry`,
// `DestructionEvent`, `HitChanceBreakdown`, `CombatConfig` — lives HERE for the same
// reason `MovementPlan` and `Body` do: `sim/rules` (M09) produces the atomic events,
// `sim/trace` (M11) records them, `sim/loop` (M10) composes them, and future
// `render`/`ai` read them. The registry has rules and trace as siblings (no cross-
// edge), so the shared leaf is the one place they can meet without a cycle. This
// intentionally supersedes the earlier tentative note that "AttackPlan lands with the
// module that owns it" — sibling modules mean no owner exists but this file.

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
 * One waypoint burn within a beat (finite-thrust movement — feature
 * `finite-thrust-movement`, SESSION-01). `deltaV` is the total impulse the segment
 * delivers, expressed in world-space (the UI/AI converts bearing/pitch → Vec3 via
 * `mathx.dirFromBearingPitch`, so physics never sees an angle — the sim/physics
 * transcendental ban stays intact, D-PHYSICS-VEC3-ONLY).
 *
 * The burn fires at `PhysicsConfig.maxAccel` for `|deltaV|/maxAccel` sim-seconds
 * from the start of the segment's time-slice (`dt / segments.length` seconds each),
 * then coasts. That is what makes the flown path CURVE while thrusting — the
 * shipping analogue of the Gate-1 prototype's `thrustAt`.
 *
 * Per-segment `deltaV` is capped upstream by the producer's per-ship Δv budget and
 * again here inside `thrustSchedule` at `maxAccel · segDuration` so a segment can
 * never deliver more impulse than the engine physically can in its slice.
 */
export interface WaypointBurn {
  readonly deltaV: Vec3;
}

/**
 * One movement plan for one body. Emitted by a `Commander` (player or bot) and applied
 * by physics at the start of a beat.
 *
 * TWO SHAPES, ADDITIVELY (D-ADDITIVE-PLAN, load-bearing for the whole feature):
 *   • `segments` ABSENT → impulsive fallback. The full `deltaV` is added to velocity
 *     at sub-step 0 and the rest of the beat flies ballistically — byte-for-byte
 *     identical to the pre-SESSION-01 resolver. This is what keeps missiles
 *     (`sim/rules/missiles.ts` emits impulsive plans only, D-MISSILE-IMPULSIVE) and
 *     every hash-locked determinism fixture green through S01–S05.
 *   • `segments` PRESENT → finite-thrust. The impulse is distributed across the
 *     segments' time-slices at bounded `maxAccel`; `deltaV` is IGNORED (segments
 *     override it). Callers that emit segments should still set `deltaV = ZERO` for
 *     shape-consistency, but the resolver reads only the schedule.
 *
 * Physics trusts the supplied delta. The caller (`domain.resolveFleet`) is
 * responsible for enforcing engine caps; putting that here would leak domain rules
 * into the physics layer.
 */
export interface MovementPlan {
  readonly bodyId: BodyId;
  /** Impulsive fallback — applied at start of beat when `segments` is absent. */
  readonly deltaV: Vec3;
  /** Finite-thrust schedule. When present, `deltaV` is ignored (segments override). */
  readonly segments?: readonly WaypointBurn[];
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
 * Behavior-free identity carried alongside the numeric sim structs.
 *
 * The tactical UI, combat log, and post-match readouts (M14) need to render the
 * chassis and per-slot component names authored in the catalog. Those strings
 * cannot ride on `SimShip.name` alone (that is the player-chosen build name, not
 * the chassis) and the sim boundary forbids `sim → catalog`, so the identity has
 * to cross the seam as part of the resolved sim profile.
 *
 * This shape is intentionally minimal and READ-ONLY:
 *   • `id` is the catalog's permanent id (e.g. `cru-hammerhead`, `wpn-pulse-array`).
 *   • `name` is the catalog's authored display string.
 *
 * Callers must treat these fields as DISPLAY-ONLY. They are forbidden from
 * appearing in any rule / physics / AI-score / RNG-key / digest / trace-digest
 * input — the only supported use is human-readable labelling in `render/` / `ui/`
 * (architecture §4). The absence of a coupling here is the enforcement.
 */
export interface SimDisplayIdentity {
  readonly id: string;
  readonly name: string;
}

/**
 * Base weapon stats. The full hit-chance formula (range/evasion/decoy) lives in
 * `sim/rules` and is not duplicated in data or UI (Ruling H).
 *
 * `display` is OPTIONAL at the type boundary for legacy-fixture compatibility —
 * hand-authored deterministic unit fixtures may construct a `SimWeapon` literal
 * without identity, and the sim rulebook must remain byte-for-byte identical
 * when it is absent. Production resolution (`domain.resolveShip`) ALWAYS
 * populates it; UI consumers may rely on that guarantee while still keeping a
 * textual fallback for malformed / legacy inputs.
 */
export interface SimWeapon {
  readonly range: number;
  readonly damage: number;
  readonly shotsPerTurn: number;
  readonly accuracy: number;
  /** Display-only. See `SimDisplayIdentity`. Absent on legacy fixtures. */
  readonly display?: SimDisplayIdentity;
}

/**
 * A launcher's per-rack stats. `bodyMass`/`bodyRadius` describe ONE missile in
 * flight (collidable); the rack's own carried mass is folded into `SimShip.mass`.
 *
 * See `SimWeapon` for why `display` is optional at the type boundary.
 */
export interface SimMissileRack {
  readonly ammo: number;
  readonly damage: number;
  readonly aoeRadius: number;
  readonly boostVelocity: number;
  readonly trackingTurnRate: number;
  readonly bodyMass: number;
  readonly bodyRadius: number;
  /** Display-only. See `SimDisplayIdentity`. Absent on legacy fixtures. */
  readonly display?: SimDisplayIdentity;
}

/**
 * Point-defense turret stats. Interception logic is a `sim/rules` concern (F4).
 *
 * See `SimWeapon` for why `display` is optional at the type boundary.
 */
export interface SimPointDefense {
  readonly interceptRange: number;
  readonly interceptChance: number;
  readonly interceptsPerTurn: number;
  /** Display-only. See `SimDisplayIdentity`. Absent on legacy fixtures. */
  readonly display?: SimDisplayIdentity;
}

/**
 * Decoy launcher stats. A per-turn timed effect — `evasionBonus` is applied by
 * `sim/rules` during the beat a decoy is fired, NOT folded into a static
 * evasion number (see the design note in `src/domain/derivedStats.ts`).
 *
 * See `SimWeapon` for why `display` is optional at the type boundary.
 */
export interface SimDecoy {
  readonly charges: number;
  readonly evasionBonus: number;
  readonly durationTurns: number;
  /** Display-only. See `SimDisplayIdentity`. Absent on legacy fixtures. */
  readonly display?: SimDisplayIdentity;
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
  /**
   * Display-only chassis identity (catalog id + authored name). Optional at the
   * type boundary for legacy-fixture compatibility (hand-built unit fixtures
   * that don't need chassis labels); ALWAYS populated by `domain.resolveShip`.
   * See `SimDisplayIdentity` for the display-only contract.
   */
  readonly chassis?: SimDisplayIdentity;
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

// ---- Attack planning (symmetric with MovementPlan) --------------------------
// AttackPlan lives HERE (not sim/rules) for the same reason MovementPlan does:
// rules consume it, the loop's Commander interface returns it, and future ai/ui
// produce/read it — the shared leaf avoids a rules↔loop↔ai cycle.

/**
 * Which subsystem a called shot targets. Legal only while target shields == 0
 * (FR-25). Weapons/missiles/specials are addressed by their index into the
 * matching `SimShip` array; shield-generator and engine are aggregate
 * subsystems (see S02 design note in STATE.md).
 */
export type CalledShotTarget =
  | { readonly kind: 'weapon'; readonly index: number }
  | { readonly kind: 'missile'; readonly index: number }
  | { readonly kind: 'special'; readonly index: number }
  | { readonly kind: 'shield-generator' }
  | { readonly kind: 'engine' };

/**
 * One fire assignment emitted by a Commander for the attack beat (FR-20).
 * A weapon assignment sets `weaponIndex`; a missile launch sets `missileIndex`.
 * `calledShot` is honoured only when the target's shields are already at zero.
 */
export interface AttackPlan {
  readonly shooterId: BodyId;
  readonly targetId: BodyId;
  readonly weaponIndex?: number;
  readonly missileIndex?: number;
  readonly calledShot?: CalledShotTarget;
}

// ---- Combat-log + destruction events (recorded by trace, produced by rules) --

export type CombatLogResult =
  | 'hit'
  | 'miss'
  | 'crit'
  | 'kill'
  | 'intercept'
  | 'boundary-exit';

export type DamageSourceKind =
  | 'weapon'
  | 'missile'
  | 'collision'
  | 'aoe'
  | 'boundary';

/**
 * One resolution event (FR-21 "every shot: shooter, target, roll, result,
 * damage"). `turn`/`beat` locate it; `roll`/`chance` record the seeded decision;
 * the `shield*`/`hull*` pairs are the target's pool BEFORE→AFTER so the UI /
 * post-match can render deltas.
 */
export interface CombatLogEntry {
  readonly turn: number;
  readonly beat: 'movement' | 'attack';
  readonly source: DamageSourceKind;
  readonly sourceId: BodyId;
  readonly targetId: BodyId;
  readonly result: CombatLogResult;
  /** 0..1 — the published hit chance for this shot (0 for non-rolled sources). */
  readonly chance: number;
  /** 0..1 — the seeded draw (0 for non-rolled sources). */
  readonly roll: number;
  /** Damage applied to the target this event. */
  readonly damage: number;
  readonly shieldBefore: number;
  readonly shieldAfter: number;
  readonly hullBefore: number;
  readonly hullAfter: number;
  readonly calledShot?: CalledShotTarget;
}

/**
 * A ship destruction, emitted after damage application (attack beat) or on an
 * in-arena boundary/collision death (movement beat). Drives AoE + debris
 * (FR-23/FR-26).
 */
export interface DestructionEvent {
  readonly bodyId: BodyId;
  readonly chassisClass: ChassisClass;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly cause: DamageSourceKind;
  /** True when the death position is inside the arena — only then does it detonate (FR-26). */
  readonly detonates: boolean;
}

// ---- Hit-chance published breakdown (Ruling H, architecture §13.3) -----------
// The FORMULA lives in sim/rules; the UI must read THIS breakdown, never recompute.

export interface HitChanceBreakdown {
  /** `weapon.accuracy`. */
  readonly base: number;
  /** 0..1 falloff from range vs `weapon.range`. */
  readonly rangeFactor: number;
  /** 0..1 penalty from target speed. */
  readonly velocityFactor: number;
  /** 0..1 penalty from target evasion (+ any active decoy bonus). */
  readonly evasionFactor: number;
  /** Clamped product actually rolled against. */
  readonly final: number;
}

// ---- Resolved combat tuning the sim consumes (domain produces it) -----------
// Mirrors PhysicsConfig: the sim never imports the catalog, so domain reads
// `tuning.json` and hands this plain struct to createMatch (F4 S04). Every
// value here already exists in tuning.json — no catalog / tuning change is in
// scope for the seam session (S01).

export interface CombatConfig {
  readonly hazards: {
    readonly maxSimultaneousBodies: number;
    readonly debrisLifetimeTurns: number;
    readonly debrisPerDestruction: Readonly<Record<ChassisClass, number>>;
    readonly debrisScatterImpulse: number;
    readonly debrisMassFractionOfHull: number;
    readonly debrisRadius: number;
  };
  readonly destruction: {
    readonly aoeRadiusByClass: Readonly<Record<ChassisClass, number>>;
    readonly aoeDamageByClass: Readonly<Record<ChassisClass, number>>;
    /**
     * When true, a ship killed in the ATTACK beat contributes its class-scaled AoE
     * + debris to the NEXT movement beat (FR-21 "destruction effects enter the
     * battlespace for the next movement beat"). Absent/false ⇒ attack-beat kills
     * produce no cascade (the pre-F6 loop behavior the frozen goldens encode).
     */
    readonly cascadeToNextMovement?: boolean;
  };
  readonly missiles: {
    readonly trackingBeats: number;
    readonly spentRemainsArmed: boolean;
    readonly reacquireOnTargetLoss: boolean;
    /**
     * When true, a launched missile spawns offset ahead of its launcher by
     * (launcherRadius + missileRadius + ε) along the firing bearing, so it cannot
     * detonate on its own launcher on the following movement beat. Absent/false ⇒
     * missile spawns at the launcher's exact position (pre-F6 behavior).
     */
    readonly launchClearsLauncher?: boolean;
  };
  readonly shields: {
    readonly regenTicksRegardlessOfDamage: boolean;
  };
}
