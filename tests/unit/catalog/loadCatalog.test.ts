// M03 loader tests — exercises query patterns Q1..Q6 from specs/database.md §8
// against the shipped v1 catalog.

import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../../../src/catalog/loadCatalog.js';
import type { ChassisClass, SlotType } from '../../../src/catalog/types.js';

const catalog = loadCatalog();

describe('loadCatalog — v1 shape', () => {
  it('reports catalogVersion 1', () => {
    expect(catalog.catalogVersion).toBe(1);
  });

  it('flattens to 12 chassis and 26 components', () => {
    expect(catalog.allChassis()).toHaveLength(12);
    expect(catalog.allComponents()).toHaveLength(26);
  });

  it('exposes 4 classes', () => {
    const classes: readonly ChassisClass[] = ['fighter', 'frigate', 'cruiser', 'mega-destroyer'];
    for (const c of classes) {
      expect(catalog.classOf(c)?.id).toBe(c);
    }
  });

  it('exposes tuning', () => {
    expect(catalog.tuning.catalogVersion).toBe(1);
    expect(catalog.tuning.match.legalBudgets).toEqual([25, 50, 75, 100, 125, 150]);
    expect(Object.keys(catalog.tuning.arena.radiusByBudget)).toHaveLength(6);
  });

  it('is frozen (Object.freeze on the returned Catalog)', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
  });
});

describe('loadCatalog — Q1 resolve by id', () => {
  it('resolves chassis by id', () => {
    expect(catalog.chassis('cru-hammerhead')?.ordinal).toBe(7);
    expect(catalog.chassis('cru-hammerhead')?.classId).toBe('cruiser');
    expect(catalog.chassis('fig-needle')?.hullPoints).toBe(18);
    expect(catalog.chassis('meg-oblivion')?.classId).toBe('mega-destroyer');
  });

  it('resolves components by id', () => {
    expect(catalog.component('wpn-fusion-lance')?.ordinal).toBe(17);
    expect(catalog.component('wpn-fusion-lance')?.slotType).toBe('weapon');
    expect(catalog.component('spc-damage-control')?.slotType).toBe('special');
  });

  it('returns undefined for unknown ids (noUncheckedIndexedAccess)', () => {
    expect(catalog.chassis('nope-does-not-exist')).toBeUndefined();
    expect(catalog.component('nope-does-not-exist')).toBeUndefined();
  });
});

describe('loadCatalog — Q2 componentsForSlot', () => {
  it('lists only fittable components per slot type', () => {
    const cases: readonly [SlotType, number][] = [
      ['weapon', 6],
      ['shield', 5],
      ['missile', 5],
      ['engine', 5],
      ['special', 5],
    ];
    for (const [slot, expectedCount] of cases) {
      const list = catalog.componentsForSlot(slot);
      expect(list).toHaveLength(expectedCount);
      for (const c of list) {
        expect(c.slotType).toBe(slot);
      }
    }
  });

  it('returns components in ordinal order for stable output', () => {
    const weapons = catalog.componentsForSlot('weapon');
    const ordinals = weapons.map((w) => w.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});

describe('loadCatalog — Q3 chassisOfClass + slotLayout', () => {
  it('groups chassis by classId (3 per class)', () => {
    expect(catalog.chassisOfClass('fighter')).toHaveLength(3);
    expect(catalog.chassisOfClass('frigate')).toHaveLength(3);
    expect(catalog.chassisOfClass('cruiser')).toHaveLength(3);
    expect(catalog.chassisOfClass('mega-destroyer')).toHaveLength(3);
  });

  it('slotLayout returns the frozen per-class layout', () => {
    expect(catalog.slotLayout('fighter')).toEqual(['weapon', 'engine', 'special']);
    expect(catalog.slotLayout('frigate')).toEqual([
      'weapon',
      'weapon',
      'shield',
      'missile',
      'engine',
      'special',
    ]);
    expect(catalog.slotLayout('cruiser')?.length).toBe(9);
    expect(catalog.slotLayout('mega-destroyer')?.length).toBe(12);
  });

  it('fighters have NO shield and NO missile slot (structural class identity)', () => {
    const fighter = catalog.slotLayout('fighter');
    expect(fighter).toBeDefined();
    expect(fighter).not.toContain('shield');
    expect(fighter).not.toContain('missile');
  });
});

describe('loadCatalog — Q4 ordinalOf (encode)', () => {
  it('maps chassis ids to their ordinal', () => {
    expect(catalog.ordinalOf('fig-needle')).toBe(1);
    expect(catalog.ordinalOf('cru-hammerhead')).toBe(7);
    expect(catalog.ordinalOf('meg-oblivion')).toBe(12);
  });

  it('maps component ids to their ordinal in the shared space', () => {
    expect(catalog.ordinalOf('wpn-pulse-array')).toBe(13);
    expect(catalog.ordinalOf('spc-damage-control')).toBe(38);
  });

  it('returns undefined for unknown ids', () => {
    expect(catalog.ordinalOf('nope-does-not-exist')).toBeUndefined();
  });
});

describe('loadCatalog — Q5 byOrdinal (decode)', () => {
  it('resolves chassis ordinals to ChassisDef', () => {
    expect(catalog.byOrdinal(7)?.id).toBe('cru-hammerhead');
    expect(catalog.byOrdinal(1)?.id).toBe('fig-needle');
  });

  it('resolves component ordinals to ComponentDef', () => {
    expect(catalog.byOrdinal(17)?.id).toBe('wpn-fusion-lance');
    expect(catalog.byOrdinal(38)?.id).toBe('spc-damage-control');
  });

  it('resolves across the shared ordinal space with no type parameter', () => {
    // Ordinal 12 is the last chassis; ordinal 13 is the first component.
    expect(catalog.byOrdinal(12)?.id).toBe('meg-oblivion');
    expect(catalog.byOrdinal(13)?.id).toBe('wpn-pulse-array');
  });

  it('returns undefined for the reserved 0 and any unallocated ordinal', () => {
    expect(catalog.byOrdinal(0)).toBeUndefined();
    expect(catalog.byOrdinal(999)).toBeUndefined();
  });
});

describe('loadCatalog — accessor stability', () => {
  it('allChassis is ordinal-sorted', () => {
    const ordinals = catalog.allChassis().map((c) => c.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });

  it('allComponents is ordinal-sorted', () => {
    const ordinals = catalog.allComponents().map((c) => c.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});
