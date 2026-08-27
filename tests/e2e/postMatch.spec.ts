// tests/e2e/postMatch.spec.ts — Post-match screen e2e (S07 CP3).
//
// Two chromium tests (UI smoke, like appBoot / skirmishBoot — not a
// cross-engine determinism check):
//
//   1. GUARD (served app): a bare deep-link to `#/skirmish/result` with no
//      active match redirects to setup — the summary never renders cold.
//
//   2. RENDER + WIRING (setContent harness): mount the REAL `PostMatch` inside
//      the REAL `AppContext` + `MatchProvider` with a synthetic *completed*
//      controller, then assert the outcome headline, the seed + copy, the fate
//      rows (incl. an XSS-safe ship name), the combat log + a working filter,
//      and that REMATCH (same seed) / RETURN fire the controller + navigate
//      seams. A real match cannot be driven to conclusion here because the
//      Setup / Move / Attack screens (S04–S06) are built concurrently in the
//      same wave; the harness supplies the completed controller they would
//      otherwise produce, and the screen is exercised end-to-end against it.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APP_URL = 'http://localhost:8081/starship-skirmish/';

// ---------------------------------------------------------------------------
// Harness bundle — renders the real PostMatch against a synthetic completed
// controller. Built once in beforeAll; injected via `page.setContent`.
// ---------------------------------------------------------------------------

const buildHarness = async (): Promise<string> => {
  const virtualEntry = `
    import { h, render } from 'preact';
    import { signal } from '@preact/signals';
    import { AppContext } from '${REPO_ROOT}/src/ui/appContext.ts';
    import { MatchProvider } from '${REPO_ROOT}/src/ui/matchContext.ts';
    import { PostMatch } from '${REPO_ROOT}/src/ui/screens/PostMatch.tsx';

    globalThis.__rematchCalls = [];
    globalThis.__navCalls = [];

    const shipA = { name: 'WIDOWMAKER', chassisClass: 'cruiser', maxHull: 140, shieldCapacity: 80 };
    const shipB = { name: '<img src=x onerror=globalThis.__xss=1>', chassisClass: 'frigate', maxHull: 60, shieldCapacity: 20 };
    const shipC = { name: 'IRON VERDICT', chassisClass: 'mega-destroyer', maxHull: 200, shieldCapacity: 120 };

    const initialFleets = [
      { fleetId: 0, ships: [shipA, shipB] },   // bodyId 1, 2
      { fleetId: 1, ships: [shipC] },           // bodyId 3
    ];

    const dmg = (over) => ({
      turn: 1, beat: 'attack', source: 'weapon', sourceId: 1, targetId: 3,
      result: 'hit', chance: 0.6, roll: 0.2, damage: 10,
      shieldBefore: 10, shieldAfter: 0, hullBefore: 40, hullAfter: 30, ...over,
    });
    const evt = (bodyId, cause) => ({
      bodyId, chassisClass: 'frigate', position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, cause, detonates: false,
    });

    const trace = {
      seedHi: 0, seedLo: 0,
      turns: [{
        turn: 1,
        movement: {
          subStepCount: 0, keyframes: [], contacts: [], removedHazardIds: [],
          log: [dmg({ beat: 'movement', source: 'collision', result: 'hit', sourceId: 1, targetId: 2 })],
          destroyed: [],
        },
        attack: {
          launchedMissileIds: [],
          log: [
            dmg({ source: 'weapon', result: 'hit', sourceId: 1, targetId: 3 }),
            dmg({ source: 'weapon', result: 'kill', sourceId: 1, targetId: 2 }),
            dmg({ source: 'missile', result: 'hit', sourceId: 1, targetId: 3 }),
          ],
          destroyed: [evt(2, 'weapon'), evt(3, 'missile')],
        },
      }],
      outcome: { kind: 'victory', fleetId: 0, turns: 5 },
    };

    const controller = {
      view: signal(null),
      phase: signal('complete'),
      turn: signal(1),
      movementBeat: signal(null),
      attackBeat: signal(null),
      state: signal({ ships: new Map([[1, { bodyId: 1, ship: shipA, hull: 71, shields: 12 }]]) }),
      outcome: signal({ kind: 'victory', fleetId: 0, turns: 5 }),
      trace: signal(trace),
      seedLabel: 'SK-7F3A-9C21-D4E8',
      playerFleetId: 0,
      initialFleets,
      commitMovement() {}, commitAttack() {}, resolveAnimationDone() {},
      hitChanceFor() { return {}; },
      previewArc() { return { positions: [], endsOutsideArena: false }; },
      concede() {},
      rematch(opts) { globalThis.__rematchCalls.push(opts); },
    };

    const services = {
      catalog: {}, repo: {}, durable: true,
      route: signal({ name: 'post-match' }),
      reducedMotion: signal(false),
      toasts: signal([]),
      activeMatch: signal(controller),
      navigate(to) { globalThis.__navCalls.push(to); },
      toast() {}, startMatch() { return controller; },
    };

    render(
      h(AppContext.Provider, { value: services },
        h(MatchProvider, { controller }, h(PostMatch, {}))),
      document.getElementById('app'),
    );
  `;
  const built = await esbuild.build({
    stdin: { contents: virtualEntry, loader: 'ts', resolveDir: REPO_ROOT },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    write: false,
    logLevel: 'silent',
  });
  const out = built.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output for the post-match harness bundle');
  return out.text;
};

let harnessJs: string;
test.beforeAll(async () => {
  harnessJs = await buildHarness();
});

// ---------------------------------------------------------------------------

test.describe('post-match screen', () => {
  test('a bare deep-link to the result route with no match redirects to setup', async ({
    page,
  }) => {
    await page.goto(`${APP_URL}#/skirmish/result`);
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
  });

  test('renders outcome, seed, fates, filterable log, and wires rematch/return', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    const html = `<!doctype html><html><body><div id="app"></div><script>${harnessJs}</script></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });

    // The completed match summarises rather than redirecting.
    await expect(page.getByTestId('screen-post-match')).toBeVisible();

    // Outcome headline — FR-27 VICTORY for the player fleet.
    await expect(page.getByTestId('outcome-headline')).toHaveText('VICTORY');

    // Seed as a first-class object + copy feedback (§4.11).
    await expect(page.getByTestId('seed-value')).toHaveText('SK-7F3A-9C21-D4E8');
    await page.getByTestId('seed-copy').click();
    await expect(page.getByTestId('seed-copy')).toHaveText('✓ COPIED');

    // Per-ship fates — every ship of both fleets appears.
    await expect(page.getByTestId('fate-row')).toHaveCount(3);

    // XSS: the markup-laden ship name never executes; it renders as literal text.
    expect(await page.evaluate(() => (globalThis as Record<string, unknown>)['__xss'])).toBeUndefined();
    await expect(page.getByTestId('fate-row').filter({ hasText: 'onerror' })).toHaveCount(1);

    // Combat log renders every entry, and a kind filter hides its lines.
    const logLines = page.getByTestId('combat-log').locator('.log-line');
    await expect(logLines).toHaveCount(4);
    await page.getByTestId('log-filter-SHOT').click();
    await expect(logLines).toHaveCount(3);

    // REMATCH (same seed) fires rematch({ newSeed: false }); RETURN navigates.
    await page.getByTestId('rematch-same').click();
    expect(await page.evaluate(() => (globalThis as Record<string, unknown>)['__rematchCalls'])).toEqual([
      { newSeed: false },
    ]);
    await page.getByTestId('return-encyclopedia').click();
    expect(await page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls'])).toEqual([
      { name: 'encyclopedia' },
    ]);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
