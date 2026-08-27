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
import type { Build } from '../../../src/domain/index.js';
import { BOT_TIERS, type BotTier } from '../../../src/ai/tiers.js';
import {
  buildOneShip,
  deriveFleetSeed,
  generateBotFleet,
} from '../../../src/ai/generateBotFleet.js';

const catalog = loadCatalog();
const LEGAL_BUDGETS: readonly number[] = catalog.tuning.match.legalBudgets;
const HULL_CAP: number = catalog.tuning.match.fleetHullCap;

// Sum of `storedCost` across a fleet — the value FR-5 caps against `budget`.
// `storedCost` on a bot-built Build is set to the current `pointCost` in
// `buildOneShip`, so the two are equal at authoring time.
const sumStoredCost = (fleet: readonly Build[]): number =>
  fleet.reduce((acc, build) => acc + build.storedCost, 0);

// Multiset fingerprint of a fleet — used to check that two fleets differ. Two
// fleets are considered "the same" if they field the same chassis + slot-fill
// composition, regardless of ship id (identity fields intentionally derive
// from inputs, so they always differ across `rngKey`).
const fingerprint = (fleet: readonly Build[]): string => {
  const perShip = fleet.map((b) => `${b.chassisId}|${b.slots.join(',')}`);
  return [...perShip].sort().join(';');
};

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

describe('CP2 — generateBotFleet baseline', () => {
  it('produces a non-empty legal fleet at a mid budget (rookie)', () => {
    const budget = 75;
    const fleet = generateBotFleet(catalog, budget, 'rookie', 42);
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet.length).toBeLessThanOrEqual(HULL_CAP);
    expect(sumStoredCost(fleet)).toBeLessThanOrEqual(budget);
    for (const build of fleet) {
      expect(validateFit(catalog, build).ok).toBe(true);
    }
  });
});

