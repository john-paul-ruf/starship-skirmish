// movementPlanner — tier-parameterized promotion of the Gate-2 heuristic (M12).
//
// Gate 2's PASS verdict (prototypes/gate2/FINDINGS.md §0) rested on three
// moving parts (§1a–§1c): a **cruise-velocity target** (not per-beat impulse),
// a **`previewPath` boundary veto** over a small candidate ladder, and
// **nearest-threat target selection**. This file promotes all three, then
// exposes them behind `TIER_CONFIG` knobs (S01) so rookie/veteran/ace differ
// ONLY by decision quality (FR-30, Custom Rule 4):
//
//   • rookie  — nearest target · baseline-veto ladder (`[baseline, ZERO]`) · horizon 1
//   • veteran — threat-weighted target · full-7 ladder · horizon 2 (coast-beat veto)
//   • ace     — threat-map target · full-7 with wall-distance cruise cap · horizon 3
//
// The planner takes `PhysicsConfig` as an EXPLICIT parameter (D-PHYSICS-INJECT):
// the `Commander` interface (M10, `commander.ts`) hands over only a
// `BlindMatchView` — no arena physics config — but Gate-2's boundary-safety
// requires `previewPath(config)`. S04's `HeuristicCommander` closes over the
// injected config; here every top-level function takes it as a parameter so
// this module stays pure and testable.
//
// Determinism scope (`src/ai/**` ban-list):
//   * No `Date`, no `performance`, no `Math.random`, no transcendentals.
//   * All draws / positions arithmetic-only (mathx primitives).
//   * Iteration in `BodyId` ASC order; ties break on ascending `BodyId`.
//
// Boundary (D-AI-IMPORTS): `ai → sim/physics` is default-allowed by the
// `boundaries/element-types` rule (only `sim → non-sim` is forbidden). This
// file imports `previewPath` + `isOutsideArena` — the two functions Gate 2's
// verdict rides on — and nothing else from physics.

import type { Vec3 } from '../sim/mathx/index.js';
import {
  ZERO,
  add,
  clampLength,
  distance,
  lengthSq,
  neg,
  normalize,
  scale,
  sub,
} from '../sim/mathx/index.js';
import type { Body, BodyId, MovementPlan } from '../sim/types.js';
import type { BlindMatchView, BlindShipView } from '../sim/loop/blindView.js';
import type { PhysicsConfig } from '../sim/physics/index.js';
import { isOutsideArena, previewPath } from '../sim/physics/index.js';
import type { BotTier, TierConfig } from './tiers.js';
import { TIER_CONFIG } from './tiers.js';
import { nearestEnemyBodyId, rankThreats } from './threatMap.js';

// ---------------------------------------------------------------------------
// Safety factor for ace's wall-distance cruise cap (FINDINGS §2). The Gate-2
// findings suggest `cruiseSpeed_capped = min(baseCruise, wallDistance/dt/safety)`.
// A safety factor of 2 keeps the cap conservative — the ship targets a cruise
// speed low enough that a full beat's brake can halt it well inside the shell,
// which is the invariant the ace tier is trying to hold with margin.
// PROMOTION SEAM — a legitimate future `tuning.json` field once combat tuning
// migrates; deferred out of the catalog schema today (Custom Rule 4).
// ---------------------------------------------------------------------------
const ACE_WALL_CAP_SAFETY_FACTOR = 2;

// ---------------------------------------------------------------------------
// Target selection — the `TargetingPolicy` union routed to a `BodyId`.
// ---------------------------------------------------------------------------

/**
 * Choose an enemy `BodyId` for `self` per `tier.targeting`. Returns `null` when
 * no live enemy exists. Deterministic BodyId tiebreak throughout.
 *
 *   * `nearest`          — nearest live enemy (rookie; Gate-2 §1c).
 *   * `threat-weighted`  — top of `rankThreats` (veteran; nearest biased
 *                          against high-HP by the survivability term).
 *   * `threat-map`       — top of `rankThreats` (ace; same call site — the
 *                          scoring is identical; the tier's *lookahead* + wall
 *                          cap are what actually change the decision).
 */
export const pickTargetBodyId = (
  view: BlindMatchView,
  self: Body,
  tier: BotTier,
): BodyId | null => {
  const t = TIER_CONFIG[tier];
  if (t.targeting === 'nearest') {
    return nearestEnemyBodyId(view, view.selfFleetId, self.position);
  }
  const ranked = rankThreats(view, view.selfFleetId, self.position);
  return ranked.length > 0 ? ranked[0]!.bodyId : null;
};

// ---------------------------------------------------------------------------
// Baseline arc — the cruise-velocity target that made Gate 2 pass (§1a).
// ---------------------------------------------------------------------------

