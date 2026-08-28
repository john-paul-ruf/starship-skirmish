// M14 UI — Shipyard `catalogInfo` coverage (playtest-feedback-03 · S03 CP1).
//
// Locks the invariants the InfoTip wiring depends on:
//   1. Every live catalog id (all 26 components + 12 chassis at v1) has a
//      non-empty CATALOG_INFO blurb — a new item can't ship a bare row.
//   2. CATALOG_INFO has no orphan keys — a removed id (impossible today per
//      FR-1 additive-only, but the guard is cheap) surfaces here.
//   3. Every COMPONENT id has a non-empty DIFF_TAG — the picker rows read
//      apart at a glance; a new component can't ship without one.
//   4. DIFF_TAG has no chassis or orphan keys — chassis rows deliberately
//      skip the tag layer (see catalogInfo.ts rationale).
//
// Mirrors the shape/tone of the `GLOSSARY` coverage the derived-stat rows
// enforce — this is UI-side reference text, so the drift-safe guard is a
// test, not a catalog-schema constraint.

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import {
  CATALOG_INFO,
  DIFF_TAG,
  diffTagFor,
  infoFor,
} from '../../../../src/ui/screens/shipyard/catalogInfo.js';

const catalog = loadCatalog();

const componentIds = catalog.allComponents().map((c) => c.id);
const chassisIds = catalog.allChassis().map((c) => c.id);
const allCatalogIds = [...componentIds, ...chassisIds];

describe('CATALOG_INFO — every catalog id has a non-empty blurb (S03 CP1)', () => {
  it('covers all 26 v1 components (sanity: count matches loader)', () => {
    // A regression tripwire — the v1 catalog is frozen at 26 components (FR-1
    // additive-only, so this can only grow). If a session in a later feature
    // adds a component and doesn't update CATALOG_INFO, the per-id test below
    // fails with a named id; this one names the count drift.
    expect(componentIds.length).toBeGreaterThanOrEqual(26);
  });

  it('covers all 12 v1 chassis (sanity: count matches loader)', () => {
    expect(chassisIds.length).toBeGreaterThanOrEqual(12);
  });

  it.each(allCatalogIds)(
    'CATALOG_INFO[`%s`] is a non-empty string',
    (id) => {
      const blurb = CATALOG_INFO[id];
      expect(blurb).toBeDefined();
      expect(typeof blurb).toBe('string');
      // A one-line blurb is at least ~20 chars — anything shorter is a stub,
      // not a definition. Matches the GLOSSARY floor.
      expect((blurb ?? '').length).toBeGreaterThan(20);
    },
  );

  it('has no orphan CATALOG_INFO keys — every key is a live catalog id', () => {
    const liveIds = new Set(allCatalogIds);
    const orphans = Object.keys(CATALOG_INFO).filter((k) => !liveIds.has(k));
    expect(orphans).toEqual([]);
  });

  it('infoFor accessor returns the same blurb as the map', () => {
    // Non-cosmetic: the wiring layer calls `infoFor(id)` per row; a divergence
    // between the map and the accessor would silently break the InfoTip label.
    for (const id of allCatalogIds) {
      expect(infoFor(id)).toBe(CATALOG_INFO[id]);
    }
    expect(infoFor('nope-not-real')).toBeUndefined();
  });
});

describe('DIFF_TAG — every component id has a differentiator tag (S03 CP1)', () => {
  it.each(componentIds)(
    'DIFF_TAG[`%s`] is a non-empty string',
    (id) => {
      const tag = DIFF_TAG[id];
      expect(tag).toBeDefined();
      expect(typeof tag).toBe('string');
      expect((tag ?? '').length).toBeGreaterThan(0);
      // Tags are all-caps by convention (rendered in the mock's `.t-label`
      // treatment); enforce the convention so a new entry can't slip in lower.
      expect(tag).toBe((tag ?? '').toUpperCase());
    },
  );

  it('has no chassis or orphan DIFF_TAG keys', () => {
    const componentIdSet = new Set(componentIds);
    const chassisIdSet = new Set(chassisIds);
    const stray = Object.keys(DIFF_TAG).filter(
      (k) => !componentIdSet.has(k) || chassisIdSet.has(k),
    );
    expect(stray).toEqual([]);
  });

  it('diffTagFor accessor returns the same tag as the map', () => {
    for (const id of componentIds) {
      expect(diffTagFor(id)).toBe(DIFF_TAG[id]);
    }
    // Chassis rows deliberately have no tag — accessor returns undefined so
    // the picker's fallback (no tag chip) triggers naturally.
    for (const id of chassisIds) {
      expect(diffTagFor(id)).toBeUndefined();
    }
    expect(diffTagFor('nope-not-real')).toBeUndefined();
  });
});
