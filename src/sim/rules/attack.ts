// attack — the whole attack beat, snapshot resolution (M09, FR-20 + FR-21).
//
// The load-bearing rule of this file:
//   "All fire resolves against a pre-damage snapshot; a ship destroyed this beat
//    still lands its shots; damage applies in one pass in ascending BodyId."
//
// Reading the snapshot (not the mutating result) is what makes mutual destruction
// correct: A shoots B and dies; B shoots A and dies. Both resolutions read the same
// pre-beat pools, both fire, both die. If either read the mutating map, the "who
// died first" ordering — which the sim explicitly refuses to have (§7.3 rule 3) —
// would leak into the outcome.
//
// Determinism (architecture §7.2, §7.3):
//   1. `plans` are sorted by `(shooterId, weaponIndex??missileIndex)` before iteration.
//      A shuffled input yields the same shot list, same rolls, same damage bundles.
//   2. Damage is accumulated into `Map<targetId, Damage[]>` — each bundle is later
//      sorted by `(sourceId, shotIndex)` in `applyDamageBundle` before summation
//      (float addition is not associative — the sort is load-bearing).
//   3. Targets are iterated in ascending `BodyId` when applying bundles and when
//      emitting `CombatLogEntry`/`DestructionEvent` — never `Map.keys()` insertion order.
//   4. RNG is counter-based via `rollHit` — same seed + same coords = same roll,
//      regardless of when this beat runs relative to any other beat.
//
// Missiles: `AttackPlan.missileIndex` triggers a `launch()` (delegated to missiles.ts
// via `LaunchEnv`) — the launch is not a hit, it puts a `MissileBody` on the field
// for the NEXT movement beat's guidance + integration. Ammo decrement lands on the
// shooter's post-beat combat state, not on the snapshot.

import { distance, length } from '../mathx/index.js';
import type { Seed, Vec3 } from '../mathx/index.js';
import type {
  AttackPlan,
  BodyId,
  CombatLogEntry,
  DestructionEvent,
  MissileBody,
} from '../types.js';
import { cloneShipCombat, type Damage, type ShipCombat } from './combatState.js';
import { applyDamageBundle, hitChance, rollHit } from './damage.js';
import { calledShotsUnlocked } from './shields.js';
import { resolveCalledShot } from './calledShot.js';

/**
 * The missile subsystem this file needs to know about. A concrete implementation
 * lives in missiles.ts (CP4); attack.ts takes it as an injected env so the two
 * files stay decoupled and testable in isolation. `nextBodyId()` mints ids the
 * loop later reconciles.
 */
export interface LaunchEnv {
  /** Mint the next body id for a spawned missile. */
  nextBodyId: () => BodyId;
  /**
   * Build a `MissileBody` (physics body) + a guidance record (rules-internal side
   * data threaded through the loop). Returns null if the rack has no ammo or is
   * dead — attack.ts logs the launch failure implicitly (no MissileBody emitted).
   */
  launch: (input: {
    shooter: ShipCombat;
    shooterPosition: Vec3;
    shooterVelocity: Vec3;
    rackIndex: number;
    targetId: BodyId;
    targetPosition: Vec3;
    turn: number;
    bodyId: BodyId;
  }) => { body: MissileBody; guidance: unknown } | null;
}

export interface AttackResolution {
  /** Post-application combat state for every ship in `snapshot`, keyed by id. */
  readonly combats: ReadonlyMap<BodyId, ShipCombat>;
  /** Every shot's log entry in canonical order (target-id ascending, then event order). */
  readonly log: readonly CombatLogEntry[];
  /** Ships whose hull dropped to ≤ 0 this beat, in ascending id (FR-21 kill events). */
  readonly destroyed: readonly DestructionEvent[];
  /** Missile bodies to add to the field for the NEXT movement beat. */
  readonly launchedMissiles: readonly MissileBody[];
  /** Guidance records paired with the launched missiles — loop threads these on. */
  readonly launchedGuidance: readonly unknown[];
}

// ---- Internal helpers --------------------------------------------------------------

const planStableKey = (p: AttackPlan): number => {
  // Deterministic sort key: weapon plans use their weaponIndex; missile plans use
  // missileIndex + a bit offset so a shooter's missile launch can't tie with its
  // weapon at the same array position. Non-negative integers keep `-` safe.
  if (p.weaponIndex !== undefined) return p.weaponIndex >>> 0;
  if (p.missileIndex !== undefined) return (p.missileIndex >>> 0) | 0x40000000;
  // Ill-formed plan (neither weapon nor missile); sort last, drop later.
  return 0x7fffffff;
};

