// attackPlanner — deterministic per-turn attack assignment (M12, S04).
//
// Locks the CP1/CP2 invariants at unit scope:
//   (CP1) target selection per `TIER_CONFIG.targeting`; one AttackPlan per
//         alive weapon and per alive missile rack with ammo; empty output
//         when no live enemy / no live weapons+missiles exist.
//   (CP2) FR-25 called-shot ladder gated by tier.enableCalledShots — shielded
//         target → no calledShot; zero-shield + shieldGenAlive → shield-
//         generator; generator down → engine; both down → highest-damage
//         live weapon. FR-29 ace AoE friendly-fire skip on missile assignment.
//
// Fixtures replicate the minimal-view pattern movementPlanner.test.ts uses
// (in-file — the shared-helper hoist to tests/support/blindView.ts is a
// Forge follow-up outside this session's lease).

import { describe, expect, it } from 'vitest';
import { of } from '../../../src/sim/mathx/index.js';
import type { Vec3 } from '../../../src/sim/mathx/index.js';
import type {
  Body,
  BodyId,
  ChassisClass,
  CombatConfig,
  SimShip,
} from '../../../src/sim/types.js';
import type {
  BlindMatchView,
  BlindShipView,
} from '../../../src/sim/loop/blindView.js';
import { TIER_CONFIG } from '../../../src/ai/tiers.js';
import { planFleetAttack } from '../../../src/ai/attackPlanner.js';

// ---------------------------------------------------------------------------
// Fixture builders — same shape as movementPlanner.test.ts.
// ---------------------------------------------------------------------------

const shipProfile = (
  name: string,
  overrides: Partial<SimShip> = {},
): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 60,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: 80,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

const shipView = (
  bodyId: BodyId,
  fleetId: number,
  hull: number,
  shields: number,
  profile: SimShip,
  overrides: Partial<BlindShipView> = {},
): BlindShipView =>
  Object.freeze({
    bodyId,
    fleetId,
    name: profile.name,
    chassisClass: profile.chassisClass,
    hull,
    maxHull: profile.maxHull,
    shields,
    shieldCapacity: profile.shieldCapacity,
    shieldGenAlive: true,
    engineAlive: true,
    weaponAlive: Object.freeze(profile.weapons.map(() => true)),
    missileAlive: Object.freeze(profile.missiles.map(() => true)),
    missileAmmo: Object.freeze(profile.missiles.map((m) => m.ammo)),
    pdAlive: Object.freeze(profile.pointDefense.map(() => true)),
    decoyAlive: Object.freeze(profile.decoys.map(() => true)),
    decoyCharges: Object.freeze(profile.decoys.map((d) => d.charges)),
    decoyActiveUntilTurn: 0,
    ship: profile,
    ...overrides,
  });

const body = (id: BodyId, position: Vec3): Body => ({
  kind: 'ship',
  id,
  position,
  velocity: of(0, 0, 0),
  mass: 500,
  radius: 20,
});

interface Entry {
  readonly bodyId: BodyId;
  readonly fleetId: number;
  readonly position: Vec3;
  readonly view: BlindShipView;
}
const buildView = (
  selfFleetId: number,
  entries: readonly Entry[],
): BlindMatchView => {
  const sorted = entries.slice().sort((a, b) => a.bodyId - b.bodyId);
  return Object.freeze({
    turn: 1,
    arena: { center: of(0, 0, 0), radius: 5000 },
    selfFleetId,
    bodies: Object.freeze(sorted.map((e) => body(e.bodyId, e.position))),
    ships: Object.freeze(sorted.map((e) => e.view)),
  });
};

// ---------------------------------------------------------------------------
// CP1 — target selection + weapon/missile assignment
// ---------------------------------------------------------------------------

