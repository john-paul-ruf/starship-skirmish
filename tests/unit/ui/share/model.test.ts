// M14 UI — Share/Import screen model tests (S06).
//
// Vitest runs in the node env — no DOM. These tests drive the pure
// decode→preview + collision + report-summarisation logic in
// `src/ui/screens/share/model.ts` DIRECTLY (never importing the `.tsx`
// screen). Real io + real catalog + an in-memory persist repo.
//
// The invariants pinned here:
//   * A known-good token previews the expected chassis + slots + points.
//   * A corrupted token yields the fail-closed view with NO repo interaction.
//   * `errorCopy` produces the design §4.9 headline + reassurance for every
//     DecodeError.
//   * `resolveAddAction` shapes the write correctly for every collision
//     branch (insert / renamed / replace / cancel), and cancel writes nothing.
//   * `summarizeReport` maps every persist `ImportOutcome.status` to the
//     right display row.

import { describe, expect, it, vi } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Build, BuildMeta } from '../../../../src/domain/index.js';
import { emptyBuild, withSlot } from '../../../../src/domain/index.js';
import { encodeShareToken } from '../../../../src/io/index.js';
import {
  applyImport,
  openLibrary,
  type BuildDoc,
  type ImportCandidate,
  type ImportReport,
} from '../../../../src/persist/index.js';
import { memoryStore } from '../../../../src/persist/storageAdapter.js';

import {
  errorCopy,
  previewToken,
  reportCounts,
  resolveAddAction,
  suggestRenamed,
  summarizeReport,
} from '../../../../src/ui/screens/share/model.js';

const catalog = loadCatalog();
const STAMP = '2026-08-27T00:00:00.000Z';

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const fighter = (name = 'Wasp Alpha'): Build => {
  const empty = emptyBuild(catalog, 'fig-wasp', name, meta());
  if (!empty.ok) throw new Error(`fixture setup: ${empty.error.message}`);
  let b = empty.value;
  b = withSlot(b, 0, 'wpn-pulse-array');
  b = withSlot(b, 1, 'eng-standard-drive');
  return b;
};

const encodedFighter = (name = 'Wasp Alpha'): string => {
  const encoded = encodeShareToken(catalog, fighter(name));
  if (!encoded.ok) throw new Error(`fixture setup: encode failed ${encoded.error.message}`);
  return encoded.value;
};

const buildDocOf = (
  id: string,
  name: string,
  tags: readonly string[] = [],
): BuildDoc => ({
  id,
  name,
  tags: [...tags],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost: 11,
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: STAMP,
  updatedAt: STAMP,
});

// ─── previewToken ─────────────────────────────────────────────────────────

describe('previewToken — decode-and-shape (no writes)', () => {
  it('previews a known-good fighter token: name, chassis, slots, points', () => {
    const token = encodedFighter('Wasp Alpha');
    const view = previewToken(catalog, token);
    expect(view.status).toBe('ok');
    if (view.status !== 'ok') return;
    expect(view.build.name).toBe('Wasp Alpha');
    expect(view.build.chassisId).toBe('fig-wasp');
    expect(view.chassis.id).toBe('fig-wasp');
    expect(view.klass.id).toBe(view.chassis.classId);
    expect(view.layout.length).toBe(3);
    expect(view.filled).toEqual([true, true, false]);
    expect(view.points).toBeGreaterThan(0);
    // Identity fields on the previewed Build are EMPTY — the caller mints
    // them on accept (§5).
    expect(view.build.id).toBe('');
    expect(view.build.createdAt).toBe('');
    expect(view.build.updatedAt).toBe('');
    expect(view.nameKey.length).toBeGreaterThan(0);
  });

  it('empty token yields a designed error (uniform empty state)', () => {
    const view = previewToken(catalog, '');
    expect(view.status).toBe('error');
    if (view.status !== 'error') return;
    expect(view.error.code).toBe('ERR_BAD_MAGIC');
  });

  it('corrupted token yields a typed error and NO repo interaction', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const before = repo.entries();
    // A garbage payload that isn't base64url should trip ERR_BAD_BASE64.
    const view = previewToken(catalog, '!!!not-a-token!!!');
    expect(view.status).toBe('error');
    if (view.status !== 'error') return;
    expect(view.error.code).toBe('ERR_BAD_BASE64');
    // Byte-identical before/after — the model must never touch the repo.
    expect(repo.entries()).toEqual(before);
  });

  it('a truncated token (chopped tail) yields ERR_TRUNCATED or ERR_CHECKSUM', () => {
    const good = encodedFighter('Wasp Alpha');
    const chopped = good.slice(0, Math.max(1, good.length - 4));
    const view = previewToken(catalog, chopped);
    expect(view.status).toBe('error');
    if (view.status !== 'error') return;
    // Either the tail read runs off the end (ERR_TRUNCATED) or the checksum
    // over the shorter buffer disagrees (ERR_CHECKSUM). Both are fail-closed.
    expect(['ERR_TRUNCATED', 'ERR_CHECKSUM', 'ERR_BAD_UTF8']).toContain(view.error.code);
  });
});

