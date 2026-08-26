// PhysicsConfig — the seam between `catalog/tuning.json` and the physics module.
//
// Physics does NOT import the catalog loader (that seam lives in `domain.resolveFleet`).
// Instead the caller reads `catalog/tuning.json` and passes a plain struct in. This
// keeps physics testable with any config and blocks a stray catalog import from crossing
// the sim boundary (architecture §5, session SESSION-03).

import type { Arena } from '../types.js';

export interface PhysicsConfig {
  /** Duration of one movement beat in sim-seconds. Wall clock never enters. */
  readonly dt: number;
  /** Minimum sub-steps per beat (tuning: `match.movementSubStepMin`, default 4). */
  readonly subStepMin: number;
  /** Maximum sub-steps per beat (tuning: `match.movementSubStepMax`, default 64). Caps worst-case work. */
  readonly subStepMax: number;
  /** Coefficient of restitution for ship-ship collisions (tuning: `collision.restitution`, default 0.15). */
  readonly restitution: number;
  /** `k` in `damage = k · reducedMass · relSpeedNormal²` (tuning: `collision.damageCoefficient`, default 0.0012). */
  readonly collisionDamageCoefficient: number;
  /** Arena shape and extent (tuning: `arena.radiusByBudget[<budget>]`). */
  readonly arena: Arena;
}