/**
 * The baseline `deltaV` for one ship this beat: aim for a *cruise velocity*
 * toward `target`, not a per-beat impulse. The returned deltaV is clamped to
 * `budget` — the caller enforces the per-ship engine cap.
 *
 * `budget` is the ship's own `deltaVPerTurn` (not a fixed 80 — the real
 * per-ship value from `SimShip.deltaVPerTurn`). `cruiseSpeed` is
 * `budget × TIER_CONFIG[tier].cruiseSpeedFraction` (S01's followUp: DO NOT
 * scale further — the fractions 0.5/0.66/0.85 are already the final cruise
 * fraction).
 *
 * If `target === null` (no enemies visible) the ship coasts — `ZERO` deltaV.
 * The boundary-safety pass below handles drift toward the shell.
 */
export const baselineArc = (
  self: Body,
  target: Body | null,
  budget: number,
  cruiseSpeed: number,
): Vec3 => {
  if (target === null) return ZERO;
  const range = distance(self.position, target.position);
  if (range === 0) return ZERO;
  const dir = normalize(sub(target.position, self.position));
  const desiredVelocity = scale(dir, cruiseSpeed);
  const dv = sub(desiredVelocity, self.velocity);
  return clampLength(dv, budget);
};

// ---------------------------------------------------------------------------
// Candidate ladder — the search order the FR-29 boundary constraint votes
// over. Which ladder is used is a decision-quality knob, not a stat
// (`TierConfig.candidateLadder`, S01).
// ---------------------------------------------------------------------------

/**
 * Build the candidate `deltaV` set for `self` this beat, ordered by preference
 * (rank 0 wins ties among safe candidates).
 *
 *   * `baseline-veto` (rookie) — `[baseline, ZERO]`. If the baseline preview
 *     exits, coast — no recovery ladder. Intentional flavour: rookie is bad
 *     at recovering from a bad setup (FINDINGS §2 rookie).
 *   * `full-7` (veteran) — the full Gate-2 ladder, unchanged (§1b).
 *   * `full-7-wall-capped` (ace) — full-7 built against a wall-capped baseline
 *     (§2 ace): `cruiseSpeed_capped = min(baseCruise, wallDistance/dt/safety)`.
 *     The cap is applied by the caller when producing the baseline; this
 *     function returns the same 7-candidate shape either way.
 */
export const buildCandidates = (
  self: Body,
  baseline: Vec3,
  view: BlindMatchView,
  budget: number,
  tier: BotTier,
): readonly Vec3[] => {
  const ladder = TIER_CONFIG[tier].candidateLadder;
  if (ladder === 'baseline-veto') {
    return [baseline, ZERO];
  }
  // full-7 and full-7-wall-capped share this shape; the wall cap is applied
  // upstream to `baseline`, not here.
  const centerDelta = sub(view.arena.center, self.position);
  const centerDir = lengthSq(centerDelta) > 0 ? normalize(centerDelta) : ZERO;
  const brakeDir =
    lengthSq(self.velocity) > 0 ? normalize(neg(self.velocity)) : ZERO;
  const toCenter = clampLength(scale(centerDir, budget), budget);
  const brake = clampLength(scale(brakeDir, budget), budget);
  const brakeAndCenter = clampLength(
    add(scale(brakeDir, budget * 0.5), scale(centerDir, budget * 0.5)),
    budget,
  );
  // Preference order (Gate-2 §1b):
  //   0 baseline — the plan we WANT to fly.
  //   1 baseline × 0.5 — same shape, gentler.
  //   2 baseline × 0.25 — barely commit.
  //   3 zero — coast; let momentum ride out.
  //   4 brake + center (½ each) — kill inertia and turn inward.
  //   5 brake — kill inertia.
  //   6 toward center at full budget — hardest push back into the arena.
  return [
    baseline,
    scale(baseline, 0.5),
    scale(baseline, 0.25),
    ZERO,
    brakeAndCenter,
    brake,
    toCenter,
  ];
};

// ---------------------------------------------------------------------------
// Preview evaluation — the FR-29 hard constraint. `previewPath` shares its
// integrator with `resolveMovement` (architecture §9), so an arc that stays
// inside preview stays inside resolve absent collisions.
// ---------------------------------------------------------------------------

interface Evaluated {
  readonly deltaV: Vec3;
  readonly rank: number;
  readonly insideCount: number;
  readonly totalCount: number;
  readonly isSafe: boolean;
  readonly endPosition: Vec3;
  readonly endVelocity: Vec3;
}

const countInsidePositions = (
  positions: readonly Vec3[],
  arena: BlindMatchView['arena'],
): number => {
  let count = 0;
  for (let i = 0; i < positions.length; i += 1) {
    if (!isOutsideArena(positions[i]!, arena)) count += 1;
  }
  return count;
};

