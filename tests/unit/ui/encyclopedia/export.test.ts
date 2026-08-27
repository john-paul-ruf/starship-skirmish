// M14 UI — Encyclopedia export + backup nudge tests (S04 checkpoint 3).
//
// Pure logic pass — no DOM, no download. The screen calls `exportLibrary` +
// `exportToText` (io) and `markExported` (persist) directly; here we pin:
//
//   1. `exportLibrary` on a repo-live `Build[]` produces the archival
//      envelope shape (§6, architecture §8.2) — `format`, versions, per-build
//      identity-stripped copies.
//   2. `exportToText` output round-trips through JSON.parse to the same
//      envelope (byte-identical would need caller-supplied `exportedAt`; we
//      pin the structural round-trip).
//   3. `markExported` stamps `lastExportAt` on the meta record; subsequent
//      `repo.lastExportAt()` reads the same string.
//   4. `exportFilename` composes a `YYYY-MM-DD` filename (deterministic).
//   5. `backupNudgeText` composes the §4.8 nudge line with correct plural,
//      "never exported" fallback, and day-since arithmetic.
//   6. `refitReceiptText` composes the §4.7 receipt (also covered in model
//      tests — the redundancy makes CP3's "refit receipt derivation" gate
//      independently verifiable).

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Build } from '../../../../src/domain/index.js';
import { exportLibrary, exportToText } from '../../../../src/io/index.js';
import { openLibrary } from '../../../../src/persist/index.js';
import { memoryStore } from '../../../../src/persist/storageAdapter.js';
import {
  backupNudgeText,
  daysSince,
} from '../../../../src/ui/screens/encyclopedia/BackupBanner.js';
import {
  exportFilename,
  refitReceiptText,
} from '../../../../src/ui/screens/encyclopedia/model.js';

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

// ---- exportLibrary + exportToText ----------------------------------------

describe('export — exportLibrary envelope shape (§6, architecture §8.2)', () => {
  it('produces the archival envelope with the discriminator + schema/catalog stamps', () => {
    const build = seedBuild({ id: 'a', name: 'Alpha', tags: ['swarm'] });
    const exp = exportLibrary(catalog, [build], '2026-08-27T12:00:00.000Z');
    expect(exp.format).toBe('starship-skirmish/library');
    expect(exp.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(exp.catalogVersion).toBe(catalog.catalogVersion);
    expect(exp.exportedAt).toBe('2026-08-27T12:00:00.000Z');
    expect(exp.builds.length).toBe(1);
    // Identity-stripped per §6.
    expect(exp.builds[0]).not.toHaveProperty('id');
    expect(exp.builds[0]).not.toHaveProperty('createdAt');
    expect(exp.builds[0]).not.toHaveProperty('updatedAt');
    // Storable axes kept.
    expect(exp.builds[0]?.name).toBe('Alpha');
    expect(exp.builds[0]?.tags).toEqual(['swarm']);
    expect(exp.builds[0]?.chassisId).toBe('fig-wasp');
    expect(exp.builds[0]?.storedCost).toBe(3);
  });

  it('exportToText → JSON.parse round-trips to the same envelope', () => {
    const build = seedBuild({ id: 'a', name: 'Alpha' });
    const exp = exportLibrary(catalog, [build], STAMP);
    const text = exportToText(exp);
    const parsed = JSON.parse(text) as unknown;
    expect(parsed).toEqual(exp);
  });

  it('empty selection → empty builds array (still a valid envelope)', () => {
    const exp = exportLibrary(catalog, [], STAMP);
    expect(exp.builds).toEqual([]);
    expect(exp.format).toBe('starship-skirmish/library');
  });
});

// ---- markExported + lastExportAt round-trip -----------------------------

describe('export — markExported / lastExportAt', () => {
  it('stamps the timestamp on the meta record; lastExportAt returns the same string', () => {
    const { repo } = openLibrary(catalog, { store: memoryStore(), now: () => STAMP });
    expect(repo.lastExportAt()).toBeNull();
    repo.markExported('2026-08-27T12:00:00.000Z');
    expect(repo.lastExportAt()).toBe('2026-08-27T12:00:00.000Z');
  });
});

// ---- exportFilename ------------------------------------------------------

describe('exportFilename — deterministic download name', () => {
  it('carries the YYYY-MM-DD prefix + scope', () => {
    expect(exportFilename('2026-08-27T12:00:00.000Z', 'all')).toBe(
      'starship-skirmish-library-all-2026-08-27.json',
    );
    expect(exportFilename('2026-08-27T12:00:00.000Z', 'selected')).toBe(
      'starship-skirmish-library-selected-2026-08-27.json',
    );
  });

  it('short / malformed timestamp degrades to "unknown"', () => {
    expect(exportFilename('bad', 'all')).toBe('starship-skirmish-library-all-unknown.json');
  });
});

// ---- backupNudgeText -----------------------------------------------------

describe('backupNudgeText — the §4.8 recurring-nudge line', () => {
  const NOW = Date.parse('2026-08-27T00:00:00.000Z');

  it('never exported → the "Never exported" fallback', () => {
    expect(backupNudgeText(3, null, NOW)).toBe(
      'Clearing site data deletes 3 builds. Never exported.',
    );
  });

  it('exported today → "today"', () => {
    expect(backupNudgeText(3, '2026-08-27T09:00:00.000Z', NOW + 5 * 60 * 60 * 1000)).toBe(
      'Clearing site data deletes 3 builds. Last export: today.',
    );
  });

  it('exported 1 day ago → "1 day ago"; N > 1 → "N days ago"', () => {
    expect(backupNudgeText(3, '2026-08-26T00:00:00.000Z', NOW)).toBe(
      'Clearing site data deletes 3 builds. Last export: 1 day ago.',
    );
    expect(backupNudgeText(3, '2026-08-09T00:00:00.000Z', NOW)).toBe(
      'Clearing site data deletes 3 builds. Last export: 18 days ago.',
    );
  });

  it('singular / plural: 1 build vs N builds', () => {
    expect(backupNudgeText(1, null, NOW)).toContain('1 build.');
    expect(backupNudgeText(2, null, NOW)).toContain('2 builds.');
  });

  it('unreadable timestamp falls back to a directive to export again', () => {
    expect(backupNudgeText(3, 'not-a-date', NOW)).toBe(
      'Clearing site data deletes 3 builds. Last export timestamp unreadable — export again.',
    );
  });

  it('daysSince returns null for garbage input', () => {
    expect(daysSince('nope', Date.now())).toBeNull();
  });
});

// ---- refitReceiptText (repeat for the CP3 verification gate) -------------

describe('refitReceiptText — §4.7 receipt string', () => {
  it('composes the "Catalog vX → vY. Recalculated A → B PTS." line', () => {
    expect(refitReceiptText(5, 7, 148, 152)).toBe(
      'Catalog v5 → v7. Recalculated 148 → 152 PTS.',
    );
  });
});
