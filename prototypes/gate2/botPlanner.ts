// prototypes/gate2/botPlanner.ts — the disposable Gate 2 heuristic (FR-32, §12).
//
// The point of this file is to answer the project's highest-risk unknown: can a bot
// plot a blind, simultaneous 3D thrust arc without flying itself out of bounds
// through unforced error (FR-29)? The exit criterion is measured by `harnessRun.ts`:
// zero unforced boundary deaths across 100 seeded matches.
//
// Checkpoint 1 shape (this file):
//   1. Pick a threat target (nearest enemy ship).
//   2. Compute a baseline arc that prefers a standoff range — close if far, ease off
//      if too close.
//   3. Clamp the arc to a per-ship delta-V budget.
//   No boundary logic yet — CP2 adds a `previewPath`-based hard constraint. This
//   split matches the session's checkpoint boundaries; keeping CP1 pure keeps CP2's
//   diff about the constraint alone.
//
// Notes:
//   - This is deliberately not the final `HeuristicCommander` (M12). This is a
//     throwaway heuristic proving one bar: boundary avoidance can be a hard constraint
//     without pathological behaviour. F5 promotes the surviving heuristics into
//     tiered decision policies against the `Commander` interface.
//   - Pure function of (view, ownedIds, physics, config). No wall-clock, no
//     Math.random. That is not a determinism requirement here (prototypes are outside
//     the sim ban-list), but reproducibility of the gate test needs it — a flaky bot
//     turns the FR-29 gate into a flaky gate.
//   - Uses the real `sim/mathx` primitives (vec3, no transcendentals). Any candidate
//     search that needs a bearing/pitch would go through `mathx.trig` — none does
//     here; we work in Cartesian throughout.

import type { Vec3 } from '../../src/sim/mathx/index.js';
import {
  ZERO,
  clampLength,
  distance,
  distanceSq,
  neg,
  normalize,
  scale,
  sub,
} from '../../src/sim/mathx/index.js';
import type { Body, BodyId, MovementPlan } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import type { BlindView } from './blindView.js';

/** Per-planner tunables. Kept as a struct so `harnessRun` can vary them if a seed
 *  suite needs a harder / easier bot without touching the planner core. */
export interface PlannerConfig {
  /** Maximum |deltaV| the planner may command in one beat (per ship). */
  readonly deltaVBudget: number;
  /** Preferred distance to the nearest threat. Closer → back off; farther → close in. */
  readonly preferredStandoff: number;
  /** "Ease-off" scale when we're inside preferredStandoff (0..1). Braking away from a
   *  target too aggressively puts us at the boundary — a soft back-off is the right shape. */
  readonly retreatScale: number;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  deltaVBudget: 80,
  preferredStandoff: 350,
  retreatScale: 0.5,
};

// ---------------------------------------------------------------------------
// Target selection — nearest enemy ship. Deterministic by BodyId tiebreak.
// ---------------------------------------------------------------------------

const isShip = (b: Body): boolean => b.kind === 'ship';

const pickNearestThreat = (
  self: Body,
  view: BlindView,
  ownedIds: ReadonlySet<BodyId>,
): Body | null => {
  let best: Body | null = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < view.bodies.length; i += 1) {
    const b = view.bodies[i]!;
    if (!isShip(b)) continue;
    if (ownedIds.has(b.id)) continue;
    const dSq = distanceSq(self.position, b.position);
    // Deterministic tiebreak: smaller BodyId wins if distanceSq is bit-equal.
    if (dSq < bestDistSq || (dSq === bestDistSq && best !== null && b.id < best.id)) {
      best = b;
      bestDistSq = dSq;
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// Baseline arc: threat-seeking with a soft standoff preference.
// ---------------------------------------------------------------------------

const baselineArc = (self: Body, target: Body | null, config: PlannerConfig): Vec3 => {
  if (target === null) {
    // No enemies visible — coast. CP2's boundary constraint handles any drift toward
    // the shell when it lands.
    return ZERO;
  }
  const toTarget = sub(target.position, self.position);
  const range = distance(self.position, target.position);
  if (range === 0) return ZERO;
  const dir = normalize(toTarget);
  if (range > config.preferredStandoff) {
    // Close in at full budget.
    return clampLength(scale(dir, config.deltaVBudget), config.deltaVBudget);
  }
  // Inside standoff — ease away, but softly (retreatScale < 1). A hard reverse would
  // just launch us at the boundary from the other side; the point of standoff is to
  // hover a fight, not to run from it.
  return clampLength(
    scale(neg(dir), config.deltaVBudget * config.retreatScale),
    config.deltaVBudget,
  );
};

/**
 * Plan one ship. Returns the baseline arc clamped to budget — no boundary logic yet
 * (that's CP2). `physics` is unused at CP1 but part of the signature so CP2 can wire
 * `previewPath` in without touching call sites.
 */
export const planShip = (
  self: Body,
  view: BlindView,
  ownedIds: ReadonlySet<BodyId>,
  _physics: PhysicsConfig,
  config: PlannerConfig,
): MovementPlan => {
  const target = pickNearestThreat(self, view, ownedIds);
  const baseline = baselineArc(self, target, config);
  return { bodyId: self.id, deltaV: clampLength(baseline, config.deltaVBudget) };
};

/**
 * Plan every owned ship in the view. Returns one `MovementPlan` per owned live ship,
 * sorted by BodyId — the same canonical order `resolveMovement` iterates
 * (architecture §7.3 rule 1).
 */
export const planFleet = (
  view: BlindView,
  ownedIds: ReadonlySet<BodyId>,
  physics: PhysicsConfig,
  config: PlannerConfig,
): readonly MovementPlan[] => {
  const owned: Body[] = [];
  for (let i = 0; i < view.bodies.length; i += 1) {
    const b = view.bodies[i]!;
    if (isShip(b) && ownedIds.has(b.id)) owned.push(b);
  }
  owned.sort((a, b) => a.id - b.id);
  const plans: MovementPlan[] = [];
  for (let i = 0; i < owned.length; i += 1) {
    plans.push(planShip(owned[i]!, view, ownedIds, physics, config));
  }
  return plans;
};
