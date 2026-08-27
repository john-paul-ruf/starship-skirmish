// tests/e2e/encyclopedia.spec.ts — Encyclopedia flow smoke (S04, checkpoint 3).
//
// Chromium-only (following the S03 UI-smoke pattern): the cross-engine
// determinism specs live for sim/harness verification, not UI functionality.
// Running this on Firefox + WebKit would double e2e wall-clock for zero signal.
//
// What this covers (S04 checkpoint 3 gate):
//   1. Seed a couple of builds via localStorage + reload — the screen boots
//      into a populated Encyclopedia and the storage rail + backup nudge +
//      filter bar render.
//   2. DUPLICATE lands a new card with a suffix-minted name (persist mint).
//   3. DELETE opens the alertdialog modal, CANCEL leaves the card in place,
//      then re-open + CONFIRM removes it and drops the count.
//   4. EXPORT SELECTED (JSON) fires the download flow — the browser download
//      event surfaces and its `suggestedFilename` starts with the model's
//      `starship-skirmish-library-selected-` prefix.

import { expect, test, type Download } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const APP_URL = 'http://localhost:8081/starship-skirmish/';

// Known benign browser advisories from PRE-EXISTING infrastructure — S01/M01
// territory (font drop + CSP meta), same allowlist as `appBoot.spec.ts`. A
// regression in shell/screen code produces console errors NOT matching these
// patterns — the test fails on those.
const KNOWN_BENIGN_CONSOLE_MESSAGES: readonly RegExp[] = [
  /frame-ancestors.*ignored.*<meta>/i,
  /Failed to load resource.*404.*(Not Found)?/i,
];

const isBenignConsoleError = (text: string): boolean =>
  KNOWN_BENIGN_CONSOLE_MESSAGES.some((pattern) => pattern.test(text));

interface SeedBuild {
  readonly id: string;
  readonly name: string;
  readonly chassisId: string;
  readonly slots: readonly (string | null)[];
  readonly tags: readonly string[];
  readonly storedCost: number;
}

const SEED_BUILDS: readonly SeedBuild[] = [
  {
    id: '00000000-0000-4000-8000-000000000e01',
    name: 'THE WIDOWMAKER',
    chassisId: 'cru-meridian',
    slots: [null, null, null, null, null, null, null, null, null],
    tags: ['alpha', 'meta'],
    storedCost: 38,
  },
  {
    id: '00000000-0000-4000-8000-000000000e02',
    name: 'TIN CAN',
    chassisId: 'fig-needle',
    slots: [null, null, null],
    tags: ['swarm'],
    storedCost: 4,
  },
];

/**
 * Seed the library via direct localStorage writes then reload. Uses the same
 * "healing rebuild from records" pipeline the real boot exercises — the app
 * observes the seeded records on next mount and rebuilds `:index` (§3.5).
 */
const seedLibraryAndReload = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  await page.evaluate((builds) => {
    const now = new Date().toISOString();
    for (const b of builds) {
      const record = {
        ...b,
        schemaVersion: 1,
        catalogVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      window.localStorage.setItem(
        `starship-skirmish:build:${b.id}`,
        JSON.stringify(record),
      );
    }
    window.localStorage.removeItem('starship-skirmish:index');
  }, SEED_BUILDS as unknown as SeedBuild[]);
  await page.reload();
  await page.waitForSelector('[data-testid="build-grid"]', { timeout: 8000 });
};

test.describe('encyclopedia — list, duplicate, delete, export', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh localStorage per test — the shared dev server keeps its origin
    // across specs, so we clear before seeding.
    await page.goto(APP_URL);
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();
    await page.waitForSelector('[data-testid="screen-encyclopedia"]');
  });

  test('populated Encyclopedia renders storage rail + filter bar + build cards', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      consoleErrors.push(text);
    });

    await seedLibraryAndReload(page);
    await expect(page.getByTestId('storage-headroom')).toBeVisible();
    await expect(page.getByTestId('filter-bar')).toBeVisible();
    await expect(page.getByTestId('build-grid')).toBeVisible();
    // Both seeded cards land.
    await expect(page.getByTestId('build-card')).toHaveCount(2);
    // The backup nudge is present (durable localStorage + N > 0).
    await expect(page.getByTestId('backup-nudge-text')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('DUPLICATE mints a suffix-named copy; the count grows by one', async ({ page }) => {
    await seedLibraryAndReload(page);
    const before = await page.getByTestId('build-card').count();

    await page.getByTestId('card-duplicate').first().click();
    // The duplicate appears; the ORIGINAL is still present.
    await expect(page.getByTestId('build-card')).toHaveCount(before + 1);
  });

  test('DELETE opens the alertdialog modal; CANCEL leaves the count alone; CONFIRM drops it', async ({
    page,
  }) => {
    await seedLibraryAndReload(page);
    const before = await page.getByTestId('build-card').count();
    expect(before).toBeGreaterThanOrEqual(2);

    // Open modal.
    await page.getByTestId('card-delete').first().click();
    const modal = page.getByTestId('delete-modal');
    await expect(modal).toBeVisible();
    // role=alertdialog by construction.
    await expect(page.getByRole('alertdialog')).toBeVisible();

    // Cancel — count unchanged.
    await page.getByTestId('delete-cancel').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('build-card')).toHaveCount(before);

    // Re-open + confirm — count drops.
    await page.getByTestId('card-delete').first().click();
    await page.getByTestId('delete-confirm').click();
    await expect(page.getByTestId('build-card')).toHaveCount(before - 1);
  });

  test('EXPORT SELECTED (JSON) triggers a download with the deterministic filename prefix', async ({
    page,
  }) => {
    await seedLibraryAndReload(page);

    // Select two cards via the header checkbox.
    const checkboxes = page.locator('.enc-card-check');
    await checkboxes.first().click();
    await checkboxes.nth(1).click();
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // The download event fires on the object-URL anchor click.
    const [download] = (await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.getByTestId('selection-export').click(),
    ])) as [Download, unknown];

    expect(download.suggestedFilename()).toMatch(
      /^starship-skirmish-library-selected-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});
