import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialWorkspaceRecordState } from '@/server/data/store';
import { runWithRecordContext, type WorkspaceRecordState } from '@/server/data/record-context';

const boundary = vi.hoisted(() => ({ state: undefined as WorkspaceRecordState | undefined }));
vi.mock('@/server/data/workspace-postgres', () => ({ withWorkspaceState: async (_tenantId: string, _domainTenantId: string, _mode: string,
  _initialize: () => unknown, fn: (payload: unknown) => Promise<{ value: unknown; commit?: boolean; payload?: unknown }>) => {
  const result = await fn(boundary.state);
  if (result.commit !== false && result.payload) boundary.state = result.payload as WorkspaceRecordState;
  return result.value;
} }));

import { acknowledgePublicDigestReceipt, digestPublications, digestSourceSha256, publicDigestReceipt, recordDigestDeliveryEvent, reportingWeekOfISO, type DigestPublication } from '@/server/construction/digest-publications';
import { recordTransmittalDeliveryEvent } from '@/server/construction/transmittal-delivery';
import { createHash } from 'node:crypto';
import { signDigestReceiptClaim, verifyDigestReceiptClaim } from '@/server/construction/digest-receipt-tokens';

const tenant = '11111111-1111-4111-8111-111111111111';
const publicationId = '22222222-2222-4222-8222-222222222222';
const emailId = '33333333-3333-4333-8333-333333333333';
const at = '2026-11-02T09:00:00.000Z';

beforeEach(() => { boundary.state = initialWorkspaceRecordState(tenant); process.env.CONSTRUCTION_TRANSMITTAL_SECRET = 'test-secret-for-digest-receipts-at-least-32-characters'; });

