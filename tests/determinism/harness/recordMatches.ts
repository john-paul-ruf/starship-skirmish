// tests/determinism/harness/recordMatches.ts — dev-only script that
// (re)generates the bot-vs-bot harness golden fixtures + manifest.json
// (S06, FR-33, architecture §7.5).
//
// USAGE (rare — normally the checked-in fixtures are the source of truth):
//   tsx tests/determinism/harness/recordMatches.ts
//
// APPEND-ONLY DISCIPLINE (Custom Rule 3 / FR-2 / architecture §7.5):
//   Fixtures on disk are FROZEN artefacts. This script never overwrites an
//   existing fixture file — if a fixture would produce different bytes from
//   what's on disk, the script FAILS LOUD. To add a new scenario, append a
//   new entry to RECIPES below and run this script; the new file appears
//   and the manifest is updated to include it. To retire a bad seed, do NOT
//   delete the file — leave it and add a superseding one.
//
// The manifest (`harness/manifest.json`) is rebuilt from the fixtures on
// disk after any writes: it lists SHA-256 for every seed-*.json file
// present. The hash-lock test (`harnessMatchGolden.test.ts`) reads both and
// asserts equality — so if a developer ever edits a historical fixture, the
// on-disk SHA drifts from the recorded manifest entry and CI fails.
//
// D-MATCH-SCENARIO: a recorded fixture is `{ seed, budget, fleetTiers,
// outcome, turnDigests }` — tiers, not serialized builds. The golden replay
// re-runs `generateBotFleet` + `validateFit` + `resolveFleet` + `runTurn`,
// so the whole generate → validate → resolve → run pipeline sits under one
// determinism lock (D-GOLDEN-CAPSTONE).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { loadCatalog } from '../../../src/catalog/index.js';
import type { BotTier } from '../../../src/ai/index.js';
import {
  runMatchScenario,
  type MatchScenario,
} from '../../../tools/balance/scenario.js';
import { seedToMatch } from '../../../tools/balance/harnessMatches.js';
import {
  FIXTURES_DIR,
  MANIFEST_PATH,
  type HarnessFixtureFile,
} from './fixtureLoader.js';

// ---------------------------------------------------------------------------
// RECIPES — the fixtures this script records. Each is a small `MatchScenario`
// (seed + budget + tiers) chosen to (a) terminate naturally in a bounded
// number of turns and (b) exercise the heuristic bot's decision paths:
// generateBotFleet on the low-budget end (fighters + a few frigates), the
// mathx-only movement + attack planners, and — where the RNG-drawn fleet
// carries PD or missiles — the called-shot ladder + AoE friendly-fire path
// (FR-25 / FR-29 via `HeuristicCommander`).
//
// Naming: `seed-<n>-<blurb>.json`. The `n` is the seed-derivation index for
// `seedToMatch`; the blurb documents the recipe. The file name overrides
// `seedToMatch`'s default `match-${n}` name so the fixture is self-describing
// on disk.
// ---------------------------------------------------------------------------

interface RecipeSpec {
  readonly name: string;
  readonly n: number;
  readonly budget: number;
  readonly fleetTiers: readonly BotTier[];
  /**
   * Movement-model version marker. Undefined = 1 (impulsive; the pre-S06
   * generation on disk). >= 2 = a new generation recorded under a distinct
   * physics model. The recipe list is APPEND-ONLY (Custom Rule 3 / FR-2):
   * new generations get new entries with a distinct name suffix — historical
   * recipes are NEVER edited (an edit would produce different fixture bytes,
   * flip the SHA, and fail the append-only check).
   */
  readonly movementModel?: number;
}

const RECIPES: readonly RecipeSpec[] = [
  // 2-fleet rookie-vs-ace duel at the smallest legal budget — tier vocabulary
  // pinned end-to-end (rookie's 'nearest' targeting vs ace's threat-scored
  // targeting + called-shot ladder). Small budget keeps ship counts low and
  // termination fast (~8 turns).
  {
    name: 'seed-1-rookie-vs-ace',
    n: 1,
    budget: 25,
    fleetTiers: ['rookie', 'ace'],
  },
  // 3-fleet mixed-tier field at budget=25 — three commanders, three targeting
  // policies, sharing one arena. Exercises the multi-fleet order-independent
  // accumulation invariant (§7.3) under bot planners. Seed 7 was picked from
  // a n=1..30 sweep for terminating naturally in ~8 turns with a decisive
  // victory (empty legacy STATE.md guidance would call this the "few turns"
  // constraint).
  {
    name: 'seed-2-mixed-tier',
    n: 7,
    budget: 25,
    fleetTiers: ['rookie', 'veteran', 'ace'],
  },
  // 2-fleet ace-vs-ace at budget=50 — pushes ship counts up so the catalog
  // draws are more likely to include PD/missiles, giving the called-shot +
  // AoE friendly-fire paths (`enableCalledShots` + `enableAoeFriendlyFireCheck`,
  // ace only per S01 tier vocabulary) a fixture. Ace on both sides means both
  // commanders consult `combatConfig` (D-PHYSICS-INJECT parity). Seed 2 was
  // picked from a sweep for terminating in ~7 turns.
  {
    name: 'seed-3-ace-vs-ace',
    n: 2,
    budget: 50,
    fleetTiers: ['ace', 'ace'],
  },

  // --- Generation 2: finite-thrust model (finite-thrust-movement S06) -------
  //
  // Same `(n, budget, fleetTiers)` as the model-1 fixtures above, but with
  // `movementModel: 2` — `runMatchScenario` now injects
  // `PhysicsConfig.maxAccel` from `tuning.physics.maxAccel = 25`, so bots'
  // single-segment finite-thrust plans (S03) actually exercise the curved-
  // arc integrator (`thrustSchedule` finite-thrust branch, not the impulsive
  // fallback). Recorded outcomes differ from the model-1 counterparts —
  // that is the DELIBERATE effect the version bump exists to record
  // (D-VERSION-RERECORD, Custom Rule 3 / FR-2). Old recipes stay pinned to
  // model 1; new recipes are APPENDED here (never edit-in-place).
  {
    name: 'seed-1-rookie-vs-ace-m2',
    n: 1,
    budget: 25,
    fleetTiers: ['rookie', 'ace'],
    movementModel: 2,
  },
  {
    name: 'seed-2-mixed-tier-m2',
    n: 7,
    budget: 25,
    fleetTiers: ['rookie', 'veteran', 'ace'],
    movementModel: 2,
  },
  {
    name: 'seed-3-ace-vs-ace-m2',
    n: 2,
    budget: 50,
    fleetTiers: ['ace', 'ace'],
    movementModel: 2,
  },
];

