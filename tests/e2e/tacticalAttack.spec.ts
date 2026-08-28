// tests/e2e/tacticalAttack.spec.ts — Tactical Attack mock-parity e2e
// (tactical-attack-mock-parity SESSION-03 CP5).
//
// This supersedes the prior stub-only geometry test, which passed a false
// ~full-content-width "right column" because it only required it to be < 1200px
// at 1280. The rebuild is verified in a REAL browser with the REAL shipped
// stylesheet, along two harnesses:
//
//   • STUB harness (real CSS + a deterministic `worldToScreen` stub) — drives
//     the screen's own interactions (assignment, single-sourced hit chance,
//     called-shot unlock, AoE banner/ring, fire-context chips, per-shooter range
//     envelopes, out-of-range, resolve min-hold, full-field, reduced motion).
//
//   • REAL harness (bundles the REAL M13 render, no stub) — a complete minimal
//     `MatchState` renders true ship/hazard/missile tactical labels; the three-
//     column geometry is measured mechanically at 1920×1080 and 1280×720; the
//     plan overlays (range rings/labels, firing-solution lines + controller-
//     derived percentage pills, boundary/legend/HUD/AoE/friendly text) are
//     asserted present; and a reviewed Chromium screenshot baseline is captured
//     (only the nondeterministic 3D `<canvas>` is masked — never the columns,
//     overlays, labels, pills, rail, or commit footer).
//
// All percentages enter through the harness controller's `hitChanceFor` (68/41/
// 77 by weapon index) — never hardcoded in production JSX/CSS (arch §13.3).

import { test, expect } from '@playwright/test';
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APP_URL = 'http://localhost:8081/starship-skirmish/';

