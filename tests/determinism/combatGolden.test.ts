// Combat golden-fixture determinism (architecture §7.5, FR-19/FR-21/FR-33,
// NFR-Correctness) — S05's regression infrastructure for the assembled sim.
//
// Runs every fixture under `tests/determinism/combat/*.json` through the
// canonical `runMatch` path and asserts:
//
//   1. The initial-state digest matches the recorded value (placement +
//      config seam are deterministic — FR-12 fleet placement, §7.3 rule 1
//      sorted iteration).
//   2. Every per-turn digest matches the recorded value — a regression
//      localizes to a specific turn.
//   3. The outcome (`victory | mutual-destruction` + turn count, Custom
//      Rule 5) matches the recorded value.
//   4. The append-only hash lock: every fixture on disk hashes to its
//      manifest SHA-256; membership agrees both ways (mirrors the migration
//      fixture hash-lock in `tests/fixtures/migration/hashLock.test.ts` and
//      the physics golden manifest in `tests/determinism/manifest.test.ts`).
//
// New fixtures are ADDED by editing `recordFixtures.ts` and running it — the
// script recomputes the manifest and appends the new SHA. Editing a
// historical fixture flips its SHA, which flips the hash-lock, which fails
// CI (Custom Rule 3 / FR-2 / §7.5 — fixtures are append-only artifacts).

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import {
  buildInitialState,
  matchDigest,
  runMatch,
  runTurn,
  type MatchConfig,
  type MatchState,
} from '../../src/sim/index.js';
import {
  buildCommanders,
  type FixtureCommanderSpec,
} from './combat/recordFixtures.js';
import type { Fixture } from './combat/fixtureLoader.js';
import {
  COMBAT_FIXTURES_DIR,
  combatFixtureNames,
  loadCombatFixture,
} from './combat/fixtureLoader.js';

const COMBAT_DIR = COMBAT_FIXTURES_DIR;
const MANIFEST_PATH = path.join(COMBAT_DIR, 'manifest.json');

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
    throw new Error(`combat manifest algorithm must be SHA-256 (got ${raw.algorithm})`);
  }
  if (typeof raw.fixtures !== 'object' || raw.fixtures === null) {
    throw new Error('combat manifest.fixtures must be an object');
  }
  return raw as Manifest;
};

const configOf = (f: Fixture): MatchConfig => ({
  seed: f.seed,
  fleets: f.fleets,
  arena: f.arena,
  physics: f.physics,
  combat: f.combat,
});

/**
 * Replay a fixture through the pure `runTurn` loop and collect per-turn
 * `matchDigest`s. Mirrors the recorder's `runMatchRecord` so failure
 * localizes to the same turn boundary the recorder recorded at.
 */
const replayAndCollect = async (
  initial: MatchState,
  commanders: readonly ReturnType<typeof buildCommanders>[number][],
  maxTurns: number,
): Promise<string[]> => {
  let state = initial;
  const digests: string[] = [];
  let outcome = null as Awaited<ReturnType<typeof runTurn>>['outcome'];
  let turnsElapsed = 0;
  while (outcome === null) {
    turnsElapsed += 1;
    if (turnsElapsed > maxTurns) {
      throw new Error(
        `replay exceeded ${maxTurns} turns without terminating — sim regression or fixture drift?`,
      );
    }
    const result = await runTurn(state, commanders);
    state = result.state;
    digests.push(matchDigest(state));
    outcome = result.outcome;
  }
  return digests;
};

// ---------------------------------------------------------------------------
// Manifest hash-lock (Custom Rule 3 / FR-2) — mirrors manifest.test.ts.
// ---------------------------------------------------------------------------

describe('combat fixtures manifest hash-lock (Custom Rule 3, FR-2, §7.5)', () => {
  const manifest = loadManifest();
  const names = combatFixtureNames();

  it('has at least one combat fixture recorded', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(manifest.fixtures).length).toBeGreaterThan(0);
  });

  it('every fixture on disk hashes to its recorded manifest entry', () => {
    for (const name of names) {
      const bytes = fs.readFileSync(path.join(COMBAT_DIR, name));
      const actual = sha256Hex(bytes);
      const recorded = manifest.fixtures[name];
      expect(recorded, `combat manifest missing SHA-256 for ${name}`).toBeDefined();
      expect(
        actual,
        `SHA-256 mismatch for ${name} — historical combat fixture edited (append-only per Custom Rule 3)?`,
      ).toBe(recorded);
    }
  });

  it('every manifest entry points to a fixture file on disk', () => {
    for (const name of Object.keys(manifest.fixtures)) {
      const filePath = path.join(COMBAT_DIR, name);
      expect(fs.existsSync(filePath), `manifest lists ${name} but file is missing`).toBe(
        true,
      );
      expect(name.endsWith('.json'), `manifest entry ${name} must be a .json file`).toBe(
        true,
      );
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
// Golden replay — for every fixture, replay + assert every recorded digest.
// ---------------------------------------------------------------------------

describe('combat golden replay (FR-19/FR-21/FR-33 + NFR-Correctness)', () => {
  const names = combatFixtureNames();
  if (names.length === 0) {
    it('has at least one recorded combat fixture', () => {
      throw new Error(
        'no fixtures found under tests/determinism/combat/ — run `tsx tests/determinism/combat/recordFixtures.ts`',
      );
    });
    return;
  }

  for (const name of names) {
    describe(`${name}`, () => {
      const fixture = loadCombatFixture(name);
      const commanderSpecs: readonly FixtureCommanderSpec[] = fixture.commanders;

      it('initial-state digest matches recorded (placement + config seam)', () => {
        const state = buildInitialState(configOf(fixture));
        expect(matchDigest(state)).toBe(fixture.expected.initialDigest);
      });

      it('every per-turn digest matches recorded', async () => {
        const state = buildInitialState(configOf(fixture));
        const digests = await replayAndCollect(
          state,
          buildCommanders(commanderSpecs),
          fixture.expected.perTurnDigests.length + 5,
        );
        expect(digests).toEqual(fixture.expected.perTurnDigests);
      });

      it('runMatch final digest + outcome match recorded (canonical entry point)', async () => {
        const state = buildInitialState(configOf(fixture));
        const result = await runMatch(state, buildCommanders(commanderSpecs));
        expect(matchDigest(result.state)).toBe(fixture.expected.finalDigest);
        // Outcome shape: Custom Rule 5 permits only these two variants.
        expect(result.outcome.kind).toBe(fixture.expected.outcome.kind);
        expect(result.outcome.turns).toBe(fixture.expected.outcome.turns);
        if (result.outcome.kind === 'victory' && fixture.expected.outcome.kind === 'victory') {
          expect(result.outcome.fleetId).toBe(fixture.expected.outcome.fleetId);
        }
      });
    });
  }
});
