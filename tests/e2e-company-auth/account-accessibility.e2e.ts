import { expect, test } from '@playwright/test';
import { scanPageForWcag21AA } from '../e2e/axe-scan';

test.describe('Company account WCAG 2.1 A/AA release scans', () => {
  for (const [surface, route, heading] of [
    ['company-sign-in', '/login', 'Welcome back'],
    ['company-sign-up', '/sign-up', 'Start your company workspace'],
  ] as const) {
    test(surface, async ({ page }, testInfo) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await scanPageForWcag21AA(page, testInfo, surface);
    });
  }
});
