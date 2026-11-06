import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const passphrase = 'Disposable browser account passphrase 2026!';

async function createAccount(page: Page, name: string, email: string, company?: string) {
  await page.getByLabel('Your full name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  if (company) await page.getByLabel('Company name', { exact: true }).fill(company);
  await page.getByLabel('Password', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: company ? 'Create account & company' : 'Create account & join', exact: true }).click();
  if (company) {
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole('link', { name: 'Set up later', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole('heading', { name: 'Choose your workspace', exact: true })).toBeVisible();
}

test('native signup, all four portals, property and tenant save, logout and login preserve company records', async ({ page }) => {
  const id = randomUUID().slice(0, 8);
  const email = `owner-${id}@example.test`, property = `Browser property ${id}`, tenant = `Browser resident ${id}`;
  await page.goto('/sign-up');
  await createAccount(page, 'Disposable Lagos Owner', email, `Browser company ${id}`);
  for (const workspace of ['Estate', 'Facility', 'Shortlet', 'Construction']) await expect(page.getByRole('link', { name: `Enter ${workspace} workspace`, exact: true })).toBeVisible();
  for (const workspace of ['Facility', 'Shortlet', 'Construction']) {
    await page.getByRole('link', { name: `Enter ${workspace} workspace`, exact: true }).click();
    await expect(page.getByRole('navigation', { name: `${workspace} navigation`, exact: true })).toBeVisible();
    await page.goto('/workspaces');
  }
  await page.getByRole('link', { name: 'Enter Estate workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  const propertyDialog = page.getByRole('dialog', { name: 'Add property', exact: true });
  await propertyDialog.getByLabel('Property name', { exact: true }).fill(property);
  await propertyDialog.getByLabel('Property address', { exact: true }).fill('14 Disposable Integration Way, Lagos, Nigeria');
  await propertyDialog.getByLabel('Number of units', { exact: true }).fill('2');
  await propertyDialog.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(propertyDialog.getByRole('heading', { name: 'Property added', exact: true })).toBeVisible();
  await expect(propertyDialog).toContainText('This record is saved to the database.');
  await propertyDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add tenant', exact: true }).click();
  const tenantDialog = page.getByRole('dialog', { name: 'Add tenant', exact: true });
  await tenantDialog.getByLabel('Tenant full name', { exact: true }).fill(tenant);
  const unit = tenantDialog.getByRole('combobox', { name: 'Property and unit', exact: true });
  await unit.selectOption({ label: `${property} · Unit 1` });
  await tenantDialog.getByLabel('Move-in date', { exact: true }).fill('2026-01-01');
  await tenantDialog.getByRole('button', { name: 'Add tenant', exact: true }).click();
  await expect(tenantDialog.getByRole('heading', { name: 'Tenant record added', exact: true })).toBeVisible();
  await tenantDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('/companies');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/properties');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.getByRole('button', { name: 'Open company', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
  await page.goto('/properties');
  await expect(page.getByRole('table', { name: 'Property list', exact: true })).toContainText(property);
  await page.goto('/people');
  await expect(page.getByRole('tabpanel', { name: /^Directory(?: \d+)?$/ }).getByText(tenant, { exact: true })).toBeVisible();
});

test('a private invitation creates a teammate account in the existing company with view-only access', async ({ page, browser }) => {
  const id = randomUUID().slice(0, 8);
  const company = `Inviting company ${id}`, email = `invited-${id}@example.test`;
  await page.goto('/sign-up');
  await createAccount(page, 'Disposable Abuja Owner', `inviter-${id}@example.test`, company);
  await page.getByRole('link', { name: 'Team & access', exact: true }).click();
  await page.getByRole('button', { name: 'Invite teammate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Invite a teammate to ${company}`, exact: true });
  await dialog.getByLabel('Teammate email address', { exact: true }).fill(email);
  // Members require an operational user type; the auditor profile is the
  // read-only Estate view this scenario asserts.
  await dialog.getByRole('combobox', { name: 'User type', exact: true }).selectOption('auditor');
  await dialog.getByRole('button', { name: 'Create invitation link', exact: true }).click();
  const invite = dialog.getByLabel('Private invitation link', { exact: true });
  await expect(invite).toBeVisible();
  const inviteUrl = await invite.inputValue();
  const teammateContext = await browser.newContext({ baseURL: new URL(inviteUrl).origin });
  try {
    const teammate = await teammateContext.newPage();
    await teammate.goto(inviteUrl);
    await teammate.getByRole('link', { name: 'Create an account', exact: true }).click();
    await createAccount(teammate, 'Disposable Estate Viewer', email);
    await expect(teammate.getByRole('link', { name: 'Enter Estate workspace', exact: true })).toBeVisible();
    for (const workspace of ['Facility', 'Shortlet', 'Construction']) await expect(teammate.getByRole('link', { name: `Enter ${workspace} workspace`, exact: true })).toHaveCount(0);
    await teammate.getByRole('link', { name: 'Enter Estate workspace', exact: true }).click();
    await expect(teammate.getByRole('button', { name: 'Add property', exact: true })).toHaveCount(0);
    await expect(teammate.getByRole('button', { name: 'Add tenant', exact: true })).toHaveCount(0);
    await teammate.goto('/construction');
    // Next may stream its outer response before the async page denies access.
    await expect(teammate.getByRole('heading', { name: 'That page is not available', exact: true })).toBeVisible();
    await expect(teammate.getByRole('navigation', { name: 'Construction navigation', exact: true })).toHaveCount(0);
    await teammate.goto('/companies');
    await expect(teammate.getByRole('heading', { name: company, exact: true })).toBeVisible();
    await expect(teammate.getByRole('heading', { level: 2 })).toHaveCount(1);
  } finally { await teammateContext.close(); }
});
