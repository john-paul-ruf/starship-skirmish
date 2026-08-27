// tests/determinism/harness/fixtureLoader.ts — shared fixture discovery for
// the bot-vs-bot harness determinism tests (S06, FR-33, architecture §7.5).
//
// Peer of `tests/determinism/combat/fixtureLoader.ts`: the combat golden
// exercises scripted / `simpleFire` commanders; THIS loader serves the
// heuristic-bot determinism surface (`generateBotFleet` + `previewPath`
// movement + threat-scored attack, all inside `src/ai/**`). Fixtures under
// `tests/determinism/harness/*.json` are the frozen artefacts; the golden
// test + the cross-engine spec read them via this loader.
//
// JSON only — this module does NOT import the sim, the recorder, or the
// harness runner. The hash-lock test reads bytes off disk; only the replay
// tests drag in `runMatchScenario`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Seed } from '../../../src/sim/mathx/index.js';
import type { MatchOutcome } from '../../../src/sim/index.js';
import type { MatchScenario } from '../../../tools/balance/scenario.js';
import type { BotTier } from '../../../src/ai/index.js';

/** Absolute path of `tests/determinism/harness/`. */
export const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of `tests/determinism/harness/manifest.json`. */
export const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');

/**
 * On-disk fixture shape — written by `recordMatches.ts`, consumed here.
 * The top-level fields ARE a serialized `MatchScenario` (seed + budget +
 * tiers — D-MATCH-SCENARIO) plus the recorded truth (`outcome`,
 * `turnDigests`). `loadFixture` splits them back apart so the replay call
 * can pass a clean `MatchScenario` to `runMatchScenario`.
 */
export interface HarnessFixtureFile {
  readonly kind: 'match';
  readonly name: string;
  readonly seed: Seed;
  readonly budget: number;
  readonly fleetTiers: readonly BotTier[];
  readonly outcome: MatchOutcome;
  readonly turnDigests: readonly string[];
}

/** Split fixture — `scenario` is ready to hand to `runMatchScenario`. */
export interface HarnessFixture {
  readonly scenario: MatchScenario;
  readonly outcome: MatchOutcome;
  readonly turnDigests: readonly string[];
}

/**
 * Names of every `seed-*.json` fixture on disk, sorted for deterministic
 * test ordering. `manifest.json` is excluded — it's the hash lock, not a
 * fixture.
 */
export const fixtureNames = (): readonly string[] =>
  fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort();

/**
 * Load one harness fixture by filename. Throws if the file is missing or the
 * JSON does not carry the expected top-level shape (a corrupt fixture is a
 * hard authoring bug, not a per-test failure to swallow).
 */
export const loadFixture = (name: string): HarnessFixture => {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
  const parsed = JSON.parse(raw) as HarnessFixtureFile;
  if (
    parsed.kind !== 'match' ||
    typeof parsed.name !== 'string' ||
    !Array.isArray(parsed.turnDigests) ||
    typeof parsed.outcome !== 'object' ||
    parsed.outcome === null
  ) {
    throw new Error(`harness fixture ${name} is malformed`);
  }
  const scenario: MatchScenario = {
    kind: 'match',
    name: parsed.name,
    seed: parsed.seed,
    budget: parsed.budget,
    fleetTiers: parsed.fleetTiers,
  };
  return {
    scenario,
    outcome: parsed.outcome,
    turnDigests: parsed.turnDigests,
  };
};
