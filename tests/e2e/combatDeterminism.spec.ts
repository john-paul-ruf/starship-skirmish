// tests/e2e/combatDeterminism.spec.ts — cross-engine combat determinism
// (architecture §7.5 row 4, FR-33 + FR-19/FR-21 at end-to-end scope).
//
// The whole-turn version of `tests/e2e/determinism.spec.ts`. That file runs
// the physics scenarios cross-engine; THIS file runs the full match — every
// recorded combat golden replayed through the assembled sim (movement +
// attack + shield regen + victory) inside Chromium / Firefox / WebKit.
// Every engine must produce the SAME `matchDigest` the Node golden did; a
// disagreement is the loudest possible determinism-failure signal.
//
// Design mirrors the physics-e2e file:
//   • Bundle the harness surface ONCE with esbuild in `beforeAll`. Same JS
//     text on every engine — the ONLY variable is the engine.
//   • Inject the bundle via `page.setContent()` — no dev server, no CSP
//     surprises, no Vite transforms.
//   • One test per project (Chromium / Firefox / WebKit) via Playwright
//     projects; each iterates every fixture and asserts its per-engine
//     digest equals the recorded Node digest.
//
// The "harness surface" bundled here is thin: `buildInitialState`,
// `runMatch`, `matchDigest`, plus a small `buildCommanders(spec)` that
// reconstructs the Commander[] from a fixture's `commanders` spec array
// using `fixtureCommanders.ts`. Everything else the runtime needs (rules,
// physics, mathx, trace) is dragged in transitively through the sim
// barrel.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixture discovery — read the same on-disk fixtures the Node combat golden
// test reads, minus the manifest.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const COMBAT_DIR = path.resolve(REPO_ROOT, 'tests/determinism/combat');

interface FixtureOnDisk {
  readonly name: string;
  readonly recordedFinal: string;
  readonly recordedInitial: string;
  readonly recordedOutcomeKind: string;
  readonly recordedTurns: number;
  /** Everything the runner needs — the full parsed JSON, sent as a string
   *  to keep the payload shape stable across engines. */
  readonly json: string;
}