// ---- Shared fixture + harness entry ---------------------------------------
//
// One fleet layout, expressed as BOTH a `BlindMatchView` (the screen's plan
// logic) and a `MatchState` (the render layer's `setState`) so the two agree:
//
//   Fleet 0 (you): WIDOWMAKER (cruiser, 3 named weapons + TALON/HAMMERHEAD racks),
//                  HARRIER-2 (frigate), TIN CAN 3 (fighter, shields down).
//   Fleet 1:       SPUR (frigate, shields down → called shots unlock),
//                  IRON VERDICT (mega-destroyer, shields up).
//   Fleet 2:       MOTE (fighter), DULL EDGE (cruiser).
//   Hazards:       debris D-20, tracking missile 30 → WIDOWMAKER, spent missile 31.
//
// hitChanceFor returns 0.68 / 0.41 / 0.77 by weapon index so the three staged
// weapon shots read distinct, single-sourced percentages.
const FIXTURE = `
  import { h, render } from 'preact';
  import { signal } from '@preact/signals';
  import { AppContext } from '${REPO_ROOT}/src/ui/appContext.ts';
  import { MatchProvider } from '${REPO_ROOT}/src/ui/matchContext.ts';
  import { TacticalAttack } from '${REPO_ROOT}/src/ui/screens/TacticalAttack.tsx';

  globalThis.__commitCalls = [];
  globalThis.__resolveDoneCalls = 0;
  globalThis.__playAttackCalls = 0;
  globalThis.__focusBodyCalls = [];
  globalThis.__resetCalls = 0;
  globalThis.__focusSource = null;
  globalThis.__rangeShellCalls = [];
  globalThis.__resizeCalls = [];

  const wpn = (r, d, s, a, name) => ({ range:r, damage:d, shotsPerTurn:s, accuracy:a, display:{id:'w-'+name, name} });
  const rack = (name, ammo) => ({ ammo, damage:40, aoeRadius:60, boostVelocity:140, trackingTurnRate:1, bodyMass:5, bodyRadius:2, display:{id:'m-'+name, name} });
  const sim = (name, cls, cn) => ({ buildId:'b-'+name, name, chassis:{id:'c', name:cn}, chassisClass:cls,
    mass:100, radius:8, maxHull:140, shieldCapacity:45, shieldRegenPerTurn:2, deltaVPerTurn:30, baseEvasion:0.1, hullRepairPerTurn:0,
    weapons:[wpn(260,18,2,0.68,'PHASE BEAM'), wpn(180,6,2,0.72,'PULSE ARRAY'), wpn(120,4,4,0.80,'FLAK BATTERY')],
    missiles:[rack('TALON',3), rack('HAMMERHEAD',0)], pointDefense:[], decoys:[] });
  const sv = (o) => ({ bodyId:0, fleetId:0, name:'S', chassisClass:'frigate', hull:100, maxHull:140, shields:30, shieldCapacity:45,
    shieldGenAlive:true, engineAlive:true, weaponAlive:[true,true,true], missileAlive:[true,true], missileAmmo:[3,0],
    pdAlive:[], decoyAlive:[], decoyCharges:[], decoyActiveUntilTurn:0,
    ship:sim(o.name||'S', o.chassisClass||'frigate', o.chassisName||'HULL'), ...o });

  const widow = sv({ bodyId:1, fleetId:0, name:'WIDOWMAKER', chassisClass:'cruiser', chassisName:'MERIDIAN', shields:31, hull:96 });
  const harrier = sv({ bodyId:2, fleetId:0, name:'HARRIER-2', chassisClass:'frigate', chassisName:'HARRIER',
    weaponAlive:[true], missileAlive:[true], missileAmmo:[2], ship:sim('HARRIER-2','frigate','HARRIER') });
  const tin = sv({ bodyId:3, fleetId:0, name:'TIN CAN 3', chassisClass:'fighter', chassisName:'NEEDLE', shields:0, hull:18, maxHull:34,
    weaponAlive:[true], missileAlive:[], missileAmmo:[], ship:sim('TIN CAN 3','fighter','NEEDLE') });
  const spur = sv({ bodyId:4, fleetId:1, name:'SPUR', chassisClass:'frigate', chassisName:'LANCER', shields:0, hull:41,
    weaponAlive:[true,false], missileAlive:[true], missileAmmo:[1] });
  const iron = sv({ bodyId:5, fleetId:1, name:'IRON VERDICT', chassisClass:'mega-destroyer', chassisName:'OBELISK',
    shields:88, shieldCapacity:140, hull:305, maxHull:420 });
  const dull = sv({ bodyId:6, fleetId:2, name:'DULL EDGE', chassisClass:'cruiser', chassisName:'BULWARK', shields:74, shieldCapacity:90, hull:118, maxHull:160 });
  const mote = sv({ bodyId:7, fleetId:2, name:'MOTE', chassisClass:'fighter', chassisName:'WASP', shields:11, shieldCapacity:20, hull:26, maxHull:30,
    weaponAlive:[true], missileAlive:[], missileAmmo:[], ship:sim('MOTE','fighter','WASP') });

  const at = (x,y,z) => ({ x:x||0, y:y||0, z:z||0 });
  const bd = (id, kind, x,y,z, r) => ({ id, kind, position:at(x,y,z), velocity:at(0), mass:100, radius:r||8 });
  const POS = { 1:[0,0,0], 2:[-80,0,40], 3:[200,0,110], 4:[100,0,0], 5:[200,0,60], 6:[-160,0,140], 7:[0,0,80] };

  const view = { turn:4, arena:{ center:at(0), radius:600 }, selfFleetId:0,
    ships:[widow,harrier,tin,spur,iron,dull,mote],
    bodies:[ bd(1,'ship',0,0,0,8), bd(2,'ship',-80,0,40,6), bd(3,'ship',200,0,110,4), bd(4,'ship',100,0,0,6),
      bd(5,'ship',200,0,60,12), bd(6,'ship',-160,0,140,8), bd(7,'ship',0,0,80,4),
      bd(20,'debris',-100,0,80,4), bd(30,'missile',60,20,-50,2), bd(31,'missile',-140,30,70,2) ] };

  const combat = (v) => ({ bodyId:v.bodyId, ship:v.ship, shields:v.shields, hull:v.hull });
  const shipsMap = new Map(); [widow,harrier,tin,spur,iron,dull,mote].forEach(v => shipsMap.set(v.bodyId, combat(v)));
  const bodiesMap = new Map(); view.bodies.forEach(b => bodiesMap.set(b.id, b));
  const fleetOf = new Map([[1,0],[2,0],[3,0],[4,1],[5,1],[6,2],[7,2]]);
  const state = { turn:4, arena:{ center:at(0), radius:600 }, bodies:bodiesMap, ships:shipsMap, fleetOf,
    guidances:new Map([[30,{ targetId:1, trackingBeatsLeft:2 }]]), debrisAge:new Map([[20,1]]) };

  const FINALS = [0.68, 0.41, 0.77];
  const controller = {
    view: signal(view), phase: signal('attack-plan'), turn: signal(4),
    movementBeat: signal(null), attackBeat: signal(null), state: signal(state),
    outcome: signal(null), trace: signal({ turns: [] }),
    seedLabel:'SK-7F3A-9C21-D4E8', playerFleetId:0, initialFleets:[],
    commitMovement(){}, commitAttack(p){ globalThis.__commitCalls.push(p); },
    resolveAnimationDone(){ globalThis.__resolveDoneCalls += 1; },
    hitChanceFor(s,t,w){ return { base:0.68, rangeFactor:1.08, velocityFactor:0.95, evasionFactor:0.97, final:(FINALS[w] ?? 0.5) }; },
    previewArc(){ return { positions:[], endsOutsideArena:false }; }, concede(){}, rematch(){},
  };
  const services = { catalog:{}, repo:{}, durable:true, route:signal({ name:'tactical-attack' }),
    reducedMotion:signal(false), toasts:signal([]), activeMatch:signal(controller),
    navigate(){}, toast(){}, startMatch(){ return controller; } };

  globalThis.__controller = controller;
  globalThis.__services = services;
  render(h(AppContext.Provider, { value: services }, h(MatchProvider, { controller }, h(TacticalAttack, {}))),
    document.getElementById('app'));
`;

