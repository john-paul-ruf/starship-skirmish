// M07 IO — exportLibrary tests (specs/database.md §6, architecture §8.2).
//
// Proves:
//   1. The envelope shape matches §6 verbatim: `format`, `schemaVersion`,
//      `catalogVersion`, `exportedAt`, `builds`.
//   2. Identity fields (`id`, `createdAt`, `updatedAt`) are stripped per §6.
//   3. `exportedAt` is echoed from the caller — io never reads the wall clock.
//   4. A subset (caller-filtered) export is the same envelope over a shorter
//      `builds` array.
//   5. Round-trip through `importLibrary` yields the same builds back
//      (identity minted fresh, other fields preserved).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { Build, BuildMeta } from '../../../src/domain/index.js';
import { emptyBuild, withSlot } from '../../../src/domain/index.js';
import { exportLibrary, exportToText } from '../../../src/io/exportLibrary.js';
import { importLibrary } from '../../../src/io/importLibrary.js';

const catalog = loadCatalog();

const meta = (id: string): BuildMeta => ({
  id,
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
});

const wasp = (id: string, name = 'Wasp Alpha'): Build => {
  const empty = emptyBuild(catalog, 'fig-wasp', name, meta(id));
  if (!empty.ok) throw new Error('setup');
  let b = empty.value;
  b = withSlot(b, 0, 'wpn-pulse-array');
  b = withSlot(b, 1, 'eng-standard-drive');
  return b;
};

describe('exportLibrary — envelope shape (§6)', () => {
  it('produces every required envelope field', () => {
    const env = exportLibrary(catalog, [wasp('id-1')], '2026-08-25T22:19:28.302Z');
    expect(env.format).toBe('starship-skirmish/library');
    expect(env.schemaVersion).toBe(1);
    expect(env.catalogVersion).toBe(catalog.catalogVersion);
    expect(env.exportedAt).toBe('2026-08-25T22:19:28.302Z');
    expect(env.builds).toHaveLength(1);
  });

  it('echoes exportedAt verbatim — io never reads the wall clock', () => {
    const t1 = '1970-01-01T00:00:00.000Z';
    const t2 = '9999-12-31T23:59:59.999Z';
    expect(exportLibrary(catalog, [], t1).exportedAt).toBe(t1);
    expect(exportLibrary(catalog, [], t2).exportedAt).toBe(t2);
  });

  it('same input at same timestamp produces byte-identical text (deterministic)', () => {
    const b1 = wasp('id-1');
    const b2 = wasp('id-1');
    const a = exportToText(exportLibrary(catalog, [b1], '2026-01-01T00:00:00.000Z'));
    const b = exportToText(exportLibrary(catalog, [b2], '2026-01-01T00:00:00.000Z'));
    expect(a).toBe(b);
  });
});

describe('exportLibrary — identity strip (§6)', () => {
  it('omits id, createdAt, updatedAt from each per-build entry', () => {
    const env = exportLibrary(catalog, [wasp('id-abc')], '2026-01-01T00:00:00.000Z');
    const entry = env.builds[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry).not.toHaveProperty('id');
    expect(entry).not.toHaveProperty('createdAt');
    expect(entry).not.toHaveProperty('updatedAt');
  });

  it('preserves the non-identity fields per §6 (name, tags, chassisId, slots, versions, storedCost)', () => {
    const src = wasp('id-abc');
    const env = exportLibrary(catalog, [src], '2026-01-01T00:00:00.000Z');
    const entry = env.builds[0];
    if (!entry) throw new Error('no entry');
    expect(entry.name).toBe(src.name);
    expect(entry.tags).toEqual(src.tags);
    expect(entry.chassisId).toBe(src.chassisId);
    expect(entry.slots).toEqual(src.slots);
    expect(entry.schemaVersion).toBe(src.schemaVersion);
    expect(entry.catalogVersion).toBe(src.catalogVersion);
    expect(entry.storedCost).toBe(src.storedCost);
  });
});

describe('exportLibrary — subset export', () => {
  it('is the same envelope over a shorter builds array (caller filters)', () => {
    const all = [wasp('id-1', 'A'), wasp('id-2', 'B'), wasp('id-3', 'C')];
    const subset = all.filter((b) => b.name !== 'B');
    const env = exportLibrary(catalog, subset, '2026-01-01T00:00:00.000Z');
    expect(env.builds.map((b) => b.name)).toEqual(['A', 'C']);
    expect(env.format).toBe('starship-skirmish/library');
  });
});

describe('exportLibrary — round-trip through importLibrary', () => {
  it('round-trips: exportLibrary → exportToText → importLibrary yields the same builds back', () => {
    const src = wasp('id-1');
    const env = exportLibrary(catalog, [src], '2026-01-01T00:00:00.000Z');
    const text = exportToText(env);
    const importResult = importLibrary(catalog, text);
    expect(importResult.ok).toBe(true);
    if (!importResult.ok) return;
    expect(importResult.value.candidates).toHaveLength(1);
    const entry = importResult.value.candidates[0];
    if (!entry) throw new Error('no entry');
    expect(entry.status).toBe('valid');
    expect(entry.build?.chassisId).toBe(src.chassisId);
    expect(entry.build?.slots).toEqual(src.slots);
    expect(entry.build?.name).toBe(src.name);
    // Identity minted fresh — id must NOT be the source id (import stamps '').
    expect(entry.build?.id).toBe('');
  });
});
