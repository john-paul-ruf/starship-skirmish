// Harness (bot-vs-bot) golden-fixture determinism (S06, FR-33, architecture
// §7.5, Custom Rule 3 / FR-2 — append-only law).
//
// The physics golden (`tests/determinism/golden.test.ts`) locks scripted
// physics scenarios; the combat golden (`combatGolden.test.ts`) locks
// scripted / `simpleFire` matches; THIS file locks bot-vs-bot matches —
// the *heuristic bot* is a NEW determinism surface neither of those cover
// (`generateBotFleet` + `previewPath` movement + threat-scored attack, all
// inside `src/ai/**`).
//
// For every fixture under `tests/determinism/harness/*.json` this asserts:
//
//   1. The append-only hash lock: every fixture on disk hashes to its
//      manifest SHA-256; membership agrees both ways. Editing a historical
//      fixture flips its SHA and fails CI (Custom Rule 3 / FR-2).
//   2. Golden replay: `runMatchScenario` — regenerating fleets from
//      `(seed, budget, fleetTiers)` — reproduces the recorded per-turn
//      `matchDigest` list byte-for-byte AND the recorded outcome (kind +
//      turn count + winning fleetId).
//
// A regression in `generateBotFleet`, either planner, `HeuristicCommander`,
// or the loop surfaces as a turn-N digest mismatch — the fixture localises
// the failure to a specific turn. Adding a new fixture: append a new entry
// to `recordMatches.ts` RECIPES and run `tsx tests/determinism/harness/
// recordMatches.ts`; never edit a historical fixture.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { loadCatalog } from '../../src/catalog/index.js';
import { runMatchScenario } from '../../tools/balance/scenario.js';
import {
  FIXTURES_DIR,
  MANIFEST_PATH,
  fixtureNames,
  loadFixture,
} from './harness/fixtureLoader.js';

const sha256Hex = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

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
    throw new Error(
      `harness manifest algorithm must be SHA-256 (got ${raw.algorithm})`,
    );
  }
  if (typeof raw.fixtures !== 'object' || raw.fixtures === null) {
    throw new Error('harness manifest.fixtures must be an object');
  }
  return raw as Manifest;
};

// ---------------------------------------------------------------------------
// Manifest hash-lock (Custom Rule 3 / FR-2) — mirrors combatGolden.test.ts.
// ---------------------------------------------------------------------------

describe('harness fixtures manifest hash-lock (Custom Rule 3, FR-2, §7.5)', () => {
  const manifest = loadManifest();
  const names = fixtureNames();

  it('has at least one harness fixture recorded', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(manifest.fixtures).length).toBeGreaterThan(0);
  });

  it('every fixture on disk hashes to its recorded manifest entry', () => {
    for (const name of names) {
      const bytes = fs.readFileSync(path.join(FIXTURES_DIR, name));
      const actual = sha256Hex(bytes);
      const recorded = manifest.fixtures[name];
      expect(
        recorded,
        `harness manifest missing SHA-256 for ${name}`,
      ).toBeDefined();
      expect(
        actual,
        `SHA-256 mismatch for ${name} — historical harness fixture edited (append-only per Custom Rule 3)?`,
      ).toBe(recorded);
    }
  });

  it('every manifest entry points to a fixture file on disk', () => {
    for (const name of Object.keys(manifest.fixtures)) {
      const filePath = path.join(FIXTURES_DIR, name);
      expect(
        fs.existsSync(filePath),
        `manifest lists ${name} but file is missing`,
      ).toBe(true);
      expect(
        name.endsWith('.json'),
        `manifest entry ${name} must be a .json file`,
      ).toBe(true);
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

// ---------------------------------------------------------------------------
// Golden replay — for every fixture, run `runMatchScenario` and assert every
// per-turn digest + the outcome match the recorded values. `runMatchScenario`
// regenerates fleets from `(seed, budget, fleetTiers)` so the whole
// generate → validate → resolve → runTurn pipeline sits under the lock.
// ---------------------------------------------------------------------------

describe('harness golden replay (FR-33 + §7.5 + Custom Rule 3)', () => {
  const names = fixtureNames();
  if (names.length === 0) {
    it('has at least one recorded harness fixture', () => {
      throw new Error(
        'no fixtures found under tests/determinism/harness/ — run `tsx tests/determinism/harness/recordMatches.ts`',
      );
    });
    return;
  }
  // Catalog is `loadCatalog()`-once — the loader is pure (static JSON imports)
  // and freezes its result; every fixture-replay shares the same instance,
  // exactly as the production match code does.
  const catalog = loadCatalog();

  for (const name of names) {
    describe(`${name}`, () => {
      const fixture = loadFixture(name);

      it('every per-turn digest matches recorded (regenerated fleets)', async () => {
        const res = await runMatchScenario(fixture.scenario, catalog);
        expect(res.turnDigests).toEqual(fixture.turnDigests);
      });

      it('outcome kind + turn count + winner match recorded', async () => {
        const res = await runMatchScenario(fixture.scenario, catalog);
        expect(res.outcome.kind).toBe(fixture.outcome.kind);
        expect(res.outcome.turns).toBe(fixture.outcome.turns);
        // Custom Rule 5 permits only { victory | mutual-destruction }; only
        // `victory` carries a `fleetId`.
        if (
          res.outcome.kind === 'victory' &&
          fixture.outcome.kind === 'victory'
        ) {
          expect(res.outcome.fleetId).toBe(fixture.outcome.fleetId);
        }
      });
    });
  }
});
