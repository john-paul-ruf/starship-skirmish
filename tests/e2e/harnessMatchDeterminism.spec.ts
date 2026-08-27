// tests/e2e/harnessMatchDeterminism.spec.ts — cross-engine bot-vs-bot
// determinism (S06, architecture §7.5 row 4, FR-33).
//
// Whole-match version of `tests/e2e/combatDeterminism.spec.ts`. That file
// runs the assembled sim under scripted / `simpleFire` commanders inside
// Chromium / Firefox / WebKit; THIS file runs the FULL harness pipeline —
// `runMatchScenario` regenerates each fixture's fleets via
// `generateBotFleet`, drives every `HeuristicCommander` through the same
// per-turn view the Node golden did, and asserts the per-turn digests +
// outcome equal the Node golden on every engine. A disagreement means the
// bot's determinism-critical code (mathx / previewPath / rng-seeded fleet
// gen) has an engine-dependent code path — the loudest possible signal.
//
// Design mirrors the combat-e2e file exactly:
//   • Bundle the harness surface ONCE with esbuild in `beforeAll`. Same JS
//     text on every engine — the ONLY variable is the engine.
//   • Inject the bundle via `page.setContent()` — no dev server, no CSP
//     surprises, no Vite transforms.
//   • One test per project (Chromium / Firefox / WebKit) via Playwright
//     projects; each iterates every fixture and asserts its per-engine
//     digest list equals the recorded Node digest list.
//
// The bundled surface is intentionally thin — `runMatchScenario` (+ its
// transitive sim/ai/domain/catalog graph) and `loadCatalog` (whose static
// JSON imports esbuild inlines into the bundle so the browser needs no
// filesystem access). Everything else the runtime consumes (rules,
// physics, mathx, trace) is dragged in transitively through the sim +
// ai + tools/balance barrels.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixture discovery — read the same on-disk fixtures the Node harness golden
// test reads, minus the manifest.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HARNESS_DIR = path.resolve(REPO_ROOT, 'tests/determinism/harness');

interface FixtureOnDisk {
  readonly name: string;
  readonly recordedTurnDigests: readonly string[];
  readonly recordedOutcomeKind: string;
  readonly recordedTurns: number;
  readonly recordedFleetId: number | null;
  /** Everything the runner needs — the full parsed JSON, sent as a string
   *  to keep the payload shape stable across engines. */
  readonly json: string;
}

