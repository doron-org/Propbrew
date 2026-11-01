import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityByKey } from '@/server/identities';
import { db } from '@/server/data/store';
import { outboxOwnerKey } from '@/domain/sync';
import { constructionControl } from '@/server/construction-control';
import type { TenantId } from '@/domain/ids';

const boundary = vi.hoisted(() => ({ getActor: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/server/session', () => ({ getActor: boundary.getActor }));
vi.mock('next/cache', () => ({ revalidatePath: boundary.revalidatePath }));
import { syncOperation, abandonOperation, type SyncInput } from '@/server/actions/sync';

const initial = structuredClone(db);
const manager = identityByKey('estate_manager').actor;
const project = () => db.constructionProjects.find((p) => p.tenantId === manager.tenantId)!;
const task = () => db.constructionTasks.find((p) => p.tenantId === manager.tenantId && p.projectId === project().id)!;
const worker = () => db.constructionWorkers.find((p) => p.tenantId === manager.tenantId && p.projectId === project().id)!;
const input = (kind: SyncInput['kind'] = 'site_issue', payload: Record<string, unknown> = {}, key = 'offline-operation-123'): SyncInput => ({
  owner: outboxOwnerKey(manager.tenantId, manager.userId)!, id: key, kind, capturedISO: '2026-07-26T09:00:00Z',
  payload: { projectId: project().id, ...(kind === 'site_issue' ? { title: 'Offline issue', severity: 'high' } : {}), ...payload },
});
beforeEach(() => { vi.clearAllMocks(); Object.assign(db, structuredClone(initial)); boundary.getActor.mockResolvedValue(manager); });
afterEach(() => Object.assign(db, structuredClone(initial)));

describe('offline ownership and exact retry receipts', () => {
  it('preserves the capture date without inventing a due date for an offline issue', async () => {
    const op = { ...input(), capturedISO: '2026-10-24T12:30:00Z' };
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: false });
    expect(db.constructionIssues[0]).toMatchObject({ raisedISO: '2026-10-24', dueISO: '', title: 'Offline issue' });
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: true });
    expect(db.constructionIssues[0].dueISO).toBe('');
  });

  it('applies once, accepts reordered exact retries, and refuses changed payload/kind under the same key', async () => {
    const op = input(), count = db.constructionIssues.length;
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: false });
    expect(await syncOperation({ ...op, payload: { severity: 'high', title: 'Offline issue', projectId: project().id } })).toMatchObject({ ok: true, duplicate: true });
    expect(await syncOperation({ ...op, payload: { ...op.payload, title: 'Changed' } })).toMatchObject({ ok: false, conflict: true });
    expect(await syncOperation(input('safety_event', { title: 'Other kind', eventKind: 'near_miss', lostDays: 0 }))).toMatchObject({ ok: false, conflict: true });
    expect(db.constructionIssues).toHaveLength(count + 1);
    expect(db.syncLedger).toHaveLength(1);
    expect(db.syncLedger[0]).toMatchObject({ tenantId: manager.tenantId, actorId: manager.userId, status: 'applied' });
  });

  it('does not leak or poison another actor/tenant receipt sharing an op id', async () => {
    const op = input(); await syncOperation(op);
    const other = { ...manager, userId: 'other-construction-manager' };
    boundary.getActor.mockResolvedValue(other);
    expect(await syncOperation(op)).toMatchObject({ ok: false });
    expect(await syncOperation({ ...op, owner: outboxOwnerKey(other.tenantId, other.userId)! })).toMatchObject({ ok: true, duplicate: false });
    const foreign = { ...manager, tenantId: 't-foreign' as TenantId };
    db.constructionProjects.push({ ...project(), tenantId: foreign.tenantId });
    boundary.getActor.mockResolvedValue(foreign);
    expect(await syncOperation({ ...op, owner: outboxOwnerKey(foreign.tenantId, foreign.userId)! })).toMatchObject({ ok: true, duplicate: false });
    expect(db.syncLedger).toHaveLength(3);
    expect(new Set(db.constructionIssues.slice(0, 3).map((r) => r.id)).size).toBe(3);
  });

  it('rejects read-only users and account-switched queues before writes', async () => {
    boundary.getActor.mockResolvedValue(identityByKey('executive').actor);
    const before = db.constructionIssues.length;
    expect(await syncOperation(input())).toMatchObject({ ok: false });
    expect(await abandonOperation(input())).toMatchObject({ ok: false });
    expect(db.constructionIssues).toHaveLength(before); expect(db.syncLedger).toHaveLength(0);
  });

  it('holds conflicts, permits only the author to discard their exact attempted copy, and never resurrects it', async () => {
    const row = task(); row.percentComplete = 80; row.status = 'in_progress'; row.dependsOn = [];
    const op = input('task_progress', { taskId: row.id, percentComplete: 40 });
    expect(await syncOperation(op)).toMatchObject({ ok: false, conflict: true });
    boundary.getActor.mockResolvedValue({ ...manager, userId: 'another-author' });
    expect(await abandonOperation({ ...op, owner: outboxOwnerKey(manager.tenantId, 'another-author')! })).toMatchObject({ ok: false });
    boundary.getActor.mockResolvedValue(manager);
    expect(await abandonOperation({ ...op, payload: { ...op.payload, percentComplete: 60 } })).toMatchObject({ ok: false });
    expect(await abandonOperation(op)).toEqual({ ok: true });
    row.percentComplete = 0;
    expect(await syncOperation(op)).toMatchObject({ ok: false, conflict: true, serverState: 'Discarded by its author' });
    expect(row.percentComplete).toBe(0);
    expect(await abandonOperation(input('site_issue', {}, 'never-attempted'))).toMatchObject({ ok: false });
  });

  it('cannot discard a record already applied on the server', async () => {
    const op = input(); await syncOperation(op);
    expect(await abandonOperation(op)).toMatchObject({ ok: false });
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: true });
  });
});

