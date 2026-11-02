import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCan, type Actor } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { db, validateWorkspaceRecordState } from '@/server/data/store';
import { scopedMutableGet } from '@/server/data';
import { withDurableMutation } from '@/server/data/durable-records';
import { withWorkspaceState } from '@/server/data/workspace-postgres';
import { nextRecordSequence } from '@/server/data/record-context';
import { getActor } from '@/server/session';
import { isDemoAccount } from '@/server/auth/demo-config';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { operatingNowISO } from '@/server/operating-clock';
import { constructionDrawingEditable, readConstructionDrawing } from './drawings';
import { sendEmail } from '@/server/integrations/communications';
import { signTransmittalClaim, verifyTransmittalClaim } from './transmittal-tokens';
import type { Transmittal, ConstructionDoc, AuditEntry, Project } from '@/domain/construction/types';

const issueSchema = z.object({
  docId: z.string().min(1).max(200), toParty: z.string().trim().min(2).max(120),
  recipientEmail: z.email().max(254), purpose: z.enum(['for_construction', 'for_review', 'for_information']),
  requestKey: z.uuid(),
}).strict();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const expiry = () => new Date(Date.now() + 30 * 86400000).toISOString();
export type DistributionResult = { ok: true; id: string; deliveryStatus: string; message: string } | { ok: false; error: string };

function audit(actor: Actor, transmittal: Transmittal, summary: string): void {
  db.constructionAudit.push({ tenantId: actor.tenantId!, id: `au-transmittal-${randomUUID()}`, seq: db.constructionAudit.length + 1,
    atISO: operatingNowISO(), actorId: actor.userId, actorName: db.users.find((row) => row.id === actor.userId)?.name ?? 'Project team',
    actorRole: actor.roles[0] ?? 'unknown', action: 'issue', entity: 'construction_transmittal', entityRef: transmittal.id,
    projectId: transmittal.projectId, summary } as AuditEntry);
}
function authorisedActor(action: 'create' | 'update'): Promise<Actor> {
  return getActor().then((actor) => {
    if (!actor.tenantId || !canEnterWorkspace(actor, 'construction')) throw new Error('Construction access required.');
    assertCan(actor, 'reports_analytics', action);
    return actor;
  });
}
function eligibleDoc(actor: Actor, docId: string, purpose: Transmittal['purpose']): ConstructionDoc | null {
  const doc = scopedMutableGet(actor, 'reports_analytics', db.constructionDocs, docId, 'update');
  if (!doc || !constructionDrawingEditable(actor, doc) || !doc.fileId || !doc.fileSha256) return null;
  if (purpose === 'for_construction' && doc.status !== 'approved') return null;
  if (doc.status === 'superseded' && purpose === 'for_construction') return null;
  return doc;
}

/** Commit the issue first; a provider failure cannot erase the controlled record. */
export async function issueExternalTransmittal(input: unknown): Promise<DistributionResult> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a recipient name, valid email and issue purpose.' };
  const created = await withDurableMutation(async () => {
    const actor = await authorisedActor('update');
    const data = parsed.data;
    const existing = db.constructionTransmittals.find((row) => row.tenantId === actor.tenantId && row.createdByUserId === actor.userId && row.requestKey === data.requestKey);
    if (existing) return { ok: true as const, id: existing.id, status: existing.deliveryStatus ?? 'pending', fresh: false };
    const doc = eligibleDoc(actor, data.docId, data.purpose);
    if (!doc) return { ok: false as const, error: 'Attach a PDF to a revision you can issue. Construction issues require approval.' };
    const simulated = !nativeAuthEnabled() || isDemoAccount(actor.userId);
    const row: Transmittal = { tenantId: actor.tenantId! as Transmittal['tenantId'], id: `tr-new-${nextRecordSequence('construction:trSeq', 0, true)}`,
      projectId: doc.projectId, docId: doc.id, docNumber: doc.number, revision: doc.revision,
      toParty: data.toParty, recipientEmail: data.recipientEmail.toLowerCase(), sentISO: operatingNowISO(), purpose: data.purpose,
      createdByUserId: actor.userId, requestKey: data.requestKey, issuedFileSha256: doc.fileSha256, deliveryStatus: simulated ? 'simulated' : 'pending',
      deliveryAttempts: 0, acknowledgementExpiresISO: expiry() };
    db.constructionTransmittals.unshift(row);
    audit(actor, row, simulated ? 'Simulated external distribution in a private demo' : `Created external issue of ${doc.number} rev ${doc.revision}`);
    return { ok: true as const, id: row.id, status: row.deliveryStatus!, fresh: true };
  }, 'construction', 'update');
  if (!created.ok) return created;
  if (!created.fresh || created.status === 'simulated') return { ok: true, id: created.id, deliveryStatus: created.status, message: created.status === 'simulated' ? 'Demo issue recorded. No email was sent.' : 'This issue was already recorded.' };
  return dispatch(created.id);
}