describe('Construction digest and transmittal delivery records', () => {
  it('persists an approved digest snapshot across a state reload and changes its fingerprint when sources change', () => {
    expect(reportingWeekOfISO('2026-11-04')).toBe('2026-11-02');
    const state = boundary.state!;
    const row: DigestPublication = { id: publicationId, tenantId: tenant, projectId: 'project-1', projectName: 'Project 1', weekOfISO: '2026-11-02',
      sourceSha256: digestSourceSha256('project-1', '2026-11-02', [{ title: 'Progress', text: 'Approved', confidence: .9, sources: [] }], []),
      sections: [{ title: 'Progress', text: 'Approved', confidence: .9, sources: [] }], coverageGaps: [], approvedByUserId: 'manager', approvedByName: 'Manager',
      approvedAtISO: at, requestKey: publicationId, simulated: false, recipients: [{ email: 'delivered@resend.dev', status: 'accepted', attempts: 1, providerEmailId: emailId }] };
    runWithRecordContext({ state, domainTenantId: tenant, mode: 'write' }, () => digestPublications(true).push(row));
    const reloaded = JSON.parse(JSON.stringify(state)) as WorkspaceRecordState;
    expect(runWithRecordContext({ state: reloaded, domainTenantId: tenant, mode: 'read' }, () => digestPublications())).toEqual([row]);
    expect(digestSourceSha256(row.projectId, row.weekOfISO, [{ ...row.sections[0], text: 'Changed' }], [])).not.toBe(row.sourceSha256);
  });

  it('records a signed-provider delivered result once for the matching tenant and recipient', async () => {
    const state = boundary.state!;
    state.auxiliary.constructionDigestPublications = [{ id: publicationId, tenantId: tenant, projectId: 'project-1', projectName: 'Project 1', weekOfISO: '2026-11-02',
      sourceSha256: 'a'.repeat(64), sections: [], coverageGaps: [], approvedByUserId: 'manager', approvedByName: 'Manager',
      approvedAtISO: at, requestKey: publicationId, simulated: false,
      recipients: [{ email: 'delivered@resend.dev', status: 'accepted', attempts: 1, providerEmailId: emailId }] }] satisfies DigestPublication[];
    const event = { id: 'evt-1', type: 'email.delivered', created_at: at, data: { email_id: emailId, to: ['delivered@resend.dev'],
      tags: { propbrew_tenant: tenant, propbrew_digest: publicationId } } };
    expect(await recordDigestDeliveryEvent(event)).toBe(true);
    expect(await recordDigestDeliveryEvent(event)).toBe(true);
    const row = (boundary.state!.auxiliary.constructionDigestPublications as DigestPublication[])[0];
    expect(row.recipients[0].status).toBe('delivered');
    expect(row.recipients[0].eventIds).toEqual(['evt-1']);
    expect((boundary.state!.collections.constructionAudit as unknown[])).toHaveLength(1);
    expect(await recordDigestDeliveryEvent({ ...event, id: 'evt-2', data: { ...event.data, tags: { ...event.data.tags, propbrew_digest: '99999999-9999-4999-8999-999999999999' } } })).toBe(false);
  });

  it('accepts one recipient-bound digest receipt and saves its audit after reload', async () => {
    const state = boundary.state!;
    state.auxiliary.constructionDigestPublications = [{ id: publicationId, tenantId: tenant, projectId: 'project-1', projectName: 'Project 1', weekOfISO: '2026-11-02',
      sourceSha256: 'a'.repeat(64), sections: [], coverageGaps: [], approvedByUserId: 'manager', approvedByName: 'Manager',
      approvedAtISO: at, requestKey: publicationId, simulated: false,
      recipients: [{ email: 'pilot@example.com', status: 'delivered', attempts: 1, providerEmailId: emailId }] }] satisfies DigestPublication[];
    const expiresISO = new Date(Date.parse(at) + 30 * 86400000).toISOString();
    const token = signDigestReceiptClaim({ tenantId: tenant, publicationId, emailHash: createHash('sha256').update('pilot@example.com').digest('hex'), expiresISO });
    expect(verifyDigestReceiptClaim(token)).not.toBeNull();
    expect(verifyDigestReceiptClaim(token + 'x')).toBeNull();
    expect(verifyDigestReceiptClaim(token, Date.parse(expiresISO))).toBeNull();
    const otherRecipientToken = signDigestReceiptClaim({ tenantId: tenant, publicationId,
      emailHash: createHash('sha256').update('another@example.com').digest('hex'), expiresISO });
    expect(await publicDigestReceipt(otherRecipientToken)).toBeNull();
    expect(await acknowledgePublicDigestReceipt(otherRecipientToken, { name: 'Other Recipient', organisation: 'Elsewhere', confirmed: 'yes' })).toMatchObject({ ok: false });
    expect(await publicDigestReceipt(token)).toMatchObject({ projectName: 'Project 1', weekOfISO: '2026-11-02' });
    expect(await acknowledgePublicDigestReceipt(token, { name: 'Pilot Operator', organisation: 'Propbrew QA', confirmed: 'yes' })).toEqual({ ok: true });
    expect(await acknowledgePublicDigestReceipt(token, { name: 'Pilot Operator', organisation: 'Propbrew QA', confirmed: 'yes' })).toEqual({ ok: true });
    const reloaded = JSON.parse(JSON.stringify(boundary.state)) as WorkspaceRecordState;
    expect((reloaded.auxiliary.constructionDigestPublications as DigestPublication[])[0].recipients[0]).toMatchObject({
      acknowledgedBy: 'Pilot Operator', acknowledgedOrganisation: 'Propbrew QA', status: 'delivered' });
    expect(reloaded.collections.constructionAudit).toHaveLength(1);
    expect(await acknowledgePublicDigestReceipt(token.slice(0, -1) + 'x', { name: 'Other', organisation: 'Elsewhere', confirmed: 'yes' })).toMatchObject({ ok: false });
  });

  it('accepts a valid tenant UUID in a transmittal callback and records a bounce', async () => {
    const state = boundary.state!;
    (state.collections.constructionTransmittals as Record<string, unknown>[]).push({ tenantId: tenant, id: 'tr-new-1', projectId: 'project-1',
      docId: 'doc-1', docNumber: 'D-1', revision: 'A', toParty: 'Consultant', recipientEmail: 'bounced@resend.dev',
      sentISO: at, purpose: 'for_review', deliveryStatus: 'accepted', providerEmailId: emailId });
    expect(await recordTransmittalDeliveryEvent({ id: 'evt-bounced', type: 'email.bounced', created_at: at,
      data: { email_id: emailId, to: ['bounced@resend.dev'], tags: { propbrew_tenant: tenant, propbrew_transmittal: 'tr-new-1' } } })).toBe(true);
    expect((boundary.state!.collections.constructionTransmittals as { deliveryStatus: string }[]).at(-1)?.deliveryStatus).toBe('bounced');
  });

  it('records a failed provider event for a matching digest and transmittal', async () => {
    const state = boundary.state!;
    state.auxiliary.constructionDigestPublications = [{ id: publicationId, tenantId: tenant, projectId: 'project-1', projectName: 'Project 1', weekOfISO: '2026-11-02',
      sourceSha256: 'a'.repeat(64), sections: [], coverageGaps: [], approvedByUserId: 'manager', approvedByName: 'Manager',
      approvedAtISO: at, requestKey: publicationId, simulated: false,
      recipients: [{ email: 'failed@resend.dev', status: 'accepted', attempts: 1, providerEmailId: emailId }] }] satisfies DigestPublication[];
    expect(await recordDigestDeliveryEvent({ id: 'evt-failed-digest', type: 'email.failed', created_at: at,
      data: { email_id: emailId, to: ['failed@resend.dev'], tags: { propbrew_tenant: tenant, propbrew_digest: publicationId } } })).toBe(true);
    expect((boundary.state!.auxiliary.constructionDigestPublications as DigestPublication[])[0].recipients[0].status).toBe('failed');

    (boundary.state!.collections.constructionTransmittals as Record<string, unknown>[]).push({ tenantId: tenant, id: 'tr-new-2', projectId: 'project-1',
      docId: 'doc-2', docNumber: 'D-2', revision: 'A', toParty: 'Consultant', recipientEmail: 'failed@resend.dev',
      sentISO: at, purpose: 'for_review', deliveryStatus: 'accepted', providerEmailId: emailId });
    expect(await recordTransmittalDeliveryEvent({ id: 'evt-failed-transmittal', type: 'email.failed', created_at: at,
      data: { email_id: emailId, to: ['failed@resend.dev'], tags: { propbrew_tenant: tenant, propbrew_transmittal: 'tr-new-2' } } })).toBe(true);
    expect((boundary.state!.collections.constructionTransmittals as { deliveryStatus: string }[]).at(-1)?.deliveryStatus).toBe('failed');
  });
});
