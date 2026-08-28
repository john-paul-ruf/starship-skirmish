// tests/e2e/shipyard.spec.ts — served-app smoke for the Shipyard (S05 CP4).
//
// Chromium-only functional smoke (design §7.5 reserves cross-engine e2e for
// the sim/harness determinism specs). Verifies Flow 1 (design §5):
//   pick chassis → fit component → the point total moves → save → land on
//   Encyclopedia.
//
// Uses the shared webServer on 8081 configured by S03 (`playwright.config.ts`).
// Do NOT change the port — S04/S06 run concurrently against the same server.
// Reuses the same benign-console-message allowlist S03 established for the
// font-drop + CSP meta-tag advisories.

import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'UI smoke: chromium only');

const APP_URL = 'http://localhost:8081/starship-skirmish/';

const KNOWN_BENIGN_CONSOLE_MESSAGES: readonly RegExp[] = [
  /frame-ancestors.*ignored.*<meta>/i,
  /Failed to load resource.*404.*(Not Found)?/i,
];
const isBenignConsoleError = (text: string): boolean =>
  KNOWN_BENIGN_CONSOLE_MESSAGES.some((pattern) => pattern.test(text));

test.describe('shipyard — Flow 1 (design §5)', () => {
  test('pick chassis → fit → cost moves → save → lands on Encyclopedia', async ({ page, context }) => {
    // Grant clipboard so the share-link path (used in CP4 pixel work) doesn't
    // trip on missing permissions in a headless run. Save flow itself does
    // not use the clipboard; this is a defensive future-proof.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:8081',
    });

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      consoleErrors.push(text);
    });

    await page.goto(`${APP_URL}#/shipyard`);
    await expect(page.getByTestId('screen-shipyard')).toBeVisible();
    await expect(page.getByTestId('shipyard-bench-empty')).toBeVisible();

    // Pick the MERIDIAN cruiser.
    await page.getByTestId('shipyard-chassis-cru-meridian').click();
    await expect(page.getByTestId('shipyard-bench-empty')).toHaveCount(0);
    // The bench mounts — the sticky total shows the chassis point cost.
    const total = page.getByTestId('shipyard-point-total');
    const chassisCostText = await total.textContent();
    expect(chassisCostText).not.toBe('—');
    const chassisCost = Number(chassisCostText);
    expect(chassisCost).toBeGreaterThan(0);

    // The build id short-form is visible (identity was minted at the UI boundary).
    const buildIdShort = await page.getByTestId('shipyard-build-id').textContent();
    expect(buildIdShort?.length).toBeGreaterThanOrEqual(8);

    // Select the W1 bay → the WEAPON tab auto-activates in the catalog column.
    await page.getByTestId('shipyard-bay-W1').click();
    // The first weapon in the list is picked. `componentsForSlot` returns
    // weapons ordered by ordinal (catalog v1 lock), so this id is stable
    // across catalog v1.
    const weaponRows = page.locator('[data-testid="shipyard-component-wpn-pulse-array"]');
    await expect(weaponRows.first()).toBeVisible();

    // Playtest-feedback-03 · S03: the row carries an accessible info
    // affordance AND a differentiator tag so items read apart without
    // relying on the shared SlotTag glyph. Best-effort — a green here
    // proves both playtest asks landed on the picker.
    const firstRowTipPop = page.locator('#tip-wpn-pulse-array');
    await expect(firstRowTipPop).toHaveAttribute('role', 'tooltip');
    await expect(firstRowTipPop).not.toHaveText('');
    await expect(
      page.getByTestId('shipyard-component-wpn-pulse-array-tag'),
    ).toBeVisible();

    await weaponRows.first().click();

    // The point total moved (chassis + first weapon).
    await expect
      .poll(async () => Number(await total.textContent()))
      .toBeGreaterThan(chassisCost);

    // "✓ VALID FIT" chip is present on a legal fit.
    await expect(page.getByTestId('shipyard-validation-badge')).toContainText('VALID FIT');

    // Rename via the SaveBar and click SAVE.
    await page.locator('#shipyard-savebar-name').fill('CRUISER-E2E-A');
    // The name field runs through io.normalizeName on save; we use a straight
    // ASCII string here so no NFC transform is needed.
    await page.getByTestId('shipyard-save-button').click();

    // Save toast surfaces AND the outlet swaps to Encyclopedia (Flow 1 finale).
    await expect(page.getByTestId('screen-encyclopedia')).toBeVisible({ timeout: 5_000 });
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
