// M05 Domain — build constructor tests (S02 checkpoint 1).
//
// Exercises `emptyBuild`, `withSlot`, and `slotTypesFor` against the shipped v1
// catalog. Load the real catalog once; a construction helper mints synthetic
// identity fields so domain stays wall-clock-free and UUID-free (§3.2 —
// identity is minted by persist/io, carried through here).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta } from '../../../src/domain/types.js';
import { emptyBuild, slotTypesFor, withSlot } from '../../../src/domain/build.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('emptyBuild — layout-shaped null slots (FR-3, FR-4)', () => {
  it('mints a cruiser Build with 9 null slots (Hammerhead)', () => {
    const result = emptyBuild(catalog, 'cru-hammerhead', 'Test Hammerhead', meta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const build = result.value;
    expect(build.chassisId).toBe('cru-hammerhead');
    expect(build.name).toBe('Test Hammerhead');
    expect(build.slots).toHaveLength(9);
    for (const slot of build.slots) expect(slot).toBeNull();
  });

  it('mints a fighter Build with a 3-slot [weapon, engine, special] shape (Needle)', () => {
    const result = emptyBuild(catalog, 'fig-needle', 'Test Needle', meta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.slots).toHaveLength(3);
    expect(slotTypesFor(catalog, result.value)).toEqual(['weapon', 'engine', 'special']);
  });

  it('seeds storedCost to the chassis point cost only (§3.3 historical fact)', () => {
    const result = emptyBuild(catalog, 'cru-hammerhead', 'Fresh', meta());
    if (!result.ok) throw new Error('expected ok');
    // Hammerhead costs 30; every slot is empty; storedCost should be chassis-only.
    expect(result.value.storedCost).toBe(30);
  });

  it('carries the meta identity through verbatim', () => {
    const m = meta();
    const result = emptyBuild(catalog, 'fig-needle', 'Named', m);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.id).toBe(m.id);
    expect(result.value.schemaVersion).toBe(m.schemaVersion);
    expect(result.value.catalogVersion).toBe(m.catalogVersion);
    expect(result.value.createdAt).toBe(m.createdAt);
    expect(result.value.updatedAt).toBe(m.updatedAt);
  });

  it('accepts a tags array and copies it (immutability)', () => {
    const source: string[] = ['test', 'draft'];
    const result = emptyBuild(catalog, 'fig-needle', 'Tagged', meta(), source);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.tags).toEqual(['test', 'draft']);
    source.push('mutated');
    expect(result.value.tags).toEqual(['test', 'draft']);
  });

  it('defaults tags to []', () => {
    const result = emptyBuild(catalog, 'fig-needle', 'NoTags', meta());
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.tags).toEqual([]);
  });

  it('returns ERR_UNKNOWN_CHASSIS when the id does not resolve', () => {
    const result = emptyBuild(catalog, 'nope-does-not-exist', 'x', meta());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ERR_UNKNOWN_CHASSIS');
    expect(result.error.id).toBe('nope-does-not-exist');
  });
});

describe('withSlot — immutable slot set', () => {
  it('returns a new Build without mutating the input', () => {
    const result = emptyBuild(catalog, 'cru-hammerhead', 'Base', meta());
    if (!result.ok) throw new Error('expected ok');
    const before = result.value;
    const after = withSlot(before, 0, 'wpn-fusion-lance');

    expect(after).not.toBe(before);
    expect(before.slots[0]).toBeNull();
    expect(after.slots[0]).toBe('wpn-fusion-lance');
    // Other slots untouched
    expect(after.slots.slice(1)).toEqual(before.slots.slice(1));
  });

  it('accepts null to clear a slot', () => {
    const empty = emptyBuild(catalog, 'cru-hammerhead', 'Base', meta());
    if (!empty.ok) throw new Error('expected ok');
    const filled = withSlot(empty.value, 0, 'wpn-fusion-lance');
    const cleared = withSlot(filled, 0, null);
    expect(cleared.slots[0]).toBeNull();
  });

  it('does NOT enforce slot-type legality — that is validateFit\'s job', () => {
    // A shield component in a weapon slot must be allowed by the setter; the UI
    // catches this by filtering the picker, and validateFit reports it if it slips through.
    const empty = emptyBuild(catalog, 'cru-hammerhead', 'Base', meta());
    if (!empty.ok) throw new Error('expected ok');
    const illegalFit = withSlot(empty.value, 0, 'shd-skim');
    expect(illegalFit.slots[0]).toBe('shd-skim');
  });

  it('throws RangeError on negative index', () => {
    const empty = emptyBuild(catalog, 'fig-needle', 'Base', meta());
    if (!empty.ok) throw new Error('expected ok');
    expect(() => withSlot(empty.value, -1, 'wpn-pulse-array')).toThrow(RangeError);
  });

  it('throws RangeError on index >= slots.length', () => {
    const empty = emptyBuild(catalog, 'fig-needle', 'Base', meta()); // fighter = 3 slots
    if (!empty.ok) throw new Error('expected ok');
    expect(() => withSlot(empty.value, 3, 'wpn-pulse-array')).toThrow(RangeError);
    expect(() => withSlot(empty.value, 99, 'wpn-pulse-array')).toThrow(RangeError);
  });

  it('throws RangeError on non-integer index', () => {
    const empty = emptyBuild(catalog, 'fig-needle', 'Base', meta());
    if (!empty.ok) throw new Error('expected ok');
    expect(() => withSlot(empty.value, 1.5, 'wpn-pulse-array')).toThrow(RangeError);
  });
});

describe('slotTypesFor — the fittable layout', () => {
  it('returns the frozen layout for a fighter', () => {
    const empty = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!empty.ok) throw new Error('expected ok');
    expect(slotTypesFor(catalog, empty.value)).toEqual(['weapon', 'engine', 'special']);
  });

  it('returns the frozen layout for a cruiser (9 slots)', () => {
    const empty = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!empty.ok) throw new Error('expected ok');
    const layout = slotTypesFor(catalog, empty.value);
    expect(layout).toHaveLength(9);
    expect(layout).toEqual([
      'weapon',
      'weapon',
      'weapon',
      'shield',
      'shield',
      'missile',
      'missile',
      'engine',
      'special',
    ]);
  });

  it('returns [] for a Build with an unresolved chassisId (defensive)', () => {
    // Synthesise a Build with a bogus chassisId — the real error is validateFit's.
    const bogus = {
      id: 'x',
      name: 'x',
      tags: [],
      chassisId: 'nope-does-not-exist',
      slots: [null],
      storedCost: 0,
      schemaVersion: 1,
      catalogVersion: 1,
      createdAt: '',
      updatedAt: '',
    } as const;
    expect(slotTypesFor(catalog, bogus)).toEqual([]);
  });
});
