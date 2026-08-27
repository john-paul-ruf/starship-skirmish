// attackBeat — the loop's attack-beat resolver (thin wrapper over
// `rules.resolveAttackBeat` with launch-env + missile threading).
//
// The rules module already tests snapshot semantics + shuffle-invariance in
// depth. Here we cover the loop's own additions: dead-ship removal from state,
// missile bodies inserted into `state.bodies`, guidance threaded into
// `state.guidances`, and `nextBodyId` advanced.

import { describe, expect, it } from 'vitest';
import { runAttackBeat } from '../../../src/sim/loop/resolveBeat.js';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import type { MatchConfig, MatchState } from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  AttackPlan,
  Body,
  BodyId,
  CombatConfig,
  SimFleet,
  SimShip,
} from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';

const arena = (): Arena => ({ center: { x: 0, y: 0, z: 0 }, radius: 5000 });
const physics = (a: Arena): PhysicsConfig => ({
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: a,
});
const combat = (): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 4,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 6, 'mega-destroyer': 12 },
    debrisScatterImpulse: 50,
    debrisMassFractionOfHull: 0.02,
    debrisRadius: 5,
  },
  destruction: {
    aoeRadiusByClass: { fighter: 60, frigate: 90, cruiser: 130, 'mega-destroyer': 200 },
    aoeDamageByClass: { fighter: 25, frigate: 40, cruiser: 60, 'mega-destroyer': 100 },
  },
  missiles: { trackingBeats: 2, spentRemainsArmed: true, reacquireOnTargetLoss: false },
  shields: { regenTicksRegardlessOfDamage: true },
});

const ship = (name: string, o: Partial<SimShip> = {}): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 0,
  shieldRegenPerTurn: 0,
  deltaVPerTurn: 300,
  baseEvasion: 0,
  hullRepairPerTurn: 0,
  weapons: [{ range: 2000, damage: 30, shotsPerTurn: 1, accuracy: 1 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...o,
});

const fleet = (id: number, ships: SimShip[]): SimFleet => ({ fleetId: id, ships });

const cfg = (fleets: readonly SimFleet[], a: Arena = arena()): MatchConfig => ({
  seed: seedOf(1, 2),
  fleets,
  arena: a,
  physics: physics(a),
  combat: combat(),
});

const withBody = (state: MatchState, id: BodyId, patch: Partial<Body>): MatchState => {
  const bodies = new Map(state.bodies);
  const b = bodies.get(id)!;
  bodies.set(id, { ...b, ...patch } as Body);
  return { ...state, bodies };
};

