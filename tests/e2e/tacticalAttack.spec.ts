// tests/e2e/tacticalAttack.spec.ts — Tactical Attack screen e2e (S06 CP4).
//
// Chromium UI smoke (like skirmishBoot / postMatch — not a determinism check):
//
//   1. GUARD (served app): a bare deep-link to `#/skirmish/attack` with no active
//      match redirects to setup — the screen never renders cold.
//
//   2. PLAN + WIRING (setContent harness): mount the REAL `TacticalAttack` inside
//      the REAL `AppContext` + `MatchProvider` with a synthetic controller at the
//      `attack-plan` phase, then drive the real interactions — assign a weapon
//      and read the single-sourced hit-chance breakdown, see the called-shot
//      picker unlock on a shields-down target (and stay LOCKED on a shielded
//      one), raise the friendly-fire banner with an AoE-over-friendly missile
//      WITHOUT the commit being disabled, and COMMIT → `commitAttack` fires.
//
//   3. REDUCED MOTION: flipping to `attack-resolve` under reduced motion skips
//      the animation (playAttack is never called) and hands off immediately via
//      `resolveAnimationDone`.
//
// A real match cannot be driven to the attack phase here — Setup (S04) / Move
// (S05) are concurrent in this wave and no app test seam exists — so the harness
// supplies the controller they would produce. The render layer is stubbed (no
// WebGL) so the resolve hand-off is deterministic; the screen's OWN logic
// (assignment, hit-chance readout, called-shot unlock, AoE geometry, commit) is
// exercised end-to-end against the real components.

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APP_URL = 'http://localhost:8081/starship-skirmish/';

// Stub the render layer: createTacticalView / attachTracePlayer become no-ops so
// the harness needs no WebGL. attachTracePlayer records playAttack calls so the
// reduced-motion assertion can prove the animation was skipped.
const renderStub: esbuild.Plugin = {
  name: 'stub-render',
  setup(build) {
    build.onResolve({ filter: /render\/index\.js$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-render',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-render' }, () => ({
      contents: `
        globalThis.__playAttackCalls = 0;
        export const createTacticalView = () => ({
          setState() {}, dispose() {}, resize() {}, pick() { return null; },
          camera: {}, scene: {},
        });
        export const attachTracePlayer = () => ({
          playMovement() { return mk(); },
          playAttack(_rec, opts) {
            globalThis.__playAttackCalls += 1;
            if (opts && opts.onDone) opts.onDone();
            return mk();
          },
          dispose() {},
        });
        function mk() { return { skip() {}, replay() {}, onDone(cb) { cb(); }, dispose() {} }; }
      `,
      loader: 'js',
    }));
  },
};

