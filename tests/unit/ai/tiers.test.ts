// tiers — locks the FR-30 negative-space invariant and the FR-25 / FR-29 knob
// gating that the whole `src/ai/` module leans on.
//
// The three tiers must differ ONLY by decision quality — never by a stat, budget,
// or point modifier. Test (5) is what makes "no such field exists" mechanically
// checked rather than promised: if a future edit slips a `hullBonus` (or any
// stat / budget / point / modifier / bonus field) into `TierConfig`, the
// negative-space assertion fires.

import { describe, expect, it } from 'vitest';
import { BOT_TIERS, TIER_CONFIG } from '../../../src/ai/tiers.js';

/** The declared decision-knob key set — nothing outside this may exist on a TierConfig. */
const DECISION_KNOB_KEYS: ReadonlySet<string> = new Set([
  'planningHorizon',
  'cruiseSpeedFraction',
  'candidateLadder',
  'targeting',
  'enableCalledShots',
  'enableAoeFriendlyFireCheck',
  'enablePredictiveIntercept',
]);

/** FR-30 forbids any of these substrings from appearing in a TierConfig key. */
const STAT_MODIFIER_PATTERN = /hull|shield|damage|armor|evasion|mass|cost|budget|point|modifier|bonus/i;

describe('BOT_TIERS / TIER_CONFIG shape', () => {
  it('lists exactly the three canonical tiers, in strength order', () => {
    expect(BOT_TIERS).toEqual(['rookie', 'veteran', 'ace']);
  });

  it('has one TIER_CONFIG entry per BOT_TIERS entry, no extras', () => {
    const configKeys = Object.keys(TIER_CONFIG).sort();
    const tierKeys = [...BOT_TIERS].sort();
    expect(configKeys).toEqual(tierKeys);
  });
});

describe('monotonic decision quality (design.md §4.10, Gate-2 §2)', () => {
  it('planningHorizon is strictly increasing rookie → veteran → ace (1 < 2 < 3)', () => {
    const horizons = BOT_TIERS.map((t) => TIER_CONFIG[t].planningHorizon);
    expect(horizons).toEqual([1, 2, 3]);
    for (let i = 1; i < horizons.length; i++) {
      const prev = horizons[i - 1] as number;
      const cur = horizons[i] as number;
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it('cruiseSpeedFraction is non-decreasing and strictly in (0, 1) — brakeable-in-one-beat', () => {
    const fractions = BOT_TIERS.map((t) => TIER_CONFIG[t].cruiseSpeedFraction);
    for (const f of fractions) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
    for (let i = 1; i < fractions.length; i++) {
      const prev = fractions[i - 1] as number;
      const cur = fractions[i] as number;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });
});

describe('FR-25 called-shot gating', () => {
  it('rookie disables called shots; veteran and ace enable them', () => {
    expect(TIER_CONFIG.rookie.enableCalledShots).toBe(false);
    expect(TIER_CONFIG.veteran.enableCalledShots).toBe(true);
    expect(TIER_CONFIG.ace.enableCalledShots).toBe(true);
  });
});

describe('FR-29 ace-only knob gating', () => {
  it('enableAoeFriendlyFireCheck is true only for ace', () => {
    expect(TIER_CONFIG.rookie.enableAoeFriendlyFireCheck).toBe(false);
    expect(TIER_CONFIG.veteran.enableAoeFriendlyFireCheck).toBe(false);
    expect(TIER_CONFIG.ace.enableAoeFriendlyFireCheck).toBe(true);
  });

  it('enablePredictiveIntercept is true only for ace', () => {
    expect(TIER_CONFIG.rookie.enablePredictiveIntercept).toBe(false);
    expect(TIER_CONFIG.veteran.enablePredictiveIntercept).toBe(false);
    expect(TIER_CONFIG.ace.enablePredictiveIntercept).toBe(true);
  });
});

describe('FR-30 negative space — decision knobs ONLY, no stat modifier field', () => {
  it('every TierConfig has only the declared decision-knob keys, nothing more', () => {
    for (const tier of BOT_TIERS) {
      const keys = Object.keys(TIER_CONFIG[tier]);
      for (const key of keys) {
        expect(DECISION_KNOB_KEYS.has(key)).toBe(true);
      }
      // Also assert the decision-knob set is fully realized — a missing knob would
      // still pass the above; this catches partial configs too.
      expect(keys.length).toBe(DECISION_KNOB_KEYS.size);
    }
  });

  it('no TierConfig key names a ship-stat / budget / point / modifier / bonus (Custom Rule 4)', () => {
    for (const tier of BOT_TIERS) {
      const keys = Object.keys(TIER_CONFIG[tier]);
      for (const key of keys) {
        expect(STAT_MODIFIER_PATTERN.test(key)).toBe(false);
      }
    }
  });
});
