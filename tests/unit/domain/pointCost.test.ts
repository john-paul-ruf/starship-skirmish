// M05 Domain — pointCost + pointBreakdown tests (S02 checkpoint 2).
//
// Session-mandated cases: known chassis + one weapon → known total; all-empty
// build → chassis cost only; pointBreakdown.total === pointCost; no leftover
// surface anywhere.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta } from '../../../src/domain/types.js';
import { emptyBuild, withSlot } from '../../../src/domain/build.js';
import { pointBreakdown, pointCost } from '../../../src/domain/pointCost.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('pointCost — FR-5 chassis + Σ fitted components', () => {
  it('empty cruiser costs the chassis alone (Hammerhead = 30)', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    expect(pointCost(catalog, b.value)).toBe(30);
  });

  it('Hammerhead (30) + Fusion Lance (7) in one weapon slot = 37', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'wpn-fusion-lance');
    expect(pointCost(catalog, fitted)).toBe(37);
  });

  it('empty fighter (Needle = 4) contributes only chassis cost', () => {
    const b = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    expect(pointCost(catalog, b.value)).toBe(4);
  });

  it('sums across multiple fitted slots', () => {
    // Hammerhead (30) + Pulse Array (2) + Fluxweave (3) + Skim Field (1) = 36
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-pulse-array');
    fitted = withSlot(fitted, 3, 'shd-fluxweave');
    fitted = withSlot(fitted, 4, 'shd-skim');
    expect(pointCost(catalog, fitted)).toBe(30 + 2 + 3 + 1);
  });

  it('unknown component ids contribute 0 (defensive guard — pipeline validates first)', () => {
    const b = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'wpn-does-not-exist');
    expect(pointCost(catalog, fitted)).toBe(4);
  });

  it('unknown chassis contributes 0 too — the full guard', () => {
    // Synthesise a Build with an unresolvable chassis. Real code wouldn't reach
    // pointCost with one; this proves it doesn't crash on programmer error.
    const bogus = {
      id: 'x',
      name: 'x',
      tags: [],
      chassisId: 'nope',
      slots: [null],
      storedCost: 0,
      schemaVersion: 1,
      catalogVersion: 1,
      createdAt: '',
      updatedAt: '',
    } as const;
    expect(pointCost(catalog, bogus)).toBe(0);
  });
});

describe('pointBreakdown — per-slot lines, no leftover surface', () => {
  it('total === pointCost for the same build', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-fusion-lance');
    fitted = withSlot(fitted, 3, 'shd-fluxweave');
    const bd = pointBreakdown(catalog, fitted);
    expect(bd.total).toBe(pointCost(catalog, fitted));
  });

  it('one slotCost line per layout slot, with correct index + id', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'wpn-fusion-lance');
    const bd = pointBreakdown(catalog, fitted);
    expect(bd.slotCosts).toHaveLength(9);
    expect(bd.slotCosts[0]).toEqual({ index: 0, componentId: 'wpn-fusion-lance', cost: 7 });
    // All other slots are empty and cost 0.
    for (let i = 1; i < bd.slotCosts.length; i += 1) {
      expect(bd.slotCosts[i]).toEqual({ index: i, componentId: null, cost: 0 });
    }
  });

  it('reports chassisCost separately', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const bd = pointBreakdown(catalog, b.value);
    expect(bd.chassisCost).toBe(30);
    expect(bd.total).toBe(30);
  });

  it('exposes NO leftover / conversion / budget surface (Decision 9 / FR-5)', () => {
    const b = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const bd = pointBreakdown(catalog, b.value);
    const keys = Object.keys(bd);
    // Structural check: only the three declared keys, nothing else.
    expect(keys.sort()).toEqual(['chassisCost', 'slotCosts', 'total']);
    // Belt-and-braces: explicitly deny the forbidden field names.
    for (const forbidden of ['leftoverPoints', 'pointsBanked', 'conversionRate', 'remaining', 'budget']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
