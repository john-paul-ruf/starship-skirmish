// resolveMovement — one movement beat, deterministically (architecture §6.2, §7.3–§7.4).
//
// Pure function: given the pre-beat body snapshot and the plans emitted this beat,
// return a plain step-result. The input `bodies` array is not mutated (§7.3 rule 3).
// Two-phase within the beat: read the snapshot, stage the sub-step advance, commit the
// new bodies at the end.
//
// Per-sub-step contact resolution is SEQUENTIAL in the canonical `(toi, idA, idB)`
// order: each body is involved in at most one contact per sub-step (the first, by TOI).
// Later contacts for a body already-handled this sub-step are skipped — they will be
// re-detected next sub-step against the updated velocity. This keeps the resolver
// tractable and deterministic; the simulation is chunky, not exact, but the same chunky
// answer on every engine (which is the invariant that matters, per §7.5).

import type { Vec3 } from '../mathx/index.js';
import { add, lengthSq, scale } from '../mathx/index.js';
import type { Body, BodyId, MovementPlan } from '../types.js';
import { applyPlan, integrateBody, subStepCount } from './integrate.js';
import { broadphase } from './broadphase.js';
import { sweepSphereSphere } from './sweep.js';
import { resolveCollision } from './momentum.js';
import { classifyExit, isOutsideArena, type BoundaryExit } from './boundary.js';
import type { PhysicsConfig } from './config.js';

/**
 * One recorded surface contact within a beat. Ordering across a run:
 * `(subStep, toi, idA, idB)` ascending, with `idA < idB` — the canonical resolution
 * order (architecture §7.3 rule 2 + §7.4). Only contacts that actually exchanged
 * impulse are recorded; pure grazes are dropped as noise.
 */
export interface StepContact {
  readonly subStep: number;
  readonly toi: number;
  readonly idA: BodyId;
  readonly idB: BodyId;
  /** Unit contact normal, pointing from B toward A. */
  readonly normal: Vec3;
  /** World-space contact point, on the line of centers. */
  readonly point: Vec3;
  /** Pre-collision closing speed along the normal (≥ 0). */
  readonly relSpeedNormal: number;
  /** Collision-damage magnitude — `k · reducedMass · relSpeedNormal²`. Applied to
   *  BOTH bodies by the rules layer (a later feature). */
  readonly damage: number;
}

export interface StepResult {
  /** Bodies after the beat (survivors only), sorted by id. */
  readonly finalBodies: readonly Body[];
  /** Sub-step count used this beat (state-derived — architecture §7.4). */
  readonly subStepCount: number;
  /** Per-sub-step snapshots for playback. Length = `subStepCount + 1`:
   *  `keyframes[0]` is the pre-integration state (post-plan-apply, sorted by id);
   *  `keyframes[k>0]` is the state after sub-step `k − 1` (survivors, sorted). */
  readonly keyframes: readonly (readonly Body[])[];
  /** All contacts that exchanged impulse this beat, in canonical order. */
  readonly contacts: readonly StepContact[];
  /** Bodies that crossed the arena boundary this beat, in the sub-step order they
   *  were detected. Ships → destroyed events; hazards → silent removals (FR-26). */
  readonly exits: readonly BoundaryExit[];
}

const sortById = (bodies: readonly Body[]): Body[] =>
  bodies.slice().sort((a, b) => a.id - b.id);

/**
 * Advance every body through one movement beat with deterministic swept CCD.
 *
 * 1. Apply each plan's deltaV to its body's velocity (start-of-beat).
 * 2. Derive `subStepCount` and `cellSize` from state (never wall clock).
 * 3. For each sub-step:
 *    a. Broadphase → candidate pairs, sorted (idA, idB).
 *    b. Sweep each pair, collect `(toi, idA, idB)` hits.
 *    c. Sort hits canonically and apply momentum SEQUENTIALLY, one per body per
 *       sub-step. Advance participating bodies through the TOI + post-impulse slice.
 *    d. Ballistically advance every non-participant to the sub-step end.
 *    e. Boundary check on post-sub-step positions: exits are removed from the live
 *       set and recorded.
 *    f. Snapshot the survivors into `keyframes`.
 */
