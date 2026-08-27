// previewPath — pure trajectory sampling that MUST share its integrator with
// `resolveMovement` (architecture §9). The renderer draws the predicted arc using
// this function; if preview and resolution ever diverge the game lies to the player,
// so they share one code path (see `integrate.ts` for the primitives both use).
//
// Preview is oblivious to other bodies — the arc that leaves the aim cursor is the
// arc the ship would fly if nothing else existed. When another ship gets in the way,
// resolveMovement's momentum step diverts the trajectory; the aim UI's job is to show
// what the pilot ordered, not to predict traffic.
//
// SESSION-01 adds finite-thrust support (D-SHARED-SCHEDULE): both `previewPath` and
// `resolveMovement` build their per-sub-step Δv sequence through the SAME
// `thrustSchedule` function. A curved preview arc is drawn from exactly the numbers
// the resolver would fly through — the "preview must not lie" invariant (§9) holds
// through the finite-thrust path, not just the impulsive one. For the impulsive
// branch (segments absent), the schedule is `[deltaV, ZERO, …]` and every downstream
// snapshot (positions, subStepCount, endsOutsideArena) is byte-identical to the
// pre-SESSION-01 preview (D-ADDITIVE-PLAN).

import type { Vec3 } from '../mathx/index.js';
import { lengthSq, lerp } from '../mathx/index.js';
import type { Body, MovementPlan } from '../types.js';
import { applyThrust, integrateBody, subStepCount } from './integrate.js';
import { isOutsideArena } from './boundary.js';
import { peakSpeedSq, thrustSchedule } from './thrust.js';
import type { PhysicsConfig } from './config.js';

export interface PreviewPath {
  /** Position samples at every sub-step boundary, length = `subStepCount + 1`.
   *  `positions[0]` is the start (post-schedule[0]-apply — for an impulsive plan
   *  this equals `applyPlan(body, plan)`); `positions[N]` is the end. */
  readonly positions: readonly Vec3[];
  /** Sub-step count used — matches what resolveMovement would pick for a lone body. */
  readonly subStepCount: number;
  /** True when the final position lies outside the arena — the aim UI can warn about
   *  arcs that would kill the ship on the boundary check. */
  readonly endsOutsideArena: boolean;
  /**
   * World positions at each waypoint SEGMENT BOUNDARY of a finite-thrust plan —
   * length `plan.segments.length + 1` (start + end of every segment). Fed to the
   * UI ruler / waypoint selector so per-waypoint marks land on the TRUE curved
   * arc, not on a straight polyline the UI could compute on its own (the point
   * of D-SHARED-SCHEDULE — one preview, one truth).
   *
   * Empty when `plan` is null or `plan.segments` is absent/empty — the caller
   * uses `positions` directly for per-sub-step marks (the pre-SESSION-01 shape).
   */
  readonly markPositions: readonly Vec3[];
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
  // 1 · Peak |v|² for N derivation. Matches `resolveMovement`'s single-body path:
  //     - no plan → |body.velocity|²
  //     - plan   → peakSpeedSq over a schedule sampled at segment boundaries
  //                (peakScheduleN = 1 for impulsive, segments.length otherwise),
  //     which for impulsive equals |body.velocity + plan.deltaV|² = |v_post|².
  const peakSq =
    plan === null
      ? lengthSq(body.velocity)
      : peakSpeedSq(
          body.velocity,
          thrustSchedule(
            plan,
            plan.segments === undefined || plan.segments.length === 0
              ? 1
              : plan.segments.length,
            config.dt,
            config.maxAccel,
          ),
        );
  const speed = Math.sqrt(peakSq);
  const N = subStepCount(
    2 * speed,
    config.dt,
    body.radius > 0 ? body.radius : 1,
    config.subStepMin,
    config.subStepMax,
  );
  const subDt = config.dt / N;

  // 2 · Build the finite-thrust schedule at the chosen N (or an empty coast for a
  //     null plan). Impulsive plans get `[deltaV, ZERO, …]` — schedule[0] applied
  //     below reproduces the pre-SESSION-01 `applyPlan`-at-start snapshot exactly.
  const schedule: readonly Vec3[] =
    plan === null ? [] : thrustSchedule(plan, N, config.dt, config.maxAccel);

  // 3 · Sub-step integration, mirroring `resolveMovement`'s lone-body path so both
  //     produce byte-identical positions on the same input (the D-SHARED-SCHEDULE
  //     property the "preview must not lie" test locks in).
  const dv0 = schedule[0];
  let current = dv0 === undefined ? body : applyThrust(body, dv0);
  const positions: Vec3[] = [current.position];
  for (let k = 0; k < N; k += 1) {
    if (k > 0) {
      const dv = schedule[k];
      if (dv !== undefined && !(dv.x === 0 && dv.y === 0 && dv.z === 0)) {
        current = applyThrust(current, dv);
      }
    }
    current = integrateBody(current, subDt);
    positions.push(current.position);
  }

  // 4 · Segment-boundary marks (finite-thrust only). Position is linear in time
  //     within a sub-step (velocity is constant during ballistic advance), so a
  //     mark at `t = k · segDur` is a straight lerp between the enclosing sub-step
  //     endpoints `positions[j], positions[j+1]`. This never adds an integration
  //     path — the interpolation is over positions the resolver already produced.
  //     Empty when no plan or the plan has no segments (impulsive uses `positions`).
  let markPositions: readonly Vec3[];
  if (plan === null || plan.segments === undefined || plan.segments.length === 0) {
    markPositions = [];
  } else {
    const segments = plan.segments;
    const segDur = config.dt / segments.length;
    const marks: Vec3[] = new Array<Vec3>(segments.length + 1);
    for (let m = 0; m <= segments.length; m += 1) {
      const tMark = m * segDur;
      // Clamp the enclosing sub-step index to [0, N-1] so t = dt lands on the
      // last sub-step's [start, end] rather than falling off the array end.
      const jRaw = Math.floor(tMark / subDt);
      const j = jRaw >= N ? N - 1 : jRaw;
      const t0 = j * subDt;
      const frac = subDt > 0 ? (tMark - t0) / subDt : 0;
      // positions[j] and positions[j+1] both exist because `positions.length = N+1`.
      marks[m] = lerp(positions[j]!, positions[j + 1]!, frac);
    }
    markPositions = marks;
  }

  return {
    positions,
    subStepCount: N,
    endsOutsideArena: isOutsideArena(current.position, config.arena),
    markPositions,
  };
};
