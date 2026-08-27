// attackPlanner — deterministic per-turn attack assignment (M12; FR-17, FR-20).
//
// Consumed by the HeuristicCommander (this session). Pure function of a frozen
// `BlindMatchView` (M10 blind-commit contract — FR-17): for every owned live
// ship the planner picks ONE target per `TIER_CONFIG.targeting` and emits one
// `AttackPlan` per alive weapon and one per alive missile rack with ammo.
//
// Tier-parameterized decision quality only (FR-30 / Custom Rule 4 — no stat
// modifier lives here). CP1 wires target selection + assignment:
//   • rookie  — 'nearest' policy = lowest-BodyId live enemy (simpleFireCommander
//     rule — the pattern referenced by SESSION-04 in
//     `tools/balance/fixtureCommanders.ts:101`).
//   • veteran — 'threat-weighted' policy → top of `rankThreats(from shooterPos)`.
//   • ace     — 'threat-map' policy → same call site as veteran; the tier's
//     lookahead + wall cap live in the movement planner (S03). Called shots and
//     AoE friendly-fire skip land in CP2.
//
// Determinism scope (`src/ai/**` ban-list, D-AI-IMPORTS):
//   * mathx primitives only — no `sim/rules` (the hit-chance formula lives
//     there; the exact-expected-damage widening flagged in D-AI-IMPORTS is
//     defaulted OFF).
//   * BodyId-ASC iteration over `view.ships` / `view.bodies` (already sorted
//     by makeBlindView, §7.3 rule 1) — shuffle-invariance by construction.
//   * No wall-clock, no `Math.random`, no transcendentals.
//
// Blind-safe: reads ONLY the frozen view. No coordinator reference, no other
// fleet's plans reachable — architecture §6.3 / FR-17.

import type { Vec3 } from '../sim/mathx/index.js';
import type {
  AttackPlan,
  BodyId,
} from '../sim/types.js';
import type { BlindMatchView } from '../sim/loop/blindView.js';
import type { TierConfig } from './tiers.js';
import { rankThreats } from './threatMap.js';

// ---------------------------------------------------------------------------
// Target selection — `TargetingPolicy` (S01) routed to one BodyId per shooter.
// ---------------------------------------------------------------------------

/**
 * Lowest-BodyId live enemy — the `simpleFireCommander` rule (rookie).
 * `view.ships` is already BodyId-ASC (blindView contract), so the first
 * hull-positive non-own ship IS the lowest-id live enemy.
 */
const lowestBodyIdEnemy = (
  view: BlindMatchView,
  selfFleetId: number,
): BodyId | null => {
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.fleetId === selfFleetId) continue;
    if (s.hull <= 0) continue;
    return s.bodyId;
  }
  return null;
};

/**
 * Choose an enemy `BodyId` for `shooter` per `tier.targeting`. Returns `null`
 * when no live enemy is visible.
 *
 *   * 'nearest'         — rookie: lowest-BodyId live enemy.
 *   * 'threat-weighted' — veteran: top of `rankThreats(view, self, shooterPos)`.
 *   * 'threat-map'      — ace: same call — the lookahead + wall cap the ace
 *     tier owns live in movement planning; attack scoring is the same shape.
 */
const pickAttackTarget = (
  view: BlindMatchView,
  selfFleetId: number,
  shooterPos: Vec3,
  tier: TierConfig,
): BodyId | null => {
  if (tier.targeting === 'nearest') {
    return lowestBodyIdEnemy(view, selfFleetId);
  }
  const ranked = rankThreats(view, selfFleetId, shooterPos);
  return ranked.length > 0 ? ranked[0]!.bodyId : null;
};

// ---------------------------------------------------------------------------
// Public API — one deterministic function over a frozen view.
// ---------------------------------------------------------------------------

/**
 * Plan the attack beat for every owned live ship in `view`. Emits one
 * `AttackPlan` per alive weapon (`weaponAlive[wi]`) and one per alive missile
 * rack with ammo (`missileAlive[mi] && missileAmmo[mi] > 0`) — each targeting
 * the ship's chosen `pickAttackTarget` enemy.
 *
 * Blind-safe (FR-17): reads ONLY the frozen `BlindMatchView`. No coordinator
 * reference exists on the view; there is nothing to reach.
 *
 * Deterministic by construction: BodyId-sorted iteration + tier-parameterized
 * pure functions. Same view + same tier ⇒ byte-identical output.
 *
 * The ace AoE friendly-fire skip on missile assignment (FR-29) and the FR-25
 * called-shot ladder are added in CP2 (extending this signature with an
 * optional `CombatConfig`).
 */
export const planFleetAttack = (
  view: BlindMatchView,
  selfFleetId: number,
  tier: TierConfig,
): readonly AttackPlan[] => {
  const plans: AttackPlan[] = [];
  for (let i = 0; i < view.ships.length; i += 1) {
    const shooter = view.ships[i]!;
    if (shooter.fleetId !== selfFleetId) continue;
    if (shooter.hull <= 0) continue;
    const shooterPos = findBodyPosition(view, shooter.bodyId);
    if (shooterPos === null) continue;

    const targetId = pickAttackTarget(view, selfFleetId, shooterPos, tier);
    if (targetId === null) continue;

    for (let wi = 0; wi < shooter.weaponAlive.length; wi += 1) {
      if (!shooter.weaponAlive[wi]) continue;
      plans.push({ shooterId: shooter.bodyId, targetId, weaponIndex: wi });
    }
    for (let mi = 0; mi < shooter.missileAlive.length; mi += 1) {
      if (!shooter.missileAlive[mi]) continue;
      if ((shooter.missileAmmo[mi] ?? 0) <= 0) continue;
      plans.push({ shooterId: shooter.bodyId, targetId, missileIndex: mi });
    }
  }
  return plans;
};

// ---------------------------------------------------------------------------
// Internal — join `view.bodies` (kinematics) with `view.ships` (status) by
// BodyId. Small linear scan (≤ ~60 bodies per beat, FR-15). Mirrors the
// pattern threatMap.ts / movementPlanner.ts use so the module stays cohesive.
// ---------------------------------------------------------------------------

const findBodyPosition = (
  view: BlindMatchView,
  bodyId: BodyId,
): Vec3 | null => {
  for (let i = 0; i < view.bodies.length; i += 1) {
    const b = view.bodies[i]!;
    if (b.id === bodyId) return b.position;
  }
  return null;
};

