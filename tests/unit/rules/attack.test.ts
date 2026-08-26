// attack.test — the FR-21 snapshot core. The shuffle test IS the invariant.

import { describe, expect, it } from 'vitest';
import { resolveAttackBeat, type LaunchEnv } from '../../../src/sim/rules/attack.js';
import { newShipCombat, type ShipCombat } from '../../../src/sim/rules/combatState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  AttackPlan,
  BodyId,
  MissileBody,
  SimShip,
  SimWeapon,
} from '../../../src/sim/types.js';

const weapon = (o: Partial<SimWeapon> = {}): SimWeapon => ({
  range: 1000,
  damage: 30,
  shotsPerTurn: 1,
  accuracy: 1, // deterministic hits in tests — with HIT_CEIL=0.95, roll<0.95 hits
  ...o,
});

const ship = (weapons: SimWeapon[], o: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Ship',
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 0, // most tests want called-shots unlocked by default
  shieldRegenPerTurn: 0,
  deltaVPerTurn: 300,
  baseEvasion: 0, // remove chance of miss below HIT_CEIL for scripting
  hullRepairPerTurn: 0,
  weapons,
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...o,
});

const stubEnv = (): LaunchEnv => {
  let nextId = 1000;
  return {
    nextBodyId: () => {
      const id = nextId;
      nextId += 1;
      return id;
    },
    launch: (input): { body: MissileBody; guidance: unknown } => ({
      body: {
        kind: 'missile',
        id: input.bodyId,
        position: input.shooterPosition,
        velocity: input.shooterVelocity,
        mass: 5,
        radius: 6,
      },
      guidance: { rackIndex: input.rackIndex, targetId: input.targetId },
    }),
  };
};

const digest = (r: ReturnType<typeof resolveAttackBeat>): string =>
  JSON.stringify({
    log: r.log.map((e) => ({
      s: e.sourceId,
      t: e.targetId,
      r: e.result,
      d: e.damage,
      sB: e.shieldBefore,
      sA: e.shieldAfter,
      hB: e.hullBefore,
      hA: e.hullAfter,
    })),
    dead: r.destroyed.map((d) => d.bodyId),
    launched: r.launchedMissiles.map((m) => m.id),
  });

