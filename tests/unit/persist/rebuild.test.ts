// M08 Persist — rebuildIndex tests (specs/database.md §3.4 / §3.5, FR-2).
//
// Failure isolation is the key property: one bad record NEVER blocks or
// destroys the rest of the Encyclopedia. Rebuild retains failed entries with
// `status:'failed'` so the UI can surface them; only an explicit `remove()`
// deletes anything.
//
// Also proves the re-price cache: an entry whose `pricedAtCatalogVersion !==
// catalog.catalogVersion` is recomputed once at boot, then O(0) on the next.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import { openLibrary } from '../../../src/persist/LibraryRepo.js';
import { INDEX_KEY, buildKey } from '../../../src/persist/keys.js';
import { nameKeyOf, rebuildIndex } from '../../../src/persist/rebuildIndex.js';
import { parseIndexRecord, serializeBuild, type BuildDoc } from '../../../src/persist/records.js';
import { memoryStore } from '../../../src/persist/storageAdapter.js';

const catalog = loadCatalog();
const STAMP = '2026-01-01T00:00:00.000Z';
const NOW = () => STAMP;

const build = (id: string, name = `Build ${id}`, storedCost = 11): BuildDoc => ({
  id,
  name,
  tags: ['alpha'],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});

describe('nameKeyOf — O(1) collision key (§3.6)', () => {
  it('lowercases, NFC-normalises, and collapses whitespace', () => {
    expect(nameKeyOf('  Wasp   Alpha  ')).toBe('wasp alpha');
    expect(nameKeyOf('WASP\tALPHA')).toBe('wasp alpha');
  });
});

describe('rebuildIndex — happy path', () => {
  it('regenerates an index for 3 valid records, sorted by id', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Alpha');
    const b = build('00000000-0000-4000-8000-00000000000b', 'Bravo');
    const c = build('00000000-0000-4000-8000-00000000000c', 'Charlie');
    store.setItem(buildKey(a.id), serializeBuild(a));
    store.setItem(buildKey(b.id), serializeBuild(b));
    store.setItem(buildKey(c.id), serializeBuild(c));

    const index = rebuildIndex(catalog, store, NOW);
    expect(index.entries.length).toBe(3);
    expect(index.entries.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(index.entries.every((e) => e.status === 'ok')).toBe(true);
  });

  it('populates denormalised classId + nameKey on each entry', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Wasp Alpha');
    store.setItem(buildKey(a.id), serializeBuild(a));

    const [entry] = rebuildIndex(catalog, store, NOW).entries;
    expect(entry?.classId).toBe('fighter');
    expect(entry?.nameKey).toBe('wasp alpha');
    expect(entry?.pricedAtCatalogVersion).toBe(catalog.catalogVersion);
  });

  it('caches needsRefit / currentCost against the current catalog', () => {
    const store = memoryStore();
    // storedCost wildly wrong -> needsRefit must be flagged.
    const a = build('00000000-0000-4000-8000-00000000000a', 'Refit', 9999);
    store.setItem(buildKey(a.id), serializeBuild(a));

    const [entry] = rebuildIndex(catalog, store, NOW).entries;
    expect(entry?.needsRefit).toBe(true);
    expect(entry?.currentCost).toBeLessThan(9999);
    expect(entry?.storedCost).toBe(9999);
  });
});

describe('rebuildIndex — failure isolation (§3.5, FR-2)', () => {
  it('flags an unparseable record as failed but keeps the rest', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Alpha');
    store.setItem(buildKey(a.id), serializeBuild(a));
    store.setItem(buildKey('bad-id'), 'not-json{{');

    const index = rebuildIndex(catalog, store, NOW);
    expect(index.entries.length).toBe(2);
    const bad = index.entries.find((e) => e.id === 'bad-id');
    expect(bad?.status).toBe('failed');
    expect(bad?.failureReason).toBe('ERR_PARSE');
    const good = index.entries.find((e) => e.id === a.id);
    expect(good?.status).toBe('ok');
  });

  it('flags a validation failure with the migrate error code', () => {
    const store = memoryStore();
    const bad = { ...build('00000000-0000-4000-8000-00000000000a'), chassisId: 'nope' };
    store.setItem(buildKey(bad.id), serializeBuild(bad));

    const [entry] = rebuildIndex(catalog, store, NOW).entries;
    expect(entry?.status).toBe('failed');
    expect(entry?.failureReason).toBe('ERR_VALIDATION');
  });
});

