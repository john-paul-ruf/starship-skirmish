// M16 App — hitChanceFor mirrors the resolver's out-of-range refusal
// (playtest-feedback-04 SESSION-01 CP1 / D-HITCHANCE-RANGE-GATE).
//
// The playtest bug: `HitChanceBreakdown.final` is clamped to HIT_FLOOR (0.05)
// by the pure formula in `sim/rules/damage.ts`. When a target sits BEYOND
// `weapon.range` the range ratio collapses to 0, so the formula reads 5% —
// but `sim/rules/attack.ts` REFUSES the shot entirely (`range > weapon.range
// continue`), so the true fire count is zero. The bench was lying: 5% shown,
// 0% real. Lock the gate at the single seam that publishes the breakdown.
//
// Node-only (no JSX). Injects a scripted MatchState onto the readonly signal
// (same handle trick controller.test.ts already relies on) so the geometry is
// exact — no reliance on random placement.

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import {
  HIT_FLOOR,
  seedOf,
  type Body,
  type MatchState,
  type ShipCombat,
  type SimShip,
  type SimWeapon,
} from '../../../../src/sim/index.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { assembleMatchConfig, PLAYER_FLEET_ID } from '../../../../src/app/match/config.js';
import { createMatchController } from '../../../../src/app/match/controller.js';
import type { Route } from '../../../../src/ui/appContext.js';

const captureRoutes = () => {
  const routes: Route[] = [];
  return { services: { navigate: (to: Route) => routes.push(to) }, routes };
};

const catalog = loadCatalog();
const BUDGET = catalog.tuning.match.legalBudgets[0]!;

/**
 * Build a controller and immediately overwrite `state.value` with a scripted
 * two-ship state — one shooter with one custom weapon, one stationary target
 * at `distance` world-units along the +x axis. `evasion` and shield/hull
 * shape stay at whatever the underlying generator produced; the fields we
 * poke below are the only ones `hitChanceFor` reads.
 */
