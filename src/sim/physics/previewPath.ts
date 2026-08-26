// previewPath — pure trajectory sampling that MUST share its integrator with
// `resolveMovement` (architecture §9). The renderer draws the predicted arc using
// this function; if preview and resolution ever diverge the game lies to the player,
// so they share one code path (see `integrate.ts` for the primitives both use).
//
// Preview is oblivious to other bodies — the arc that leaves the aim cursor is the
// arc the ship would fly if nothing else existed. When another ship gets in the way,
// resolveMovement's momentum step diverts the trajectory; the aim UI's job is to show
// what the pilot ordered, not to predict traffic.

import type { Vec3 } from '../mathx/index.js';
import { lengthSq } from '../mathx/index.js';
import type { Body, MovementPlan } from '../types.js';
import { applyPlan, integrateBody, subStepCount } from './integrate.js';
import { isOutsideArena } from './boundary.js';
import type { PhysicsConfig } from './config.js';

export interface PreviewPath {
  /** Position samples at every sub-step boundary, length = `subStepCount + 1`.
   *  `positions[0]` is the start (post-plan-apply); `positions[N]` is the end. */
  readonly positions: readonly Vec3[];
  /** Sub-step count used — matches what resolveMovement would pick for a lone body. */
  readonly subStepCount: number;
  /** True when the final position lies outside the arena — the aim UI can warn about
   *  arcs that would kill the ship on the boundary check. */
  readonly endsOutsideArena: boolean;
}

/**
 * Integrate `body` forward one beat with the SAME sub-step derivation and SAME
 * integrate step that `resolveMovement` uses for a lone body. Returns the sampled
 * trajectory.
 *
 * `plan === null` previews a ship that will not fire its engines this beat.
 */
export const previewPath = (
  body: Body,
  plan: MovementPlan | null,
  config: PhysicsConfig,
): PreviewPath => {
  const start = plan === null ? body : applyPlan(body, plan);

  // Sub-step derivation matches `resolveMovement` for the single-body case: both use
  // `maxRelSpeed = 2·|v|` and `minRadius = this body's radius`. That is the property
  // the "preview must not lie" test locks in.
  const speed = Math.sqrt(lengthSq(start.velocity));
  const N = subStepCount(
    2 * speed,
    config.dt,
    start.radius > 0 ? start.radius : 1,
    config.subStepMin,
    config.subStepMax,
  );
  const subDt = config.dt / N;

  const positions: Vec3[] = [start.position];
  let current = start;
  for (let k = 0; k < N; k += 1) {
    current = integrateBody(current, subDt);
    positions.push(current.position);
  }
  return {
    positions,
    subStepCount: N,
    endsOutsideArena: isOutsideArena(current.position, config.arena),
  };
};
