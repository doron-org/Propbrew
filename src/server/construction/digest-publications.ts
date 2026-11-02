import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCan, type Actor } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { weeklyDigest, type DigestSection } from '@/domain/construction';
import type { AuditEntry } from '@/domain/construction/types';
import { db, validateWorkspaceRecordState } from '@/server/data/store';
import { currentRecordContext, getRecordAuxiliary } from '@/server/data/record-context';
import { withDurableMutation } from '@/server/data/durable-records';
import { withWorkspaceState } from '@/server/data/workspace-postgres';
import { scopedConstructionProjectGet } from '@/server/data';
import { constructionWorld } from '@/server/reads/construction';
import { sendEmail } from '@/server/integrations/communications';
import { getActor } from '@/server/session';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { isDemoAccount } from '@/server/auth/demo-config';
import { operatingClock, operatingNowISO } from '@/server/operating-clock';

export type DigestDelivery = { email: string; status: 'pending' | 'sending' | 'accepted' | 'delayed' | 'delivered' | 'bounced' | 'failed' | 'simulated';
  attempts: number; providerEmailId?: string; previousProviderEmailIds?: string[]; lastAttemptISO?: string; deliveredISO?: string; error?: string; eventIds?: string[] };
export type DigestPublication = { id: string; tenantId: string; projectId: string; projectName: string; weekOfISO: string;
  sourceSha256: string; sections: DigestSection[]; coverageGaps: string[]; approvedByUserId: string; approvedByName: string;
  approvedAtISO: string; requestKey: string; recipients: DigestDelivery[]; simulated: boolean };

const inputSchema = z.object({ projectId: z.string().min(1).max(160), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestKey: z.uuid(), acknowledgeGaps: z.boolean(), recipients: z.array(z.email().max(254)).min(1).max(10) }).strict();
const tenantUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { ok: true; ref: string } | { ok: false; error: string };

export function digestSourceSha256(projectId: string, weekOfISO: string, sections: DigestSection[], coverageGaps: string[]): string {
  return createHash('sha256').update(JSON.stringify({ projectId, weekOfISO, sections, coverageGaps })).digest('hex');
}

