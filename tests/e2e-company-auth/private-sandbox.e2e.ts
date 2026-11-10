import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openDialog } from './dialog';

async function enterEstate(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Explore demo:.*Estate/ }).click();
  await expect(page).toHaveURL(/\/estate$/);
  await expect(page.getByRole('complementary', { name: 'Demo account notice' })).toHaveCount(0);
}
async function addProperty(page: Page, name: string) {
  await page.goto('/estate');
  const dialog = page.getByRole('dialog', { name: 'Add property', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add property', exact: true }), dialog);
  await dialog.getByLabel('Property name', { exact: true }).fill(name);
  await dialog.getByLabel('Property address', { exact: true }).fill('Synthetic test address, Lagos');
  await dialog.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Property added', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}
async function companyId(page: Page) {
  const response = await page.request.get('/api/companies'); expect(response.status()).toBe(200);
  const data = await response.json(); expect(data.companies).toHaveLength(1);
  return data.companies[0].id as string;
}

test('two visitors using the same demo login keep independent edits isolated from another demo and a real company', async ({ page, browser }) => {
  const secondContext = await browser.newContext({ baseURL: process.env.PW_COMPANY_BASE_URL });
  const customerContext = await browser.newContext({ baseURL: process.env.PW_COMPANY_BASE_URL });
  const second = await secondContext.newPage(), customer = await customerContext.newPage();
  const id = randomUUID().slice(0, 8), firstName = `Visitor A ${id}`, secondName = `Visitor B ${id}`, customerName = `Customer ${id}`;
  try {
    await enterEstate(page); await addProperty(page, firstName);
    await enterEstate(second); await addProperty(second, secondName);
    await customer.goto('/sign-up');
    await customer.getByLabel('Your full name', { exact: true }).fill('Disposable customer owner');
    await customer.getByLabel('Email address', { exact: true }).fill(`sandbox-customer-${id}@example.test`);
    await customer.getByLabel('Company name', { exact: true }).fill(`Real account isolation ${id}`);
    await customer.getByLabel('Password', { exact: true }).fill('Disposable sandbox browser test passphrase!');
    await customer.getByRole('button', { name: 'Create account & company', exact: true }).click();
    await expect(customer).toHaveURL(/\/onboarding$/);
    await customer.getByRole('link', { name: 'Set up later', exact: true }).click();
    await expect(customer).toHaveURL(/\/workspaces$/); await addProperty(customer, customerName);
    const a = await companyId(page), b = await companyId(second), c = await companyId(customer);
    expect(new Set([a, b, c]).size).toBe(3);
    for (const foreign of [b, c]) expect((await page.request.post('/api/companies/select', { data: { companyId: foreign }, headers: { Origin: process.env.PW_COMPANY_BASE_URL! } })).status()).toBe(404);
    expect((await customer.request.post('/api/companies/select', { data: { companyId: a }, headers: { Origin: process.env.PW_COMPANY_BASE_URL! } })).status()).toBe(404);
    await page.goto('/construction'); await page.goto('/properties');
    const firstTable = page.getByRole('table', { name: 'Property list', exact: true });
    await expect(firstTable).toContainText(firstName); await expect(firstTable).not.toContainText(secondName); await expect(firstTable).not.toContainText(customerName);
    await page.reload(); await expect(firstTable).toContainText(firstName);
    await expect(page.getByRole('complementary', { name: 'Demo account notice' })).toHaveCount(0);
    await expect(firstTable).toContainText(firstName); await expect(firstTable).toContainText('Lekki Gardens Estate');
    await second.goto('/properties'); await second.reload();
    await expect(second.getByRole('table', { name: 'Property list', exact: true })).toContainText(secondName);
    await expect(second.getByRole('table', { name: 'Property list', exact: true })).not.toContainText(firstName);
    await customer.goto('/properties'); await customer.reload();
    await expect(customer.getByRole('table', { name: 'Property list', exact: true })).toContainText(customerName);
    await expect(customer.getByRole('table', { name: 'Property list', exact: true })).not.toContainText('Lekki Gardens Estate');
  } finally { await secondContext.close(); await customerContext.close(); }
});

test('private construction sandbox mobilises a project through WBS, programme, BOQ, team and lifecycle controls', async ({ page }) => {
  const id = randomUUID().slice(0, 8), name = `Sandbox build ${id}`, updated = `${name} edited`;
  await page.goto('/login'); await page.getByRole('button', { name: /Explore demo:.*Construction/ }).click();
  await expect(page).toHaveURL(/\/construction$/); await page.goto('/construction/projects');
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await openDialog(page.getByRole('button', { name: 'New project', exact: true }), create);
  await create.getByLabel('Name', { exact: true }).fill(name); await create.getByLabel('Location', { exact: true }).fill('Lagos');
  await create.getByLabel('Client', { exact: true }).fill('Sample project owner');
  await create.getByRole('combobox', { name: 'Project type', exact: true }).selectOption('residential');
  await create.getByLabel('State or region', { exact: true }).fill('Lagos, Nigeria');
  await create.getByLabel('Contract (₦)', { exact: true }).fill('1000000'); await create.getByLabel('Budget (₦)', { exact: true }).fill('800000');
  await create.getByLabel('Planned finish', { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const edit = page.getByRole('dialog', { name: 'Edit project', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit project ${name}`, exact: true }), edit);
  await edit.getByLabel('Project name', { exact: true }).fill(updated); await edit.getByLabel('Location', { exact: true }).fill('Abuja');
  await edit.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(edit).not.toBeVisible(); await page.reload();
  await expect(page.getByRole('heading', { name: updated, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Edit project ${updated}`, exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search construction projects' }).fill(updated);
  await page.getByRole('link', { name: 'Set up project', exact: true }).click();
  await expect(page).toHaveURL(/\/setup\?section=programme$/);
  await expect(page.getByRole('heading', { name: `${updated} · project setup`, exact: true })).toBeVisible();

  const phaseName = `Mobilisation ${id}`;
  const phasePanel = page.getByRole('heading', { name: 'WBS phase', exact: true }).locator('xpath=ancestor::section[1]');
  await phasePanel.getByLabel('Phase name', { exact: true }).fill(phaseName);
  await phasePanel.getByLabel('Delivery weight (%)', { exact: true }).fill('15');
  await phasePanel.getByRole('button', { name: 'Add phase', exact: true }).click();
  await expect(page.getByRole('table')).toContainText(phaseName);

  const taskName = `Establish site ${id}`;
  const taskPanel = page.getByRole('heading', { name: 'Programme task', exact: true }).locator('xpath=ancestor::section[1]');
  await taskPanel.getByLabel('Task name', { exact: true }).fill(taskName);
  await taskPanel.getByLabel('Owner', { exact: true }).fill('Demo site manager');
  await page.getByRole('combobox', { name: 'WBS phase', exact: true }).selectOption({ label: phaseName });
  await taskPanel.getByLabel('Budget (₦)', { exact: true }).fill('2500000');
  await taskPanel.getByRole('button', { name: 'Add task', exact: true }).click();
  const taskError = page.locator('p[role="alert"]');
  if (await taskError.count()) throw new Error(`Programme task rejected: ${await taskError.textContent()}`);
  await expect(page.getByRole('table')).toContainText(taskName);

  const milestonePanel = page.getByRole('heading', { name: 'Milestone', exact: true }).locator('xpath=ancestor::section[1]');
  await milestonePanel.getByLabel('Milestone name', { exact: true }).fill(`Site possession ${id}`);
  await milestonePanel.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await page.getByRole('tab', { name: /Calendar & baselines/ }).click();
  await expect(page).toHaveURL(/section=baselines/);
  const baselinePanel = page.getByRole('heading', { name: 'Baseline revision', exact: true }).locator('xpath=ancestor::section[1]');
  await baselinePanel.getByLabel('Revision name', { exact: true }).fill(`Baseline ${id}`);
  await baselinePanel.getByLabel('Revision reason', { exact: true }).fill('Controlled sandbox mobilisation baseline');
  await baselinePanel.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Pending Approval', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Packages & BOQ/ }).click();
  await expect(page).toHaveURL(/section=packages/);
  const packagePanel = page.getByRole('heading', { name: 'Cost code & BOQ setup wizard', exact: true }).locator('xpath=ancestor::section[1]');
  await packagePanel.getByLabel('Package / cost code', { exact: true }).fill(`MOB-${id}`);
  await packagePanel.getByLabel('Package name', { exact: true }).fill('Site mobilisation');
  await packagePanel.getByLabel('Approved budget (₦)', { exact: true }).fill('2500000');
  await packagePanel.getByRole('button', { name: 'Create package and cost code', exact: true }).click();
  await expect(page.getByRole('table')).toContainText(`MOB-${id}`);

  await page.getByRole('tab', { name: /Team & RACI/ }).click();
  await expect(page).toHaveURL(/section=team/);
  const teamPanel = page.getByRole('heading', { name: 'Project team & responsibility matrix', exact: true }).locator('xpath=ancestor::section[1]');
  await teamPanel.getByLabel('Name', { exact: true }).fill('Demo project director');
  await teamPanel.getByLabel('Organisation', { exact: true }).fill('Demo Build Limited');
  await teamPanel.getByLabel('Project role', { exact: true }).fill('Project director');
  await teamPanel.getByLabel('Responsibility', { exact: true }).fill('Accountable for project mobilisation');
  await teamPanel.getByRole('button', { name: 'Assign team member', exact: true }).click();
  await expect(page.getByText(/Demo project director/)).toBeVisible();

  await page.getByRole('tab', { name: /Locations/ }).click();
  await expect(page).toHaveURL(/section=locations/);
  const locationPanel = page.getByRole('tabpanel', { name: /^Locations/ });
  await locationPanel.getByLabel('Location name', { exact: true }).fill('Main site');
  await locationPanel.getByLabel('Latitude', { exact: true }).fill('6.5244'); await locationPanel.getByLabel('Longitude', { exact: true }).fill('3.3792');
  await locationPanel.getByRole('button', { name: 'Add location', exact: true }).click();
  await expect(locationPanel.getByRole('strong').filter({ hasText: /^Main site$/ })).toBeVisible();

  await page.getByRole('tab', { name: /Lifecycle controls/ }).click();
  await expect(page).toHaveURL(/section=lifecycle/);
  await page.getByLabel('Reason for transition', { exact: true }).fill('Mobilisation checks completed in sandbox');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('navigation', { name: 'Construction navigation', exact: true }).getByRole('link', { name: 'WBS & programme', exact: true }).click();
  await expect(page).toHaveURL(/section=programme/);
  await expect(page.getByRole('table')).toContainText(taskName);
});
