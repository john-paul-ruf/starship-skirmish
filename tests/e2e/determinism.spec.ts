// tests/e2e/determinism.spec.ts — cross-engine determinism (§7.5 row 4, FR-33).
//
// For each browser project (Chromium / Firefox / WebKit) we bundle the harness code
// (`scenario.ts` + `digest.ts` + their transitive `src/sim/**` graph) once via
// esbuild, inject the bundle into a blank page via `page.setContent()`, replay
// every recorded fixture in the browser, and assert each browser-computed digest
// equals the recorded (Node-computed) digest.
//
// Failure modes this test uniquely catches:
//   - A transcendental function (sin/atan2/…) leaking into `sim/**` and producing
//     engine-different values. `mathx/trig` is arithmetic-only precisely to
//     prevent this; a regression fires here.
//   - A `Math.imul` vs `*` mistake in the RNG mixer producing engine-different bits.
//   - A `Set`/`Map`/`Object.keys` iteration-order dependency in `physics/**`.
//
// Deliberate design:
//   - No dev server. `page.setContent(html)` gives every engine the same bytes;
//     nothing depends on Vite's or another server's transform behaviour. If
//     Chromium and Firefox disagree on a digest here, the ONLY variable is the
//     engine — everything else is byte-identical.
//   - The bundle is built ONCE across the whole test file with an esbuild
//     `beforeAll`. Each engine gets the exact same JS text; three ways to run
//     that text.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixture discovery — read the same fixtures + manifest the Node tests do.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURES_DIR = path.resolve(REPO_ROOT, 'tests/determinism/fixtures');

interface FixtureOnDisk {
  readonly name: string;
  readonly recorded: string;
  /** Everything the harness needs to reconstruct the scenario, minus the digest field. */
  readonly scenarioJson: string;
}

const loadFixtures = (): readonly FixtureOnDisk[] => {
  const names = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return names.map((name) => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
    const parsed = JSON.parse(raw) as { digest: string } & Record<string, unknown>;
    const { digest: recorded, ...scenario } = parsed;
    if (typeof recorded !== 'string') {
      throw new Error(`fixture ${name} is missing a recorded digest`);
    }
    return { name, recorded, scenarioJson: JSON.stringify(scenario) };
  });
};

// ---------------------------------------------------------------------------
// Bundle the harness for the browser. IIFE format so we can attach the exported
// API to `globalThis.__harnessAPI` and reach it from `page.evaluate`.
// ---------------------------------------------------------------------------

interface HarnessBundle {
  readonly js: string;
  readonly bytes: number;
}

const buildHarnessBundle = async (): Promise<HarnessBundle> => {
  const virtualEntry = `
    // Virtual entry — imports the harness surface + re-exports it as an IIFE global.
    import { runScenario } from '${REPO_ROOT}/tools/balance/scenario.ts';
    import { digest } from '${REPO_ROOT}/tools/balance/digest.ts';
    export { runScenario, digest };
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
  if (!out) throw new Error('esbuild produced no output for the harness bundle');
  return { js: out.text, bytes: out.text.length };
};

let harnessBundle: HarnessBundle;
test.beforeAll(async () => {
  harnessBundle = await buildHarnessBundle();
});

// ---------------------------------------------------------------------------
// The actual cross-engine assertion. One test per project (Chromium / Firefox /
// WebKit) — Playwright projects fan this out three ways.
// ---------------------------------------------------------------------------

test.describe('cross-engine determinism (§7.5 row 4, FR-33)', () => {
  test('every fixture digest matches the Node golden on this engine', async ({ page }) => {
    const fixtures = loadFixtures();
    expect(fixtures.length, 'no fixtures found under tests/determinism/fixtures/').toBeGreaterThan(0);

    // Any pageerror or console.error is a determinism-adjacent signal (a stray
    // import failure would silently reduce the fixture set to zero).
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    // Data-URL page: the ONLY page state is the harness bundle we injected. No
    // network, no CSP surprises, no dev-server transforms — same bytes on every engine.
    const html = `<!doctype html><html><body><script>${harnessBundle.js}</script></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });

    // Sanity check: the IIFE attached the API to the browser global scope.
    const apiPresent = await page.evaluate(
      () =>
        typeof (globalThis as unknown as { __harnessAPI?: unknown }).__harnessAPI === 'object' &&
        (globalThis as unknown as { __harnessAPI?: { runScenario?: unknown; digest?: unknown } })
          .__harnessAPI?.runScenario !== undefined,
    );
    expect(apiPresent, 'harness IIFE did not expose __harnessAPI').toBe(true);

    // Payload for `page.evaluate`: fixture list as plain JSON strings. The
    // browser side parses, runs, digests, and returns the result table.
    const payload = fixtures.map((f) => ({ name: f.name, scenarioJson: f.scenarioJson, recorded: f.recorded }));
    const results = await page.evaluate((rows) => {
      const api = (globalThis as unknown as {
        __harnessAPI: {
          runScenario: (s: unknown) => unknown;
          digest: (r: unknown) => string;
        };
      }).__harnessAPI;
      const out: Record<string, { recorded: string; recomputed: string }> = {};
      for (const row of rows) {
        const scenario = JSON.parse(row.scenarioJson);
        const result = api.runScenario(scenario);
        out[row.name] = { recorded: row.recorded, recomputed: api.digest(result) };
      }
      return out;
    }, payload);

    // Per-fixture equality. Each failure names the fixture so the three-engine
    // matrix immediately localizes the failing (engine, fixture) pair.
    for (const f of fixtures) {
      const row = results[f.name]!;
      expect(
        row.recomputed,
        `${f.name}: browser digest ${row.recomputed} disagrees with Node golden ${row.recorded}`,
      ).toBe(f.recorded);
    }

    expect(errors, `browser reported errors during run:\n${errors.join('\n')}`).toEqual([]);
  });
});
