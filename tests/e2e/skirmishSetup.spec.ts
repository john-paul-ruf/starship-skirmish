// tests/e2e/skirmishSetup.spec.ts — Skirmish Setup flow smoke (S04 CP3).
//
// Chromium-only (the S03 UI-smoke pattern — cross-engine determinism lives in
// the sim/harness specs). Reuses the shared Playwright webServer@8081.
//
// What this covers (S04 CP3 gate):
//   1. Seed a legal build into the Encyclopedia (localStorage + reload), draft
//      it, keep the default single opponent, and LAUNCH → the controller
//      navigates to `#/skirmish/move`.
//   2. An over-budget draft leaves LAUNCH disabled and the button explains
//      itself (design §4.3): its label carries `OVER BUDGET`.

import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const APP_URL = 'http://localhost:8081/starship-skirmish/';

interface SeedBuild {
  readonly id: string;
  readonly name: string;
  readonly chassisId: string;
  readonly slots: readonly (string | null)[];
  readonly tags: readonly string[];
  readonly storedCost: number;
}

// A bare NEEDLE fighter (all slots empty — a legal fit, FR-4) and a bare
// MERIDIAN cruiser. The cruiser alone busts the 25-pt budget, giving the
// over-budget assertion a real path.
const SEED_BUILDS: readonly SeedBuild[] = [
  {
    id: '00000000-0000-4000-8000-000000000401',
    name: 'PIN',
    chassisId: 'fig-needle',
    slots: [null, null, null],
    tags: [],
    storedCost: 4,
  },
  {
    id: '00000000-0000-4000-8000-000000000402',
    name: 'SLAB',
    chassisId: 'cru-meridian',
    slots: [null, null, null, null, null, null, null, null, null],
    tags: [],
    storedCost: 38,
  },
];

const seedLibraryAndReload = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  await page.evaluate((builds) => {
    const now = new Date().toISOString();
    for (const b of builds) {
      const record = { ...b, schemaVersion: 1, catalogVersion: 1, createdAt: now, updatedAt: now };
      window.localStorage.setItem(
        `starship-skirmish:build:${b.id}`,
        JSON.stringify(record),
      );
    }
    window.localStorage.removeItem('starship-skirmish:index');
  }, SEED_BUILDS as unknown as SeedBuild[]);
  await page.reload();
};

test.describe('skirmish setup — draft, launch, over-budget gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await seedLibraryAndReload(page);
    await page.goto(`${APP_URL}#/skirmish`);
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
  });

  test('draft a legal ship, keep 1 bot, LAUNCH lands on the movement route', async ({ page }) => {
    // Default budget is 100; the 4-pt NEEDLE is affordable.
    await page.getByRole('button', { name: /Add PIN to your fleet/ }).click();
    await expect(page.getByTestId('draft-total')).toHaveText('4');

    const launch = page.getByTestId('launch-btn');
    await expect(launch).toBeEnabled();
    await launch.click();

    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe('#/skirmish/move');
  });

  test('over-budget draft disables LAUNCH with an explanatory reason', async ({ page }) => {
    // Draft the 38-pt cruiser at the default 100-pt budget (affordable there),
    // then drop to the 25-pt budget → 38 / 25 = over. A budget change never
    // removes drafted ships, so the fleet is now over budget.
    await page.getByRole('button', { name: /Add SLAB to your fleet/ }).click();
    await expect(page.getByTestId('draft-total')).toHaveText('38');
    await page.getByTestId('budget-seg').getByRole('button', { name: '25', exact: true }).click();

    const launch = page.getByTestId('launch-btn');
    await expect(launch).toBeDisabled();
    await expect(launch).toHaveText(/OVER BUDGET/);
  });
});
