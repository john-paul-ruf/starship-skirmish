// missiles — launch, guidance, detonation, point-defense (M09, FR-24).
//
// A missile enters the field via `launch()` as a `MissileBody` — a plain sphere
// physics knows how to move. The rules layer keeps a separate `MissileGuidance`
// record per missile: target id, tracking-beats remaining, per-rack damage/AoE
// so a call to `detonate` (destruction.ts) doesn't need the SimShip anymore.
//
// Life cycle (turn-scoped, tracking = `cfg.missiles.trackingBeats`, default 2):
//   1. LAUNCH  ammo−−, boost applied along the bearing to the target snapshot.
//   2. GUIDE  while `trackingBeatsLeft > 0` and target alive, emit a MovementPlan
//              that turns velocity toward the target, limited by trackingTurnRate.
//              Target dead + `reacquireOnTargetLoss=false` (default) → no re-aim,
//              missile coasts.
//   3. FUEL-OUT  at 0 remaining beats, missile stops steering. Body behaves as
//              debris but stays ARMED (`cfg.missiles.spentRemainsArmed=true`,
//              default) — detonates on contact.
//   4. DETONATE  on any contact (ally, foe, hazard). destruction.ts turns the
//              resulting `DestructionEvent`-like AoE into per-body damage.
//
// Point-defense: each PD turret rolls `interceptsPerTurn` times against missiles
// within `interceptRange`. Determinism: candidates sorted by (defenderId,
// missileId) before iteration; each PD rolls with a distinct shotIndex; hit iff
// roll < interceptChance. Intercepted ids remain returned in ascending order.

import { atan2, cos, distance, length, of, sin } from '../mathx/index.js';
import type { Vec3 } from '../mathx/index.js';
import { rand01, type Seed } from '../mathx/index.js';
import type { BodyId, MissileBody, MovementPlan } from '../types.js';
import type { ShipCombat } from './combatState.js';

/** Fixed uint32 stream tag for point-defense interception rolls. Distinct from
 *  STREAM_ATTACK so a stray reorder of PD can't corrupt an attack roll. */
export const STREAM_PD = 0xbeef0000;

/**
 * Per-missile guidance state — carried by the loop alongside the physics body.
 * `trackingTurnRate` is in DEGREES per beat (matches catalog stat naming — the
 * catalog authors chose degrees; the sim converts internally).
 */
export interface MissileGuidance {
  readonly bodyId: BodyId;
  readonly targetId: BodyId;
  readonly trackingBeatsLeft: number;
  readonly rackDamage: number;
  readonly aoeRadius: number;
  /** Degrees per beat — max angle by which velocity may rotate toward the target. */
  readonly trackingTurnRate: number;
}