describe('planFleetAttack — target selection per tier.targeting', () => {
  const p = shipProfile('X');

  it('rookie (nearest = lowest-BodyId enemy): fires at the lowest-id live enemy', () => {
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      // Enemy bodyId=3 is spatially closer but bodyId=2 is lower — rookie picks 2.
      { bodyId: 2, fleetId: 1, position: of(500, 0, 0), view: shipView(2, 1, 100, 60, p) },
      { bodyId: 3, fleetId: 1, position: of(100, 0, 0), view: shipView(3, 1, 100, 60, p) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.rookie);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ shooterId: 1, targetId: 2, weaponIndex: 0 });
  });

  it('veteran (threat-weighted): fires at higher-score enemy (soft > heavy)', () => {
    const heavy = shipProfile('heavy', { maxHull: 400, shieldCapacity: 200 });
    const soft = shipProfile('soft', { maxHull: 40, shieldCapacity: 10 });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 400, 200, heavy) },
      { bodyId: 3, fleetId: 1, position: of(-100, 0, 0), view: shipView(3, 1, 40, 10, soft) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.targetId).toBe(3);
  });

  it('ace (threat-map): same higher-score enemy pick as veteran on this view', () => {
    const heavy = shipProfile('heavy', { maxHull: 400, shieldCapacity: 200 });
    const soft = shipProfile('soft', { maxHull: 40, shieldCapacity: 10 });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 400, 200, heavy) },
      { bodyId: 3, fleetId: 1, position: of(-100, 0, 0), view: shipView(3, 1, 40, 10, soft) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.ace);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.targetId).toBe(3);
  });
});

describe('planFleetAttack — weapon + missile assignment', () => {
  it('emits one plan per alive weapon and per alive missile with ammo (all tiers)', () => {
    const multiArmed = shipProfile('multi', {
      weapons: [
        { range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 },
        { range: 500, damage: 10, shotsPerTurn: 2, accuracy: 0.8 },
      ],
      missiles: [
        {
          ammo: 4,
          damage: 60,
          aoeRadius: 40,
          boostVelocity: 100,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
        {
          ammo: 2,
          damage: 30,
          aoeRadius: 20,
          boostVelocity: 80,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
      ],
    });
    const enemy = shipProfile('enemy');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, multiArmed) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, enemy) },
    ]);
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      const plans = planFleetAttack(view, 0, TIER_CONFIG[tier]);
      // 2 weapons + 2 missiles = 4 plans, all targeting bodyId=2.
      expect(plans).toHaveLength(4);
      expect(plans.every((p) => p.shooterId === 1)).toBe(true);
      expect(plans.every((p) => p.targetId === 2)).toBe(true);
      const weaponIdxs = plans
        .filter((p) => p.weaponIndex !== undefined)
        .map((p) => p.weaponIndex);
      const missileIdxs = plans
        .filter((p) => p.missileIndex !== undefined)
        .map((p) => p.missileIndex);
      expect(weaponIdxs).toEqual([0, 1]);
      expect(missileIdxs).toEqual([0, 1]);
    }
  });

  it('skips dead weapons and dead / empty-ammo missile racks', () => {
    const armed = shipProfile('armed', {
      weapons: [
        { range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 },
        { range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 },
      ],
      missiles: [
        {
          ammo: 4,
          damage: 60,
          aoeRadius: 40,
          boostVelocity: 100,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
        {
          ammo: 2,
          damage: 30,
          aoeRadius: 20,
          boostVelocity: 80,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
      ],
    });
    const enemy = shipProfile('enemy');
    // weapon[0] dead; missile[0] dead; missile[1] empty ammo.
    const damaged = shipView(1, 0, 100, 60, armed, {
      weaponAlive: Object.freeze([false, true]),
      missileAlive: Object.freeze([false, true]),
      missileAmmo: Object.freeze([4, 0]),
    });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: damaged },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, enemy) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.rookie);
    // Only weapon[1] survives → 1 plan.
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ shooterId: 1, targetId: 2, weaponIndex: 1 });
  });

  it('emits no plans for a fleet with no live weapons and no live missiles', () => {
    const disarmed = shipProfile('disarmed', {
      weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
      missiles: [
        {
          ammo: 4,
          damage: 60,
          aoeRadius: 40,
          boostVelocity: 100,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
      ],
    });
    const enemy = shipProfile('enemy');
    const stripped = shipView(1, 0, 100, 60, disarmed, {
      weaponAlive: Object.freeze([false]),
      missileAlive: Object.freeze([false]),
      missileAmmo: Object.freeze([4]),
    });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: stripped },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, enemy) },
    ]);
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      expect(planFleetAttack(view, 0, TIER_CONFIG[tier])).toEqual([]);
    }
  });

  it('emits no plans when no live enemy exists', () => {
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, shipProfile('X')) },
    ]);
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      expect(planFleetAttack(view, 0, TIER_CONFIG[tier])).toEqual([]);
    }
  });

  it('skips own-fleet dead ships (hull ≤ 0)', () => {
    const p = shipProfile('X');
    const dead = shipView(1, 0, 0, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: dead },
      { bodyId: 3, fleetId: 0, position: of(50, 0, 0), view: shipView(3, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, p) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.rookie);
    // Only bodyId=3 shoots (bodyId=1 is dead). One weapon plan.
    expect(plans).toHaveLength(1);
    expect(plans[0]!.shooterId).toBe(3);
  });

  it('skips dead enemies when choosing a nearest target (rookie)', () => {
    const p = shipProfile('X');
    // Enemy bodyId=2 is dead; rookie must fall through to bodyId=3.
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 0, 0, p) },
      { bodyId: 3, fleetId: 1, position: of(300, 0, 0), view: shipView(3, 1, 100, 60, p) },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.rookie);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.targetId).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CP2 — FR-25 called-shot ladder gated by tier.enableCalledShots
