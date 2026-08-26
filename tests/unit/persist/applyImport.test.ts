// M08 Persist — applyImport tests (FR-9, specs/database.md §3.6).
//
// Four properties this suite pins:
//   1. A no-collision batch produces IMPORTED for every valid candidate; count
//      only grows (additive-only, FR-9).
//   2. Collisions under `policy:'rename'` mint a unique name and the ORIGINAL
//      is untouched.
//   3. Collisions under `policy:'skip'` leave the existing record untouched.
//   4. `failed` candidates pass through as FAILED(reason) verbatim — persist
//      never invents a validation reason of its own for a candidate io
//      already rejected.
//   5. `markExported` / `lastExportAt` round-trip.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import {
  applyImport,
  mintUniqueName,
  openLibrary,
  type BuildDoc,
  type ImportCandidate,
} from '../../../src/persist/index.js';
import { nameKeyOf } from '../../../src/persist/rebuildIndex.js';
import { memoryStore } from '../../../src/persist/storageAdapter.js';

const catalog = loadCatalog();
const STAMP = '2026-01-01T00:00:00.000Z';

const buildOf = (id: string, name: string, tags: readonly string[] = []): BuildDoc => ({
  id,
  name,
  tags: [...tags],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost: 11,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const valid = (build: BuildDoc): ImportCandidate => ({ status: 'valid', build });
const failed = (reason: string): ImportCandidate => ({ status: 'failed', reason });

describe('mintUniqueName — collision-free suffixing', () => {
  it('returns the base name when its key is not taken', () => {
    expect(mintUniqueName('Wasp Alpha', () => false)).toBe('Wasp Alpha');
  });

  it('appends " (2)", " (3)" until a free key is found', () => {
    const taken = new Set(['wasp alpha', 'wasp alpha (2)']);
    expect(mintUniqueName('Wasp Alpha', (nk) => taken.has(nk))).toBe('Wasp Alpha (3)');
  });

  it('truncates the base to fit the suffix within the max-length budget', () => {
    const forever = () => true;
    // 48-char base + suffix ' (2)' (4 chars) forces truncation to 44 chars.
    const base = 'A'.repeat(48);
    // No solution exists (isTaken always true) — the fallback path must not loop.
    const result = mintUniqueName(base, forever, 48);
    expect(result.length).toBeLessThanOrEqual(48);
  });
});

describe('applyImport — no collisions (additive)', () => {
  it('imports every valid candidate; count only grows', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const before = repo.list().length;
    const candidates: ImportCandidate[] = [
      valid(buildOf('00000000-0000-4000-8000-00000000000a', 'Alpha')),
      valid(buildOf('00000000-0000-4000-8000-00000000000b', 'Beta')),
      valid(buildOf('00000000-0000-4000-8000-00000000000c', 'Charlie')),
    ];
    const report = applyImport(repo, candidates, 'rename');
    expect(report.imported).toBe(3);
    expect(report.renamed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.replaced).toBe(0);
    expect(report.failed).toBe(0);
    expect(repo.list().length).toBe(before + 3);
  });
});

describe('applyImport — collisions', () => {
  it('policy:rename mints a unique name; ORIGINAL untouched', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const original = buildOf('00000000-0000-4000-8000-00000000000a', 'Wasp Alpha');
    repo.put(original);

    const incoming = buildOf('00000000-0000-4000-8000-000000000099', 'Wasp Alpha');
    const report = applyImport(repo, [valid(incoming)], 'rename');
    expect(report.renamed).toBe(1);
    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(0);
    // Original entry untouched.
    expect(repo.entry(original.id)?.name).toBe('Wasp Alpha');
    // Incoming build present with a unique name.
    const renamedEntry = repo.entry(incoming.id);
    expect(renamedEntry?.name.startsWith('Wasp Alpha')).toBe(true);
    expect(renamedEntry?.nameKey).not.toBe(nameKeyOf('Wasp Alpha'));
    // Two entries total — count grew (additive).
    expect(repo.list().length).toBe(2);
  });

  it('policy:skip leaves the existing untouched and reports SKIPPED', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const original = buildOf('00000000-0000-4000-8000-00000000000a', 'Wasp Alpha');
    repo.put(original);
    const before = repo.list().length;

    const incoming = buildOf('00000000-0000-4000-8000-000000000099', 'Wasp Alpha');
    const report = applyImport(repo, [valid(incoming)], 'skip');
    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
    expect(repo.list().length).toBe(before); // No new writes.
    expect(repo.entry(incoming.id)).toBeUndefined();
  });

  it('policy:replace overwrites the existing SAME id (in place, updatedAt bumps)', () => {
    let clock = STAMP;
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => clock });
    const original = buildOf('00000000-0000-4000-8000-00000000000a', 'Wasp Alpha');
    repo.put(original);

    clock = '2026-06-01T00:00:00.000Z';
    const incoming = buildOf('00000000-0000-4000-8000-000000000099', 'Wasp Alpha', ['tagged']);
    const report = applyImport(repo, [valid(incoming)], 'replace');
    expect(report.replaced).toBe(1);
    expect(repo.list().length).toBe(1); // No new id.
    const survived = repo.entry(original.id);
    expect(survived).toBeDefined();
    expect(survived?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(survived?.tags).toEqual(['tagged']);
  });
});

