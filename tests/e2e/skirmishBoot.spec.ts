// tests/e2e/skirmishBoot.spec.ts — served-app skirmish-route boot smoke (S01 CP5).
//
// Verifies the four `#/skirmish*` routes mount without an uncaught error:
//   1. `#/skirmish` mounts the setup placeholder (`screen-skirmish-setup`).
//   2. Each `#/skirmish/*` hash resolves — with no active match the three
//      in-match routes redirect to setup (the active match lives on
//      `AppServices.activeMatch`, not the URL), so the setup placeholder
//      renders either way. No crash, no MatchProvider mounted without a value.
//   3. The SKIRMISH topbar nav lands on setup.
//
// Chromium-only (like `appBoot.spec.ts`): this is a functional UI smoke, not a
// cross-engine determinism check. Reuses the shared Playwright webServer@8081.

import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const APP_URL = 'http://localhost:8081/starship-skirmish/';

// Known benign browser advisories from PRE-EXISTING infrastructure (see
// appBoot.spec.ts): the CSP-via-meta warning and the pending `/fonts/*.woff2`
// 404s. A regression in shell/screen code produces console errors NOT matching
// these patterns — the test fails on those.
const KNOWN_BENIGN_CONSOLE_MESSAGES: readonly RegExp[] = [
  /frame-ancestors.*ignored.*<meta>/i,
  /Failed to load resource.*404.*(Not Found)?/i,
];

const isBenignConsoleError = (text: string): boolean =>
  KNOWN_BENIGN_CONSOLE_MESSAGES.some((pattern) => pattern.test(text));

test.describe('skirmish boot smoke', () => {
  test('mounts the setup placeholder at #/skirmish without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      consoleErrors.push(text);
    });

    await page.goto(`${APP_URL}#/skirmish`);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('the four skirmish routes resolve without crashing', async ({ page }) => {
    for (const hash of ['#/skirmish', '#/skirmish/move', '#/skirmish/attack', '#/skirmish/result']) {
      await page.goto(`${APP_URL}${hash}`);
      // No active match → the in-match routes redirect to setup; setup renders.
      await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
    }
  });

  test('SKIRMISH topbar nav lands on setup', async ({ page }) => {
    await page.goto(APP_URL);
    await page.getByRole('link', { name: 'SKIRMISH' }).click();
    await expect(page.getByTestId('screen-skirmish-setup')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/skirmish');
  });
});
