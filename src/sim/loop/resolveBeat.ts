// resolveBeat — the pure movement + attack resolvers (M10, architecture §6.2).
//
// This file holds the TWO layers of resolution as pure, synchronous functions.
// They take a `MatchState` + plans and return a NEW state + a per-beat record.
// No `Commander`, no `await` — that's the coordinator's job (turnCoordinator.ts).
// Determinism suite (S05) and the F5 headless harness drive these directly with
// fixed plan sets; the UI drives them indirectly via the coordinator.
//
// The loop CONTAINS NO combat formula of its own. Every damage number, every
// hit chance, every AoE falloff is computed by `sim/rules`; every physics
// motion by `sim/physics`; every log entry / record shape by `sim/trace`. This
// file's job is composition, id book-keeping, and deterministic ordering.
//
// Two-phase read/stage/commit (architecture §7.3 rule 3):
//   * Every read of `state` is from the input snapshot.
//   * Every mutation goes into fresh Maps / arrays that will become the OUTPUT
//     state — never mutate the input's maps in place. New `ShipCombat` records
//     come from `applyDamageBundle` / `resolveCalledShot`, which already clone.
//
// The whole file uses ONLY sorted-id iteration for maps of ids (§7.3 rule 1).

import { distance, of, type Vec3 } from '../mathx/index.js';
import { resolveMovement, type StepContact } from '../physics/index.js';
import type {
  AttackPlan,
  Body,
  BodyId,
  CombatLogEntry,
  DebrisBody,
  DestructionEvent,
  MissileBody,
  MovementPlan,
  ShipBody,
  SimShip,
} from '../types.js';
import {
  aoeFalloff,
  applyDamageBundle,
  detonate,
  detonatesOnContact,
  enforceHazardCap,
  guideMissiles,
  regenShields,
  resolveAttackBeat,
  spawnDebris,
  tickDebrisLifetime,
  type Damage,
  type DebrisAge,
  type HazardEntry,
  type LaunchEnv,
  type MissileGuidance,
  type ShipCombat,
} from '../rules/index.js';
import {
  logAoe,
  logBoundaryExit,
  logCollision,
  type AttackBeatRecord,
  type MovementBeatRecord,
} from '../trace/index.js';
import type { MatchState } from './matchState.js';

export interface MovementBeatOutcome {
  readonly state: MatchState;
  readonly record: MovementBeatRecord;
}

export interface AttackBeatOutcome {
  readonly state: MatchState;
  readonly record: AttackBeatRecord;
}

// ---- Helpers shared across the two beats -----------------------------------

const sortedBodies = (bodies: ReadonlyMap<BodyId, Body>): Body[] => {
  const ids = Array.from(bodies.keys()).sort((a, b) => a - b);
  const out: Body[] = [];
  for (let i = 0; i < ids.length; i += 1) out.push(bodies.get(ids[i]!)!);
  return out;
};

/**
 * Merge a damage instance into a `Map<targetId, Damage[]>`. Each target's
 * bundle is later sorted by `(sourceId, shotIndex)` inside `applyDamageBundle`
 * — the sort is load-bearing (float addition is not associative).
 */
const pushDamage = (
  bundles: Map<BodyId, Damage[]>,
  targetId: BodyId,
  d: Damage,
): void => {
  const bundle = bundles.get(targetId);
  if (bundle === undefined) bundles.set(targetId, [d]);
  else bundle.push(d);
};

/**
 * Compute AoE hits (bodyId → damage) for a blast centered at `center` with
 * `radius` and `centerDamage`, over the given body positions, ownership-blind
 * (FR-23). Iterates ids in ascending order (deterministic). Excludes bodies in
 * `exclude` (the dying body itself, missile self, etc).
 */
const missileAoeHits = (
  center: Vec3,
  radius: number,
  centerDamage: number,
  bodyPositions: ReadonlyMap<BodyId, Vec3>,
  exclude: ReadonlySet<BodyId>,
): { bodyId: BodyId; damage: number }[] => {
  const hits: { bodyId: BodyId; damage: number }[] = [];
  if (radius <= 0 || centerDamage <= 0) return hits;
  const ids = Array.from(bodyPositions.keys()).sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    if (exclude.has(id)) continue;
    const p = bodyPositions.get(id)!;
    const d = distance(center, p);
    if (d >= radius) continue;
    const dmg = aoeFalloff(centerDamage, d, radius);
    if (dmg > 0) hits.push({ bodyId: id, damage: dmg });
  }
  return hits;
};