const evaluateCandidate = (
  self: Body,
  deltaV: Vec3,
  view: BlindMatchView,
  physics: PhysicsConfig,
  rank: number,
): Evaluated => {
  // D-BOT-SAME-MODEL / FR-29 (finite-thrust-movement SESSION-03): the veto MUST
  // preview the SAME finite-thrust plan the bot will emit — a straight impulsive
  // arc and a curved finite-thrust arc can exit differently, so feeding the
  // impulsive shape here would let the ladder greenlight candidates the ship
  // then flies out of. Single-segment plan matches `planShipMovement`'s emission.
  // With `physics.maxAccel` unset (impulsive fallback in `thrustSchedule`) the
  // preview stays byte-identical to the pre-SESSION-01 impulsive arc — the
  // curve only appears when a caller supplies `maxAccel` (D-ADDITIVE-PLAN).
  const plan: MovementPlan = {
    bodyId: self.id,
    deltaV,
    segments: [{ deltaV }],
  };
  const preview = previewPath(self, plan, physics);
  const inside = countInsidePositions(preview.positions, view.arena);
  // Post-plan velocity is the ship's pre-plan velocity + deltaV: on the shared
  // schedule, a single segment's total delivered impulse is `deltaV` (per-
  // segment cap `maxAccel · dt` applies only if the caller under-provisions
  // `maxAccel` — the domain/tuning propagation makes that the production
  // no-op). The finite-thrust preview reflects this end-state already.
  const endVelocity = add(self.velocity, deltaV);
  const endPosition = preview.positions[preview.positions.length - 1]!;
  return {
    deltaV,
    rank,
    insideCount: inside,
    totalCount: preview.positions.length,
    isSafe: inside === preview.positions.length,
    endPosition,
    endVelocity,
  };
};

// ---------------------------------------------------------------------------
// N-beat lookahead — veteran (horizon 2) + ace (horizon 3). FINDINGS §2:
// "for each candidate, also run `previewPath` on a *coast beat* immediately
// after, and reject candidates whose end-of-next-beat position would exit."
// Extended here to N further beats — a candidate is "N-beat safe" iff N
// consecutive coast previews starting from its end-state ALL stay inside.
// ---------------------------------------------------------------------------

