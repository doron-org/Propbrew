import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openDialog, selectTab } from './dialog';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
async function section(page: Page, name: string | RegExp) {
  await selectTab(page.getByRole('tab', { name, exact: typeof name === 'string' }), page.getByRole('tabpanel', { name, exact: typeof name === 'string' }));
}
async function saveImage(dialog: Locator, name: string) {
  await dialog.getByLabel(/^Add evidence file/).setInputFiles({ name, mimeType: 'image/png', buffer: png });
  const uploaded = dialog.page().waitForResponse((response) => response.url().endsWith('/api/facility/evidence') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save evidence file', exact: true }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(dialog.getByRole('checkbox', { name: new RegExp(name.replaceAll('.', '[.]')) })).toBeChecked();
}

test('a fresh company operates asset maintenance, exact stock movements and evidenced compliance with durable records', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const suffix = randomUUID().slice(0, 8), propertyName = `Facility Court ${suffix}`, assetName = `Standby Generator ${suffix}`;
  const planName = `Generator service ${suffix}`, partName = `Generator Filter ${suffix}`, obligationName = `Generator safety ${suffix}`, inspectionTitle = `Fuel hose check ${suffix}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const certificateExpiry = addDays(today, 365);
  await page.goto('/sign-up');
  await page.getByLabel('Your full name', { exact: true }).fill('Disposable Facility Operations Owner');
  await page.getByLabel('Email address', { exact: true }).fill(`facility-operations-${suffix}@example.test`);
  await page.getByLabel('Company name', { exact: true }).fill(`Facility Operations Company ${suffix}`);
  await page.getByLabel('Password', { exact: true }).fill('Disposable facility operations browser passphrase 2026!');
  await page.getByRole('button', { name: 'Create account & company', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/); await page.getByRole('link', { name: 'Set up later', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/); await page.getByRole('link', { name: 'Enter Property Management workspace', exact: true }).click();
  await page.goto('/facility');
  await page.goto('/spaces');
  const property = page.getByRole('dialog', { name: 'Add facility site', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add facility site', exact: true }), property);
  await property.getByLabel('Facility site name', { exact: true }).fill(propertyName);
  await property.getByLabel('Address', { exact: true }).fill('60 Synthetic Facility Avenue, Lagos, Nigeria');
  await property.getByRole('button', { name: 'Create facility site', exact: true }).click();
  await expect(property).toHaveCount(0);

  await page.goto('/assets');
  const asset = page.getByRole('dialog', { name: 'Add asset', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add asset', exact: true }), asset);
  await asset.getByLabel('Asset name', { exact: true }).fill(assetName);
  await asset.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: propertyName });
  await asset.getByLabel('Category', { exact: true }).fill('Generator');
  await asset.getByLabel('Serial number', { exact: true }).fill(`SYNTHETIC-${suffix}`);
  await asset.getByLabel('Location details', { exact: true }).fill('Generator bay');
  await asset.getByLabel('Purchase date', { exact: true }).fill(addDays(today, -365));
  await asset.getByLabel('Warranty expiry', { exact: true }).fill(certificateExpiry);
  await asset.getByRole('button', { name: 'Save asset', exact: true }).click(); await expect(asset).toHaveCount(0);

  // Mutation buttons are submitted once. Only read-only tabs and dialog openers
  // use the shared readiness helper when Next compiles a page for the first time.
  await page.goto('/ppm');
  const plan = page.getByRole('dialog', { name: 'Create maintenance plan', exact: true });
  await openDialog(page.getByRole('button', { name: 'Create maintenance plan', exact: true }), plan);
  await plan.getByRole('combobox', { name: 'Asset', exact: true }).selectOption({ label: `${assetName} · Generator bay` });
  await plan.getByLabel('Plan name', { exact: true }).fill(planName);
  await plan.getByRole('combobox', { name: 'Maintenance basis', exact: true }).selectOption('both');
  await plan.getByLabel('First / next service date', { exact: true }).fill(today);
  await plan.getByRole('combobox', { name: 'Calendar interval', exact: true }).selectOption('weekly');
  await plan.getByLabel('Runtime service interval (h)', { exact: true }).fill('100');
  await plan.getByLabel('Work-order lead time (days)', { exact: true }).fill('0');
  await plan.getByLabel('Checklist item 1', { exact: true }).fill('Check generator filter');
  await plan.getByRole('checkbox', { name: 'Photo required for item 1', exact: true }).check();
  await plan.getByRole('checkbox', { name: 'Require a stored service photo', exact: true }).check();
  await plan.getByRole('checkbox', { name: 'Automatically create an unassigned work order when due', exact: true }).uncheck();
  await plan.getByRole('button', { name: 'Create maintenance plan', exact: true }).click(); await expect(plan).toHaveCount(0);
  await section(page, 'Runtime');
  const meter = page.getByRole('dialog', { name: 'Record cumulative runtime', exact: true });
  await openDialog(page.getByRole('button', { name: 'Log runtime', exact: true }), meter);
  await meter.getByLabel('Cumulative meter reading (h)', { exact: true }).fill('100.25');
  await meter.getByRole('button', { name: 'Save runtime', exact: true }).click(); await expect(meter).toHaveCount(0);
  await section(page, 'Plan register');
  const planRow = page.getByRole('row').filter({ hasText: planName }); await expect(planRow).toHaveCount(1);
  const service = page.getByRole('dialog', { name: assetName, exact: true });
  await openDialog(planRow.getByRole('button', { name: `View maintenance plan for ${assetName}`, exact: true }), service);
  await service.getByRole('button', { name: 'Mark serviced…', exact: true }).click();
  await service.getByRole('button', { name: /^Check generator filter(?:\s*Evidence required)?$/ }).click();
  await service.getByLabel('Actual service date', { exact: true }).fill(today);
  await service.getByLabel('Service-time cumulative meter reading (h)', { exact: true }).fill('100.25');
  await service.getByLabel('Service notes', { exact: true }).fill('Synthetic filter service with recorded evidence.');
  await saveImage(service, 'synthetic-service.png');
  await service.getByRole('button', { name: 'Review service completion', exact: true }).click();
  await service.getByRole('button', { name: 'Confirm service completion', exact: true }).click(); await expect(service).toHaveCount(0);
  await section(page, 'Service history');
  await expect(page.getByRole('tabpanel', { name: 'Service history', exact: true })).toContainText(planName);
  await expect(page.getByRole('link', { name: 'synthetic-service.png', exact: true })).toBeVisible();
  await page.reload(); await section(page, 'Plan register');
  await expect(page.getByRole('row').filter({ hasText: planName })).toContainText(addDays(today, 7));
  await section(page, 'Runtime');
  await openDialog(page.getByRole('button', { name: 'Log runtime', exact: true }), meter);
  await meter.getByLabel('Cumulative meter reading (h)', { exact: true }).fill('200.25');
  await meter.getByRole('button', { name: 'Save runtime', exact: true }).click(); await expect(meter).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Runtime', exact: true })).toContainText('100% of interval');

  await page.goto('/inventory');
  const part = page.getByRole('dialog', { name: 'Add inventory part', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add part', exact: true }), part);
  await part.getByRole('combobox', { name: 'Stock site', exact: true }).selectOption({ label: propertyName });
  await part.getByLabel('Part name', { exact: true }).fill(partName);
  await part.getByLabel('SKU / item code', { exact: true }).fill(`FILTER-${suffix}`);
  await part.getByLabel('Category', { exact: true }).fill('Generator consumable');
  await part.getByLabel('Store / bin location', { exact: true }).fill('Main store / A1');
  await part.getByLabel('Stocking unit', { exact: true }).fill('each');
  await part.getByLabel('Recorded unit cost (₦)', { exact: true }).fill('0.29');
  await part.getByLabel('Opening stock count', { exact: true }).fill('10');
  await part.getByLabel('Reorder point', { exact: true }).fill('3');
  await part.getByLabel('Recorded monthly usage', { exact: true }).fill('2');
  await part.getByLabel('Opening count reference', { exact: true }).fill('COUNT-001');
  await part.getByLabel('Opening count reason', { exact: true }).fill('Verified initial physical stock count');
  await part.getByRole('button', { name: 'Create part', exact: true }).click(); await expect(part).toHaveCount(0);
  const stockRow = page.getByRole('row').filter({ hasText: partName });
  await expect(stockRow.getByRole('cell', { name: '10 each', exact: true })).toBeVisible();
  await expect(stockRow).toContainText('Active · v1');
  let holdRefresh = true, refreshHeld = false;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const inventoryRoute = (url: URL) => url.pathname === '/inventory';
  // Delay a read only. The receipt POST is submitted exactly once. A held RSC
  // response reproduces the slow-refresh window seen in CI without retrying a
  // financial/stock operation or changing the server's concurrency checks.
  await page.route(inventoryRoute, async (route) => {
    const request = route.request();
    if (holdRefresh && request.method() === 'GET' && request.headers().rsc === '1') {
      holdRefresh = false; refreshHeld = true; await refreshGate;
    }
    await route.continue();
  });
  let stockVersion = 1;
  for (const movement of [
    { trigger: `Receive stock for ${partName}`, title: 'Receive stock', field: 'Quantity received', count: '5', reference: 'DELIVERY-001', balance: '15' },
    { trigger: `Issue stock for ${partName}`, title: 'Issue stock', field: 'Quantity issued', count: '4', reference: 'JOB-001', balance: '11' },
    { trigger: `Adjust stock for ${partName}`, title: 'Adjust stock', field: 'Physical stock counted', count: '2', reference: 'COUNT-002', balance: '2' },
  ]) {
    const dialog = page.getByRole('dialog', { name: movement.title, exact: true });
    await openDialog(page.getByRole('button', { name: movement.trigger, exact: true }), dialog);
    await dialog.getByLabel(movement.field, { exact: true }).fill(movement.count);
    await dialog.getByLabel('Movement reference', { exact: true }).fill(movement.reference);
    await dialog.getByLabel('Movement reason', { exact: true }).fill('Verified synthetic physical movement');
    try {
      await dialog.getByRole('button', { name: 'Record movement', exact: true }).click(); await expect(dialog).toHaveCount(0);
      if (movement.title === 'Receive stock') {
        await expect.poll(() => refreshHeld).toBe(true);
        await expect(page.getByRole('status').filter({ hasText: 'Updating stock register…' })).toBeVisible();
        for (const action of [`Edit inventory part ${partName}`, `Receive stock for ${partName}`, `Issue stock for ${partName}`, `Adjust stock for ${partName}`]) await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Add part', exact: true })).toBeDisabled();
      }
    } finally { releaseRefresh(); }
    await expect(page.getByRole('status').filter({ hasText: `New stock balance: ${movement.balance}.` })).toBeVisible();
    await expect(stockRow.getByRole('cell', { name: `${movement.balance} each`, exact: true })).toBeVisible();
    await expect(stockRow).toContainText(`Active · v${++stockVersion}`);
    await expect(page.getByRole('button', { name: `Issue stock for ${partName}`, exact: true })).toBeEnabled();
  }
  await page.unroute(inventoryRoute);
  await expect(page.getByRole('row').filter({ hasText: partName })).toContainText('₦0.29');
  await expect(page.getByRole('row').filter({ hasText: partName })).toContainText('Reorder review');
  await section(page, /^Movement history(?: \d+)?$/);
  for (const reference of ['DELIVERY-001', 'JOB-001', 'COUNT-002']) await expect(page.getByRole('row').filter({ hasText: reference })).toHaveCount(1);
  await page.reload(); await section(page, /^Movement history(?: \d+)?$/);
  await expect(page.getByRole('row').filter({ hasText: 'COUNT-002' })).toContainText('11 → 2');

  await page.goto('/inspections');
  const obligation = page.getByRole('dialog', { name: 'Add compliance obligation', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add obligation', exact: true }), obligation);
  await obligation.getByLabel('Obligation name', { exact: true }).fill(obligationName);
  await obligation.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: propertyName });
  await obligation.getByRole('combobox', { name: 'Linked asset (optional)', exact: true }).selectOption({ label: assetName });
  await obligation.getByLabel('Operational check interval (days)', { exact: true }).fill('30');
  await obligation.getByLabel('Next operational check', { exact: true }).fill(today);
  await obligation.getByLabel('Certificate reference (optional)', { exact: true }).fill(`CERT-${suffix}`);
  await obligation.getByLabel('Recorded certificate expiry (optional)', { exact: true }).fill(certificateExpiry);
  await obligation.getByLabel('Inspection title', { exact: true }).fill(inspectionTitle);
  await obligation.getByRole('button', { name: 'Remove check 2', exact: true }).click();
  await obligation.getByLabel('Check description', { exact: true }).fill('Inspect fuel hose');
  await obligation.getByRole('combobox', { name: 'Failure severity', exact: true }).selectOption('major');
  await obligation.getByRole('checkbox', { name: 'Image evidence required', exact: true }).check();
  await obligation.getByRole('button', { name: 'Create obligation', exact: true }).click(); await expect(obligation).toHaveCount(0);
  for (const outcome of ['Fail', 'Pass'] as const) {
    const schedule = page.getByRole('dialog', { name: 'Schedule inspection', exact: true });
    await openDialog(page.getByRole('button', { name: `Schedule inspection for ${obligationName}`, exact: true }), schedule);
    await schedule.getByLabel('Date', { exact: true }).fill(today);
    await schedule.getByLabel('Inspector', { exact: true }).fill('Synthetic Facility Inspector');
    await schedule.getByRole('button', { name: 'Schedule', exact: true }).click(); await expect(schedule).toHaveCount(0);
    const run = page.getByRole('dialog', { name: inspectionTitle, exact: true });
    await openDialog(page.getByRole('button', { name: `Run inspection for ${obligationName}`, exact: true }), run);
    await run.getByRole('group', { name: 'Result for Inspect fuel hose', exact: true }).getByRole('button', { name: outcome, exact: true }).click();
    if (outcome === 'Fail') {
      await run.getByLabel('Finding for Inspect fuel hose', { exact: true }).fill('Fuel hose has a visible crack requiring repair.');
      await saveImage(run, 'synthetic-inspection.png');
    } else await run.getByRole('checkbox', { name: /synthetic-inspection\.png/ }).check();
    await run.getByRole('button', { name: 'Review inspection result', exact: true }).click();
    await run.getByRole('button', { name: 'Confirm inspection result', exact: true }).click(); await expect(run).toHaveCount(0);
    if (outcome === 'Fail') {
      await section(page, /^Inspections \(\d+\)$/);
      const failed = page.getByRole('row').filter({ hasText: inspectionTitle }); await expect(failed).toContainText('Failed'); await expect(failed).toContainText('1');
      await section(page, 'Compliance register');
    }
  }
  await page.reload();
  const editObligation = page.getByRole('dialog', { name: 'Edit compliance obligation', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit obligation ${obligationName}`, exact: true }), editObligation);
  await expect(editObligation.getByLabel('Recorded certificate expiry (optional)', { exact: true })).toHaveValue(certificateExpiry);
  await expect(editObligation.getByLabel('Next operational check', { exact: true })).toHaveValue(addDays(today, 30));
  await editObligation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await section(page, /^Inspections \(\d+\)$/);
  const completed = page.getByRole('row').filter({ hasText: inspectionTitle }); await expect(completed).toHaveCount(2);
  await expect(completed.filter({ hasText: 'Passed' })).toHaveCount(1); await expect(completed.filter({ hasText: 'Failed' })).toHaveCount(1);
  await page.goto('/work-orders');
  await expect(page.getByText(`${inspectionTitle}: Inspect fuel hose`, { exact: true }).first()).toBeVisible();
});
