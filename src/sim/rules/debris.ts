// debris — spawn on destruction, tick lifetime, enforce hazard cap (M09, FR-23).
//
// Debris count per destruction is a per-class datum in tuning.hazards.debrisPerDestruction;
// mass is a fraction of hull mass; radius is fixed. Each shard inherits the parent's
// velocity plus a seeded scatter impulse (unit direction × cfg.debrisScatterImpulse).
// The velocity + scatter feeds physics next beat; hazards leaving the boundary are
// removed silently (FR-26).
//
// Hazard cap: field-wide safety limit at cfg.hazards.maxSimultaneousBodies (default 300).
// Should NEVER fire in normal play — the tuned field cap is 60 ships × 12 debris/kill ≪
// 300 — but if it does, cull OLDEST first and REPORT the count (no silent truncation).

import { of } from '../mathx/index.js';
import type { Vec3 } from '../mathx/index.js';
import { rand01, type Seed } from '../mathx/index.js';
import { dirFromBearingPitch } from '../mathx/index.js';
import type {
  BodyId,
  CombatConfig,
  DestructionEvent,
  SimShip,
} from '../types.js';

/** Fixed uint32 stream tag for debris-scatter direction rolls. */
export const STREAM_DEBRIS = 0xdeb50000;

/**
 * Descriptor for a debris body pending id assignment. The loop mints the actual
 * `BodyId` (only the loop knows the current body-id counter) and finalizes the
 * `DebrisBody` from this + the id.
 */
export interface DebrisDescriptor {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly mass: number;
  readonly radius: number;
}

/**
 * Spawn debris for one destruction. Emits an array of descriptors (loop mints ids).
 * Counts are `cfg.hazards.debrisPerDestruction[chassisClass]`; each shard inherits
 * the ship's post-destruction velocity plus a seeded scatter of magnitude
 * `cfg.hazards.debrisScatterImpulse` along a seeded unit direction.
 *
 * Determinism: scatter direction uses `rand01(seed, turn, STREAM_DEBRIS, bodyId,
 * debrisIndex, streamDim)` — pure function of the tuple. `debrisIndex` runs
 * sequentially [0..count), so the same destruction produces the same shard set
 * on every engine.
 */
export const spawnDebris = (
  dest: DestructionEvent,
  ship: SimShip,
  seed: Seed,
  turn: number,
  cfg: CombatConfig,
): DebrisDescriptor[] => {
  const count = cfg.hazards.debrisPerDestruction[dest.chassisClass];
  if (count <= 0) return [];
  const shardMass = ship.mass * cfg.hazards.debrisMassFractionOfHull;
  const shardRadius = cfg.hazards.debrisRadius;
  const scatter = cfg.hazards.debrisScatterImpulse;

  const out: DebrisDescriptor[] = [];
  for (let i = 0; i < count; i += 1) {
    // Two draws — bearing ∈ [-180, 180), pitch ∈ [-90, 90) — map to a unit vector
    // via `dirFromBearingPitch` (the deterministic trig path).
    const rB = rand01(seed, turn, STREAM_DEBRIS, dest.bodyId, i, 0);
    const rP = rand01(seed, turn, STREAM_DEBRIS, dest.bodyId, i, 1);
    const bearingDeg = rB * 360 - 180;
    const pitchDeg = rP * 180 - 90;
    const dir = dirFromBearingPitch(bearingDeg, pitchDeg);
    out.push({
      position: dest.position,
      velocity: of(
        dest.velocity.x + dir.x * scatter,
        dest.velocity.y + dir.y * scatter,
        dest.velocity.z + dir.z * scatter,
      ),
      mass: shardMass,
      radius: shardRadius,
    });
  }
  return out;
};

// ---- Lifetime ticking + cull ------------------------------------------------------

export interface DebrisAge {
  readonly bodyId: BodyId;
  readonly age: number; // turns elapsed since spawn
}

/**
 * Advance debris ages by one turn; cull anything that reaches `debrisLifetimeTurns`.
 * Returns the survivors and the culled-id list — both sorted by bodyId for
 * deterministic downstream iteration.
 */
export const tickDebrisLifetime = (
  ages: readonly DebrisAge[],
  cfg: CombatConfig,
): { survivors: DebrisAge[]; culled: BodyId[] } => {
  const lifetime = cfg.hazards.debrisLifetimeTurns;
  const survivors: DebrisAge[] = [];
  const culled: BodyId[] = [];
  for (let i = 0; i < ages.length; i += 1) {
    const nextAge = ages[i]!.age + 1;
    if (nextAge >= lifetime) {
      culled.push(ages[i]!.bodyId);
    } else {
      survivors.push({ bodyId: ages[i]!.bodyId, age: nextAge });
    }
  }
  survivors.sort((a, b) => a.bodyId - b.bodyId);
  culled.sort((a, b) => a - b);
  return { survivors, culled };
};

// ---- Hazard cap -------------------------------------------------------------------

export interface HazardEntry {
  readonly bodyId: BodyId;
  readonly age: number;
}

export interface HazardCapResult {
  readonly kept: HazardEntry[];
  /** How many entries were dropped (0 in normal play — the cap should never fire). */
  readonly droppedCount: number;
  readonly droppedIds: BodyId[];
}

/**
 * If the hazard list exceeds `cfg.hazards.maxSimultaneousBodies`, cull OLDEST
 * first — stable by (−age, bodyId), so the oldest & lowest-id go first. Returns
 * the drop count for the loop's log (design rule: NO silent truncation). Never
 * expected to fire in normal play (tuned cap = 300 ≫ typical field).
 */
export const enforceHazardCap = (
  entries: readonly HazardEntry[],
  cfg: CombatConfig,
): HazardCapResult => {
  const cap = cfg.hazards.maxSimultaneousBodies;
  if (entries.length <= cap) {
    return { kept: entries.slice(), droppedCount: 0, droppedIds: [] };
  }
  const excess = entries.length - cap;
  // Sort by age DESC, then bodyId ASC — the "oldest, then lowest id" tie-break.
  const sortedByOldest = entries.slice().sort((a, b) => {
    if (a.age !== b.age) return b.age - a.age;
    return a.bodyId - b.bodyId;
  });
  const dropped = sortedByOldest.slice(0, excess);
  const keptSet = new Set(sortedByOldest.slice(excess).map((e) => e.bodyId));
  const kept = entries.filter((e) => keptSet.has(e.bodyId));
  const droppedIds = dropped.map((e) => e.bodyId).sort((a, b) => a - b);
  return { kept, droppedCount: excess, droppedIds };
};
