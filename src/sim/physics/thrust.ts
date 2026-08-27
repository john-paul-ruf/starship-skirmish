// thrust — per-sub-step Δv schedule for finite-thrust movement plans
// (feature `finite-thrust-movement`, SESSION-01; specs/architecture.md §9).
//
// The RESOLVER (`resolveMovement.ts`) and the PREVIEW (`previewPath.ts`) share
// this one function to derive the per-sub-step velocity increments applied at
// the start of each sub-step's ballistic advance. One code path means the arc
// the aim UI draws IS the arc the ship will fly — the "preview must not lie"
// invariant (§9) holds through the curved segment schedule (D-SHARED-SCHEDULE).
//
// TWO PATHS, ONE FUNCTION (D-ADDITIVE-PLAN, load-bearing for the whole feature):
//   • `segments` ABSENT → `[plan.deltaV, ZERO, ZERO, …]` (length N). All impulse
//     lands at sub-step 0, exactly reproducing the pre-SESSION-01
//     `applyPlan`-at-start-of-beat. This is the byte-identity path every
//     hash-locked determinism fixture and every impulsive missile plan
//     (D-MISSILE-IMPULSIVE) rides on unchanged through S01–S05.
//   • `segments` PRESENT → distribute each segment's impulse across its
//     `dt / segments.length`-second time-slice. A segment fires at `maxAccel`
//     for `|deltaV|/maxAccel` seconds from its slice start (then coasts), so
//     paths CURVE while thrusting — the shipping analogue of the Gate-1
//     prototype's `thrustAt` (`prototypes/gate1/main.ts:107-177`). Per-segment
//     Δv is capped at `maxAccel · sliceSeconds` (the physical ceiling).
//
// Determinism: arithmetic only (+ − × ÷ √) — direction is a caller-supplied
// Vec3, never re-computed from an angle (`sim/physics` transcendental ban stays
// intact, D-PHYSICS-VEC3-ONLY). Iteration is per-sub-step × per-segment index —
// no Set, no insertion order, no Object.keys.

import type { Vec3 } from '../mathx/index.js';
import { ZERO, add, lengthSq, scale } from '../mathx/index.js';
import type { MovementPlan } from '../types.js';

/**
 * Per-sub-step velocity delta the plan delivers over its beat. Length is exactly
 * `N`. Element `k` is the Δv added to the body's velocity at the START of
 * sub-step `k`, immediately before that sub-step's ballistic advance — mirroring
 * where the pre-SESSION-01 `applyPlan` slotted its single impulse.
 *
 * @param plan     movement plan (impulsive when `segments` absent, finite-thrust
 *                 when present — `deltaV` is IGNORED on the finite-thrust branch,
 *                 documented on `MovementPlan.segments`)
 * @param N        sub-step count for the beat (`>= 1` in normal use; `0`
 *                 returns an empty array — the degenerate scene short-circuit)
 * @param dt       beat duration in sim-seconds
 * @param maxAccel engine acceleration ceiling (world-units / sim-second²). REQUIRED
 *                 whenever `plan.segments` is present. When missing / non-positive /
 *                 non-finite the schedule falls back to depositing the segments'
 *                 summed impulse at sub-step 0 — the impulsive rendering an
 *                 infinite-thrust engine would produce. Deterministic; keeps a
 *                 caller that forgot to set `PhysicsConfig.maxAccel` from silently
 *                 coasting. Ignored entirely on the impulsive branch.
 */
