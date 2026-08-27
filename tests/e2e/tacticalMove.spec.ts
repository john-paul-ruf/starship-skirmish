// tests/e2e/tacticalMove.spec.ts — Tactical Movement screen e2e (S05 CP4).
//
// Three chromium tests (UI smoke, like postMatch / skirmishBoot):
//
//   1. GUARD (served app): a bare deep-link to `#/skirmish/move` with no active
//      match redirects to setup — the screen never renders cold.
//
//   2. PLOT → COMMIT → RESOLVE (setContent harness): mount the REAL
//      `TacticalMove` inside the REAL `AppContext` + `MatchProvider` with a
//      synthetic mid-plan controller, plot one ship, COAST the rest, and COMMIT;
//      assert the fleet gate opens and the resolve hands off to the attack beat
//      (the controller's `resolveAnimationDone` → navigate). A real match cannot
//      be driven here because Setup / Move / Attack (S04–S06) build concurrently
//      in the same wave; the harness supplies the controller they would produce.
//
//   3. BOUNDARY EXIT (setContent harness): plot an arc that leaves the arena;
//      assert the three DOM channels of the exit signal (the ✕ EXIT roster tag +
//      the text callout; the red ghost line + ✕ sprite are the render layer's,
//      verified visually) and that COMMIT requires an explicit second
//      confirmation before it hands off.
//
// The tactical viewport reaches render via a dynamic `import()` that cannot
// resolve inside the bundled harness page, so the viewport DEGRADES to numeric
// entry — exactly the accessibility fallback the screen guarantees. Every
// assertion here is on the DOM channels, which stay fully functional.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APP_URL = 'http://localhost:8081/starship-skirmish/';

// ---------------------------------------------------------------------------
// Harness bundle — renders the real TacticalMove against a synthetic mid-plan
// controller. `previewArc` reports a boundary exit once the Δv magnitude passes
// a threshold, so a big arc trips the §4.1 signal deterministically.
// ---------------------------------------------------------------------------

const buildHarness = async (): Promise<string> => {
  const virtualEntry = `
    import { h, render } from 'preact';
    import { signal } from '@preact/signals';
    import { AppContext } from '${REPO_ROOT}/src/ui/appContext.ts';
    import { MatchProvider } from '${REPO_ROOT}/src/ui/matchContext.ts';
    import { TacticalMove } from '${REPO_ROOT}/src/ui/screens/TacticalMove.tsx';

    globalThis.__navCalls = [];

    const shipDef = (name, deltaVPerTurn) => ({
      buildId: 'b-' + name, name, chassisClass: 'frigate', mass: 100, radius: 4,
      maxHull: 60, shieldCapacity: 20, shieldRegenPerTurn: 2, deltaVPerTurn,
      baseEvasion: 0.2, hullRepairPerTurn: 0, weapons: [], missiles: [], pointDefense: [], decoys: [],
    });
    const shipA = shipDef('WIDOWMAKER', 70);
    const shipB = shipDef('HARRIER-2', 40);
    const shipC = shipDef('IRON VERDICT', 20);

    const initialFleets = [
      { fleetId: 0, ships: [shipA, shipB] }, // bodyIds 1, 2
      { fleetId: 1, ships: [shipC] },        // bodyId 3
    ];

    const shipView = (bodyId, fleetId, s) => ({
      bodyId, fleetId, name: s.name, chassisClass: s.chassisClass,
      hull: s.maxHull, maxHull: s.maxHull, shields: s.shieldCapacity, shieldCapacity: s.shieldCapacity,
      shieldGenAlive: true, engineAlive: true, weaponAlive: [], missileAlive: [], missileAmmo: [],
      pdAlive: [], decoyAlive: [], decoyCharges: [], decoyActiveUntilTurn: 0, ship: s,
    });
    const body = (id) => ({ id, kind: 'ship', position: { x: 0, y: 0, z: 0 }, velocity: { x: 40, y: 0, z: 0 }, mass: 100, radius: 4 });

    const arena = { center: { x: 0, y: 0, z: 0 }, radius: 5400 };
    const view = signal({
      turn: 1, arena, selfFleetId: 0,
      bodies: [body(1), body(2), body(3)],
      ships: [shipView(1, 0, shipA), shipView(2, 0, shipB), shipView(3, 1, shipC)],
    });
    const state = signal({ arena, physics: { dt: 8 }, turn: 1, ships: new Map(), bodies: new Map() });

    const phase = signal('movement-plan');
    const movementBeat = signal(null);

    const controller = {
      view, phase, turn: signal(1), movementBeat, attackBeat: signal(null), state,
      outcome: signal(null), trace: signal({}), seedLabel: 'SK-7F3A-9C21-D4E8',
      playerFleetId: 0, initialFleets,
      previewArc(bodyId, deltaV) {
        const mag = Math.hypot(deltaV.x, deltaV.y, deltaV.z);
        return { positions: [{ x: 0, y: 0, z: 0 }, { x: mag, y: 0, z: 0 }], endsOutsideArena: mag > 40 };
      },
      commitMovement(plans) {
        globalThis.__committedPlans = plans;
        view.value = null;
        phase.value = 'movement-resolve';
        movementBeat.value = { subStepCount: 0, keyframes: [], contacts: [], removedHazardIds: [], log: [], destroyed: [] };
      },
      commitAttack() {},
      resolveAnimationDone() {
        movementBeat.value = null;
        phase.value = 'attack-plan';
        globalThis.__navCalls.push({ name: 'tactical-attack' });
      },
      hitChanceFor() { return {}; },
      concede() {}, rematch() {},
    };

    const services = {
      catalog: {}, repo: {}, durable: true,
      route: signal({ name: 'tactical-move' }),
      reducedMotion: signal(true), // deterministic: resolve skips to the final frame
      toasts: signal([]),
      activeMatch: signal(controller),
      navigate(to) { globalThis.__navCalls.push(to); },
      toast() {}, startMatch() { return controller; },
    };

    render(
      h(AppContext.Provider, { value: services },
        h(MatchProvider, { controller }, h(TacticalMove, {}))),
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
  if (!out) throw new Error('esbuild produced no output for the tactical-move harness bundle');
  return out.text;
};

let harnessJs: string;
test.beforeAll(async () => {
  harnessJs = await buildHarness();
});

const mount = async (page: import('@playwright/test').Page): Promise<string[]> => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  const html = `<!doctype html><html><body><div id="app"></div><script>${harnessJs}</script></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await expect(page.getByTestId('screen-tactical-move')).toBeVisible();
  return errors;
};

