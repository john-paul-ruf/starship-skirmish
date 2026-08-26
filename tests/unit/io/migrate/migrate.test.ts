// M07 IO — migrate runner tests (specs/database.md §7.2, FR-2).
//
// Proves the pipeline's ORDER (shape → version → chain → validate → re-price)
// and every ERROR PATH is no-throw (§10 note 7). At v1 the migration chain is
// empty, so this file exercises the runner's shape/version/validate/re-price
// stages — the chain step is a pass-through until schema v2 is appended.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../../src/catalog/index.js';
import type { BuildMeta } from '../../../../src/domain/index.js';
import { pointCost } from '../../../../src/domain/index.js';
import { finishLoad, migrate } from '../../../../src/io/migrate/migrate.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** A legal v1 fighter doc — `fig-wasp` + weapon + engine + empty special. */
const wasp = (storedCost = 11): Record<string, unknown> => ({
  name: 'Wasp Alpha',
  tags: ['alpha'],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost,
  schemaVersion: 1,
  catalogVersion: 1,
});

describe('migrate — happy path (v1 valid doc, no refit)', () => {
  it('returns Loaded with refit=null when storedCost matches current price', () => {
    const currentPrice = pointCost(catalog, {
      id: '', name: 'x', tags: [], chassisId: 'fig-wasp',
      slots: ['wpn-pulse-array', 'eng-standard-drive', null],
      storedCost: 0, schemaVersion: 1, catalogVersion: 1,
      createdAt: '', updatedAt: '',
    });
    const r = migrate(catalog, wasp(currentPrice), meta());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refit).toBeNull();
    expect(r.value.build.chassisId).toBe('fig-wasp');
    expect(r.value.build.storedCost).toBe(currentPrice);
  });

  it('returns Loaded with a non-null refit when storedCost drifts', () => {
    const r = migrate(catalog, wasp(9999), meta()); // deliberately wrong
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refit).not.toBeNull();
    expect(r.value.refit?.oldTotal).toBe(9999);
    expect(r.value.refit?.newTotal).toBeLessThan(9999);
    expect(r.value.refit?.delta).toBe(r.value.refit!.newTotal - 9999);
  });
});

describe('migrate — shape guard (ERR_NOT_OBJECT)', () => {
  it('rejects null without throwing', () => {
    const r = migrate(catalog, null, meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NOT_OBJECT');
  });

  it('rejects a string without throwing', () => {
    const r = migrate(catalog, 'not-a-doc', meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NOT_OBJECT');
  });

  it('rejects an array without throwing', () => {
    const r = migrate(catalog, [1, 2, 3], meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NOT_OBJECT');
  });

  it('rejects a number without throwing', () => {
    const r = migrate(catalog, 42, meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NOT_OBJECT');
  });
});

describe('migrate — version gate', () => {
  it('rejects a doc missing schemaVersion (ERR_NO_SCHEMA_VERSION)', () => {
    const r = migrate(catalog, { name: 'x', chassisId: 'fig-wasp', slots: [null, null, null] }, meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NO_SCHEMA_VERSION');
  });

  it('rejects a doc with non-numeric schemaVersion (ERR_NO_SCHEMA_VERSION)', () => {
    const r = migrate(catalog, { schemaVersion: 'v1', chassisId: 'fig-wasp' }, meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NO_SCHEMA_VERSION');
  });

  it('rejects a future schemaVersion (ERR_FUTURE_SCHEMA) — fail closed, never guess', () => {
    const r = migrate(catalog, { schemaVersion: 999 }, meta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_FUTURE_SCHEMA');
  });

  it('never throws on a hostile shape', () => {
    // Multiple layers of hostility in one doc.
    expect(() => migrate(catalog, { schemaVersion: Number.NaN }, meta())).not.toThrow();
    expect(() => migrate(catalog, { schemaVersion: Infinity }, meta())).not.toThrow();
    expect(() => migrate(catalog, { schemaVersion: 1, chassisId: null }, meta())).not.toThrow();
  });
});

describe('migrate — validation errors bubble up as ERR_VALIDATION', () => {
  it('folds ValidateError[] under a single ERR_VALIDATION result', () => {
    const r = migrate(
      catalog,
      { schemaVersion: 1, name: '', tags: [], chassisId: 'nope', slots: [], storedCost: 0 },
      meta(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_VALIDATION');
    expect(r.error.errors).toBeDefined();
    expect(r.error.errors!.length).toBeGreaterThan(0);
    expect(r.error.errors!.some((e) => e.code === 'ERR_UNKNOWN_CHASSIS')).toBe(true);
  });
});

describe('finishLoad — priceFresh:true (share-token semantics)', () => {
  it('stamps storedCost to current pointCost and returns refit:null', () => {
    // Same wasp doc but with a wildly wrong storedCost — priceFresh must
    // overwrite it, and refit must be null (a token carries no old cost).
    const doc = { ...wasp(9999), schemaVersion: 1 };
    const r = finishLoad(catalog, doc, meta(), { priceFresh: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refit).toBeNull();
    // pointCost against fig-wasp + wpn-pulse-array + eng-standard-drive.
    // Wasp = 6, pulse-array = 2, standard-drive = 3 → 11.
    expect(r.value.build.storedCost).toBe(11);
  });
});

describe('finishLoad — priceFresh:false (record/import semantics)', () => {
  it('flags a stale storedCost as needs-refit', () => {
    const doc = { ...wasp(999), schemaVersion: 1 };
    const r = finishLoad(catalog, doc, meta(), { priceFresh: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refit).not.toBeNull();
    expect(r.value.refit?.oldTotal).toBe(999);
    expect(r.value.build.storedCost).toBe(999); // preserved, historical fact
  });

  it('returns refit:null when storedCost matches current pricing', () => {
    const doc = { ...wasp(11), schemaVersion: 1 };
    const r = finishLoad(catalog, doc, meta(), { priceFresh: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refit).toBeNull();
  });

  it('surfaces validation errors verbatim', () => {
    const r = finishLoad(catalog, { name: '', chassisId: 'nope', slots: [] }, meta(), {
      priceFresh: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.some((e) => e.code === 'ERR_UNKNOWN_CHASSIS')).toBe(true);
  });
});