export const thrustSchedule = (
  plan: MovementPlan,
  N: number,
  dt: number,
  maxAccel: number | undefined,
): Vec3[] => {
  if (N <= 0) return [];
  const schedule: Vec3[] = new Array<Vec3>(N).fill(ZERO);

  const segments = plan.segments;

  // Impulsive branch — the byte-identity fallback. `segments === undefined` is
  // the sentinel that says "old-shape plan, do it the old way". An empty
  // `segments` array is treated the same for safety: a finite-thrust producer
  // that emits zero segments still gets a deterministic result (its `deltaV`
  // as one impulse at k=0), not a silent coast.
  if (segments === undefined || segments.length === 0) {
    schedule[0] = plan.deltaV;
    return schedule;
  }

  // Finite-thrust branch — `maxAccel` guard. When unusable, fold the segments
  // into an impulsive sum at sub-step 0 (what an infinite-thrust engine would
  // do). This branch keeps determinism byte-stable when a caller misconfigures
  // the physics; it is NOT the intended production path.
  const useFinite =
    typeof maxAccel === 'number' && Number.isFinite(maxAccel) && maxAccel > 0;
  if (!useFinite) {
    let sum: Vec3 = ZERO;
    for (let k = 0; k < segments.length; k += 1) {
      sum = add(sum, segments[k]!.deltaV);
    }
    schedule[0] = sum;
    return schedule;
  }

  // Finite-thrust branch — distribute each segment across its time-slice.
  //
  // Per-segment pre-computation. `segDur` is the time-slice each segment owns
  // (a beat with 4 segments has segDur = dt/4). `cap = maxAccel · segDur` is
  // the largest |Δv| a segment can physically deliver: fire flat-out at
  // `maxAccel` for the whole slice → `maxAccel · segDur`. A caller that asks
  // for more gets the cap; the extra impulse simply isn't producible in the
  // slice.
  //
  // For each segment we record:
  //   - `deltaV`     — the requested world-space impulse (direction × magnitude)
  //   - `requestedMag` — |deltaV| (one sqrt per segment, cached out of the loop)
  //   - `effectiveMag` — min(requestedMag, cap) — the impulse actually delivered
  //   - `segStart`   — seconds from beat start where this segment's slice begins
  //   - `burnEnd`    — seconds where the burn stops firing (`segStart + tBurn`,
  //                    with `tBurn = effectiveMag / maxAccel ≤ segDur`)
  //
  // See the per-sub-step derivation below for how these compose into a Δv.
  const subDt = dt / N;
  const segDur = dt / segments.length;
  const cap = maxAccel * segDur;
  interface SegPlan {
    readonly deltaV: Vec3;
    readonly requestedMag: number;
    readonly effectiveMag: number;
    readonly segStart: number;
    readonly burnEnd: number;
  }
  const segPlans: SegPlan[] = new Array<SegPlan>(segments.length);
  for (let k = 0; k < segments.length; k += 1) {
    const seg = segments[k]!;
    const requestedMag = Math.sqrt(lengthSq(seg.deltaV));
    const effectiveMag = requestedMag > cap ? cap : requestedMag;
    const tBurn = effectiveMag > 0 ? effectiveMag / maxAccel : 0;
    const segStart = k * segDur;
    segPlans[k] = {
      deltaV: seg.deltaV,
      requestedMag,
      effectiveMag,
      segStart,
      burnEnd: segStart + tBurn,
    };
  }

  // Per-sub-step accumulation.
  //
  // Sub-step j owns wall-clock interval [subStart, subEnd] = [j·subDt, (j+1)·subDt].
  // Segment k's burn is active on [segStart_k, burnEnd_k]. Their overlap is
  //   overlap = max(0, min(subEnd, burnEnd_k) − max(subStart, segStart_k)).
  //
  // The Δv delivered to sub-step j by segment k's active burn window is:
  //   contribution = maxAccel · dir_k · overlap
  // where dir_k = deltaV_k / requestedMag_k. Substituting:
  //   contribution = (maxAccel · overlap / requestedMag_k) · deltaV_k
  // The `(effectiveMag / requestedMag)` cap scaling cancels because tBurn = effectiveMag / maxAccel:
  //   the schedule already stops firing at burnEnd (which uses effectiveMag),
  //   so the overlap CAN'T extend past the physically-deliverable window.
  // Order-independent: sub-step accumulation loops by k in schedule order — the
  // sum is real-arithmetic addition of at most `segments.length` terms, which is
  // small and deterministic (no Set-iteration, no Object.keys).
  for (let j = 0; j < N; j += 1) {
    const subStart = j * subDt;
    const subEnd = subStart + subDt;
    let dv: Vec3 = ZERO;
    for (let k = 0; k < segPlans.length; k += 1) {
      const sp = segPlans[k]!;
      if (sp.effectiveMag <= 0) continue;
      const lo = subStart > sp.segStart ? subStart : sp.segStart;
      const hi = subEnd < sp.burnEnd ? subEnd : sp.burnEnd;
      const overlap = hi > lo ? hi - lo : 0;
      if (overlap <= 0) continue;
      const factor = (overlap * maxAccel) / sp.requestedMag;
      dv = add(dv, scale(sp.deltaV, factor));
    }
    schedule[j] = dv;
  }
  return schedule;
};

/**
 * Maximum |velocity|² reached ACROSS the schedule when applied to `startVelocity`,
 * taken AFTER each sub-step's Δv is applied. Feeds `subStepCount` in
 * `resolveMovement` so N is sized to bound displacement even when a mid-beat
 * burn accelerates the body past its start-of-beat speed.
 *
 * Impulsive equivalence: a plan whose schedule is `[deltaV, 0, …]` returns
 * `|startVelocity + deltaV|²` — the exact value the pre-SESSION-01 resolver used
 * as its `maxSpeedSq` (post-plan velocity). This preserves N derivation on the
 * impulsive path, which is what keeps the byte-identity invariant intact.
 *
 * Design note: `|startVelocity|²` alone (before any Δv is applied) is NOT
 * considered. In the impulsive model the pre-plan velocity has no time inside
 * the beat — the plan takes effect at t=0 — so the ballistic advance runs at
 * post-plan speed. Matching that here is what makes N identical byte-for-byte on
 * the impulsive path.
 */
export const peakSpeedSq = (
  startVelocity: Vec3,
  schedule: readonly Vec3[],
): number => {
  let v: Vec3 = startVelocity;
  let peak = 0;
  for (let k = 0; k < schedule.length; k += 1) {
    v = add(v, schedule[k]!);
    const s = lengthSq(v);
    if (s > peak) peak = s;
  }
  return peak;
};
