// threatMap — deterministic target-quality scoring over a `BlindMatchView` (M12).
//
// Reads a frozen `BlindMatchView` (M10) and, from the scoring ship's position,
// ranks ENEMY ships by descending threat. Consumed by:
//   • the movement planner (S03) — ace tier's `threat-map` targeting policy.
//   • the attack planner (S04) — target selection for a shooter.
//
// Determinism scope (`src/ai/**`):
//   * mathx-only arithmetic (no `Math.pow` / transcendentals — `powi` if needed).
//   * NO `sim/rules` import. The hit-chance FORMULA lives in `sim/rules`; the
//     threat score is an *approximation* computed arithmetically from public
//     `BlindShipView` + `SimWeapon`/`SimMissileRack` fields. Ruling H forbids the
//     UI from recomputing hit chance; the bot's *approximate* score is a scoring
//     heuristic, not a published number, so this is not the same widening.
//     (Flagged in D-AI-IMPORTS: exact hit-chance targeting would widen `ai → rules`;
//     defaulted OFF here.)
//   * Iteration order is `view.ships` order (already sorted by BodyId — the
//     shuffle-invariance property, `blindView.ts`). Tie-breaks are stable and
//     total: descending score, then ascending BodyId. No `Object.keys`, no `Set`.

import { distance, distanceSq } from '../sim/mathx/index.js';
import type { Vec3 } from '../sim/mathx/index.js';
import type { BodyId } from '../sim/types.js';
import type { BlindMatchView, BlindShipView } from '../sim/loop/blindView.js';

/** One (bodyId, score) pair. Higher score = higher-priority target. */
export interface ThreatScore {
  readonly bodyId: BodyId;
  readonly score: number;
}

// ---------------------------------------------------------------------------
// Score primitives — pure functions of the ship view. Kept small so a test
// can pin the exact contribution of each term without knowing weights.
// ---------------------------------------------------------------------------

/**
 * Rough offensive throughput: Σ (weapon.damage × shotsPerTurn × accuracy) over
 * live weapons, plus a missile contribution over live racks with ammo. Uses the
 * SimWeapon/SimMissileRack fields directly — no `sim/rules` import.
 *
 * The missile term folds `damage × ammo` (soft-capped by turns of usable ammo
 * elsewhere) rather than a per-turn shot count; a rack is a threat as long as
 * it has ammo and is alive. A dead rack contributes zero.
 */
const offensiveScore = (ship: BlindShipView): number => {
  const s = ship.ship;
  let total = 0;
  for (let i = 0; i < s.weapons.length; i += 1) {
    if (!ship.weaponAlive[i]) continue;
    const w = s.weapons[i]!;
    total += w.damage * w.shotsPerTurn * w.accuracy;
  }
  for (let i = 0; i < s.missiles.length; i += 1) {
    if (!ship.missileAlive[i]) continue;
    const rack = s.missiles[i]!;
    const ammo = ship.missileAmmo[i] ?? 0;
    if (ammo <= 0) continue;
    // A live rack with `n` shots-in-inventory contributes `damage × n`.
    // Downstream this rewards multi-launch racks without needing rules-scoped
    // AoE math (which would widen `ai → rules`).
    total += rack.damage * ammo;
  }
  return total;
};

/**
 * Survivability proxy: `hull + shields`. Veteran's "bias against high-HP
 * targets" (design.md §4.10) is implemented as an INVERSE weight in the final
 * score — a higher survivability lowers priority (harder kill). We add `1` to
 * the denominator elsewhere to keep the score defined when both pools are zero
 * on a dying ship still standing this beat.
 */
const survivabilityScore = (ship: BlindShipView): number =>
  ship.hull + ship.shields;

/**
 * Engageability: closer is easier. Returns `1 / (1 + distance)` so the term is
 * bounded in `(0, 1]` and never blows up on coincident positions. Purely
 * arithmetic — no transcendentals.
 */
const engageabilityScore = (from: Vec3, targetPos: Vec3): number => {
  const d = distance(from, targetPos);
  return 1 / (1 + d);
};