describe('strict offline payloads and scoped relationships', () => {
  it('accepts task evidence only after each photo has an owned upload receipt for that project', async () => {
    const row = task();
    const url = 'https://app.usepropbrew.com/api/construction/field-photos/00000000-0000-4000-8000-000000000000';
    const payload = { subject: 'task', subjectRef: row.id, title: 'Slab inspection', mediaRefs: [url] };
    const state = constructionControl(manager.tenantId!);
    expect(await syncOperation(input('evidence_pack', payload, 'field-evidence-1'))).toMatchObject({ ok: false });
    state.mobileUploads.push({ tenantId: manager.tenantId!, actorId: 'another-author', projectId: project().id, taskId: row.id, opId: 'another-capture', index: 0, url, contentType: 'image/jpeg', size: 4, sha256: 'a'.repeat(64) });
    expect(await syncOperation(input('evidence_pack', payload, 'field-evidence-1'))).toMatchObject({ ok: false });
    state.mobileUploads[0].actorId = manager.userId;
    state.mobileUploads[0].projectId = db.constructionProjects.find((p) => p.tenantId === manager.tenantId && p.id !== project().id)!.id;
    expect(await syncOperation(input('evidence_pack', payload, 'field-evidence-1'))).toMatchObject({ ok: false });
    state.mobileUploads[0].projectId = project().id;
    expect(await syncOperation(input('evidence_pack', payload, 'field-evidence-1'))).toMatchObject({ ok: true });
    expect(state.evidencePacks[0]).toMatchObject({ subjectRef: row.id, capturedBy: manager.userId, mediaRefs: [url] });
  });
  it.each([NaN, Infinity, -Infinity, -1, 101, '40'])('rejects invalid progress %s before writes or receipts', async (pct) => {
    const row = task(), before = structuredClone(row);
    expect(await syncOperation(input('task_progress', { taskId: row.id, percentComplete: pct }))).toMatchObject({ ok: false });
    expect(row).toEqual(before); expect(db.syncLedger).toHaveLength(0);
  });
  it.each([
    ['daily_report', { dateISO: '2026-02-30', workforceCount: 2 }],
    ['daily_report', { dateISO: '2026-07-26', workforceCount: 2, photos: 1, mediaRefs: [] }],
    ['daily_report', { dateISO: '2026-07-26', workforceCount: -1 }],
    ['site_issue', { title: 'Bad severity', severity: 'catastrophic' }],
    ['attendance', { workerId: 'not-a-worker', dateISO: '2026-07-26', status: 'ghost', clockIn: '25:99' }],
    ['material_request', { item: 'Cement', qty: Infinity, unit: 'bag', costCode: 'MAR-SUP', estimateNaira: 1, requiredISO: '2026-07-27', justification: 'Needed' }],
    ['safety_event', { eventKind: 'unknown', title: 'Invalid', lostDays: 0 }],
  ] as const)('refuses malformed %s records without a receipt', async (kind, payload) => {
    expect(await syncOperation(input(kind, payload))).toMatchObject({ ok: false }); expect(db.syncLedger).toHaveLength(0);
  });
  it('refuses forged dates, identifiers, extra fields and timestamp envelopes', async () => {
    for (const op of [{ ...input(), capturedISO: 'yesterday' }, { ...input(), id: '../bad' }, input('site_issue', { unexpectedAdmin: true })]) expect(await syncOperation(op)).toMatchObject({ ok: false });
    expect(db.syncLedger).toHaveLength(0);
  });
  it('rejects foreign project IDs and parent/child mismatches before writing', async () => {
    const row = task(), person = worker();
    expect(await syncOperation(input('site_issue', { projectId: 'foreign-project' }))).toMatchObject({ ok: false });
    expect(await syncOperation(input('task_progress', { projectId: project().id, taskId: row.id, percentComplete: 40 }))).not.toMatchObject({ error: 'Task and project assignment not found.' });
    const other = db.constructionProjects.find((p) => p.tenantId === manager.tenantId && p.id !== project().id)!;
    expect(other).toBeDefined();
    expect(await syncOperation(input('task_progress', { projectId: other.id, taskId: row.id, percentComplete: 40 }, 'wrong-task-project'))).toMatchObject({ ok: false, error: 'Task and project assignment not found.' });
    expect(await syncOperation(input('attendance', { projectId: other.id, workerId: person.id, dateISO: '2026-07-28', status: 'present' }))).toMatchObject({ ok: false, error: 'Worker and project assignment not found.' });
    expect(await syncOperation(input('material_request', { item: 'Cement', qty: 10, unit: 'bag', costCode: 'foreign-code', estimateNaira: 200, requiredISO: '2026-07-28', justification: 'Needed' }))).toMatchObject({ ok: false });
    expect(await syncOperation(input('safety_event', { title: 'Zone', eventKind: 'near_miss', lostDays: 0, zoneId: 'foreign-zone' }))).toMatchObject({ ok: false });
  });
  it('ignores foreign rows with colliding task IDs and does not mutate them', async () => {
    const own = task(); own.dependsOn = []; own.percentComplete = 0; own.status = 'not_started';
    const foreign = { ...own, tenantId: 't-foreign' as TenantId, percentComplete: 17 };
    db.constructionTasks.unshift(foreign);
    expect(await syncOperation(input('task_progress', { taskId: own.id, percentComplete: 45 }))).toMatchObject({ ok: true });
    expect(own.percentComplete).toBe(45); expect(foreign.percentComplete).toBe(17);
  });
});