describe('runAttackBeat — snapshot semantics', () => {
  it('destroys ships whose hull ≤ 0 and removes them from state', () => {
    let state = buildInitialState(cfg([
      fleet(0, [ship('A', { maxHull: 30 })]),
      fleet(1, [ship('B', { maxHull: 100 })]),
    ]));
    state = withBody(state, 1, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 500, y: 0, z: 0 } });
    // A shoots B → 30 dmg (no kill). B shoots A → 30 dmg → A dies.
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 },
      { shooterId: 2, targetId: 1, weaponIndex: 0 },
    ];
    const out = runAttackBeat(state, plans);
    expect(out.state.ships.has(1)).toBe(false);
    expect(out.state.ships.has(2)).toBe(true);
    expect(out.state.bodies.has(1)).toBe(false);
    expect(out.record.destroyed.map((d) => d.bodyId)).toEqual([1]);
    // A still fired: B took 30 damage.
    expect(out.state.ships.get(2)!.hull).toBe(100 - 30);
  });

  it('threads launched missiles into bodies + guidances', () => {
    let state = buildInitialState(cfg([
      fleet(0, [
        ship('L', {
          weapons: [],
          missiles: [
            {
              ammo: 4,
              damage: 60,
              aoeRadius: 100,
              boostVelocity: 300,
              trackingTurnRate: 60,
              bodyMass: 5,
              bodyRadius: 6,
            },
          ],
        }),
      ]),
      fleet(1, [ship('T')]),
    ]));
    state = withBody(state, 1, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 500, y: 0, z: 0 } });
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, missileIndex: 0 },
    ];
    const startNextId = state.nextBodyId;
    const out = runAttackBeat(state, plans);
    // One new missile body minted at startNextId.
    expect(out.state.bodies.has(startNextId)).toBe(true);
    expect(out.state.bodies.get(startNextId)!.kind).toBe('missile');
    expect(out.state.guidances.has(startNextId)).toBe(true);
    expect(out.state.nextBodyId).toBe(startNextId + 1);
    expect(out.record.launchedMissileIds).toEqual([startNextId]);
    // Ammo decremented on the shooter.
    expect(out.state.ships.get(1)!.missileAmmo[0]).toBe(3);
  });

  it('cascadeToNextMovement=true: attack-beat kills populate pendingDetonations, sorted by bodyId (CP3)', () => {
    // Two attackers each kill the other in a single beat — a symmetric
    // mutual-kill so BOTH corpses land in pendingDetonations. Gate on.
    const cfgOn: MatchConfig = {
      ...cfg([
        fleet(0, [
          ship('A', {
            maxHull: 30,
            weapons: [{ range: 3000, damage: 100, shotsPerTurn: 1, accuracy: 1 }],
          }),
        ]),
        fleet(1, [
          ship('B', {
            maxHull: 30,
            weapons: [{ range: 3000, damage: 100, shotsPerTurn: 1, accuracy: 1 }],
          }),
        ]),
      ]),
      combat: {
        ...combat(),
        destruction: { ...combat().destruction, cascadeToNextMovement: true },
      },
    };
    let state = buildInitialState(cfgOn);
    state = withBody(state, 1, { position: { x: -400, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 400, y: 0, z: 0 } });
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 },
      { shooterId: 2, targetId: 1, weaponIndex: 0 },
    ];
    const out = runAttackBeat(state, plans);
    // Both dead, both queued for cascade in ascending bodyId order.
    const pending = out.state.pendingDetonations ?? [];
    expect(pending.map((p) => p.event.bodyId)).toEqual([1, 2]);
    // Each pending event has detonates=true and carries a valid ship handle.
    expect(pending.every((p) => p.event.detonates === true)).toBe(true);
    expect(pending.every((p) => typeof p.ship.mass === 'number')).toBe(true);
  });

  it('cascadeToNextMovement absent (default): attack-beat kills DO NOT queue pending (frozen-goldens path)', () => {
    let state = buildInitialState(cfg([
      fleet(0, [
        ship('A', {
          weapons: [{ range: 3000, damage: 200, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
      fleet(1, [
        ship('B', {
          maxHull: 50,
          weapons: [{ range: 3000, damage: 20, shotsPerTurn: 1, accuracy: 1 }],
        }),
      ]),
    ]));
    state = withBody(state, 1, { position: { x: -400, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 400, y: 0, z: 0 } });
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 2, weaponIndex: 0 },
    ];
    const out = runAttackBeat(state, plans);
    // B dies but gate is absent (default combat()) ⇒ no cascade queued.
    expect(out.record.destroyed.some((d) => d.bodyId === 2)).toBe(true);
    expect(out.state.pendingDetonations ?? []).toEqual([]);
  });

  it('shuffled attack plans ⇒ identical resulting state digest', () => {
    let state = buildInitialState(cfg([
      fleet(0, [ship('A'), ship('B')]),
      fleet(1, [ship('C'), ship('D')]),
    ]));
    // Positions in weapon range of each other; explicit for shuffle test.
    state = withBody(state, 1, { position: { x: -100, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: -50, y: 0, z: 0 } });
    state = withBody(state, 3, { position: { x: 50, y: 0, z: 0 } });
    state = withBody(state, 4, { position: { x: 100, y: 0, z: 0 } });
    const plans: AttackPlan[] = [
      { shooterId: 1, targetId: 3, weaponIndex: 0 },
      { shooterId: 2, targetId: 4, weaponIndex: 0 },
      { shooterId: 3, targetId: 1, weaponIndex: 0 },
      { shooterId: 4, targetId: 2, weaponIndex: 0 },
    ];
    const shuffled: AttackPlan[] = [plans[3]!, plans[0]!, plans[2]!, plans[1]!];
    const digest = (state: MatchState): string =>
      JSON.stringify(
        Array.from(state.ships.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([id, sc]) => ({ id, h: sc.hull, s: sc.shields })),
      );
    const r1 = runAttackBeat(state, plans);
    const r2 = runAttackBeat(state, shuffled);
    expect(digest(r1.state)).toBe(digest(r2.state));
  });
});
