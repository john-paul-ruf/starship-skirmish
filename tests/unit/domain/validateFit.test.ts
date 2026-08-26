// M05 Domain — validateFit tests (S02 checkpoint 3, FR-4 / §3.2).
//
// The full error-code matrix: legal fit passes; wrong-type slot →
// ERR_SLOT_TYPE_MISMATCH; wrong slot count → ERR_SLOT_COUNT; unknown component
// → ERR_UNKNOWN_COMPONENT; unknown chassis → ERR_UNKNOWN_CHASSIS. Plus the
// structural check that a fighter layout has no shield or missile slot (a
// component in "an absent slot type" is impossible by construction of a legal
// empty build, so we assert the class-identity property directly).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { Build, BuildMeta, FitError } from '../../../src/domain/types.js';
import { emptyBuild, withSlot } from '../../../src/domain/build.js';
import { validateFit } from '../../../src/domain/validateFit.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const bogusBuild = (overrides: Partial<Build> = {}): Build => ({
  id: 'x',
  name: 'x',
  tags: [],
  chassisId: 'cru-hammerhead',
  slots: [null, null, null, null, null, null, null, null, null],
  storedCost: 30,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('validateFit — the happy path', () => {
  it('accepts an all-empty cruiser (empty slots are legal — FR-4)', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const v = validateFit(catalog, b.value);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value._validated).toBe(true);
    expect(v.value.build).toBe(b.value);
  });

  it('accepts a fully-legal cruiser fit', () => {
    // Cruiser layout: weapon, weapon, weapon, shield, shield, missile, missile, engine, special
    // We only fit weapons+shields+special here; missile/engine slots stay empty (legal).
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-pulse-array');
    fitted = withSlot(fitted, 1, 'wpn-scatter-gun');
    fitted = withSlot(fitted, 2, 'wpn-fusion-lance');
    fitted = withSlot(fitted, 3, 'shd-skim');
    fitted = withSlot(fitted, 4, 'shd-fluxweave');
    fitted = withSlot(fitted, 8, 'spc-damage-control');
    const v = validateFit(catalog, fitted);
    expect(v.ok).toBe(true);
  });
});

