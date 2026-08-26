// M05 Domain — refitDiff tests (S03 checkpoint 2, FR-2 Ruling A / §3.3 / design §4.7).
//
// Same cost → null; stale storedCost → oldTotal/newTotal/delta + one line per slot
// carrying CURRENT per-slot cost. `needsRefit` is the boolean form. No `needsRefit`
// field is ever stored on the Build itself.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { Build, BuildMeta } from '../../../src/domain/types.js';
import { emptyBuild, withSlot } from '../../../src/domain/build.js';
import { pointCost } from '../../../src/domain/pointCost.js';
import { needsRefit, refitDiff } from '../../../src/domain/refitDiff.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// Build a Build with a specific `storedCost` — models the historical fact.
const withStoredCost = (b: Build, storedCost: number): Build => ({ ...b, storedCost });

describe('refitDiff — returns null when the build is at current price', () => {
  it('empty Hammerhead (storedCost = 30, current = 30) → null', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    // emptyBuild seeds storedCost to chassis cost — 30 for Hammerhead.
    expect(b.value.storedCost).toBe(30);
    expect(refitDiff(catalog, b.value)).toBeNull();
    expect(needsRefit(catalog, b.value)).toBe(false);
  });

  it('fitted build whose storedCost matches current price → null', () => {
    // Hammerhead (30) + Fusion Lance (7) = 37. Fake the historical storedCost as 37.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withStoredCost(withSlot(b.value, 0, 'wpn-fusion-lance'), 37);
    expect(refitDiff(catalog, fitted)).toBeNull();
    expect(needsRefit(catalog, fitted)).toBe(false);
  });
});

describe('refitDiff — reports old/new/delta + per-slot current lines when the total moved', () => {
  it('storedCost 30 → newTotal 37 → diff.delta = +7 (Hammerhead + Fusion Lance)', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    // Simulate: build was authored under a v0 catalog where the lance cost less,
    // stored as 30. Under current catalog the lance is 7 → total 37.
    const fitted = withStoredCost(withSlot(b.value, 0, 'wpn-fusion-lance'), 30);
    const diff = refitDiff(catalog, fitted);
    expect(diff).not.toBeNull();
    if (diff === null) return;
    expect(diff.oldTotal).toBe(30);
    expect(diff.newTotal).toBe(37);
    expect(diff.delta).toBe(7);
    expect(diff.newTotal).toBe(pointCost(catalog, fitted));
  });

  it('storedCost 40 → newTotal 30 (build got CHEAPER) → diff.delta = -10', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withStoredCost(b.value, 40); // empty, current cost 30
    const diff = refitDiff(catalog, fitted);
    expect(diff).not.toBeNull();
    if (diff === null) return;
    expect(diff.oldTotal).toBe(40);
    expect(diff.newTotal).toBe(30);
    expect(diff.delta).toBe(-10);
  });

  it('one line per slot; lines carry CURRENT per-slot cost (§3.3 does not store historical per-line prices)', () => {
    // Hammerhead has 9 slots. Fit one weapon; the rest are empty.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withStoredCost(withSlot(b.value, 0, 'wpn-fusion-lance'), 20);
    const diff = refitDiff(catalog, fitted);
    if (diff === null) throw new Error('expected diff');
    expect(diff.lines).toHaveLength(9);
    // Slot 0: weapon fitted at current cost 7 (Fusion Lance).
    expect(diff.lines[0]).toEqual({ index: 0, componentId: 'wpn-fusion-lance', currentCost: 7 });
    // Every other slot: empty, currentCost 0.
    for (let i = 1; i < diff.lines.length; i += 1) {
      expect(diff.lines[i]).toEqual({ index: i, componentId: null, currentCost: 0 });
    }
  });

  it('lines only expose {index, componentId, currentCost} — no historical/leftover surface', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withStoredCost(withSlot(b.value, 0, 'wpn-fusion-lance'), 20);
    const diff = refitDiff(catalog, fitted);
    if (diff === null) throw new Error('expected diff');
    const line = diff.lines[0];
    expect(line).toBeDefined();
    if (!line) return;
    expect(Object.keys(line).sort()).toEqual(['componentId', 'currentCost', 'index']);
    for (const forbidden of ['oldCost', 'historicalCost', 'delta', 'pointsBanked']) {
      expect(Object.keys(line)).not.toContain(forbidden);
    }
  });
});

describe('refitDiff — RefitDiff shape', () => {
  it('exposes exactly {oldTotal, newTotal, delta, lines}', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withStoredCost(b.value, 40);
    const diff = refitDiff(catalog, fitted);
    if (diff === null) throw new Error('expected diff');
    expect(Object.keys(diff).sort()).toEqual(['delta', 'lines', 'newTotal', 'oldTotal']);
  });
});

describe('needsRefit — the boolean shortcut', () => {
  it('false when totals match', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    expect(needsRefit(catalog, b.value)).toBe(false);
  });

  it('true when totals differ', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    expect(needsRefit(catalog, withStoredCost(b.value, 999))).toBe(true);
  });

  it('does NOT write anywhere on the Build — computed, not cached (§3.3)', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const built = b.value;
    needsRefit(catalog, built);
    // The Build shape does not gain a `needsRefit` field.
    expect(Object.prototype.hasOwnProperty.call(built, 'needsRefit')).toBe(false);
  });
});