const sortPlans = (plans: readonly AttackPlan[]): AttackPlan[] => {
  const out = plans.slice();
  out.sort((a, b) => {
    if (a.shooterId !== b.shooterId) return a.shooterId - b.shooterId;
    if (a.targetId !== b.targetId) return a.targetId - b.targetId;
    return planStableKey(a) - planStableKey(b);
  });
  return out;
};

/**
 * Aggregate target evasion for hit-chance = `baseEvasion + (decoy active ? bonus : 0)`.
 * Uses the FIRST alive decoy — the mock UI treats a decoy as a whole-ship effect, not
 * per-launcher. Multiple decoys fired same turn don't stack (the design keeps decoy a
 * one-shot boost, not an integer counter).
 */
const targetEvasion = (target: ShipCombat, turn: number): number => {
  let evasion = target.ship.baseEvasion;
  if (target.decoyActiveUntilTurn >= turn) {
    for (let i = 0; i < target.decoyAlive.length; i += 1) {
      if (target.decoyAlive[i]!) {
        evasion += target.ship.decoys[i]!.evasionBonus;
        break;
      }
    }
  }
  return evasion;
};

// ---- Attack beat resolver ----------------------------------------------------------

/**
 * Resolve one whole attack beat. Pure — the inputs are never mutated; every returned
 * `ShipCombat` is a fresh clone.
 *
 * The result's `combats` map has an entry for EVERY id present in `snapshot`, even
 * targets no one shot at — the loop wants a complete post-beat state. Ships not in
 * `snapshot` (spawned by the same beat's missiles, say) are not represented; that
 * bookkeeping is the loop's.
 */
