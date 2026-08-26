// matchDigest — the loop's authoritative determinism gate.
//
// Two invariants:
//   1. Stability — the same MatchState hashes identically across two independent
//      constructions (this is what S05 will assert across independent runs).
//   2. Sensitivity — every load-bearing field, when changed, changes the digest.

import { describe, expect, it } from 'vitest';
import { matchDigest } from '../../../src/sim/loop/digest.js';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import type { MatchConfig, MatchState } from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
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
const ship = (name: string): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 60,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
});
const fleet = (id: number, names: readonly string[]): SimFleet => ({
  fleetId: id,
  ships: names.map((n) => ship(n)),
});
const cfg = (fleets: readonly SimFleet[]): MatchConfig => {
  const a = arena();
  return { seed: seedOf(42, 42), fleets, arena: a, physics: physics(a), combat: combat() };
};

const withBody = (state: MatchState, id: BodyId, patch: Partial<Body>): MatchState => {
  const bodies = new Map(state.bodies);
  const b = bodies.get(id)!;
  bodies.set(id, { ...b, ...patch } as Body);
  return { ...state, bodies };
};

describe('matchDigest — stability', () => {
  it('two independent constructions of the same match hash identically', () => {
    const s1 = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    const s2 = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    expect(matchDigest(s1)).toBe(matchDigest(s2));
  });

  it('digest is 8 lowercase hex characters', () => {
    const s = buildInitialState(cfg([fleet(0, ['A'])]));
    const d = matchDigest(s);
    expect(d).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('matchDigest — sensitivity', () => {
  it('changing a ship hull changes the digest', () => {
    const state = buildInitialState(cfg([fleet(0, ['A'])]));
    const d0 = matchDigest(state);
    const ships = new Map(state.ships);
    const sc = ships.get(1)!;
    ships.set(1, { ...sc, hull: sc.hull - 1 });
    const d1 = matchDigest({ ...state, ships });
    expect(d1).not.toBe(d0);
  });

  it('changing a body position changes the digest', () => {
    const state = buildInitialState(cfg([fleet(0, ['A'])]));
    const d0 = matchDigest(state);
    const s1 = withBody(state, 1, { position: { x: 999, y: 0, z: 0 } });
    expect(matchDigest(s1)).not.toBe(d0);
  });

  it('changing the seed changes the digest', () => {
    const s1 = buildInitialState({
      ...cfg([fleet(0, ['A'])]),
      seed: seedOf(1, 1),
    });
    const s2 = buildInitialState({
      ...cfg([fleet(0, ['A'])]),
      seed: seedOf(2, 2),
    });
    expect(matchDigest(s1)).not.toBe(matchDigest(s2));
  });

  it('changing the turn number changes the digest', () => {
    const state = buildInitialState(cfg([fleet(0, ['A'])]));
    const d0 = matchDigest(state);
    const d1 = matchDigest({ ...state, turn: state.turn + 1 });
    expect(d1).not.toBe(d0);
  });
});