describe('offline transitions match online safety rules', () => {
  it('records an idempotent site check-in separately from manual attendance', async () => {
    const actor = { ...manager, userId: 'native-field-check-in-test' };
    boundary.getActor.mockResolvedValue(actor);
    const p = project();
    p.mobilisation = { calendar: { name: 'Site', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 8, timeZone: 'Africa/Lagos', holidays: [] }, baselines: [], team: [], workPackages: [],
      locations: [{ id: 'site-native-test', name: 'Site', kind: 'site', latitude: 6.5244, longitude: 3.3792 }], parties: [], lifecycle: [] };
    const now = new Date().toISOString();
    const op: SyncInput = { id: 'native-site-check-in-1', owner: outboxOwnerKey(actor.tenantId, actor.userId)!, kind: 'field_check_in', capturedISO: now,
      payload: { projectId: p.id, latitude: 6.5244, longitude: 3.3792, accuracyMeters: 12, locationAtISO: now } };
    const beforeAttendance = db.constructionAttendance.length;
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: false });
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: true });
    expect(await syncOperation({ ...op, id: 'native-site-check-in-2' })).toMatchObject({ ok: false, conflict: true });
    const checkIns = constructionControl(actor.tenantId!).fieldCheckIns.filter((row) => row.actorId === actor.userId && row.projectId === p.id);
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]).toMatchObject({ method: 'device_location_attested', siteLocationId: 'site-native-test', accuracyMeters: 12 });
    expect(db.constructionAttendance).toHaveLength(beforeAttendance);
  });
  it('does not reopen completed work or bypass unfinished dependencies', async () => {
    const row = task(); row.status = 'done'; row.percentComplete = 100;
    expect(await syncOperation(input('task_progress', { taskId: row.id, percentComplete: 0 }))).toMatchObject({ ok: false, conflict: true });
    row.status = 'not_started'; row.percentComplete = 0; row.dependsOn = ['missing-dependency'];
    expect(await syncOperation(input('task_progress', { taskId: row.id, percentComplete: 50 }, 'dependency-check'))).toMatchObject({ ok: false, conflict: true });
    expect(row.percentComplete).toBe(0);
  });
  it('records start/finish dates on accepted completion and accepts only an exact duplicate attendance capture', async () => {
    const row = task(); row.status = 'not_started'; row.percentComplete = 0; row.dependsOn = []; row.actualStartISO = undefined; row.actualFinishISO = undefined;
    expect(await syncOperation(input('task_progress', { taskId: row.id, percentComplete: 100 }))).toMatchObject({ ok: true });
    expect(row).toMatchObject({ status: 'done', actualStartISO: '2026-07-26', actualFinishISO: '2026-07-26' });
    const person = worker(); const op = input('attendance', { workerId: person.id, dateISO: '2026-07-28', status: 'present', clockIn: '07:00' }, 'attendance-capture');
    expect(await syncOperation(op)).toMatchObject({ ok: true });
    const attendance = db.constructionAttendance.find((a) => a.workerId === person.id && a.dateISO === '2026-07-28')!;
    expect(attendance).toMatchObject({ method: 'offline', withinGeofence: false, hours: 0, overtime: 0 });
    expect(await syncOperation(op)).toMatchObject({ ok: true, duplicate: true });
    expect(await syncOperation({ ...op, id: 'different-attendance', payload: { ...op.payload, status: 'absent' } })).toMatchObject({ ok: false, conflict: true });
    expect(attendance.status).toBe('present');
  });
  it('submits a draft report exactly once and does not overwrite a submitted report', async () => {
    const op = input('daily_report', { dateISO: '2026-08-02', workforceCount: 7, completed: ['Slab complete'] });
    expect(await syncOperation(op)).toMatchObject({ ok: true });
    const saved = db.constructionReports[0]; expect(saved).toMatchObject({ workforceCount: 7, status: 'submitted', photos: 0 });
    expect(await syncOperation({ ...op, id: 'second-copy' })).toMatchObject({ ok: false, conflict: true });
    expect(saved.completed).toEqual(['Slab complete']);
  });
  it('stores a valid material request in whole kobo and an unclosed safety observation', async () => {
    const code = db.constructionCostCodes.find((c) => c.tenantId === manager.tenantId && c.projectId === project().id)!;
    expect(await syncOperation(input('material_request', { item: 'Cement', qty: 10, unit: 'bag', costCode: code.code, estimateNaira: 12.34, requiredISO: '2026-07-28', justification: 'Ground works' }))).toMatchObject({ ok: true });
    expect(db.constructionRequests[0].estimate.minor).toBe(1234);
    expect(await syncOperation(input('safety_event', { title: 'Review the ramp', eventKind: 'observation', lostDays: 0 }, 'safety-capture'))).toMatchObject({ ok: true });
    expect(db.constructionSafetyEvents[0]).toMatchObject({ kind: 'observation', closed: false, lostDays: 0 });
  });
});
