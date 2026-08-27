// tests/e2e/tacticalMove.spec.ts — Tactical Movement screen e2e (S05 CP4 +
// SESSION-03 CP4 + `finite-thrust-movement` SESSION-05 CP4).
//
// Chromium tests (UI smoke, like postMatch / skirmishBoot):
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
//   4. ALL-FLEETS ROSTER (setContent harness, SESSION-03) — the shared
//      `FleetRoster` lists every fleet (player + bots) grouped by owner (FR-15);
//      selecting a BOT ship shows the read-only inspector and NO plan form
//      (FR-17); the marks-interval selector transitions Off / 1s / 2s / 4s; the
//      camera HUD Reset / Focus buttons exist and are keyboard-reachable.
//
//   5. WAYPOINT PLOTTING (setContent harness, SESSION-05) — switch marks to 2s
//      (4 waypoints), assert the waypoint selector appears with per-segment
//      labels (t=0s · LAUNCH, t=2s, …), plot waypoint 0 and waypoint 2
//      independently, and assert the segmented COMMIT payload + the segmented
//      `previewArc` call the ghost path fires.
//
// The tactical viewport reaches render via a dynamic `import()` that cannot
// resolve inside the bundled harness page, so the viewport DEGRADES to numeric
// entry — exactly the accessibility fallback the screen guarantees. Every
// assertion here is on the DOM channels, which stay fully functional (S01 focus
// / trail / pixel channels are verified visually in a real match run).

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
// controller with THREE fleets (one player, two bots) so the SESSION-03
// all-fleets grouping is exercised (FR-15). `previewArc` reports a boundary
// exit once the Δv magnitude passes a threshold so a big arc trips the §4.1
// signal deterministically.
// ---------------------------------------------------------------------------

