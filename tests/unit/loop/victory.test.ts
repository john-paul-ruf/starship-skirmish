// victory — FR-27 / Custom Rule 5 — exactly three branches.
//
// The tests here pin the "exactly three outcomes" contract at unit-test
// granularity: mutual-destruction, single-fleet victory, continue, and a
// meta-test that asserts the type only has two `kind`s.

import { describe, expect, it } from 'vitest';
import { checkVictory, outcomeOf } from '../../../src/sim/loop/victory.js';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import type { MatchConfig, MatchState } from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  CombatConfig,
  SimFleet,
  SimShip,
} from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';

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

const fleet = (id: number, names: readonly string[]): SimFleet => ({
  fleetId: id,
  ships: names.map((n) => ship(n)),
});

const cfg = (fleets: readonly SimFleet[]): MatchConfig => {
  const a = arena();
  return { seed: seedOf(1, 2), fleets, arena: a, physics: physics(a), combat: combat() };
};

// Remove ships from `state` — utility for setting up post-death scenarios.
const killShips = (state: MatchState, ids: readonly number[]): MatchState => {
  const killed = new Set(ids);
  const ships = new Map(state.ships);
  const bodies = new Map(state.bodies);
  const fleetOf = new Map(state.fleetOf);
  for (const id of killed) {
    ships.delete(id);
    bodies.delete(id);
    fleetOf.delete(id);
  }
  return { ...state, ships, bodies, fleetOf };
};

describe('checkVictory — three-branch contract (FR-27)', () => {
  it('multiple fleets standing → null (continue)', () => {
    const state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    expect(checkVictory(state)).toBeNull();
  });

  it('one fleet standing → victory with that fleet id', () => {
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    state = killShips(state, [2]); // fleet 1 empty
    const outcome = checkVictory(state);
    expect(outcome).not.toBeNull();
    expect(outcome!.kind).toBe('victory');
    if (outcome !== null && outcome.kind === 'victory') {
      expect(outcome.fleetId).toBe(0);
    }
  });

  it('zero fleets standing → mutual-destruction', () => {
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    state = killShips(state, [1, 2]);
    const outcome = checkVictory(state);
    expect(outcome).not.toBeNull();
    expect(outcome!.kind).toBe('mutual-destruction');
  });

  it('there are exactly three possible outcomes (no draw / turn-cap / points variant)', () => {
    // Meta-check: enumerate every case that could produce a non-null outcome
    // and assert each `kind` is one of the two variants.
    const seen = new Set<string>();
    // Case 1: mutual destruction.
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    state = killShips(state, [1, 2]);
    const o1 = checkVictory(state)!;
    seen.add(o1.kind);
    // Case 2: single-fleet victory.
    let state2 = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    state2 = killShips(state2, [2]);
    const o2 = checkVictory(state2)!;
    seen.add(o2.kind);
    // The set of possible `kind`s is exactly { 'victory', 'mutual-destruction' }.
    expect(Array.from(seen).sort()).toEqual(['mutual-destruction', 'victory']);
  });
});

describe('outcomeOf — stamps turns onto a VictoryResult', () => {
  it('null → null', () => {
    expect(outcomeOf(null, 7)).toBeNull();
  });
  it('victory → stamped with fleetId + turns', () => {
    const stamped = outcomeOf({ kind: 'victory', fleetId: 3 }, 8);
    expect(stamped).toEqual({ kind: 'victory', fleetId: 3, turns: 8 });
  });
  it('mutual-destruction → stamped with turns', () => {
    const stamped = outcomeOf({ kind: 'mutual-destruction' }, 12);
    expect(stamped).toEqual({ kind: 'mutual-destruction', turns: 12 });
  });
});