const loadFixtures = (): readonly FixtureOnDisk[] => {
  const names = fs
    .readdirSync(HARNESS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort();
  return names.map((name) => {
    const raw = fs.readFileSync(path.join(HARNESS_DIR, name), 'utf8');
    const parsed = JSON.parse(raw) as {
      turnDigests: readonly string[];
      outcome: { kind: string; turns: number; fleetId?: number };
    };
    return {
      name,
      recordedTurnDigests: parsed.turnDigests,
      recordedOutcomeKind: parsed.outcome.kind,
      recordedTurns: parsed.outcome.turns,
      recordedFleetId:
        typeof parsed.outcome.fleetId === 'number'
          ? parsed.outcome.fleetId
          : null,
      json: raw,
    };
  });
};

// ---------------------------------------------------------------------------
// Harness bundle — IIFE with a `__harnessAPI` global exposing `runFixture`.
// The bundle imports `runMatchScenario` (which drags in the sim + ai +
// domain graph) and `loadCatalog` (whose static JSON imports esbuild inlines
// into the bundle — the browser needs no filesystem access).
// ---------------------------------------------------------------------------

interface HarnessBundle {
  readonly js: string;
  readonly bytes: number;
}

const buildHarnessBundle = async (): Promise<HarnessBundle> => {
  const virtualEntry = `
    import { runMatchScenario } from '${REPO_ROOT}/tools/balance/scenario.ts';
    import { loadCatalog } from '${REPO_ROOT}/src/catalog/index.ts';

    // The catalog is a static, frozen singleton — loading once is what the
    // production code path does too (loadCatalog memoises internally).
    const catalog = loadCatalog();

    /**
     * Replay one fixture: reconstruct the MatchScenario from the recorded
     * JSON (seed + budget + fleetTiers — D-MATCH-SCENARIO), regenerate
     * fleets, drive the runTurn loop, return the per-turn digest list +
     * outcome for the harness to compare against the Node golden.
     */
    const runFixture = async (fixture) => {
      const scenario = {
        kind: 'match',
        name: fixture.name,
        seed: fixture.seed,
        budget: fixture.budget,
        fleetTiers: fixture.fleetTiers,
      };
      const result = await runMatchScenario(scenario, catalog);
      return {
        turnDigests: result.turnDigests,
        outcomeKind: result.outcome.kind,
        turns: result.outcome.turns,
        fleetId: result.outcome.kind === 'victory' ? result.outcome.fleetId : null,
      };
    };

    export { runFixture };
  `;
  const built = await esbuild.build({
    stdin: {
      contents: virtualEntry,
      loader: 'ts',
      resolveDir: REPO_ROOT,
    },
    bundle: true,
    format: 'iife',
    globalName: '__harnessAPI',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    logLevel: 'silent',
  });
  const out = built.outputFiles?.[0];
  if (!out)
    throw new Error('esbuild produced no output for the harness match bundle');
  return { js: out.text, bytes: out.text.length };
};

let harnessBundle: HarnessBundle;
test.beforeAll(async () => {
  harnessBundle = await buildHarnessBundle();
});

// ---------------------------------------------------------------------------
// The cross-engine assertion. One test per Playwright project.
// ---------------------------------------------------------------------------

test.describe('cross-engine harness match determinism (§7.5 row 4, FR-33)', () => {
  test('every harness fixture per-turn digest list matches the Node golden on this engine', async ({
    page,
  }) => {
    const fixtures = loadFixtures();
    expect(
      fixtures.length,
      'no fixtures under tests/determinism/harness/ — run `tsx tests/determinism/harness/recordMatches.ts`',
    ).toBeGreaterThan(0);

    // Any pageerror or console.error is a determinism-adjacent signal — a
    // stray import failure would silently zero the fixture matrix.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    // Data-URL page: the ONLY page state is the harness bundle we injected.
    const html = `<!doctype html><html><body><script>${harnessBundle.js}</script></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });

    // Sanity: the IIFE attached `runFixture` to the browser global scope.
    const apiPresent = await page.evaluate(
      () =>
        typeof (
          globalThis as unknown as { __harnessAPI?: { runFixture?: unknown } }
        ).__harnessAPI?.runFixture === 'function',
    );
    expect(
      apiPresent,
      'harness IIFE did not expose __harnessAPI.runFixture',
    ).toBe(true);

    // Payload: fixture list as plain JSON strings. Browser side parses,
    // runs, digests, returns the result table. Async on the browser side
    // because `runMatchScenario` is async (M10 `runTurn` is async — FR-17).
    const payload = fixtures.map((f) => ({
      name: f.name,
      json: f.json,
      recordedTurnDigests: f.recordedTurnDigests,
      recordedOutcomeKind: f.recordedOutcomeKind,
      recordedTurns: f.recordedTurns,
      recordedFleetId: f.recordedFleetId,
    }));
    const results = await page.evaluate(async (rows) => {
      const api = (
        globalThis as unknown as {
          __harnessAPI: {
            runFixture: (f: unknown) => Promise<{
              turnDigests: readonly string[];
              outcomeKind: string;
              turns: number;
              fleetId: number | null;
            }>;
          };
        }
      ).__harnessAPI;
      const out: Record<
        string,
        {
          recordedTurnDigests: readonly string[];
          computedTurnDigests: readonly string[];
          recordedOutcomeKind: string;
          computedOutcomeKind: string;
          recordedTurns: number;
          computedTurns: number;
          recordedFleetId: number | null;
          computedFleetId: number | null;
        }
      > = {};
      for (const row of rows) {
        const fixture = JSON.parse(row.json) as unknown;
        const res = await api.runFixture(fixture);
        out[row.name] = {
          recordedTurnDigests: row.recordedTurnDigests,
          computedTurnDigests: res.turnDigests,
          recordedOutcomeKind: row.recordedOutcomeKind,
          computedOutcomeKind: res.outcomeKind,
          recordedTurns: row.recordedTurns,
          computedTurns: res.turns,
          recordedFleetId: row.recordedFleetId,
          computedFleetId: res.fleetId,
        };
      }
      return out;
    }, payload);

    // Per-fixture equality — each failure names the fixture so the
    // (engine × fixture) matrix localises the failing pair instantly.
    for (const f of fixtures) {
      const row = results[f.name]!;
      expect(
        row.computedTurnDigests,
        `${f.name}: browser per-turn digest list ≠ Node golden`,
      ).toEqual(row.recordedTurnDigests);
      expect(
        row.computedOutcomeKind,
        `${f.name}: browser outcome kind ${row.computedOutcomeKind} ≠ Node ${row.recordedOutcomeKind}`,
      ).toBe(row.recordedOutcomeKind);
      expect(
        row.computedTurns,
        `${f.name}: browser outcome turns ${row.computedTurns} ≠ Node ${row.recordedTurns}`,
      ).toBe(row.recordedTurns);
      if (row.recordedOutcomeKind === 'victory') {
        expect(
          row.computedFleetId,
          `${f.name}: browser winner fleetId ${row.computedFleetId} ≠ Node ${row.recordedFleetId}`,
        ).toBe(row.recordedFleetId);
      }
    }

    expect(
      errors,
      `browser reported errors during run:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});
