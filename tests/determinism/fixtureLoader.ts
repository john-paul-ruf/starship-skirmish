// tests/determinism/fixtureLoader.ts — shared fixture discovery for the determinism
// tests (golden-trace, shuffle, manifest hash-lock). Kept small and deliberate: all
// three tests read the SAME on-disk fixtures via this loader, so a change to the
// discovery rules affects them together, not one at a time.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '../../tools/balance/scenario.js';

/** Absolute path of `tests/determinism/fixtures/`. */
export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** Manifest file (SHA-256 per fixture; the append-only hash lock). */
export const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'manifest.json',
);

export interface FixtureFile {
  readonly name: string;
  readonly scenario: Scenario;
  readonly recordedDigest: string;
  readonly bytes: Buffer;
}

/** Names of every `*.json` fixture, sorted for deterministic test ordering. */
export const fixtureNames = (): readonly string[] =>
  fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

/**
 * Load one fixture. The recorded digest sits alongside the scenario fields on disk
 * (that shape is written by `tools/balance/cli.ts --record`); we split them here so
 * `runScenario` never sees a foreign `digest` key it doesn't understand.
 */
export const loadFixture = (name: string): FixtureFile => {
  const filePath = path.join(FIXTURES_DIR, name);
  const bytes = fs.readFileSync(filePath);
  const parsed = JSON.parse(bytes.toString('utf8')) as Scenario & { digest?: string };
  if (typeof parsed.digest !== 'string') {
    throw new Error(`fixture ${name} is missing its recorded digest`);
  }
  const { digest: recordedDigest, ...scenarioFields } = parsed;
  return {
    name,
    scenario: scenarioFields as Scenario,
    recordedDigest,
    bytes,
  };
};