// ---------------------------------------------------------------------------

describe('planFleetAttack — FR-25 called-shot ladder', () => {
  const p = shipProfile('X');

  it('shielded target: no calledShot regardless of tier', () => {
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, p) },
    ]);
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      const plans = planFleetAttack(view, 0, TIER_CONFIG[tier]);
      expect(plans).toHaveLength(1);
      expect(plans[0]!.calledShot).toBeUndefined();
    }
  });

  it('rookie: never emits calledShot even against zero-shield target', () => {
    const dropped = shipView(2, 1, 100, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: dropped },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.rookie);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toBeUndefined();
  });

  it('veteran + zero-shield + shieldGenAlive → calledShot shield-generator', () => {
    const dropped = shipView(2, 1, 100, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: dropped },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toEqual({ kind: 'shield-generator' });
  });

  it('ace + zero-shield + shieldGenAlive → calledShot shield-generator', () => {
    const dropped = shipView(2, 1, 100, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: dropped },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.ace);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toEqual({ kind: 'shield-generator' });
  });

  it('veteran + zero-shield + shieldGen dead → escalates to engine', () => {
    const p2 = shipProfile('T');
    const stripped = shipView(2, 1, 100, 0, p2, {
      shieldGenAlive: false,
      engineAlive: true,
    });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: stripped },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toEqual({ kind: 'engine' });
  });

  it('veteran + shieldGen dead + engine dead + live weapon → picks highest-DPS weapon', () => {
    const twoWeapons = shipProfile('T', {
      weapons: [
        // idx 0: DPS 20 * 1 * 0.5 = 10
        { range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.5 },
        // idx 1: DPS 30 * 2 * 0.9 = 54  ← highest
        { range: 400, damage: 30, shotsPerTurn: 2, accuracy: 0.9 },
        // idx 2: DPS 40 * 1 * 0.9 = 36
        { range: 400, damage: 40, shotsPerTurn: 1, accuracy: 0.9 },
      ],
    });
    const disabled = shipView(2, 1, 100, 0, twoWeapons, {
      shieldGenAlive: false,
      engineAlive: false,
    });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: disabled },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toEqual({ kind: 'weapon', index: 1 });
  });

  it('veteran + zero-shield + everything called-shot-able dead → no calledShot', () => {
    // No weapons at all, no shield gen, no engine.
    const bare = shipProfile('bare', { weapons: [] });
    const husk = shipView(2, 1, 100, 0, bare, {
      shieldGenAlive: false,
      engineAlive: false,
    });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: husk },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.calledShot).toBeUndefined();
  });

  it('called shot applies to missile plans too (same subsystem as weapons)', () => {
    const withRack = shipProfile('shooter', {
      missiles: [
        {
          ammo: 3,
          damage: 60,
          aoeRadius: 0,
          boostVelocity: 100,
          trackingTurnRate: 0.5,
          bodyMass: 5,
          bodyRadius: 2,
        },
      ],
    });
    const dropped = shipView(2, 1, 100, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, withRack) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: dropped },
    ]);
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran);
    // 1 weapon plan + 1 missile plan, both with calledShot.
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.calledShot).toEqual({ kind: 'shield-generator' });
    }
  });
});