describe('applyImport — FAILED candidates pass through verbatim', () => {
  it('a `failed` candidate becomes a FAILED outcome with the same reason', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const report = applyImport(
      repo,
      [failed('ERR_BAD_UTF8'), valid(buildOf('00000000-0000-4000-8000-00000000000a', 'Alpha'))],
      'rename',
    );
    expect(report.failed).toBe(1);
    expect(report.imported).toBe(1);
    const failedOutcome = report.outcomes.find((o) => o.status === 'failed');
    expect(failedOutcome?.status).toBe('failed');
    if (failedOutcome?.status === 'failed') {
      expect(failedOutcome.reason).toBe('ERR_BAD_UTF8');
    }
  });

  it('never deletes an existing build even when import batch is all failed', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const survivor = buildOf('00000000-0000-4000-8000-00000000000a', 'Survivor');
    repo.put(survivor);

    const report = applyImport(
      repo,
      [failed('ERR_ONE'), failed('ERR_TWO'), failed('ERR_THREE')],
      'skip',
    );
    expect(report.failed).toBe(3);
    expect(repo.entry(survivor.id)).toBeDefined();
    expect(repo.list().length).toBe(1);
  });
});

describe('applyImport — never crosses ADDITIVE contract (FR-9)', () => {
  it('every combination of outcomes leaves the pre-import population intact', () => {
    let clock = STAMP;
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => clock });
    const a = buildOf('00000000-0000-4000-8000-00000000000a', 'Alpha');
    const b = buildOf('00000000-0000-4000-8000-00000000000b', 'Beta');
    repo.put(a);
    repo.put(b);
    const preIds = new Set(repo.entries().map((e) => e.id));

    clock = '2026-06-01T00:00:00.000Z';
    const candidates: ImportCandidate[] = [
      valid(buildOf('00000000-0000-4000-8000-00000000000c', 'Alpha')), // collision → rename
      valid(buildOf('00000000-0000-4000-8000-00000000000d', 'Delta')), // fresh
      failed('ERR_BAD_UTF8'),
    ];
    applyImport(repo, candidates, 'rename');

    // Pre-import ids all still present (additive-only).
    for (const id of preIds) {
      expect(repo.entry(id)).toBeDefined();
    }
  });
});

describe('lastExportAt / markExported', () => {
  it('starts null, round-trips a stamped timestamp', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    expect(repo.lastExportAt()).toBeNull();
    repo.markExported('2026-06-01T00:00:00.000Z');
    expect(repo.lastExportAt()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('persists across a fresh openLibrary against the same store', () => {
    const store = memoryStore();
    const first = openLibrary(catalog, { store, now: () => STAMP });
    first.repo.markExported('2026-06-01T00:00:00.000Z');

    const second = openLibrary(catalog, { store, now: () => STAMP });
    expect(second.repo.lastExportAt()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('loadPrefs / savePrefs', () => {
  it('returns DEFAULT_PREFS on a fresh library', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const prefs = repo.loadPrefs();
    expect(prefs.reducedMotion).toBe(false);
    expect(prefs.renderQuality).toBe('medium');
  });

  it('round-trips a saved PrefsRecord across a reopen', () => {
    const store = memoryStore();
    const first = openLibrary(catalog, { store, now: () => STAMP });
    first.repo.savePrefs({
      reducedMotion: true,
      renderQuality: 'high',
      defaultBudget: 250,
      encyclopediaSort: 'name',
      encyclopediaFilter: { tags: ['alpha'], classId: 'fighter' },
    });

    const second = openLibrary(catalog, { store, now: () => STAMP });
    const prefs = second.repo.loadPrefs();
    expect(prefs.reducedMotion).toBe(true);
    expect(prefs.renderQuality).toBe('high');
    expect(prefs.encyclopediaFilter.classId).toBe('fighter');
  });
});