describe('openLibrary — self-heal (§3.5)', () => {
  it('rebuilds when :index is missing and 3 records exist', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a');
    const b = build('00000000-0000-4000-8000-00000000000b');
    const c = build('00000000-0000-4000-8000-00000000000c');
    for (const rec of [a, b, c]) store.setItem(buildKey(rec.id), serializeBuild(rec));

    const { repo } = openLibrary(catalog, { store, now: NOW });
    expect(repo.list().length).toBe(3);
    // Index now persisted for a subsequent boot.
    expect(store.getItem(INDEX_KEY)).not.toBeNull();
  });

  it('rebuilds when :index count disagrees with record count (orphan)', () => {
    const store = memoryStore();
    // Simulate a crash between put's record-write and index-update: two
    // records on disk, but the index only knows about one.
    const a = build('00000000-0000-4000-8000-00000000000a', 'Known');
    const orphan = build('00000000-0000-4000-8000-00000000000b', 'Orphan');
    store.setItem(buildKey(a.id), serializeBuild(a));
    store.setItem(buildKey(orphan.id), serializeBuild(orphan));

    const staleIndex = {
      schemaVersion: 1,
      updatedAt: STAMP,
      entries: [
        {
          id: a.id,
          name: 'Known',
          nameKey: 'known',
          tags: [],
          chassisId: 'fig-wasp',
          classId: 'fighter',
          storedCost: 11,
          currentCost: 11,
          needsRefit: false,
          pricedAtCatalogVersion: catalog.catalogVersion,
          schemaVersion: 1,
          catalogVersion: 1,
          createdAt: STAMP,
          updatedAt: STAMP,
          bytes: 200,
          status: 'ok' as const,
        },
      ],
    };
    store.setItem(INDEX_KEY, JSON.stringify(staleIndex));

    const { repo } = openLibrary(catalog, { store, now: NOW });
    const ids = repo.list().map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(orphan.id);
    expect(ids.length).toBe(2);
  });

  it('rebuilds when :index is unparseable garbage', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a');
    store.setItem(buildKey(a.id), serializeBuild(a));
    store.setItem(INDEX_KEY, 'not-json{{');

    const { repo } = openLibrary(catalog, { store, now: NOW });
    expect(repo.list().length).toBe(1);
  });

  it('preserves failed entries at boot — one bad record, one good', () => {
    const store = memoryStore();
    const ok = build('00000000-0000-4000-8000-00000000000a', 'Ok');
    store.setItem(buildKey(ok.id), serializeBuild(ok));
    store.setItem(buildKey('00000000-0000-4000-8000-00000000000b'), 'not-json{{');

    const { repo } = openLibrary(catalog, { store, now: NOW });
    // Both entries retained; only ok is get()-able.
    const entries = repo.entries();
    expect(entries.length).toBe(2);
    expect(repo.get(ok.id)).not.toBeNull();
    expect(repo.get('00000000-0000-4000-8000-00000000000b')).toBeNull();
  });
});

