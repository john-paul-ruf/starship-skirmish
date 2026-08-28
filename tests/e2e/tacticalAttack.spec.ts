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
// reduced-motion assertion can prove the animation was skipped. S04 CP1/CP2:
// stub the new seams the screen wires — `pick`, `focusBody`, `worldToScreen`,
// `camera.setFocusSource`, `camera.resetToFleetView`, `camera.focus`. The
// worldToScreen fake is a simple top-down (x, z) → (400+x, 300+z) projection so
// the AoE ring renders at predictable pixel coords the assertion can pin down.
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
        globalThis.__focusBodyCalls = [];
        globalThis.__resetCalls = 0;
        globalThis.__focusSource = null;
        globalThis.__rangeShellCalls = [];
        export const createTacticalView = () => ({
          setState() {}, dispose() {}, resize() {},
          pick() { return null; },
          worldToScreen(pos) {
            // Fake top-down projection: (x, z) → CSS-pixels (400+x, 300+z).
            return { x: 400 + pos[0], y: 300 + pos[2] };
          },
          focusBody(id) { globalThis.__focusBodyCalls.push(id); },
          camera: {
            resetToFleetView() { globalThis.__resetCalls += 1; },
            focus() {},
            setFocusSource(source) { globalThis.__focusSource = source; },
          },
          // playtest-feedback-03 SESSION-01: a minimal scene-graph shape so
          // Viewport's range-shell attach (\`view.scene.context.scene\`) finds
          // somewhere to add/remove the shell mesh.
          scene: { context: { scene: { add() {}, remove() {} } } },
        });
        // playtest-feedback-03 SESSION-01 — the range-shell factory Viewport
        // attaches once per mount; calls are recorded so a test can assert the
        // shell followed a ship selection without needing real WebGL.
        export const createRangeShell = () => ({
          mesh: {},
          setRadius(r) { globalThis.__rangeShellCalls.push(['radius', r]); },
          setCenter(x, y, z) { globalThis.__rangeShellCalls.push(['center', x, y, z]); },
          setVisible(v) { globalThis.__rangeShellCalls.push(['visible', v]); },
          setQuality() {},
          dispose() {},
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

  test('left column lists ALL fleets with pips, and clicking an enemy row opens the inspector', async ({
    page,
  }) => {
    const errors = await mount(page);

    // The FR-15 left column is present with the no-fog caption.
    const roster = page.getByTestId('fleet-roster');
    await expect(roster).toBeVisible();
    await expect(roster).toContainText('FULL STATE FOR ALL FLEETS · NO FOG OF WAR');

    // Both fleets have groups — player fleet first, then bots.
    const groups = page.getByTestId('fleet-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAttribute('data-fleet-role', 'player');
    await expect(groups.nth(0)).toHaveAttribute('data-fleet-id', '0');
    await expect(groups.nth(1)).toHaveAttribute('data-fleet-role', 'bot');
    await expect(groups.nth(1)).toHaveAttribute('data-fleet-id', '1');

    // Living roster rows are real buttons; every ship in every fleet is listed.
    const livingRows = page.getByTestId('roster-ship');
    // 2 player ships + 2 bot ships (all alive in the fixture).
    await expect(livingRows).toHaveCount(4);
    // Each row carries pips (never color-alone: label + aria-label).
    await expect(livingRows.nth(0).getByTestId('ship-pips')).toBeVisible();

    // Inspector starts empty and announces SELECT A SHIP.
    const inspector = page.getByTestId('ship-inspector');
    await expect(inspector).toBeVisible();
    await expect(page.getByTestId('inspector-empty')).toBeVisible();

    // Click SPUR (an enemy, bodyId 3) → inspector switches, testid decorates it.
    await page.locator('[data-testid="roster-ship"][data-ship-id="3"]').click();
    await expect(page.getByTestId('inspector-empty')).toHaveCount(0);
    await expect(page.getByTestId('ship-inspector')).toHaveAttribute('data-ship-id', '3');
    await expect(page.getByTestId('ship-inspector')).toContainText('SPUR');

    // The camera focus label updates too — the HUD's focus-label reads the selection.
    await expect(page.getByTestId('camera-focus-label')).toHaveText('SPUR');

    // Roster row selection propagates to focusBody(3) so F would slide to it.
    const focusCalls = await page.evaluate(
      () => (globalThis as unknown as { __focusBodyCalls: number[] }).__focusBodyCalls,
    );
    // The screen owns the F-key focus source; roster click sets selection but
    // does NOT call focusBody directly (the CAMERA HUD's FOCUS button does).
    // Instead assert the focus-source closure returns SPUR's position.
    const focusPos = await page.evaluate(() => {
      const g = globalThis as unknown as { __focusSource: null | (() => readonly number[] | null) };
      return g.__focusSource !== null ? g.__focusSource() : null;
    });
    expect(focusPos).toEqual([200, 0, 0]); // SPUR is at (200, 0, 0)
    // The camera-HUD Focus button dispatches focusBody(3) explicitly.
    await page.getByTestId('cam-focus').click();
    const postFocusCalls = await page.evaluate(
      () => (globalThis as unknown as { __focusBodyCalls: number[] }).__focusBodyCalls,
    );
    expect(postFocusCalls).toEqual([...focusCalls, 3]);

    // The Reset button snaps the camera back.
    await page.getByTestId('cam-reset').click();
    const resetCalls = await page.evaluate(
      () => (globalThis as unknown as { __resetCalls: number }).__resetCalls,
    );
    expect(resetCalls).toBe(1);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('an AoE-over-friendly missile draws a projected ring alongside the authoritative banner', async ({
    page,
  }) => {
    const errors = await mount(page);
    const rows = page.getByTestId('weapon-row');

    // WIDOWMAKER M1 → SPUR@(200,0,0). r60 blast. worldToScreen's top-down fake
    // projects the target to (400+200, 300+0) = (600, 300); a sample offset by
    // +radius on x maps to (660, 300) → pixel radius = 60.
    await rows.nth(1).locator('select').selectOption('3');

    // Ring reprojection lives in a RAF loop — poll until it lands.
    const ring = page.getByTestId('aoe-ring');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute('data-ring-cx', '600');
    await expect(ring).toHaveAttribute('data-ring-cy', '300');
    await expect(ring).toHaveAttribute('data-ring-r', '60');
    // Ring is aria-hidden — informational overlay, banner carries the a11y channel.
    await expect(ring).toHaveAttribute('aria-hidden', 'true');

    // The banner remains authoritative and role="alert".
    const banner = page.getByTestId('ff-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');

    // Commit is NEVER disabled by the warning — the ring is informational.
    await expect(page.getByTestId('commit-fire-btn')).toBeEnabled();

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('roster paints TARGETED / SHOOTER / AoE fire-context chips as assignments are staged', async ({
    page,
  }) => {
    const errors = await mount(page);
    const rows = page.getByTestId('weapon-row');

    // WIDOWMAKER M1 → SPUR. Fire context should paint SHOOTER on 1 and
    // TARGETED on 3, plus AoE on 2 (TIN CAN 3 caught in the blast).
    await rows.nth(1).locator('select').selectOption('3');

    const shooterChip = page
      .locator('[data-testid="roster-ship"][data-ship-id="1"]')
      .getByTestId('roster-role-chip');
    await expect(shooterChip).toHaveAttribute('data-role', 'shooter');

    const targetedChip = page
      .locator('[data-testid="roster-ship"][data-ship-id="3"]')
      .getByTestId('roster-role-chip');
    await expect(targetedChip).toHaveAttribute('data-role', 'targeted');

    const aoeChip = page
      .locator('[data-testid="roster-ship"][data-ship-id="2"]')
      .getByTestId('roster-role-chip');
    await expect(aoeChip).toHaveAttribute('data-role', 'aoe-friendly');
    // The chip carries text ("⚠ IN AoE") in addition to color — never color-alone.
    await expect(aoeChip).toContainText('AoE');

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('selecting a ship shows the range shell immediately — no weapon-slot focus required', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Before any selection, the readout says so and no shell calls landed yet.
    await expect(page.getByTestId('ship-range-readout')).toHaveText('SELECT A SHIP TO SEE ITS RANGE');

    // Click WIDOWMAKER (bodyId 1, at world origin) in the roster — no weapon
    // slot touched. D-ATK-ORIENTATION: the shell must appear from selection
    // alone (FB1 — "where are my ranges").
    await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();

    await expect(page.getByTestId('ship-range-readout')).toHaveText('ENGAGEMENT RANGE 260u');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const calls = (globalThis as unknown as { __rangeShellCalls: unknown[][] }).__rangeShellCalls;
          return calls.some((c) => c[0] === 'visible' && c[1] === true);
        }),
      )
      .toBe(true);
    const lastRadius = await page.evaluate(() => {
      const calls = (globalThis as unknown as { __rangeShellCalls: unknown[][] }).__rangeShellCalls;
      return [...calls].reverse().find((c) => c[0] === 'radius')?.[1];
    });
    expect(lastRadius).toBe(260);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a zero-fire commit shows a legible resolve for the minimum hold before advancing', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Flip straight to resolve with an empty beat (every slot HELD) — the
    // trace has no turn-4 entries either, mirroring an all-HOLD commit.
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __controller: { attackBeat: { value: unknown }; phase: { value: string } };
      };
      g.__controller.attackBeat.value = { log: [], destroyed: [], launchedMissileIds: [] };
      g.__controller.phase.value = 'attack-resolve';
    });

    // The empty-state reads immediately — never a blank resolve screen.
    await expect(page.getByTestId('no-fire-note')).toBeVisible();
    await expect(page.getByTestId('combat-log-strip-empty')).toBeVisible();

    // D-ATK-RESOLVE-MIN-HOLD: the hand-off does NOT fire the instant the
    // (synchronous, in this stub) animation reports done — it waits out the
    // minimum readable hold first, so the turn never flashes past.
    await page.waitForTimeout(100);
    const early = await page.evaluate(
      () => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls,
    );
    expect(early).toBe(0);

    await expect
      .poll(() =>
        page.evaluate(() => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls),
      )
      .toBeGreaterThan(0);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a shot ordered past weapon.range reads OUT OF RANGE — never a lying 5%', async ({
    page,
  }) => {
    // playtest-feedback-04 FB1 (D-HITCHANCE-RANGE-GATE): pick a target the
    // resolver would refuse (IRON VERDICT at 600u; W1 range is 260u). The
    // bench must announce OUT OF RANGE — no 5% floor readout, no HitChance
    // block — and both the row's chip and the picker option must say so.
    const errors = await mount(page);

    // Override hitChanceFor for this test so the seam publishes the honest
    // 0% breakdown the controller now returns for out-of-range shots (the
    // harness's default returned a canned 57% for every input).
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __controller: { hitChanceFor: (a: number, b: number, w: number) => unknown };
      };
      const zero = { base: 0.68, rangeFactor: 0, velocityFactor: 0, evasionFactor: 0, final: 0 };
      g.__controller.hitChanceFor = () => zero;
    });

    const rows = page.getByTestId('weapon-row');
    // Row 0 = WIDOWMAKER W1 (range 260). Assign it to IRON VERDICT (bodyId 4)
    // at 600u — well past 260. The resolver would refuse this shot.
    await rows.nth(0).locator('select').selectOption('4');

    // The row surfaces the explicit OUT OF RANGE block — not the HitChance %.
    await expect(rows.nth(0).getByTestId('weapon-out-of-range')).toBeVisible();
    await expect(rows.nth(0).getByTestId('weapon-out-of-range')).toContainText(
      'SHOT WILL NOT FIRE',
    );
    await expect(rows.nth(0).getByTestId('hitchance-final')).toHaveCount(0);

    // The row's status chip flips to OUT OF RANGE (not ASSIGNED / HOLD).
    await expect(rows.nth(0).locator('.chip').first()).toHaveText('OUT OF RANGE');

    // The picker option itself carries the OUT OF RANGE suffix so the player
    // sees the refusal BEFORE assigning next time. Still selectable — warns,
    // never blocks (§4.6).
    const options = await rows.nth(0).locator('select option').allInnerTexts();
    const ironOption = options.find((o) => o.includes('IRON VERDICT'));
    expect(ironOption, 'IRON VERDICT option').toBeDefined();
    expect(ironOption).toContain('OUT OF RANGE');

    // Commit is NOT gated by the out-of-range warning.
    await expect(page.getByTestId('commit-fire-btn')).toBeEnabled();

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('at 1280x720 the right column shows one primary scroll region and CommitBar stays visible', async ({
    page,
  }) => {
    // playtest-feedback-04 FB2 (D-ATK-ONE-SCROLL): the fix collapses three
    // stacked scroll regions (.ta-col-r safety, the old bench-scroll
    // wrapper, and any outer chrome overflow) into a single .ta-plan-scroll
    // wrapper (renamed from the pf-04 name in pf-05 SESSION-04 CP4). At the
    // project's own minimum supported viewport (FORGE-CONFIG 1280x720),
    // exactly one primary scroll surface lives in the right column, and the
    // CommitBar is fully visible under it.
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await mount(page);

    // The single primary plan-time scroll region exists.
    const planScroll = page.getByTestId('ta-plan-scroll');
    await expect(planScroll).toBeVisible();

    // The column itself does NOT scroll — its overflow is `hidden` (all
    // scroll is delegated to the inner .ta-plan-scroll region).
    const colOverflow = await page
      .getByTestId('ta-plan-scroll')
      .evaluate((el) => {
        const col = el.parentElement as HTMLElement | null;
        if (col === null) return null;
        return window.getComputedStyle(col).overflowY;
      });
    expect(colOverflow).toBe('hidden');

    // The plan wrapper OWNS scroll (auto).
    const planOverflow = await planScroll.evaluate(
      (el) => window.getComputedStyle(el as HTMLElement).overflowY,
    );
    expect(planOverflow).toBe('auto');

    // COMMIT FIRE bar is inside the viewport (not clipped below the fold).
    const commit = page.getByTestId('commit-fire-btn');
    await expect(commit).toBeVisible();
    const commitBox = await commit.boundingBox();
    expect(commitBox, 'commit-fire button geometry').not.toBeNull();
    // Fully within the 720px viewport.
    expect(commitBox!.y + commitBox!.height).toBeLessThanOrEqual(720);
    expect(commitBox!.y).toBeGreaterThanOrEqual(0);

    // playtest-feedback-05 SESSION-04 CP1 (FB2 · "no bottom panel"): the
    // commit is CONTAINED — it lives inside the right column and never spans
    // the whole 1280px page width. The measured button sits well inside the
    // frame: it must be less than half the viewport, and its parent (the
    // right column) must be narrower than the viewport by at least the left
    // column's minimum track. The two-column grid keeps roster + right col
    // side-by-side even at the min viewport; a regression to a single-column
    // grid at 1280 would fail this.
    expect(commitBox!.width).toBeLessThan(1000);
    const rightColWidth = await planScroll.evaluate((el) => {
      const col = el.parentElement as HTMLElement | null;
      return col === null ? null : col.getBoundingClientRect().width;
    });
    expect(rightColWidth, 'right-column width').not.toBeNull();
    expect(rightColWidth!).toBeLessThan(1200);
    // The button is fully inside its parent column horizontally.
    const colLeft = await planScroll.evaluate((el) => {
      const col = el.parentElement as HTMLElement | null;
      return col === null ? null : col.getBoundingClientRect().left;
    });
    expect(colLeft!).toBeGreaterThan(0); // roster occupies the left gutter

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the FULL FIELD toggle collapses to the tactical stage and Esc restores', async ({
    page,
  }) => {
    // playtest-feedback-05 SESSION-04 CP2 (FB3 · D-IMMERSIVE-GRID-COLLAPSE):
    // FULL FIELD hides the roster + plan-scroll + commit and grows the
    // Viewport into the vacated space. Esc restores. Grid-collapse only —
    // the shell stays inside `.app-main.is-fixed-frame`.
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await mount(page);

    const shell = page.getByTestId('screen-tactical-attack');
    const roster = page.getByTestId('ta-col-l');
    const planScroll = page.getByTestId('ta-plan-scroll');
    const commit = page.getByTestId('commit-fire-btn');
    const cameraHud = page.getByTestId('camera-hud');
    const fullscreenBtn = page.getByTestId('cam-fullscreen');

    // Baseline: everything visible, toggle reads its off-state.
    await expect(roster).toBeVisible();
    await expect(planScroll).toBeVisible();
    await expect(commit).toBeVisible();
    await expect(fullscreenBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(fullscreenBtn).toHaveText(/FULL FIELD/);

    // Click FULL FIELD → immersive collapses the plan surfaces.
    await fullscreenBtn.click();
    await expect(shell).toHaveClass(/is-immersive/);
    await expect(fullscreenBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(fullscreenBtn).toHaveText(/RESTORE/);
    // Roster, plan-scroll, commit all hidden (display:none).
    await expect(roster).toBeHidden();
    await expect(planScroll).toBeHidden();
    await expect(commit).toBeHidden();
    // The Viewport (and its CameraHud) remain — the whole point of the mode.
    await expect(cameraHud).toBeVisible();

    // Esc restores everything.
    await page.keyboard.press('Escape');
    await expect(shell).not.toHaveClass(/is-immersive/);
    await expect(roster).toBeVisible();
    await expect(planScroll).toBeVisible();
    await expect(commit).toBeVisible();
    await expect(fullscreenBtn).toHaveAttribute('aria-pressed', 'false');

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
