// tests/determinism/combat/fixtureLoader.ts — shared fixture discovery for
// the combat determinism tests (golden, shuffle, cross-engine). Same shape
// pattern as `tests/determinism/fixtureLoader.ts` (physics-level goldens):
// all combat tests read the SAME on-disk fixtures via this loader, so any
// change to the discovery rules affects them together.
//
// This module reads JSON only — it does NOT import the sim, the recorder,
// or `fixtureCommanders`. Keeping the read path narrow means a test wanting
// only to inspect fixture bytes (e.g. the hash-lock) does not drag the
// whole sim into its module graph.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Arena, CombatConfig, SimFleet } from '../../../src/sim/index.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import type { Seed } from '../../../src/sim/mathx/index.js';
import type { FixtureCommanderSpec } from './recordFixtures.js';

/** Absolute path of `tests/determinism/combat/`. */
export const COMBAT_FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** On-disk fixture shape — written by `recordFixtures.ts`, consumed here. */
export interface Fixture {
  readonly name: string;
  readonly description: string;
  readonly seed: Seed;
  readonly arena: Arena;
  readonly physics: PhysicsConfig;
  readonly combat: CombatConfig;
  readonly fleets: readonly SimFleet[];
  readonly commanders: readonly FixtureCommanderSpec[];
  readonly expected: {
    readonly initialDigest: string;
    readonly perTurnDigests: readonly string[];
    readonly finalDigest: string;
    readonly outcome:
      | { readonly kind: 'victory'; readonly fleetId: number; readonly turns: number }
      | { readonly kind: 'mutual-destruction'; readonly turns: number };
  };
}

/**
 * Names of every `seed-*.json` fixture on disk, sorted for deterministic
 * test ordering. `manifest.json` is excluded — it's the hash lock, not a
 * fixture.
 */
export const combatFixtureNames = (): readonly string[] =>
  fs
    .readdirSync(COMBAT_FIXTURES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort();

/**
 * Load one combat fixture by filename. Throws if the file is missing or the
 * JSON does not carry the expected top-level shape (a corrupt fixture is a
 * hard authoring bug, not a per-test failure to swallow).
 */
export const loadCombatFixture = (name: string): Fixture => {
  const raw = fs.readFileSync(path.join(COMBAT_FIXTURES_DIR, name), 'utf8');
  const parsed = JSON.parse(raw) as Fixture;
  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.expected !== 'object' ||
    parsed.expected === null ||
    !Array.isArray(parsed.expected.perTurnDigests)
  ) {
    throw new Error(`combat fixture ${name} is malformed`);
  }
  return parsed;
};
