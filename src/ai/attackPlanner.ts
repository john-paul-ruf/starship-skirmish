// attackPlanner — deterministic per-turn attack assignment (M12; FR-17, FR-20,
// FR-25, FR-29).
//
// Consumed by the HeuristicCommander (this session). Pure function of a frozen
// `BlindMatchView` (M10 blind-commit contract — FR-17): for every owned live
// ship the planner picks ONE target per `TIER_CONFIG.targeting` and emits one
// `AttackPlan` per alive weapon and one per alive missile rack with ammo.
//
// Tier-parameterized decision quality only (FR-30 / Custom Rule 4 — no stat
// modifier lives here):
//   • rookie  — 'nearest' = lowest-BodyId live enemy (simpleFireCommander rule,
//     `tools/balance/fixtureCommanders.ts:101`); no called shots; no AoE check.
//   • veteran — 'threat-weighted' → top of `rankThreats(shooterPos)`; FR-25
//     called-shot ladder ENABLED; no AoE check.
//   • ace     — 'threat-map' → same call site as veteran (lookahead + wall cap
//     live in the movement planner, S03); called-shot ladder ENABLED; FR-29
//     AoE friendly-fire skip on missile assignment ENABLED.
//
// Called-shot ladder (`calledShotForTarget`) — F5 design pinned here:
//   1. `shield-generator` — while `shieldGenAlive`. Killing the generator drops
//      shield capacity to 0 for the rest of the match (regen dies too — see
//      `src/sim/rules/shields.ts:regenShields`). FR-25's headline play.
//   2. `engine`           — once the generator is down, disable mobility.
//   3. Highest-damage live weapon — otherwise strip firepower. Ranked by
//      `damage × shotsPerTurn × accuracy` DESC, lowest index tiebreak.
//   4. Fall through — omit `calledShot` (plain hull shot). Keeps output valid
//      when a target has been stripped of everything called-shot-able.
// Legality gate: the sim's attack beat honours `calledShot` ONLY when target
// shields are already 0 (`calledShotsUnlocked` in `src/sim/rules/shields.ts`);
// a called-shot plan against a shielded target is demoted to a plain hull shot.
// So this planner ONLY sets `calledShot` when `target.shields === 0`.
//
// AoE friendly-fire skip (`hasOwnFleetInAoe`) — ace missile assignment only,
// FR-29 acceptance criterion. Weapons carry no AoE; unaffected. The radius
// used is `combat.destruction.aoeRadiusByClass[targetChassisClass]` — the sim
// widens to include the shooter's own fleet (including the shooter itself) as
// a conservative check; if any own-fleet live ship sits inside that radius of
// the target NOW, skip this missile. When `combat` is undefined (the rookie /
// veteran path) the check is a no-op and all missiles fly.
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
import { distanceSq } from '../sim/mathx/index.js';
import type {
  AttackPlan,
  BodyId,
  CalledShotTarget,
  CombatConfig,
} from '../sim/types.js';
import type {
  BlindMatchView,
  BlindShipView,
} from '../sim/loop/blindView.js';
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
// Called-shot ladder (FR-25) — gated by `tier.enableCalledShots`.
// See file header for the four-step priority: shield-generator → engine →
// highest-damage weapon → fall through.
// ---------------------------------------------------------------------------