/** Contact reported by the movement beat that a missile participates in. */
export interface MissileContact {
  readonly missileId: BodyId;
  readonly otherId: BodyId;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

// ---- Launch ------------------------------------------------------------------------

export interface LaunchInput {
  readonly shooter: ShipCombat;
  readonly shooterPosition: Vec3;
  readonly shooterVelocity: Vec3;
  readonly rackIndex: number;
  readonly targetId: BodyId;
  readonly targetPosition: Vec3;
  readonly turn: number;
  readonly bodyId: BodyId;
  readonly trackingBeats: number;
  /**
   * When true, the missile spawns offset ahead of its launcher by
   * (`shooter.ship.radius + rack.bodyRadius + ε`) along the firing bearing so
   * it cannot detonate on its own launcher on the following movement beat.
   * Absent/false ⇒ spawns at `shooterPosition` (pre-F6 behavior; matches the
   * frozen combat golden fixtures whose loaded `CombatConfig` omits the
   * flag — the loop passes false when the flag is absent).
   */
  readonly launchClearsLauncher?: boolean;
}

/** Numeric floor between the missile and its launcher when the offset is
 *  applied — keeps the two spheres strictly non-overlapping without pushing
 *  the missile so far it snaps past intervening geometry. */
const LAUNCH_CLEARANCE_EPSILON = 1e-3;

/**
 * Launch one missile from `rackIndex`. Returns the physics body + rules-side
 * guidance record. Returns `null` when the rack cannot fire (dead subsystem or
 * empty magazine) — the caller (attack.ts) is expected to have pre-checked but
 * the guard here keeps this callable in isolation.
 */
export const launch = (input: LaunchInput): {
  body: MissileBody;
  guidance: MissileGuidance;
} | null => {
  const rack = input.shooter.ship.missiles[input.rackIndex];
  if (rack === undefined) return null;
  if (!input.shooter.missileAlive[input.rackIndex]!) return null;
  if (input.shooter.missileAmmo[input.rackIndex]! <= 0) return null;

  // Boost direction: unit vector from shooter → target snapshot. Zero-length
  // (target on top of launcher — degenerate) → use +X to avoid a NaN.
  const dx = input.targetPosition.x - input.shooterPosition.x;
  const dy = input.targetPosition.y - input.shooterPosition.y;
  const dz = input.targetPosition.z - input.shooterPosition.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  const nz = dist > 0 ? dz / dist : 0;

  // Spawn offset: when the config flag is on, push the missile forward by the
  // sum of the launcher and missile radii (plus ε) along the firing bearing
  // so the physics broadphase does not report a contact on the FIRST sub-step
  // (which would fire `detonatesOnContact` on the launcher). Degenerate
  // zero-length bearing already falls back to +X above — the +X-shifted
  // position stays valid.
  const clearLaunch = input.launchClearsLauncher ?? false;
  const offset = clearLaunch
    ? input.shooter.ship.radius + rack.bodyRadius + LAUNCH_CLEARANCE_EPSILON
    : 0;
  const position: Vec3 = of(
    input.shooterPosition.x + nx * offset,
    input.shooterPosition.y + ny * offset,
    input.shooterPosition.z + nz * offset,
  );

  const body: MissileBody = {
    kind: 'missile',
    id: input.bodyId,
    position,
    velocity: of(
      input.shooterVelocity.x + rack.boostVelocity * nx,
      input.shooterVelocity.y + rack.boostVelocity * ny,
      input.shooterVelocity.z + rack.boostVelocity * nz,
    ),
    mass: rack.bodyMass,
    radius: rack.bodyRadius,
  };
  const guidance: MissileGuidance = {
    bodyId: input.bodyId,
    targetId: input.targetId,
    trackingBeatsLeft: input.trackingBeats,
    rackDamage: rack.damage,
    aoeRadius: rack.aoeRadius,
    trackingTurnRate: rack.trackingTurnRate,
  };
  return { body, guidance };
};

// ---- Guidance ---------------------------------------------------------------------

/**
 * Rotate `v` toward `target` by AT MOST `maxRotationRad` radians, preserving
 * magnitude. If v is zero-length, returns v (no direction to rotate). If already
 * pointing at target (within the max), returns the exact target-aligned vector.
 *
 * Method: interpolate the direction on the plane spanned by (v, target). For
 * angles > maxRotation, use Rodrigues-lite (axis = normalized(v × target),
 * angle = maxRotation, applied to normalized(v)). All arithmetic goes through
 * mathx/trig (sin/cos/atan2), no `Math.pow`/`hypot`.
 */
const rotateToward = (v: Vec3, target: Vec3, maxRotationRad: number): Vec3 => {
  const vLen = length(v);
  if (vLen === 0) return v;
  const tLen = length(target);
  if (tLen === 0) return v;
  // Unit-length copies.
  const vx = v.x / vLen;
  const vy = v.y / vLen;
  const vz = v.z / vLen;
  const tx = target.x / tLen;
  const ty = target.y / tLen;
  const tz = target.z / tLen;
  // Angle between v and target on their common plane.
  let dot = vx * tx + vy * ty + vz * tz;
  if (dot > 1) dot = 1;
  if (dot < -1) dot = -1;
  // Use atan2(|v × t|, v · t) for a numerically stable angle across near-1 dots.
  const cx = vy * tz - vz * ty;
  const cy = vz * tx - vx * tz;
  const cz = vx * ty - vy * tx;
  const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const angle = atan2(crossLen, dot);

  // Already close enough — snap to target direction (preserves magnitude).
  if (angle <= maxRotationRad) {
    return of(tx * vLen, ty * vLen, tz * vLen);
  }

  // Anti-parallel (angle ≈ π, cross ≈ 0) — no natural rotation axis. Nudge
  // toward target by picking a stable perpendicular; we simply linearly blend
  // by the max-rotation fraction (approximation adequate for the sim's tolerance).
  if (crossLen === 0) {
    // Blend, then renormalize — degenerate case only reachable when v ⊥ target
    // (never happens with dot=+1) or v = −target.
    const frac = maxRotationRad / angle;
    const bx = vx + (tx - vx) * frac;
    const by = vy + (ty - vy) * frac;
    const bz = vz + (tz - vz) * frac;
    const bLen = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bLen === 0) return v;
    return of((bx / bLen) * vLen, (by / bLen) * vLen, (bz / bLen) * vLen);
  }

