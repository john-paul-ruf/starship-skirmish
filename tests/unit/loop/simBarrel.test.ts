// simBarrel — smoke test that `src/sim/index.ts` re-exports the loop's public
// surface. If a re-export drifts (a rename, an accidental drop), this test
// fails at compile time. It doesn't assert values — the point is the imports
// themselves resolve.

import { describe, expect, it } from 'vitest';
import {
  applyTurnEnd,
  buildInitialState,
  checkVictory,
  createMatch,
  makeBlindView,
  matchDigest,
  runAttackBeat,
  runMatch,
  runMovementBeat,
  runTurn,
  type Commander,
  type Match,
  type MatchConfig,
  type MatchState,
  type ResolutionTrace,
} from '../../../src/sim/index.js';
import { seedOf } from '../../../src/sim/index.js';
import type { AttackPlan, MovementPlan, SimFleet, SimShip, Arena, CombatConfig } from '../../../src/sim/index.js';
import type { PhysicsConfig } from '../../../src/sim/index.js';

describe('sim barrel', () => {
  it('re-exports the loop composition root through src/sim/index.ts', () => {
    // Functions/values.
    expect(typeof buildInitialState).toBe('function');
    expect(typeof createMatch).toBe('function');
    expect(typeof runMovementBeat).toBe('function');
    expect(typeof runAttackBeat).toBe('function');
    expect(typeof runTurn).toBe('function');
    expect(typeof runMatch).toBe('function');
    expect(typeof applyTurnEnd).toBe('function');
    expect(typeof checkVictory).toBe('function');
    expect(typeof makeBlindView).toBe('function');
    expect(typeof matchDigest).toBe('function');
  });

  it('can construct a Match end-to-end via the barrel', async () => {
    const a: Arena = { center: { x: 0, y: 0, z: 0 }, radius: 5000 };
    const physics: PhysicsConfig = {
      dt: 1,
      subStepMin: 4,
      subStepMax: 64,
      restitution: 0.15,
      collisionDamageCoefficient: 0.0012,
      arena: a,
    };
    const combat: CombatConfig = {
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
    };
    const ship: SimShip = {
      buildId: 'b',
      name: 'X',
      chassisClass: 'frigate',
      mass: 500,
      radius: 20,
      maxHull: 100,
      shieldCapacity: 0,
      shieldRegenPerTurn: 0,
      deltaVPerTurn: 300,
      baseEvasion: 0,
      hullRepairPerTurn: 0,
      weapons: [{ range: 2000, damage: 50, shotsPerTurn: 1, accuracy: 1 }],
      missiles: [],
      pointDefense: [],
      decoys: [],
    };
    const fleets: SimFleet[] = [
      { fleetId: 0, ships: [{ ...ship, name: 'A' }] },
      { fleetId: 1, ships: [{ ...ship, name: 'B', maxHull: 40 }] },
    ];
    const config: MatchConfig = { seed: seedOf(1, 2), fleets, arena: a, physics, combat };
    const match: Match = createMatch(config);
    // Move ships into weapons range.
    const bodies = new Map(match.state.bodies);
    const bA = bodies.get(1)!;
    const bB = bodies.get(2)!;
    bodies.set(1, { ...bA, position: { x: -100, y: 0, z: 0 } });
    bodies.set(2, { ...bB, position: { x: 100, y: 0, z: 0 } });
    match.state = { ...match.state, bodies };

    const cA: Commander = {
      fleetId: 0,
      planMovement: (): MovementPlan[] => [],
      planAttack: (): AttackPlan[] => [
        { shooterId: 1, targetId: 2, weaponIndex: 0 },
      ],
    };
    const cB: Commander = {
      fleetId: 1,
      planMovement: (): MovementPlan[] => [],
      planAttack: (): AttackPlan[] => [],
    };
    const result = await runMatch(match.state, [cA, cB], 10);
    // A wins turn 1.
    expect(result.outcome.kind).toBe('victory');
    if (result.outcome.kind === 'victory') {
      expect(result.outcome.fleetId).toBe(0);
    }
    // Trace is populated.
    const trace: ResolutionTrace = result.trace;
    expect(trace.turns.length).toBeGreaterThan(0);
    expect(trace.outcome).not.toBeNull();
    // MatchState + digest work.
    const s: MatchState = result.state;
    expect(typeof matchDigest(s)).toBe('string');
  });
});
