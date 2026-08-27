// tools/balance/cli.ts — headless harness entry point (FR-33, Gate 1b + S05).
//
// Two modes:
//   • physics (default) — runs N `PhysicsScenario`s through `runScenario` and
//     prints their digests. The physics-scope path is BYTE-IDENTICAL to pre-S05.
//   • match  — runs N bot-vs-bot `MatchScenario`s through `runMatchScenario`,
//     prints per-match outcome + turn count + final digest, and emits the
//     FR-33 win-rate / usage-rate report at the end.
//
// Byte-identical stdout across runs is the FR-33 determinism acceptance;
// timing + summary lives on stderr precisely so `diff <(harness) <(harness)`
// is empty when determinism holds.
//
// Usage:
//   tsx tools/balance/cli.ts --seeds 1..50                          # physics
//   tsx tools/balance/cli.ts --seeds 1..50 --record dir/            # + fixtures
//   tsx tools/balance/cli.ts --mode match --matches 1..20 --budget 75
//   tsx tools/balance/cli.ts --mode match --matches 1..20 --tiers rookie,veteran
//   tsx tools/balance/cli.ts --mode match --matches 1..20 --record dir/
//
// `--record` in both modes is append-safe: existing fixture files are NEVER
// overwritten (fixtures are append-only per FR-2 / Custom Rule 3).
//
// Purity: this file imports only from `./scenario`, `./digest`, `./aggregate`,
// `./harnessScenarios`, `./harnessMatches`, `src/catalog`, `src/ai` (barrel),
// and `node:*`. No `three`, no `preact`, no DOM. String literals in this file
// must AVOID those substrings too — `purity-check.ts` greps the bundle text.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runMatchScenario,
  runScenario,
  type MatchScenario,
  type MatchScenarioResult,
  type Scenario,
} from './scenario.js';
import { digest } from './digest.js';
import {
  aggregate,
  aggregateMatches,
  summarize,
  summarizeMatch,
  type MatchSummary,
} from './aggregate.js';
import { seedToScenario } from './harnessScenarios.js';
import { seedToMatch } from './harnessMatches.js';
import { loadCatalog } from '../../src/catalog/index.js';
import { BOT_TIERS, type BotTier } from '../../src/ai/index.js';

// ---------------------------------------------------------------------------
// Argument parsing — deliberately hand-rolled, zero deps.
// ---------------------------------------------------------------------------

type CliMode = 'physics' | 'match';

interface CliOptions {
  readonly mode: CliMode;
  /** Seed range (both modes). `--seeds A..B` (physics) or `--matches A..B` (match). */
  readonly seedStart: number;
  readonly seedEnd: number;
  readonly recordDir: string | null;
  readonly beats: number;
  readonly quiet: boolean;
  // Match-mode options (ignored in physics mode):
  readonly budget: number | null;
  readonly fleetTiers: readonly BotTier[] | null;
  /**
   * Movement-model version (match mode only, D-VERSION-RERECORD /
   * finite-thrust-movement S06). Omitted / null = the historical model 1
   * (impulsive-fallback), byte-identical to pre-S06 CLI runs. `2` selects
   * the finite-thrust generation — used by S06 for balance re-validation
   * against the impulsive baseline (`diff <(--movement-model 1) <(--movement-model 2)`).
   */
  readonly movementModel: number | null;
}

const parseRange = (flag: string, spec: string): { start: number; end: number } => {
  const m = /^(\d+)\.\.(\d+)$/.exec(spec);
  if (!m) throw new Error(`${flag} expects "A..B" (got ${JSON.stringify(spec)})`);
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start > end) throw new Error(`${flag} range empty: ${spec}`);
  return { start, end };
};