const loadFixtures = (): readonly FixtureOnDisk[] => {
  const names = fs
    .readdirSync(COMBAT_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort();
  return names.map((name) => {
    const raw = fs.readFileSync(path.join(COMBAT_DIR, name), 'utf8');
    const parsed = JSON.parse(raw) as {
      expected: {
        initialDigest: string;
        finalDigest: string;
        outcome: { kind: string; turns: number };
      };
    };
    return {
      name,
      recordedFinal: parsed.expected.finalDigest,
      recordedInitial: parsed.expected.initialDigest,
      recordedOutcomeKind: parsed.expected.outcome.kind,
      recordedTurns: parsed.expected.outcome.turns,
      json: raw,
    };
  });
};

// ---------------------------------------------------------------------------
// Harness bundle — IIFE with a `__combatAPI` global exposing `runFixture`.
// The bundle imports the assembled sim + `fixtureCommanders.ts`; everything
// downstream (rules / physics / mathx / trace) rides in transitively.
// ---------------------------------------------------------------------------

interface HarnessBundle {
  readonly js: string;
  readonly bytes: number;
}

const buildHarnessBundle = async (): Promise<HarnessBundle> => {
  const virtualEntry = `
    import { buildInitialState, matchDigest, runMatch } from '${REPO_ROOT}/src/sim/index.ts';
    import {
      scriptedCommander,
      simpleFireCommander,
      simpleFireAndMissileCommander,
      fleetScriptFromArray,
    } from '${REPO_ROOT}/tools/balance/fixtureCommanders.ts';

    const buildCommanders = (specs) => specs.map((s) => {
      if (s.kind === 'simple-fire') return simpleFireCommander(s.fleetId);
      if (s.kind === 'simple-fire-missile') return simpleFireAndMissileCommander(s.fleetId);
      if (s.kind === 'scripted') {
        if (!Array.isArray(s.turns)) throw new Error('scripted commander missing turns');
        return scriptedCommander(s.fleetId, fleetScriptFromArray(s.turns));
      }
      throw new Error('unknown commander kind: ' + s.kind);
    });

    /**
     * Replay one fixture: build initial state, run the full match, return
     * the initial + final digest + outcome for the harness to compare
     * against the Node golden.
     */
    const runFixture = async (fixture) => {
      const config = {
        seed: fixture.seed,
        fleets: fixture.fleets,
        arena: fixture.arena,
        physics: fixture.physics,
        combat: fixture.combat,
      };
      const state = buildInitialState(config);
      const initialDigest = matchDigest(state);
      const result = await runMatch(state, buildCommanders(fixture.commanders));
      return {
        initialDigest,
        finalDigest: matchDigest(result.state),
        outcomeKind: result.outcome.kind,
        turns: result.outcome.turns,
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
    globalName: '__combatAPI',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    logLevel: 'silent',
  });
  const out = built.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output for the combat harness bundle');
  return { js: out.text, bytes: out.text.length };
};

let harnessBundle: HarnessBundle;
test.beforeAll(async () => {
  harnessBundle = await buildHarnessBundle();
});

// ---------------------------------------------------------------------------
// The cross-engine assertion. One test per Playwright project.
// ---------------------------------------------------------------------------

test.describe('cross-engine combat determinism (§7.5 row 4, FR-33)', () => {
  test('every combat fixture digest matches the Node golden on this engine', async ({
    page,
  }) => {
    const fixtures = loadFixtures();
    expect(
      fixtures.length,
      'no fixtures under tests/determinism/combat/ — run `tsx tests/determinism/combat/recordFixtures.ts`',
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
        typeof (globalThis as unknown as { __combatAPI?: { runFixture?: unknown } })
          .__combatAPI?.runFixture === 'function',
    );
    expect(apiPresent, 'combat harness IIFE did not expose __combatAPI.runFixture').toBe(
      true,
    );

    // Payload: fixture list as plain JSON strings. Browser side parses,
    // runs, digests, returns the result table. Async on the browser side
    // because `runMatch` is async — awaited inside `evaluate`.
    const payload = fixtures.map((f) => ({
      name: f.name,
      json: f.json,
      recordedInitial: f.recordedInitial,
      recordedFinal: f.recordedFinal,
      recordedOutcomeKind: f.recordedOutcomeKind,
      recordedTurns: f.recordedTurns,
    }));
    const results = await page.evaluate(async (rows) => {
      const api = (globalThis as unknown as {
        __combatAPI: {
          runFixture: (f: unknown) => Promise<{
            initialDigest: string;
            finalDigest: string;
            outcomeKind: string;
            turns: number;
          }>;
        };
      }).__combatAPI;
      const out: Record<
        string,
        {
          recordedInitial: string;
          recordedFinal: string;
          recomputedInitial: string;
          recomputedFinal: string;
          recordedOutcomeKind: string;
          computedOutcomeKind: string;
          recordedTurns: number;
          computedTurns: number;
        }
      > = {};
      for (const row of rows) {
        const fixture = JSON.parse(row.json);
        const res = await api.runFixture(fixture);
        out[row.name] = {
          recordedInitial: row.recordedInitial,
          recordedFinal: row.recordedFinal,
          recomputedInitial: res.initialDigest,
          recomputedFinal: res.finalDigest,
          recordedOutcomeKind: row.recordedOutcomeKind,
          computedOutcomeKind: res.outcomeKind,
          recordedTurns: row.recordedTurns,
          computedTurns: res.turns,
        };
      }
      return out;
    }, payload);

    // Per-fixture equality — each failure names the fixture so the
    // (engine × fixture) matrix localises the failing pair instantly.
    for (const f of fixtures) {
      const row = results[f.name]!;
      expect(
        row.recomputedInitial,
        `${f.name}: browser initial digest ${row.recomputedInitial} ≠ Node golden ${row.recordedInitial}`,
      ).toBe(row.recordedInitial);
      expect(
        row.recomputedFinal,
        `${f.name}: browser final digest ${row.recomputedFinal} ≠ Node golden ${row.recordedFinal}`,
      ).toBe(row.recordedFinal);
      expect(
        row.computedOutcomeKind,
        `${f.name}: browser outcome kind ${row.computedOutcomeKind} ≠ Node ${row.recordedOutcomeKind}`,
      ).toBe(row.recordedOutcomeKind);
      expect(
        row.computedTurns,
        `${f.name}: browser outcome turns ${row.computedTurns} ≠ Node ${row.recordedTurns}`,
      ).toBe(row.recordedTurns);
    }

    expect(errors, `browser reported errors during run:\n${errors.join('\n')}`).toEqual(
      [],
    );
  });
});
