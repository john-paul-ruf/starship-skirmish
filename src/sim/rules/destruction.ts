// destruction — turn a `DestructionEvent` into AoE hits + a debris spawn (M09,
// FR-23 + FR-26). Ownership blind (Decision 13). Boundary deaths (detonates=false,
// position outside arena) yield NO AoE and NO debris.
//
// The rules layer computes the geometry; the loop applies it (per-body damage
// bundles into the next attack pass, debris descriptors into the next physics
// step). Keeping the compute here means the destruction rulebook lives in one
// place instead of leaking into loop plumbing.

import { distance } from '../mathx/index.js';
import type { Vec3 } from '../mathx/index.js';
import type { BodyId, CombatConfig, DestructionEvent } from '../types.js';
import { aoeFalloff } from './damage.js';

/** One body caught in an AoE — the loop merges this into the target's damage bundle. */
export interface AoeHit {
  readonly bodyId: BodyId;
  readonly damage: number;
}

export interface DetonationResult {
  /** The blast spec (center + radius + centerDamage), for the trace to render. */
  readonly aoe: {
    readonly center: Vec3;
    readonly radius: number;
    readonly centerDamage: number;
  };
  /** Bodies within radius, in ascending id (deterministic downstream). */
  readonly hits: readonly AoeHit[];
}

/**
 * Detonate a destruction event. Returns null when the event doesn't detonate
 * (a boundary death outside the arena — FR-26). Ownership is NOT checked —
 * every body in radius takes the (falloff-scaled) damage (Decision 13).
 *
 * `bodyPositions` supplies every body currently on the field, keyed by id — the
 * detonation IGNORES the dying body itself (we don't damage the corpse).
 */
export const detonate = (
  dest: DestructionEvent,
  bodyPositions: ReadonlyMap<BodyId, Vec3>,
  cfg: CombatConfig,
): DetonationResult | null => {
  if (!dest.detonates) return null;
  const radius = cfg.destruction.aoeRadiusByClass[dest.chassisClass];
  const centerDamage = cfg.destruction.aoeDamageByClass[dest.chassisClass];
  if (radius <= 0 || centerDamage <= 0) {
    return {
      aoe: { center: dest.position, radius, centerDamage },
      hits: [],
    };
  }
  // Iterate ids in ascending order — the deterministic-iteration rule.
  const idsSorted = Array.from(bodyPositions.keys()).sort((a, b) => a - b);
  const hits: AoeHit[] = [];
  for (let i = 0; i < idsSorted.length; i += 1) {
    const id = idsSorted[i]!;
    if (id === dest.bodyId) continue;
    const p = bodyPositions.get(id)!;
    const d = distance(dest.position, p);
    if (d >= radius) continue;
    const dmg = aoeFalloff(centerDamage, d, radius);
    if (dmg > 0) hits.push({ bodyId: id, damage: dmg });
  }
  return {
    aoe: { center: dest.position, radius, centerDamage },
    hits,
  };
};