describe('resolveAttackBeat — snapshot semantics (FR-21)', () => {
  it('reads pre-damage pools; a shooter killed this beat still lands its shots', () => {
    // A (id 1) shoots B (id 2) for 40 damage. B has 40 hull → B dies.
    // C (id 3) shoots A (id 1) for 60. A has 50 hull → A dies.
    // The scenario "C kills A, then A can't shoot B" would be wrong — both must fire.
    const shipA = ship([weapon({ damage: 40 })], { maxHull: 50 });
    const shipB = ship([], { maxHull: 40 });
    const shipC = ship([weapon({ damage: 60 })], { maxHull: 100 });

    const snapshot = new Map<BodyId, ShipCombat>([
      [1, newShipCombat(shipA, 1)],
      [2, newShipCombat(shipB, 2)],
      [3, newShipCombat(shipC, 3)],
    ]);
    const positions = new Map<BodyId, { x: number; y: number; z: number }>([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 100, y: 0, z: 0 }],
      [3, { x: -100, y: 0, z: 0 }],
    ]);
    const velocities = new Map<BodyId, { x: number; y: number; z: number }>([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
      [3, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 },
      { shooterId: 3, targetId: 1, weaponIndex: 0 },
    ];

    const r = resolveAttackBeat(
      snapshot,
      positions,
      velocities,
      plans,
      seedOf(1, 2),
      1,
      stubEnv(),
    );
    const deadIds = r.destroyed.map((d) => d.bodyId).sort();
    expect(deadIds).toEqual([1, 2]);
    expect(r.combats.get(1)!.hull).toBeLessThanOrEqual(0);
    expect(r.combats.get(2)!.hull).toBeLessThanOrEqual(0);
    // Kill events land in ascending target id.
    expect(r.destroyed[0]!.bodyId).toBe(1);
    expect(r.destroyed[1]!.bodyId).toBe(2);
  });

  it('mutual destruction: two ships kill each other, both fire', () => {
    const shipA = ship([weapon({ damage: 50 })], { maxHull: 40 });
    const shipB = ship([weapon({ damage: 50 })], { maxHull: 40 });
    const snapshot = new Map([
      [1, newShipCombat(shipA, 1)],
      [2, newShipCombat(shipB, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 100, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const r = resolveAttackBeat(
      snapshot,
      positions,
      velocities,
      [
        { shooterId: 1, targetId: 2, weaponIndex: 0 },
        { shooterId: 2, targetId: 1, weaponIndex: 0 },
      ],
      seedOf(0xdead, 0xbeef),
      1,
      stubEnv(),
    );
    expect(r.destroyed.map((d) => d.bodyId).sort()).toEqual([1, 2]);
  });
});

describe('resolveAttackBeat — determinism', () => {
  it('shuffled plans ⇒ identical combats / log / destroyed digest', () => {
    // Four shooters at two targets — non-trivial permutation surface.
    const s1 = ship([weapon({ damage: 15, shotsPerTurn: 2 })]);
    const s2 = ship([weapon({ damage: 22 })]);
    const s3 = ship([weapon({ damage: 8, shotsPerTurn: 3 })]);
    const s4 = ship([weapon({ damage: 33 })]);
    const t5 = ship([], { maxHull: 200, shieldCapacity: 80 });
    const t6 = ship([], { maxHull: 200, shieldCapacity: 80 });

    const snapshot = new Map<BodyId, ShipCombat>([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(s2, 2)],
      [3, newShipCombat(s3, 3)],
      [4, newShipCombat(s4, 4)],
      [5, newShipCombat(t5, 5)],
      [6, newShipCombat(t6, 6)],
    ]);
    const positions = new Map<BodyId, { x: number; y: number; z: number }>();
    const velocities = new Map<BodyId, { x: number; y: number; z: number }>();
    for (const id of [1, 2, 3, 4, 5, 6]) {
      positions.set(id, { x: id * 10, y: 0, z: 0 });
      velocities.set(id, { x: 0, y: 0, z: 0 });
    }

    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 5, weaponIndex: 0 },
      { shooterId: 2, targetId: 6, weaponIndex: 0 },
      { shooterId: 3, targetId: 5, weaponIndex: 0 },
      { shooterId: 4, targetId: 6, weaponIndex: 0 },
      { shooterId: 1, targetId: 6, weaponIndex: 0 },
      { shooterId: 2, targetId: 5, weaponIndex: 0 },
    ];
    const seed = seedOf(0x1234, 0x5678);

    const canonical = resolveAttackBeat(
      snapshot,
      positions,
      velocities,
      plans,
      seed,
      7,
      stubEnv(),
    );
    // Try several permutations — all must produce identical digests.
    const perms: AttackPlan[][] = [
      plans.slice().reverse(),
      [plans[3]!, plans[0]!, plans[4]!, plans[1]!, plans[5]!, plans[2]!],
      [plans[5]!, plans[4]!, plans[3]!, plans[2]!, plans[1]!, plans[0]!],
    ];
    for (const perm of perms) {
      const r = resolveAttackBeat(
        snapshot,
        positions,
        velocities,
        perm,
        seed,
        7,
        stubEnv(),
      );
      expect(digest(r)).toBe(digest(canonical));
    }
  });

  it('same inputs, same seed ⇒ reproducible', () => {
    const s1 = ship([weapon({ damage: 20 })]);
    const t2 = ship([]);
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 500, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [{ shooterId: 1, targetId: 2, weaponIndex: 0 }];
    const seed = seedOf(11, 22);
    const a = resolveAttackBeat(snapshot, positions, velocities, plans, seed, 4, stubEnv());
    const b = resolveAttackBeat(snapshot, positions, velocities, plans, seed, 4, stubEnv());
    expect(digest(a)).toBe(digest(b));
  });
});