export function reportingWeekOfISO(dateISO: string): string {
  const day = new Date(`${dateISO}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function digestPublications(write = false): DigestPublication[] {
  const context = currentRecordContext();
  if (write && context?.mode === 'read') throw new Error('A write transaction is required.');
  if (context && !write) {
    const value = context.state.auxiliary.constructionDigestPublications;
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Digest publication ledger is unavailable.');
    return value as DigestPublication[];
  }
  const value = getRecordAuxiliary<DigestPublication[]>('constructionDigestPublications', () => []);
  if (!Array.isArray(value)) throw new Error('Digest publication ledger is unavailable.');
  return value;
}

function audit(tenantId: string, projectId: string, actorId: string, actorName: string, summary: string, entityRef: string, atISO = operatingNowISO()) {
  db.constructionAudit.push({ tenantId, id: `au-digest-${randomUUID()}`, seq: db.constructionAudit.length + 1,
    atISO, actorId, actorName, actorRole: actorId === 'resend:webhook' ? 'delivery_provider' : 'construction_manager',
    action: 'record', entity: 'construction_digest', entityRef, projectId, summary } as AuditEntry);
}

async function publisher(): Promise<Actor> {
  const actor = await getActor();
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction')) throw new Error('Construction access required.');
  assertCan(actor, 'reports_analytics', 'update');
  return actor;
}

export async function publishConstructionDigest(input: unknown): Promise<Result> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose 1–10 valid recipient addresses and review the current digest.' };
  const data = parsed.data;
  const emails = data.recipients.map((value) => value.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) return { ok: false, error: 'Remove duplicate recipients.' };
  const created = await withDurableMutation(async () => {
    const actor = await publisher();
    const project = scopedConstructionProjectGet(actor, data.projectId, 'update');
    if (!project) return { ok: false as const, error: 'Project not found in your scope.' };
    const ledger = digestPublications(true);
    const existing = ledger.find((row) => row.tenantId === actor.tenantId && row.requestKey === data.requestKey);
    if (existing) return { ok: true as const, id: existing.id, fresh: false };
    const { nowMs, dateISO } = operatingClock();
    const draft = weeklyDigest(project, constructionWorld(actor), nowMs);
    const weekOfISO = reportingWeekOfISO(dateISO);
    const sourceSha256 = digestSourceSha256(project.id, weekOfISO, draft.sections, draft.coverageGaps);
    if (sourceSha256 !== data.sourceSha256) return { ok: false as const, error: 'The source records changed. Refresh and review the digest again.' };
    if (draft.coverageGaps.length && !data.acknowledgeGaps) return { ok: false as const, error: 'Review the missing approved-report dates before publication.' };
    if (ledger.some((row) => row.tenantId === actor.tenantId && row.projectId === project.id && row.weekOfISO === weekOfISO))
      return { ok: false as const, error: 'This project already has a publication for this reporting week. Retry failed recipients in its delivery record.' };
    const simulated = !nativeAuthEnabled() || isDemoAccount(actor.userId);
    const row: DigestPublication = { id: randomUUID(), tenantId: actor.tenantId!, projectId: project.id,
      projectName: project.name, weekOfISO, sourceSha256, sections: structuredClone(draft.sections),
      coverageGaps: [...draft.coverageGaps], approvedByUserId: actor.userId,
      approvedByName: db.users.find((user) => user.id === actor.userId)?.name ?? 'Project manager',
      approvedAtISO: operatingNowISO(), requestKey: data.requestKey, simulated,
      recipients: emails.map((email) => ({ email, status: simulated ? 'simulated' : 'pending', attempts: 0 })) };
    ledger.unshift(row);
    audit(row.tenantId, row.projectId, actor.userId, row.approvedByName,
      simulated ? 'Approved a private-demo digest; no external email sent' : `Approved weekly digest for ${emails.length} recipient(s)`, row.id);
    return { ok: true as const, id: row.id, fresh: true, simulated };
  }, 'construction', 'update');
  if (!created.ok) return created;
  if (!created.fresh) return { ok: true, ref: 'Publication already saved' };
  if (created.simulated) return { ok: true, ref: 'Saved in the private demo; no email sent' };
  for (const email of emails) await dispatchDigestRecipient(created.id, email);
  return { ok: true, ref: 'Publication saved; check recipient delivery status' };
}

export async function retryDigestRecipient(publicationId: string, emailInput: string): Promise<Result> {
  if (!tenantUuid.test(publicationId) || !z.email().safeParse(emailInput).success) return { ok: false, error: 'Recipient not found.' };
  const email = emailInput.toLowerCase();
  const prepared = await withDurableMutation(async () => {
    const actor = await publisher();
    const row = digestPublications(true).find((item) => item.id === publicationId && item.tenantId === actor.tenantId && !!scopedConstructionProjectGet(actor, item.projectId, 'update'));
    const recipient = row?.recipients.find((item) => item.email === email);
    const staleSending = !!recipient && recipient.status === 'sending' && !!recipient.lastAttemptISO && Date.now() - Date.parse(recipient.lastAttemptISO) >= 5 * 60_000;
    if (!row || !recipient || row.simulated || (!staleSending && !['failed', 'bounced', 'delayed', 'pending'].includes(recipient.status))) return { ok: false as const, error: 'This recipient is not ready for retry.' };
    if (staleSending && Date.now() - Date.parse(recipient.lastAttemptISO!) >= 23 * 60 * 60_000) return { ok: false as const, error: 'Check this older provider request before retrying to avoid a duplicate email.' };
    if (!staleSending && recipient.attempts >= 5) return { ok: false as const, error: 'Maximum attempts reached. Check the address with the recipient.' };
    if (!staleSending && recipient.lastAttemptISO && Date.now() - Date.parse(recipient.lastAttemptISO) < 60_000) return { ok: false as const, error: 'Wait one minute before retrying.' };
    if (staleSending) recipient.attempts = Math.max(0, recipient.attempts - 1); // Reuse Resend's 24-hour idempotency key.
    else if (recipient.providerEmailId) {
      recipient.previousProviderEmailIds = [...recipient.previousProviderEmailIds ?? [], recipient.providerEmailId].slice(-5);
      recipient.providerEmailId = undefined;
    }
    recipient.status = 'pending'; recipient.error = undefined;
    audit(row.tenantId, row.projectId, actor.userId, row.approvedByName, `Retry requested for digest recipient ${email}`, row.id);
    return { ok: true as const };
  }, 'construction', 'update');
  if (!prepared.ok) return prepared;
  await dispatchDigestRecipient(publicationId, email);
  return { ok: true, ref: 'Retry saved; check recipient delivery status' };
}

async function dispatchDigestRecipient(publicationId: string, email: string): Promise<void> {
  const prepared = await withDurableMutation(async () => {
    const actor = await publisher();
    const row = digestPublications(true).find((item) => item.id === publicationId && item.tenantId === actor.tenantId && !!scopedConstructionProjectGet(actor, item.projectId, 'update'));
    const recipient = row?.recipients.find((item) => item.email === email);
    if (!row || !recipient || recipient.status !== 'pending') return { ok: false as const, error: 'Pending recipient unavailable.' };
    recipient.status = 'sending'; recipient.attempts++; recipient.lastAttemptISO = operatingNowISO();
    return { ok: true as const, publication: structuredClone(row), attempt: recipient.attempts };
  }, 'construction', 'update');
  if (!prepared.ok) return;
  const { publication, attempt } = prepared;
  try {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.RESEND_WEBHOOK_SECRET) throw new Error('provider_not_configured');
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BETTER_AUTH_URL ?? '');
    if (origin.protocol !== 'https:') throw new Error('Public application URL is not configured.');
    const body = [`${publication.projectName} · construction weekly digest · ${publication.weekOfISO}`,
      `Approved by ${publication.approvedByName} on ${publication.approvedAtISO}.`,
      `Source SHA-256: ${publication.sourceSha256}`,
      ...publication.sections.map((section) => `${section.title}\n${section.text}\nSources: ${section.sources.map((source) => `${source.label} — ${new URL(source.href, origin).toString()}`).join(', ') || 'None supplied'}`),
      `Missing approved-report dates: ${publication.coverageGaps.join(', ') || 'None'}`,
      'This is a reviewed project summary. Rule-match scores are not independent verification.'].join('\n\n');
    const sent = await sendEmail({ to: email, purpose: `Propbrew weekly construction digest · ${publication.projectName} · ${publication.weekOfISO}`,
      body, tags: [{ name: 'propbrew_tenant', value: publication.tenantId }, { name: 'propbrew_digest', value: publication.id }],
      idempotencyKey: `propbrew-digest-${publication.id}-${createHash('sha256').update(email).digest('hex').slice(0, 12)}-${attempt}` });
    if (sent.id === 'accepted') throw new Error('Provider did not return a delivery reference.');
    await withDurableMutation(async () => {
      const actor = await publisher();
      const row = digestPublications(true).find((item) => item.id === publicationId && item.tenantId === actor.tenantId);
      const recipient = row?.recipients.find((item) => item.email === email);
      if (!row || !recipient) return;
      recipient.providerEmailId = sent.id;
      if (recipient.status === 'sending') recipient.status = 'accepted';
      recipient.error = undefined;
      audit(row.tenantId, row.projectId, actor.userId, row.approvedByName, `Digest email accepted by provider for ${email}`, row.id);
    }, 'construction', 'update');
  } catch (error) {
    await withDurableMutation(async () => {
      const actor = await publisher();
      const row = digestPublications(true).find((item) => item.id === publicationId && item.tenantId === actor.tenantId);
      const recipient = row?.recipients.find((item) => item.email === email);
      if (!row || !recipient) return;
      if (recipient.status !== 'sending') return;
      recipient.status = 'failed';
      if (error instanceof Error && error.message === 'provider_not_configured') { recipient.attempts--; recipient.lastAttemptISO = undefined; }
      recipient.error = error instanceof Error && error.message === 'provider_not_configured' ? 'Email sender or delivery callback is not configured. Retry after setup.' : 'Provider did not accept this email. Review and retry.';
      audit(row.tenantId, row.projectId, actor.userId, row.approvedByName, `Digest email failed for ${email}`, row.id);
    }, 'construction', 'update');
  }
}

export type ResendDigestEvent = { id: string; type: string; created_at: string; data: { email_id?: string; to?: string[]; tags?: Record<string, string> | { name: string; value: string }[] } };
export async function recordDigestDeliveryEvent(event: ResendDigestEvent): Promise<boolean> {
  const tags = Array.isArray(event.data.tags) ? Object.fromEntries(event.data.tags.map((tag) => [tag.name, tag.value])) : event.data.tags ?? {};
  const tenantId = tags.propbrew_tenant, publicationId = tags.propbrew_digest;
  if (!tenantId || !tenantUuid.test(tenantId) || !publicationId || !tenantUuid.test(publicationId) || !event.id || !event.data.email_id || !Number.isFinite(Date.parse(event.created_at))) return false;
  const states: Record<string, DigestDelivery['status']> = { 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed',
    'email.bounced': 'bounced', 'email.complained': 'bounced', 'email.suppressed': 'bounced' };
  const next = states[event.type];
  if (!next) return false;
  return withWorkspaceState(tenantId, tenantId, 'write', () => { throw new Error('Workspace unavailable.'); }, async (payload) => {
    const state = validateWorkspaceRecordState(payload, tenantId);
    const rows = state.auxiliary.constructionDigestPublications as DigestPublication[] | undefined;
    const row = rows?.find((item) => item.tenantId === tenantId && item.id === publicationId);
    const recipient = row?.recipients.find((item) => !item.previousProviderEmailIds?.includes(event.data.email_id!) &&
      (item.providerEmailId === event.data.email_id ||
      (!item.providerEmailId && event.data.to?.some((to) => to.toLowerCase() === item.email))));
    if (!row || !recipient) return { value: false, payload: state, commit: false };
    if (recipient.eventIds?.includes(event.id)) return { value: true, payload: state, commit: false };
    recipient.eventIds = [...recipient.eventIds ?? [], event.id].slice(-30);
    recipient.providerEmailId = event.data.email_id;
    if (recipient.status !== 'delivered' || next === 'delivered') recipient.status = next;
    if (next === 'delivered') recipient.deliveredISO = event.created_at;
    const audits = state.collections.constructionAudit as AuditEntry[];
    audits.push({ tenantId: tenantId as AuditEntry['tenantId'], id: `au-digest-${randomUUID()}`, seq: audits.length + 1,
      atISO: event.created_at, actorId: 'resend:webhook', actorName: 'Resend', actorRole: 'delivery_provider', action: 'record',
      entity: 'construction_digest', entityRef: row.id, projectId: row.projectId, summary: `Provider reported ${event.type} for digest recipient ${recipient.email}` });
    return { value: true, payload: state };
  });
}
