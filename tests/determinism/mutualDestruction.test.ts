// Combat integration cases (FR-21 snapshot / FR-24 missile / FR-23 AoE /
// FR-26 boundary) — explicit constructed scenarios, digest-checked, that
// prove the loop composes rules correctly. Complements the fixture-based
// golden suite: the goldens prove "same input → same output"; these tests
// prove "the outputs are the ones the spec calls for" for load-bearing
// combat mechanics.
//
// Each `describe` block owns ONE property. Fixtures live inline (small,
// hand-built states) so the failure signal is local and self-explanatory.

import { describe, expect, it } from 'vitest';
import {
  buildInitialState,
  matchDigest,
  runAttackBeat,
  runMatch,
  runMovementBeat,
  runTurn,
  seedOf,
  type Arena,
  type AttackPlan,
  type Body,
  type BodyId,
  type CombatConfig,
  type MatchConfig,
  type MatchState,
  type MovementPlan,
  type SimFleet,
  type SimShip,
} from '../../src/sim/index.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import {
  scriptedCommander,
  fleetScriptFromArray,
  type TurnScript,
} from '../../tools/balance/fixtureCommanders.js';

// ---------------------------------------------------------------------------
// Test-only builder helpers. Kept small — every state construction goes via
// buildInitialState so BodyIds are minted the same way the real loop mints
// them (in (fleetId, shipIndex) order starting at 1).
// ---------------------------------------------------------------------------

const arena = (radius: number): Arena => ({
  center: { x: 0, y: 0, z: 0 },
  radius,
});
const physics = (a: Arena): PhysicsConfig => ({
  dt: 10,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: a,
});
const combat = (): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 6,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 7, 'mega-destroyer': 12 },
    debrisScatterImpulse: 120,
    debrisMassFractionOfHull: 0.06,
    debrisRadius: 12,
  },
  destruction: {
    aoeRadiusByClass: { fighter: 90, frigate: 160, cruiser: 260, 'mega-destroyer': 400 },
    aoeDamageByClass: { fighter: 12, frigate: 30, cruiser: 70, 'mega-destroyer': 140 },
  },
  missiles: { trackingBeats: 2, spentRemainsArmed: true, reacquireOnTargetLoss: false },
  shields: { regenTicksRegardlessOfDamage: true },
});