export const resolveAttackBeat = (
  snapshot: ReadonlyMap<BodyId, ShipCombat>,
  positions: ReadonlyMap<BodyId, Vec3>,
  velocities: ReadonlyMap<BodyId, Vec3>,
  plans: readonly AttackPlan[],
  seed: Seed,
  turn: number,
  env: LaunchEnv,
): AttackResolution => {
  // A per-shooter post-beat combat clone; ammo decrements + subsystem knockouts land here.
  // Populated lazily so we don't clone every ship for every beat, only the ones that act
  // or get shot at (with the "shot at" pass below).
  const post = new Map<BodyId, ShipCombat>();
  const ensurePost = (id: BodyId): ShipCombat | null => {
    const existing = post.get(id);
    if (existing !== undefined) return existing;
    const src = snapshot.get(id);
    if (src === undefined) return null;
    const clone = cloneShipCombat(src);
    post.set(id, clone);
    return clone;
  };

  const damageBundles = new Map<BodyId, Damage[]>();
  const pushDamage = (targetId: BodyId, d: Damage): void => {
    const bundle = damageBundles.get(targetId);
    if (bundle === undefined) damageBundles.set(targetId, [d]);
    else bundle.push(d);
  };

  // Preliminary event list — the (shieldBefore/hullBefore) fields are set at
  // application time (only then do we know the values). We stash raw shot metadata
  // here and finalize when we apply the bundle to each target.
  interface RawEvent {
    readonly targetId: BodyId;
    readonly sourceId: BodyId;
    readonly source: 'weapon' | 'missile'; // launches log as source='missile' with damage 0
    readonly chance: number;
    readonly roll: number;
    readonly amount: number; // 0 for misses
    readonly hit: boolean;
    readonly calledShotDemoted: boolean;
    readonly calledShot?: AttackPlan['calledShot'];
    readonly shotIndex: number;
  }
  const perTargetEvents = new Map<BodyId, RawEvent[]>();
  const pushEvent = (e: RawEvent): void => {
    const list = perTargetEvents.get(e.targetId);
    if (list === undefined) perTargetEvents.set(e.targetId, [e]);
    else list.push(e);
  };

  const launchedMissiles: MissileBody[] = [];
  const launchedGuidance: unknown[] = [];
  // Missile LAUNCHES are not logged here — a launch puts a body on the field for the
  // next movement beat's guidance + integration. The eventual detonation is what
  // produces a CombatLogEntry (via the movement-beat pathway in the loop).

  // 1 · Iterate plans in deterministic order — read only from the snapshot.
  const orderedPlans = sortPlans(plans);
  for (let pi = 0; pi < orderedPlans.length; pi += 1) {
    const plan = orderedPlans[pi]!;
    const shooter = snapshot.get(plan.shooterId);
    const target = snapshot.get(plan.targetId);
    if (shooter === undefined || target === undefined) continue;
    const shooterPos = positions.get(plan.shooterId);
    const targetPos = positions.get(plan.targetId);
    if (shooterPos === undefined || targetPos === undefined) continue;

    // --- Missile launch --------------------------------------------------------
    if (plan.missileIndex !== undefined) {
      const i = plan.missileIndex;
      if (i < 0 || i >= shooter.ship.missiles.length) continue;
      // Read post-state for ammo/aliveness — a launch requires an alive rack with ammo.
      const shooterPost = ensurePost(plan.shooterId);
      if (shooterPost === null) continue;
      if (!shooterPost.missileAlive[i]!) continue;
      if (shooterPost.missileAmmo[i]! <= 0) continue;
      const shooterVel = velocities.get(plan.shooterId) ?? { x: 0, y: 0, z: 0 };
      const bodyId = env.nextBodyId();
      const launched = env.launch({
        shooter: shooterPost,
        shooterPosition: shooterPos,
        shooterVelocity: shooterVel,
        rackIndex: i,
        targetId: plan.targetId,
        targetPosition: targetPos,
        turn,
        bodyId,
      });
      if (launched === null) continue;
      shooterPost.missileAmmo[i] = shooterPost.missileAmmo[i]! - 1;
      launchedMissiles.push(launched.body);
      launchedGuidance.push(launched.guidance);
      continue;
    }

    // --- Weapon shots ----------------------------------------------------------
    if (plan.weaponIndex === undefined) continue;
    const wi = plan.weaponIndex;
    if (wi < 0 || wi >= shooter.ship.weapons.length) continue;
    // A weapon can't fire if the rules layer previously knocked it out —
    // BUT snapshot is the pre-damage state, so we check the snapshot's flag.
    if (!shooter.weaponAlive[wi]!) continue;
    const weapon = shooter.ship.weapons[wi]!;
    const range = distance(shooterPos, targetPos);
    // Out-of-range assignments contribute nothing (FR-20).
    if (range > weapon.range) continue;

    const targetVel = velocities.get(plan.targetId) ?? { x: 0, y: 0, z: 0 };
    const targetSpeed = length(targetVel);
    const evasion = targetEvasion(target, turn);
    const breakdown = hitChance(weapon, range, targetSpeed, evasion);
    const shots = weapon.shotsPerTurn | 0;

    // A called shot is honoured only against unshielded targets; otherwise the
    // plan is demoted to a plain hull shot (log records the demotion).
    const shieldedAtSnapshot = !calledShotsUnlocked(target);
    const calledShotDemoted = shieldedAtSnapshot && plan.calledShot !== undefined;

    for (let s = 0; s < shots; s += 1) {
      const roll = rollHit(
        breakdown.final,
        seed,
        turn,
        plan.shooterId,
        plan.targetId,
        s,
      );
      if (!roll.hit) {
        pushEvent({
          targetId: plan.targetId,
          sourceId: plan.shooterId,
          source: 'weapon',
          chance: breakdown.final,
          roll: roll.roll,
          amount: 0,
          hit: false,
          calledShotDemoted,
          calledShot: plan.calledShot,
          shotIndex: s,
        });
        continue;
      }
      pushEvent({
        targetId: plan.targetId,
        sourceId: plan.shooterId,
        source: 'weapon',
        chance: breakdown.final,
        roll: roll.roll,
        amount: weapon.damage,
        hit: true,
        calledShotDemoted,
        calledShot: plan.calledShot,
        shotIndex: s,
      });
      // A called shot bypasses the hull; it targets integrity instead. If demoted,
      // the shot behaves as a normal hull hit (falls into the damage bundle below).
      if (plan.calledShot !== undefined && !calledShotDemoted) {
        // Fall through to called-shot pool; do NOT push to the hull bundle.
        continue;
      }
      pushDamage(plan.targetId, {
        sourceId: plan.shooterId,
        shotIndex: s,
        amount: weapon.damage,
        source: 'weapon',
      });
    }
  }

  // 2 · Apply called-shot damage first — this changes subsystem flags but NOT hull.
  //     Iterate a stable order: sorted target ids, then plan iteration order within
  //     that target (which we've already sorted).
  const targetIdsSorted = Array.from(snapshot.keys()).sort((a, b) => a - b);
  const log: CombatLogEntry[] = [];
  const destroyed: DestructionEvent[] = [];

  for (let ti = 0; ti < targetIdsSorted.length; ti += 1) {
    const tid = targetIdsSorted[ti]!;
    const events = perTargetEvents.get(tid);
    if (events === undefined) continue;
    // Called-shot resolution — walk events in emission order (already deterministic).
    for (let ei = 0; ei < events.length; ei += 1) {
      const ev = events[ei]!;
      if (!ev.hit) continue;
      if (ev.calledShot === undefined || ev.calledShotDemoted) continue;
      const cur = ensurePost(tid);
      if (cur === null) continue;
      const cs = resolveCalledShot(cur, ev.calledShot, ev.amount);
      // Overwrite post entry with the called-shot mutation.
      post.set(tid, cs.after);
    }
  }

  // 3 · Apply hull-damage bundles in ascending BodyId — one pass per target.
  for (let ti = 0; ti < targetIdsSorted.length; ti += 1) {
    const tid = targetIdsSorted[ti]!;
    const bundle = damageBundles.get(tid);
    const events = perTargetEvents.get(tid);
    if (events === undefined && bundle === undefined) continue;

    let current = ensurePost(tid)!;
    let shieldBefore = current.shields;
    let shieldAfter = current.shields;
    let hullBefore = current.hull;
    let hullAfter = current.hull;
    if (bundle !== undefined && bundle.length > 0) {
      const result = applyDamageBundle(current, bundle);
      current = result.after;
      shieldBefore = result.shieldBefore;
      shieldAfter = result.shieldAfter;
      hullBefore = result.hullBefore;
      hullAfter = result.hullAfter;
      post.set(tid, current);
    }

    // Emit one CombatLogEntry per event — hits and misses both. Damage recorded is
    // the shot's contribution (weapon.damage for a hit; 0 for a miss). Before/after
    // reflect the target's pools AFTER this whole bundle applied (all events for
    // this target share the same before/after — the log is per-shot, the pools are
    // per-beat; a UI that wants per-shot drainage can reconstruct it from `damage`).
    if (events !== undefined) {
      for (let ei = 0; ei < events.length; ei += 1) {
        const ev = events[ei]!;
        const isCalled = ev.calledShot !== undefined && !ev.calledShotDemoted;
        // Kill event: the SHOT that first crosses hullAfter ≤ 0 is tagged as 'kill'.
        // The simplest correct rule: if the target ends at hullAfter ≤ 0 and the
        // event is the LAST hit in the list, tag 'kill'. This is deterministic
        // because events are in emission order which is derived from sorted plans.
        // A "damaging hit" is a hit that lands in the hull-damage bundle: it's
        // either a plain weapon hit (no called shot) or a called shot demoted
        // because the target was still shielded. Called-shot hits that address
        // integrity do NOT damage hull, so they can't tag a kill.
        const contributesToHull =
          ev.hit && (ev.calledShot === undefined || ev.calledShotDemoted);
        let laterContributes = false;
        for (let li = ei + 1; li < events.length; li += 1) {
          const later = events[li]!;
          if (later.hit && (later.calledShot === undefined || later.calledShotDemoted)) {
            laterContributes = true;
            break;
          }
        }
        const dead = hullAfter <= 0 && contributesToHull && !laterContributes;
        const result: CombatLogEntry['result'] = !ev.hit
          ? 'miss'
          : dead
            ? 'kill'
            : 'hit';
        log.push({
          turn,
          beat: 'attack',
          source: ev.source === 'weapon' ? 'weapon' : 'missile',
          sourceId: ev.sourceId,
          targetId: tid,
          result,
          chance: ev.chance,
          roll: ev.roll,
          damage: isCalled ? 0 : ev.amount, // called-shot hits don't touch hull
          shieldBefore,
          shieldAfter,
          hullBefore,
          hullAfter,
          ...(ev.calledShot !== undefined ? { calledShot: ev.calledShot } : {}),
        });
      }
    }

    if (hullAfter <= 0 && hullBefore > 0) {
      // Determine the dominant damage source from the bundle. If none, fall back to weapon.
      let dominant: DestructionEvent['cause'] = 'weapon';
      if (bundle !== undefined) {
        let maxAmount = -Infinity;
        for (let bi = 0; bi < bundle.length; bi += 1) {
          const d = bundle[bi]!;
          if (d.amount > maxAmount) {
            maxAmount = d.amount;
            dominant = d.source;
          }
        }
      }
      destroyed.push({
        bodyId: tid,
        chassisClass: current.ship.chassisClass,
        position: positions.get(tid) ?? { x: 0, y: 0, z: 0 },
        velocity: velocities.get(tid) ?? { x: 0, y: 0, z: 0 },
        cause: dominant,
        detonates: true, // attack-beat deaths are in-arena (FR-26)
      });
    }
  }

  // 4 · Complete `combats` map: every snapshot ship gets a post entry, cloning
  //     the unchanged ones so callers always receive fresh objects.
  const combats = new Map<BodyId, ShipCombat>();
  for (const id of targetIdsSorted) {
    const p = post.get(id);
    if (p !== undefined) combats.set(id, p);
    else combats.set(id, cloneShipCombat(snapshot.get(id)!));
  }

  return {
    combats,
    log,
    destroyed,
    launchedMissiles,
    launchedGuidance,
  };
};