// Stub render: deterministic `worldToScreen`, a range-shell factory that records
// its reconciliation calls, and a trace player that records playAttack.
const STUB_RENDER = `
  export const createTacticalView = () => ({
    setState() {}, dispose() {},
    resize(w, h) { globalThis.__resizeCalls.push([w, h]); },
    pick() { return null; },
    worldToScreen(pos) { return { x: 640 + pos[0], y: 360 + pos[2] }; },
    focusBody(id) { globalThis.__focusBodyCalls.push(id); },
    camera: {
      resetToFleetView() { globalThis.__resetCalls += 1; },
      focus() {},
      setFocusSource(s) { globalThis.__focusSource = s; },
    },
    scene: { context: { scene: { add() {}, remove() {} } } },
  });
  export const createRangeShell = (r) => {
    globalThis.__rangeShellCalls.push(['create', r]);
    return { mesh: {}, setRadius(x){ globalThis.__rangeShellCalls.push(['radius', x]); },
      setCenter(x,y,z){ globalThis.__rangeShellCalls.push(['center', x,y,z]); },
      setVisible(v){ globalThis.__rangeShellCalls.push(['visible', v]); }, setQuality(){}, dispose(){} };
  };
  export const attachTracePlayer = () => ({
    playMovement() { return mk(); },
    playAttack(_rec, opts) { globalThis.__playAttackCalls += 1; if (opts && opts.onDone) opts.onDone(); return mk(); },
    dispose() {},
  });
  function mk() { return { skip(){}, replay(){}, onDone(cb){ cb(); }, dispose(){} }; }
`;

const renderStubPlugin: esbuild.Plugin = {
  name: 'stub-render',
  setup(build) {
    build.onResolve({ filter: /render\/index\.js$/ }, (args) => ({ path: args.path, namespace: 'stub-render' }));
    build.onLoad({ filter: /.*/, namespace: 'stub-render' }, () => ({ contents: STUB_RENDER, loader: 'js' }));
  },
};

const externalFonts: esbuild.Plugin = {
  name: 'external-fonts',
  setup(build) {
    build.onResolve({ filter: /\.woff2$/ }, () => ({ path: 'font', external: true }));
  },
};

/** Build the harness page HTML. `stub` swaps the render layer for the recording
 *  stub; otherwise the REAL M13 render is bundled. Both inject the REAL shipped
 *  stylesheet (`src/ui/styles/index.css`) so styling is real visual evidence. */
const buildHarness = async (stub: boolean): Promise<string> => {
  const js = await esbuild.build({
    stdin: { contents: FIXTURE, loader: 'ts', resolveDir: REPO_ROOT },
    bundle: true, format: 'iife', platform: 'browser', target: ['es2022'],
    jsx: 'automatic', jsxImportSource: 'preact',
    plugins: stub ? [renderStubPlugin] : [], write: false, logLevel: 'silent',
  });
  const cssBuild = await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, 'src/ui/styles/index.css')],
    bundle: true, write: false, plugins: [externalFonts], logLevel: 'silent',
  });
  const jsText = js.outputFiles?.[0]?.text;
  const cssText = cssBuild.outputFiles?.[0]?.text;
  if (!jsText || !cssText) throw new Error('esbuild produced no output for the tactical-attack harness');
  return `<!doctype html><html><head><style>${cssText}</style><style>
    html,body{height:100%;margin:0;background:var(--void)}
    #app{height:100vh;display:flex;flex-direction:column}
    .app-main.is-fixed-frame{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}
  </style></head><body class="desktop"><div id="app" class="app-main is-fixed-frame"></div><script>${jsText}</script></body></html>`;
};

let stubHtml: string;
let realHtml: string;
test.beforeAll(async () => {
  [stubHtml, realHtml] = await Promise.all([buildHarness(true), buildHarness(false)]);
});

/** Mount a harness page and collect page/console/request/WebGL errors. */
const mount = async (
  page: import('@playwright/test').Page,
  which: 'stub' | 'real',
): Promise<string[]> => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.setContent(which === 'stub' ? stubHtml : realHtml, { waitUntil: 'load' });
  await expect(page.getByTestId('screen-tactical-attack')).toBeVisible();
  return errors;
};

/** Stage the three distinct weapon shots + the AoE missile in the fire rail.
 *  W1 → IRON (68%), W2 → SPUR (41%), W3 → MOTE (77%), M1 (TALON) → IRON (AoE
 *  clips friendly TIN CAN 3). WIDOWMAKER is the default active shooter. */
const stageAll = async (page: import('@playwright/test').Page): Promise<void> => {
  const rows = page.getByTestId('weapon-row');
  await rows.nth(0).locator('select').selectOption('5'); // W1 → IRON VERDICT
  await rows.nth(1).locator('select').selectOption('4'); // W2 → SPUR
  await rows.nth(2).locator('select').selectOption('7'); // W3 → MOTE
  await rows.nth(3).locator('select').selectOption('5'); // M1 (TALON) → IRON VERDICT
};

// ===========================================================================
// A. Served-app guard
// ===========================================================================

test.describe('tactical attack — served-app guard', () => {
  test('a bare deep-link to the attack route with no match redirects to setup', async ({ page }) => {
    await page.goto(`${APP_URL}#/skirmish/attack`);
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
  });
});

// ===========================================================================
// B. Interaction (stub harness, real CSS)
// ===========================================================================

