// M14 UI — Encyclopedia action tests (S04 checkpoint 2).
//
// Node-env pure logic: `duplicateIdentity` composition and the end-to-end
// duplicate + delete flow driven against an in-memory `LibraryRepo`. The
// screen `.tsx` is deliberately NOT imported — tests stay `.ts` so tsc.node
// never walks into a JSX-emitting file (S02/S03 handoff note).
//
// What we pin down here:
//   1. `duplicateIdentity` uses the passed `mint` + `isTaken` to compose a
//      name — no side effects, deterministic under a fixed source name.
//   2. Duplicating an OK build against a real in-memory repo produces a
//      second entry with a distinct id + a suffix-minted name (persist's
//      `mintUniqueName` under the hood); the ORIGINAL is untouched.
//   3. Delete calls the repo's index-first remove path — the entry is gone,
//      the count drops, and unknown-id removes are a no-op.

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Build } from '../../../../src/domain/index.js';
import {
  mintUniqueName,
  openLibrary,
} from '../../../../src/persist/index.js';
import { memoryStore } from '../../../../src/persist/storageAdapter.js';
import { nameKeyOf } from '../../../../src/persist/rebuildIndex.js';
import { duplicateIdentity } from '../../../../src/ui/screens/encyclopedia/model.js';

const catalog = loadCatalog();
const STAMP = '2026-01-01T00:00:00.000Z';

const seedBuild = (partial: Partial<Build> & Pick<Build, 'id' | 'name'>): Build => ({
  chassisId: 'fig-wasp',
  slots: [null, null, null],
  tags: [],
  storedCost: 3,
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...partial,
});

// ---- duplicateIdentity — pure -------------------------------------------

describe('duplicateIdentity — pure composition', () => {
  it('emits the caller-supplied id + timestamp verbatim', () => {
    const identity = duplicateIdentity(
      'Wasp Alpha',
      'fresh-id',
      '2026-06-01T00:00:00.000Z',
      () => false,
      mintUniqueName,
    );
    expect(identity.id).toBe('fresh-id');
    expect(identity.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(identity.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('mints a unique name via the passed `mint` when the source is taken', () => {
    const taken = new Set([nameKeyOf('Wasp Alpha')]);
    const identity = duplicateIdentity(
      'Wasp Alpha',
      'x',
      STAMP,
      (nk) => taken.has(nk),
      mintUniqueName,
    );
    expect(identity.name).toBe('Wasp Alpha (2)');
  });

  it('returns the source name unchanged when nothing collides', () => {
    const identity = duplicateIdentity(
      'Wasp Alpha',
      'x',
      STAMP,
      () => false,
      mintUniqueName,
    );
    expect(identity.name).toBe('Wasp Alpha');
  });
});

// ---- End-to-end duplicate flow against an in-memory repo ----------------

describe('duplicate flow — against an in-memory LibraryRepo', () => {
  it('appends a second entry with a distinct id and a suffix-minted name', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const original = seedBuild({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Wasp Alpha',
    });
    const putResult = repo.put(original);
    expect(putResult.ok).toBe(true);

    const source = repo.get(original.id);
    expect(source).not.toBeNull();

    // Screen-side helper composition (id + timestamp are caller-minted so the
    // model stays deterministic; the screen supplies `crypto.randomUUID()` +
    // `new Date().toISOString()`).
    const identity = duplicateIdentity(
      source!.build.name,
      '00000000-0000-4000-8000-000000000099',
      '2026-06-01T00:00:00.000Z',
      (nk) => repo.findByNameKey(nk).length > 0,
      mintUniqueName,
    );
    expect(identity.name).toBe('Wasp Alpha (2)');

    const dupResult = repo.put({
      ...source!.build,
      id: identity.id,
      name: identity.name,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
    });
    expect(dupResult.ok).toBe(true);

    // Original entry untouched.
    expect(repo.entry(original.id)?.name).toBe('Wasp Alpha');
    // Copy present with the fresh id and the minted name.
    const copy = repo.entry(identity.id);
    expect(copy?.name).toBe('Wasp Alpha (2)');
    // Two entries in the repo.
    expect(repo.list().length).toBe(2);
  });
});

// ---- End-to-end delete flow against an in-memory repo -------------------

describe('delete flow — the only destructive path (§4.8)', () => {
  it('remove drops the entry from list() and the count decreases', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const a = seedBuild({ id: '00000000-0000-4000-8000-0000000000a1', name: 'Alpha' });
    const b = seedBuild({ id: '00000000-0000-4000-8000-0000000000a2', name: 'Bravo' });
    repo.put(a);
    repo.put(b);
    expect(repo.list().length).toBe(2);

    const result = repo.remove(a.id);
    expect(result.removed).toBe(true);
    expect(repo.list().length).toBe(1);
    expect(repo.entry(a.id)).toBeUndefined();
    expect(repo.entry(b.id)?.name).toBe('Bravo');
  });

  it('removing an unknown id is a no-op with `removed: false`', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const before = repo.list().length;
    const result = repo.remove('no-such-id');
    expect(result.removed).toBe(false);
    expect(repo.list().length).toBe(before);
  });
});