// ============================================================================
// MOVEMENT BEAT
// ============================================================================

/**
 * Resolve one movement beat: apply plans (caller-supplied for ships + guidance
 * for live missiles), integrate physics, then apply the combat consequences
 * (collision damage, missile detonation AoE, in-arena kill AoE + debris,
 * boundary exits). Returns a NEW `MatchState` + a `MovementBeatRecord`.
 *
 * Engine-dead ships get NO movement plan (FR-18 coast). The caller passes
 * whatever plans it collected; this resolver silently drops plans for ships
 * whose engine is out.
 */
export const runMovementBeat = (
  state: MatchState,
  movementPlans: readonly MovementPlan[],
): MovementBeatOutcome => {
  // ── Stage A — Compose plans ──────────────────────────────────────────────
  // 1. Filter caller plans: drop plans for engine-dead ships (they coast).
  //    Also drop plans for ids we don't own (spurious plans are silently
  //    ignored — the boundary is defensive against a misbehaving Commander).
  const shipPlans: MovementPlan[] = [];
  for (let i = 0; i < movementPlans.length; i += 1) {
    const p = movementPlans[i]!;
    const sc = state.ships.get(p.bodyId);
    if (sc === undefined) continue;
    if (!sc.engineAlive) continue;
    shipPlans.push(p);
  }

  // 2. Guidance plans: missiles alive get steering deltas.
  const missileBodies = new Map<BodyId, MissileBody>();
  for (const [id, b] of state.bodies) {
    if (b.kind === 'missile') missileBodies.set(id, b);
  }
  const targetPosById = new Map<BodyId, Vec3>();
  for (const [id, b] of state.bodies) targetPosById.set(id, b.position);
  const currentGuidances: MissileGuidance[] = [];
  {
    const gIds = Array.from(state.guidances.keys()).sort((a, b) => a - b);
    for (let i = 0; i < gIds.length; i += 1) {
      currentGuidances.push(state.guidances.get(gIds[i]!)!);
    }
  }
  const { plans: missilePlans, nextGuidances } = guideMissiles(
    currentGuidances,
    missileBodies,
    targetPosById,
    state.combat.missiles.reacquireOnTargetLoss,
  );
  const allPlans: MovementPlan[] = [...shipPlans, ...missilePlans];

  // ── Stage B — Physics ────────────────────────────────────────────────────
  const bodiesIn = sortedBodies(state.bodies);
  const stepResult = resolveMovement(bodiesIn, allPlans, state.physics);

  // Build a post-physics bodyById for downstream damage / AoE resolution.
  // `stepResult.finalBodies` is the survivor list (boundary-exited bodies
  // are already removed) — that's the set AoE should apply to.
  const finalById = new Map<BodyId, Body>();
  for (let i = 0; i < stepResult.finalBodies.length; i += 1) {
    const b = stepResult.finalBodies[i]!;
    finalById.set(b.id, b);
  }
  const finalPositions = new Map<BodyId, Vec3>();
  for (const [id, b] of finalById) finalPositions.set(id, b.position);
  const finalVelocities = new Map<BodyId, Vec3>();
  for (const [id, b] of finalById) finalVelocities.set(id, b.velocity);

  // Classify boundary exits: ships become destroyed events (detonates=false —
  // outside the arena, FR-26); hazards get silently removed.
  const boundaryShipExits: BodyId[] = [];
  const boundaryHazardExits: BodyId[] = [];
  for (let i = 0; i < stepResult.exits.length; i += 1) {
    const exit = stepResult.exits[i]!;
    if (exit.kind === 'ship-destroyed') boundaryShipExits.push(exit.bodyId);
    else boundaryHazardExits.push(exit.bodyId);
  }

  // ── Stage C — Contact processing ─────────────────────────────────────────
  // For every physics contact:
  //   • if idA or idB is a ship → apply collision damage to that ship.
  //   • if either is a missile → the missile detonates (if its guidance says
  //     so). Detonation removes it from the field and produces AoE.
  // The detonate-check consults `guidances`; a body without a guidance record
  // (should not happen for a missile body but be defensive) cannot detonate.
  const collisionBundles = new Map<BodyId, Damage[]>();
  const missileDetonations: {
    readonly missileId: BodyId;
    readonly center: Vec3;
    readonly radius: number;
    readonly centerDamage: number;
  }[] = [];
  const detonatedMissiles = new Set<BodyId>();
  // Track collision partners per ship for logging (source attribution below).
  const collisionPartnersByShip = new Map<BodyId, BodyId[]>();

  const isShip = (id: BodyId): boolean => state.ships.has(id);

  for (let i = 0; i < stepResult.contacts.length; i += 1) {
    const c = stepResult.contacts[i]!;

    // Collision damage applied to any ship party — physics computed the
    // magnitude; the source is the OTHER body in the contact.
    if (isShip(c.idA)) {
      pushDamage(collisionBundles, c.idA, {
        sourceId: c.idB,
        // Two contacts in the same sub-step involving the same pair are
        // impossible under the "one contact per body per sub-step" physics
        // rule — but (subStep, idA, idB) is still a stable-unique shotIndex.
        shotIndex: c.subStep,
        amount: c.damage,
        source: 'collision',
      });
      const list = collisionPartnersByShip.get(c.idA) ?? [];
      list.push(c.idB);
      collisionPartnersByShip.set(c.idA, list);
    }
    if (isShip(c.idB)) {
      pushDamage(collisionBundles, c.idB, {
        sourceId: c.idA,
        shotIndex: c.subStep,
        amount: c.damage,
        source: 'collision',
      });
      const list = collisionPartnersByShip.get(c.idB) ?? [];
      list.push(c.idA);
      collisionPartnersByShip.set(c.idB, list);
    }

    // Missile detonation: at most one detonation per missile per beat.
    const maybeDetonate = (missileId: BodyId): void => {
      if (detonatedMissiles.has(missileId)) return;
      const g = state.guidances.get(missileId);
      if (g === undefined) return;
      if (!detonatesOnContact(g, state.combat.missiles.spentRemainsArmed)) return;
      detonatedMissiles.add(missileId);
      // Center is the missile's post-physics position (finalPositions), or
      // if it just exited the arena, its last known position (bodies map).
      const center =
        finalPositions.get(missileId) ??
        state.bodies.get(missileId)?.position ??
        of(0, 0, 0);
      missileDetonations.push({
        missileId,
        center,
        radius: g.aoeRadius,
        centerDamage: g.rackDamage,
      });
    };
    // A missile can be in either slot of the contact pair.
    if (missileBodies.has(c.idA)) maybeDetonate(c.idA);
    if (missileBodies.has(c.idB)) maybeDetonate(c.idB);
  }

  // Missiles that detonated OR exited the arena leave the field this beat.
  const missileRemoved = new Set<BodyId>(detonatedMissiles);
  for (let i = 0; i < boundaryHazardExits.length; i += 1) {
    missileRemoved.add(boundaryHazardExits[i]!); // includes debris too — filter below
  }

  // ── Stage D — Missile AoE ────────────────────────────────────────────────
  // Apply missile-detonation AoE against post-physics positions. Ownership-blind.
  // Damage lands in the same bundle map that collision damage did — one
  // `applyDamageBundle` call per target below handles both.
  for (let i = 0; i < missileDetonations.length; i += 1) {
    const det = missileDetonations[i]!;
    const excl = new Set<BodyId>([det.missileId]);
    const hits = missileAoeHits(det.center, det.radius, det.centerDamage, finalPositions, excl);
    for (let h = 0; h < hits.length; h += 1) {
      const hit = hits[h]!;
      if (!isShip(hit.bodyId)) continue; // missiles/debris don't have hull
      pushDamage(collisionBundles, hit.bodyId, {
        sourceId: det.missileId,
        // Shot index derives from the missile id + hit index for a stable
        // (sourceId, shotIndex) tiebreak inside applyDamageBundle.
        shotIndex: 0x10000 + h,
        amount: hit.damage,
        source: 'missile',
      });
    }
  }

  // ── Stage E — Apply pass-1 damage (collision + missile AoE) ──────────────
  // Iterate targets in ascending id. Build the movement-beat log as we go.
  const combats1 = new Map<BodyId, ShipCombat>();
  const inArenaDeaths: DestructionEvent[] = [];
  const log: CombatLogEntry[] = [];

  const targetIdsSorted = Array.from(collisionBundles.keys()).sort((a, b) => a - b);
  for (let ti = 0; ti < targetIdsSorted.length; ti += 1) {
    const tid = targetIdsSorted[ti]!;
    // Boundary-exited ships have already left; do not damage them further
    // (they get a boundary-exit log entry below instead).
    if (boundaryShipExits.includes(tid)) continue;
    const sc = state.ships.get(tid);
    if (sc === undefined) continue;
    const bundle = collisionBundles.get(tid)!;
    const res = applyDamageBundle(sc, bundle);
    combats1.set(tid, res.after);

    // Log entries — one per Damage in the bundle, ordered by (sourceId, shotIndex).
    const sorted = bundle
      .slice()
      .sort((a, b) => (a.sourceId - b.sourceId) || (a.shotIndex - b.shotIndex));
    // Compute per-entry before/after: applyDamageBundle sums the whole bundle
    // into shields → overflow → hull. We emit one entry per DAMAGE record,
    // sharing the whole-bundle before/after (the S03 approach used by attack.ts).
    for (let bi = 0; bi < sorted.length; bi += 1) {
      const d = sorted[bi]!;
      const killed =
        res.hullAfter <= 0 &&
        res.hullBefore > 0 &&
        bi === sorted.length - 1; // last damage record tags the kill
      if (d.source === 'aoe' || d.source === 'missile') {
        log.push(
          logAoe({
            turn: state.turn,
            sourceId: d.sourceId,
            targetId: tid,
            damage: d.amount,
            shieldBefore: res.shieldBefore,
            shieldAfter: res.shieldAfter,
            hullBefore: res.hullBefore,
            hullAfter: res.hullAfter,
            killed,
          }),
        );
      } else {
        // 'collision' (or defensively any other source in pass 1)
        log.push(
          logCollision({
            turn: state.turn,
            sourceId: d.sourceId,
            targetId: tid,
            damage: d.amount,
            shieldBefore: res.shieldBefore,
            shieldAfter: res.shieldAfter,
            hullBefore: res.hullBefore,
            hullAfter: res.hullAfter,
            killed,
          }),
        );
      }
    }

    if (res.hullAfter <= 0 && res.hullBefore > 0) {
      // Dominant source for the destruction event's cause attribution.
      let dominantSrc: DestructionEvent['cause'] = 'collision';
      let maxAmount = -Infinity;
      for (let bi = 0; bi < bundle.length; bi += 1) {
        const d = bundle[bi]!;
        if (d.amount > maxAmount) {
          maxAmount = d.amount;
          dominantSrc = d.source;
        }
      }
      const finalBody = finalById.get(tid) ?? state.bodies.get(tid)!;
      inArenaDeaths.push({
        bodyId: tid,
        chassisClass: sc.ship.chassisClass,
        position: finalBody.position,
        velocity: finalBody.velocity,
        cause: dominantSrc,
        detonates: true,
      });
    }
  }

  // ── Stage F — Boundary ship exits ────────────────────────────────────────
  // Emit boundary-exit log entries. These deaths carry `detonates=false` —
  // no AoE, no debris (FR-26). They are added to the record's `destroyed`.
  const boundaryDeaths: DestructionEvent[] = [];
  for (let i = 0; i < boundaryShipExits.length; i += 1) {
    const id = boundaryShipExits[i]!;
    const sc = state.ships.get(id);
    if (sc === undefined) continue;
    const lastBody = state.bodies.get(id)!;
    log.push(
      logBoundaryExit({
        turn: state.turn,
        shipId: id,
        hullBefore: sc.hull,
        shieldBefore: sc.shields,
      }),
    );
    boundaryDeaths.push({
      bodyId: id,
      chassisClass: sc.ship.chassisClass,
      position: lastBody.position,
      velocity: lastBody.velocity,
      cause: 'boundary',
      detonates: false,
    });
  }

  // ── Stage G — In-arena death cascade (AoE + debris) ──────────────────────
  // For each ship killed by collision / missile-AoE this beat, run
  // `detonate` to produce its ship-class AoE and `spawnDebris` for hazard
  // shards. Secondary AoE damage is applied to combats2 in a second pass;
  // secondary DEATHS' debris + AoE goes to next beat (single-pass, per
  // session prompt).
  const combats2 = new Map<BodyId, ShipCombat>(combats1); // start from pass-1 results
  const secondaryDeaths: DestructionEvent[] = [];
  const newDebrisDescriptors: {
    readonly ownerId: BodyId;
    readonly position: Vec3;
    readonly velocity: Vec3;
    readonly mass: number;
    readonly radius: number;
  }[] = [];

  // Ownership-blind AoE bundle for pass 2.
  const aoeBundles = new Map<BodyId, Damage[]>();

  // Iterate deaths in ascending id — deterministic (§7.3 rule 1).
  const deathsSorted = inArenaDeaths.slice().sort((a, b) => a.bodyId - b.bodyId);
  for (let di = 0; di < deathsSorted.length; di += 1) {
    const dest = deathsSorted[di]!;
    // Compute AoE positions from finalPositions minus already-dead ships
    // (those are being removed anyway — a dying corpse should not be the
    // "target" of a friend's blast). `detonate` itself excludes the dying
    // body's own id.
    const aoeResult = detonate(dest, finalPositions, state.combat);
    if (aoeResult !== null) {
      const hits = aoeResult.hits;
      for (let hi = 0; hi < hits.length; hi += 1) {
        const hit = hits[hi]!;
        if (!isShip(hit.bodyId)) continue;
        pushDamage(aoeBundles, hit.bodyId, {
          sourceId: dest.bodyId,
          shotIndex: 0x20000 + hi,
          amount: hit.damage,
          source: 'aoe',
        });
      }
    }
    // Debris — pending ids; loop mints below.
    const sc = state.ships.get(dest.bodyId);
    if (sc === undefined) continue;
    const debris = spawnDebris(dest, sc.ship, state.seed, state.turn, state.combat);
    for (let di2 = 0; di2 < debris.length; di2 += 1) {
      const dd = debris[di2]!;
      newDebrisDescriptors.push({
        ownerId: dest.bodyId,
        position: dd.position,
        velocity: dd.velocity,
        mass: dd.mass,
        radius: dd.radius,
      });
    }
  }

  // Apply pass-2 AoE.
  const aoeTargetIds = Array.from(aoeBundles.keys()).sort((a, b) => a - b);
  for (let ti = 0; ti < aoeTargetIds.length; ti += 1) {
    const tid = aoeTargetIds[ti]!;
    const bundle = aoeBundles.get(tid)!;
    const src = combats2.get(tid) ?? state.ships.get(tid);
    if (src === undefined) continue;
    // Skip ships already killed by pass 1 — cascade AoE cannot re-kill a corpse.
    if (src.hull <= 0) {
      // still log the AoE as damage that hit a dying ship? For simplicity:
      // skip. The corpse is already scheduled for removal.
      continue;
    }
    const res = applyDamageBundle(src, bundle);
    combats2.set(tid, res.after);
    const sorted = bundle
      .slice()
      .sort((a, b) => (a.sourceId - b.sourceId) || (a.shotIndex - b.shotIndex));
    for (let bi = 0; bi < sorted.length; bi += 1) {
      const d = sorted[bi]!;
      const killed = res.hullAfter <= 0 && res.hullBefore > 0 && bi === sorted.length - 1;
      log.push(
        logAoe({
          turn: state.turn,
          sourceId: d.sourceId,
          targetId: tid,
          damage: d.amount,
          shieldBefore: res.shieldBefore,
          shieldAfter: res.shieldAfter,
          hullBefore: res.hullBefore,
          hullAfter: res.hullAfter,
          killed,
        }),
      );
    }
    if (res.hullAfter <= 0 && res.hullBefore > 0) {
      const finalBody = finalById.get(tid) ?? state.bodies.get(tid)!;
      secondaryDeaths.push({
        bodyId: tid,
        chassisClass: src.ship.chassisClass,
        position: finalBody.position,
        velocity: finalBody.velocity,
        cause: 'aoe',
        detonates: true, // in-arena, but their debris/AoE goes NEXT beat
      });
    }
  }

  // ── Stage H — Assemble the new body set ──────────────────────────────────
  // Start from physics survivors, remove destroyed ships (in-arena or boundary
  // or secondary), remove detonated missiles, then add newly minted debris.
  const removedBodyIds = new Set<BodyId>();
  for (let i = 0; i < inArenaDeaths.length; i += 1) removedBodyIds.add(inArenaDeaths[i]!.bodyId);
  for (let i = 0; i < boundaryDeaths.length; i += 1) removedBodyIds.add(boundaryDeaths[i]!.bodyId);
  for (let i = 0; i < secondaryDeaths.length; i += 1) removedBodyIds.add(secondaryDeaths[i]!.bodyId);
  for (const mid of detonatedMissiles) removedBodyIds.add(mid);

  let nextBodyId = state.nextBodyId;
  const newDebrisBodies: DebrisBody[] = [];
  const newDebrisIds: BodyId[] = [];
  for (let i = 0; i < newDebrisDescriptors.length; i += 1) {
    const d = newDebrisDescriptors[i]!;
    const id = nextBodyId;
    nextBodyId += 1;
    newDebrisBodies.push({
      kind: 'debris',
      id,
      position: d.position,
      velocity: d.velocity,
      mass: d.mass,
      radius: d.radius,
    });
    newDebrisIds.push(id);
  }

  const bodiesOut = new Map<BodyId, Body>();
  for (let i = 0; i < stepResult.finalBodies.length; i += 1) {
    const b = stepResult.finalBodies[i]!;
    if (removedBodyIds.has(b.id)) continue;
    bodiesOut.set(b.id, b);
  }
  for (let i = 0; i < newDebrisBodies.length; i += 1) {
    const b = newDebrisBodies[i]!;
    bodiesOut.set(b.id, b);
  }

  // ── Stage I — Update ships / fleetOf ─────────────────────────────────────
  const shipsOut = new Map<BodyId, ShipCombat>();
  for (const [id, sc] of state.ships) {
    if (removedBodyIds.has(id)) continue;
    const upd = combats2.get(id) ?? sc;
    shipsOut.set(id, upd);
  }
  const fleetOfOut = new Map<BodyId, number>();
  for (const [id, fid] of state.fleetOf) {
    if (removedBodyIds.has(id)) continue;
    fleetOfOut.set(id, fid);
  }

  // ── Stage J — Guidance + debris age + hazard cap ─────────────────────────
  // nextGuidances came from guideMissiles above; drop any whose bodies are
  // gone (detonated or exited).
  const guidancesOut = new Map<BodyId, MissileGuidance>();
  for (let i = 0; i < nextGuidances.length; i += 1) {
    const g = nextGuidances[i]!;
    if (!bodiesOut.has(g.bodyId)) continue;
    guidancesOut.set(g.bodyId, g);
  }
  // Debris ages: existing survivors → +1 (via tickDebrisLifetime); culled
  // become silent hazard removals in the record.
  const existingAges: DebrisAge[] = [];
  for (const [id, age] of state.debrisAge) {
    if (!bodiesOut.has(id)) continue; // debris that already exited go silently
    existingAges.push({ bodyId: id, age });
  }
  const { survivors, culled } = tickDebrisLifetime(existingAges, state.combat);
  const debrisAgeOut = new Map<BodyId, number>();
  for (let i = 0; i < survivors.length; i += 1) {
    debrisAgeOut.set(survivors[i]!.bodyId, survivors[i]!.age);
  }
  for (let i = 0; i < newDebrisIds.length; i += 1) {
    debrisAgeOut.set(newDebrisIds[i]!, 0);
  }
  // Culled debris leave the field silently — remove their bodies too.
  for (let i = 0; i < culled.length; i += 1) bodiesOut.delete(culled[i]!);

  // Hazard cap enforcement — over all hazards (debris + missiles).
  const hazardEntries: HazardEntry[] = [];
  for (const [id, age] of debrisAgeOut) hazardEntries.push({ bodyId: id, age });
  // Missiles count as hazards for the cap; their age is tracking-based, use 0.
  for (const [id, b] of bodiesOut) {
    if (b.kind === 'missile') hazardEntries.push({ bodyId: id, age: 0 });
  }
  const capResult = enforceHazardCap(hazardEntries, state.combat);
  const droppedByCap = new Set<BodyId>(capResult.droppedIds);
  for (const id of droppedByCap) {
    bodiesOut.delete(id);
    debrisAgeOut.delete(id);
    guidancesOut.delete(id);
  }

  // ── Stage K — Compose record + return state ──────────────────────────────
  // removedHazardIds: everything that left the field silently this beat —
  // boundary hazard exits + culled debris + cap drops. Missile detonations
  // are logged via AoE entries (not "silent"), so NOT included here.
  const removedHazardIdsSet = new Set<BodyId>();
  for (let i = 0; i < boundaryHazardExits.length; i += 1) {
    removedHazardIdsSet.add(boundaryHazardExits[i]!);
  }
  for (let i = 0; i < culled.length; i += 1) removedHazardIdsSet.add(culled[i]!);
  for (const id of droppedByCap) removedHazardIdsSet.add(id);
  const removedHazardIds = Array.from(removedHazardIdsSet).sort((a, b) => a - b);

  const destroyed: DestructionEvent[] = [
    ...inArenaDeaths,
    ...boundaryDeaths,
    ...secondaryDeaths,
  ].sort((a, b) => a.bodyId - b.bodyId);

  const record: MovementBeatRecord = {
    subStepCount: stepResult.subStepCount,
    keyframes: stepResult.keyframes,
    contacts: stepResult.contacts,
    log,
    destroyed,
    removedHazardIds,
  };

  const stateOut: MatchState = {
    seed: state.seed,
    arena: state.arena,
    physics: state.physics,
    combat: state.combat,
    turn: state.turn,
    nextBodyId,
    ships: shipsOut,
    bodies: bodiesOut,
    fleetOf: fleetOfOut,
    guidances: guidancesOut,
    debrisAge: debrisAgeOut,
  };
  return { state: stateOut, record };
};

