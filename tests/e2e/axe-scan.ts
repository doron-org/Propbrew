import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

const wcag21AATags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function scanPageForWcag21AA(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
  // Do not measure contrast partway through the shell's 220 ms entry fade.
  // Infinite status animations are irrelevant; network idle lets finite entry
  // animations and hydration settle without disabling any axe rule.
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(wcag21AATags).analyze();
  const finding = ({ id, impact, description, help, helpUrl, nodes }: (typeof results.violations)[number]) => ({
    id,
    impact,
    description,
    help,
    helpUrl,
    nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })),
  });
  const violations = results.violations.map(finding);
  await testInfo.attach(`axe-${surface}`, {
    contentType: 'application/json',
    body: JSON.stringify({
      surface,
      url: results.url,
      timestamp: results.timestamp,
      testEngine: results.testEngine,
      testRunner: results.testRunner,
      testEnvironment: results.testEnvironment,
      tags: wcag21AATags,
      passes: results.passes.length,
      incomplete: results.incomplete.map(finding),
      violations,
    }, null, 2),
  });
  expect(violations, `${surface} must have no automatically detectable WCAG 2.1 A/AA violations`).toEqual([]);
}