/** Retry a failed delivery with the same document revision and recipient. */
export async function retryExternalTransmittal(id: string): Promise<DistributionResult> {
  if (!/^tr-new-[1-9][0-9]{0,12}$/.test(id)) return { ok: false, error: 'Transmittal not found.' };
  const prepared = await withDurableMutation(async () => {
    const actor = await authorisedActor('update');
    const row = scopedMutableGet(actor, 'reports_analytics', db.constructionTransmittals, id, 'update');
    const doc = row && eligibleDoc(actor, row.docId, row.purpose);
    if (!row || !row.recipientEmail || !row.projectId || !doc || doc.fileSha256 !== row.issuedFileSha256) return { ok: false as const, error: 'Transmittal unavailable.' };
    const staleSending = row.deliveryStatus === 'sending' && !!row.lastAttemptISO && Date.now() - Date.parse(row.lastAttemptISO) >= 5 * 60_000;
    if (!staleSending && !['failed', 'bounced', 'delayed', 'pending'].includes(row.deliveryStatus ?? '')) return { ok: false as const, error: 'This issue is already with the provider or acknowledged.' };
    if (staleSending && Date.now() - Date.parse(row.lastAttemptISO!) >= 23 * 60 * 60_000) return { ok: false as const, error: 'Check this older provider request before retrying to avoid a duplicate email.' };
    if (!staleSending && (row.deliveryAttempts ?? 0) >= 5) return { ok: false as const, error: 'Maximum delivery attempts reached. Review the recipient address.' };
    if (row.lastAttemptISO && Date.now() - Date.parse(row.lastAttemptISO) < (row.deliveryStatus === 'sending' ? 5 * 60_000 : 60_000)) return { ok: false as const, error: 'Wait before trying again.' };
    if (staleSending) row.deliveryAttempts = Math.max(0, (row.deliveryAttempts ?? 1) - 1); // Reuse the provider's idempotency key.
    row.deliveryStatus = 'pending'; row.deliveryError = undefined; row.acknowledgementExpiresISO = expiry();
    audit(actor, row, `Retry requested for external issue ${row.docNumber} rev ${row.revision}`);
    return { ok: true as const };
  }, 'construction');
  return prepared.ok ? dispatch(id) : prepared;
}

