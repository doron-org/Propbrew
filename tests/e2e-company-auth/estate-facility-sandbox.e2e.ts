import { expect, test, type Page } from '@playwright/test';
import { openDialog, selectTab } from './dialog';

async function enterDemo(page: Page, workspace: 'Estate' | 'Facility') {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`Explore demo:.*${workspace}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspace.toLowerCase()}$`));
  await expect(page.getByRole('complementary', { name: 'Demo account notice', exact: true })).toHaveCount(0);
}

test('Estate sandbox creates and edits property and resident records with reload persistence', async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const propertyName = `Estate Workflow Court ${suffix}`, updatedProperty = `${propertyName} Updated`;
  const residentName = `Estate Workflow Resident ${suffix}`, updatedResident = `${residentName} Updated`;
  await enterDemo(page, 'Estate');

  const property = page.getByRole('dialog', { name: 'Add property', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add property', exact: true }), property);
  await property.getByLabel('Property name', { exact: true }).fill(propertyName);
  await property.getByLabel('Property address', { exact: true }).fill('22 Synthetic Workflow Avenue, Lagos, Nigeria');
  await property.getByLabel('Number of units', { exact: true }).fill('2');
  await property.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(property.getByRole('heading', { name: 'Property added', exact: true })).toBeVisible();
  await property.getByRole('button', { name: 'Done', exact: true }).click();

  const tenant = page.getByRole('dialog', { name: 'Add tenant', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add tenant', exact: true }), tenant);
  await tenant.getByLabel('Tenant full name', { exact: true }).fill(residentName);
  await tenant.getByRole('combobox', { name: 'Property and unit', exact: true }).selectOption({ label: `${propertyName} · Unit 1` });
  await tenant.getByLabel('Move-in date', { exact: true }).fill('2026-01-01');
  await tenant.getByRole('button', { name: 'Add tenant', exact: true }).click();
  await expect(tenant.getByRole('heading', { name: 'Tenant record added', exact: true })).toBeVisible();
  await tenant.getByRole('button', { name: 'Done', exact: true }).click();

  await page.goto('/properties');
  const propertyEdit = page.getByRole('dialog', { name: 'Edit property', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit property ${propertyName}`, exact: true }), propertyEdit);
  await propertyEdit.getByLabel('Property name', { exact: true }).fill(updatedProperty);
  await propertyEdit.getByRole('textbox', { name: 'Property address', exact: true }).fill('24 Synthetic Workflow Avenue, Lagos, Nigeria');
  await propertyEdit.getByRole('button', { name: 'Save property', exact: true }).click();
  await expect(propertyEdit).toHaveCount(0);
  await page.reload();
  const propertyRow = page.getByRole('table', { name: 'Property list', exact: true }).getByRole('row').filter({ hasText: updatedProperty });
  await expect(propertyRow).toContainText('24 Synthetic Workflow Avenue');
  await expect(propertyRow.getByRole('button', { name: `Edit property ${updatedProperty}`, exact: true })).toBeVisible();

  await page.goto('/people');
  const residentEdit = page.getByRole('dialog', { name: 'Edit resident', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit resident ${residentName}`, exact: true }), residentEdit);
  await residentEdit.getByLabel('Resident full name', { exact: true }).fill(updatedResident);
  await residentEdit.getByLabel('Email', { exact: true }).fill(`sandbox-${suffix}@example.invalid`);
  await residentEdit.getByLabel('Phone', { exact: true }).fill('+2348000000000');
  await residentEdit.getByLabel('Household size', { exact: true }).fill('3');
  await residentEdit.getByRole('combobox', { name: 'Property and unit', exact: true }).selectOption({ label: `${updatedProperty} · Unit 2` });
  await residentEdit.getByRole('button', { name: 'Save resident', exact: true }).click();
  await expect(residentEdit).toHaveCount(0);
  await page.reload();
  const residentRow = page.getByRole('tabpanel', { name: /^Directory(?: \d+)?$/ }).getByRole('row').filter({ hasText: updatedResident });
  await expect(residentRow).toContainText('Unit 2');
  await expect(residentRow).toContainText('3 people');
  await expect(residentRow).toContainText(`sandbox-${suffix}@example.invalid`);
  const savedResident = page.getByRole('dialog', { name: 'Edit resident', exact: true });
  await openDialog(residentRow.getByRole('button', { name: `Edit resident ${updatedResident}`, exact: true }), savedResident);
  await expect(savedResident.getByLabel('Phone', { exact: true })).toHaveValue('+2348000000000');
  await savedResident.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/properties');
  const savedPropertyRow = page.getByRole('table', { name: 'Property list', exact: true }).getByRole('row').filter({ hasText: updatedProperty });
  await expect(savedPropertyRow).toContainText('1/2');
});

test('Facility sandbox creates and edits assets and completes the normal work-order lifecycle', async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const assetName = `Facility Workflow Pump ${suffix}`, updatedAsset = `${assetName} Checked`;
  const workOrderTitle = `Inspect sandbox pump ${suffix}`;
  await enterDemo(page, 'Facility');
  await page.goto('/assets');
  const asset = page.getByRole('dialog', { name: 'Add asset', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add asset', exact: true }), asset);
  await asset.getByLabel('Asset name', { exact: true }).fill(assetName);
  await asset.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: 'Victoria Court' });
  await asset.getByLabel('Category', { exact: true }).fill('Plumbing');
  await asset.getByLabel('Serial number', { exact: true }).fill(`QA-PUMP-${suffix}`);
  await asset.getByLabel('Location details', { exact: true }).fill('Synthetic pump room');
  await asset.getByLabel('Purchase date', { exact: true }).fill('2025-01-01');
  await asset.getByLabel('Warranty expiry', { exact: true }).fill('2028-01-01');
  await asset.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(asset).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search assets', exact: true }).fill(assetName);
  const assetEdit = page.getByRole('dialog', { name: 'Edit asset', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit asset ${assetName}`, exact: true }), assetEdit);
  await assetEdit.getByLabel('Asset name', { exact: true }).fill(updatedAsset);
  await assetEdit.getByRole('combobox', { name: 'Asset status', exact: true }).selectOption('degraded');
  await assetEdit.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(assetEdit).toHaveCount(0);
  await page.reload();
  await page.getByRole('textbox', { name: 'Search assets', exact: true }).fill(updatedAsset);
  await expect(page.getByRole('region', { name: `${updatedAsset} asset details`, exact: true })).toContainText('Degraded');

  await page.goto('/work-orders');
  const workOrder = page.getByRole('dialog', { name: 'New facility work order', exact: true });
  await openDialog(page.getByRole('button', { name: 'New work order', exact: true }), workOrder);
  await workOrder.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: 'Victoria Court' });
  await workOrder.getByRole('combobox', { name: 'Asset (optional)', exact: true }).selectOption({ label: updatedAsset });
  await workOrder.getByLabel('Work order title', { exact: true }).fill(workOrderTitle);
  await workOrder.getByLabel('Details', { exact: true }).fill('Synthetic workflow test. No external dispatch.');
  await workOrder.getByRole('button', { name: 'Create work order', exact: true }).click();
  await expect(page).toHaveURL(/\/work-orders\/WO-\d+$/);
  await expect(page.getByRole('heading', { name: workOrderTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Triage', exact: true }).click();
  const assignment = page.getByRole('dialog', { name: 'Assign work order', exact: true });
  await openDialog(page.getByRole('button', { name: 'Assign', exact: true }), assignment);
  // Eligible assignees are scoped company technicians and compliant vendors;
  // in this sandbox that is the seeded vendor organisation.
  await assignment.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption({ label: 'Brightworks Facilities · vendor' });
  await assignment.getByRole('button', { name: 'Confirm assign', exact: true }).click();
  await expect(assignment).toHaveCount(0);
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  const resolution = page.getByRole('dialog', { name: 'Mark resolved work order', exact: true });
  await openDialog(page.getByRole('button', { name: 'Mark resolved', exact: true }), resolution);
  // Technicians and vendors must record a completion note before resolving.
  await resolution.getByLabel('Completion note', { exact: true }).fill('Synthetic workflow completion evidence recorded.');
  await resolution.getByRole('button', { name: 'Confirm mark resolved', exact: true }).click();
  await expect(resolution).toHaveCount(0);
  const verification = page.getByRole('dialog', { name: 'Verify work order', exact: true });
  await openDialog(page.getByRole('button', { name: 'Verify', exact: true }), verification);
  await verification.getByRole('button', { name: 'Confirm verify', exact: true }).click();
  await expect(verification).toHaveCount(0);
  const closure = page.getByRole('dialog', { name: 'Close work order', exact: true });
  await openDialog(page.getByRole('button', { name: 'Close', exact: true }), closure);
  await closure.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await expect(closure).toHaveCount(0);
  await expect(page.getByText('No actions available to you from this state.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: workOrderTitle, exact: true })).toBeVisible();
  await expect(page.getByText('No actions available to you from this state.', { exact: true })).toBeVisible();
  await selectTab(page.getByRole('tab', { name: /^Activity history(?: \d+)?$/ }), page.getByRole('tabpanel', { name: /^Activity history(?: \d+)?$/ }));
  await expect(page.getByRole('tabpanel', { name: /^Activity history(?: \d+)?$/ })).toContainText('Demo operator');
  await page.goto('/work-orders');
  await expect(page.getByRole('row').filter({ hasText: workOrderTitle })).toContainText('Closed');
});
