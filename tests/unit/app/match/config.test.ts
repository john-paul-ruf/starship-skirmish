// M16 App — assembleMatchConfig locks (S01 CP3).
//
// Proves the domain seam turns a real player fleet + one bot spec into a legal
// `MatchConfig`: both fleets `validateFit`-legal (assembly throws otherwise),
// `Σ storedCost ≤ budget`, roster ids 0 / 1, and the three sim configs present.
// A build that fails validateFit is a caller bug → assembly throws.

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import { seedOf } from '../../../../src/sim/index.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { pointCost } from '../../../../src/domain/index.js';
import {
  assembleMatchConfig,
  PLAYER_FLEET_ID,
} from '../../../../src/app/match/config.js';
import type { BotSpec } from '../../../../src/ui/matchContext.js';

const catalog = loadCatalog();
const tuning = catalog.tuning;
const BUDGET = tuning.match.legalBudgets[0]!;
const SEED = seedOf(0x1234abcd, 0x5678ef01);

// A legal player fleet — reuse `generateBotFleet` (legal by construction, same
// catalog + budget the player draws from) so the test needs no hand-authored
// builds. These are plain `Build[]`; assembleMatchConfig re-validates them.
const playerBuilds = generateBotFleet(catalog, BUDGET, 'ace', 0x0a11ce);
const botSpecs: readonly BotSpec[] = [{ tier: 'veteran', rngKey: 0xbeef }];

describe('assembleMatchConfig — a real player + bot fleet become a legal MatchConfig', () => {
  const config = assembleMatchConfig(catalog, tuning, BUDGET, SEED, playerBuilds, botSpecs);

  it('produces one fleet per roster with ids 0 (player) then 1..N (bots)', () => {
    expect(config.fleets).toHaveLength(1 + botSpecs.length);
    expect(config.fleets[0]!.fleetId).toBe(PLAYER_FLEET_ID);
    expect(config.fleets[1]!.fleetId).toBe(PLAYER_FLEET_ID + 1);
  });

  it('every fleet has at least one resolved ship', () => {
    for (const fleet of config.fleets) {
      expect(fleet.ships.length).toBeGreaterThan(0);
    }
  });

  it('carries the supplied seed and the three budget-derived sim configs', () => {
    expect(config.seed).toEqual(SEED);
    expect(config.arena.radius).toBeGreaterThan(0);
    expect(config.physics.dt).toBeGreaterThan(0);
    expect(config.combat.hazards.debrisLifetimeTurns).toBeGreaterThan(0);
  });

  it('Σ storedCost ≤ budget for the player fleet (under-budget is legal, FR-5)', () => {
    const total = playerBuilds.reduce((sum, b) => sum + pointCost(catalog, b), 0);
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});

describe('assembleMatchConfig — an illegal player build is a caller bug', () => {
  it('throws when a player build fails validateFit', () => {
    // Break fit-legality: a surplus slot makes slots.length mismatch the layout.
    const legal = playerBuilds[0]!;
    const illegal = { ...legal, slots: [...legal.slots, null] };
    expect(() =>
      assembleMatchConfig(catalog, tuning, BUDGET, SEED, [illegal], []),
    ).toThrow();
  });
});