async function dispatch(id: string): Promise<DistributionResult> {
  const prepared = await withDurableMutation(async () => {
    const actor = await authorisedActor('update');
    const row = scopedMutableGet(actor, 'reports_analytics', db.constructionTransmittals, id, 'update');
    if (!row || !row.recipientEmail || !row.projectId || !row.acknowledgementExpiresISO || row.deliveryStatus !== 'pending') return { ok: false as const, error: 'Pending transmittal unavailable.' };
    const doc = eligibleDoc(actor, row.docId, row.purpose);
    if (!doc || doc.fileSha256 !== row.issuedFileSha256) return { ok: false as const, error: 'The issued PDF is unavailable.' };
    row.deliveryStatus = 'sending'; row.deliveryAttempts = (row.deliveryAttempts ?? 0) + 1; row.lastAttemptISO = operatingNowISO();
    return { ok: true as const, tenantId: actor.tenantId!, row: { ...row }, fileId: doc.fileId!, fileSha256: doc.fileSha256! };
  }, 'construction');
  if (!prepared.ok) return prepared;
  const { row, tenantId } = prepared;
  try {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.RESEND_WEBHOOK_SECRET) throw new Error('provider_not_configured');
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BETTER_AUTH_URL ?? '');
    if (origin.protocol !== 'https:') throw new Error('Public application URL is not configured.');
    const file = await readConstructionDrawing(prepared.fileId);
    if (createHash('sha256').update(file.bytes).digest('hex') !== prepared.fileSha256) throw new Error('Drawing integrity check failed.');
    const token = signTransmittalClaim({ tenantId, id, expiresISO: row.acknowledgementExpiresISO! });
    const url = new URL('/construction/transmittals/acknowledge', origin);
    url.searchParams.set('token', token);
    const purpose = row.purpose.replaceAll('_', ' ');
    const sent = await sendEmail({ to: row.recipientEmail!, purpose: `Propbrew document issue ${row.docNumber} rev ${row.revision}`,
      body: `A construction drawing has been issued to ${row.toParty}.\n\nDocument: ${row.docNumber} revision ${row.revision}\nPurpose: ${purpose}\nPDF SHA-256: ${prepared.fileSha256}\n\nThe controlled PDF is attached. Acknowledge receipt at ${url.toString()}\n\nThe acknowledgement confirms receipt, not technical approval. The link expires in 30 days.`,
      attachments: [{ filename: file.name, content: Buffer.from(file.bytes).toString('base64') }],
      tags: [{ name: 'propbrew_tenant', value: tenantId }, { name: 'propbrew_transmittal', value: id }],
      idempotencyKey: `propbrew-${id}-${row.deliveryAttempts}` });
    if (sent.id === 'accepted') throw new Error('Email provider did not return a delivery reference.');
    return withDurableMutation(async () => {
      const actor = await authorisedActor('update');
      const current = scopedMutableGet(actor, 'reports_analytics', db.constructionTransmittals, id, 'update');
      if (!current) return { ok: false as const, error: 'Transmittal unavailable after provider acceptance.' };
      current.providerEmailId = sent.id; current.providerAcceptedISO = operatingNowISO();
      if (current.deliveryStatus === 'sending') current.deliveryStatus = 'accepted';
      current.deliveryError = undefined;
      audit(actor, current, `Email provider accepted external issue ${current.docNumber} rev ${current.revision}`);
      return { ok: true as const, id, deliveryStatus: current.deliveryStatus ?? 'accepted', message: 'Issue emailed with its PDF; awaiting delivery and recipient acknowledgement.' };
    }, 'construction');
  } catch (error) {
    return withDurableMutation(async () => {
      const actor = await authorisedActor('update');
      const current = scopedMutableGet(actor, 'reports_analytics', db.constructionTransmittals, id, 'update');
      if (!current) return { ok: false as const, error: 'Transmittal unavailable.' };
      if (current.deliveryStatus === 'sending') current.deliveryStatus = 'failed';
      if (error instanceof Error && error.message === 'provider_not_configured') {
        current.deliveryAttempts = Math.max(0, (current.deliveryAttempts ?? 1) - 1);
        current.lastAttemptISO = undefined;
      }
      current.deliveryError = error instanceof Error && error.message === 'provider_not_configured'
        ? 'External email is not configured for this deployment. Ask an administrator to connect the sender and delivery callback, then retry.'
        : 'Email delivery could not be started. Check the provider setup and retry.';
      audit(actor, current, `External delivery failed for ${current.docNumber} rev ${current.revision}`);
      return { ok: true as const, id, deliveryStatus: current.deliveryStatus ?? 'failed', message: current.deliveryError };
    }, 'construction');
  }
}

function publicWorkspace<T>(tenantId: string, mode: 'read' | 'write', fn: (rows: Transmittal[], projects: Project[], audits: AuditEntry[]) => { value: T; commit?: boolean }): Promise<T> {
  return withWorkspaceState(tenantId, tenantId, mode, () => { throw new Error('Workspace unavailable.'); }, async (payload) => {
    const state = validateWorkspaceRecordState(payload, tenantId);
    const rows = state.collections.constructionTransmittals as Transmittal[];
    const projects = state.collections.constructionProjects as Project[];
    const audits = state.collections.constructionAudit as AuditEntry[];
    const result = fn(rows, projects, audits);
    return { ...result, payload: state };
  });
}

export async function publicTransmittal(token: string): Promise<{ id: string; projectName: string; docNumber: string; revision: string; purpose: string; toParty: string; acknowledgedISO?: string } | null> {
  const claim = verifyTransmittalClaim(token);
  if (!claim) return null;
  return publicWorkspace(claim.tenantId, 'read', (rows, projects) => {
    const row = rows.find((item) => item.id === claim.id && item.tenantId === claim.tenantId && item.acknowledgementExpiresISO === claim.expiresISO && item.recipientEmail && ['accepted', 'delivered'].includes(item.deliveryStatus ?? ''));
    return { value: row ? { id: row.id, projectName: projects.find((item) => item.id === row.projectId)?.name ?? 'Construction project', docNumber: row.docNumber, revision: row.revision, purpose: row.purpose, toParty: row.toParty, acknowledgedISO: row.acknowledgedISO } : null };
  });
}