const setupTwoShips = (opts: {
  readonly weapon: SimWeapon;
  readonly distance: number;
  readonly evasion?: number;
  readonly targetSpeed?: number;
}): { readonly controller: ReturnType<typeof createMatchController>; readonly shooterId: number; readonly targetId: number } => {
  const player = generateBotFleet(catalog, BUDGET, 'ace', 1);
  const config = assembleMatchConfig(
    catalog,
    catalog.tuning,
    BUDGET,
    seedOf(0x0011, 0x0022),
    player,
    [{ tier: 'veteran', rngKey: 7 }],
  );
  const { services } = captureRoutes();
  const controller = createMatchController(services, config, ['veteran']);
  const stateSignal = controller.state as unknown as { value: MatchState };
  const s0 = stateSignal.value;

  // Pick two real ships from the generated state (any two will do) — we
  // rewrite their weapons/positions below so their catalog identity is
  // irrelevant. Sort by id so the pick is deterministic.
  const ids = Array.from(s0.ships.keys()).sort((a, b) => a - b);
  const shooterId = ids[0]!;
  const targetId = ids[1]!;
  const shooterSrc = s0.ships.get(shooterId)!;
  const targetSrc = s0.ships.get(targetId)!;
  const shooterBodySrc = s0.bodies.get(shooterId)!;
  const targetBodySrc = s0.bodies.get(targetId)!;

  const shooterShip: SimShip = { ...shooterSrc.ship, weapons: [opts.weapon] };
  const shooter: ShipCombat = {
    ...shooterSrc,
    ship: shooterShip,
    weaponAlive: [true],
  };
  const targetShip: SimShip = {
    ...targetSrc.ship,
    baseEvasion: opts.evasion ?? 0,
    // Neutralise decoys — evasionWithDecoy walks decoyAlive; empty array is fine.
    decoys: [],
  };
  const target: ShipCombat = {
    ...targetSrc,
    ship: targetShip,
    decoyAlive: [],
    decoyCharges: [],
    decoyActiveUntilTurn: 0,
  };

  const shooterBody: Body = {
    ...shooterBodySrc,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const targetBody: Body = {
    ...targetBodySrc,
    position: { x: opts.distance, y: 0, z: 0 },
    velocity: { x: opts.targetSpeed ?? 0, y: 0, z: 0 },
  };

  const nextShips = new Map(s0.ships);
  nextShips.set(shooterId, shooter);
  nextShips.set(targetId, target);
  const nextBodies = new Map(s0.bodies);
  nextBodies.set(shooterId, shooterBody);
  nextBodies.set(targetId, targetBody);

  stateSignal.value = { ...s0, ships: nextShips, bodies: nextBodies };

  return { controller, shooterId, targetId };
};

const weapon = (over: Partial<SimWeapon> = {}): SimWeapon => ({
  range: 1000,
  damage: 10,
  shotsPerTurn: 1,
  accuracy: 0.7,
  ...over,
});

describe('hitChanceFor — out-of-range refusal (D-HITCHANCE-RANGE-GATE)', () => {
  it('returns final:0 when the target sits beyond weapon.range', () => {
    // Playtest evidence: W1 · RANGE 3000 vs a target at 3285u used to read 5%.
    // Post-gate: the breakdown is honest — 0% across every derived factor.
    const { controller, shooterId, targetId } = setupTwoShips({
      weapon: weapon({ range: 3000, accuracy: 0.65 }),
      distance: 3285,
    });
    const b = controller.hitChanceFor(shooterId, targetId, 0);
    expect(b.final).toBe(0);
    expect(b.rangeFactor).toBe(0);
    expect(b.velocityFactor).toBe(0);
    expect(b.evasionFactor).toBe(0);
    // BASE is still weapon.accuracy — the breakdown surfaces the weapon's own
    // stat even when the shot can't happen (WeaponBench already renders it).
    expect(b.base).toBe(0.65);
  });

  it('an in-range hard shot still floors at HIT_FLOOR (5%)', () => {
    // High evasion + a shot near max range → the pure formula would drop
    // below HIT_FLOOR; the clamp inside `hitChance` is what keeps it at 5%.
    // The out-of-range gate MUST NOT intrude on this legitimate 5% floor.
    const { controller, shooterId, targetId } = setupTwoShips({
      weapon: weapon({ range: 1000, accuracy: 0.4 }),
      distance: 990,   // deep in the falloff, but strictly IN range
      evasion: 0.95,   // near-maxed evasion pushes raw product very low
      targetSpeed: 700, // + big velocity penalty
    });
    const b = controller.hitChanceFor(shooterId, targetId, 0);
    expect(b.final).toBeGreaterThanOrEqual(HIT_FLOOR);
    // And every derived factor is still > 0 (the pure formula ran) — the
    // gate did NOT fire.
    expect(b.rangeFactor).toBeGreaterThan(0);
  });

  it('exactly at max range is IN range (mirrors sim/rules/attack.ts `range > weapon.range`)', () => {
    // The resolver's gate is strict `>`, so distance === weapon.range still
    // fires. The floor still applies (rangeFactor collapses to 0 at the edge
    // → raw product 0 → clamps to HIT_FLOOR) — so the breakdown reads 5%,
    // NOT the 0% the out-of-range branch would return.
    const { controller, shooterId, targetId } = setupTwoShips({
      weapon: weapon({ range: 800, accuracy: 0.6 }),
      distance: 800,
    });
    const b = controller.hitChanceFor(shooterId, targetId, 0);
    expect(b.final).toBe(HIT_FLOOR);
  });
});

// Concede so the created match doesn't linger as a running microtask loop
// past the test — a courtesy for --watch, not required for correctness.
describe('cleanup', () => {
  it('concede after each test-controller so the driveTurn microtask exits', () => {
    const { controller } = setupTwoShips({ weapon: weapon(), distance: 100 });
    controller.concede();
    expect(controller.phase.value).toBe('complete');
    expect(controller.playerFleetId).toBe(PLAYER_FLEET_ID);
  });
});