const parseTierList = (spec: string): BotTier[] => {
  const parts = spec.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error(`--tiers expects a comma-separated list of tier names`);
  const tiers: BotTier[] = [];
  for (const p of parts) {
    if (!(BOT_TIERS as readonly string[]).includes(p)) {
      throw new Error(`--tiers: unknown tier ${JSON.stringify(p)} (allowed: ${BOT_TIERS.join(', ')})`);
    }
    tiers.push(p as BotTier);
  }
  return tiers;
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let mode: CliMode = 'physics';
  let seedStart = 1;
  let seedEnd = 50;
  let recordDir: string | null = null;
  let beats = 3;
  let quiet = false;
  let budget: number | null = null;
  let fleetTiers: BotTier[] | null = null;
  let movementModel: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--mode') {
      const val = argv[i + 1] ?? '';
      if (val !== 'physics' && val !== 'match') {
        throw new Error(`--mode expects "physics" or "match" (got ${JSON.stringify(val)})`);
      }
      mode = val;
      i += 1;
    } else if (a === '--seeds' || a === '--matches') {
      const spec = argv[i + 1] ?? '';
      const { start, end } = parseRange(a, spec);
      seedStart = start;
      seedEnd = end;
      i += 1;
    } else if (a === '--record') {
      recordDir = argv[i + 1] ?? '';
      if (!recordDir) throw new Error('--record expects a directory path');
      i += 1;
    } else if (a === '--beats') {
      beats = Number(argv[i + 1] ?? '3');
      if (!Number.isInteger(beats) || beats <= 0) throw new Error('--beats must be a positive integer');
      i += 1;
    } else if (a === '--budget') {
      budget = Number(argv[i + 1] ?? '');
      if (!Number.isFinite(budget)) throw new Error('--budget must be a finite number');
      i += 1;
    } else if (a === '--tiers') {
      fleetTiers = parseTierList(argv[i + 1] ?? '');
      i += 1;
    } else if (a === '--movement-model') {
      // Match-mode only; passed through to `seedToMatch` → `MatchScenario`.
      // 1 or omitted = impulsive baseline; 2 = finite-thrust (S06 rerecord).
      const raw = argv[i + 1] ?? '';
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `--movement-model expects a positive integer (got ${JSON.stringify(raw)})`,
        );
      }
      movementModel = parsed;
      i += 1;
    } else if (a === '--quiet') {
      quiet = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        `harness — run N seeded scenarios and emit digests\n\n` +
          `  --mode physics|match   (default physics)\n` +
          `  --seeds A..B           physics seed range (default 1..50)\n` +
          `  --matches A..B         match seed range (match mode; alias of --seeds)\n` +
          `  --beats N              physics beats per scenario (default 3)\n` +
          `  --budget N             match mode: fixed budget (default: seeded from n)\n` +
          `  --tiers r,v,a          match mode: fixed per-fleet tiers (default: seeded from n)\n` +
          `  --movement-model N     match mode: physics model version (1 = impulsive, 2 = finite-thrust)\n` +
          `  --record DIR           also write fixture JSON files (append-only; existing files preserved)\n` +
          `  --quiet                suppress the throughput summary on stderr\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return {
    mode,
    seedStart,
    seedEnd,
    recordDir,
    beats,
    quiet,
    budget,
    fleetTiers,
    movementModel,
  };
};

// ---------------------------------------------------------------------------
// Fixture recording (CP2). Append-only: never overwrites; a pre-existing fixture
// wins over any recomputation. This is Custom Rule 3 enforced at write time; the
// manifest hash-lock enforces it at read time.
// ---------------------------------------------------------------------------

const recordFixture = (dir: string, scenario: Scenario, digestHex: string): 'wrote' | 'skipped' => {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${scenario.name}.json`);
  if (fs.existsSync(filePath)) return 'skipped';
  // Two-space indent + trailing newline: matches Prettier's JSON default so the
  // fixture files round-trip cleanly through a `format` run.
  const body = JSON.stringify({ ...scenario, digest: digestHex }, null, 2) + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
  return 'wrote';
};

/**
 * Match-mode fixture: writes the `MatchScenario` recipe + the per-turn digest
 * list. Append-only, mirror of `recordFixture`. This IS the shape S06 replays
 * against (seed + budget + tiers ⇒ regenerated match ⇒ compare per-turn
 * digests to the recorded list).
 */
