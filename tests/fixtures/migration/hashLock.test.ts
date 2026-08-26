// Manifest hash-lock + migrate-through — the `test:fixtures` target
// (specs/database.md §7.3, FR-2, Custom Rule 3).
//
// Two responsibilities in one file so they never drift apart:
//
//   1. HASH-LOCK. Every fixture on disk hashes to its recorded manifest entry;
//      every manifest entry has a file; membership agrees both ways. Editing
//      or deleting a historical fixture flips a hash and fails here. This is
//      how "fixtures are never edited" becomes structural instead of
//      aspirational.
//
//   2. MIGRATE-THROUGH. Every valid fixture loads via `migrate(...)`; the
//      corrupt fixture returns `Result.err` (NEVER throws). This is the FR-2
//      failure-isolation proof: one bad artifact returns an error, never
//      crashes the loader.
//
// Manifest edits are hand-authored on new-fixture add (append a row + its
// SHA-256). A bulk regenerator would defeat the append-only guarantee (§7.3).

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta } from '../../../src/domain/index.js';
import { migrate } from '../../../src/io/migrate/migrate.js';
import { FIXTURES_DIR, MANIFEST_PATH, fixtureNames } from './fixtureLoader.js';

interface Manifest {
  readonly algorithm: 'SHA-256';
  readonly fixtures: Readonly<Record<string, string>>;
}

const loadManifest = (): Manifest => {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as {
    algorithm: string;
    fixtures?: Record<string, string>;
  };
  if (raw.algorithm !== 'SHA-256') {
    throw new Error(`manifest algorithm must be SHA-256 (got ${raw.algorithm})`);
  }
  if (typeof raw.fixtures !== 'object' || raw.fixtures === null) {
    throw new Error('manifest.fixtures must be an object');
  }
  return raw as Manifest;
};

const sha256Hex = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('migration fixtures manifest hash-lock (FR-2, §7.3)', () => {
  const manifest = loadManifest();
  const names = fixtureNames();

  it('has at least one fixture recorded', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(manifest.fixtures).length).toBeGreaterThan(0);
  });

  it('every fixture on disk hashes to its recorded manifest entry', () => {
    for (const name of names) {
      const bytes = fs.readFileSync(path.join(FIXTURES_DIR, name));
      const actual = sha256Hex(bytes);
      const recorded = manifest.fixtures[name];
      expect(recorded, `manifest is missing SHA-256 for ${name}`).toBeDefined();
      expect(actual, `SHA-256 mismatch for ${name} — historical fixture edited?`).toBe(recorded);
    }
  });

  it('every manifest entry points to a file that exists', () => {
    for (const name of Object.keys(manifest.fixtures)) {
      const filePath = path.join(FIXTURES_DIR, name);
      expect(fs.existsSync(filePath), `manifest lists ${name} but file is missing`).toBe(true);
      expect(name.endsWith('.json'), `manifest entry ${name} must be a .json file`).toBe(true);
    }
  });

  it('fixture directory and manifest agree on membership (no orphans either way)', () => {
    const filesOnDisk = new Set(names);
    const filesInManifest = new Set(Object.keys(manifest.fixtures));
    for (const name of filesOnDisk) {
      expect(
        filesInManifest.has(name),
        `fixture ${name} exists on disk but is missing from manifest`,
      ).toBe(true);
    }
    for (const name of filesInManifest) {
      expect(
        filesOnDisk.has(name),
        `manifest lists ${name} but file is missing from disk`,
      ).toBe(true);
    }
  });
});

describe('migration fixtures — migrate() load-through (FR-2 failure isolation)', () => {
  const names = fixtureNames();

  it('every valid-* fixture loads through migrate() to a Loaded result', () => {
    for (const name of names) {
      if (!path.basename(name).startsWith('valid-')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')) as unknown;
      const r = migrate(catalog, raw, meta());
      expect(r.ok, `fixture ${name} should load, got error`).toBe(true);
    }
  });

  it('every corrupt-* fixture returns Result.err (never throws — FR-2)', () => {
    for (const name of names) {
      if (!path.basename(name).startsWith('corrupt-')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')) as unknown;
      let result: unknown;
      expect(() => {
        result = migrate(catalog, raw, meta());
      }, `fixture ${name} threw — migrate() must never throw across the io boundary`).not.toThrow();
      expect(
        (result as { ok: boolean }).ok,
        `fixture ${name} should have returned Result.err`,
      ).toBe(false);
    }
  });
});