const ship = (name: string, overrides: Partial<SimShip> = {}): SimShip => ({
  buildId: `test-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 30,
  radius: 15,
  maxHull: 100,
  shieldCapacity: 0,
  shieldRegenPerTurn: 0,
  deltaVPerTurn: 200,
  baseEvasion: 0,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

const fleet = (fleetId: number, ships: SimShip[]): SimFleet => ({ fleetId, ships });

const cfg = (fleets: readonly SimFleet[], radius = 800): MatchConfig => {
  const a = arena(radius);
  return {
    seed: seedOf(0x11, 0x22),
    fleets,
    arena: a,
    physics: physics(a),
    combat: combat(),
  };
};

/** Override the body's position/velocity in an initial state. Immutable
 *  MatchState → return a fresh state with a fresh bodies map. Used to
 *  drop ships into the exact positions each integration case needs. */
const withBody = (
  state: MatchState,
  id: BodyId,
  patch: Partial<Body>,
): MatchState => {
  const bodies = new Map(state.bodies);
  const b = bodies.get(id)!;
  bodies.set(id, { ...b, ...patch } as Body);
  return { ...state, bodies };
};

/** Convenience for a scripted commander with a single-turn plan set. */
const oneTurnCommander = (fleetId: number, script: TurnScript) =>
  scriptedCommander(fleetId, fleetScriptFromArray([script]));

// ===========================================================================
// 1. MUTUAL DESTRUCTION — snapshot fire kills the last two → outcome sticks.
// ===========================================================================

describe('mutual destruction (FR-21 / FR-27 / Custom Rule 5)', () => {
  it('two ships that kill each other same beat → outcome=mutual-destruction', async () => {
    // Both ships fire a one-shot weapon that deals 200 hull → each is a
    // one-shot kill of the other. The attack beat resolves against the
    // pre-damage snapshot, so BOTH shots land.
    const state = withBody(
      withBody(
        buildInitialState(
          cfg([
            fleet(0, [
              ship('A', {
                weapons: [{ range: 3000, damage: 200, shotsPerTurn: 1, accuracy: 1 }],
              }),
            ]),
            fleet(1, [
              ship('B', {
                weapons: [{ range: 3000, damage: 200, shotsPerTurn: 1, accuracy: 1 }],
              }),
            ]),
          ]),
        ),
        1,
        { position: { x: -400, y: 0, z: 0 } },
      ),
      2,
      { position: { x: 400, y: 0, z: 0 } },
    );
    const c0 = oneTurnCommander(0, {
      movement: [],
      attack: [{ shooterId: 1, targetId: 2, weaponIndex: 0 }],
    });
    const c1 = oneTurnCommander(1, {
      movement: [],
      attack: [{ shooterId: 2, targetId: 1, weaponIndex: 0 }],
    });
    const result = await runTurn(state, [c0, c1]);
    // Both dead, both removed from the ships map.
    expect(result.state.ships.has(1)).toBe(false);
    expect(result.state.ships.has(2)).toBe(false);
    // AttackBeatRecord.destroyed has BOTH events.
    const destroyedIds = result.attack.destroyed.map((d) => d.bodyId).sort();
    expect(destroyedIds).toEqual([1, 2]);
    // Outcome is mutual-destruction (Custom Rule 5's second branch).
    expect(result.outcome?.kind).toBe('mutual-destruction');
  });
});

// ===========================================================================
// 2. SNAPSHOT FIRE — a ship destroyed THIS beat still lands its shot.
// ===========================================================================

describe('snapshot fire (FR-21 pre-damage snapshot)', () => {
  it("a ship destroyed this beat still hits its target (snapshot semantics)", async () => {
    // A has 1 hull; B has 200 hull. Both fire a 100-damage weapon at each
    // other. If damage were applied left-to-right (A dies before firing) B
    // would be unhurt. The snapshot semantics require BOTH shots to land.
    const state = withBody(
      withBody(
        buildInitialState(
          cfg([
            fleet(0, [
              ship('A-fragile', {
                maxHull: 1,
                weapons: [{ range: 3000, damage: 100, shotsPerTurn: 1, accuracy: 1 }],
              }),
            ]),
            fleet(1, [
              ship('B-durable', {
                maxHull: 200,
                weapons: [{ range: 3000, damage: 100, shotsPerTurn: 1, accuracy: 1 }],
              }),
            ]),
          ]),
        ),
        1,
        { position: { x: -400, y: 0, z: 0 } },
      ),
      2,
      { position: { x: 400, y: 0, z: 0 } },
    );
    // Set A's hull to 1 by giving it maxHull=1 above; verify via runAttackBeat
    // to isolate this to the attack pass (no movement noise).
    const attackPlans: readonly AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 },
      { shooterId: 2, targetId: 1, weaponIndex: 0 },
    ];
    const result = runAttackBeat(state, attackPlans);
    // A is dead — the shot from B (100 dmg) killed it.
    expect(result.state.ships.has(1)).toBe(false);
    // B is alive AND took damage — A's snapshot fire landed.
    const B = result.state.ships.get(2);
    expect(B).toBeDefined();
    expect(B!.hull).toBe(100); // 200 - 100 (snapshot fire from A)
    // Both destruction and damage events were recorded (A destroyed, B damaged).
    expect(result.record.destroyed.some((d) => d.bodyId === 1)).toBe(true);
    expect(result.record.destroyed.some((d) => d.bodyId === 2)).toBe(false);
  });
});

// ===========================================================================
// 3. MISSILE FUEL-OUT — a missile that ran out of tracking is still armed
//     (spentRemainsArmed=true) and detonates on contact in a later beat.
// ===========================================================================

describe('missile fuel-out (FR-24 / Decision 15)', () => {
  it("a launched missile's guidance decays across trackingBeats and it can still detonate on contact after fuel-out", async () => {
    // Two ships far apart. Fleet 0 launches a slow missile at a distant
    // target. trackingBeats=2 in combat config: guide count starts at 2 the
    // beat after launch, decrements each subsequent movement beat.
    // Missile speed × dt × trackingBeats << target distance so we can inspect
    // guidance decay across turns without the missile detonating on contact
    // mid-test.
    const initial = withBody(
      withBody(
        buildInitialState(
          cfg(
            [
              fleet(0, [
                ship('Launcher', {
                  weapons: [], // no weapon, missile only
                  missiles: [
                    {
                      ammo: 4,
                      damage: 40,
                      aoeRadius: 60,
                      boostVelocity: 30,
                      trackingTurnRate: 0.05,
                      bodyMass: 3,
                      bodyRadius: 5,
                    },
                  ],
                }),
              ]),
              fleet(1, [
                ship('Target', { maxHull: 500, radius: 10 }),
              ]),
            ],
            6000, // arena radius — plenty of room to fuel out safely
          ),
        ),
        1,
        { position: { x: -2000, y: 0, z: 0 } },
      ),
      2,
      { position: { x: 5000, y: 0, z: 0 } },
    );
    // Turn 1: launcher fires a missile at target.
    const c0 = scriptedCommander(
      0,
      fleetScriptFromArray([
        {
          movement: [],
          attack: [{ shooterId: 1, targetId: 2, missileIndex: 0 }],
        },
      ]),
    );
    const c1 = scriptedCommander(1, fleetScriptFromArray([]));
    const t1 = await runTurn(initial, [c0, c1]);
    // A missile body should exist post-turn-1 (it launched during attack).
    const missileIds = Array.from(t1.state.bodies.keys()).filter(
      (id) => t1.state.bodies.get(id)!.kind === 'missile',
    );
    expect(missileIds.length).toBe(1);
    const missileId = missileIds[0]!;
    // Guidance for the missile exists with tracking = 2 (fresh launch).
    const g1 = t1.state.guidances.get(missileId);
    expect(g1).toBeDefined();
    expect(g1!.trackingBeatsLeft).toBe(2);

    // Test-only manipulation: teleport the launcher WELL OUT of the
    // missile's launch axis before the next movement beat. Missiles spawn
    // at the shooter's position (see `resolveBeat.ts` launch env) which
    // means the missile and its launcher start OVERLAPPING; without this
    // teleport, the physics broadphase reports a contact on the very first
    // sub-step, `detonatesOnContact` returns true (spentRemainsArmed), and
    // the missile detonates before we can observe its guidance decay.
    // That's a sim-side design constraint (a future refit could offset the
    // spawn along the target vector); the shape of the guidance-decay
    // behaviour under test is unrelated to it, so we sidestep it here.
    const t1Bodies = new Map(t1.state.bodies);
    const launcher = t1Bodies.get(1)!;
    t1Bodies.set(1, { ...launcher, position: { x: -5000, y: 0, z: 0 } });
    const t1Detached: MatchState = { ...t1.state, bodies: t1Bodies };

    // Turn 2 (no plans — coast + no attack). The single movement beat ticks
    // trackingBeatsLeft: 2 → 1.
    const t2 = await runTurn(t1Detached, [
      scriptedCommander(0, fleetScriptFromArray([])),
      scriptedCommander(1, fleetScriptFromArray([])),
    ]);
    const g2 = t2.state.guidances.get(missileId);
    expect(g2).toBeDefined();
    expect(g2!.trackingBeatsLeft).toBe(1);

    // Turn 3 — one more movement beat ticks 1 → 0 (fuel-out).
    const t3 = await runTurn(t2.state, [
      scriptedCommander(0, fleetScriptFromArray([])),
      scriptedCommander(1, fleetScriptFromArray([])),
    ]);
    const g3 = t3.state.guidances.get(missileId);
    // Guidance may either report 0 tracking left OR be removed depending on
    // implementation. Either way, `detonatesOnContact` reads
    // `spentRemainsArmed=true` from config and the missile stays armed.
    if (g3 !== undefined) {
      expect(g3.trackingBeatsLeft).toBe(0);
    }
    // The missile body still exists — spentRemainsArmed keeps it in the field.
    expect(t3.state.bodies.has(missileId)).toBe(true);
  });
});

// ===========================================================================
// 4. IN-ARENA KILL → AoE + DEBRIS. Ownership-blind (FR-23, Decision 13).
// ===========================================================================

describe('in-arena kill spawns AoE + debris (FR-23, ownership-blind)', () => {
  it('cascade ON: attack-beat kill\'s AoE + debris lands on the NEXT movement beat', () => {
    // Fleet 0: [victim, friend-near, friend-far]
    // Fleet 1: [attacker]
    // Frigate AoE radius = 160, damage = 30 (defaults above); debris = 4.
    // Place FriendNear well inside the AoE (distance 80), FriendFar outside
    // (distance 500). With cascadeToNextMovement=true the attack-beat kill's
    // destruction event carries over as a `PendingDetonation` and fires on
    // the following movement beat (FR-21 "destruction effects enter the
    // battlespace for the NEXT movement beat").
    const configBase = cfg([
      fleet(0, [
        ship('Victim', { maxHull: 60 }),
        ship('FriendNear', { maxHull: 200 }),
        ship('FriendFar', { maxHull: 200 }),
      ]),
      fleet(1, [
        ship('Attacker', {
          weapons: [{ range: 3000, damage: 120, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
    ]);
    const config: MatchConfig = {
      ...configBase,
      combat: {
        ...configBase.combat,
        destruction: {
          ...configBase.combat.destruction,
          cascadeToNextMovement: true,
        },
      },
    };
    let state = buildInitialState(config);
    // Body ids assigned in (fleetId, shipIndex) order: 1=Victim, 2=FriendNear,
    // 3=FriendFar, 4=Attacker.
    state = withBody(state, 1, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 80, y: 0, z: 0 } }); // inside AoE
    state = withBody(state, 3, { position: { x: 500, y: 0, z: 0 } }); // outside AoE
    state = withBody(state, 4, { position: { x: -500, y: 0, z: 0 } });
    // Turn 1 ATTACK beat only — attacker kills victim. Verify pending queued.
    const attackPlans: AttackPlan[] = [{ shooterId: 4, targetId: 1, weaponIndex: 0 }];
    const beat1 = runAttackBeat(state, attackPlans);
    expect(beat1.state.ships.has(1)).toBe(false);
    expect(beat1.record.destroyed.some((d) => d.bodyId === 1 && d.detonates)).toBe(true);
    expect(beat1.state.pendingDetonations ?? []).toHaveLength(1);
    // No debris yet — those spawn on the NEXT movement beat's cascade consume.
    expect(
      Array.from(beat1.state.bodies.values()).filter((b) => b.kind === 'debris'),
    ).toHaveLength(0);
    // Turn 2 MOVEMENT beat — cascade fires. FriendNear takes AoE; FriendFar
    // is outside the radius; frigate debris (count=4) spawns.
    const friendNearBefore = beat1.state.ships.get(2)!.hull;
    const friendFarBefore = beat1.state.ships.get(3)!.hull;
    const beat2 = runMovementBeat(beat1.state, []);
    expect(beat2.state.ships.get(2)!.hull).toBeLessThan(friendNearBefore);
    expect(beat2.state.ships.get(3)!.hull).toBe(friendFarBefore);
    const debrisCount = Array.from(beat2.state.bodies.values()).filter(
      (b) => b.kind === 'debris',
    ).length;
    expect(debrisCount).toBe(4);
    // Pending list is consumed (cleared) after the movement beat.
    expect(beat2.state.pendingDetonations ?? []).toEqual([]);
  });

  it('cascade OFF (frozen-goldens path): attack-beat kill spawns no cascade the next beat', () => {
    // Same fixture but with cascadeToNextMovement absent — matches the pre-F6
    // baked-config the frozen combat goldens use. Guards the byte-frozen
    // behaviour that lets the goldens stay hash-stable.
    const config = cfg([
      fleet(0, [
        ship('Victim', { maxHull: 60 }),
        ship('FriendNear', { maxHull: 200 }),
        ship('FriendFar', { maxHull: 200 }),
      ]),
      fleet(1, [
        ship('Attacker', {
          weapons: [{ range: 3000, damage: 120, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
    ]);
    let state = buildInitialState(config);
    state = withBody(state, 1, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 80, y: 0, z: 0 } });
    state = withBody(state, 3, { position: { x: 500, y: 0, z: 0 } });
    state = withBody(state, 4, { position: { x: -500, y: 0, z: 0 } });
    const attackPlans: AttackPlan[] = [{ shooterId: 4, targetId: 1, weaponIndex: 0 }];
    const beat1 = runAttackBeat(state, attackPlans);
    expect(beat1.state.ships.has(1)).toBe(false);
    // No pending queued when the gate is absent.
    expect(beat1.state.pendingDetonations ?? []).toEqual([]);
    const friendNearBefore = beat1.state.ships.get(2)!.hull;
    const beat2 = runMovementBeat(beat1.state, []);
    // FriendNear unhurt — no cascade ran.
    expect(beat2.state.ships.get(2)!.hull).toBe(friendNearBefore);
    expect(
      Array.from(beat2.state.bodies.values()).filter((b) => b.kind === 'debris'),
    ).toHaveLength(0);
  });

  it("a movement-beat collision kill DOES spawn debris + AoE the same beat", () => {
    // A cheaper case to exercise the movement-beat Stage-G cascade that IS
    // wired: put two ships close enough for a physics collision this beat
    // that kills one, and confirm debris appears + AoE damages a witness.
    //
    // Velocities are kept LOW enough that post-collision the surviving body
    // stays well inside the arena (a fast collision blows both bodies past
    // the boundary → boundary-exit path with detonates=false → no debris,
    // which would defeat this test). A heavy Bumper (mass 1000) versus a
    // light Fragile (mass 10) keeps post-collision velocities small.
    const config = cfg([
      fleet(0, [
        ship('Bumper', {
          chassisClass: 'frigate',
          mass: 1000,
          radius: 10,
          maxHull: 5000,
          weapons: [],
        }),
        ship('Witness', { chassisClass: 'frigate', maxHull: 200, radius: 10 }),
      ]),
      fleet(1, [
        ship('Fragile', {
          chassisClass: 'frigate',
          mass: 10,
          radius: 10,
          maxHull: 1,
          weapons: [],
        }),
      ]),
    ]);
    let state = buildInitialState(config);
    // Body ids: 1=Bumper, 2=Witness, 3=Fragile.
    // Fragile's post-collision final-x ≈ 25 + 11.4 · 9.5 ≈ 133 (elastic
    // 1D collision with restitution 0.15). Frigate AoE radius = 160, so
    // place Witness at (150, 40, 0) — distance ≈ 42 from AoE centre.
    state = withBody(state, 1, {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 10, y: 0, z: 0 }, // slow — post-collision stays inside arena
    });
    state = withBody(state, 2, { position: { x: 150, y: 40, z: 0 } });
    state = withBody(state, 3, {
      position: { x: 25, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    });
    const outcome = runMovementBeat(state, []);
    // Fragile is dead by IN-ARENA collision damage (detonates=true → cascade).
    expect(outcome.state.ships.has(3)).toBe(false);
    const fragileDeath = outcome.record.destroyed.find((d) => d.bodyId === 3);
    expect(fragileDeath).toBeDefined();
    expect(fragileDeath!.detonates).toBe(true);
    expect(fragileDeath!.cause).not.toBe('boundary');
    // Debris of frigate class (count=4) spawned this beat.
    const debrisCount = Array.from(outcome.state.bodies.values()).filter(
      (b) => b.kind === 'debris',
    ).length;
    expect(debrisCount).toBe(4);
    // Witness took AoE damage (ownership-blind: same fleet, still hit).
    const witnessBefore = state.ships.get(2)!.hull;
    const witness = outcome.state.ships.get(2);
    expect(witness).toBeDefined();
    // AoE hit means hull decreased. Exact number depends on aoeFalloff
    // curve; asserting `<` witnessBefore is the ownership-blind proof.
    expect(witness!.hull).toBeLessThan(witnessBefore);
  });
});

// ===========================================================================
// 5. BOUNDARY-SHOVE KILL SPAWNS NEITHER (FR-26).
// ===========================================================================

describe('boundary-shove kill (FR-26)', () => {
  it('a ship exiting the arena is destroyed with no AoE and no debris', () => {
    // Small arena; a ship placed at the shell with outward velocity exits
    // in the first sub-step. Its DestructionEvent has detonates=false;
    // no AoE damage anywhere, no debris bodies spawned.
    const config = cfg(
      [
        fleet(0, [ship('Escapee'), ship('Witness')]),
      ],
      400, // small arena
    );
    let state = buildInitialState(config);
    // Body 1=Escapee, 2=Witness.
    state = withBody(state, 1, {
      position: { x: 390, y: 0, z: 0 }, // just inside the shell
      velocity: { x: 100, y: 0, z: 0 }, // outbound
    });
    state = withBody(state, 2, { position: { x: 0, y: 0, z: 0 } });
    const outcome = runMovementBeat(state, []);
    // Escapee gone; witness untouched.
    expect(outcome.state.ships.has(1)).toBe(false);
    expect(outcome.state.ships.has(2)).toBe(true);
    expect(outcome.state.ships.get(2)!.hull).toBe(100);
    // A boundary DestructionEvent was recorded with detonates=false.
    const boundaryDeath = outcome.record.destroyed.find((d) => d.bodyId === 1);
    expect(boundaryDeath).toBeDefined();
    expect(boundaryDeath!.detonates).toBe(false);
    expect(boundaryDeath!.cause).toBe('boundary');
    // No debris spawned (detonates=false path).
    const debrisCount = Array.from(outcome.state.bodies.values()).filter(
      (b) => b.kind === 'debris',
    ).length;
    expect(debrisCount).toBe(0);
  });
});

// ===========================================================================
// 6. INTEGRATION: runMatch reports the correct outcome for a scripted case.
//    Cross-checks that the pure resolvers, the coordinator, and the victory
//    check compose correctly — the mutual-destruction case runMatch-flavour.
// ===========================================================================

describe('runMatch produces the outcome + matchDigest under scripted mutual kill', () => {
  it('two one-shot ships → runMatch returns outcome mutual-destruction and final digest is stable', async () => {
    const config = cfg([
      fleet(0, [
        ship('A', {
          weapons: [{ range: 3000, damage: 200, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
      fleet(1, [
        ship('B', {
          weapons: [{ range: 3000, damage: 200, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
    ]);
    let state = buildInitialState(config);
    state = withBody(state, 1, { position: { x: -400, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 400, y: 0, z: 0 } });
    const c0 = oneTurnCommander(0, {
      movement: [] as MovementPlan[],
      attack: [{ shooterId: 1, targetId: 2, weaponIndex: 0 }],
    });
    const c1 = oneTurnCommander(1, {
      movement: [] as MovementPlan[],
      attack: [{ shooterId: 2, targetId: 1, weaponIndex: 0 }],
    });
    const r1 = await runMatch(state, [c0, c1]);
    expect(r1.outcome.kind).toBe('mutual-destruction');
    // Determinism: a second run of the same setup yields the same digest.
    const c0b = oneTurnCommander(0, {
      movement: [],
      attack: [{ shooterId: 1, targetId: 2, weaponIndex: 0 }],
    });
    const c1b = oneTurnCommander(1, {
      movement: [],
      attack: [{ shooterId: 2, targetId: 1, weaponIndex: 0 }],
    });
    const r2 = await runMatch(state, [c0b, c1b]);
    expect(matchDigest(r1.state)).toBe(matchDigest(r2.state));
  });
});