describe('resolveAttackBeat — range gate + called-shot gate', () => {
  it('out-of-range assignment contributes nothing (FR-20)', () => {
    const s1 = ship([weapon({ range: 500, damage: 30 })]);
    const t2 = ship([]);
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    // Distance 600, weapon range 500 → out of range.
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 600, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [{ shooterId: 1, targetId: 2, weaponIndex: 0 }];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    expect(r.log).toHaveLength(0);
    expect(r.destroyed).toHaveLength(0);
    expect(r.combats.get(2)!.hull).toBe(100);
  });

  it('called-shot vs shielded target is demoted to a hull shot', () => {
    const s1 = ship([weapon({ damage: 25 })]);
    const t2 = ship([], { shieldCapacity: 100 }); // shielded
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 50, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0, calledShot: { kind: 'engine' } },
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    // Engine unchanged (called shot demoted); shields took the damage.
    expect(r.combats.get(2)!.engineAlive).toBe(true);
    expect(r.combats.get(2)!.shields).toBe(75);
  });

  it('called-shot vs unshielded target damages integrity, not hull', () => {
    const s1 = ship([weapon({ damage: 25 })]);
    const t2 = ship([], { shieldCapacity: 0 });
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 50, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0, calledShot: { kind: 'engine' } },
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    // Hull unchanged; engine integrity dropped by 25.
    expect(r.combats.get(2)!.hull).toBe(100);
    expect(r.combats.get(2)!.componentIntegrity.engine).toBeLessThan(45); // frigate engine ≈ 45
    // The log entry damage field is 0 for a called-shot hit (hull didn't drop).
    expect(r.log[0]!.damage).toBe(0);
  });
});

describe('resolveAttackBeat — missile launch', () => {
  it('launches decrement ammo and emit a MissileBody', () => {
    const s1 = ship([], {
      missiles: [
        {
          ammo: 3, damage: 60, aoeRadius: 80, boostVelocity: 200,
          trackingTurnRate: 30, bodyMass: 5, bodyRadius: 6,
        },
      ],
    });
    const t2 = ship([]);
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 200, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 5, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, missileIndex: 0 },
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    expect(r.launchedMissiles).toHaveLength(1);
    expect(r.combats.get(1)!.missileAmmo[0]).toBe(2);
  });

  it('an empty magazine cannot launch', () => {
    const s1 = ship([], {
      missiles: [
        {
          ammo: 0, damage: 60, aoeRadius: 80, boostVelocity: 200,
          trackingTurnRate: 30, bodyMass: 5, bodyRadius: 6,
        },
      ],
    });
    const t2 = ship([]);
    const snapshot = new Map([
      [1, newShipCombat(s1, 1)],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 200, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, missileIndex: 0 },
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    expect(r.launchedMissiles).toHaveLength(0);
    expect(r.combats.get(1)!.missileAmmo[0]).toBe(0);
  });

  it('dead missile rack cannot launch (subsystem knocked out earlier turn)', () => {
    const s1 = ship([], {
      missiles: [
        {
          ammo: 5, damage: 60, aoeRadius: 80, boostVelocity: 200,
          trackingTurnRate: 30, bodyMass: 5, bodyRadius: 6,
        },
      ],
    });
    const t2 = ship([]);
    const sc1 = newShipCombat(s1, 1);
    sc1.missileAlive[0] = false; // pre-knocked
    const snapshot = new Map([
      [1, sc1],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 200, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, missileIndex: 0 },
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    expect(r.launchedMissiles).toHaveLength(0);
  });
});

describe('resolveAttackBeat — dead weapons cannot fire', () => {
  it('a knocked-out weapon slot contributes nothing this beat', () => {
    const s1 = ship([weapon({ damage: 30 }), weapon({ damage: 30 })]);
    const t2 = ship([]);
    const sc1 = newShipCombat(s1, 1);
    sc1.weaponAlive[0] = false; // slot 0 dead
    const snapshot = new Map([
      [1, sc1],
      [2, newShipCombat(t2, 2)],
    ]);
    const positions = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 50, y: 0, z: 0 }],
    ]);
    const velocities = new Map([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 }, // dead slot
      { shooterId: 1, targetId: 2, weaponIndex: 1 }, // live slot
    ];
    const r = resolveAttackBeat(snapshot, positions, velocities, plans, seedOf(1, 1), 1, stubEnv());
    // Only the live slot's shot logs; hull down by 30.
    expect(r.log).toHaveLength(1);
    expect(r.combats.get(2)!.hull).toBe(70);
  });
});
