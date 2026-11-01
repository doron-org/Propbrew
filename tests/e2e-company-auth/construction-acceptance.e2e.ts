import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { unzipSync } from 'fflate';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { openDialog, selectTab } from './dialog';

const passphrase = 'Disposable construction acceptance passphrase 2026!';
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
test.use({ actionTimeout: 10_000 });

async function uploadApprovedHandoverFile(page: Page, projectId: string, number: string, title: string, pdfBytes: Buffer) {
  await page.goto(`/construction/documents?projectId=${projectId}`);
  const dialog = page.getByRole('dialog', { name: 'Upload a controlled document', exact: true });
  await openDialog(page.getByRole('button', { name: 'Upload document', exact: true }), dialog);
  await dialog.getByLabel('Document number', { exact: true }).fill(number);
  await dialog.getByLabel('Document title', { exact: true }).fill(title);
  await dialog.getByLabel('Discipline', { exact: true }).fill('Closeout');
  await dialog.getByLabel('Controlled PDF', { exact: true }).setInputFiles({ name: `${number}.pdf`, mimeType: 'application/pdf', buffer: pdfBytes });
  await dialog.getByRole('button', { name: 'Save controlled PDF', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const record = page.getByRole('region', { name: `${number} document record`, exact: true });
  await expect(record).toBeVisible();
  const disclosure = record.getByRole('button', { name: new RegExp(number) });
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  await record.getByRole('button', { name: 'Approve', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Review construction change', exact: true });
  await confirmation.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(record).toContainText('Build to rev A');
}

async function createCompany(page: Page, id: string) {
  await page.goto('/sign-up');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Your full name', { exact: true }).fill('Acceptance project owner');
  await page.getByLabel('Email address', { exact: true }).fill(`construction-owner-${id}@example.test`);
  await page.getByLabel('Company name', { exact: true }).fill(`Construction acceptance ${id}`);
  await page.getByLabel('Password', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Create account & company', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('link', { name: 'Set up later', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}

async function createProject(page: Page, name: string) {
  await page.goto('/construction/projects');
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await openDialog(page.getByRole('button', { name: 'New project', exact: true }), dialog);
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Location', { exact: true }).fill('Lekki, Lagos');
  await dialog.getByRole('combobox', { name: 'Project type', exact: true }).selectOption('residential');
  await dialog.getByLabel('State or region', { exact: true }).fill('Lagos, Nigeria');
  await dialog.getByLabel('Client', { exact: true }).fill('Acceptance client');
  await dialog.getByLabel('Contract (₦)', { exact: true }).fill('25000000');
  await dialog.getByLabel('Budget (₦)', { exact: true }).fill('20000000');
  await dialog.getByLabel('Planned finish', { exact: true }).fill(future(180));
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const card = page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::section[1]');
  const href = await card.getByRole('link', { name: 'Set up project', exact: true }).getAttribute('href');
  expect(href).toMatch(/^\/construction\/projects\/cp-new-\d+\/setup/);
  return href!.split('/')[3];
}

async function inviteRole(owner: Page, browser: Browser, id: string, profile: string, assignmentLabel?: string, assignment?: string, emailSuffix = profile) {
  await owner.goto('/company/team');
  await owner.getByRole('button', { name: 'Invite teammate', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: `Invite a teammate to Construction acceptance ${id}`, exact: true });
  const email = `${emailSuffix}-${id}@example.test`;
  await dialog.getByLabel('Teammate email address', { exact: true }).fill(email);
  await dialog.getByRole('combobox', { name: 'User type', exact: true }).selectOption(profile);
  if (assignmentLabel && assignment) {
    const choices = dialog.getByRole('listbox', { name: assignmentLabel, exact: true });
    const value = await choices.locator('option').filter({ hasText: assignment }).first().getAttribute('value');
    expect(value, `${assignmentLabel} should contain ${assignment}`).toBeTruthy();
    await choices.selectOption(value!, { timeout: 10_000 });
  }
  await dialog.getByRole('button', { name: 'Create invitation link', exact: true }).click();
  const link = await dialog.getByLabel('Private invitation link', { exact: true }).inputValue();
  const context = await browser.newContext({ baseURL: process.env.PW_COMPANY_BASE_URL });
  const member = await context.newPage();
  await member.goto(link);
  await member.getByRole('link', { name: 'Create an account', exact: true }).click();
  await member.getByLabel('Your full name', { exact: true }).fill(`${profile} acceptance`);
  await member.getByLabel('Email address', { exact: true }).fill(email);
  await member.getByLabel('Password', { exact: true }).fill(passphrase);
  await member.getByRole('button', { name: 'Create account & join', exact: true }).click();
  await expect(member).toHaveURL(/\/workspaces$/);
  return { context, member };
}

test('a saved Lagos project mobilises, isolates roles and certifies a claim', async ({ page, browser }) => {
  test.setTimeout(720_000);
  const id = randomUUID().slice(0, 8);
  const firstName = `Lekki acceptance build ${id}`;
  const secondName = `Abuja isolation build ${id}`;
  await createCompany(page, id);
  const firstId = await createProject(page, firstName);
  const secondId = await createProject(page, secondName);
  expect(firstId).not.toBe(secondId);

  await page.goto(`/construction/projects/${firstId}/setup?section=programme`);
  const phase = page.getByRole('heading', { name: 'WBS phase', exact: true }).locator('xpath=ancestor::section[1]');
  await phase.getByLabel('Phase name', { exact: true }).fill('Site mobilisation');
  await phase.getByLabel('Delivery weight (%)', { exact: true }).fill('20');
  await phase.getByRole('button', { name: 'Add phase', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Site mobilisation');
  const task = page.getByRole('heading', { name: 'Programme task', exact: true }).locator('xpath=ancestor::section[1]');
  await task.getByLabel('Task name', { exact: true }).fill('Establish fenced site');
  await task.getByLabel('Owner', { exact: true }).fill('Site engineer');
  await page.getByRole('combobox', { name: 'WBS phase', exact: true }).selectOption({ label: 'Site mobilisation' }, { timeout: 10_000 });
  await task.getByLabel('Budget (₦)', { exact: true }).fill('2000000');
  await task.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Establish fenced site');

  await page.goto(`/construction/projects/${firstId}/setup?section=packages`);
  const pack = page.getByRole('heading', { name: 'Cost code & BOQ setup wizard', exact: true }).locator('xpath=ancestor::section[1]');
  await pack.getByLabel('Package / cost code', { exact: true }).fill(`MOB-${id}`);
  await pack.getByLabel('Package name', { exact: true }).fill('Enabling works');
  await pack.getByLabel('Approved budget (₦)', { exact: true }).fill('5000000');
  await pack.getByRole('button', { name: 'Create package and cost code', exact: true }).click();
  await expect(page.getByRole('table')).toContainText(`MOB-${id}`);

  await page.goto(`/construction/projects/${firstId}/setup?section=baselines`);
  const baseline = page.getByRole('heading', { name: 'Baseline revision', exact: true }).locator('xpath=ancestor::section[1]');
  await baseline.getByLabel('Revision name', { exact: true }).fill('Mobilisation baseline');
  await baseline.getByLabel('Revision reason', { exact: true }).fill('First controlled programme');
  await baseline.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Pending Approval', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('A different authorised manager must approve this baseline revision.', { exact: true })).toBeVisible();

  await page.goto('/construction/operations');
  const sub = page.getByRole('tabpanel', { name: 'Subcontractors', exact: true });
  const subcontractorName = `Acceptance Civil Works ${id}`;
  await sub.getByLabel('Company', { exact: true }).fill(subcontractorName);
  await sub.getByLabel('Trade', { exact: true }).fill('Civil works');
  await sub.getByLabel('Contact person', { exact: true }).fill('Tunde Adeyemi');
  await sub.getByLabel('Nigerian phone', { exact: true }).fill('+2348012345678');
  await sub.getByLabel('CAC reference', { exact: true }).fill(`RC${id.toUpperCase()}`);
  await sub.getByLabel('Insurance expiry', { exact: true }).fill(future(365));
  await sub.getByRole('combobox', { name: 'Assigned project', exact: true }).selectOption({ label: firstName });
  await sub.getByLabel('HSE induction completed').check();
  await sub.getByRole('button', { name: 'Submit onboarding', exact: true }).click();
  await expect(page.getByRole('table')).toContainText(subcontractorName);
  await page.getByRole('table').getByRole('row', { name: new RegExp(subcontractorName) }).getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('table').getByRole('row', { name: new RegExp(subcontractorName) })).toContainText('Approved');

  const memberships: Awaited<ReturnType<typeof inviteRole>>[] = [];
  try {
    memberships.push(await inviteRole(page, browser, id, 'project-director'));
    const director = memberships[0].member;
    await director.goto(`/construction/projects/${firstId}/setup?section=baselines`);
    await director.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(director.getByText('Approved', { exact: true })).toBeVisible();
    for (const [profile, label, assignment] of [
      ['client-investor', 'Assigned construction projects', firstName],
      ['consultant-approver', 'Assigned construction projects', firstName],
      ['subcontractor', 'Assigned subcontractor organisations', subcontractorName],
      ['construction-field-worker', 'Assigned field tasks', 'Establish fenced site'],
    ] as const) {
      memberships.push(await inviteRole(page, browser, id, profile, label, assignment));
    }
    memberships.push(await inviteRole(page, browser, id, 'quantity-surveyor', 'Assigned construction projects', firstName));
    const [client, consultant, contractor, field] = memberships.slice(1).map((row) => row.member);
    for (const member of [client, consultant, contractor, field]) {
      await member.goto('/construction/projects');
      await expect(member.getByRole('heading', { name: firstName, exact: true })).toBeVisible();
      await expect(member.getByRole('heading', { name: secondName, exact: true })).toHaveCount(0);
      await member.goto(`/construction/projects/${secondId}`);
      await expect(member.getByRole('heading', { name: secondName, exact: true })).toHaveCount(0);
    }
    await client.goto('/construction/portal/client');
    await expect(client.getByRole('heading', { name: /Your projects, decisions and delivery confidence/ })).toBeVisible();
    await consultant.goto('/construction/portal/consultant');
    await expect(consultant.getByRole('heading', { name: /Reviews, evidence and approvals/ })).toBeVisible();
    await contractor.goto('/construction/portal/subcontractor');
    await expect(contractor.getByRole('heading', { name: /Your packages, claims and assigned work/ })).toBeVisible();
    await field.goto('/construction/portal/field');
    await expect(field.getByRole('heading', { name: /Today’s assigned work/ })).toBeVisible();
    await field.goto('/construction/field');
    await field.getByRole('tab', { name: 'Task progress', exact: true }).click();
    await expect(field.getByRole('combobox', { name: 'Task', exact: true })).toContainText('Establish fenced site');
    const progress = field.getByRole('slider', { name: 'Percent complete', exact: true });
    await progress.focus();
    for (let step = 0; step < 5; step++) await progress.press('ArrowRight');
    await expect(progress).toHaveValue('25');
    await field.getByRole('button', { name: 'Record progress', exact: true }).click();
    await field.getByRole('tab', { name: 'Device outbox', exact: false }).click();
    await expect(field.getByRole('region', { name: /Establish fenced site → 25% outbox record/ })).toContainText('synced', { timeout: 30_000 });

    await page.goto('/construction/operations');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Changes & claims', exact: true }).click();
    const claimsTab = page.getByRole('tabpanel', { name: 'Changes & claims', exact: true });
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: firstName });
    await page.getByRole('combobox', { name: 'Approved subcontractor', exact: true }).selectOption({ label: `${subcontractorName} · Civil works` });
    await page.getByLabel('Valuation period end', { exact: true }).fill(future(-1));
    await page.getByRole('spinbutton', { name: 'Claim amount · NGN', exact: true }).fill('1000000');
    await page.getByRole('textbox', { name: 'Work measured', exact: true }).fill('Verified mobilisation and fencing measured on site');
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(claimsTab.getByRole('table')).toContainText(subcontractorName);
    const claimRow = claimsTab.getByRole('row', { name: new RegExp(subcontractorName) }).last();
    await expect(claimRow).toContainText('Submitted');

    const surveyor = memberships[5].member;
    await surveyor.goto('/construction/operations');
    await surveyor.getByRole('tab', { name: 'Changes & claims', exact: true }).click();
    await surveyor.getByRole('button', { name: 'Save QS assessment', exact: true }).click();
    await expect(surveyor.getByRole('row', { name: new RegExp(subcontractorName) }).last()).toContainText('Assessed');
    await director.goto('/construction/operations');
    await director.getByRole('tab', { name: 'Changes & claims', exact: true }).click();
    await director.getByRole('row', { name: new RegExp(subcontractorName) }).last().getByRole('button', { name: 'Approve certificate', exact: true }).click();
    await expect(director.getByRole('row', { name: new RegExp(subcontractorName) }).last()).toContainText('Approved');

    await director.getByRole('tab', { name: 'Claim closeout', exact: true }).click();
    await expect(director.getByRole('tabpanel', { name: 'Claim closeout', exact: true })).toContainText('net certified ₦902,500.00');
    await expect(director.getByRole('tabpanel', { name: 'Claim closeout', exact: true })).toContainText('approved');
    await expect(director.getByRole('button', { name: 'Confirm payment', exact: true })).toHaveCount(0);

    await page.goto('/construction/operations');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Handover packs', exact: true }).click();
    const handover = page.getByRole('tabpanel', { name: 'Handover packs', exact: true });
    await expect(handover).toBeVisible();
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: firstName });
    await handover.getByRole('button', { name: 'Create draft pack', exact: true }).click();
    await expect(handover).toContainText('Approved as-built drawings: document missing');
    await expect(handover).toContainText('Defects and punch-list closeout: document missing');
    await expect(handover.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();

    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    const pdfBytes = Buffer.from(await pdf.save());
    const drawingNo = `ACC-${id.toUpperCase()}`;
    await page.goto(`/construction/documents?projectId=${firstId}`);
    const drawingDialog = page.getByRole('dialog', { name: 'Upload a controlled document', exact: true });
    await openDialog(page.getByRole('button', { name: 'Upload document', exact: true }), drawingDialog);
    await drawingDialog.getByLabel('Document number', { exact: true }).fill(drawingNo);
    await drawingDialog.getByLabel('Document title', { exact: true }).fill('Mobilisation as built acceptance drawing');
    await drawingDialog.getByLabel('Discipline', { exact: true }).fill('Architectural');
    await drawingDialog.getByLabel('Controlled PDF', { exact: true }).setInputFiles({ name: 'acceptance-drawing.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
    await drawingDialog.getByRole('button', { name: 'Save controlled PDF', exact: true }).click();
    await expect(drawingDialog).not.toBeVisible();
    const drawing = page.getByRole('region', { name: `${drawingNo} document record`, exact: true });
    await expect(drawing).toBeVisible();
    const disclosure = drawing.getByRole('button', { name: new RegExp(drawingNo) });
    if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
    await drawing.getByRole('button', { name: 'Approve', exact: true }).click();
    const approvalDialog = page.getByRole('dialog', { name: 'Review construction change', exact: true });
    await expect(approvalDialog).toBeVisible();
    await approvalDialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
    await expect(approvalDialog).not.toBeVisible();
    await expect(drawing).toContainText('Build to rev A');
    if (await drawing.getByRole('button', { name: new RegExp(drawingNo) }).getAttribute('aria-expanded') === 'false') await drawing.getByRole('button', { name: new RegExp(drawingNo) }).click();
    await drawing.getByRole('button', { name: 'Issue to…', exact: true }).click();
    const issue = page.getByRole('dialog', { name: 'Issue revision', exact: true });
    await issue.getByLabel('Recipient organisation', { exact: true }).fill('Acceptance client');
    await issue.getByLabel('Recipient email', { exact: true }).fill(`external-${id}@example.test`);
    await issue.getByRole('button', { name: 'Email controlled issue', exact: true }).click();
    await expect(issue).not.toBeVisible();
    await expect(page.getByRole('region', { name: `${drawingNo} revision A` }).getByText('External email is not configured for this deployment.', { exact: false })).toBeVisible();

    const fileUrl = await page.getByRole('link', { name: 'Download PDF', exact: true }).getAttribute('href');
    expect(fileUrl).toMatch(/^\/api\/construction\/drawings\//);

    const requiredFiles = [
      { label: 'Approved as-built drawings', number: drawingNo, title: 'Mobilisation as built acceptance drawing' },
      { label: 'Testing and commissioning records', number: `TST-${id.toUpperCase()}`, title: 'Commissioning acceptance record' },
      { label: 'Authority permits and sign-offs', number: `AUT-${id.toUpperCase()}`, title: 'Authority completion permit' },
      { label: 'Operation manuals and warranties', number: `MAN-${id.toUpperCase()}`, title: 'Operating manual and warranties' },
      { label: 'Defects and punch-list closeout', number: `DEF-${id.toUpperCase()}`, title: 'Defects closeout register' },
    ];
    for (const document of requiredFiles.slice(1)) await uploadApprovedHandoverFile(page, firstId, document.number, document.title, pdfBytes);

    const canvas = createCanvas(320, 200);
    const context = canvas.getContext('2d');
    context.fillStyle = '#b7c7d2'; context.fillRect(0, 0, 320, 200);
    context.fillStyle = '#29445d'; context.fillRect(20, 65, 280, 95);
    const photo = canvas.toBuffer('image/jpeg');
    const mobileBootstrap = await field.request.get('/api/mobile/v1/construction/bootstrap');
    expect(mobileBootstrap.ok()).toBe(true);
    const mobile = await mobileBootstrap.json() as { profile: { owner: string }; tasks: { id: string; name: string }[] };
    const fieldTask = mobile.tasks.find((row) => row.name === 'Establish fenced site');
    expect(fieldTask).toBeTruthy();
    const captureId = randomUUID();
    const upload = await field.request.post('/api/mobile/v1/construction/upload', { multipart: {
      opId: captureId, projectId: firstId, taskId: fieldTask!.id, index: '0',
      file: { name: 'site-closeout.jpg', mimeType: 'image/jpeg', buffer: photo },
    } });
    expect(upload.status()).toBe(200);
    const photoUrl = (await upload.json() as { url: string }).url;
    const evidenceTitle = `Closeout site photo ${id}`;
    const evidenceSync = await field.request.post('/api/mobile/v1/construction/sync', { headers: { 'idempotency-key': captureId }, data: {
      id: captureId, owner: mobile.profile.owner, capturedISO: new Date().toISOString(), kind: 'evidence_pack',
      payload: { projectId: firstId, mediaRefs: [photoUrl], subject: 'task', subjectRef: fieldTask!.id, title: evidenceTitle },
    } });
    expect(evidenceSync.status()).toBe(200);
    expect((await evidenceSync.json() as { ok: boolean }).ok).toBe(true);

    await consultant.goto('/construction/operations');
    await selectTab(consultant.getByRole('tab', { name: 'Field approvals', exact: true }), consultant.getByRole('tabpanel', { name: 'Field approvals', exact: true }));
    const evidenceRow = consultant.getByRole('row', { name: new RegExp(evidenceTitle) });
    await expect(evidenceRow).toContainText('Pending Review');
    const photoLink = evidenceRow.getByRole('link', { name: 'View photo 1', exact: true });
    const photoHref = await photoLink.getAttribute('href');
    expect(photoHref).toBeTruthy();
    const [authorPhoto, reviewerPhoto] = await Promise.all([field.request.get(photoHref!), consultant.request.get(photoHref!)]);
    expect(authorPhoto.status()).toBe(200);
    expect(reviewerPhoto.status()).toBe(200);
    expect(reviewerPhoto.headers()['content-type']).toBe('image/jpeg');
    expect(createHash('sha256').update(await reviewerPhoto.body()).digest('hex')).toBe(createHash('sha256').update(photo).digest('hex'));
    await selectTab(consultant.getByRole('tab', { name: 'Field approvals', exact: true }), consultant.getByRole('tabpanel', { name: 'Field approvals', exact: true }));
    await evidenceRow.getByRole('button', { name: 'Approve evidence', exact: true }).click();
    await expect(evidenceRow).toContainText('Approved');

    await page.goto('/construction/operations');
    await selectTab(page.getByRole('tab', { name: 'Field approvals', exact: true }), page.getByRole('tabpanel', { name: 'Field approvals', exact: true }));
    const fieldApprovals = page.getByRole('tabpanel', { name: 'Field approvals', exact: true });
    await fieldApprovals.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: firstName });
    await fieldApprovals.getByRole('combobox', { name: 'Approval type', exact: true }).selectOption('handover');
    await fieldApprovals.getByLabel('Record reference', { exact: true }).fill(`PC-${id.toUpperCase()}`);
    await fieldApprovals.getByRole('combobox', { name: 'Evidence pack', exact: true }).selectOption({ label: `${evidenceTitle} · Approved` });
    const approvalTitle = `Practical completion ${id}`;
    await fieldApprovals.getByLabel('Title', { exact: true }).fill(approvalTitle);
    await fieldApprovals.getByLabel('Site summary', { exact: true }).fill('Fenced site evidence reviewed for controlled practical completion.');
    await fieldApprovals.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    await expect(fieldApprovals.getByRole('row', { name: new RegExp(approvalTitle) })).toContainText('Pending');

    await consultant.reload();
    await selectTab(consultant.getByRole('tab', { name: 'Field approvals', exact: true }), consultant.getByRole('tabpanel', { name: 'Field approvals', exact: true }));
    const approvalRow = consultant.getByRole('row', { name: new RegExp(approvalTitle) });
    await approvalRow.getByRole('button', { name: 'Approve work', exact: true }).click();
    await expect(approvalRow).toContainText('Approved');

    await page.goto('/construction/operations');
    const handoverTab = page.getByRole('tab', { name: 'Handover packs', exact: true });
    const finalHandover = page.getByRole('tabpanel', { name: 'Handover packs', exact: true });
    await expect(async () => {
      await selectTab(handoverTab, finalHandover);
      await finalHandover.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: firstName }, { timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [250, 500, 1000] });
    await expect(async () => {
      if (await finalHandover.getByRole('button', { name: 'Update draft pack', exact: true }).isVisible()) return;
      await finalHandover.getByRole('button', { name: 'Edit', exact: true }).first().click({ timeout: 3_000 });
      await expect(finalHandover.getByRole('button', { name: 'Update draft pack', exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000, intervals: [250, 500, 1000] });
    await finalHandover.getByRole('combobox', { name: 'Evidence-backed handover approval', exact: true }).selectOption({ label: approvalTitle });
    for (const document of requiredFiles) {
      const chooser = finalHandover.getByRole('combobox', { name: document.label, exact: true });
      const value = await chooser.locator('option').filter({ hasText: document.number }).getAttribute('value');
      expect(value).toBeTruthy();
      await chooser.selectOption(value!);
    }
    await finalHandover.getByRole('button', { name: 'Update draft pack', exact: true }).click();
    await expect(finalHandover).toContainText('5/5 slots filled');
    await expect(finalHandover).toContainText('All required approved files present');
    await finalHandover.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(finalHandover).toContainText('submitted');
    await expect(finalHandover.getByRole('link', { name: 'Download signed pack ZIP', exact: false })).toHaveCount(0);

    await consultant.reload();
    await selectTab(consultant.getByRole('tab', { name: 'Handover packs', exact: true }), consultant.getByRole('tabpanel', { name: 'Handover packs', exact: true }));
    const consultantHandover = consultant.getByRole('tabpanel', { name: 'Handover packs', exact: true });
    await consultantHandover.getByRole('button', { name: 'Sign off', exact: true }).click();
    const archiveLink = consultantHandover.getByRole('link', { name: 'Download signed pack ZIP', exact: false });
    await expect(archiveLink).toBeVisible();
    const archiveHref = await archiveLink.getAttribute('href');
    expect(archiveHref).toMatch(/^\/api\/construction\/handover\/chp-/);
    const [download] = await Promise.all([consultant.waitForEvent('download'), archiveLink.click()]);
    expect(download.suggestedFilename()).toMatch(/^HDP-\d+\.zip$/);
    const archive = unzipSync(new Uint8Array(await readFile(await download.path())));
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as {
      projectId: string; approvedAtISO: string;
      signOff: { submittedBy: string; submittedAtISO: string; approvedBy: string; approvedAtISO: string; fieldApprovalId: string };
      documents: { filename: string; sha256: string }[];
    };
    expect(manifest.projectId).toBe(firstId);
    expect(manifest.approvedAtISO).toBeTruthy();
    expect(manifest.signOff.approvedAtISO).toBe(manifest.approvedAtISO);
    expect(manifest.signOff.approvedBy).toBeTruthy();
    expect(manifest.signOff.approvedBy).not.toBe(manifest.signOff.submittedBy);
    expect(manifest.signOff.fieldApprovalId).toMatch(/^cfa-/);
    expect(manifest.documents).toHaveLength(5);
    for (const document of manifest.documents) {
      expect(archive[document.filename]).toBeTruthy();
      expect(createHash('sha256').update(archive[document.filename]).digest('hex')).toBe(document.sha256);
    }

    const otherContext = await browser.newContext({ baseURL: process.env.PW_COMPANY_BASE_URL });
    try {
      const otherCompany = await otherContext.newPage();
      await createCompany(otherCompany, `foreign-${id}`);
      await otherCompany.goto('/construction/projects');
      await expect(otherCompany.getByRole('heading', { name: firstName, exact: true })).toHaveCount(0);
      await otherCompany.goto(`/construction/projects/${firstId}`);
      await expect(otherCompany.getByRole('heading', { name: firstName, exact: true })).toHaveCount(0);
      const foreignFile = await otherCompany.request.get(fileUrl!);
      expect([401, 403, 404]).toContain(foreignFile.status());
      const foreignPack = await otherCompany.request.get(archiveHref!);
      expect([401, 403, 404]).toContain(foreignPack.status());
    } finally { await otherContext.close(); }
  } finally { await Promise.all(memberships.map((row) => row.context.close())); }

  await page.goto(`/construction/projects/${firstId}/setup?section=lifecycle`);
  await page.getByLabel('Reason for transition', { exact: true }).fill('Site and contract team mobilised');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: `${firstName} · project setup`, exact: true })).toBeVisible();
});