  // Rodrigues: rotate v around unit axis n by maxRotationRad.
  const nx = cx / crossLen;
  const ny = cy / crossLen;
  const nz = cz / crossLen;
  const c = cos(maxRotationRad);
  const s = sin(maxRotationRad);
  const oneMinusC = 1 - c;
  // v_rot = v·c + (n × v)·s + n·(n · v)·(1 − c)
  const ndotv = nx * vx + ny * vy + nz * vz;
  const rcrossx = ny * vz - nz * vy;
  const rcrossy = nz * vx - nx * vz;
  const rcrossz = nx * vy - ny * vx;
  const rx = vx * c + rcrossx * s + nx * ndotv * oneMinusC;
  const ry = vy * c + rcrossy * s + ny * ndotv * oneMinusC;
  const rz = vz * c + rcrossz * s + nz * ndotv * oneMinusC;
  return of(rx * vLen, ry * vLen, rz * vLen);
};

// Convert degrees → radians via the mathx constant. Local, `+ − · /` only.
const DEG_TO_RAD_LOCAL = 6.283185307179586 / 360;

/**
 * Emit movement plans for missiles that can still steer. Also returns the
 * updated guidance list (trackingBeatsLeft decremented for anything with tracking
 * remaining — the loop swaps the old list for this).
 *
 * A missile whose target is missing from `targetPosById` (destroyed since last
 * beat) is treated per `reacquireOnTargetLoss`: `false` (default) → no plan,
 * missile coasts.
 *
 * `bodyById` supplies the missile bodies (loop threads them in from the current
 * body set). A guidance whose body has left the field (boundary exit) is silently
 * dropped from the returned list.
 */
export const guideMissiles = (
  guidances: readonly MissileGuidance[],
  bodyById: ReadonlyMap<BodyId, MissileBody>,
  targetPosById: ReadonlyMap<BodyId, Vec3>,
  reacquireOnTargetLoss: boolean,
): { plans: MovementPlan[]; nextGuidances: MissileGuidance[] } => {
  // Iterate guidances by ascending bodyId — deterministic no matter what order
  // the loop stored them.
  const sorted = guidances.slice().sort((a, b) => a.bodyId - b.bodyId);
  const plans: MovementPlan[] = [];
  const next: MissileGuidance[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const g = sorted[i]!;
    const body = bodyById.get(g.bodyId);
    if (body === undefined) continue; // missile left the field
    if (g.trackingBeatsLeft <= 0) {
      // Fuel-out: no plan, guidance retained (spent-armed on-contact behavior).
      next.push(g);
      continue;
    }
    const targetPos = targetPosById.get(g.targetId);
    if (targetPos === undefined) {
      // Target lost.
      if (!reacquireOnTargetLoss) {
        // Coast; decrement remaining beats (missile still ages toward fuel-out).
        next.push({ ...g, trackingBeatsLeft: g.trackingBeatsLeft - 1 });
        continue;
      }
      // Reacquire path not implemented (tuning default is false — assumption 3).
      next.push({ ...g, trackingBeatsLeft: g.trackingBeatsLeft - 1 });
      continue;
    }
    // Desired direction toward target, current speed preserved.
    const desired: Vec3 = of(
      targetPos.x - body.position.x,
      targetPos.y - body.position.y,
      targetPos.z - body.position.z,
    );
    const maxRotationRad = g.trackingTurnRate * DEG_TO_RAD_LOCAL;
    const rotated = rotateToward(body.velocity, desired, maxRotationRad);
    // Movement plan is a deltaV — the difference between the desired rotated
    // velocity and the current velocity. Physics applies this at start-of-beat.
    plans.push({
      bodyId: g.bodyId,
      deltaV: of(
        rotated.x - body.velocity.x,
        rotated.y - body.velocity.y,
        rotated.z - body.velocity.z,
      ),
    });
    next.push({ ...g, trackingBeatsLeft: g.trackingBeatsLeft - 1 });
  }
  return { plans, nextGuidances: next };
};