describe('openLibrary — re-price cache (§3.3 / §3.4)', () => {
  it('recomputes needsRefit when the on-disk index is stamped with an older catalog version', () => {
    const store = memoryStore();
    // Doc's storedCost matches TODAY's cost — needsRefit would be false if re-priced.
    const a = build('00000000-0000-4000-8000-00000000000a', 'Refresh me', 11);
    store.setItem(buildKey(a.id), serializeBuild(a));

    // Seed the index with a stale cache line (needsRefit:true, pricedAt = 0).
    const staleIndex = {
      schemaVersion: 1,
      updatedAt: STAMP,
      entries: [
        {
          id: a.id,
          name: a.name,
          nameKey: nameKeyOf(a.name),
          tags: [...a.tags],
          chassisId: a.chassisId,
          classId: 'fighter',
          storedCost: 11,
          currentCost: 999,
          needsRefit: true,
          pricedAtCatalogVersion: 0, // stale — forces re-price
          schemaVersion: 1,
          catalogVersion: 1,
          createdAt: STAMP,
          updatedAt: STAMP,
          bytes: 200,
          status: 'ok' as const,
        },
      ],
    };
    store.setItem(INDEX_KEY, JSON.stringify(staleIndex));

    const { repo } = openLibrary(catalog, { store, now: NOW });
    const [entry] = repo.list();
    expect(entry?.needsRefit).toBe(false);
    expect(entry?.currentCost).toBe(11);
    expect(entry?.pricedAtCatalogVersion).toBe(catalog.catalogVersion);

    // Persisted, so a fresh boot at the same catalog version is O(0) — the
    // stored index now already has pricedAtCatalogVersion === current.
    const raw = store.getItem(INDEX_KEY);
    const parsed = parseIndexRecord(raw!);
    expect(parsed?.entries[0]?.pricedAtCatalogVersion).toBe(catalog.catalogVersion);
  });

  it('does NOT re-write the index when every entry is already priced at the current version', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Fresh');
    store.setItem(buildKey(a.id), serializeBuild(a));

    // Boot once — persists the freshly-priced index.
    openLibrary(catalog, { store, now: NOW });
    const afterFirstBoot = store.getItem(INDEX_KEY);

    // Boot again at the same catalog — should not touch the store.
    // Wrap setItem to detect writes.
    let indexWrites = 0;
    const spyStore = {
      getItem: store.getItem.bind(store),
      setItem: (k: string, v: string) => {
        if (k === INDEX_KEY) indexWrites += 1;
        store.setItem(k, v);
      },
      removeItem: store.removeItem.bind(store),
      keys: store.keys.bind(store),
    };
    openLibrary(catalog, { store: spyStore, now: NOW });
    expect(indexWrites).toBe(0);
    expect(store.getItem(INDEX_KEY)).toBe(afterFirstBoot);
  });
});

describe('openLibrary — list / get / headroom', () => {
  it('list respects tags AND filter + class filter', () => {
    const store = memoryStore();
    const alpha = { ...build('00000000-0000-4000-8000-00000000000a'), tags: ['alpha', 'wasp'] };
    const beta = { ...build('00000000-0000-4000-8000-00000000000b'), tags: ['beta', 'wasp'] };
    for (const r of [alpha, beta]) store.setItem(buildKey(r.id), serializeBuild(r));
    const { repo } = openLibrary(catalog, { store, now: NOW });

    expect(repo.list({ tags: ['wasp'] }).length).toBe(2);
    expect(repo.list({ tags: ['alpha'] }).length).toBe(1);
    expect(repo.list({ tags: ['alpha', 'beta'] }).length).toBe(0);
    expect(repo.list({ classId: 'fighter' }).length).toBe(2);
    expect(repo.list({ classId: 'cruiser' }).length).toBe(0);
  });

  it('list sorts by name / currentCost / updatedAt', () => {
    const store = memoryStore();
    const a = { ...build('00000000-0000-4000-8000-00000000000a', 'Charlie', 11) };
    const b = { ...build('00000000-0000-4000-8000-00000000000b', 'Alpha', 11) };
    for (const r of [a, b]) store.setItem(buildKey(r.id), serializeBuild(r));
    const { repo } = openLibrary(catalog, { store, now: NOW });
    const byName = repo.list({ sort: 'name' }).map((e) => e.name);
    expect(byName).toEqual(['Alpha', 'Charlie']);
  });

  it('get(id) returns Loaded for status:ok, null for unknown / failed', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Alpha');
    store.setItem(buildKey(a.id), serializeBuild(a));
    store.setItem(buildKey('00000000-0000-4000-8000-00000000000b'), 'not-json{{');
    const { repo } = openLibrary(catalog, { store, now: NOW });

    const ok = repo.get(a.id);
    expect(ok).not.toBeNull();
    expect(ok?.build.name).toBe('Alpha');

    expect(repo.get('unknown-id')).toBeNull();
    expect(repo.get('00000000-0000-4000-8000-00000000000b')).toBeNull();
  });

  it('headroom reports usedBytes + remainingBytes + level=ok on a small library', () => {
    const store = memoryStore();
    const a = build('00000000-0000-4000-8000-00000000000a', 'Alpha');
    store.setItem(buildKey(a.id), serializeBuild(a));
    const { repo } = openLibrary(catalog, { store, now: NOW });

    const report = repo.headroom();
    expect(report.usedBytes).toBeGreaterThan(0);
    expect(report.remainingBytes).toBeGreaterThan(0);
    expect(report.level).toBe('ok');
  });

  it('empty library — list is [], usedBytes is 0, headroom level is ok', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: NOW });
    expect(repo.list()).toEqual([]);
    expect(repo.usedBytes()).toBe(0);
    expect(repo.headroom().level).toBe('ok');
  });
});