// ---------------------------------------------------------------------------
// Public API — a single deterministic ranking function over a view.
// ---------------------------------------------------------------------------

/**
 * The full threat score for a single enemy ship, from the scorer's position.
 * `score = offensive / (1 + survivability) × engageability`.
 *
 * The `/ (1 + survivability)` gate implements the "bias against high-HP targets"
 * (veteran) and the "harder / lower-priority kill" (design.md §4.10). The
 * engageability factor closes the loop for ace's threat-map policy without
 * requiring an angle-of-fire number (which would need `sim/rules`).
 */
export const threatScore = (
  target: BlindShipView,
  from: Vec3,
  targetPosition: Vec3,
): number => {
  const off = offensiveScore(target);
  const surv = survivabilityScore(target);
  const eng = engageabilityScore(from, targetPosition);
  return (off / (1 + surv)) * eng;
};

/**
 * Rank enemy ships (`fleetId !== selfFleetId`) by DESCENDING threat score.
 * Tie-break: ascending `bodyId` — the total, order-independent ordering
 * `view.ships` is already sorted by (`blindView.ts`).
 *
 * The scorer's position is `from` — S03 passes the acting ship's position;
 * S04's attack planner passes the shooter's position. Non-live enemy ships
 * (hull ≤ 0) are dropped — a dead ship is not a threat.
 *
 * Deterministic by construction: pure function of the view + `selfFleetId` +
 * `from`. Iterates the frozen `view.ships` (already BodyId-sorted, no
 * `Object.keys` / `Set`); the `Array.prototype.sort` used at the end runs on
 * the collected slice with a total comparator (score DESC, bodyId ASC), so
 * the resulting order is bit-identical across engines.
 */
export const rankThreats = (
  view: BlindMatchView,
  selfFleetId: number,
  from: Vec3,
): readonly ThreatScore[] => {
  const scored: ThreatScore[] = [];
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.fleetId === selfFleetId) continue;
    if (s.hull <= 0) continue;
    // Enemy position from the bodies slice (BlindShipView carries status only).
    const body = findBody(view, s.bodyId);
    if (body === null) continue;
    const score = threatScore(s, from, body.position);
    scored.push({ bodyId: s.bodyId, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score; // DESC
    return a.bodyId - b.bodyId; // ASC tiebreak
  });
  return scored;
};

/**
 * Nearest enemy ship's body-id to `from`, or `null` if none live. Deterministic
 * tie-break on ascending BodyId (Gate-2 §1c). Kept here so the movement
 * planner's `nearest` policy and the threat map share one enemy-filter path.
 */
export const nearestEnemyBodyId = (
  view: BlindMatchView,
  selfFleetId: number,
  from: Vec3,
): BodyId | null => {
  let bestId: BodyId | null = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < view.ships.length; i += 1) {
    const s = view.ships[i]!;
    if (s.fleetId === selfFleetId) continue;
    if (s.hull <= 0) continue;
    const body = findBody(view, s.bodyId);
    if (body === null) continue;
    const dSq = distanceSq(from, body.position);
    if (dSq < bestDistSq || (dSq === bestDistSq && bestId !== null && s.bodyId < bestId)) {
      bestId = s.bodyId;
      bestDistSq = dSq;
    }
  }
  return bestId;
};

// ---------------------------------------------------------------------------
// Internal — look up a body's kinematic snapshot (position/velocity/radius)
// by BodyId from the view's `bodies` slice. `BlindShipView` carries STATUS
// (hull, shields, alive flags), the Body carries KINEMATICS — join on
// `bodyId`. Linear scan over a small sorted array is cheap (≤ ~60 bodies per
// beat, FR-15) and keeps the mathx-only property intact.
// ---------------------------------------------------------------------------

const findBody = (
  view: BlindMatchView,
  bodyId: BodyId,
): { readonly position: Vec3; readonly velocity: Vec3; readonly radius: number } | null => {
  for (let i = 0; i < view.bodies.length; i += 1) {
    const b = view.bodies[i]!;
    if (b.id === bodyId) return b;
  }
  return null;
};