const buildHarness = async (): Promise<string> => {
  const virtualEntry = `
    import { h, render } from 'preact';
    import { signal } from '@preact/signals';
    import { AppContext } from '${REPO_ROOT}/src/ui/appContext.ts';
    import { MatchProvider } from '${REPO_ROOT}/src/ui/matchContext.ts';
    import { TacticalAttack } from '${REPO_ROOT}/src/ui/screens/TacticalAttack.tsx';

    globalThis.__commitCalls = [];
    globalThis.__resolveDoneCalls = 0;

    // A missile rack with a 60u blast; enough weapon shape for hit-chance.
    const rack = { ammo: 2, damage: 40, aoeRadius: 60, boostVelocity: 140,
      trackingTurnRate: 1, bodyMass: 5, bodyRadius: 1 };
    const weapon = { range: 260, damage: 18, shotsPerTurn: 2, accuracy: 0.68 };
    const mkShip = (name, over) => ({ buildId: 'b-' + name, name, chassisClass: 'frigate',
      mass: 100, radius: 4, maxHull: 140, shieldCapacity: 45, shieldRegenPerTurn: 2,
      deltaVPerTurn: 30, baseEvasion: 0.1, hullRepairPerTurn: 0,
      weapons: [weapon], missiles: [rack], pointDefense: [], decoys: [], ...over });

    const shipView = (over) => ({ bodyId: 0, fleetId: 0, name: 'SHIP', chassisClass: 'frigate',
      hull: 100, maxHull: 140, shields: 30, shieldCapacity: 45, shieldGenAlive: true,
      engineAlive: true, weaponAlive: [true], missileAlive: [true], missileAmmo: [2],
      pdAlive: [], decoyAlive: [], decoyCharges: [], decoyActiveUntilTurn: 0,
      ship: mkShip(over && over.name || 'SHIP', {}), ...over });

    // Player fleet 0: WIDOWMAKER (shooter) + TIN CAN 3 (a friendly near the target).
    // Enemy fleet 1: SPUR (shields DOWN → called shots unlock) + IRON VERDICT (shields UP).
    const widow = shipView({ bodyId: 1, fleetId: 0, name: 'WIDOWMAKER', chassisClass: 'cruiser',
      ship: mkShip('WIDOWMAKER', { chassisClass: 'cruiser' }) });
    const tin = shipView({ bodyId: 2, fleetId: 0, name: 'TIN CAN 3', chassisClass: 'fighter',
      weaponAlive: [true], missileAlive: [], missileAmmo: [],
      ship: mkShip('TIN CAN 3', { chassisClass: 'fighter', missiles: [] }) });
    const spur = shipView({ bodyId: 3, fleetId: 1, name: 'SPUR', shields: 0, hull: 41,
      weaponAlive: [true, false], missileAlive: [true], missileAmmo: [1] });
    const iron = shipView({ bodyId: 4, fleetId: 1, name: 'IRON VERDICT', chassisClass: 'mega-destroyer',
      shields: 88, shieldCapacity: 140, hull: 300 });

    const at = (x) => ({ x, y: 0, z: 0 });
    const body = (id, x) => ({ id, kind: 'ship', position: at(x), velocity: at(0), mass: 100, radius: 4 });
    const view = {
      turn: 4, arena: { center: at(0), radius: 5400 }, selfFleetId: 0,
      ships: [widow, tin, spur, iron],
      // WIDOWMAKER at 0, TIN CAN 3 at 244 (44u from SPUR@200 → inside r60), SPUR@200, IRON@600.
      bodies: [body(1, 0), body(2, 244), body(3, 200), body(4, 600)],
    };

    const breakdown = { base: 0.68, rangeFactor: 0.90, velocityFactor: 0.95, evasionFactor: 0.97, final: 0.57 };

    const controller = {
      view: signal(view),
      phase: signal('attack-plan'),
      turn: signal(4),
      movementBeat: signal(null),
      attackBeat: signal(null),
      state: signal({ arena: { center: at(0), radius: 5400 }, ships: new Map(), bodies: new Map() }),
      outcome: signal(null),
      trace: signal({ turns: [] }),
      seedLabel: 'SK-7F3A-9C21-D4E8',
      playerFleetId: 0,
      initialFleets: [],
      commitMovement() {},
      commitAttack(plans) { globalThis.__commitCalls.push(plans); },
      resolveAnimationDone() { globalThis.__resolveDoneCalls += 1; },
      hitChanceFor() { return breakdown; },
      previewArc() { return { positions: [], endsOutsideArena: false }; },
      concede() {},
      rematch() {},
    };

    const services = {
      catalog: {}, repo: {}, durable: true,
      route: signal({ name: 'tactical-attack' }),
      reducedMotion: signal(false),
      toasts: signal([]),
      activeMatch: signal(controller),
      navigate() {}, toast() {}, startMatch() { return controller; },
    };

    globalThis.__controller = controller;
    globalThis.__services = services;

    render(
      h(AppContext.Provider, { value: services },
        h(MatchProvider, { controller }, h(TacticalAttack, {}))),
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
    plugins: [renderStub],
    write: false,
    logLevel: 'silent',
  });
  const out = built.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output for the tactical-attack harness bundle');
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
  await expect(page.getByTestId('screen-tactical-attack')).toBeVisible();
  return errors;
};

// ---------------------------------------------------------------------------

test.describe('tactical attack screen', () => {
  test('a bare deep-link to the attack route with no match redirects to setup', async ({ page }) => {
    await page.goto(`${APP_URL}#/skirmish/attack`);
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
  });

  test('assigns a weapon, reads the hit-chance breakdown, and unlocks called shots on a shields-down target', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Blind-commit + NO-TIMER chrome present from the start (§4.2).
    await expect(page.getByTestId('blind-commit-label')).toBeVisible();

    // Rows derive from live slots: WIDOWMAKER W1, WIDOWMAKER M1, TIN CAN 3 W1.
    const rows = page.getByTestId('weapon-row');
    await expect(rows).toHaveCount(3);

    // Assign WIDOWMAKER W1 → SPUR (bodyId 3). Hit chance reads through hitChanceFor.
    await rows.nth(0).locator('select').selectOption('3');
    await expect(page.getByTestId('hitchance-final')).toHaveText('57%');

    // SPUR shields are down → the called-shot picker unlocks and lists subsystems.
    const picker = rows.nth(0).getByTestId('called-shot-picker');
    await expect(picker).toHaveAttribute('data-locked', 'false');
    // Subsystems are real, keyboard-reachable buttons.
    await picker.getByRole('button', { name: 'ENGINE' }).click();
    await expect(picker.getByRole('button', { name: 'ENGINE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Re-target to IRON VERDICT (shields up) → the picker LOCKS.
    await rows.nth(0).locator('select').selectOption('4');
    await expect(rows.nth(0).getByTestId('called-shot-picker')).toHaveAttribute(
      'data-locked',
      'true',
    );

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('an AoE-over-friendly raises the danger banner without blocking commit', async ({ page }) => {
    const errors = await mount(page);
    const rows = page.getByTestId('weapon-row');

    // WIDOWMAKER M1 (row 1, the missile rack) → SPUR@200. TIN CAN 3@244 is a
    // friendly 44u inside the r60 blast → the banner fires.
    await rows.nth(1).locator('select').selectOption('3');

    const banner = page.getByTestId('ff-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('TIN CAN 3');

    // Commit is NEVER disabled by the warning (§4.6) — and firing it commits.
    const commit = page.getByTestId('commit-fire-btn');
    await expect(commit).toBeEnabled();
    await commit.click();
    const commitCalls = await page.evaluate(
      () => (globalThis as Record<string, unknown>)['__commitCalls'] as unknown[],
    );
    expect(commitCalls.length).toBe(1);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('reduced motion skips the attack animation and hands off immediately', async ({ page }) => {
    const errors = await mount(page);

    // Flip to the resolve phase under reduced motion, with a beat to animate.
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __services: { reducedMotion: { value: boolean } };
        __controller: { attackBeat: { value: unknown }; phase: { value: string } };
      };
      g.__services.reducedMotion.value = true;
      g.__controller.attackBeat.value = { log: [], destroyed: [], launchedMissileIds: [] };
      g.__controller.phase.value = 'attack-resolve';
    });

    // The resolve branch renders and the hand-off fires without playAttack.
    await expect(page.getByTestId('attack-viewport')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls),
      )
      .toBeGreaterThan(0);
    const played = await page.evaluate(
      () => (globalThis as unknown as { __playAttackCalls: number }).__playAttackCalls,
    );
    expect(played).toBe(0);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
