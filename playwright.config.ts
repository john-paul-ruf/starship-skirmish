// playwright.config.ts — cross-engine determinism harness (architecture §7.5 row 4,
// FR-33). Chromium / Firefox / WebKit each load a data-URL-style page whose contents
// are constructed inside `tests/e2e/determinism.spec.ts` (esbuild bundles the
// scenario runner + digest in-process; the spec injects the bundle via
// `page.setContent()`). No web server is required for this spec — the code under
// test is a pure ES module graph, so an inline `<script>` is the tightest test rig.
//
// Three engines agreeing with Node is what substantiates "identical on every
// machine" (architecture §7.5). No other test in the repo can claim that.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // serial: keeps failure logs sequential across engines
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  timeout: 60_000, // esbuild bundle + first-page load can take ~5s cold on WebKit
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
