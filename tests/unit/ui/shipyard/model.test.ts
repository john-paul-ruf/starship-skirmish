// Shipyard model — node-env unit tests (S05).
//
// Drives the REAL catalog + REAL domain through `src/ui/screens/shipyard/model.ts`.
// The tests intentionally never touch `Shipyard.tsx` (see S03 handoff: unit
// tests that import through `src/ui/index.ts` or the .tsx surface would
// pull JSX into `tsc --noEmit -p tsconfig.node.json`).
//
// CP1: chassis grouping + per-class layout counts + slot-label positioning.
// CP2: fit / swap / cost / validation aggregation.
// CP3: derived stats & delta wiring.
// CP4: prepareSave + buildShareLink + share-token round-trip.

import { describe, expect, it, beforeAll } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Catalog, ChassisDef } from '../../../../src/catalog/index.js';
import type { SlotType } from '../../../../src/catalog/index.js';
import type { Build, BuildMeta } from '../../../../src/domain/index.js';
import { withSlot } from '../../../../src/domain/index.js';

import {
  CLASS_ORDER,
  chassisByClass,
  createFreshBuild,
  slotLabels,
  snapshot,
} from '../../../../src/ui/screens/shipyard/model.js';

// ---- shared catalog fixture -----------------------------------------------

let catalog: Catalog;

beforeAll(() => {
  catalog = loadCatalog();
});

// ---- deterministic identity clock for tests -------------------------------

const clock = {
  newId: () => 'test-uuid-0000',
  now: () => '2026-08-27T00:00:00.000Z',
};

const CATALOG_SCHEMA_VERSION = 1;

// ---- CP1 — chassis grouping + slot labels ---------------------------------

describe('chassisByClass — CLASS_ORDER + per-class layout counts (S05 CP1)', () => {
  it('returns one group per non-empty class in CLASS_ORDER', () => {
    const groups = chassisByClass(catalog);
    const seen = groups.map((g) => g.classId);
    // Every group in CLASS_ORDER is present (v1 catalog has all four classes).
    expect(seen).toEqual([...CLASS_ORDER]);
  });

  it('each group carries the class layout and at least one chassis', () => {
    const groups = chassisByClass(catalog);
    for (const g of groups) {
      expect(g.chassis.length).toBeGreaterThan(0);
      expect(g.layout.length).toBeGreaterThan(0);
    }
  });

  it('layouts match the catalog data verbatim per class', () => {
    const groups = chassisByClass(catalog);
    const byId = new Map(groups.map((g) => [g.classId, g]));
    // Values here mirror `catalog/classes.json` — a change to a layout must
    // be surfaced through this table, not silently altered.
    expect(byId.get('fighter')?.layout).toEqual(['weapon', 'engine', 'special']);
    expect(byId.get('frigate')?.layout).toEqual([
      'weapon',
      'weapon',
      'shield',
      'missile',
      'engine',
      'special',
    ]);
    expect(byId.get('cruiser')?.layout).toEqual([
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
    expect(byId.get('mega-destroyer')?.layout).toEqual([
      'weapon',
      'weapon',
      'weapon',
      'weapon',
      'shield',
      'shield',
      'missile',
      'missile',
      'missile',
      'engine',
      'special',
      'special',
    ]);
  });
});

describe('slotLabels — positional labels group by type in layout order (S05 CP1)', () => {
  it('produces W1/W2/W3/S1/S2/M1/M2/E1/X1 for a cruiser layout', () => {
    const layout: readonly SlotType[] = [
      'weapon',
      'weapon',
      'weapon',
      'shield',
      'shield',
      'missile',
      'missile',
      'engine',
      'special',
    ];
    expect(slotLabels(layout)).toEqual([
      'W1',
      'W2',
      'W3',
      'S1',
      'S2',
      'M1',
      'M2',
      'E1',
      'X1',
    ]);
  });

  it('resets each per-type counter fresh for a different chassis', () => {
    const layout: readonly SlotType[] = ['weapon', 'engine', 'special'];
    expect(slotLabels(layout)).toEqual(['W1', 'E1', 'X1']);
  });
});

// ---- CP1 supporting — createFreshBuild for each of the 4 classes ---------

describe('createFreshBuild — bench count/type per class equals the layout (S05 CP1)', () => {
  it.each([
    ['fighter'],
    ['frigate'],
    ['cruiser'],
    ['mega-destroyer'],
  ] as const)(
    'picking a %s chassis yields a bench whose bay count + types equal that class layout',
    (classId) => {
      const chassis: ChassisDef = catalog.chassisOfClass(classId)[0]!;
      const result = createFreshBuild(
        catalog,
        chassis.id,
        `NEW ${chassis.name.toUpperCase()}`,
        CATALOG_SCHEMA_VERSION,
        clock,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const build = result.value;
      const layout = catalog.slotLayout(classId) ?? [];
      // Slot count matches the frozen layout length …
      expect(build.slots.length).toBe(layout.length);
      // … and every bay renders as an EMPTY slot on chassis pick (FR-4: legal).
      for (const slot of build.slots) expect(slot).toBeNull();
      // Meta got minted via the injected clock.
      expect(build.id).toBe('test-uuid-0000');
      expect(build.createdAt).toBe('2026-08-27T00:00:00.000Z');
      expect(build.updatedAt).toBe('2026-08-27T00:00:00.000Z');
      // storedCost = chassis point cost only (empty bays contribute nothing).
      expect(build.storedCost).toBe(chassis.pointCost);
    },
  );
});

// ---- CP1 sanity — snapshot on an empty fresh cruiser --------------------

describe('snapshot — empty fresh build is a legal fit at chassis cost (S05 CP1)', () => {
  it('validates, prices at chassis cost, and derives stats with no components', () => {
    const cruiser = catalog.chassisOfClass('cruiser')[0]!;
    const meta: BuildMeta = {
      id: 'x',
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogVersion: catalog.catalogVersion,
      createdAt: 't',
      updatedAt: 't',
    };
    const fresh = createFreshBuild(
      catalog,
      cruiser.id,
      'BENCHMARK',
      CATALOG_SCHEMA_VERSION,
      { newId: () => meta.id, now: () => meta.createdAt },
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const snap = snapshot(catalog, fresh.value);
    expect(snap.errors).toEqual([]);
    expect(snap.validated).not.toBeNull();
    expect(snap.cost).toBe(cruiser.pointCost);
    expect(snap.breakdown.chassisCost).toBe(cruiser.pointCost);
    expect(snap.breakdown.total).toBe(cruiser.pointCost);
    // No engines → deltaV = 0 (legal but bad — a floor is a data decision).
    expect(snap.stats?.deltaVPerTurn).toBe(0);
    expect(snap.stats?.shieldCapacity).toBe(0);
    expect(snap.stats?.totalMissileAmmo).toBe(0);
    // No historical drift for a build authored right now.
    expect(snap.refit).toBeNull();
  });

  it('applying a fitting mutation preserves fit legality when the type matches', () => {
    const cruiser = catalog.chassisOfClass('cruiser')[0]!;
    const fresh = createFreshBuild(
      catalog,
      cruiser.id,
      'BENCHMARK',
      CATALOG_SCHEMA_VERSION,
      clock,
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    // Fit a weapon into W1 (index 0 in cruiser layout).
    const anyWeapon = catalog.componentsForSlot('weapon')[0]!;
    const next: Build = withSlot(fresh.value, 0, anyWeapon.id);
    const snap = snapshot(catalog, next);
    expect(snap.errors).toEqual([]);
    expect(snap.cost).toBe(cruiser.pointCost + anyWeapon.pointCost);
  });
});