describe('CP3 — property suite across all budgets × tiers', () => {
  // A small handful of rngKeys that exercise the mixer across each budget×tier
  // matrix. Fixed integers — no `Math.random`, no wall clock.
  const RNG_KEYS: readonly number[] = [0, 1, 7, 2026, 0xdeadbeef];

  it('(1) legality — every Build in every generated fleet passes validateFit (FR-4/FR-31)', () => {
    for (const budget of LEGAL_BUDGETS) {
      for (const tier of BOT_TIERS) {
        for (const rngKey of RNG_KEYS) {
          const fleet = generateBotFleet(catalog, budget, tier, rngKey);
          for (const build of fleet) {
            const validated = validateFit(catalog, build);
            expect(validated.ok).toBe(true);
          }
        }
      }
    }
  });

  it('(2) budget — Σ pointCost ≤ budget for every fleet; no leftover/conversion field on Build (Decision 9)', () => {
    for (const budget of LEGAL_BUDGETS) {
      for (const tier of BOT_TIERS) {
        for (const rngKey of RNG_KEYS) {
          const fleet = generateBotFleet(catalog, budget, tier, rngKey);
          // Two independently computed sums — both ≤ budget, and equal to each
          // other (storedCost at authoring == current pointCost).
          const storedSum = sumStoredCost(fleet);
          const pricedSum = fleet.reduce(
            (acc, b) => acc + pointCost(catalog, b),
            0,
          );
          expect(storedSum).toBeLessThanOrEqual(budget);
          expect(pricedSum).toBeLessThanOrEqual(budget);
          expect(storedSum).toBe(pricedSum);

          // Negative-space: no leftover / conversion / points-banked field on
          // any Build (Custom Rule 4). Absence is the enforcement.
          for (const build of fleet) {
            for (const key of Object.keys(build)) {
              expect(key).not.toMatch(/leftover|conversion|banked|remaining/i);
            }
          }
        }
      }
    }
  });

  it('(3) hull cap — fleet length ≤ tuning.match.fleetHullCap for every fleet (FR-10)', () => {
    for (const budget of LEGAL_BUDGETS) {
      for (const tier of BOT_TIERS) {
        for (const rngKey of RNG_KEYS) {
          const fleet = generateBotFleet(catalog, budget, tier, rngKey);
          expect(fleet.length).toBeLessThanOrEqual(HULL_CAP);
        }
      }
    }
  });

  it('(4) non-empty — every legal budget yields ≥ 1 ship for every tier', () => {
    for (const budget of LEGAL_BUDGETS) {
      for (const tier of BOT_TIERS) {
        for (const rngKey of RNG_KEYS) {
          const fleet = generateBotFleet(catalog, budget, tier, rngKey);
          expect(fleet.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('(5) variation — different rngKeys produce different fleets at budgets that admit variety (FR-31)', () => {
    // Small budgets (25) may admit only a handful of legal fleets; we don't
    // demand variation there. Every budget large enough to fit multiple ships
    // and multiple chassis choices per pick MUST see distinct fleets across
    // two different rngKeys.
    const budgetsWithVariety = LEGAL_BUDGETS.filter((b) => b >= 75);
    expect(budgetsWithVariety.length).toBeGreaterThan(0);
    for (const budget of budgetsWithVariety) {
      for (const tier of BOT_TIERS) {
        const a = generateBotFleet(catalog, budget, tier, 1);
        const b = generateBotFleet(catalog, budget, tier, 2);
        expect(fingerprint(a)).not.toBe(fingerprint(b));
      }
    }
  });

  it('(6) determinism — same (budget, tier, rngKey) yields deep-equal fleets across calls', () => {
    for (const budget of LEGAL_BUDGETS) {
      for (const tier of BOT_TIERS) {
        for (const rngKey of RNG_KEYS) {
          const a = generateBotFleet(catalog, budget, tier, rngKey);
          const b = generateBotFleet(catalog, budget, tier, rngKey);
          expect(a).toStrictEqual(b);
        }
      }
    }
  });

  it('(7) no-advantage — swapping tier at fixed (budget, rngKey) still yields legal, in-budget fleets (FR-29/30)', () => {
    // The tier CHANGES which legal fleet is drawn (variety input), but every
    // tier's fleet must still be validateFit-legal and ≤ budget. No tier
    // produces a fleet that exceeds budget or fields an illegal ship.
    for (const budget of LEGAL_BUDGETS) {
      for (const rngKey of RNG_KEYS) {
        for (const tier of BOT_TIERS) {
          const fleet = generateBotFleet(catalog, budget, tier, rngKey);
          expect(fleet.length).toBeGreaterThan(0);
          expect(sumStoredCost(fleet)).toBeLessThanOrEqual(budget);
          for (const build of fleet) {
            expect(validateFit(catalog, build).ok).toBe(true);
          }
        }
      }
    }
  });

  it('(7b) no-advantage — no chassis is unavailable to any tier at the same budget', () => {
    // Structural: every tier draws from the SAME catalog.allChassis() — there
    // is no per-tier chassis filter. Over many rngKeys at fixed budget, every
    // tier sees a comparable diversity of chassis picks. This locks the
    // absence of hidden per-tier gating (a softer companion to test (7)).
    const MANY_KEYS = Array.from({ length: 40 }, (_v, i) => i);
    const budget = 100;
    const chassisSeenPerTier = new Map<BotTier, Set<string>>();
    for (const tier of BOT_TIERS) {
      const seen = new Set<string>();
      for (const rngKey of MANY_KEYS) {
        const fleet = generateBotFleet(catalog, budget, tier, rngKey);
        for (const build of fleet) seen.add(build.chassisId);
      }
      chassisSeenPerTier.set(tier, seen);
    }
    // Every tier sees at least two distinct chassis at budget=100 — a weak
    // presence check that would fail if a tier were secretly restricted.
    for (const tier of BOT_TIERS) {
      const seen = chassisSeenPerTier.get(tier)!;
      expect(seen.size).toBeGreaterThanOrEqual(2);
    }
  });
});