// ============================================================================
// ATTACK BEAT
// ============================================================================

/**
 * Resolve one attack beat (FR-20 + FR-21 snapshot). Delegates to
 * `rules.resolveAttackBeat` which does the pre-damage snapshot resolution
 * (a shooter destroyed this beat still lands its shots — mutual destruction
 * works). The loop's job here: build the snapshot maps + LaunchEnv, thread the
 * resulting missile launches into `bodies` + `guidances`, and stamp the
 * per-turn shield regen at the turn boundary (called from the coordinator,
 * NOT here — this beat is a pure attack pass).
 *
 * `regenShields` is NOT called here; the coordinator (turnCoordinator.ts)
 * calls it at end-of-turn per Ruling E ("every turn, capped, regardless of
 * damage"). Applying it inside a beat would double-tick if a caller ever
 * split turns differently.
 */
export const runAttackBeat = (
  state: MatchState,
  attackPlans: readonly AttackPlan[],
): AttackBeatOutcome => {
  // Snapshot: pre-damage ShipCombat + post-movement positions/velocities.
  const snapshot = new Map<BodyId, ShipCombat>(state.ships);
  const positions = new Map<BodyId, Vec3>();
  const velocities = new Map<BodyId, Vec3>();
  for (const [id, b] of state.bodies) {
    if (b.kind !== 'ship') continue;
    positions.set(id, b.position);
    velocities.set(id, b.velocity);
  }

  // LaunchEnv wires the loop's id counter to the rules module. Guidance comes
  // back typed `unknown` per the rules boundary — we cast at the loop layer
  // where we know it's a MissileGuidance.
  let nextBodyId = state.nextBodyId;
  const launchEnv: LaunchEnv = {
    nextBodyId: () => {
      const id = nextBodyId;
      nextBodyId += 1;
      return id;
    },
    launch: (input) => {
      const rack = input.shooter.ship.missiles[input.rackIndex];
      if (rack === undefined) return null;
      if (!input.shooter.missileAlive[input.rackIndex]!) return null;
      if (input.shooter.missileAmmo[input.rackIndex]! <= 0) return null;
      // Compute unit direction; delegate to the geometry the rules module
      // uses (identical math to `rules/missiles.ts::launch`, deterministic
      // arithmetic only).
      const dx = input.targetPosition.x - input.shooterPosition.x;
      const dy = input.targetPosition.y - input.shooterPosition.y;
      const dz = input.targetPosition.z - input.shooterPosition.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;
      const nz = dist > 0 ? dz / dist : 0;
      const body: MissileBody = {
        kind: 'missile',
        id: input.bodyId,
        position: input.shooterPosition,
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
        trackingBeatsLeft: state.combat.missiles.trackingBeats,
        rackDamage: rack.damage,
        aoeRadius: rack.aoeRadius,
        trackingTurnRate: rack.trackingTurnRate,
      };
      return { body, guidance };
    },
  };

  const res = resolveAttackBeat(
    snapshot,
    positions,
    velocities,
    attackPlans,
    state.seed,
    state.turn,
    launchEnv,
  );

  // ── Assemble new state ────────────────────────────────────────────────────
  const removedBodyIds = new Set<BodyId>();
  for (let i = 0; i < res.destroyed.length; i += 1) {
    removedBodyIds.add(res.destroyed[i]!.bodyId);
  }
  // AoE cascade from the just-killed ships lands NEXT movement beat (per FR-21
  // "destruction effects enter the battlespace for the NEXT movement beat" —
  // we do NOT recompute a second attack pass here). Debris and secondary
  // kills accrue in the next movement beat.

  const bodiesOut = new Map<BodyId, Body>();
  for (const [id, b] of state.bodies) {
    if (removedBodyIds.has(id)) continue;
    bodiesOut.set(id, b);
  }
  for (let i = 0; i < res.launchedMissiles.length; i += 1) {
    const m = res.launchedMissiles[i]!;
    bodiesOut.set(m.id, m);
  }

  const shipsOut = new Map<BodyId, ShipCombat>();
  for (const [id, sc] of state.ships) {
    if (removedBodyIds.has(id)) continue;
    const updated = res.combats.get(id) ?? sc;
    shipsOut.set(id, updated);
  }
  const fleetOfOut = new Map<BodyId, number>();
  for (const [id, fid] of state.fleetOf) {
    if (removedBodyIds.has(id)) continue;
    fleetOfOut.set(id, fid);
  }

  const guidancesOut = new Map<BodyId, MissileGuidance>(state.guidances);
  for (let i = 0; i < res.launchedGuidance.length; i += 1) {
    const g = res.launchedGuidance[i] as MissileGuidance;
    guidancesOut.set(g.bodyId, g);
  }

  const record: AttackBeatRecord = {
    log: res.log,
    destroyed: res.destroyed,
    launchedMissileIds: res.launchedMissiles.map((m) => m.id),
  };

  const stateOut: MatchState = {
    seed: state.seed,
    arena: state.arena,
    physics: state.physics,
    combat: state.combat,
    turn: state.turn,
    nextBodyId,
    ships: shipsOut,
    bodies: bodiesOut,
    fleetOf: fleetOfOut,
    guidances: guidancesOut,
    debrisAge: state.debrisAge,
  };
  return { state: stateOut, record };
};

/**
 * End-of-turn shield regen (Ruling E). Ticks every ship in the state — the
 * regenShields rules module handles the "gen alive?" and the cap. Also
 * advances the state's `turn` counter by one. Called by the coordinator, not
 * by the pure beat resolvers.
 */
export const applyTurnEnd = (state: MatchState): MatchState => {
  const shipsOut = new Map<BodyId, ShipCombat>();
  for (const [id, sc] of state.ships) {
    shipsOut.set(id, regenShields(sc, state.combat));
  }
  return {
    seed: state.seed,
    arena: state.arena,
    physics: state.physics,
    combat: state.combat,
    turn: state.turn + 1,
    nextBodyId: state.nextBodyId,
    ships: shipsOut,
    bodies: state.bodies,
    fleetOf: state.fleetOf,
    guidances: state.guidances,
    debrisAge: state.debrisAge,
  };
};

// Re-export a couple of physics/rules types the coordinator + tests need
// so callers import from one place (the loop barrel) rather than crossing
// through resolveBeat directly.
export type { StepContact };
// Exports on ShipBody / DebrisBody are for tests that construct expected
// bodies inline — they are re-exported via the barrel too.
export type { ShipBody, DebrisBody, MissileBody, SimShip };