export async function acknowledgePublicTransmittal(token: string, input: unknown): Promise<{ ok: boolean; error?: string }> {
  const claim = verifyTransmittalClaim(token);
  if (!claim) return { ok: false, error: 'This acknowledgement link is invalid or expired.' };
  const parsed = z.object({ name: z.string().trim().min(2).max(120), organisation: z.string().trim().min(2).max(120), confirmed: z.literal('yes') }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter your name and organisation, then confirm receipt.' };
  return publicWorkspace<{ ok: boolean; error?: string }>(claim.tenantId, 'write', (rows, _projects, audits) => {
    const row = rows.find((item) => item.id === claim.id && item.tenantId === claim.tenantId && item.acknowledgementExpiresISO === claim.expiresISO && item.recipientEmail && ['accepted', 'delivered'].includes(item.deliveryStatus ?? ''));
    if (!row) return { value: { ok: false, error: 'This issue is unavailable.' }, commit: false };
    if (row.acknowledgedISO) return { value: { ok: true }, commit: false };
    row.acknowledgedISO = operatingNowISO(); row.acknowledgedBy = parsed.data.name; row.acknowledgedOrganisation = parsed.data.organisation;
    audits.push({ tenantId: claim.tenantId as AuditEntry['tenantId'], id: `au-transmittal-${randomUUID()}`, seq: audits.length + 1,
      atISO: row.acknowledgedISO, actorId: `external:${row.id}`, actorName: parsed.data.name, actorRole: 'external_recipient', action: 'record',
      entity: 'construction_transmittal', entityRef: row.id, projectId: row.projectId, summary: `External recipient acknowledged ${row.docNumber} rev ${row.revision}` });
    return { value: { ok: true } };
  });
}

export type ResendTransmittalEvent = { id: string; type: string; created_at: string; data: { email_id?: string; to?: string[]; tags?: Record<string, string> | { name: string; value: string }[] } };
export async function recordTransmittalDeliveryEvent(event: ResendTransmittalEvent): Promise<boolean> {
  const tags = Array.isArray(event.data.tags) ? Object.fromEntries(event.data.tags.map((tag) => [tag.name, tag.value])) : event.data.tags ?? {};
  const tenantId = tags.propbrew_tenant, id = tags.propbrew_transmittal;
  if (!tenantId || !uuid.test(tenantId) || !/^tr-new-[1-9][0-9]{0,12}$/.test(id ?? '') || !event.data.email_id || !event.id || !Number.isFinite(Date.parse(event.created_at))) return false;
  const states: Record<string, Transmittal['deliveryStatus']> = { 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.bounced': 'bounced', 'email.complained': 'bounced', 'email.suppressed': 'bounced', 'email.failed': 'failed' };
  const next = states[event.type]; if (!next) return false;
  return publicWorkspace(tenantId, 'write', (rows, _projects, audits) => {
    const row = rows.find((item) => item.id === id && item.tenantId === tenantId && item.recipientEmail &&
      (item.providerEmailId ? item.providerEmailId === event.data.email_id : event.data.to?.some((to) => to.toLowerCase() === item.recipientEmail)));
    if (!row) return { value: false, commit: false };
    if (row.deliveryEventIds?.includes(event.id)) return { value: true, commit: false };
    row.deliveryEventIds = [...(row.deliveryEventIds ?? []), event.id].slice(-30);
    row.providerEmailId = event.data.email_id;
    // A delayed/bounced replay cannot erase a later delivery receipt.
    if (row.deliveryStatus !== 'delivered' || next === 'delivered') row.deliveryStatus = next;
    if (next === 'delivered') row.deliveredISO = event.created_at;
    audits.push({ tenantId: tenantId as AuditEntry['tenantId'], id: `au-transmittal-${randomUUID()}`, seq: audits.length + 1,
      atISO: event.created_at, actorId: 'resend:webhook', actorName: 'Resend', actorRole: 'delivery_provider', action: 'record',
      entity: 'construction_transmittal', entityRef: row.id, projectId: row.projectId, summary: `Provider reported ${event.type} for ${row.docNumber} rev ${row.revision}` });
    return { value: true };
  });
}
