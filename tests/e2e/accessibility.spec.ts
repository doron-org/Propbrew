import { expect, test } from '@playwright/test';
import { scanPageForWcag21AA as scan } from './axe-scan';

test.describe('WCAG 2.1 A/AA release scans', () => {
  // Cold Next.js development compilation can exceed the ordinary browser smoke
  // timeout. Axe still waits for the visible application surface before scanning.
  test.setTimeout(120_000);

  for (const [surface, route] of [
    ['workspace-chooser', '/workspaces'],
    ['estate-shell', '/estate'],
    ['facility-shell', '/facility'],
    ['shortlet-shell', '/shortlet'],
    ['construction-shell', '/construction'],
  ] as const) {
    test(surface, async ({ page }, testInfo) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
      await scan(page, testInfo, surface);
    });
  }

  test('estate-add-property-dialog', async ({ page }, testInfo) => {
    await page.goto('/estate', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add property', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add property', exact: true })).toBeVisible();
    await scan(page, testInfo, 'estate-add-property-dialog');
  });
});
