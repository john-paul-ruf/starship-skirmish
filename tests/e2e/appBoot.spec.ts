// tests/e2e/appBoot.spec.ts — served-app boot smoke (S03, checkpoint 4).
//
// The first spec in the repo that hits `webServer.url` — a running Vite dev
// server serving the composition root (`src/app`) + shell + placeholder
// screens. Verifies:
//   1. The topbar renders after boot (data-testid="app-shell" mounts).
//   2. Clicking a Topbar nav item swaps the outlet to the corresponding
//      placeholder screen and updates `location.hash`.
//   3. A `#/share?t=<token>` deep-link mounts the ShareImport screen with
//      the token surfaced (verifies bootstrap's initial-hash pipeline).
//
// Chromium-only (`test.skip` on other browsers): the pre-existing
// cross-engine determinism specs need Chromium + Firefox + WebKit; this UI
// smoke is a functional test, not a determinism check. Running it on all
// three would double e2e wall-clock for zero signal.

import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const APP_URL = 'http://localhost:8081/starship-skirmish/';

// Known benign browser advisories from PRE-EXISTING infrastructure — outside
// this session's lease and reported to Forge in the S01 handoff (font drop
// pending) + M01 (index.html CSP meta-tag delivery).
//
//   - `frame-ancestors ignored via <meta>`: index.html delivers CSP via meta;
//     `frame-ancestors` needs an HTTP header (M01 territory).
//   - `Failed to load resource ... 404`: the four `/fonts/*.woff2` binaries
//     are a content drop still pending (S01 handoff). The @font-face
//     fallback stack keeps the app functional.
//
// A regression in shell/screen code produces console errors NOT matching
// these patterns — the test fails on those.
const KNOWN_BENIGN_CONSOLE_MESSAGES: readonly RegExp[] = [
  /frame-ancestors.*ignored.*<meta>/i,
  /Failed to load resource.*404.*(Not Found)?/i,
];

const isBenignConsoleError = (text: string): boolean =>
  KNOWN_BENIGN_CONSOLE_MESSAGES.some((pattern) => pattern.test(text));

test.describe('app boot smoke', () => {
  test('mounts the shell without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      consoleErrors.push(text);
    });

    await page.goto(APP_URL);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    // Encyclopedia is the default route.
    await expect(page.getByTestId('screen-encyclopedia')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('topbar nav swaps the outlet and updates location.hash', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId('screen-encyclopedia')).toBeVisible();

    // Click SHIPYARD in the topbar.
    await page.getByRole('link', { name: 'SHIPYARD' }).click();
    await expect(page.getByTestId('screen-shipyard')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/shipyard');

    // And back to ENCYCLOPEDIA.
    await page.getByRole('link', { name: 'ENCYCLOPEDIA' }).click();
    await expect(page.getByTestId('screen-encyclopedia')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe('#/encyclopedia');
  });

  test('#/share?t=<token> deep-link mounts ShareImport with the token', async ({ page }) => {
    await page.goto(`${APP_URL}#/share?t=BASE64PAYLOAD`);
    await expect(page.getByTestId('screen-share')).toBeVisible();
    await expect(page.getByTestId('share-token')).toContainText('BASE64PAYLOAD');
  });
});