const recordMatchFixture = (
  dir: string,
  scenario: MatchScenario,
  result: MatchScenarioResult,
): 'wrote' | 'skipped' => {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${scenario.name}.json`);
  if (fs.existsSync(filePath)) return 'skipped';
  const body =
    JSON.stringify(
      {
        ...scenario,
        outcome: result.outcome,
        turnDigests: result.turnDigests,
      },
      null,
      2,
    ) + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
  return 'wrote';
};

// ---------------------------------------------------------------------------
// Physics mode — byte-identical to pre-S05. Split out so `main` is a
// single-line dispatcher that keeps the two mode paths cleanly separate.
// Throughput / summary go to stderr so stdout is byte-identical across runs.
// ---------------------------------------------------------------------------

const runPhysicsMode = (opts: CliOptions): void => {
  // `process.hrtime.bigint()` is a WALL-CLOCK read — allowed here because this file
  // is `tools/balance/cli.ts`, NOT inside `src/sim/**`. The determinism ban-list
  // guards the sim, not the harness driver. The wall-clock reads only feed stderr
  // (throughput) which is not diff'd for determinism.
  const startNs = process.hrtime.bigint();
  let scenariosRun = 0;
  const summaries: ReturnType<typeof summarize>[] = [];
  let wrote = 0;
  let skipped = 0;

  for (let n = opts.seedStart; n <= opts.seedEnd; n += 1) {
    const scenario = seedToScenario(n, opts.beats);
    const result = runScenario(scenario);
    const digestHex = digest(result);
    process.stdout.write(`${scenario.name} ${digestHex}\n`);
    summaries.push(summarize(result));
    if (opts.recordDir !== null) {
      const outcome = recordFixture(opts.recordDir, scenario, digestHex);
      if (outcome === 'wrote') wrote += 1;
      else skipped += 1;
    }
    scenariosRun += 1;
  }

  const totals = aggregate(summaries);
  const elapsedNs = process.hrtime.bigint() - startNs;
  const elapsedMs = Number(elapsedNs) / 1e6;
  const perSecond = scenariosRun / (elapsedMs / 1000);
  const perMinute = perSecond * 60;

  if (!opts.quiet) {
    process.stderr.write(
      `\n--- harness summary ---\n` +
        `scenarios: ${scenariosRun}\n` +
        `total beats: ${totals.totalBeats}\n` +
        `total contacts: ${totals.totalContacts}\n` +
        `total boundary exits: ${totals.totalExits}\n` +
        `wall time: ${elapsedMs.toFixed(2)} ms\n` +
        `throughput: ${perMinute.toFixed(1)} scenarios/min/core (${perSecond.toFixed(1)}/s)\n` +
        (opts.recordDir !== null
          ? `fixtures: ${wrote} written, ${skipped} preserved (append-only) in ${opts.recordDir}\n`
          : ''),
    );
  }
};

// ---------------------------------------------------------------------------
// Match mode (S05). Runs bot-vs-bot matches and emits the FR-33 report.
// stdout is the deterministic channel (per-match line + final report JSON);
// throughput / summary go to stderr.
// ---------------------------------------------------------------------------

const runMatchMode = async (opts: CliOptions): Promise<void> => {
  const catalog = loadCatalog();
  const startNs = process.hrtime.bigint();
  let matchesRun = 0;
  const summaries: MatchSummary[] = [];
  let wrote = 0;
  let skipped = 0;

  for (let n = opts.seedStart; n <= opts.seedEnd; n += 1) {
    const scenario = seedToMatch(n, catalog, {
      ...(opts.budget !== null ? { budget: opts.budget } : {}),
      ...(opts.fleetTiers !== null ? { fleetTiers: opts.fleetTiers } : {}),
      ...(opts.movementModel !== null
        ? { movementModel: opts.movementModel }
        : {}),
    });
    const result = await runMatchScenario(scenario, catalog);

    // Deterministic per-match line — the FR-33 replayable channel.
    // Fields chosen so `diff <(cli match) <(cli match)` is empty on determinism
    // hold: name + outcome + winner (or none) + turns + final turn digest.
    const finalDigest = result.turnDigests[result.turnDigests.length - 1] ?? '';
    const winner = result.outcome.kind === 'victory' ? String(result.outcome.fleetId) : 'none';
    process.stdout.write(
      `${scenario.name} ${result.outcome.kind} winner=${winner} turns=${result.outcome.turns} ${finalDigest}\n`,
    );

    summaries.push(summarizeMatch(result));

    if (opts.recordDir !== null) {
      const outcome = recordMatchFixture(opts.recordDir, scenario, result);
      if (outcome === 'wrote') wrote += 1;
      else skipped += 1;
    }
    matchesRun += 1;
  }

  const report = aggregateMatches(summaries);
  // Final report as JSON on stdout — deterministic (aggregateMatches sorts
  // keys) so it stays diff-clean and machine-parseable for CI.
  process.stdout.write(`${JSON.stringify(report)}\n`);

  const elapsedNs = process.hrtime.bigint() - startNs;
  const elapsedMs = Number(elapsedNs) / 1e6;
  const perSecond = matchesRun / (elapsedMs / 1000);
  const perMinute = perSecond * 60;

  if (!opts.quiet) {
    process.stderr.write(
      `\n--- match harness summary ---\n` +
        `matches: ${matchesRun}\n` +
        `victories: ${report.victories}\n` +
        `mutual destructions: ${report.mutualDestructions}\n` +
        `avg turns: ${report.avgTurns.toFixed(2)}\n` +
        `wall time: ${elapsedMs.toFixed(2)} ms\n` +
        `throughput: ${perMinute.toFixed(1)} matches/min/core (${perSecond.toFixed(1)}/s)\n` +
        (opts.recordDir !== null
          ? `fixtures: ${wrote} written, ${skipped} preserved (append-only) in ${opts.recordDir}\n`
          : ''),
    );
  }
};

// ---------------------------------------------------------------------------
// Main. Dispatches on mode. `main` is async because match mode is async
// (`runTurn` is async — the pure `Commander` interface accepts sync-or-Promise
// plans, FR-17). Physics-mode path stays synchronous internally; only the
// dispatcher `await`s.
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'match') {
    await runMatchMode(opts);
  } else {
    runPhysicsMode(opts);
  }
};

main().catch((err) => {
  process.stderr.write(
    `harness: unexpected error\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(2);
});
