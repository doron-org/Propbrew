import { test, expect, type Locator } from '@playwright/test';

/** Retry only a reversible display preference after the client header portal
 * is mounted. Saves and operational mutations are never repeated here. */
async function selectPropertyView(button: Locator): Promise<void> {
  const headerTabs = button.page().locator('[data-page-tabs-outlet="true"] [data-header-page-tabs="true"][role="tablist"]').first();
  await expect(headerTabs).toBeVisible({ timeout: 10_000 });
  await expect(async () => {
    if (await button.getAttribute('aria-pressed', { timeout: 1_000 }) === 'true') return;
    await button.click({ timeout: 2_000 });
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 10_000, intervals: [200, 500, 1000] });
}

test('legacy dashboard opens the workspace chooser', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/dashboard');
  // The first development request compiles both routes before its redirect completes.
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Choose your workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enter Estate workspace', exact: true })).toHaveAttribute('href', '/estate');
});

test('Estate overview includes portfolio operations and currency-specific empty states', async ({ page }) => {
  await page.goto('/estate');
  // Tabs enter the shell header after hydration; interact with that ready surface
  // again after submitting the currency form triggers a full page navigation.
  const tabs = page.getByRole('banner').getByRole('tablist', { name: 'Estate overview sections', exact: true });
  await expect(page.getByRole('button', { name: 'Add property', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Analytics snapshot', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Occupancy rate', exact: true })).toContainText('registered units');
  await tabs.getByRole('tab', { name: 'Collections', exact: true }).click();
  for (const section of ['Collection trends', 'Portfolio pulse']) await expect(page.getByRole('region', { name: section, exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Property performance', exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Maintenance', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Maintenance summary', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Display currency', exact: true }).selectOption('USD');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/\/estate\?currency=USD$/);
  await expect(page.getByRole('article', { name: 'Charges collected', exact: true })).not.toContainText('₦');
  await tabs.getByRole('tab', { name: 'Collections', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Collection trends', exact: true })).toContainText('USD');
});

test('Estate creation actions open accessible dialogs and can be cancelled', async ({ page }) => {
  await page.goto('/estate');
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add property', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Add tenant', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add tenant', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('Estate Properties supports list/grid views, unit details and navigation order', async ({ page }) => {
  await page.goto('/properties');
  const nav = page.getByRole('navigation', { name: 'Estate navigation', exact: true });
  const firstLinks = await nav.getByRole('link').evaluateAll((links) => links.slice(0, 3).map((link) => link.getAttribute('href')));
  expect(firstLinks).toEqual(['/estate', '/properties']);
  await expect(page.getByRole('table', { name: 'Property list', exact: true })).toBeVisible();
  await selectPropertyView(page.getByRole('button', { name: 'Grid view', exact: true }));
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table', { name: 'Property list', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Occupancy summary', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Property register summary', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Properties(?: \d+)?$/ }).click();
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The unit register button only exists on list rows; grid cards link to the property page instead.
  await selectPropertyView(page.getByRole('button', { name: 'List view', exact: true }));
  await expect(page.getByRole('table', { name: 'Property list', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View units at Lekki Gardens Estate', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Lekki Gardens Estate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close property details', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search properties', exact: true }).fill('no matching property sample');
  await expect(page.getByRole('heading', { name: 'No properties match these filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await selectPropertyView(page.getByRole('button', { name: 'List view', exact: true }));
  await expect(page.getByRole('table', { name: 'Property list', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add property', exact: true })).toBeVisible();
});

for (const workspace of ['Estate', 'Facility', 'Shortlet', 'Construction']) {
  test(`${workspace} opens a dedicated portal and returns to the chooser`, async ({ page }) => {
    const id = workspace.toLowerCase();
    await page.goto('/workspaces');
    await page.getByRole('link', { name: `Enter ${workspace} workspace`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${id}$`));
    await expect(page.getByRole('navigation', { name: `${workspace} navigation`, exact: true })).toBeVisible();
    for (const other of ['Estate', 'Facility', 'Shortlet', 'Construction'].filter((name) => name !== workspace)) {
      await expect(page.getByRole('navigation', { name: `${other} navigation`, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('link', { name: `Switch workspace, current ${workspace}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces\\?from=${id}$`));
    await expect(page.getByRole('heading', { name: 'Choose your workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: workspace, exact: true })).toContainText('Current view');
  });
}

test('health endpoint is public and returns JSON', async ({ request }) => {
  const response = await request.get('/api/v1/health');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).ok).toBe(true);
});

test('sync endpoint rejects missing idempotency keys', async ({ request }) => {
  const response = await request.post('/api/v1/sync', { data: { op: 'work-orders.list' } });
  expect(response.status()).toBe(400);
});