export const resolveMovement = (
  bodies: readonly Body[],
  plans: readonly MovementPlan[],
  config: PhysicsConfig,
): StepResult => {
  // 1 · Apply plans. Iterate `plans` in given order into a Map; a later plan for the
  //     same body overwrites earlier ones (last-write-wins). Domain layer is expected
  //     to have already de-duplicated; this is defensive only.
  const planById = new Map<BodyId, MovementPlan>();
  for (let i = 0; i < plans.length; i += 1) planById.set(plans[i]!.bodyId, plans[i]!);
  const afterPlans = bodies.map((b) => {
    const plan = planById.get(b.id);
    return plan === undefined ? b : applyPlan(b, plan);
  });

  // 2 · Sub-step count + cell size (both state-derived).
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
  // See broadphase.ts: cellSize must dominate `rA + rB + |dA| + |dB|` for the ±1
  // neighborhood scan to be sound at clamped N (high closing speed → per-sub-step
  // displacement exceeds a body's radius).
  const cellSize = 2 * (maxRadius + maxSpeed * subDt);

  // 3 · Sub-step loop. `current` is always sorted by id (§7.3 rule 1).
  let current: Body[] = sortById(afterPlans);
  const keyframes: Body[][] = [current];
  const contacts: StepContact[] = [];
  const exits: BoundaryExit[] = [];

  for (let k = 0; k < N; k += 1) {
    const pairs = broadphase(current, cellSize);
    const startById = new Map<BodyId, Body>();
    for (let i = 0; i < current.length; i += 1) startById.set(current[i]!.id, current[i]!);

    // 3a/3b · Collect candidate contacts from swept CCD.
    interface Candidate {
      readonly toi: number;
      readonly idA: BodyId;
      readonly idB: BodyId;
    }
    const candidates: Candidate[] = [];
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i]!;
      const A = startById.get(pair.a)!;
      const B = startById.get(pair.b)!;
      const dA = scale(A.velocity, subDt);
      const dB = scale(B.velocity, subDt);
      const hit = sweepSphereSphere(A.position, dA, A.radius, B.position, dB, B.radius);
      if (hit !== null) candidates.push({ toi: hit.toi, idA: pair.a, idB: pair.b });
    }
    // Canonical resolution order within the sub-step (§7.4).
    candidates.sort((x, y) => {
      if (x.toi !== y.toi) return x.toi - y.toi;
      if (x.idA !== y.idA) return x.idA - y.idA;
      return x.idB - y.idB;
    });

    // 3c · Resolve momentum sequentially. One contact per body per sub-step: later
    //      contacts touching an already-handled body are dropped (re-detected next
    //      sub-step against the post-impulse velocity).
    const handled = new Set<BodyId>();
    const postById = new Map<BodyId, Body>();

    const advanceHit = (
      body: Body,
      toi: number,
      newVel: Vec3,
      posAtToi: Vec3,
    ): Body => ({
      ...body,
      // pos_end = pos(at TOI) + newVel · subDt · (1 − toi)
      position: add(posAtToi, scale(newVel, subDt * (1 - toi))),
      velocity: newVel,
    });

    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i]!;
      if (handled.has(c.idA) || handled.has(c.idB)) continue;
      const A = startById.get(c.idA)!;
      const B = startById.get(c.idB)!;
      const posAtToiA = add(A.position, scale(A.velocity, subDt * c.toi));
      const posAtToiB = add(B.position, scale(B.velocity, subDt * c.toi));
      const r = resolveCollision(
        posAtToiA,
        A.velocity,
        A.mass,
        A.radius,
        posAtToiB,
        B.velocity,
        B.mass,
        B.radius,
        config.restitution,
        config.collisionDamageCoefficient,
      );
      if (!r.applied) continue; // grazing or separating — not a real event
      postById.set(c.idA, advanceHit(A, c.toi, r.newVelA, posAtToiA));
      postById.set(c.idB, advanceHit(B, c.toi, r.newVelB, posAtToiB));
      handled.add(c.idA);
      handled.add(c.idB);
      contacts.push({
        subStep: k,
        toi: c.toi,
        idA: c.idA,
        idB: c.idB,
        normal: r.normal,
        point: r.point,
        relSpeedNormal: r.relSpeedNormal,
        damage: r.damage,
      });
    }

    // 3d · Advance non-participants ballistically. Emit in id order for determinism.
    const advanced: Body[] = current.map((body) => {
      const post = postById.get(body.id);
      return post !== undefined ? post : integrateBody(body, subDt);
    });

    // 3e · Boundary check on post-sub-step positions.
    const survivors: Body[] = [];
    for (let i = 0; i < advanced.length; i += 1) {
      const b = advanced[i]!;
      if (isOutsideArena(b.position, config.arena)) {
        exits.push({ bodyId: b.id, kind: classifyExit(b), subStep: k });
      } else {
        survivors.push(b);
      }
    }
    current = survivors;
    keyframes.push(current);
  }

  return { finalBodies: current, subStepCount: N, keyframes, contacts, exits };
};
