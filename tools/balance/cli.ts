// tools/balance/cli.ts — headless harness entry point (FR-33, Gate 1b).
//
// Runs N scenarios from a seed range through `runScenario` and prints their digests.
// Byte-identical output across runs is the CP1 acceptance property; timing lives on
// stderr precisely so `diff <(harness) <(harness)` is empty when determinism holds.
//
// Usage:
//   tsx tools/balance/cli.ts --seeds 1..50                # print digests
//   tsx tools/balance/cli.ts --seeds 1..50 --record dir/  # ALSO write fixtures
//
// The `--record` mode is how fixtures under `tests/determinism/fixtures/` are
// generated in CP2. Recording is append-safe: existing fixture files are NEVER
// overwritten (fixtures are append-only per FR-2 / Custom Rule 3).
//
// Purity: this file imports only from `./scenario`, `./digest`, `./aggregate`,
// `./harnessScenarios`, and `node:*` — no `three`, no `preact`, no DOM. The
// `purity-check.ts` script bundles the transitive graph and asserts the output has
// none of those tokens.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runScenario, type Scenario } from './scenario.js';
import { digest } from './digest.js';
import { summarize, aggregate } from './aggregate.js';
import { seedToScenario } from './harnessScenarios.js';

// ---------------------------------------------------------------------------
// Argument parsing — deliberately hand-rolled, zero deps.
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly seedStart: number;
  readonly seedEnd: number;
  readonly recordDir: string | null;
  readonly beats: number;
  readonly quiet: boolean;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  let seedStart = 1;
  let seedEnd = 50;
  let recordDir: string | null = null;
  let beats = 3;
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--seeds') {
      const spec = argv[i + 1] ?? '';
      const m = /^(\d+)\.\.(\d+)$/.exec(spec);
      if (!m) throw new Error(`--seeds expects "A..B" (got ${JSON.stringify(spec)})`);
      seedStart = Number(m[1]);
      seedEnd = Number(m[2]);
      if (seedStart > seedEnd) throw new Error(`--seeds range empty: ${spec}`);
      i += 1;
    } else if (a === '--record') {
      recordDir = argv[i + 1] ?? '';
      if (!recordDir) throw new Error('--record expects a directory path');
      i += 1;
    } else if (a === '--beats') {
      beats = Number(argv[i + 1] ?? '3');
      if (!Number.isInteger(beats) || beats <= 0) throw new Error('--beats must be a positive integer');
      i += 1;
    } else if (a === '--quiet') {
      quiet = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        `harness — run N seeded physics scenarios and emit digests\n\n` +
          `  --seeds A..B    (default 1..50)\n` +
          `  --beats N       (default 3)\n` +
          `  --record DIR    also write fixture JSON files (append-only; existing files preserved)\n` +
          `  --quiet         suppress the throughput summary on stderr\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { seedStart, seedEnd, recordDir, beats, quiet };
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

// ---------------------------------------------------------------------------
// Main. Throughput / summary go to stderr so stdout is byte-identical across runs.
// ---------------------------------------------------------------------------

const main = (): void => {
  const opts = parseArgs(process.argv.slice(2));
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

main();