test.describe('tactical attack — interactions', () => {
  test('assigns a weapon, reads the single-sourced hit chance, unlocks/locks called shots', async ({ page }) => {
    const errors = await mount(page, 'stub');
    const rows = page.getByTestId('weapon-row');
    // WIDOWMAKER's live slots: W1, W2, W3, M1(TALON) — HAMMERHEAD (ammo 0) excluded.
    await expect(rows).toHaveCount(4);

    await rows.nth(0).locator('select').selectOption('5'); // W1 → IRON (weapon index 0 → 68%)
    await expect(page.getByTestId('hitchance-final')).toHaveText('68%');

    // W2 → SPUR (shields down) → called-shot picker unlocks.
    await rows.nth(1).locator('select').selectOption('4');
    const picker = rows.nth(1).getByTestId('called-shot-picker');
    await expect(picker).toHaveAttribute('data-locked', 'false');
    await picker.getByRole('button', { name: 'ENGINE' }).click();
    await expect(picker.getByRole('button', { name: 'ENGINE' })).toHaveAttribute('aria-pressed', 'true');

    // Re-target W2 to IRON (shields up) → picker LOCKS.
    await rows.nth(1).locator('select').selectOption('5');
    await expect(rows.nth(1).getByTestId('called-shot-picker')).toHaveAttribute('data-locked', 'true');

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an AoE-over-friendly raises the banner + a projected ring without blocking commit', async ({ page }) => {
    const errors = await mount(page, 'stub');
    // M1 (TALON) → IRON; friendly TIN CAN 3 sits 50u inside the r60 blast.
    await page.getByTestId('weapon-row').nth(3).locator('select').selectOption('5');

    const banner = page.getByTestId('ff-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('TIN CAN 3');

    // The overlay draws the projected AoE ring (aria-hidden) + a friendly callout.
    await expect(page.getByTestId('aoe-ring')).toBeVisible();
    await expect(page.getByTestId('aoe-friendly-callout').first()).toContainText('FRIENDLY IN AoE');

    const commit = page.getByTestId('commit-fire-btn');
    await expect(commit).toBeEnabled();
    await commit.click();
    const commitCalls = await page.evaluate(() => (globalThis as Record<string, unknown>)['__commitCalls'] as unknown[]);
    expect(commitCalls.length).toBe(1);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('roster lists all fleets; selecting a friendly makes it the active shooter, an enemy only inspects', async ({ page }) => {
    const errors = await mount(page, 'stub');
    const roster = page.getByTestId('fleet-roster');
    await expect(roster).toContainText('FULL STATE FOR ALL FLEETS · NO FOG OF WAR');
    await expect(page.getByTestId('fleet-group')).toHaveCount(3); // player + 2 bots
    await expect(page.getByTestId('roster-ship')).toHaveCount(7); // all alive

    // Default active shooter is the lowest-bodyId player ship (WIDOWMAKER).
    await expect(page.getByTestId('fire-shooter-name')).toHaveText('WIDOWMAKER');

    // Clicking HARRIER-2 (friendly) promotes it to the active shooter.
    await page.locator('[data-testid="roster-ship"][data-ship-id="2"]').click();
    await expect(page.getByTestId('fire-shooter-name')).toHaveText('HARRIER-2');

    // Clicking SPUR (enemy) inspects it but leaves HARRIER-2 in the rail.
    await page.locator('[data-testid="roster-ship"][data-ship-id="4"]').click();
    await expect(page.getByTestId('ship-inspector')).toHaveAttribute('data-ship-id', '4');
    await expect(page.getByTestId('camera-focus-label')).toHaveText('SPUR');
    await expect(page.getByTestId('fire-shooter-name')).toHaveText('HARRIER-2');

    // The camera-HUD Focus button dispatches focusBody(4).
    await page.getByTestId('cam-focus').click();
    const focusCalls = await page.evaluate(() => (globalThis as unknown as { __focusBodyCalls: number[] }).__focusBodyCalls);
    expect(focusCalls).toContain(4);
    await page.getByTestId('cam-reset').click();
    expect(await page.evaluate(() => (globalThis as unknown as { __resetCalls: number }).__resetCalls)).toBe(1);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('roster paints SHOOTER / TARGETED / AoE fire-context chips as assignments are staged', async ({ page }) => {
    const errors = await mount(page, 'stub');
    await page.getByTestId('weapon-row').nth(3).locator('select').selectOption('5'); // M1 → IRON

    await expect(
      page.locator('[data-testid="roster-ship"][data-ship-id="1"]').getByTestId('roster-role-chip'),
    ).toHaveAttribute('data-role', 'shooter');
    await expect(
      page.locator('[data-testid="roster-ship"][data-ship-id="5"]').getByTestId('roster-role-chip'),
    ).toHaveAttribute('data-role', 'targeted');
    const aoeChip = page.locator('[data-testid="roster-ship"][data-ship-id="3"]').getByTestId('roster-role-chip');
    await expect(aoeChip).toHaveAttribute('data-role', 'aoe-friendly');
    await expect(aoeChip).toContainText('AoE');

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the active shooter shows every live weapon envelope as a range shell', async ({ page }) => {
    const errors = await mount(page, 'stub');
    // WIDOWMAKER has three live weapons → three range shells created + made visible.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = (globalThis as unknown as { __rangeShellCalls: unknown[][] }).__rangeShellCalls;
          return c.filter((x) => x[0] === 'create').length;
        }),
      )
      .toBe(3);
    const radii = await page.evaluate(() => {
      const c = (globalThis as unknown as { __rangeShellCalls: unknown[][] }).__rangeShellCalls;
      return c.filter((x) => x[0] === 'create').map((x) => x[1]);
    });
    expect(new Set(radii)).toEqual(new Set([260, 180, 120]));

    // Selecting WIDOWMAKER surfaces its longest live-weapon range in the readout.
    await expect(page.getByTestId('ship-range-readout')).toHaveText('SELECT A SHIP TO SEE ITS RANGE');
    await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();
    await expect(page.getByTestId('ship-range-readout')).toHaveText('ENGAGEMENT RANGE 260u');

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a shot ordered past weapon.range reads OUT OF RANGE, never a lying %', async ({ page }) => {
    const errors = await mount(page, 'stub');
    await page.evaluate(() => {
      const g = globalThis as unknown as { __controller: { hitChanceFor: unknown } };
      g.__controller.hitChanceFor = () => ({ base: 0.68, rangeFactor: 0, velocityFactor: 0, evasionFactor: 0, final: 0 });
    });
    // Make WIDOWMAKER active, then W3 (range 120) → IRON at ~209u → out of range.
    const rows = page.getByTestId('weapon-row');
    await rows.nth(2).locator('select').selectOption('5');
    await expect(rows.nth(2).getByTestId('weapon-out-of-range')).toContainText('SHOT WILL NOT FIRE');
    await expect(rows.nth(2).getByTestId('hitchance-final')).toHaveCount(0);
    await expect(rows.nth(2).locator('.chip').first()).toHaveText('OUT OF RANGE');
    await expect(page.getByTestId('commit-fire-btn')).toBeEnabled();

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a zero-fire commit holds a legible resolve for the minimum before advancing', async ({ page }) => {
    const errors = await mount(page, 'stub');
    await page.evaluate(() => {
      const g = globalThis as unknown as { __controller: { attackBeat: { value: unknown }; phase: { value: string } } };
      g.__controller.attackBeat.value = { log: [], destroyed: [], launchedMissileIds: [] };
      g.__controller.phase.value = 'attack-resolve';
    });
    await expect(page.getByTestId('no-fire-note')).toBeVisible();
    await expect(page.getByTestId('combat-log-strip-empty')).toBeVisible();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls)).toBe(0);
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls))
      .toBeGreaterThan(0);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('reduced motion skips the attack animation and hands off immediately', async ({ page }) => {
    const errors = await mount(page, 'stub');
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __services: { reducedMotion: { value: boolean } };
        __controller: { attackBeat: { value: unknown }; phase: { value: string } };
      };
      g.__services.reducedMotion.value = true;
      g.__controller.attackBeat.value = { log: [], destroyed: [], launchedMissileIds: [] };
      g.__controller.phase.value = 'attack-resolve';
    });
    await expect(page.getByTestId('attack-viewport')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { __resolveDoneCalls: number }).__resolveDoneCalls))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => (globalThis as unknown as { __playAttackCalls: number }).__playAttackCalls)).toBe(0);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('FULL FIELD collapses to the tactical stage and Esc restores', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await mount(page, 'stub');
    const shell = page.getByTestId('screen-tactical-attack');
    const roster = page.getByTestId('ta-col-l');
    const fire = page.getByTestId('ta-col-fire');
    const commit = page.getByTestId('commit-fire-btn');
    const fullscreenBtn = page.getByTestId('cam-fullscreen');
    const viewport = page.getByTestId('attack-viewport');

    const resizeCallCount = (): Promise<number> =>
      page.evaluate(() => (globalThis as unknown as { __resizeCalls: number[][] }).__resizeCalls.length);
    const lastResizeCall = (): Promise<readonly [number, number] | null> =>
      page.evaluate(() => {
        const calls = (globalThis as unknown as { __resizeCalls: number[][] }).__resizeCalls;
        const last = calls[calls.length - 1];
        return last === undefined ? null : [last[0]!, last[1]!];
      });
    // Every resize call must reach the ACTUAL live container size — never a
    // hard-coded rail width, and never 0×0.
    const expectResizeMatchesViewport = async (): Promise<readonly [number, number]> => {
      const box = await viewport.boundingBox();
      expect(box).not.toBeNull();
      const call = await lastResizeCall();
      expect(call).not.toBeNull();
      const [w, h] = call!;
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(Math.abs(w - box!.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(h - box!.height)).toBeLessThanOrEqual(2);
      return [w, h];
    };

    // Mount performs an immediate positive-size resize before the first frame.
    await expect.poll(resizeCallCount).toBeGreaterThan(0);
    const [initW, initH] = await expectResizeMatchesViewport();

    await expect(roster).toBeVisible();
    await expect(fullscreenBtn).toHaveText(/FULL FIELD/);
    const countBeforeExpand = await resizeCallCount();
    await fullscreenBtn.click();
    await expect(shell).toHaveClass(/is-immersive/);
    await expect(fullscreenBtn).toHaveText(/RESTORE/);
    await expect(roster).toBeHidden();
    await expect(fire).toBeHidden();
    await expect(commit).toBeHidden();
    await expect(page.getByTestId('camera-hud')).toBeVisible();

    // Grid collapse delivers a further resize to the SAME tactical-view
    // instance, matching the now-expanded viewport — wider (rails gone) and
    // taller (the center-only combat log is gone too).
    await expect.poll(resizeCallCount).toBeGreaterThan(countBeforeExpand);
    const [immW, immH] = await expectResizeMatchesViewport();
    expect(immW).toBeGreaterThan(initW);
    expect(immH).toBeGreaterThan(initH);

    const countBeforeRestore = await resizeCallCount();
    // Press Escape on the focused control (bubbles to the window keydown handler)
    // — `page.keyboard.press` depends on page focus, which is flaky headless.
    await fullscreenBtn.press('Escape');
    await expect(shell).not.toHaveClass(/is-immersive/);
    await expect(roster).toBeVisible();
    await expect(fire).toBeVisible();
    await expect(commit).toBeVisible();

    // Restore delivers a final resize back to the restored center viewport.
    await expect.poll(resizeCallCount).toBeGreaterThan(countBeforeRestore);
    await expectResizeMatchesViewport();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});

