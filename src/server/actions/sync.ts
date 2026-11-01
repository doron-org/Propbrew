'use server';

import { operatingDateISO, operatingNowISO } from '@/server/operating-clock';

import { withDurableMutation } from '@/server/data/durable-records';
import { currentRecordContext, retainPendingSyncReceipt } from '@/server/data/record-context';

import { revalidatePath } from 'next/cache';
import { getActor } from '@/server/session';
import { ForbiddenError, assertCan, type Actor } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { db } from '@/server/data/store';
import { scopedConstructionProjectGet, scopedConstructionTaskGet, scopedMutableGet } from '@/server/data';
import { money } from '@/domain/primitives';
import { createHash } from 'node:crypto';
import { constructionControl } from '@/server/construction-control';
import { assessFieldCheckIn } from '@/domain/construction/field-check-in';
import { canCaptureConstructionTask } from '@/server/mobile/construction-task-access';

import { outboxOwnerKey, type OpKind, type SyncOutcome } from '@/domain/sync';
import { syncFingerprint, syncInputSchema } from '@/server/sync-validation';

const PATHS = ['/construction', '/construction/site', '/construction/field', '/construction/workforce', '/construction/safety', '/construction/procurement', '/construction/schedule', '/construction/risk'];
const nameOf = (actor: Actor) => db.users.find((u) => u.id === actor.userId && u.tenantId === actor.tenantId)?.name ?? 'Site team';
export type SyncInput = { id: string; owner: string; kind: OpKind; capturedISO: string; payload: Record<string, unknown> };

function permitted(actor: Actor, kind: OpKind): boolean {
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction')) return false;
  if (actor.companyAccess?.operationalProfileId === 'construction-field-worker'
    && !['task_progress', 'safety_event', 'evidence_pack', 'field_check_in'].includes(kind)) return false;
  try { assertCan(actor, 'reports_analytics', kind === 'task_progress' ? 'update' : 'create'); return true; }
  catch (e) { if (e instanceof ForbiddenError) return false; throw e; }
}