/**
 * A missile detonates on contact iff:
 *   - tracking > 0 (live warhead), OR
 *   - `spentRemainsArmed` and body is still in the field (fuel-out debris armed).
 *
 * Missiles that have already fired their warhead this beat don't detonate twice —
 * the caller filters by "guidance is still present". Guidance is removed by the
 * loop once a missile detonates (destruction pass).
 */
export const detonatesOnContact = (
  guidance: MissileGuidance,
  spentRemainsArmed: boolean,
): boolean => {
  if (guidance.trackingBeatsLeft > 0) return true;
  return spentRemainsArmed;
};

// ---- Point-defense ----------------------------------------------------------------

export interface InterceptCandidate {
  readonly defenderId: BodyId;
  readonly defenderPosition: Vec3;
  /** Which point-defense turret on `defender` — index into ShipCombat.pdAlive/ship.pointDefense. */
  readonly pdIndex: number;
  readonly missileId: BodyId;
  readonly missilePosition: Vec3;
}

/**
 * Roll interception for a set of candidates. Deterministic across permutations
 * of the input list: sorted by (defenderId, pdIndex, missileId), each roll uses
 * distinct RNG coords, and the returned ids come back in ascending order.
 *
 * Each defender's `interceptsPerTurn` gates how many shots THAT turret can take
 * this turn — enforced by giving each shot a distinct `shotIndex` and skipping
 * candidates past the per-defender/per-slot budget.
 *
 * A missile is "intercepted" iff SOME shot at it succeeds. Returned list is the
 * set of missileIds intercepted, in ascending order — safe to feed to a "remove
 * from field" set.
 */
export const interceptMissiles = (
  defenders: ReadonlyMap<BodyId, ShipCombat>,
  candidates: readonly InterceptCandidate[],
  seed: Seed,
  turn: number,
): { intercepted: BodyId[] } => {
  const sorted = candidates.slice().sort((a, b) => {
    if (a.defenderId !== b.defenderId) return a.defenderId - b.defenderId;
    if (a.pdIndex !== b.pdIndex) return a.pdIndex - b.pdIndex;
    return a.missileId - b.missileId;
  });
  const shotsUsed = new Map<string, number>(); // key: `${defId}:${pdIdx}`
  const interceptedSet = new Set<BodyId>();
  for (let i = 0; i < sorted.length; i += 1) {
    const c = sorted[i]!;
    const defender = defenders.get(c.defenderId);
    if (defender === undefined) continue;
    if (!defender.pdAlive[c.pdIndex]!) continue;
    const pd = defender.ship.pointDefense[c.pdIndex]!;
    // Range gate (squared for `+ − · /` — no sqrt call).
    const d = distance(c.defenderPosition, c.missilePosition);
    if (d > pd.interceptRange) continue;
    const key = `${c.defenderId}:${c.pdIndex}`;
    const used = shotsUsed.get(key) ?? 0;
    if (used >= pd.interceptsPerTurn) continue;
    shotsUsed.set(key, used + 1);
    const roll = rand01(
      seed,
      turn,
      STREAM_PD,
      c.defenderId,
      c.pdIndex,
      c.missileId,
      used,
    );
    if (roll < pd.interceptChance) {
      interceptedSet.add(c.missileId);
    }
  }
  const intercepted = Array.from(interceptedSet).sort((a, b) => a - b);
  return { intercepted };
};