// ---------------------------------------------------------------------------

test.describe('tactical movement screen', () => {
  test('a bare deep-link to the move route with no match redirects to setup', async ({ page }) => {
    await page.goto(`${APP_URL}#/skirmish/move`);
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
  });

  test('plots a ship, coasts the rest, and commit resolves into the attack beat', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Blind-commit contract is always present (§4.2).
    await expect(page.getByTestId('no-timer')).toBeVisible();
    await expect(page.getByTestId('blind-commit')).toContainText('NOT OBSERVABLE UNTIL RESOLUTION');

    // Gate starts closed — WIDOWMAKER + HARRIER-2 both UNPLANNED (§4.3).
    const commit = page.getByTestId('commit-btn');
    await expect(commit).toBeDisabled();
    await expect(commit).toContainText('0/2 PLANNED');

    // Plot the selected ship (WIDOWMAKER) — a bearing edit marks it PLANNED.
    await page.getByLabel('Bearing in degrees, 0 to 360').fill('45');
    await expect(commit).toContainText('1/2 PLANNED');

    // COAST the second ship.
    await page.getByTestId('roster-row').filter({ hasText: 'HARRIER-2' }).click();
    await page.getByRole('button', { name: /Set to Coast/ }).click();

    // Gate opens.
    await expect(commit).toBeEnabled();
    await expect(commit).toContainText('2/2 PLANNED');

    // COMMIT → resolve → the controller hands off to the attack beat.
    await commit.click();
    await expect
      .poll(() => page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls']))
      .toContainEqual({ name: 'tactical-attack' });

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a boundary-exit arc screams in three channels and requires a second confirm', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Plot a full-budget arc on the selected ship (WIDOWMAKER, budget 70) → exit.
    await page.getByTestId('arc-magnitude').fill('70');

    // Channel A — the text callout naming the ship (§4.1 third channel).
    await expect(page.getByTestId('exit-callout')).toBeVisible();
    await expect(page.getByTestId('exit-callout')).toContainText('SHIP DESTROYED');

    // Channel B — the roster tag reads ✕ EXIT (never color alone).
    await expect(
      page.getByTestId('roster-row').filter({ hasText: 'WIDOWMAKER' }),
    ).toContainText('EXIT');

    // COAST the second ship so the gate can open.
    await page.getByTestId('roster-row').filter({ hasText: 'HARRIER-2' }).click();
    await page.getByRole('button', { name: /Set to Coast/ }).click();

    // The commit button turns hostile (red) and explains itself.
    const commit = page.getByTestId('commit-btn');
    await expect(commit).toHaveClass(/is-hostile/);
    await expect(commit).toContainText('BOUNDARY EXIT');

    // Clicking it does NOT commit — it opens the second-confirmation alertdialog.
    await commit.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('destroyed immediately');
    expect(await page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls'])).toEqual(
      [],
    );

    // Explicit confirm → the exit arc commits and resolves into the attack beat.
    await page.getByTestId('exit-confirm-accept').click();
    await expect
      .poll(() => page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls']))
      .toContainEqual({ name: 'tactical-attack' });

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