/** Re-check permission, payload and parent/child scope before recording a receipt. */
export async function syncOperation(raw: SyncInput): Promise<SyncOutcome> {
  return withDurableMutation(async () => {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const fail = (error: string): SyncOutcome => ({ ok: false, id, conflict: false, error });
  const conflict = (error: string, serverState: string): SyncOutcome => ({ ok: false, id, conflict: true, error, serverState });
  const actor = await getActor();
  if (!permitted(actor, raw?.kind) || raw?.owner !== outboxOwnerKey(actor.tenantId, actor.userId)) return fail('You no longer have permission to submit this construction record.');
  const parsed = syncInputSchema.safeParse(raw);
  if (!parsed.success) return fail('Review the captured fields, dates, numbers and uploaded attachments before syncing.');
  const input = parsed.data, p = input.payload;
  const recordContext = currentRecordContext();
  const resetAt = recordContext?.companyPrincipal?.sandbox ? recordContext.state.auxiliary.demoResetAt : undefined;
  if (typeof resetAt === 'string' && (!Number.isFinite(Date.parse(resetAt)) || Date.parse(input.capturedISO) <= Date.parse(resetAt))) {
    return conflict('This capture predates your sandbox reset. Discard the old copy and capture a new record.', 'Sandbox reset');
  }
  const project = scopedConstructionProjectGet(actor, p.projectId, 'read');
  if (!project) return fail('That project is not available to this account.');
  if (input.kind === 'task_progress') {
    const task = scopedConstructionTaskGet(actor, input.payload.taskId, 'update');
    if (!task || task.projectId !== p.projectId || !canCaptureConstructionTask(actor, task.id)) return fail('Task and project assignment not found.');
  }
  if (['construction-field-worker', 'subcontractor', 'site-engineer'].includes(actor.companyAccess?.operationalProfileId ?? '') && input.kind === 'evidence_pack') {
    const task = input.payload.subject === 'task' ? scopedConstructionTaskGet(actor, input.payload.subjectRef, 'read') : null;
    if (!task || task.projectId !== p.projectId || !canCaptureConstructionTask(actor, task.id)) return fail('Scoped members may attach evidence only to their assigned tasks.');
  }
  // Native photos have an upload ledger. Browser Field Capture uses the older
  // /api/upload path, whose evidence subjects include reports and deliveries.
  if (input.kind === 'evidence_pack' && input.payload.mediaRefs.some((url) => url.includes('/api/construction/field-photos/'))) {
    if (input.payload.mediaRefs.some((url) => !/^https:\/\/app\.usepropbrew\.com\/api\/construction\/field-photos\/[0-9a-f-]{36}$/i.test(url))) return fail('Use only uploaded Construction field photos for this capture.');
    if (input.payload.subject !== 'task') return fail('Native evidence must be attached to a construction task.');
    const task = scopedConstructionTaskGet(actor, input.payload.subjectRef, 'read');
    if (!task || task.projectId !== p.projectId || !canCaptureConstructionTask(actor, task.id)) return fail('The evidence task is no longer available to this account.');
    const uploads = constructionControl(actor.tenantId!).mobileUploads;
    if (new Set(input.payload.mediaRefs).size !== input.payload.mediaRefs.length || input.payload.mediaRefs.some((url) => !uploads.some((upload) =>
      upload.tenantId === actor.tenantId && upload.actorId === actor.userId && upload.projectId === p.projectId && upload.taskId === task.id && upload.url === url))) {
      return fail('Upload each photo for this assigned task before syncing its evidence.');
    }
  }
  if (input.kind === 'attendance') {
    const worker = scopedMutableGet(actor, 'reports_analytics', db.constructionWorkers, input.payload.workerId, 'read');
    if (!worker || worker.projectId !== p.projectId) return fail('Worker and project assignment not found.');
  }
  if (input.kind === 'material_request' && !db.constructionCostCodes.some((c) => c.tenantId === actor.tenantId && c.projectId === p.projectId && c.code === input.payload.costCode)) return fail('Choose a cost code assigned to this project.');
  if (input.kind === 'safety_event' && input.payload.zoneId && !db.constructionZones.some((z) => z.tenantId === actor.tenantId && z.projectId === p.projectId && z.id === input.payload.zoneId)) return fail('Choose a zone assigned to this project.');

  const payloadHash = syncFingerprint(input);
  let receipt = db.syncLedger.find((r) => r.tenantId === actor.tenantId && r.actorId === actor.userId && r.opId === id);
  if (receipt && (receipt.kind !== input.kind || receipt.payloadHash !== payloadHash)) return conflict('This capture ID belongs to different content. Capture a new record for an adjustment.', 'Idempotency key already used');
  if (receipt?.status === 'abandoned') return conflict('This offline copy was discarded and cannot be sent again.', 'Discarded by its author');
  if (receipt?.status === 'applied') return { ok: true, id, duplicate: true, ref: receipt.ref };
  if (!receipt) {
    receipt = { tenantId: project.tenantId, actorId: actor.userId, opId: id, kind: input.kind, payloadHash, status: 'pending', appliedISO: operatingNowISO() };
    db.syncLedger.push(receipt);
  }
  retainPendingSyncReceipt(receipt);
  const rowId = `sync-${syncFingerprint([actor.tenantId, actor.userId, id]).slice(0, 32)}`;
  let ref: string | undefined;
  switch (input.kind) {
    case 'daily_report': {
      const p = input.payload;
      const existing = db.constructionReports.find((r) => r.tenantId === actor.tenantId && r.projectId === p.projectId && r.dateISO === p.dateISO);
      if (existing && existing.status !== 'draft') return conflict(`A report for ${p.dateISO} is already ${existing.status}. Your offline copy was not applied.`, `${existing.status} · by ${existing.officer}`);
      const row = { ...p, tenantId: project.tenantId, id: existing?.id ?? rowId, weather: p.weather || 'Fair', officer: nameOf(actor), status: 'submitted' as const };
      if (existing) Object.assign(existing, row); else db.constructionReports.unshift(row);
      ref = `${p.dateISO} report`; break;
    }
    case 'site_issue': {
      const p = input.payload;
      db.constructionIssues.unshift({ tenantId: project.tenantId, id: rowId, projectId: p.projectId, category: p.category, title: p.title, severity: p.severity, owner: nameOf(actor), raisedISO: input.capturedISO.slice(0, 10), dueISO: '', status: 'open', correctiveAction: p.correctiveAction || 'To be agreed' });
      ref = p.title; break;
    }
    case 'attendance': {
      const p = input.payload;
      const existing = db.constructionAttendance.find((a) => a.tenantId === actor.tenantId && a.projectId === p.projectId && a.workerId === p.workerId && a.dateISO === p.dateISO);
      if (existing) return conflict(`${p.workerId} already has an attendance record for ${p.dateISO}.`, `${existing.status} · ${existing.method}`);
      db.constructionAttendance.unshift({ tenantId: project.tenantId, id: rowId, workerId: p.workerId, projectId: p.projectId, dateISO: p.dateISO, status: p.status, method: 'offline', withinGeofence: false, clockIn: p.status === 'present' ? p.clockIn : undefined, hours: 0, overtime: 0 });
      ref = `${p.workerId} · ${p.dateISO}`; break;
    }
    case 'field_check_in': {
      const p = input.payload;
      const assessment = assessFieldCheckIn(p, input.capturedISO, new Date().toISOString(), project.mobilisation?.locations ?? []);
      if (!assessment.ok) return conflict(assessment.error, 'No site check-in recorded');
      const state = constructionControl(actor.tenantId!);
      const prior = state.fieldCheckIns.find((row) => row.actorId === actor.userId && row.projectId === project.id && row.dateISO === assessment.dateISO);
      if (prior) return conflict('You already checked in to this project today.', `${prior.dateISO} · location attested`);
      state.fieldCheckIns.unshift({
        tenantId: project.tenantId, id: rowId, projectId: project.id, actorId: actor.userId,
        siteLocationId: assessment.siteLocationId, dateISO: assessment.dateISO,
        capturedAtISO: input.capturedISO, distanceMeters: assessment.distanceMeters,
        accuracyMeters: p.accuracyMeters, method: 'device_location_attested',
      });
      ref = `Site check-in · ${assessment.dateISO}`; break;
    }
    case 'material_request': {
      const p = input.payload;
      ref = `PR-SYNC-${rowId.slice(-12).toUpperCase()}`;
      db.constructionRequests.unshift({ tenantId: project.tenantId, id: rowId, ref, projectId: p.projectId, item: p.item, qty: p.qty, unit: p.unit, costCode: p.costCode, estimate: money(Math.round(p.estimateNaira * 100)), requiredISO: p.requiredISO, requestedBy: nameOf(actor), status: 'pending', justification: p.justification });
      break;
    }
    case 'task_progress': {
      const p = input.payload;
      const task = scopedConstructionTaskGet(actor, p.taskId, 'update')!;
      const pct = Math.round(p.percentComplete);
      if ((task.status === 'done' && pct < 100) || task.percentComplete > pct) return conflict(`“${task.name}” is already at ${task.percentComplete}% and cannot be reopened or reduced by offline sync.`, `${task.percentComplete}% complete`);
      if (pct > 0 && task.dependsOn.some((depId) => {
        const dep = db.constructionTasks.find((row) => row.id === depId && row.tenantId === actor.tenantId);
        return !dep || dep.projectId !== task.projectId || dep.status !== 'done';
      })) return conflict('Complete the predecessor tasks before recording progress.', 'Unfinished predecessor tasks');
      task.percentComplete = pct; task.status = pct === 0 ? 'not_started' : pct === 100 ? 'done' : 'in_progress';
      if (pct > 0 && !task.actualStartISO) task.actualStartISO = operatingDateISO();
      if (pct === 100 && !task.actualFinishISO) task.actualFinishISO = operatingDateISO();
      ref = task.name; break;
    }
    case 'safety_event': {
      const p = input.payload;
      db.constructionSafetyEvents.unshift({ tenantId: project.tenantId, id: rowId, projectId: p.projectId, kind: p.eventKind, title: p.title, zoneId: p.zoneId, atISO: input.capturedISO.slice(0, 10), reportedBy: nameOf(actor), lostDays: p.lostDays, closed: false, action: p.action });
      ref = p.title; break;
    }
    case 'evidence_pack': {
      const p = input.payload;
      const state = constructionControl(actor.tenantId!);
      const sha256 = createHash('sha256').update(JSON.stringify([p.projectId, p.subject, p.subjectRef, p.title, p.mediaRefs])).digest('hex');
      const existing = state.evidencePacks.find((row) => row.sha256 === sha256);
      if (existing) { ref = existing.title; break; }
      state.evidencePacks.unshift({
        tenantId: project.tenantId, id: rowId, projectId: p.projectId, subject: p.subject,
        subjectRef: p.subjectRef, title: p.title, mediaRefs: p.mediaRefs, sha256,
        capturedBy: actor.userId, capturedAtISO: input.capturedISO, status: 'pending_review',
      });
      ref = p.title; break;
    }
  }
  receipt.status = 'applied'; receipt.ref = ref;
  PATHS.forEach((path) => revalidatePath(path));
  return { ok: true, id, duplicate: false, ref };

  }, 'construction');
}

/** Only the authenticated author may discard their exact previously attempted copy. */
export async function abandonOperation(input: SyncInput): Promise<{ ok: true } | { ok: false; error: string }> {
  return withDurableMutation(async () => {
  const actor = await getActor();
  if (!permitted(actor, input?.kind) || input?.owner !== outboxOwnerKey(actor.tenantId, actor.userId)) return { ok: false, error: 'You no longer have permission to discard this record.' };
  const parsed = syncInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'This capture must be reviewed before it can be discarded.' };
  const receipt = db.syncLedger.find((r) => r.tenantId === actor.tenantId && r.actorId === actor.userId && r.opId === input.id);
  if (!receipt || receipt.kind !== input.kind || receipt.payloadHash !== syncFingerprint(parsed.data)) return { ok: false, error: 'No matching receipt belonging to you was found. Your device copy was kept.' };
  if (receipt.status === 'applied') return { ok: false, error: 'This record was already applied. Keep its receipt and use an approved adjustment.' };
  receipt.status = 'abandoned';
  return { ok: true };

  }, 'construction');
}