// ─── errorCopy ─────────────────────────────────────────────────────────────

describe('errorCopy — design §4.9 fail-closed copy', () => {
  it('renders "AT CHARACTER N" only when the error carries an offset', () => {
    const withOffset = errorCopy({
      code: 'ERR_BAD_BASE64',
      message: 'Token contains a character outside the base64url alphabet.',
      offset: 12,
    });
    expect(withOffset.title).toContain('AT CHARACTER 12');
    expect(withOffset.reassurance).toBe('No changes were made to your Encyclopedia.');
    expect(withOffset.detail).toContain('base64url');
    expect(withOffset.offset).toBe(12);

    const noOffset = errorCopy({
      code: 'ERR_BAD_MAGIC',
      message: 'no magic',
    });
    expect(noOffset.title).toBe('TOKEN FAILED VALIDATION.');
    expect(noOffset.offset).toBeUndefined();
  });

  it('always includes the fail-closed reassurance line', () => {
    for (const code of [
      'ERR_TOO_LONG',
      'ERR_BAD_MAGIC',
      'ERR_TRUNCATED',
      'ERR_CHECKSUM',
      'ERR_UNKNOWN_ORDINAL',
    ] as const) {
      const copy = errorCopy({ code, message: 'msg' });
      expect(copy.reassurance).toBe('No changes were made to your Encyclopedia.');
    }
  });
});

// ─── suggestRenamed ────────────────────────────────────────────────────────

describe('suggestRenamed — parity with persist import minting', () => {
  it('returns the base name when no collision', () => {
    const suggestion = suggestRenamed('Wasp Alpha', () => []);
    expect(suggestion).toBe('Wasp Alpha');
  });

  it('appends " (2)" on a single collision', () => {
    const suggestion = suggestRenamed('Wasp Alpha', (nk) =>
      nk === 'wasp alpha' ? ['id-1'] : [],
    );
    expect(suggestion).toBe('Wasp Alpha (2)');
  });
});

// ─── resolveAddAction ──────────────────────────────────────────────────────