// ---------------------------------------------------------------------------
// Fixture I/O — serialize + hash. Same two-space indent + trailing newline
// as `cli.ts:165` so a Prettier `format` round-trip is a no-op.
// ---------------------------------------------------------------------------

const serialize = (f: HarnessFixtureFile): string =>
  JSON.stringify(f, null, 2) + '\n';

const sha256Hex = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// Main — write fixtures + rebuild manifest.
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const catalog = loadCatalog();
  let wrote = 0;
  let unchanged = 0;

  for (const recipe of RECIPES) {
    // seedToMatch names it `match-${n}`; override to the recipe name so the
    // filename and the scenario name agree. `movementModel` is spread onto
    // the scenario only when the recipe carries one — a model-1 recipe
    // produces a scenario without the field, which serializes byte-
    // equivalent to the pre-S06 fixtures (append-only guarantee).
    const drawn = seedToMatch(recipe.n, catalog, {
      budget: recipe.budget,
      fleetTiers: recipe.fleetTiers,
    });
    const scenario: MatchScenario = {
      ...drawn,
      name: recipe.name,
      ...(recipe.movementModel !== undefined
        ? { movementModel: recipe.movementModel }
        : {}),
    };
    const result = await runMatchScenario(scenario, catalog);

    const fixture: HarnessFixtureFile = {
      kind: 'match',
      name: scenario.name,
      seed: scenario.seed,
      budget: scenario.budget,
      fleetTiers: scenario.fleetTiers,
      ...(scenario.movementModel !== undefined
        ? { movementModel: scenario.movementModel }
        : {}),
      outcome: result.outcome,
      turnDigests: result.turnDigests,
    };
    const body = serialize(fixture);
    const filePath = path.join(FIXTURES_DIR, `${recipe.name}.json`);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8');
      if (existing === body) {
        unchanged += 1;
        continue;
      }
      throw new Error(
        `recordMatches: on-disk fixture ${recipe.name}.json would change bytes — harness fixtures are append-only (Custom Rule 3 / FR-2). If a scenario truly needs a new outcome, ADD a new recipe (different name) rather than editing an existing one.`,
      );
    }
    fs.writeFileSync(filePath, body, 'utf8');
    wrote += 1;
    process.stdout.write(
      `recorded ${recipe.name}.json (${result.turnDigests.length} turns, ${result.outcome.kind})\n`,
    );
  }

  // Rebuild manifest from on-disk fixtures (SHA-256 per file).
  const fixtureFiles = fs
    .readdirSync(FIXTURES_DIR)
    .filter((n) => n.endsWith('.json') && n !== 'manifest.json')
    .sort();
  const fixtures: Record<string, string> = {};
  for (const name of fixtureFiles) {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, name));
    fixtures[name] = sha256Hex(bytes);
  }
  const manifest = {
    $comment:
      'Hash-lock for tests/determinism/harness/*.json (Custom Rule 3, FR-2, architecture §7.5). Append-only: adding a new fixture appends a new entry; editing a historical fixture makes harnessMatchGolden.test.ts fail. Regenerated by recordMatches.ts.',
    algorithm: 'SHA-256' as const,
    fixtures,
  };
  const manifestBody = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(MANIFEST_PATH, manifestBody, 'utf8');
  process.stdout.write(
    `recordMatches: ${wrote} written, ${unchanged} unchanged; manifest lists ${fixtureFiles.length} fixture(s).\n`,
  );
};

// Only run as a script when invoked directly (tsx recordMatches.ts) — never
// on import. Running `main()` during a `vitest` invocation would attempt to
// write files and re-run the full pipeline per test file.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(
      `recordMatches: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
