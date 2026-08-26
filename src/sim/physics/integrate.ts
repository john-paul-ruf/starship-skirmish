// integrate — sub-step count and ballistic advance (architecture §7.4).
//
// One movement beat is split into N sub-steps so that a body cannot advance more than
// half its smallest radius per sub-step at maximum relative closing speed. That is the
// precondition that keeps swept CCD tight in `sweep.ts` and prevents tunneling
// (FR-19, FR-22).
//
// Plan deltaV is applied ONCE at the start of the beat via `applyPlan`. Within a beat
// each body flies ballistically at constant velocity between contacts.

import type { Body, MovementPlan } from '../types.js';
import { add, scale } from '../mathx/index.js';

/**
 * `N = clamp(ceil(maxRelSpeed · dt / (minRadius · 0.5)), min, max)` — architecture §7.4.
 *
 * Deterministic by construction: no wall-clock read, no frame rate. `min`/`max` come
 * from `catalog/tuning.json` via `PhysicsConfig`. When any denominator is non-positive
 * (a degenerate all-at-rest scene, an empty scene, a zero-radius preview body) the
 * safe fallback is `min` — the scene still gets processed.
 */
export const subStepCount = (
  maxRelSpeed: number,
  dt: number,
  minRadius: number,
  min: number,
  max: number,
): number => {
  if (!(minRadius > 0) || !(dt > 0) || !(maxRelSpeed > 0)) return min;
  const raw = Math.ceil((maxRelSpeed * dt) / (minRadius * 0.5));
  return raw < min ? min : raw > max ? max : raw;
};

/**
 * Ballistic advance for one sub-step: `pos ← pos + vel · subDt`. Velocity is not
 * touched here (there is no per-step acceleration; plan deltaV lives in `applyPlan`).
 * Returns a new `Body` — the input is not mutated (architecture §7.3 rule 3).
 */
export const integrateBody = (body: Body, subDt: number): Body => ({
  ...body,
  position: add(body.position, scale(body.velocity, subDt)),
});

/**
 * Apply a movement plan by adding its deltaV to the body's velocity. Physics trusts
 * the supplied delta — the caller (`domain.resolveFleet`) is responsible for engine
 * caps. Returns a new `Body`.
 */
export const applyPlan = (body: Body, plan: MovementPlan): Body => ({
  ...body,
  velocity: add(body.velocity, plan.deltaV),
});