describe('validateFit — ERR_UNKNOWN_CHASSIS', () => {
  it('reports a single ERR_UNKNOWN_CHASSIS and skips per-slot checks', () => {
    const v = validateFit(catalog, bogusBuild({ chassisId: 'nope-does-not-exist' }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toHaveLength(1);
    expect(v.error[0]?.code).toBe('ERR_UNKNOWN_CHASSIS');
    expect(v.error[0]?.id).toBe('nope-does-not-exist');
  });
});

describe('validateFit — ERR_SLOT_COUNT', () => {
  it('reports slot-count mismatch when the fit has too few slots', () => {
    // Cruiser layout is 9 slots; give the fit 8.
    const v = validateFit(
      catalog,
      bogusBuild({ slots: [null, null, null, null, null, null, null, null] }),
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const count = v.error.find((e) => e.code === 'ERR_SLOT_COUNT');
    expect(count).toBeDefined();
  });

  it('reports slot-count mismatch when the fit has too many slots', () => {
    // Cruiser layout is 9 slots; give the fit 10.
    const tooMany = Array<string | null>(10).fill(null);
    const v = validateFit(catalog, bogusBuild({ slots: tooMany }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_SLOT_COUNT')).toBe(true);
  });
});

describe('validateFit — ERR_UNKNOWN_COMPONENT', () => {
  it('reports an unknown component id at the exact slot', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'wpn-nope');
    const v = validateFit(catalog, fitted);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toHaveLength(1);
    const err = v.error[0];
    expect(err?.code).toBe('ERR_UNKNOWN_COMPONENT');
    expect(err?.id).toBe('wpn-nope');
    expect(err?.slotIndex).toBe(0);
  });
});

describe('validateFit — ERR_SLOT_TYPE_MISMATCH', () => {
  it('reports a shield component in a weapon slot with expected/actual + slotIndex', () => {
    // Cruiser slot 0 is a weapon; drop a shield in it.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'shd-skim');
    const v = validateFit(catalog, fitted);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toHaveLength(1);
    const err = v.error[0];
    expect(err?.code).toBe('ERR_SLOT_TYPE_MISMATCH');
    expect(err?.id).toBe('shd-skim');
    expect(err?.slotIndex).toBe(0);
    expect(err?.expected).toBe('weapon');
    expect(err?.actual).toBe('shield');
  });

  it('reports a weapon in a shield slot (the mirror case)', () => {
    // Cruiser slot 3 is a shield; drop a weapon in it.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 3, 'wpn-pulse-array');
    const v = validateFit(catalog, fitted);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const err = v.error[0];
    expect(err?.code).toBe('ERR_SLOT_TYPE_MISMATCH');
    expect(err?.expected).toBe('shield');
    expect(err?.actual).toBe('weapon');
  });
});

describe('validateFit — collects ALL violations, not first-fail (FR-5)', () => {
  it('reports multiple slot-type mismatches together', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let bad = withSlot(b.value, 0, 'shd-skim');       // shield in weapon slot
    bad = withSlot(bad, 3, 'wpn-pulse-array');        // weapon in shield slot
    bad = withSlot(bad, 8, 'wpn-fusion-lance');       // weapon in special slot
    const v = validateFit(catalog, bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const mismatches = v.error.filter((e) => e.code === 'ERR_SLOT_TYPE_MISMATCH');
    expect(mismatches).toHaveLength(3);
    const indexes = mismatches
      .map((m) => m.slotIndex)
      .filter((i): i is number => typeof i === 'number')
      .sort((a, b2) => a - b2);
    expect(indexes).toEqual([0, 3, 8]);
  });

  it('reports slot-count AND per-slot mismatches together (overlap region)', () => {
    // Short-fit a cruiser to 3 slots, with a wrong-type shield in slot 0.
    const short: readonly (string | null)[] = ['shd-skim', null, null];
    const v = validateFit(catalog, bogusBuild({ slots: short }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const codes = v.error.map((e) => e.code).sort();
    expect(codes).toContain('ERR_SLOT_COUNT');
    expect(codes).toContain('ERR_SLOT_TYPE_MISMATCH');
  });

  it('reports unknown component AND mismatched type in the same call', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let bad = withSlot(b.value, 0, 'wpn-does-not-exist');
    bad = withSlot(bad, 3, 'wpn-pulse-array');
    const v = validateFit(catalog, bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const codes = v.error.map((e) => e.code).sort();
    expect(codes).toContain('ERR_UNKNOWN_COMPONENT');
    expect(codes).toContain('ERR_SLOT_TYPE_MISMATCH');
  });
});

describe('validateFit — class-identity structural checks (FR-3)', () => {
  it('fighter layouts contain no shield or missile slots — an "absent slot type" cannot be fitted at all', () => {
    // A component in an absent slot type is impossible by construction: emptyBuild
    // gives you exactly the layout's slots, and withSlot's out-of-range guard fires
    // before you can add an extra one. Assert the class-identity property directly.
    const layout = catalog.slotLayout('fighter');
    expect(layout).toBeDefined();
    expect(layout).not.toContain('shield');
    expect(layout).not.toContain('missile');
  });
});

describe('validateFit — ValidatedBuild is a nominal marker (design decision)', () => {
  it('carries the underlying Build by reference (not a re-shape)', () => {
    const b = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const v = validateFit(catalog, b.value);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // Same Build object reference; the marker is a thin wrapper.
    expect(v.value.build).toBe(b.value);
    // The `_validated: true` literal type is the compile-time gate; asserting
    // its runtime value here documents the design (S03 uses this shape).
    const nominal: true = v.value._validated;
    expect(nominal).toBe(true);
  });

  it('the FitError shape is what the UI needs (code + message; optional slotIndex/id/expected/actual)', () => {
    // Not truly a test, more a structural pin: if we widen the FitError shape,
    // the UI's error-panel props change too. Pin the shape.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'shd-skim');
    const v = validateFit(catalog, fitted);
    if (v.ok) throw new Error('expected err');
    const err: FitError | undefined = v.error[0];
    expect(err).toBeDefined();
    if (!err) return;
    expect(typeof err.code).toBe('string');
    expect(typeof err.message).toBe('string');
  });
});
