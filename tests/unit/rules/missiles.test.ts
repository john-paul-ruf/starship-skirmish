// missiles.test — launch, guidance turn-limit, PD interception (FR-24, tuning.missiles).

import { describe, expect, it } from 'vitest';
import {
  detonatesOnContact,
  guideMissiles,
  interceptMissiles,
  launch,
  STREAM_PD,
  type InterceptCandidate,
  type MissileGuidance,
} from '../../../src/sim/rules/missiles.js';
import { newShipCombat, type ShipCombat } from '../../../src/sim/rules/combatState.js';
import { of, rand01, seedOf } from '../../../src/sim/mathx/index.js';
import type { BodyId, MissileBody, SimShip } from '../../../src/sim/types.js';

const rack = (o: Partial<SimShip['missiles'][number]> = {}) => ({
  ammo: 4,
  damage: 60,
  aoeRadius: 80,
  boostVelocity: 200,
  trackingTurnRate: 30, // deg/beat
  bodyMass: 5,
  bodyRadius: 6,
  ...o,
});

const shipWith = (o: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Test',
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 200,
  shieldCapacity: 100,
  shieldRegenPerTurn: 10,
  deltaVPerTurn: 300,
  baseEvasion: 0,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...o,
});

describe('launch — boost + ammo state', () => {
  it('sets velocity = shooter.velocity + boost * unit(to target)', () => {
    const shooter = newShipCombat(
      shipWith({ missiles: [rack({ boostVelocity: 100 })] }),
      1,
    );
    const r = launch({
      shooter,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(5, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(100, 0, 0),
      turn: 1,
      bodyId: 99,
      trackingBeats: 2,
    })!;
    expect(r.body.velocity).toEqual({ x: 105, y: 0, z: 0 });
    expect(r.body.mass).toBe(5);
    expect(r.body.radius).toBe(6);
    expect(r.guidance.trackingBeatsLeft).toBe(2);
    expect(r.guidance.rackDamage).toBe(60);
  });

  it('launchClearsLauncher absent (default): spawns at shooterPosition (frozen-golden path)', () => {
    const shooter = newShipCombat(
      shipWith({ radius: 20, missiles: [rack({ bodyRadius: 6 })] }),
      1,
    );
    const r = launch({
      shooter,
      shooterPosition: of(100, 200, 300),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(500, 200, 300),
      turn: 1,
      bodyId: 99,
      trackingBeats: 2,
    })!;
    // No offset — spawns exactly on the launcher.
    expect(r.body.position).toEqual({ x: 100, y: 200, z: 300 });
  });

  it('launchClearsLauncher=true: spawns offset by (shooterRadius + missileRadius + ε) along firing bearing', () => {
    const shooter = newShipCombat(
      shipWith({ radius: 20, missiles: [rack({ bodyRadius: 6 })] }),
      1,
    );
    const r = launch({
      shooter,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(100, 0, 0),  // firing along +X
      turn: 1,
      bodyId: 99,
      trackingBeats: 2,
      launchClearsLauncher: true,
    })!;
    // Offset = 20 + 6 + 1e-3 = 26.001 along +X.
    expect(r.body.position.x).toBeCloseTo(26.001, 6);
    expect(r.body.position.y).toBe(0);
    expect(r.body.position.z).toBe(0);
    // Distance from launcher STRICTLY greater than (shooterRadius+bodyRadius)
    // — the physics broadphase will not report an overlap on t=0.
    const d = Math.sqrt(
      r.body.position.x ** 2 + r.body.position.y ** 2 + r.body.position.z ** 2,
    );
    expect(d).toBeGreaterThan(20 + 6);
  });

  it('launchClearsLauncher=true with degenerate zero-length bearing offsets along +X', () => {
    // Zero-length bearing → the fallback +X direction is used for both boost
    // AND the offset, so the missile lands ahead of the launcher on +X.
    const shooter = newShipCombat(
      shipWith({ radius: 20, missiles: [rack({ bodyRadius: 6 })] }),
      1,
    );
    const r = launch({
      shooter,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(0, 0, 0),  // degenerate
      turn: 1,
      bodyId: 99,
      trackingBeats: 2,
      launchClearsLauncher: true,
    })!;
    expect(r.body.position.x).toBeCloseTo(26.001, 6);
    expect(r.body.position.y).toBe(0);
    expect(r.body.position.z).toBe(0);
  });

  it('empty magazine cannot launch (returns null)', () => {
    const s = newShipCombat(shipWith({ missiles: [rack({ ammo: 0 })] }), 1);
    const r = launch({
      shooter: s,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(1, 0, 0),
      turn: 1,
      bodyId: 10,
      trackingBeats: 2,
    });
    expect(r).toBeNull();
  });

  it('dead missile rack cannot launch', () => {
    const s = newShipCombat(shipWith({ missiles: [rack()] }), 1);
    s.missileAlive[0] = false;
    const r = launch({
      shooter: s,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(1, 0, 0),
      turn: 1,
      bodyId: 10,
      trackingBeats: 2,
    });
    expect(r).toBeNull();
  });

  it('degenerate zero-distance boosts along +X (no NaN)', () => {
    const s = newShipCombat(shipWith({ missiles: [rack({ boostVelocity: 50 })] }), 1);
    const r = launch({
      shooter: s,
      shooterPosition: of(0, 0, 0),
      shooterVelocity: of(0, 0, 0),
      rackIndex: 0,
      targetId: 2,
      targetPosition: of(0, 0, 0),
      turn: 1,
      bodyId: 10,
      trackingBeats: 2,
    })!;
    expect(r.body.velocity).toEqual({ x: 50, y: 0, z: 0 });
  });
});

describe('guideMissiles — tracking then fuel-out', () => {
  const mkBody = (id: BodyId, v: { x: number; y: number; z: number }): MissileBody => ({
    kind: 'missile',
    id,
    position: of(0, 0, 0),
    velocity: v,
    mass: 5,
    radius: 6,
  });

  it('re-aims for exactly trackingBeats, then fuels out', () => {
    const g0: MissileGuidance = {
      bodyId: 1,
      targetId: 100,
      trackingBeatsLeft: 2,
      rackDamage: 60,
      aoeRadius: 80,
      trackingTurnRate: 90, // wide enough to snap in one beat
    };
    const bodyById = new Map([[1, mkBody(1, { x: 100, y: 0, z: 0 })]]);
    const targets = new Map([[100, of(0, 100, 0)]]);

    // Beat 1: emits a plan; tracking drops 2 → 1.
    let step = guideMissiles([g0], bodyById, targets, false);
    expect(step.plans).toHaveLength(1);
    expect(step.nextGuidances[0]!.trackingBeatsLeft).toBe(1);

    // Beat 2: still tracking (1 → 0), plan emitted.
    step = guideMissiles(step.nextGuidances, bodyById, targets, false);
    expect(step.plans).toHaveLength(1);
    expect(step.nextGuidances[0]!.trackingBeatsLeft).toBe(0);

    // Beat 3: fuel-out; no plan, guidance retained (stays armed).
    step = guideMissiles(step.nextGuidances, bodyById, targets, false);
    expect(step.plans).toHaveLength(0);
    expect(step.nextGuidances[0]!.trackingBeatsLeft).toBe(0);
  });

  it('target lost + no-reacquire ⇒ no plan, tracking still decrements', () => {
    const g0: MissileGuidance = {
      bodyId: 1,
      targetId: 100,
      trackingBeatsLeft: 2,
      rackDamage: 60,
      aoeRadius: 80,
      trackingTurnRate: 90,
    };
    const bodyById = new Map([[1, mkBody(1, { x: 100, y: 0, z: 0 })]]);
    const emptyTargets = new Map<BodyId, { x: number; y: number; z: number }>();
    const step = guideMissiles([g0], bodyById, emptyTargets, false);
    expect(step.plans).toHaveLength(0);
    expect(step.nextGuidances[0]!.trackingBeatsLeft).toBe(1);
  });

  it('missing body (boundary exit) drops the guidance silently', () => {
    const g0: MissileGuidance = {
      bodyId: 1,
      targetId: 100,
      trackingBeatsLeft: 2,
      rackDamage: 60,
      aoeRadius: 80,
      trackingTurnRate: 90,
    };
    const step = guideMissiles(
      [g0],
      new Map(),
      new Map([[100, of(0, 0, 0)]]),
      false,
    );
    expect(step.plans).toHaveLength(0);
    expect(step.nextGuidances).toHaveLength(0);
  });

  it('deltaV preserves speed (turn-rate limits direction only)', () => {
    // 45° desired turn but only 30° allowed per beat → partial turn.
    const g0: MissileGuidance = {
      bodyId: 1,
      targetId: 100,
      trackingBeatsLeft: 5,
      rackDamage: 60,
      aoeRadius: 80,
      trackingTurnRate: 30,
    };
    const bodyById = new Map([[1, mkBody(1, { x: 100, y: 0, z: 0 })]]); // moving +X at 100
    const targets = new Map([[100, of(0, 100, 0)]]); // aim NW (from origin toward +Y)
    const step = guideMissiles([g0], bodyById, targets, false);
    const plan = step.plans[0]!;
    // New velocity = old velocity + deltaV
    const newV = {
      x: 100 + plan.deltaV.x,
      y: 0 + plan.deltaV.y,
      z: 0 + plan.deltaV.z,
    };
    const speed = Math.sqrt(newV.x * newV.x + newV.y * newV.y + newV.z * newV.z);
    expect(speed).toBeCloseTo(100, 6);
  });
});

describe('detonatesOnContact — spent-armed missile still detonates', () => {
  const g = (beats: number): MissileGuidance => ({
    bodyId: 1, targetId: 2, trackingBeatsLeft: beats,
    rackDamage: 60, aoeRadius: 80, trackingTurnRate: 30,
  });
  it('live missile detonates on contact', () => {
    expect(detonatesOnContact(g(2), true)).toBe(true);
  });
  it('spent missile detonates when spentRemainsArmed=true', () => {
    expect(detonatesOnContact(g(0), true)).toBe(true);
  });
  it('spent missile does NOT detonate when spentRemainsArmed=false (config override)', () => {
    expect(detonatesOnContact(g(0), false)).toBe(false);
  });
});

describe('interceptMissiles — order-independent, seed-reproducible', () => {
  const defenderShip = shipWith({
    pointDefense: [
      { interceptRange: 200, interceptChance: 0.6, interceptsPerTurn: 2 },
    ],
  });

  const defender = (): ShipCombat => newShipCombat(defenderShip, 10);

  const makeCandidate = (missileId: number, dist: number): InterceptCandidate => ({
    defenderId: 10,
    defenderPosition: of(0, 0, 0),
    pdIndex: 0,
    missileId,
    missilePosition: of(dist, 0, 0),
  });

  it('rolls with STREAM_PD and distinct shot indices per PD/turn', () => {
    const seed = seedOf(1, 2);
    const cands = [makeCandidate(50, 100), makeCandidate(51, 100)];
    const defenders = new Map([[10, defender()]]);
    const r = interceptMissiles(defenders, cands, seed, 3);
    // Predict outcome — each shot rolls (seed, turn=3, STREAM_PD, defId, pdIdx, missileId, shotIdx).
    const r0 = rand01(seed, 3, STREAM_PD, 10, 0, 50, 0);
    const r1 = rand01(seed, 3, STREAM_PD, 10, 0, 51, 1);
    const expected: number[] = [];
    if (r0 < 0.6) expected.push(50);
    if (r1 < 0.6) expected.push(51);
    expected.sort((a, b) => a - b);
    expect(r.intercepted).toEqual(expected);
  });

  it('permuting the candidate list yields the same intercepted set', () => {
    const seed = seedOf(0xabc, 0xdef);
    const c1 = makeCandidate(50, 80);
    const c2 = makeCandidate(51, 90);
    const defenders = new Map([[10, defender()]]);
    const a = interceptMissiles(defenders, [c1, c2], seed, 4).intercepted;
    const b = interceptMissiles(defenders, [c2, c1], seed, 4).intercepted;
    expect(b).toEqual(a);
  });

  it('range gate filters candidates past interceptRange', () => {
    const seed = seedOf(1, 2);
    const cands = [makeCandidate(50, 500)]; // range 200, dist 500
    const defenders = new Map([[10, defender()]]);
    const r = interceptMissiles(defenders, cands, seed, 3);
    expect(r.intercepted).toEqual([]);
  });

  it('respects interceptsPerTurn budget (3 candidates, budget 2)', () => {
    const seed = seedOf(1, 2);
    const cands = [
      makeCandidate(50, 100),
      makeCandidate(51, 100),
      makeCandidate(52, 100),
    ];
    // With chance = 1.0 we'd see 2 intercepted max; use chance 1.0 to force it.
    const forced = shipWith({
      pointDefense: [
        { interceptRange: 200, interceptChance: 1, interceptsPerTurn: 2 },
      ],
    });
    const d = new Map([[10, newShipCombat(forced, 10)]]);
    const r = interceptMissiles(d, cands, seed, 3);
    expect(r.intercepted).toHaveLength(2);
    // The budget picks the first two by (defender, pdIndex, missileId) ordering.
    expect(r.intercepted).toEqual([50, 51]);
  });

  it('dead PD cannot intercept', () => {
    const seed = seedOf(1, 2);
    const cands = [makeCandidate(50, 100)];
    const forced = shipWith({
      pointDefense: [
        { interceptRange: 200, interceptChance: 1, interceptsPerTurn: 2 },
      ],
    });
    const d = newShipCombat(forced, 10);
    d.pdAlive[0] = false;
    const defenders = new Map([[10, d]]);
    const r = interceptMissiles(defenders, cands, seed, 3);
    expect(r.intercepted).toEqual([]);
  });
});