// ---------------------------------------------------------------------------
// CP2 — FR-29 ace AoE friendly-fire skip on missile assignment
// ---------------------------------------------------------------------------

const aoeCombat = (radius: number): CombatConfig => {
  const byClass: Record<ChassisClass, number> = {
    fighter: radius,
    frigate: radius,
    cruiser: radius,
    'mega-destroyer': radius,
  };
  return {
    hazards: {
      maxSimultaneousBodies: 512,
      debrisLifetimeTurns: 3,
      debrisPerDestruction: {
        fighter: 2,
        frigate: 4,
        cruiser: 6,
        'mega-destroyer': 10,
      },
      debrisScatterImpulse: 30,
      debrisMassFractionOfHull: 0.05,
      debrisRadius: 3,
    },
    destruction: {
      aoeRadiusByClass: byClass,
      aoeDamageByClass: {
        fighter: 10,
        frigate: 15,
        cruiser: 20,
        'mega-destroyer': 30,
      },
    },
    missiles: {
      trackingBeats: 3,
      spentRemainsArmed: false,
      reacquireOnTargetLoss: false,
    },
    shields: {
      regenTicksRegardlessOfDamage: true,
    },
  };
};

describe('planFleetAttack — FR-29 ace AoE friendly-fire skip on missiles', () => {
  const missileRack = {
    ammo: 3,
    damage: 60,
    aoeRadius: 40,
    boostVelocity: 100,
    trackingTurnRate: 0.5,
    bodyMass: 5,
    bodyRadius: 2,
  } as const;
  const shooterProfile = shipProfile('S', { missiles: [missileRack] });
  const targetProfile = shipProfile('T');
  const friendlyProfile = shipProfile('F');

  // Own bodyId=3 sits 30 units from enemy target bodyId=2; AoE radius = 50.
  const friendlyInAoeView = (): BlindMatchView =>
    buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, shooterProfile) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, targetProfile) },
      { bodyId: 3, fleetId: 0, position: of(230, 0, 0), view: shipView(3, 0, 100, 60, friendlyProfile) },
    ]);

  it('ace + friendly in AoE + combat provided → skips missile; keeps weapon', () => {
    const view = friendlyInAoeView();
    const plans = planFleetAttack(view, 0, TIER_CONFIG.ace, aoeCombat(50));
    // Shooter bodyId=1: weapon plan kept, missile plan skipped.
    // Friendly bodyId=3: weapon plan (no missile rack). Total: 2 plans, both weapons.
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.weaponIndex !== undefined)).toBe(true);
    expect(plans.every((p) => p.missileIndex === undefined)).toBe(true);
  });

  it('ace + no friendly in AoE → missile flies', () => {
    const clearView = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, shooterProfile) },
      // Enemy alone — no friendly anywhere near.
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, targetProfile) },
    ]);
    const plans = planFleetAttack(clearView, 0, TIER_CONFIG.ace, aoeCombat(50));
    // Weapon + missile from shooter.
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.missileIndex !== undefined)).toHaveLength(1);
  });

  it('veteran + friendly in AoE → missile still flies (check is ace-only)', () => {
    const view = friendlyInAoeView();
    const plans = planFleetAttack(view, 0, TIER_CONFIG.veteran, aoeCombat(50));
    // Veteran ignores the AoE check → missile plan present.
    const missiles = plans.filter((p) => p.missileIndex !== undefined);
    expect(missiles).toHaveLength(1);
  });

  it('ace + combat undefined → missile still flies (opted-out path)', () => {
    const view = friendlyInAoeView();
    const plans = planFleetAttack(view, 0, TIER_CONFIG.ace /* no combat */);
    // Without combat the check is a no-op; missile plan is present.
    const missiles = plans.filter((p) => p.missileIndex !== undefined);
    expect(missiles).toHaveLength(1);
  });
});