const buildHarness = async (): Promise<string> => {
  const virtualEntry = `
    import { h, render } from 'preact';
    import { signal } from '@preact/signals';
    import { AppContext } from '${REPO_ROOT}/src/ui/appContext.ts';
    import { MatchProvider } from '${REPO_ROOT}/src/ui/matchContext.ts';
    import { TacticalMove } from '${REPO_ROOT}/src/ui/screens/TacticalMove.tsx';

    globalThis.__navCalls = [];

    const shipDef = (name, deltaVPerTurn, klass) => ({
      buildId: 'b-' + name, name, chassisClass: klass || 'frigate', mass: 100, radius: 4,
      maxHull: 60, shieldCapacity: 20, shieldRegenPerTurn: 2, deltaVPerTurn,
      baseEvasion: 0.2, hullRepairPerTurn: 0, weapons: [], missiles: [], pointDefense: [], decoys: [],
    });
    const shipA = shipDef('WIDOWMAKER', 70);
    const shipB = shipDef('HARRIER-2', 40);
    const shipC = shipDef('IRON VERDICT', 20, 'cruiser');
    const shipD = shipDef('THUNDERHEAD', 30, 'cruiser');

    const initialFleets = [
      { fleetId: 0, ships: [shipA, shipB] }, // bodyIds 1, 2 — player
      { fleetId: 1, ships: [shipC] },        // bodyId 3 — BOT-01
      { fleetId: 2, ships: [shipD] },        // bodyId 4 — BOT-02
    ];

    const shipView = (bodyId, fleetId, s) => ({
      bodyId, fleetId, name: s.name, chassisClass: s.chassisClass,
      hull: s.maxHull, maxHull: s.maxHull, shields: s.shieldCapacity, shieldCapacity: s.shieldCapacity,
      shieldGenAlive: true, engineAlive: true, weaponAlive: [], missileAlive: [], missileAmmo: [],
      pdAlive: [], decoyAlive: [], decoyCharges: [], decoyActiveUntilTurn: 0, ship: s,
    });
    const body = (id) => ({ id, kind: 'ship', position: { x: id * 10, y: 0, z: 0 }, velocity: { x: 40, y: 0, z: 0 }, mass: 100, radius: 4 });

    const arena = { center: { x: 0, y: 0, z: 0 }, radius: 5400 };
    const view = signal({
      turn: 1, arena, selfFleetId: 0,
      bodies: [body(1), body(2), body(3), body(4)],
      ships: [shipView(1, 0, shipA), shipView(2, 0, shipB), shipView(3, 1, shipC), shipView(4, 2, shipD)],
    });
    const bodiesMap = new Map([
      [1, body(1)], [2, body(2)], [3, body(3)], [4, body(4)],
    ]);
    const state = signal({ arena, physics: { dt: 8 }, turn: 1, ships: new Map(), bodies: bodiesMap });

    const phase = signal('movement-plan');
    const movementBeat = signal(null);

    const controller = {
      view, phase, turn: signal(1), movementBeat, attackBeat: signal(null), state,
      outcome: signal(null), trace: signal({}), seedLabel: 'SK-7F3A-9C21-D4E8',
      playerFleetId: 0, initialFleets,
      // SESSION-05: previewArc accepts the discriminated Vec3 | {segments} union
      // (D-ADDITIVE-PLAN, S04). SESSION-05 CP3 has the screen always send
      // {segments}; the impulsive-Vec3 branch stays here for future callers.
      previewArc(bodyId, arc) {
        globalThis.__lastPreviewArc = { bodyId, arc };
        const isSegmented = arc !== null && typeof arc === 'object' && 'segments' in arc;
        const mag = isSegmented
          ? arc.segments.reduce(
              (s, b) => s + Math.hypot(b.deltaV.x, b.deltaV.y, b.deltaV.z),
              0,
            )
          : Math.hypot(arc.x, arc.y, arc.z);
        const positions = [{ x: 0, y: 0, z: 0 }, { x: mag, y: 0, z: 0 }];
        const result = { positions, endsOutsideArena: mag > 40 };
        // Segmented previews carry markPositions at each waypoint boundary
        // (S04 seam) — synthesize a plausible boundary set for the harness.
        if (isSegmented) {
          result.markPositions = arc.segments.map((_b, i) => ({
            x: (mag / Math.max(1, arc.segments.length)) * (i + 1),
            y: 0,
            z: 0,
          }));
        }
        return result;
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

    // COAST the second ship — select via the shared FleetRoster row (data-ship-id 2).
    await page.locator('[data-testid="roster-ship"][data-ship-id="2"]').click();
    await page.getByRole('button', { name: /Set to Coast/ }).click();

    // Gate opens.
    await expect(commit).toBeEnabled();
    await expect(commit).toContainText('2/2 PLANNED');

    // COMMIT → resolve → the controller hands off to the attack beat.
    await commit.click();
    await expect
      .poll(() => page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls']))
      .toContainEqual({ name: 'tactical-attack' });

    // SESSION-05 CP4: every committed plan carries `segments` (D-ADDITIVE-PLAN).
    const commitShape = await page.evaluate(() => {
      const plans = (globalThis as Record<string, unknown>)['__committedPlans'] as
        | ReadonlyArray<{ readonly bodyId: number; readonly segments?: readonly unknown[] }>
        | undefined;
      return plans === undefined
        ? null
        : plans.map((p) => ({ bodyId: p.bodyId, segCount: p.segments ? p.segments.length : 0 }));
    });
    expect(commitShape).not.toBeNull();
    for (const p of commitShape!) expect(p.segCount).toBeGreaterThan(0);

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

    // Channel B — the FleetRoster plan badge reads ✕ EXIT ARC (never color alone).
    const widowmakerBadge = page
      .locator('[data-testid="roster-ship"][data-ship-id="1"] [data-testid="plan-badge"]');
    await expect(widowmakerBadge).toContainText('EXIT');

    // COAST the second ship so the gate can open.
    await page.locator('[data-testid="roster-ship"][data-ship-id="2"]').click();
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

  test('all fleets group in the roster; bot selection shows inspector but no plot form; marks + camera HUD wire up', async ({
    page,
  }) => {
    const errors = await mount(page);

    // FR-15: the shared roster lists player + BOT-01 + BOT-02 as three groups.
    const groups = page.getByTestId('fleet-group');
    await expect(groups).toHaveCount(3);
    // Player group is first (D-SURFACE-SUFFICIENT: `groupByFleet` player-first).
    await expect(groups.first()).toHaveAttribute('data-fleet-role', 'player');
    // Bot ships appear in their own group rows.
    await expect(page.locator('[data-testid="roster-ship"][data-ship-id="3"]')).toBeVisible();
    await expect(page.locator('[data-testid="roster-ship"][data-ship-id="4"]')).toBeVisible();

    // The plan-status badge lives ONLY on living player rows.
    await expect(
      page.locator('[data-testid="roster-ship"][data-ship-id="1"] [data-testid="plan-badge"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="roster-ship"][data-ship-id="3"] [data-testid="plan-badge"]'),
    ).toHaveCount(0);

    // Select the BOT-01 ship — the inspector shows its identity + NO plotter renders.
    await page.locator('[data-testid="roster-ship"][data-ship-id="3"]').click();
    const inspector = page.getByTestId('ship-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-ship-id', '3');
    await expect(inspector).toContainText('IRON VERDICT');
    // FR-17: no plot form for opponent selection.
    await expect(page.getByTestId('arc-plotter-readonly')).toBeVisible();
    await expect(page.getByTestId('arc-plotter')).toHaveCount(0);

    // Camera HUD: real, focusable buttons.
    const camReset = page.getByTestId('cam-reset');
    const camFocus = page.getByTestId('cam-focus');
    await expect(camReset).toBeVisible();
    await expect(camFocus).toBeVisible();
    await expect(camReset).toHaveAttribute('aria-keyshortcuts', 'R');
    await expect(camFocus).toHaveAttribute('aria-keyshortcuts', 'F');
    await camReset.focus();
    await expect(camReset).toBeFocused();

    // Selecting a bot still enables the Focus button (any selection is focusable).
    await expect(camFocus).toBeEnabled();

    // Marks-interval selector — Off / 1s / 2s / 4s.
    const marks = page.getByTestId('marks-interval');
    await expect(marks).toBeVisible();
    const opts = page.getByTestId('marks-interval-option');
    await expect(opts).toHaveCount(4);
    // 1s is the default (data-value="1" is aria-pressed).
    await expect(page.locator('[data-testid="marks-interval-option"][data-value="1"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Toggle to Off.
    await page.locator('[data-testid="marks-interval-option"][data-value="0"]').click();
    await expect(page.locator('[data-testid="marks-interval-option"][data-value="0"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-testid="marks-interval-option"][data-value="1"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Toggle to 4s.
    await page.locator('[data-testid="marks-interval-option"][data-value="4"]').click();
    await expect(page.locator('[data-testid="marks-interval-option"][data-value="4"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Blind-commit contract preserved — no timer, blind commit visible.
    await expect(page.getByTestId('no-timer')).toBeVisible();
    await expect(page.getByTestId('blind-commit')).toBeVisible();

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // SESSION-05 CP4 — per-waypoint plotting + curved (segmented) previewArc
  // -------------------------------------------------------------------------

  test('plots two waypoints at marks=2s, commits a segmented plan, and the ghost path passes {segments} to previewArc', async ({
    page,
  }) => {
    const errors = await mount(page);

    // Default marks interval is 1s → 8 waypoints. Switch to 2s → 4 waypoints
    // (the session example: `2s → dt/2` segments). The screen re-segments
    // every player draft, so the selector appears with 4 labeled options.
    await page.locator('[data-testid="marks-interval-option"][data-value="2"]').click();

    // Waypoint selector: real <button>s, aria-pressed, aria-labels, role=group.
    const selector = page.getByTestId('waypoint-selector');
    await expect(selector).toBeVisible();
    await expect(selector).toHaveAttribute('role', 'group');
    await expect(selector).toHaveAttribute('aria-label', 'Waypoint selector');
    const options = page.getByTestId('waypoint-option');
    await expect(options).toHaveCount(4);
    // Waypoint 0 is active by default (rebuildForInterval snaps activeIndex → 0).
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="0"]'),
    ).toHaveAttribute('aria-pressed', 'true');
    // Every button carries a screen-reader label — never color-alone.
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="0"]'),
    ).toHaveAttribute('aria-label', /Edit waypoint/);
    // Labels use the `t=Ns` cadence — waypoint 0 is `t=0s · LAUNCH`.
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="0"]'),
    ).toContainText('t=0s · LAUNCH');
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="2"]'),
    ).toContainText('t=4s');
    // Keyboard-reachable: the selector is real button elements.
    await page.locator('[data-testid="waypoint-option"][data-index="0"]').focus();
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="0"]'),
    ).toBeFocused();

    // Plot the launch burn (waypoint 0 already active): fill magnitude 20.
    await page.getByTestId('arc-magnitude').fill('20');

    // Now select waypoint 2 (`t=4s`) — the form re-binds to that waypoint.
    await page.locator('[data-testid="waypoint-option"][data-index="2"]').click();
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="2"]'),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('[data-testid="waypoint-option"][data-index="0"]'),
    ).toHaveAttribute('aria-pressed', 'false');

    // The re-bound bearing field reads waypoint 2's aim (aim was preserved from
    // waypoint 0 by rebuildForInterval — bearing 0 — magnitudes reset to 0).
    await expect(page.getByLabel('Bearing in degrees, 0 to 360')).toHaveValue('0');
    await page.getByLabel('Bearing in degrees, 0 to 360').fill('90');
    await page.getByTestId('arc-magnitude').fill('15');

    // The ghost-draw path passes `{ segments }` to controller.previewArc for
    // EVERY plotted arc (S04 seam / CP3). Capture the last call and lock the
    // segmented shape — this is CP4's e2e lock on the CP3 wiring.
    const lastArc = await page.evaluate(() => {
      const entry = (globalThis as Record<string, unknown>)['__lastPreviewArc'] as
        | { readonly bodyId: number; readonly arc: unknown }
        | undefined;
      return entry === undefined ? null : entry;
    });
    expect(lastArc).not.toBeNull();
    expect(lastArc!.arc).not.toBeNull();
    expect(lastArc!.arc).toHaveProperty('segments');
    const segCount = (lastArc!.arc as { segments: readonly unknown[] }).segments.length;
    expect(segCount).toBe(4); // 2s marks → 4 segments over the 8s beat

    // COAST the second player ship so the fleet gate opens.
    await page.locator('[data-testid="roster-ship"][data-ship-id="2"]').click();
    await page.getByRole('button', { name: /Set to Coast/ }).click();

    // COMMIT → the harness captures the segmented payload; assert the shape.
    const commit = page.getByTestId('commit-btn');
    await expect(commit).toBeEnabled();
    await commit.click();
    await expect
      .poll(() => page.evaluate(() => (globalThis as Record<string, unknown>)['__navCalls']))
      .toContainEqual({ name: 'tactical-attack' });

    const commitShape = await page.evaluate(() => {
      const plans = (globalThis as Record<string, unknown>)['__committedPlans'] as
        | ReadonlyArray<{
            readonly bodyId: number;
            readonly segments?: ReadonlyArray<{ readonly deltaV: { x: number; y: number; z: number } }>;
          }>
        | undefined;
      if (plans === undefined) return null;
      return plans.map((p) => ({
        bodyId: p.bodyId,
        segCount: p.segments === undefined ? 0 : p.segments.length,
        nonZeroIndices:
          p.segments === undefined
            ? []
            : p.segments
                .map((s, i) => ({
                  mag: Math.hypot(s.deltaV.x, s.deltaV.y, s.deltaV.z),
                  i,
                }))
                .filter((r) => r.mag > 0)
                .map((r) => r.i),
      }));
    });
    expect(commitShape).not.toBeNull();
    // WIDOWMAKER (bodyId 1) — 4 segments; waypoints 0 and 2 non-zero, 1 and 3 zero.
    const widowmakerPlan = commitShape!.find((p) => p.bodyId === 1);
    expect(widowmakerPlan).toBeDefined();
    expect(widowmakerPlan!.segCount).toBe(4);
    expect(widowmakerPlan!.nonZeroIndices).toEqual([0, 2]);
    // HARRIER-2 (bodyId 2) — coasting: 4 zero segments (segCount == 4 after rebuild).
    const harrierPlan = commitShape!.find((p) => p.bodyId === 2);
    expect(harrierPlan).toBeDefined();
    expect(harrierPlan!.segCount).toBe(4);
    expect(harrierPlan!.nonZeroIndices).toEqual([]);

    expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