const passesLookahead = (
  cand: Evaluated,
  self: Body,
  view: BlindMatchView,
  physics: PhysicsConfig,
  horizon: 1 | 2 | 3,
): boolean => {
  if (horizon <= 1) return true;
  let pos = cand.endPosition;
  let vel = cand.endVelocity;
  // horizon-1 coast beats — each beat = one previewPath call with null plan
  // (coast). Reject if any preview exits.
  for (let step = 1; step < horizon; step += 1) {
    const coastBody: Body = {
      ...self,
      position: pos,
      velocity: vel,
    };
    const preview = previewPath(coastBody, null, physics);
    if (
      countInsidePositions(preview.positions, view.arena) !==
      preview.positions.length
    ) {
      return false;
    }
    pos = preview.positions[preview.positions.length - 1]!;
    // Coast: velocity unchanged (no thrust applied). Physics only applies plan
    // deltaV at start-of-beat; a null plan leaves velocity untouched.
    vel = coastBody.velocity;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Per-ship movement planning — Gate-2 `planShip:223` promoted.
// ---------------------------------------------------------------------------

/**
 * Effective cruise speed for `self` this beat given the tier's fraction and
 * (for ace) the wall-distance cap (FINDINGS §2). Exported so the boundary-
 * safety regression can compute the same target speed.
 */
export const cruiseSpeedFor = (
  self: Body,
  view: BlindMatchView,
  tierCfg: TierConfig,
  budget: number,
  physicsDt: number,
): number => {
  const baseCruise = budget * tierCfg.cruiseSpeedFraction;
  if (tierCfg.candidateLadder !== 'full-7-wall-capped') return baseCruise;
  // Distance from self's current position to the arena shell along ANY radial —
  // equivalently `arena.radius - distance(self, arena.center)`. Non-negative
  // in a well-formed setup; if the ship is already outside, clamp to zero and
  // let the boundary-safety pass pick a recovery candidate.
  const distToCenter = distance(self.position, view.arena.center);
  const wallDistance = view.arena.radius - distToCenter;
  if (wallDistance <= 0) return 0;
  const capped = wallDistance / physicsDt / ACE_WALL_CAP_SAFETY_FACTOR;
  return baseCruise < capped ? baseCruise : capped;
};

/**
 * Plan one ship's movement for one beat (Gate-2 `planShip:223` promoted):
 *
 *   1. Pick a target per `tier.targeting`.
 *   2. Compute the baseline arc (cruise-velocity target, §1a) at
 *      `cruiseSpeed = budget × tier.cruiseSpeedFraction` (ace: also wall-capped).
 *   3. Build the candidate ladder per `tier.candidateLadder`.
 *   4. Evaluate each with `previewPath`; require `isSafe` AND
 *      `passesLookahead(horizon)` for the veteran/ace 2-/3-beat coast veto.
 *   5. Pick the lowest-rank safe candidate. If none is safe (forced situation),
 *      pick the fallback with the most in-bounds sub-steps (ties → rank ASC).
 *
 * D-BOT-SAME-MODEL (finite-thrust-movement SESSION-03 / FR-17 / Custom Rule 4):
 * the emitted plan carries a **single-segment** finite-thrust schedule so bots
 * fly the SAME model as the player — a tier is decision quality only, never a
 * stat/movement-model advantage. `segments: [{ deltaV: chosen.deltaV }]` is one
 * burn delivering the chosen Δv over the beat; `deltaV` remains populated
 * (documentation/fallback — the resolver ignores it when `segments` is present,
 * D-ADDITIVE-PLAN). Multi-waypoint bot tactics are an explicit non-goal.
 */
export const planShipMovement = (
  self: Body,
  view: BlindMatchView,
  tier: BotTier,
  physicsConfig: PhysicsConfig,
  budget: number,
): MovementPlan => {
  const tierCfg = TIER_CONFIG[tier];
  const targetId = pickTargetBodyId(view, self, tier);
  const target = targetId === null ? null : findBody(view, targetId);
  const cruise = cruiseSpeedFor(self, view, tierCfg, budget, physicsConfig.dt);
  const baseline = baselineArc(self, target, budget, cruise);
  const candidates = buildCandidates(self, baseline, view, budget, tier);

  let bestSafe: Evaluated | null = null;
  let bestFallback: Evaluated | null = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const evaluated = evaluateCandidate(
      self,
      candidates[i]!,
      view,
      physicsConfig,
      i,
    );
    if (evaluated.isSafe && passesLookahead(evaluated, self, view, physicsConfig, tierCfg.planningHorizon)) {
      if (bestSafe === null || evaluated.rank < bestSafe.rank) bestSafe = evaluated;
    } else if (
      bestFallback === null ||
      evaluated.insideCount > bestFallback.insideCount ||
      (evaluated.insideCount === bestFallback.insideCount &&
        evaluated.rank < bestFallback.rank)
    ) {
      bestFallback = evaluated;
    }
  }
  const chosen = bestSafe ?? bestFallback!;
  return {
    bodyId: self.id,
    deltaV: chosen.deltaV,
    segments: [{ deltaV: chosen.deltaV }],
  };
};

// ---------------------------------------------------------------------------
// Fleet planning — Gate-2 `planFleet:275` promoted.
// ---------------------------------------------------------------------------

/**
 * Plan every owned live ship in `view`. Owned = `view.ships[].fleetId ===
 * view.selfFleetId`; live = `hull > 0`. Returns one `MovementPlan` per owned
 * live ship, sorted by ascending `BodyId` — the canonical order
 * `resolveMovement` iterates (architecture §7.3 rule 1).
 *
 * No `ownedIds: Set` parameter — derived from `view.selfFleetId` +
 * `view.ships[].fleetId`. Position/velocity/radius come from `view.bodies`
 * (join on `bodyId`); `view.ships[i].ship.deltaVPerTurn` is the per-ship
 * engine budget.
 */
export const planFleetMovement = (
  view: BlindMatchView,
  tier: BotTier,
  physicsConfig: PhysicsConfig,
): readonly MovementPlan[] => {
  const owned: { readonly ship: BlindShipView; readonly body: Body }[] = [];
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.fleetId !== view.selfFleetId) continue;
    if (s.hull <= 0) continue;
    const b = findBody(view, s.bodyId);
    if (b === null) continue;
    owned.push({ ship: s, body: b });
  }
  // `view.bodies` is already BodyId-sorted (blindView.ts). `view.ships` is
  // BodyId-sorted too. Both filters preserve that order, so a re-sort is a
  // no-op — kept explicit so the invariant is visible in code.
  owned.sort((a, b) => a.body.id - b.body.id);
  const plans: MovementPlan[] = [];
  for (let i = 0; i < owned.length; i += 1) {
    const { ship, body } = owned[i]!;
    plans.push(
      planShipMovement(body, view, tier, physicsConfig, ship.ship.deltaVPerTurn),
    );
  }
  return plans;
};

// ---------------------------------------------------------------------------
// Internal — kinematics lookup by BodyId (small linear scan, ≤ ~60 bodies).
// ---------------------------------------------------------------------------

const findBody = (view: BlindMatchView, bodyId: BodyId): Body | null => {
  for (let i = 0; i < view.bodies.length; i += 1) {
    const b = view.bodies[i]!;
    if (b.id === bodyId) return b;
  }
  return null;
};