/** Index of the target's highest-damage live weapon (DPS proxy), or null. */
const bestLiveWeaponIndex = (target: BlindShipView): number | null => {
  let bestIdx: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < target.weaponAlive.length; i += 1) {
    if (!target.weaponAlive[i]) continue;
    const w = target.ship.weapons[i]!;
    const score = w.damage * w.shotsPerTurn * w.accuracy;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/**
 * Pick a called-shot subsystem for `target`, or return `null` if none applies.
 * Only ever called when `tier.enableCalledShots` is true (veteran / ace).
 * Only ever RETURNS non-null when target shields are already 0 — the sim's
 * legality gate (`calledShotsUnlocked`) would silently demote a called shot
 * against a shielded target, so emitting one would be wasted output.
 */
const calledShotForTarget = (target: BlindShipView): CalledShotTarget | null => {
  if (target.shields > 0) return null;
  if (target.shieldGenAlive) return { kind: 'shield-generator' };
  if (target.engineAlive) return { kind: 'engine' };
  const wi = bestLiveWeaponIndex(target);
  if (wi !== null) return { kind: 'weapon', index: wi };
  return null;
};

// ---------------------------------------------------------------------------
// AoE friendly-fire skip (FR-29) — gated by `tier.enableAoeFriendlyFireCheck`
// AND caller supplying `combat`. Ace only.
// ---------------------------------------------------------------------------

/**
 * True if any own-fleet live ship (including the shooter — a conservative
 * check) sits inside `aoeRadius` of `targetPos`. Radius comparison uses
 * `distanceSq` — no sqrt / no transcendental. `aoeRadius <= 0` short-circuits
 * to false (no AoE, nothing to avoid).
 */
const hasOwnFleetInAoe = (
  view: BlindMatchView,
  selfFleetId: number,
  targetPos: Vec3,
  aoeRadius: number,
): boolean => {
  if (aoeRadius <= 0) return false;
  const r2 = aoeRadius * aoeRadius;
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.fleetId !== selfFleetId) continue;
    if (s.hull <= 0) continue;
    const pos = findBodyPosition(view, s.bodyId);
    if (pos === null) continue;
    if (distanceSq(pos, targetPos) <= r2) return true;
  }
  return false;
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
 * When `tier.enableCalledShots` is on (veteran / ace) and the target's shields
 * are already 0, sets `calledShot` per the file-header priority ladder. When
 * `tier.enableAoeFriendlyFireCheck` is on (ace) and `combat` is supplied,
 * skips missile assignments whose target has an own-fleet live ship inside
 * the class AoE radius (FR-29). Weapons carry no AoE and are unaffected.
 *
 * Blind-safe (FR-17): reads ONLY the frozen `BlindMatchView`. No coordinator
 * reference exists on the view; there is nothing to reach.
 *
 * Deterministic by construction: BodyId-sorted iteration + tier-parameterized
 * pure functions. Same view + same tier + same combat ⇒ byte-identical output.
 */
export const planFleetAttack = (
  view: BlindMatchView,
  selfFleetId: number,
  tier: TierConfig,
  combat?: CombatConfig,
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
    const targetView = findShipView(view, targetId);
    const targetPos = findBodyPosition(view, targetId);
    if (targetView === null || targetPos === null) continue;

    // FR-25 called shot — legal only against zero-shield targets. Same
    // subsystem pick applies to weapon and missile plans this turn (a target
    // has one weakest link this beat; there is no reason a fighter's rack
    // would called-shot a different subsystem from its own weapons).
    const calledShot = tier.enableCalledShots
      ? calledShotForTarget(targetView)
      : null;

    // Weapons: one plan per alive weapon.
    for (let wi = 0; wi < shooter.weaponAlive.length; wi += 1) {
      if (!shooter.weaponAlive[wi]) continue;
      plans.push(
        calledShot === null
          ? { shooterId: shooter.bodyId, targetId, weaponIndex: wi }
          : { shooterId: shooter.bodyId, targetId, weaponIndex: wi, calledShot },
      );
    }

    // Missiles: one plan per alive rack with ammo. FR-29 ace AoE skip.
    const aoeRadius =
      tier.enableAoeFriendlyFireCheck && combat !== undefined
        ? combat.destruction.aoeRadiusByClass[targetView.chassisClass]
        : 0;
    const skipMissiles =
      aoeRadius > 0
      && hasOwnFleetInAoe(view, selfFleetId, targetPos, aoeRadius);
    if (skipMissiles) continue;
    for (let mi = 0; mi < shooter.missileAlive.length; mi += 1) {
      if (!shooter.missileAlive[mi]) continue;
      if ((shooter.missileAmmo[mi] ?? 0) <= 0) continue;
      plans.push(
        calledShot === null
          ? { shooterId: shooter.bodyId, targetId, missileIndex: mi }
          : { shooterId: shooter.bodyId, targetId, missileIndex: mi, calledShot },
      );
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

const findShipView = (
  view: BlindMatchView,
  bodyId: BodyId,
): BlindShipView | null => {
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.bodyId === bodyId) return s;
  }
  return null;
};

