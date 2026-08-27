// M16 App — player + bot commander locks (S01 CP3).
//
// The load-bearing property: the player commander's `planMovement` /
// `planAttack` return promises that resolve EXACTLY when the matching
// `resolveMovement` / `resolveAttack` handle fires — that is the promise-backed
// FR-17 seam the UI commit callbacks drive. Plus: a stray resolve with no plan
// awaited is a no-op, and `makeBotCommanders` maps tiers → fleet ids in order.

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import {
  seedOf,
  type BlindMatchView,
  type MovementPlan,
} from '../../../../src/sim/index.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { assembleMatchConfig } from '../../../../src/app/match/config.js';
import {
  makeBotCommanders,
  makePlayerCommander,
} from '../../../../src/app/match/commanders.js';

// The player commander ignores the view it is handed, so a bare cast suffices.
const FAKE_VIEW = {} as BlindMatchView;

describe('makePlayerCommander — the promise resolves on commit', () => {
  it('planMovement stays pending until resolveMovement fires', async () => {
    const handle = makePlayerCommander(0);
    const pending = Promise.resolve(handle.commander.planMovement(FAKE_VIEW));

    let settled: MovementPlan[] | null = null;
    void pending.then((v) => {
      settled = v;
    });
    // A microtask turn is not enough — nothing has committed yet.
    await Promise.resolve();
    expect(settled).toBeNull();

    const plans: readonly MovementPlan[] = [{ bodyId: 1, deltaV: { x: 3, y: 0, z: 0 } }];
    handle.resolveMovement(plans);
    const got = await pending;
    expect(got).toEqual(plans);
  });

  it('planAttack resolves with the committed attack plans', async () => {
    const handle = makePlayerCommander(0);
    const pending = Promise.resolve(handle.commander.planAttack(FAKE_VIEW));
    handle.resolveAttack([{ shooterId: 1, targetId: 2, weaponIndex: 0 }]);
    const got = await pending;
    expect(got).toEqual([{ shooterId: 1, targetId: 2, weaponIndex: 0 }]);
  });

  it('a stray resolve with no plan awaited is a no-op (does not throw)', () => {
    const handle = makePlayerCommander(0);
    expect(() => handle.resolveMovement([])).not.toThrow();
    expect(() => handle.resolveAttack([])).not.toThrow();
  });
});

describe('makeBotCommanders — one HeuristicCommander per bot fleet, tiers in order', () => {
  it('maps fleets → commanders with matching fleet ids', () => {
    const catalog = loadCatalog();
    const budget = catalog.tuning.match.legalBudgets[0]!;
    const player = generateBotFleet(catalog, budget, 'ace', 1);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      budget,
      seedOf(1, 2),
      player,
      [
        { tier: 'rookie', rngKey: 10 },
        { tier: 'veteran', rngKey: 20 },
      ],
    );
    const botFleets = config.fleets.slice(1);
    const commanders = makeBotCommanders(
      botFleets,
      ['rookie', 'veteran'],
      config.physics,
      config.combat,
    );
    expect(commanders).toHaveLength(2);
    expect(commanders.map((c) => c.fleetId)).toEqual([1, 2]);
  });
});