// ===========================================================================
// C. Geometry (real render) — mechanical bounding-box checks
// ===========================================================================

const box = async (page: import('@playwright/test').Page, testid: string) => {
  const b = await page.getByTestId(testid).boundingBox();
  if (b === null) throw new Error(`no bounding box for ${testid}`);
  return b;
};

for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
  test(`geometry: three non-overlapping columns with bounded rails at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors = await mount(page, 'real');
    await stageAll(page);
    await page.waitForTimeout(400);

    const left = await box(page, 'ta-col-l');
    const center = await box(page, 'ta-col-c');
    const fire = await box(page, 'ta-col-fire');

    // Ordered left → center → fire rail, side-by-side, non-overlapping.
    expect(left.x).toBeLessThan(center.x);
    expect(center.x).toBeLessThan(fire.x);
    expect(left.x + left.width).toBeLessThanOrEqual(center.x + 1);
    expect(center.x + center.width).toBeLessThanOrEqual(fire.x + 1);

    // Bounded rails (design §D-TA-THREE-COLUMN): left 260–300, fire 320–360.
    expect(left.width).toBeGreaterThanOrEqual(260);
    expect(left.width).toBeLessThanOrEqual(300);
    expect(fire.width).toBeGreaterThanOrEqual(320);
    expect(fire.width).toBeLessThanOrEqual(360);

    // The commit footer lives entirely within the fire rail — never a page bar.
    const commit = await box(page, 'commit-fire-btn');
    expect(commit.x).toBeGreaterThanOrEqual(fire.x - 1);
    expect(commit.x + commit.width).toBeLessThanOrEqual(fire.x + fire.width + 1);
    expect(commit.y + commit.height).toBeLessThanOrEqual(h);
    expect(commit.y).toBeGreaterThanOrEqual(0);
    // Commit width tracks the rail inner width (not the center / page).
    expect(commit.width).toBeLessThan(fire.width);
    expect(commit.width).toBeGreaterThan(fire.width - 60);

    // Every weapon card lies within the fire rail.
    const cards = page.getByTestId('weapon-row');
    for (let i = 0; i < (await cards.count()); i += 1) {
      const c = await cards.nth(i).boundingBox();
      expect(c, `weapon card ${i}`).not.toBeNull();
      expect(c!.x).toBeGreaterThanOrEqual(fire.x - 1);
      expect(c!.x + c!.width).toBeLessThanOrEqual(fire.x + fire.width + 1);
    }

    // Combat log is under the center viewport and never crosses into the fire rail.
    const log = await box(page, 'combat-log-strip');
    const viewport = await box(page, 'attack-viewport');
    expect(log.y).toBeGreaterThanOrEqual(viewport.y + viewport.height - 2);
    expect(log.x + log.width).toBeLessThanOrEqual(fire.x + 1);
    // No weapon/commit element hangs below the center column as a page-bottom pane.
    expect(commit.y).toBeLessThan(log.y);

    // `.ta-fire-scroll` is the only vertical scroller inside the fire rail.
    const fireScrollOverflow = await page.getByTestId('ta-fire-scroll').evaluate((el) => getComputedStyle(el).overflowY);
    expect(fireScrollOverflow).toBe('auto');
    const fireColOverflow = await page.getByTestId('ta-col-fire').evaluate((el) => getComputedStyle(el).overflowY);
    expect(fireColOverflow).toBe('hidden');

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

// ===========================================================================
// D. Visual vocabulary (real render)
// ===========================================================================

test.describe('tactical attack — real-render visual vocabulary', () => {
  test('authored names, real tactical labels, range envelopes, solution pills, and HUD are all present', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors = await mount(page, 'real');
    await stageAll(page);
    await page.waitForTimeout(800); // let the ~15Hz label pass + overlay projection settle

    // Authored shooter/chassis + weapon names (SESSION-01 identity).
    await expect(page.getByTestId('fire-shooter-name')).toHaveText('WIDOWMAKER');
    await expect(page.getByTestId('ta-col-fire')).toContainText('MERIDIAN');
    for (const name of ['PHASE BEAM', 'PULSE ARRAY', 'FLAK BATTERY', 'TALON']) {
      await expect(page.getByTestId('ta-col-fire')).toContainText(name);
    }

    // Real M13 tactical labels — ship + hazard + tracking + spent missile.
    const labels = await page.locator('.tactical-label').allInnerTexts();
    const joined = labels.join(' | ');
    expect(joined).toContain('WIDOWMAKER');
    expect(joined).toMatch(/DEBRIS/);
    expect(joined).toMatch(/MISSILE .*↦/); // tracking missile
    expect(joined).toMatch(/SPENT/); // spent missile

    // At least three weapon range envelopes + three range labels.
    const rangeLabels = await page.getByTestId('range-label').allInnerTexts();
    expect(rangeLabels.length).toBeGreaterThanOrEqual(3);
    expect(rangeLabels.some((t) => t.includes('PHASE BEAM'))).toBe(true);

    // Firing-solution lines + percentage/status pills with the distinct values.
    const svgLines = await page.locator('[data-testid="field-overlay"] svg line').count();
    expect(svgLines).toBeGreaterThanOrEqual(3);
    const pills = await page.getByTestId('solution-pill').allInnerTexts();
    const pillText = pills.join(' | ');
    expect(pillText).toContain('68% · W1');
    expect(pillText).toContain('41% · W2');
    expect(pillText).toContain('77% · W3');
    expect(pillText).toMatch(/M1 .*TALON.*↦/);

    // Boundary radius/exit labels, body-class legend, beat/turn HUD, camera HUD,
    // AoE ring, friendly-fire text.
    await expect(page.getByTestId('boundary-top')).toContainText('KILL BOUNDARY · R 600');
    await expect(page.getByTestId('field-overlay')).toContainText('EXIT = IMMEDIATE DESTRUCTION');
    await expect(page.getByTestId('field-legend')).toContainText('WEAPON RANGE RING');
    await expect(page.getByTestId('beat-hud')).toContainText('BEAT 3 / 4 — ATTACK PLAN');
    await expect(page.getByTestId('beat-hud')).toContainText('TURN 4');
    await expect(page.getByTestId('camera-hud')).toBeVisible();
    await expect(page.getByTestId('aoe-ring')).toBeVisible();
    await expect(page.getByTestId('aoe-friendly-callout').first()).toContainText('FRIENDLY IN AoE');

    // A selected callout appears when a body is picked (roster selection).
    await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId('selected-callout')).toContainText('WIDOWMAKER');

    expect(errors, `real-render errors:\n${errors.join('\n')}`).toEqual([]);
  });
});

// ===========================================================================
// E. Full-field resize regression (real render) — the owner's reported defect
// ===========================================================================
//
// SESSION-01 (tactical-attack-full-field-resize). Reproduces the owner's
// 2048×996 report mechanically: the real renderer's backing store and CSS box
// must track the live `.viewport` container through expand AND restore — not
// just the DOM visibility CSS already proved above. A stretched kill-boundary
// sphere is exactly a canvas-aspect / CSS-box-aspect mismatch; this test
// catches that class of defect where the CSS-only FULL FIELD test cannot.

/** Live canvas geometry: CSS box (from `getBoundingClientRect`, always CSS
 *  pixels) and backing-store size (`canvas.width/height`, DPR-scaled). */
const readCanvas = (
  page: import('@playwright/test').Page,
): Promise<{ cssWidth: number; cssHeight: number; backingWidth: number; backingHeight: number }> =>
  page.locator('[data-testid="attack-viewport"] canvas').evaluate((el: HTMLCanvasElement) => {
    const rect = el.getBoundingClientRect();
    return { cssWidth: rect.width, cssHeight: rect.height, backingWidth: el.width, backingHeight: el.height };
  });

test.describe('tactical attack — full-field resize regression (real render)', () => {
  for (const [w, h] of [[2048, 996], [1920, 1080], [1280, 720]] as const) {
    test(`renderer backing store + projection track the live viewport through expand/restore at ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const errors = await mount(page, 'real');
      await stageAll(page);
      await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();
      await page.waitForTimeout(400); // initial renderer/label pass settles

      const dpr = Math.min(await page.evaluate(() => window.devicePixelRatio), 2);

      // Canvas fills its `.viewport` container exactly (CSS 100%×100%); the
      // backing store tracks that CSS size scaled by the capped DPR — never
      // the stale pre-collapse dimensions (the defect this session fixes).
      // A small tolerance absorbs sub-pixel layout/DPR rounding (Playwright's
      // box-model read vs. the canvas's own `getBoundingClientRect`).
      const assertAligned = async (label: string): Promise<{ width: number; height: number }> => {
        const c = await readCanvas(page);
        const viewportBox = await box(page, 'attack-viewport');
        expect(Math.abs(c.cssWidth - viewportBox.width), `${label} css width`).toBeLessThanOrEqual(2);
        expect(Math.abs(c.cssHeight - viewportBox.height), `${label} css height`).toBeLessThanOrEqual(2);
        const expectedBackingW = Math.round(viewportBox.width * dpr);
        const expectedBackingH = Math.round(viewportBox.height * dpr);
        expect(Math.abs(c.backingWidth - expectedBackingW), `${label} backing width`).toBeLessThanOrEqual(3);
        expect(Math.abs(c.backingHeight - expectedBackingH), `${label} backing height`).toBeLessThanOrEqual(3);
        const cssAspect = viewportBox.width / viewportBox.height;
        const backingAspect = c.backingWidth / c.backingHeight;
        expect(Math.abs(cssAspect - backingAspect), `${label} aspect`).toBeLessThan(0.02);
        return { width: viewportBox.width, height: viewportBox.height };
      };

      const center = await assertAligned('center');

      // Toggle FULL FIELD; wait for the `ResizeObserver` delivery itself
      // (never a fixed sleep as the sole readiness signal) before asserting.
      await page.getByTestId('cam-fullscreen').click();
      await expect(page.getByTestId('screen-tactical-attack')).toHaveClass(/is-immersive/);
      await expect
        .poll(async () => (await readCanvas(page)).backingWidth)
        .not.toBe(Math.round(center.width * dpr));
      await page.waitForTimeout(300); // ~15Hz label pass + overlay projection settle

      const expanded = await assertAligned('immersive');
      // Genuinely expanded — never the retained former center-column size.
      expect(expanded.width).toBeGreaterThan(center.width);

      // Plan overlays remain visible and reprojected inside the expanded
      // viewport bounds — a stale projection would leave them at the old,
      // narrower center-column coordinates.
      const expandedViewportBox = await box(page, 'attack-viewport');
      for (const testid of ['range-label', 'solution-pill']) {
        const first = page.getByTestId(testid).first();
        await expect(first).toBeVisible();
        const b = await first.boundingBox();
        expect(b, testid).not.toBeNull();
        expect(b!.x).toBeGreaterThanOrEqual(expandedViewportBox.x - 5);
        expect(b!.x + b!.width).toBeLessThanOrEqual(expandedViewportBox.x + expandedViewportBox.width + 5);
      }
      await expect(page.getByTestId('selected-callout')).toBeVisible();
      await expect(page.getByTestId('beat-hud')).toBeVisible();
      await expect(page.getByTestId('field-legend')).toBeVisible();
      await expect(page.getByTestId('boundary-top')).toBeVisible();
      await expect(page.getByTestId('camera-hud')).toBeVisible();

      // Exit immersive — backing store + projection contract back to the
      // restored center viewport.
      await page.getByTestId('cam-fullscreen').press('Escape');
      await expect(page.getByTestId('screen-tactical-attack')).not.toHaveClass(/is-immersive/);
      await expect
        .poll(async () => (await readCanvas(page)).backingWidth)
        .not.toBe(Math.round(expanded.width * dpr));
      await page.waitForTimeout(300);

      const restored = await assertAligned('restored');
      expect(Math.abs(restored.width - center.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(restored.height - center.height)).toBeLessThanOrEqual(2);

      expect(errors, `real-render errors:\n${errors.join('\n')}`).toEqual([]);
    });
  }
});