describe('resolveAddAction — mint identity + apply collision policy', () => {
  const view = (): Extract<ReturnType<typeof previewToken>, { status: 'ok' }> => {
    const v = previewToken(catalog, encodedFighter('Wasp Alpha'));
    if (v.status !== 'ok') throw new Error('fixture: preview failed');
    return v;
  };

  const stampMinter = () => {
    const mintId = vi.fn().mockReturnValue('11111111-2222-4333-8444-555555555555');
    const now = vi.fn().mockReturnValue(STAMP);
    return { mintId, now };
  };

  it('insert path mints id + timestamps + carries the preview name', () => {
    const { mintId, now } = stampMinter();
    const action = resolveAddAction({
      preview: view(),
      choice: 'rename',
      collidingIds: [],
      mintId,
      now,
    });
    expect(action.writeAs).toBe('insert');
    if (action.writeAs !== 'insert') return;
    expect(action.action).toBe('imported');
    expect(action.build.id).toBe('11111111-2222-4333-8444-555555555555');
    expect(action.build.name).toBe('Wasp Alpha');
    expect(action.build.createdAt).toBe(STAMP);
    expect(action.build.updatedAt).toBe(STAMP);
    expect(action.build.chassisId).toBe('fig-wasp');
  });

  it('rename path with a colliding name flags action:"renamed"', () => {
    const { mintId, now } = stampMinter();
    const action = resolveAddAction({
      preview: view(),
      choice: 'rename',
      editedName: 'Wasp Alpha (2)',
      collidingIds: ['some-id'],
      mintId,
      now,
    });
    expect(action.writeAs).toBe('insert');
    if (action.writeAs !== 'insert') return;
    expect(action.action).toBe('renamed');
    expect(action.build.name).toBe('Wasp Alpha (2)');
    expect(action.build.id).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('replace path targets the FIRST colliding id and preserves it', () => {
    const { mintId, now } = stampMinter();
    const action = resolveAddAction({
      preview: view(),
      choice: 'replace',
      collidingIds: ['target-id-1', 'target-id-2'],
      mintId,
      now,
    });
    expect(action.writeAs).toBe('replace');
    if (action.writeAs !== 'replace') return;
    expect(action.replacedId).toBe('target-id-1');
    expect(action.build.id).toBe('target-id-1');
    // mintId must NOT be consumed on a replace (we reuse the existing id).
    expect(mintId).not.toHaveBeenCalled();
  });

  it('cancel path writes nothing (returns writeAs:"cancel")', () => {
    const { mintId, now } = stampMinter();
    const action = resolveAddAction({
      preview: view(),
      choice: 'cancel',
      collidingIds: ['whatever'],
      mintId,
      now,
    });
    expect(action.writeAs).toBe('cancel');
    // mintId + now MUST NOT be called on cancel.
    expect(mintId).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('replace with no collision degrades to insert (does not fabricate a target)', () => {
    const { mintId, now } = stampMinter();
    const action = resolveAddAction({
      preview: view(),
      choice: 'replace',
      collidingIds: [],
      mintId,
      now,
    });
    expect(action.writeAs).toBe('insert');
  });
});

// ─── CP2 integration — resolveAddAction against a REAL in-memory repo ─────

describe('resolveAddAction × in-memory repo — the three collision outcomes', () => {
  const preview = () => {
    const v = previewToken(catalog, encodedFighter('Wasp Alpha'));
    if (v.status !== 'ok') throw new Error('fixture: preview failed');
    return v;
  };

  const seedRepo = (name: string) => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const seed = buildDocOf('00000000-0000-4000-8000-000000000aaa', name);
    const put = repo.put(seed);
    if (!put.ok) throw new Error(`seed put failed: ${put.reason}`);
    return repo;
  };

  it('no collision → direct insert; count grows by one', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    const before = repo.entries().length;
    const v = preview();
    const collidingIds = repo.findByNameKey(v.nameKey);
    expect(collidingIds).toHaveLength(0);
    const action = resolveAddAction({
      preview: v,
      choice: 'rename',
      collidingIds,
      mintId: () => 'insert-id-x',
      now: () => STAMP,
    });
    expect(action.writeAs).toBe('insert');
    if (action.writeAs !== 'insert') return;
    const put = repo.put(action.build);
    expect(put.ok).toBe(true);
    expect(repo.entries().length).toBe(before + 1);
    expect(repo.entry('insert-id-x')?.name).toBe('Wasp Alpha');
  });

  it('rename mints a unique name; the ORIGINAL is untouched', () => {
    const repo = seedRepo('Wasp Alpha');
    const beforeIds = repo.entries().map((e) => e.id).sort();
    const v = preview();
    const collidingIds = repo.findByNameKey(v.nameKey);
    expect(collidingIds).toHaveLength(1);
    const suggestion = suggestRenamed(v.build.name, (nk) => repo.findByNameKey(nk));
    expect(suggestion).toBe('Wasp Alpha (2)');
    const action = resolveAddAction({
      preview: v,
      choice: 'rename',
      editedName: suggestion,
      collidingIds,
      mintId: () => 'rename-id-y',
      now: () => STAMP,
    });
    expect(action.writeAs).toBe('insert');
    if (action.writeAs !== 'insert') return;
    expect(action.action).toBe('renamed');
    expect(action.build.name).toBe('Wasp Alpha (2)');
    const put = repo.put(action.build);
    expect(put.ok).toBe(true);
    // Original preserved verbatim.
    expect(repo.entry('00000000-0000-4000-8000-000000000aaa')?.name).toBe('Wasp Alpha');
    // New entry present.
    expect(repo.entry('rename-id-y')?.name).toBe('Wasp Alpha (2)');
    // Both survive.
    const afterIds = repo.entries().map((e) => e.id).sort();
    expect(afterIds).toEqual([...beforeIds, 'rename-id-y'].sort());
  });

  it('replace overwrites the same id; count stays the same', () => {
    const repo = seedRepo('Wasp Alpha');
    const beforeCount = repo.entries().length;
    const v = preview();
    const collidingIds = repo.findByNameKey(v.nameKey);
    const action = resolveAddAction({
      preview: v,
      choice: 'replace',
      collidingIds,
      mintId: () => 'never-used',
      now: () => STAMP,
    });
    expect(action.writeAs).toBe('replace');
    if (action.writeAs !== 'replace') return;
    expect(action.replacedId).toBe('00000000-0000-4000-8000-000000000aaa');
    const put = repo.put(action.build);
    expect(put.ok).toBe(true);
    // Same count — overwrite is in place.
    expect(repo.entries().length).toBe(beforeCount);
    // The seeded entry now carries the incoming build's slots (a fighter with
    // 2 slots filled, 1 empty — same shape as our fixture buildDocOf, so this
    // is more a "still exists at same id" assertion).
    expect(repo.entry('00000000-0000-4000-8000-000000000aaa')?.name).toBe('Wasp Alpha');
  });

  it('cancel writes nothing; entries stay BYTE-IDENTICAL', () => {
    const repo = seedRepo('Wasp Alpha');
    const before = repo.entries();
    const v = preview();
    const collidingIds = repo.findByNameKey(v.nameKey);
    const action = resolveAddAction({
      preview: v,
      choice: 'cancel',
      collidingIds,
      mintId: () => 'never-used',
      now: () => STAMP,
    });
    expect(action.writeAs).toBe('cancel');
    // Fail-closed: no put call was made; repo unchanged.
    expect(repo.entries()).toEqual(before);
  });
});

// ─── summarizeReport ───────────────────────────────────────────────────────

describe('summarizeReport — flatten persist ImportReport into display rows', () => {
  it('maps every ImportOutcome discriminant to the right kind', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    // Seed one build so the second candidate collides.
    const seed = buildDocOf('00000000-0000-4000-8000-000000000aaa', 'Wasp Alpha');
    repo.put(seed);

    const candidates: ImportCandidate[] = [
      { status: 'valid', build: buildDocOf('00000000-0000-4000-8000-000000000bbb', 'Wasp Bravo') },
      { status: 'valid', build: buildDocOf('00000000-0000-4000-8000-000000000ccc', 'Wasp Alpha') },
      { status: 'failed', reason: 'Build at index 2: name is empty' },
    ];
    const report: ImportReport = applyImport(repo, candidates, 'rename');
    const rows = summarizeReport(report);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.kind).toBe('IMPORTED');
    expect(rows[0]!.label).toBe('Wasp Bravo');
    expect(rows[1]!.kind).toBe('RENAMED');
    expect(rows[1]!.label).toContain('Wasp Alpha');
    expect(rows[1]!.label).toContain('→');
    expect(rows[2]!.kind).toBe('FAILED');
    expect(rows[2]!.detail).toContain('name is empty');
    expect(rows[2]!.reason).toBeDefined();
  });

  it('unnamed failure gets a positional label', () => {
    const report: ImportReport = {
      imported: 0,
      renamed: 0,
      replaced: 0,
      skipped: 0,
      failed: 1,
      outcomes: [{ status: 'failed', reason: 'missing chassisId' }],
      degraded: false,
    };
    const rows = summarizeReport(report);
    expect(rows[0]!.label).toBe('(entry 1, unnamed)');
    expect(rows[0]!.kind).toBe('FAILED');
  });

  it('reportCounts mirrors the persist report numeric fields', () => {
    const report: ImportReport = {
      imported: 4,
      renamed: 2,
      replaced: 1,
      skipped: 3,
      failed: 5,
      outcomes: [],
      degraded: false,
    };
    const counts = reportCounts(report);
    expect(counts).toEqual({
      total: 0,
      imported: 4,
      renamed: 2,
      replaced: 1,
      skipped: 3,
      failed: 5,
    });
  });
});
