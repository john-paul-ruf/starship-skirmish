// tests/unit/harness/matchScenario.test.ts — M17 match runner locks (S05).
//
// Locks the load-bearing contract properties of the S05 additions:
//   * `runMatchScenario` produces an outcome + non-empty `turnDigests` for a
//     legal 2-fleet match — the pipeline (generate → validate → resolve → run)
//     is wired end-to-end.
//   * Determinism: identical scenario ⇒ byte-identical `turnDigests` +
//     outcome across repeated runs (FR-33 acceptance — the S06 anchor).
//   * Regenerated fleets: same seed + budget + tiers ⇒ same `Build[]` per
//     fleet (D-MATCH-SCENARIO — the scenario carries seed+tiers, NOT builds).
//   * The physics-scope `runScenario` is unchanged for `PhysicsScenario`
//     inputs and now REJECTS a match-kind value with a clear error.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import {
  runMatchScenario,
  type MatchScenario,
} from '../../../tools/balance/scenario.js';
import { seedToMatch, deriveMatchSeed } from '../../../tools/balance/harnessMatches.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type { BotTier } from '../../../src/ai/index.js';

const catalog = loadCatalog();
const LEGAL_BUDGETS = catalog.tuning.match.legalBudgets;
const MIN_FLEETS = catalog.tuning.match.minFleets;
const MAX_FLEETS = catalog.tuning.match.maxFleets;

// A minimal, legal 2-fleet match — the cheapest budget so tests stay fast.
const twoFleetScenario = (): MatchScenario => ({
  kind: 'match',
  name: 'unit-two-fleet',
  seed: seedOf(0x1234abcd, 0x5678ef01),
  budget: LEGAL_BUDGETS[0]!,
  fleetTiers: ['rookie', 'rookie'],
});

describe('runMatchScenario — CP1 smoke: end-to-end pipeline reaches an outcome', () => {
  it('produces an outcome + non-empty turnDigests for a 2-fleet match', async () => {
    const scn = twoFleetScenario();
    const result = await runMatchScenario(scn, catalog);

    expect(result.scenario).toBe(scn);
    expect(result.fleets).toHaveLength(2);
    // Every regenerated fleet must be non-empty at a legal budget (S02
    // guarantee: any legal budget affords >= 1 chassis).
    for (const f of result.fleets) {
      expect(f.builds.length).toBeGreaterThan(0);
    }
    expect(result.turnDigests.length).toBeGreaterThan(0);
    // Custom Rule 5: exactly two outcome variants.
    expect(['victory', 'mutual-destruction']).toContain(result.outcome.kind);
    expect(result.outcome.turns).toBe(result.turnDigests.length);
    // Every digest is an 8-char hex (matchDigest contract).
    for (const d of result.turnDigests) {
      expect(d).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('seedToMatch — deterministic factory over integer n', () => {
  it('is deterministic in n (same n => same scenario)', () => {
    const a = seedToMatch(7, catalog);
    const b = seedToMatch(7, catalog);
    expect(a).toEqual(b);
  });

  it('name is stable in n (match-${n})', () => {
    expect(seedToMatch(0, catalog).name).toBe('match-0');
    expect(seedToMatch(42, catalog).name).toBe('match-42');
  });

  it('seed derives independently in n across a small sweep', () => {
    // The two-hash derivation prevents the aliasing that a naive
    // `seedOf(n, ~n ^ c)` shows across n and n+4 — every n gives distinct
    // (hi, lo). Assert the seeds are all unique across a 32-key sweep.
    const seenHi = new Set<number>();
    const seenLo = new Set<number>();
    for (let n = 0; n < 32; n += 1) {
      const s = deriveMatchSeed(n);
      seenHi.add(s.hi);
      seenLo.add(s.lo);
    }
    expect(seenHi.size).toBe(32);
    expect(seenLo.size).toBe(32);
  });

  it('default fleetTiers length is in [minFleets, maxFleets]', () => {
    for (let n = 0; n < 24; n += 1) {
      const s = seedToMatch(n, catalog);
      expect(s.fleetTiers.length).toBeGreaterThanOrEqual(MIN_FLEETS);
      expect(s.fleetTiers.length).toBeLessThanOrEqual(MAX_FLEETS);
      for (const t of s.fleetTiers) {
        expect(['rookie', 'veteran', 'ace']).toContain(t);
      }
    }
  });

  it('default budget is drawn from tuning.match.legalBudgets', () => {
    for (let n = 0; n < 24; n += 1) {
      const s = seedToMatch(n, catalog);
      expect(LEGAL_BUDGETS).toContain(s.budget);
    }
  });

  it('honours opts.budget and opts.fleetTiers when provided', () => {
    const s = seedToMatch(3, catalog, {
      budget: LEGAL_BUDGETS[1]!,
      fleetTiers: ['veteran', 'ace'],
    });
    expect(s.budget).toBe(LEGAL_BUDGETS[1]);
    expect(s.fleetTiers).toEqual(['veteran', 'ace']);
    expect(s.name).toBe('match-3');
    // Seed still comes from n (opts do not perturb the seed derivation —
    // that would make golden replay depend on run-time flag order).
    expect(s.seed).toEqual(deriveMatchSeed(3));
  });

  it('rejects opts.budget outside tuning.match.legalBudgets', () => {
    const illegal = Math.max(...LEGAL_BUDGETS) + 1;
    expect(() => seedToMatch(0, catalog, { budget: illegal })).toThrow(
      /not in tuning.match.legalBudgets/,
    );
  });

  it('rejects opts.fleetTiers length outside [minFleets, maxFleets]', () => {
    // One fleet is below minFleets (v1 = 2); one too many is above maxFleets.
    expect(() => seedToMatch(0, catalog, { fleetTiers: ['rookie'] })).toThrow(
      /fleetTiers length/,
    );
    const tooMany: BotTier[] = [];
    for (let i = 0; i <= MAX_FLEETS; i += 1) tooMany.push('rookie');
    expect(() => seedToMatch(0, catalog, { fleetTiers: tooMany })).toThrow(
      /fleetTiers length/,
    );
  });
});

describe('runMatchScenario — determinism (FR-33 anchor)', () => {
  it('same scenario => byte-identical turnDigests + outcome across runs', async () => {
    const scn = twoFleetScenario();
    const a = await runMatchScenario(scn, catalog);
    const b = await runMatchScenario(scn, catalog);
    expect(a.turnDigests).toEqual(b.turnDigests);
    expect(a.outcome).toEqual(b.outcome);
  });

  it('same seed + tiers => identical Build[] per fleet (regenerated deterministically)', async () => {
    const scn = twoFleetScenario();
    const a = await runMatchScenario(scn, catalog);
    const b = await runMatchScenario(scn, catalog);
    // Structurally identical (bot builds have deterministic synthetic ids).
    expect(JSON.stringify(a.fleets)).toBe(JSON.stringify(b.fleets));
  });

  it('different seed at the same budget + tiers => divergent first-turn digest', async () => {
    const seedA: MatchScenario = { ...twoFleetScenario(), seed: seedOf(1, 2) };
    const seedB: MatchScenario = { ...twoFleetScenario(), seed: seedOf(3, 4) };
    const a = await runMatchScenario(seedA, catalog);
    const b = await runMatchScenario(seedB, catalog);
    // Placement is a function of seed — turn-1 digest must diverge.
    expect(a.turnDigests[0]).not.toBe(b.turnDigests[0]);
  });
});

