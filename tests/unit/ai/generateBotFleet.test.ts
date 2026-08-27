// generateBotFleet — property tests locking FR-31 / FR-4 / FR-10 / FR-29 / FR-30
// against the shipped v1 catalog. Grows across the three session checkpoints:
//   • CP1 stub: `buildOneShip` produces one legal, priced ship at a small budget.
//   • CP2:      `generateBotFleet` produces a non-empty legal fleet at a mid budget.
//   • CP3:      seven property tests across every legal budget × every tier.
//
// The catalog is loaded once at module init; every test reuses the same
// instance. Determinism holds by construction (all draws through `mathx/rng`);
// the tests double-check by asserting deep-equality on repeated calls.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import { pointCost, validateFit } from '../../../src/domain/index.js';
import {
  buildOneShip,
  deriveFleetSeed,
} from '../../../src/ai/generateBotFleet.js';

const catalog = loadCatalog();

describe('CP1 — buildOneShip smoke (primitive)', () => {
  it('produces one legal, priced ship inside a small budget', () => {
    const seed = deriveFleetSeed(1, 'rookie');
    const smallBudget = 25;
    const built = buildOneShip(catalog, seed, 0, smallBudget, {
      id: 'test-bot-25-rookie-0',
      schemaVersion: 1,
      catalogVersion: catalog.catalogVersion,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(built).not.toBeNull();
    if (built === null) return;

    // Validates against the current catalog.
    const validated = validateFit(catalog, built.build);
    expect(validated.ok).toBe(true);

    // Priced within the given budget (Decision 9).
    expect(built.cost).toBeLessThanOrEqual(smallBudget);

    // storedCost is the authoring-instant fact — equal to current pointCost.
    expect(built.build.storedCost).toBe(pointCost(catalog, built.build));
    expect(built.build.storedCost).toBe(built.cost);
  });
});
