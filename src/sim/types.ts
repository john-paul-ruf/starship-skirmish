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
