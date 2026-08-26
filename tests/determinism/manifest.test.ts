// Manifest hash-lock — the structural enforcement of "fixtures are append-only"
// (Custom Rule 3, FR-2, architecture §7.5 note "Fixtures are append-only.").
//
// `manifest.json` records a SHA-256 for every fixture. This test:
//   1. Every fixture on disk has a matching entry in the manifest, and its bytes
//      hash to the recorded value. Editing a historical fixture flips the hash and
//      fails here.
//   2. Every manifest entry has a matching file. Deleting a historical fixture
//      fails here.
//   3. Every filename listed in the manifest ends with `.json` and appears in
//      `fixtureNames()` — no orphan or misspelled entries.
//
// The manifest is intentionally hand-edited on new-fixture add (append the row +
// its SHA); a bulk regenerator would defeat the append-only guarantee.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
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

describe('fixtures manifest hash-lock (Custom Rule 3, FR-2)', () => {
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
      expect(filesInManifest.has(name), `fixture ${name} exists on disk but is missing from manifest`).toBe(true);
    }
    for (const name of filesInManifest) {
      expect(filesOnDisk.has(name), `manifest lists ${name} but file is missing from disk`).toBe(true);
    }
  });
});
