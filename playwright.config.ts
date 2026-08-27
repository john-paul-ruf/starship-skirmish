// playwright.config.ts — cross-engine determinism harness (architecture §7.5 row 4,
// FR-33) + served-app e2e (S03+).
//
// Two spec families share this config:
//
//   1. `tests/e2e/{determinism,combatDeterminism,harnessMatchDeterminism}.spec.ts`
//      — cross-engine sim/harness determinism. Each loads a
//      `page.setContent()`-injected esbuild bundle; NO dev server is required
//      for these specs, and adding a `webServer` block is harmless to them
//      (they never hit its URL).
//
//   2. `tests/e2e/appBoot.spec.ts` and forward (S04–S06) — served-app smokes.
//      These specs hit `webServer.url` and depend on Vite dev running.
//
// The webServer runs on port 8081 (this session's orchestration-envelope port
// assignment). `reuseExistingServer: !CI` means SESSION-04/05/06 — which run
// their e2e in the same Wave 3 concurrently — SHARE this one dev server. If
// each session spun up its own server on a random port, Wave 3 would spawn
// three parallel Vite processes and race for the port; with reuse + a fixed
// 8081 they cooperate on one server. On CI (a clean container per matrix job)
// reuse is off — the workflow starts fresh every time.
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
  webServer: {
    command: 'npm run dev -- --port 8081',
    url: 'http://localhost:8081/starship-skirmish/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
