// turnCoordinator — async orchestration + FR-17 blind-commit + FR-27 victory.
//
// Tests here:
//   • two scripted Commanders run a full turn deterministically
//   • blind-commit: a commander stub can inspect its `view` and find NO
//     other-fleet-plan field — structural, not policy
//   • same seed + same scripted plans over N turns produce identical final
//     digest (state equality across two runs)
//   • runMatch loops to victory and produces the correct MatchOutcome

import { describe, expect, it } from 'vitest';
import { runMatch, runTurn } from '../../../src/sim/loop/turnCoordinator.js';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import type { MatchConfig, MatchState } from '../../../src/sim/loop/matchState.js';
import type { Commander } from '../../../src/sim/loop/commander.js';
import type { BlindMatchView } from '../../../src/sim/loop/blindView.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  AttackPlan,
  Body,
  BodyId,
  CombatConfig,
  MovementPlan,
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

// A scripted commander that returns fixed plans without inspecting the view.
const scripted = (
  fleetId: number,
  movement: readonly MovementPlan[],
  attack: readonly AttackPlan[],
): Commander => ({
  fleetId,
  planMovement: () => movement.slice(),
  planAttack: () => attack.slice(),
});

// A commander that captures the view it was handed — for the blind-commit test.
const capturing = (
  fleetId: number,
): { commander: Commander; captured: BlindMatchView[] } => {
  const captured: BlindMatchView[] = [];
  return {
    captured,
    commander: {
      fleetId,
      planMovement: (v) => {
        captured.push(v);
        return [];
      },
      planAttack: () => [],
    },
  };
};

describe('runTurn — one full turn deterministically', () => {
  it('two scripted commanders produce a stable outcome', async () => {
    let state = buildInitialState(cfg([
      fleet(0, [ship('A')]),
      fleet(1, [ship('B')]),
    ]));
    state = withBody(state, 1, { position: { x: -100, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 100, y: 0, z: 0 } });
    const c0 = scripted(0, [], [{ shooterId: 1, targetId: 2, weaponIndex: 0 }]);
    const c1 = scripted(1, [], []);
    const result = await runTurn(state, [c0, c1]);
    // A hit B: B took 30 dmg.
    expect(result.state.ships.get(2)!.hull).toBe(70);
    // Turn advanced 1 → 2.
    expect(result.state.turn).toBe(2);
    // No victory yet.
    expect(result.outcome).toBeNull();
  });
});

describe('runTurn — blind commit is structural (FR-17 / §6.3)', () => {
  it('a commander sees NO plans / pendingPlans / coordinator field on its view', async () => {
    const state = buildInitialState(cfg([
      fleet(0, [ship('A')]),
      fleet(1, [ship('B')]),
    ]));
    const cap0 = capturing(0);
    const cap1 = capturing(1);
    await runTurn(state, [cap0.commander, cap1.commander]);
    // Each captured view has ONLY the allowed keys.
    for (const view of [...cap0.captured, ...cap1.captured]) {
      const keys = Object.keys(view);
      for (const banned of ['plans', 'pendingPlans', 'coordinator', 'commanders']) {
        expect(keys.includes(banned)).toBe(false);
      }
    }
  });
});

describe('runTurn — determinism (N-turn digest equality)', () => {
  it('same seed + same scripted plans over N turns ⇒ identical final digest', async () => {
    const build = (): MatchState => {
      let s = buildInitialState(cfg([
        fleet(0, [ship('A')]),
        fleet(1, [ship('B')]),
      ]));
      s = withBody(s, 1, { position: { x: -100, y: 0, z: 0 } });
      s = withBody(s, 2, { position: { x: 100, y: 0, z: 0 } });
      return s;
    };
    const commanders = (): Commander[] => [
      scripted(0, [], [{ shooterId: 1, targetId: 2, weaponIndex: 0 }]),
      scripted(1, [], [{ shooterId: 2, targetId: 1, weaponIndex: 0 }]),
    ];
    const digest = (s: MatchState): string =>
      JSON.stringify(
        Array.from(s.ships.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([id, sc]) => ({ id, h: sc.hull, s: sc.shields })),
      );
    let s1 = build();
    let s2 = build();
    for (let t = 0; t < 3; t += 1) {
      s1 = (await runTurn(s1, commanders())).state;
      s2 = (await runTurn(s2, commanders())).state;
    }
    expect(digest(s1)).toBe(digest(s2));
  });
});

describe('runMatch — loops to victory', () => {
  it('reaches a decisive outcome with the correct fleetId', async () => {
    let state = buildInitialState(cfg([
      fleet(0, [ship('A', { maxHull: 100 })]),
      fleet(1, [ship('B', { maxHull: 30 })]),
    ]));
    state = withBody(state, 1, { position: { x: -100, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 100, y: 0, z: 0 } });
    // Fleet 0 attacks B every turn; fleet 1 does nothing (B dies turn 1).
    const c0 = scripted(0, [], [{ shooterId: 1, targetId: 2, weaponIndex: 0 }]);
    const c1 = scripted(1, [], []);
    const result = await runMatch(state, [c0, c1], 20);
    expect(result.outcome.kind).toBe('victory');
    if (result.outcome.kind === 'victory') {
      expect(result.outcome.fleetId).toBe(0);
    }
    // Trace has at least one turn recorded + the outcome stamped.
    expect(result.trace.turns.length).toBeGreaterThan(0);
    expect(result.trace.outcome).not.toBeNull();
  });

  it('maxTurnsGuard is TEST-ONLY (throws if exceeded — not a game rule)', async () => {
    // Two indestructible fleets doing nothing → would loop forever without the guard.
    let state = buildInitialState(cfg([
      fleet(0, [ship('A')]),
      fleet(1, [ship('B')]),
    ]));
    state = withBody(state, 1, { position: { x: -3000, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 3000, y: 0, z: 0 } });
    const c0 = scripted(0, [], []);
    const c1 = scripted(1, [], []);
    await expect(runMatch(state, [c0, c1], 3)).rejects.toThrow(/maxTurnsGuard/);
  });
});
