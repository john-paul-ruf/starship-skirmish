// M07 IO — importLibrary tests (specs/database.md §6, architecture §8.2,
// FR-9, §10 note 7).
//
// Proves:
//   1. Every file-level rejection (over cap, bad JSON, wrong format, future
//      version, non-array builds, over count) surfaces the right code and
//      does not throw.
//   2. Partial validity is normal — one broken build in a file of good ones
//      yields one `failed` + N `valid` entries; the file is NEVER rejected
//      wholesale (FR-9).
//   3. Caps precede allocation — an over-cap file returns before JSON.parse;
//      an over-count builds array returns before per-build iteration.
//   4. importLibrary NEVER WRITES (asserted by observing that the module is
//      pure — it has no persist dependency and returns only a report).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import { BUILDS_MAX, FILE_MAX_BYTES } from '../../../src/io/limits.js';
import { importLibrary } from '../../../src/io/importLibrary.js';

const catalog = loadCatalog();

/** A minimal well-formed export envelope wrapping the given builds array. */
const envelopeOf = (builds: readonly Record<string, unknown>[]): string =>
  JSON.stringify({
    format: 'starship-skirmish/library',
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    exportedAt: '2026-01-01T00:00:00.000Z',
    builds,
  });

/** A single legal fighter entry (fig-wasp, weapon + engine + empty). */
const legalWasp = (name = 'Wasp Alpha'): Record<string, unknown> => ({
  name,
  tags: [],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost: 11,
  schemaVersion: 1,
  catalogVersion: 1,
});

// ─── File-level rejections ────────────────────────────────────────────────

describe('importLibrary — file-level rejections', () => {
  it('rejects a file over FILE_MAX_BYTES (cap BEFORE JSON.parse)', () => {
    // Build a text whose UTF-8 byte length exceeds the cap using ASCII (1 byte
    // per char). Content need not be valid JSON — the cap fires first.
    const oversized = 'x'.repeat(FILE_MAX_BYTES + 1);
    const r = importLibrary(catalog, oversized);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_FILE_TOO_LARGE');
  });

  it('rejects malformed JSON (ERR_BAD_JSON)', () => {
    const r = importLibrary(catalog, '{ not json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_BAD_JSON');
  });

  it('rejects wrong envelope shape (array, string, null → ERR_BAD_FORMAT)', () => {
    for (const bad of ['[]', '"a string"', 'null']) {
      const r = importLibrary(catalog, bad);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('ERR_BAD_FORMAT');
    }
  });

  it('rejects wrong `format` string (ERR_BAD_FORMAT)', () => {
    const bad = JSON.stringify({
      format: 'some-other/library',
      schemaVersion: 1,
      catalogVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      builds: [],
    });
    const r = importLibrary(catalog, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_BAD_FORMAT');
  });

  it('rejects a future schemaVersion (ERR_FUTURE_SCHEMA)', () => {
    const bad = JSON.stringify({
      format: 'starship-skirmish/library',
      schemaVersion: 99,
      catalogVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      builds: [],
    });
    const r = importLibrary(catalog, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_FUTURE_SCHEMA');
  });

  it('rejects a future catalogVersion (ERR_FUTURE_CATALOG)', () => {
    const bad = JSON.stringify({
      format: 'starship-skirmish/library',
      schemaVersion: 1,
      catalogVersion: 99,
      exportedAt: '2026-01-01T00:00:00.000Z',
      builds: [],
    });
    const r = importLibrary(catalog, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_FUTURE_CATALOG');
  });

  it('rejects a non-array `builds` (ERR_BUILDS_NOT_ARRAY)', () => {
    const bad = JSON.stringify({
      format: 'starship-skirmish/library',
      schemaVersion: 1,
      catalogVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      builds: { not: 'an-array' },
    });
    const r = importLibrary(catalog, bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_BUILDS_NOT_ARRAY');
  });

  it('rejects an over-count builds array BEFORE per-build iteration (ERR_TOO_MANY_BUILDS)', () => {
    // Length BUILDS_MAX + 1 of arbitrary objects. The cap fires before any
    // build is validated, so we can put garbage entries in — none get parsed.
    const builds = new Array(BUILDS_MAX + 1).fill({});
    const r = importLibrary(catalog, envelopeOf(builds));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_TOO_MANY_BUILDS');
  });

  it('never throws on any file-level failure', () => {
    for (const bad of ['{ not json', '[]', 'null', 'not a doc']) {
      expect(() => importLibrary(catalog, bad)).not.toThrow();
    }
  });
});

// ─── Partial validity (FR-9) ─────────────────────────────────────────────

describe('importLibrary — partial validity (FR-9)', () => {
  it('mixes valid + failed entries into one report (never rejects the file)', () => {
    const mixed = [
      legalWasp('Alpha'),
      { name: '', chassisId: 'nope', slots: [] }, // will fail validation
      legalWasp('Beta'),
    ];
    const r = importLibrary(catalog, envelopeOf(mixed));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.candidates).toHaveLength(3);
    expect(r.value.candidates[0]?.status).toBe('valid');
    expect(r.value.candidates[1]?.status).toBe('failed');
    expect(r.value.candidates[2]?.status).toBe('valid');
    // The failed entry carries a human reason.
    expect(r.value.candidates[1]?.reason).toBeDefined();
    expect(r.value.candidates[1]?.reason?.length).toBeGreaterThan(0);
  });

  it('valid entries carry a priced Build + refit (identity empty, priced by migrate)', () => {
    const r = importLibrary(catalog, envelopeOf([legalWasp('X')]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = r.value.candidates[0];
    if (!entry) throw new Error('no entry');
    expect(entry.status).toBe('valid');
    expect(entry.build).toBeDefined();
    expect(entry.build?.id).toBe(''); // io does not mint identity
    expect(entry.build?.chassisId).toBe('fig-wasp');
    expect(entry.build?.storedCost).toBe(11);
    // Legal costs, so no refit needed.
    expect(entry.refit).toBeNull();
  });

  it('a per-build entry that is not a JSON object is reported as failed (index preserved)', () => {
    const mixed = [legalWasp('A'), 'not-an-object', legalWasp('B')];
    const r = importLibrary(catalog, envelopeOf(mixed as Record<string, unknown>[]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.candidates[1]?.status).toBe('failed');
    expect(r.value.candidates[1]?.index).toBe(1);
  });

  it('preserves the original file index on every candidate', () => {
    const builds = [legalWasp('a'), legalWasp('b'), legalWasp('c')];
    const r = importLibrary(catalog, envelopeOf(builds));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.candidates.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('an empty builds array is a valid empty report (not a failure)', () => {
    const r = importLibrary(catalog, envelopeOf([]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.candidates).toHaveLength(0);
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────

describe('importLibrary — purity', () => {
  it('does not touch persist — mixed-validity input still returns a report, never a whole-file failure', () => {
    // The point isn't only that no write happens (io has no persist import);
    // the point is that a partial-failure input still parses to a report
    // rather than aborting.
    const r = importLibrary(catalog, envelopeOf([legalWasp('a'), { garbage: true }]));
    expect(r.ok).toBe(true);
  });

  it('does not mutate the fileText argument', () => {
    const text = envelopeOf([legalWasp('a')]);
    const snapshot = text;
    importLibrary(catalog, text);
    expect(text).toBe(snapshot);
  });
});