// ===========================================================================
// F. Reviewed real-render screenshot baselines
// ===========================================================================

test.describe('tactical attack — mock-parity screenshot baseline', () => {
  test('real-render attack-plan matches the reviewed baseline @1920×1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors = await mount(page, 'real');
    await stageAll(page);
    await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();
    await page.waitForTimeout(1200); // camera settle + label/overlay projection stable

    // Nothing is masked: the DOM overlays (range labels, solution lines,
    // percentage pills, AoE ring, boundary/legend/HUD text), the rail cards, the
    // commit footer, and the three columns are all compared. The 3D `<canvas>`
    // beneath them is deterministic on a fixed engine (SwiftShader, a settled
    // camera) — a small per-pixel AA threshold + a bounded diff ratio absorb
    // rasterisation noise without a permissive whole-screen diff. The snapshot is
    // platform-scoped (`-chromium-darwin`); other platforms author their own.
    await expect(page).toHaveScreenshot('attack-plan-1920.png', {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
    });

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('real-render FULL FIELD matches the reviewed proportional baseline @1920×1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors = await mount(page, 'real');
    await stageAll(page);
    await page.locator('[data-testid="roster-ship"][data-ship-id="1"]').click();
    await page.waitForTimeout(400);

    await page.getByTestId('cam-fullscreen').click();
    await expect(page.getByTestId('screen-tactical-attack')).toHaveClass(/is-immersive/);
    await page.waitForTimeout(1200); // camera settle + label/overlay projection stable

    // Unmasked (D-TA-UNMASKED-FULL-FIELD-GATE) — the real canvas and every DOM
    // overlay (range labels, solution lines, boundary/legend/HUD text, camera
    // HUD) are compared. Passing hidden-column CSS geometry alone (the prior
    // stub-only test) is insufficient — this proves the expanded canvas reads
    // proportionally, not as the reported stretched ellipse.
    await expect(page).toHaveScreenshot('attack-plan-full-field-1920.png', {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
    });

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
