// M08 Persist — records.ts tests (specs/database.md §3.2 / §3.4 / §3.8).
//
// Two things this file has to prove:
//   1. Every parse* is TOTAL and NEVER THROWS on garbage — the failure-
//      isolation contract in §3.5 depends on it.
//   2. parsePrefsRecord always returns a valid PrefsRecord (a corrupt :prefs
//      blob is silently reset to defaults, §3.8) — never null, never throw.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  parseBuildRecord,
  parseIndexRecord,
  parseMetaRecord,
  parsePrefsRecord,
  serializeBuild,
  serializeIndexRecord,
  serializeMetaRecord,
  serializePrefsRecord,
  type BuildRecord,
  type IndexEntry,
  type IndexRecord,
  type MetaRecord,
  type PrefsRecord,
} from '../../../src/persist/records.js';

const sampleBuild = (): BuildRecord => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Wasp Alpha',
  tags: ['alpha'],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost: 11,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const sampleEntry = (): IndexEntry => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Wasp Alpha',
  nameKey: 'wasp alpha',
  tags: ['alpha'],
  chassisId: 'fig-wasp',
  classId: 'fighter',
  storedCost: 11,
  currentCost: 11,
  needsRefit: false,
  pricedAtCatalogVersion: 1,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  bytes: 400,
  status: 'ok',
});

describe('parseBuildRecord — guarded (§3.5 failure isolation)', () => {
  it('round-trips a valid record through serialize/parse', () => {
    const raw = serializeBuild(sampleBuild());
    const parsed = parseBuildRecord(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(parsed?.chassisId).toBe('fig-wasp');
  });

  it('returns null on JSON garbage — never throws', () => {
    expect(parseBuildRecord('not-json')).toBeNull();
    expect(parseBuildRecord('')).toBeNull();
    expect(parseBuildRecord('{invalid')).toBeNull();
  });

  it('returns null when the value parses to non-object (array / number / null)', () => {
    expect(parseBuildRecord('[]')).toBeNull();
    expect(parseBuildRecord('42')).toBeNull();
    expect(parseBuildRecord('null')).toBeNull();
    expect(parseBuildRecord('"hi"')).toBeNull();
  });

  it('returns null when id or chassisId is missing / wrong type', () => {
    expect(parseBuildRecord(JSON.stringify({ chassisId: 'fig-wasp' }))).toBeNull();
    expect(parseBuildRecord(JSON.stringify({ id: 42, chassisId: 'fig-wasp' }))).toBeNull();
    expect(parseBuildRecord(JSON.stringify({ id: 'x', chassisId: 42 }))).toBeNull();
  });
});

describe('parseIndexRecord — guarded, drops garbage entries', () => {
  it('round-trips a valid IndexRecord', () => {
    const record: IndexRecord = {
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [sampleEntry()],
    };
    const parsed = parseIndexRecord(serializeIndexRecord(record));
    expect(parsed).not.toBeNull();
    expect(parsed?.entries.length).toBe(1);
    expect(parsed?.entries[0]?.id).toBe(record.entries[0]!.id);
  });

  it('returns null on JSON garbage', () => {
    expect(parseIndexRecord('not-json')).toBeNull();
    expect(parseIndexRecord('[]')).toBeNull();
  });

  it('returns null when required top-level fields are missing / wrong-typed', () => {
    expect(parseIndexRecord(JSON.stringify({}))).toBeNull();
    expect(parseIndexRecord(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
    expect(
      parseIndexRecord(JSON.stringify({ schemaVersion: 1, updatedAt: 'now', entries: 'nope' })),
    ).toBeNull();
  });

  it('drops individual malformed entries but keeps the good ones', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 'now',
      entries: [sampleEntry(), { id: 42 }, sampleEntry()],
    });
    const parsed = parseIndexRecord(raw);
    expect(parsed?.entries.length).toBe(2);
  });

  it('preserves status: failed and a failureReason string', () => {
    const failed: IndexEntry = { ...sampleEntry(), status: 'failed', failureReason: 'ERR_VALIDATION' };
    const parsed = parseIndexRecord(
      serializeIndexRecord({ schemaVersion: 1, updatedAt: 'now', entries: [failed] }),
    );
    expect(parsed?.entries[0]?.status).toBe('failed');
    expect(parsed?.entries[0]?.failureReason).toBe('ERR_VALIDATION');
  });
});

describe('parseMetaRecord — guarded', () => {
  it('round-trips a valid MetaRecord', () => {
    const meta: MetaRecord = {
      schemaVersion: 1,
      catalogVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastExportAt: null,
      backupNudgeDismissedAt: null,
      usedBytes: 0,
    };
    const parsed = parseMetaRecord(serializeMetaRecord(meta));
    expect(parsed).toEqual(meta);
  });

  it('returns null on garbage / missing required fields', () => {
    expect(parseMetaRecord('not-json')).toBeNull();
    expect(parseMetaRecord(JSON.stringify({}))).toBeNull();
    expect(
      parseMetaRecord(JSON.stringify({ schemaVersion: 1, catalogVersion: 1 })),
    ).toBeNull();
  });

  it('defensively defaults optional fields when they are wrong-typed', () => {
    const parsed = parseMetaRecord(
      JSON.stringify({
        schemaVersion: 1,
        catalogVersion: 1,
        createdAt: 'now',
        lastExportAt: 42,
        backupNudgeDismissedAt: {},
        usedBytes: 'many',
      }),
    );
    expect(parsed?.lastExportAt).toBeNull();
    expect(parsed?.backupNudgeDismissedAt).toBeNull();
    expect(parsed?.usedBytes).toBe(0);
  });
});

describe('parsePrefsRecord — TOTAL WITH DEFAULT (§3.8)', () => {
  it('round-trips a valid PrefsRecord', () => {
    const prefs: PrefsRecord = {
      reducedMotion: true,
      renderQuality: 'high',
      defaultBudget: 200,
      encyclopediaSort: 'name',
      encyclopediaFilter: { tags: ['alpha'], classId: 'fighter' },
    };
    expect(parsePrefsRecord(serializePrefsRecord(prefs))).toEqual(prefs);
  });

  it('returns DEFAULT_PREFS on garbage (never null, never throw)', () => {
    expect(parsePrefsRecord('not-json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefsRecord('null')).toEqual(DEFAULT_PREFS);
    expect(parsePrefsRecord('[]')).toEqual(DEFAULT_PREFS);
    expect(parsePrefsRecord('42')).toEqual(DEFAULT_PREFS);
  });

  it('defaults individual unknown enum values back to the default', () => {
    const parsed = parsePrefsRecord(
      JSON.stringify({ renderQuality: 'ultra', encyclopediaSort: 'random' }),
    );
    expect(parsed.renderQuality).toBe(DEFAULT_PREFS.renderQuality);
    expect(parsed.encyclopediaSort).toBe(DEFAULT_PREFS.encyclopediaSort);
  });

  it('coerces missing fields to defaults', () => {
    const parsed = parsePrefsRecord(JSON.stringify({ reducedMotion: true }));
    expect(parsed.reducedMotion).toBe(true);
    expect(parsed.renderQuality).toBe(DEFAULT_PREFS.renderQuality);
    expect(parsed.defaultBudget).toBeNull();
    expect(parsed.encyclopediaFilter).toEqual({ tags: [], classId: null });
  });
});
