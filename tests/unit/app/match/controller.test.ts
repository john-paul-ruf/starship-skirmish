// M16 App — match controller loop locks (S01 CP4).
//
// Scripts a full turn against real commanders and asserts:
//   1. Phase transitions movement-plan → movement-resolve → attack-plan →
//      attack-resolve, paced by commit + resolveAnimationDone callbacks.
//   2. A one-fleet-standing state transitions to `complete` with a `victory`
//      outcome (Custom Rule 5 — three branches, no draw/timeout).
//   3. The controller navigates the phase→route coupling (move → post-match).
//   4. `hitChanceFor` equals a direct `sim/rules.hitChance` call on the same
//      inputs — the UI reads the published breakdown, never recomputes (§13.3).

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import { distance, hitChance, length, seedOf } from '../../../../src/sim/index.js';
import type { Route } from '../../../../src/ui/appContext.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { assembleMatchConfig } from '../../../../src/app/match/config.js';
import { createMatchController } from '../../../../src/app/match/controller.js';

// A macrotask boundary flushes the driver's chained microtasks between steps.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const catalog = loadCatalog();
const BUDGET = catalog.tuning.match.legalBudgets[0]!;

const captureRoutes = () => {
  const routes: Route[] = [];
  return { services: { navigate: (to: Route) => routes.push(to) }, routes };
};

describe('createMatchController — one scripted turn to victory (single fleet)', () => {
  it('walks the phase machine and completes with a victory outcome', async () => {
    // A single fleet → after turn 1 exactly one fleet stands → victory(0).
    const player = generateBotFleet(catalog, BUDGET, 'ace', 7);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0xabcd, 0x1234),
      player,
      [],
    );
    const { services, routes } = captureRoutes();
    const controller = createMatchController(services, config, []);

    await flush();
    expect(controller.phase.value).toBe('movement-plan');
    expect(routes.at(-1)).toEqual({ name: 'tactical-move' });

    controller.commitMovement([]);
    await flush();
    expect(controller.phase.value).toBe('movement-resolve');
    expect(controller.movementBeat.value).not.toBeNull();

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('attack-plan');
    expect(routes.at(-1)).toEqual({ name: 'tactical-attack' });

    controller.commitAttack([]);
    await flush();
    expect(controller.phase.value).toBe('attack-resolve');
    expect(controller.attackBeat.value).not.toBeNull();

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('complete');
    expect(controller.outcome.value?.kind).toBe('victory');
    expect(routes.at(-1)).toEqual({ name: 'post-match' });
    // The trace recorded exactly the one decided turn.
    expect(controller.trace.value.turns).toHaveLength(1);
    expect(controller.trace.value.outcome?.kind).toBe('victory');
  });
});

describe('createMatchController — hitChanceFor matches sim/rules.hitChance', () => {
  it('returns the published breakdown for the same inputs', () => {
    const player = generateBotFleet(catalog, BUDGET, 'ace', 2);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0x5555, 0x6666),
      player,
      [{ tier: 'veteran', rngKey: 99 }],
    );
    const { services } = captureRoutes();
    const controller = createMatchController(services, config, ['veteran']);

    const s = controller.state.value;
    // Find any ship with a weapon (shooter) and any other ship (target).
    const shipIds = Array.from(s.ships.keys()).sort((a, b) => a - b);
    const shooterId = shipIds.find((id) => s.ships.get(id)!.ship.weapons.length > 0);
    expect(shooterId).toBeDefined();
    const targetId = shipIds.find((id) => id !== shooterId);
    expect(targetId).toBeDefined();

    const shooter = s.ships.get(shooterId!)!;
    const target = s.ships.get(targetId!)!;
    const shooterBody = s.bodies.get(shooterId!)!;
    const targetBody = s.bodies.get(targetId!)!;

    // Replicate the private targetEvasion (base + active decoy; none active at t1).
    let evasion = target.ship.baseEvasion;
    if (target.decoyActiveUntilTurn >= s.turn) {
      for (let i = 0; i < target.decoyAlive.length; i += 1) {
        if (target.decoyAlive[i]!) {
          evasion += target.ship.decoys[i]!.evasionBonus;
          break;
        }
      }
    }
    const expected = hitChance(
      shooter.ship.weapons[0]!,
      distance(shooterBody.position, targetBody.position),
      length(targetBody.velocity),
      evasion,
    );

    expect(controller.hitChanceFor(shooterId!, targetId!, 0)).toEqual(expected);
  });
});
