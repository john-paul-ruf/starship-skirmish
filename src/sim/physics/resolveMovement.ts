// resolveMovement — one movement beat, deterministically (architecture §6.2, §7.3–§7.4).
//
// Pure function: given the pre-beat body snapshot and the plans emitted this beat, return
// a plain step-result. The input state is not mutated (§7.3 rule 3). Two-phase within the
// beat: read the snapshot, stage the sub-step advance, commit the new bodies at the end.
//
// This is the CP2 form: plans → sub-step loop → integrate + swept-CCD contact detection.
// Momentum exchange and boundary handling land in CP3.

import type { Body, BodyId, MovementPlan } from '../types.js';
import { lengthSq } from '../mathx/index.js';
import { scale } from '../mathx/index.js';
import { subStepCount, integrateBody, applyPlan } from './integrate.js';
import { broadphase } from './broadphase.js';
import { sweepSphereSphere } from './sweep.js';
import type { PhysicsConfig } from './config.js';

/**
 * One recorded surface contact within a beat. Ordering: `(subStep, toi, idA, idB)`
 * ascending, with `idA < idB` — the canonical resolution order (architecture §7.3
 * rule 2 + §7.4). Momentum-only fields (damage, normal, point) land in CP3.
 */
export interface StepContact {
  readonly subStep: number;
  readonly toi: number;
  readonly idA: BodyId;
  readonly idB: BodyId;
}

export interface StepResult {
  /** Bodies after the beat, sorted by id. */
  readonly finalBodies: readonly Body[];
  /** Sub-step count used this beat (state-derived — architecture §7.4). */
  readonly subStepCount: number;
  /** All contacts observed this beat, in canonical order. */
  readonly contacts: readonly StepContact[];
}

/**
 * Advance every body through one movement beat with deterministic swept CCD.
 *
 * The algorithm:
 *   1. Apply each plan's deltaV to its body's velocity (start-of-beat).
 *   2. Derive sub-step count from state (never wall-clock).
 *   3. For each sub-step:
 *      a. Broadphase → candidate pairs, sorted (idA, idB).
 *      b. Sweep each pair → collect TOI hits along the swept path (§7.4).
 *      c. Ballistically integrate every body to the end of the sub-step.
 *   4. Sort the full contact list by `(subStep, toi, idA, idB)`.
 */
export const resolveMovement = (
  bodies: readonly Body[],
  plans: readonly MovementPlan[],
  config: PhysicsConfig,
): StepResult => {
  // 1 · Apply plans. Iterate `plans` in given order into a Map — later plans for the
  //     same body overwrite earlier ones, which mirrors "last plan wins". Domain layer
  //     is expected to have already de-duplicated; this is defensive only.
  const planById = new Map<BodyId, MovementPlan>();
  for (let i = 0; i < plans.length; i += 1) planById.set(plans[i]!.bodyId, plans[i]!);
  const afterPlans = bodies.map((b) => {
    const plan = planById.get(b.id);
    return plan === undefined ? b : applyPlan(b, plan);
  });

  // 2 · Sub-step count. Bound relative speed by 2·max|v| — cheap, deterministic upper
  //     bound (|vA − vB| ≤ |vA| + |vB| ≤ 2·max|v|). Track maxRadius too so broadphase's
  //     cell size can also account for per-sub-step displacement (see broadphase.ts).
  let maxSpeedSq = 0;
  let maxRadius = 0;
  let minRadius = Infinity;
  for (let i = 0; i < afterPlans.length; i += 1) {
    const b = afterPlans[i]!;
    const s = lengthSq(b.velocity);
    if (s > maxSpeedSq) maxSpeedSq = s;
    if (b.radius > maxRadius) maxRadius = b.radius;
    if (b.radius < minRadius) minRadius = b.radius;
  }
  const maxSpeed = Math.sqrt(maxSpeedSq);
  const N = subStepCount(
    2 * maxSpeed,
    config.dt,
    minRadius === Infinity ? 1 : minRadius,
    config.subStepMin,
    config.subStepMax,
  );
  const subDt = config.dt / N;
  // See broadphase.ts: cellSize must dominate rA+rB+|dA|+|dB| for the ±1 scan to be
  // sound at clamped N (high closing speed → per-sub-step disp exceeds a body's radius).
  const cellSize = 2 * (maxRadius + maxSpeed * subDt);

  // 3 · Sub-step loop. `current` is always sorted by id (iteration order §7.3 rule 1).
  let current: Body[] = afterPlans.slice().sort((a, b) => a.id - b.id);
  const contacts: StepContact[] = [];

  for (let k = 0; k < N; k += 1) {
    const pairs = broadphase(current, cellSize);
    // Index start-of-sub-step bodies by id for O(1) pair lookup.
    const startById = new Map<BodyId, Body>();
    for (let i = 0; i < current.length; i += 1) startById.set(current[i]!.id, current[i]!);

    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i]!;
      const A = startById.get(pair.a)!;
      const B = startById.get(pair.b)!;
      const dA = scale(A.velocity, subDt);
      const dB = scale(B.velocity, subDt);
      const hit = sweepSphereSphere(A.position, dA, A.radius, B.position, dB, B.radius);
      if (hit !== null) {
        contacts.push({ subStep: k, toi: hit.toi, idA: pair.a, idB: pair.b });
      }
    }
    // Ballistic advance — CP2 has no momentum exchange yet, so velocities stay fixed.
    current = current.map((b) => integrateBody(b, subDt));
  }

  // 4 · Canonical contact order.
  contacts.sort((x, y) => {
    if (x.subStep !== y.subStep) return x.subStep - y.subStep;
    if (x.toi !== y.toi) return x.toi - y.toi;
    if (x.idA !== y.idA) return x.idA - y.idA;
    return x.idB - y.idB;
  });

  return { finalBodies: current, subStepCount: N, contacts };
};
