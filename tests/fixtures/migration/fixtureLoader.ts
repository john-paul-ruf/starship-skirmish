// tests/fixtures/migration/fixtureLoader.ts — shared discovery for the migration
// fixture suite. Mirrors `tests/determinism/fixtureLoader.ts`: the hash-lock
// test and the migrate-through test both walk the SAME on-disk fixtures via
// this loader, so a change to discovery affects them together.
//
// FIXTURES ARE HISTORICAL ARTIFACTS. Their bytes are hashed in manifest.json;
// discovery is append-only by construction (new files under `v<N>/` are picked
// up automatically, but a manifest entry is required for the hash-lock test to
// pass).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of `tests/fixtures/migration/`. */
export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** SHA-256 manifest — one entry per fixture, hand-authored on new-fixture add. */
export const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'manifest.json',
);

/**
 * Names of every `*.json` fixture under `v<N>/` subdirectories, relative to
 * `FIXTURES_DIR`, sorted for deterministic test ordering. Excludes the manifest
 * itself (which sits at the root of `FIXTURES_DIR`, not under a `v<N>/`).
 */
export const fixtureNames = (): readonly string[] => {
  const results: string[] = [];
  const entries = fs.readdirSync(FIXTURES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^v\d+$/.test(entry.name)) continue;
    const subdir = path.join(FIXTURES_DIR, entry.name);
    for (const file of fs.readdirSync(subdir)) {
      if (!file.endsWith('.json')) continue;
      results.push(`${entry.name}/${file}`);
    }
  }
  return results.sort();
};
