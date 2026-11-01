import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { revalidatePath } from 'next/cache';
import { assertCan, type Actor } from '@/lib/authz';
import { canUseCompanyModule } from '@/lib/auth/company-policy';
import { getCompanyPrincipal, recheckCompanyMembership, type CompanyPrincipal } from '@/server/auth/company';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { currentRecordContext, runWithRecordContext } from '@/server/data/record-context';
import { scopedConstructionProjectGet } from '@/server/data';
import { db, validateWorkspaceRecordState } from '@/server/data/store';
import { withWorkspaceState } from '@/server/data/workspace-postgres';
import { operatingDateISO, operatingNowISO } from '@/server/operating-clock';
import { rfiPackageAllowed } from './rfi-access';
import { qualityIssueVisible } from './quality-access';
import { detectModelFormat, type ModelFormat, type Point3 } from '@/domain/construction/model-clashes';
import { compareMeshSurfaces, compareModelRevisions, parseModelMesh, type MeshElement } from '@/domain/construction/model-mesh';
import { parseIfcMesh } from './ifc-model';
import { createBcfZip, parseBcfZip, type BcfComment, type BcfTopic } from '@/domain/construction/bcf';
import type { Issue, Project } from '@/domain/construction/types';

export type StoredModel = { id: string; tenantId: string; projectId: string; workPackageId?: string; discipline: string;
  name: string; format: ModelFormat; size: number; sha256: string; componentCount: number; uploadedBy: string; uploadedAtISO: string;
  modelCode?: string; revision?: string };
export type ClashRun = { id: string; projectId: string; modelAId: string; modelBId: string; toleranceMm: number;
  compared: number; candidates: number; created: number; runBy: string; runAtISO: string; method: 'component_envelope_v1' | 'triangle_surface_v1' };
type Registry = { models: StoredModel[]; runs: ClashRun[]; receipts: { actorId: string; key: string; hash: string; modelId: string }[] };
export class ConstructionModelError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const uuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const packageScopeIds = (project: Project, id?: string): string[] => { const pack = project.mobilisation?.workPackages.find((row) => row.id === id); return id ? pack?.costCode ? [id, `${project.id}:${pack.costCode}`] : [id] : []; };
const meshFor = (bytes: Uint8Array, name: string): Promise<MeshElement[]> => detectModelFormat(bytes, name) === 'ifc' ? parseIfcMesh(bytes) : Promise.resolve(parseModelMesh(bytes, name));

function registry(write = false): Registry {
  const context = currentRecordContext(); if (!context) return { models: [], runs: [], receipts: [] };
  if (write && context.mode !== 'write') throw new Error('A write transaction is required.');
  const value = context.state.auxiliary.constructionModels as Registry | undefined;
  if (!value) { if (write) return context.state.auxiliary.constructionModels = { models: [], runs: [], receipts: [] }; return { models: [], runs: [], receipts: [] }; }
  if (!Array.isArray(value.models) || !Array.isArray(value.runs) || !Array.isArray(value.receipts)) throw new Error('Construction model register unavailable.');
  return value;
}
function visible(actor: Actor, model: StoredModel, action: 'read' | 'create' = 'read'): boolean {
  if (model.tenantId !== actor.tenantId) return false;
  try { const project = scopedConstructionProjectGet(actor, model.projectId, action); return !!project && rfiPackageAllowed(actor, project, model.workPackageId); }
  catch { return false; }
}
export function constructionModelsFor(actor: Actor, projectId: string): { models: StoredModel[]; runs: ClashRun[] } {
  if (currentRecordContext()?.domainTenantId !== actor.tenantId) return { models: [], runs: [] };
  const models = registry().models.filter((row) => row.projectId === projectId && visible(actor, row));
  const ids = new Set(models.map((row) => row.id));
  return { models: structuredClone(models), runs: structuredClone(registry().runs.filter((row) => row.projectId === projectId && ids.has(row.modelAId) && ids.has(row.modelBId))) };
}
async function principal(write: boolean): Promise<CompanyPrincipal> {
  if (!nativeAuthEnabled() || process.env.DATA_SOURCE !== 'postgres') throw new ConstructionModelError('Model storage requires a signed-in company workspace with database storage.', 503);
  const identity = await getCompanyPrincipal(); if (!identity) throw new ConstructionModelError('Sign in and choose your company.', 401);
  if (!canUseCompanyModule(identity.actor, 'construction', write ? 'create' : 'read')) throw new ConstructionModelError('Your company role cannot access Construction models.', 403);
  try { assertCan(identity.actor, 'reports_analytics', write ? 'create' : 'read'); }
  catch { throw new ConstructionModelError('Your Construction profile cannot access models.', 403); }
  return identity;
}
async function inWorkspace<T>(identity: CompanyPrincipal, fn: (client: PoolClient) => Promise<{ value: T; commit?: boolean }>): Promise<T> {
  let connection: PoolClient | undefined;
  return withWorkspaceState(identity.company.id, identity.company.id, 'write', () => { throw new Error('Company records are unavailable.'); }, async (payload) => {
    if (!connection) throw new Error('Model transaction unavailable.');
    const state = validateWorkspaceRecordState(payload, identity.company.id);
    return runWithRecordContext({ state, domainTenantId: identity.company.id, mode: 'write', companyPrincipal: identity }, async () => ({ ...await fn(connection!), payload: state }));
  }, async (client) => { connection = client; await recheckCompanyMembership(client, identity); });
}
async function audit(identity: CompanyPrincipal, client: PoolClient, action: string, projectId: string, entityId: string, details: Record<string, unknown>, entity = 'construction_model') {
  db.constructionAudit.push({ tenantId: identity.company.id, id: `au-model-${randomUUID()}`, seq: db.constructionAudit.length + 1,
    atISO: operatingNowISO(), actorId: identity.user.id, actorName: identity.user.name, actorRole: identity.actor.roles[0] ?? 'unknown',
    action: entity === 'construction_issue' ? 'import' : 'record', entity, entityRef: entityId, projectId, summary: action } as (typeof db.constructionAudit)[number]);
  await client.query('insert into audit_events(tenant_id,actor_subject,action,entity,entity_id,payload) values($1::uuid,$2,$3,$4,$5,$6::jsonb)',
    [identity.company.id, identity.user.id, action, entity, entityId, JSON.stringify(details)]);
}
function modelName(value: string, format: ModelFormat): string {
  const base = value.split(/[\\/]/).at(-1)?.replace(/[^a-zA-Z0-9 _.-]/g, '_').replace(/\.{2,}/g, '.').trim().slice(0, 115) || 'Coordination model';
  return base.toLowerCase().endsWith(`.${format}`) ? base : `${base}.${format}`;
}
export async function storeConstructionModel(input: { expectedCompanyId: string; projectId: string; workPackageId?: string; discipline: string;
  modelCode?: string; revision?: string; key: string; name: string; bytes: Uint8Array }): Promise<StoredModel> {
  const identity = await principal(true);
  if (identity.company.id !== input.expectedCompanyId) throw new ConstructionModelError('Your company changed. Reopen the model upload.', 409);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(input.key)) throw new ConstructionModelError('A valid upload request identifier is required.');
  if (!input.projectId || input.projectId.length > 200 || !input.discipline.trim() || input.discipline.length > 80) throw new ConstructionModelError('Choose a project and discipline.');
  if (input.modelCode && !/^[A-Za-z0-9._-]{2,60}$/.test(input.modelCode) || input.revision && !/^[A-Za-z0-9._-]{1,30}$/.test(input.revision)) throw new ConstructionModelError('Use a short model code and revision, such as STR-L4 and P02.');
  const format = detectModelFormat(input.bytes, input.name);
  if (!format) throw new ConstructionModelError('Choose a valid IFC, OBJ or embedded GLB model of at most 12 MB.');
  let components: MeshElement[];
  try { components = await meshFor(input.bytes, input.name); } catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'Model geometry is invalid.'); }
  const sha256 = createHash('sha256').update(input.bytes).digest('hex'), name = modelName(input.name, format);
  const requestHash = createHash('sha256').update(JSON.stringify([input.projectId, input.workPackageId ?? '', input.discipline.trim(), input.modelCode ?? '', input.revision ?? '', name, sha256])).digest('hex');
  const saved = await inWorkspace(identity, async (client) => {
    const project = scopedConstructionProjectGet(identity.actor, input.projectId, 'create');
    if (!project || !rfiPackageAllowed(identity.actor, project, input.workPackageId)) throw new ConstructionModelError('Project or work package unavailable.', 404);
    const ledger = registry(true);
    const replay = ledger.receipts.find((row) => row.actorId === identity.user.id && row.key === input.key);
    if (replay) {
      const found = ledger.models.find((row) => row.id === replay.modelId);
      if (!found || replay.hash !== requestHash || !visible(identity.actor, found)) throw new ConstructionModelError('This upload request changed. Reopen the form.', 409);
      return { value: structuredClone(found), commit: false };
    }
    if (input.modelCode && input.revision && ledger.models.some((row) => row.projectId === project.id &&
      row.workPackageId === input.workPackageId && row.modelCode === input.modelCode!.trim().toUpperCase() && row.revision === input.revision!.trim().toUpperCase()))
      throw new ConstructionModelError('That model code and revision already exist in this project and package. Choose the next revision.', 409);
    const model: StoredModel = { id: randomUUID(), tenantId: identity.company.id, projectId: project.id,
      workPackageId: input.workPackageId, discipline: input.discipline.trim(), name, format, size: input.bytes.length,
      sha256, componentCount: components.length, uploadedBy: identity.user.id, uploadedAtISO: operatingNowISO(),
      modelCode: input.modelCode?.trim().toUpperCase(), revision: input.revision?.trim().toUpperCase() };
    await client.query('insert into construction_model_files(id,tenant_id,project_id,package_scope_ids,request_key,request_hash,name,format,discipline,size_bytes,sha256,bytes,created_by) values($1::uuid,$2::uuid,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid)',
      [model.id, identity.company.id, project.id, JSON.stringify(packageScopeIds(project, input.workPackageId)), input.key, requestHash, name, format, model.discipline, model.size, sha256, Buffer.from(input.bytes), identity.user.id]);
    ledger.models.unshift(model); ledger.receipts.push({ actorId: identity.user.id, key: input.key, hash: requestHash, modelId: model.id });
    await audit(identity, client, 'construction.model.uploaded', project.id, model.id, { name, sha256, size: model.size, componentCount: model.componentCount, workPackageId: model.workPackageId, modelCode: model.modelCode, revision: model.revision });
    return { value: structuredClone(model) };
  }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'P0001' && error.message === 'Company model storage limit reached') throw new ConstructionModelError('This company has reached its model storage limit.', 413);
    throw error;
  });
  revalidatePath('/construction/quality'); return saved;
}
async function bytesFor(client: PoolClient, identity: CompanyPrincipal, model: StoredModel): Promise<Uint8Array> {
  const result = await client.query<{ bytes: Buffer; sha256: string; size_bytes: number }>('select bytes,sha256,size_bytes from construction_model_files where id=$1::uuid and tenant_id=$2::uuid and project_id=$3', [model.id, identity.company.id, model.projectId]);
  const row = result.rows[0];
  if (!row || row.size_bytes !== model.size || row.sha256 !== model.sha256 || createHash('sha256').update(row.bytes).digest('hex') !== model.sha256) throw new ConstructionModelError('Stored model failed its integrity check.', 503);
  return new Uint8Array(row.bytes);
}
export async function readConstructionModel(id: string): Promise<{ model: StoredModel; bytes: Uint8Array }> {
  if (!uuid(id)) throw new ConstructionModelError('Model unavailable.', 404);
  const identity = await principal(false);
  return inWorkspace(identity, async (client) => {
    const model = registry().models.find((row) => row.id === id && visible(identity.actor, row));
    if (!model) throw new ConstructionModelError('Model unavailable.', 404);
    return { value: { model: structuredClone(model), bytes: await bytesFor(client, identity, model) }, commit: false };
  });
}
export async function readConstructionMesh(id: string): Promise<{ model: StoredModel; elements: MeshElement[] }> {
  const { model, bytes } = await readConstructionModel(id);
  try { return { model, elements: await meshFor(bytes, model.name) }; }
  catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'Model geometry is unavailable.', 422); }
}
export async function compareConstructionRevisions(input: { beforeId: string; afterId: string; toleranceMm: number }) {
  if (!uuid(input.beforeId) || !uuid(input.afterId) || input.beforeId === input.afterId) throw new ConstructionModelError('Choose two different revisions.');
  if (!Number.isInteger(input.toleranceMm) || input.toleranceMm < 0 || input.toleranceMm > 1000) throw new ConstructionModelError('Choose a tolerance from 0 to 1,000 mm.');
  const identity = await principal(false);
  const source = await inWorkspace(identity, async (client) => {
    const rows = [input.beforeId, input.afterId].map((id) => registry().models.find((row) => row.id === id && visible(identity.actor, row)));
    const [before, after] = rows;
    if (!before || !after || before.projectId !== after.projectId || ((before.modelCode || after.modelCode) && before.modelCode !== after.modelCode))
      throw new ConstructionModelError('Choose revisions of one visible model in the same project and package.', 404);
    if (before.workPackageId !== after.workPackageId) throw new ConstructionModelError('Model revisions must use the same work package.', 400);
    return { value: { before, after, beforeBytes: await bytesFor(client, identity, before), afterBytes: await bytesFor(client, identity, after) }, commit: false };
  });
  try {
    const changes = compareModelRevisions(await meshFor(source.beforeBytes, source.before.name), await meshFor(source.afterBytes, source.after.name), input.toleranceMm);
    return { before: source.before, after: source.after, toleranceMm: input.toleranceMm, changes,
      added: changes.filter((row) => row.kind === 'added').length, removed: changes.filter((row) => row.kind === 'removed').length,
      changed: changes.filter((row) => row.kind === 'geometry_changed').length };
  } catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'Revision geometry comparison failed.', 422); }
}
export async function detectConstructionClashes(input: { expectedCompanyId: string; projectId: string; modelAId: string; modelBId: string; toleranceMm: number }): Promise<ClashRun> {
  const identity = await principal(true);
  if (identity.company.id !== input.expectedCompanyId) throw new ConstructionModelError('Your company changed. Reopen coordination.', 409);
  if (!input.projectId || !uuid(input.modelAId) || !uuid(input.modelBId) || input.modelAId === input.modelBId) throw new ConstructionModelError('Choose two different models from the same project.');
  if (!Number.isInteger(input.toleranceMm) || input.toleranceMm < 0 || input.toleranceMm > 1000) throw new ConstructionModelError('Choose a tolerance from 0 to 1,000 mm.');
  const run = await inWorkspace(identity, async (client) => {
    const project = scopedConstructionProjectGet(identity.actor, input.projectId, 'create');
    if (!project) throw new ConstructionModelError('Project unavailable.', 404);
    const ledger = registry(true);
    const a = ledger.models.find((row) => row.id === input.modelAId && row.projectId === project.id && visible(identity.actor, row, 'create'));
    const b = ledger.models.find((row) => row.id === input.modelBId && row.projectId === project.id && visible(identity.actor, row, 'create'));
    if (!a || !b) throw new ConstructionModelError('Both models must be in your assigned project and package.', 404);
    if (a.workPackageId && b.workPackageId && a.workPackageId !== b.workPackageId && identity.actor.constructionPackageIds !== undefined) throw new ConstructionModelError('This comparison spans packages outside a single assignment.', 403);
    let candidates: ReturnType<typeof compareMeshSurfaces>;
    try { candidates = compareMeshSurfaces(await meshFor(await bytesFor(client, identity, a), a.name), await meshFor(await bytesFor(client, identity, b), b.name), input.toleranceMm); }
    catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'Could not compare model geometry.'); }
    const runId = randomUUID(), at = operatingNowISO();
    // A cross-package issue must not reveal another package's component name
    // to a package-scoped member through the ordinary quality register.
    const scope = a.workPackageId && a.workPackageId === b.workPackageId ? a.workPackageId : undefined;
    let created = 0;
    for (const candidate of candidates) {
      const duplicate = db.constructionIssues.some((row) => row.projectId === project.id && row.tenantId === identity.company.id
        && row.clashDetection && ((row.clashDetection.modelAId === a.id && row.clashDetection.modelBId === b.id && row.clashDetection.componentAId === candidate.a.id && row.clashDetection.componentBId === candidate.b.id)
          || (row.clashDetection.modelAId === b.id && row.clashDetection.modelBId === a.id && row.clashDetection.componentAId === candidate.b.id && row.clashDetection.componentBId === candidate.a.id)));
      if (duplicate) continue;
      const issue: Issue = { tenantId: identity.company.id as Issue['tenantId'], id: `is-clash-${randomUUID()}`, projectId: project.id,
        category: 'Design clash', title: `${candidate.a.name} × ${candidate.b.name}`.slice(0, 180), severity: 'medium', owner: 'Design coordination',
        raisedISO: operatingDateISO(), dueISO: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), status: 'open',
        location: `${candidate.point.map((value) => value.toFixed(2)).join(', ')} m`, sourceReference: `${a.name} · ${candidate.a.id}`.slice(0, 160),
        relatedReference: `${b.name} · ${candidate.b.id}`.slice(0, 160), workPackageId: scope,
        clashDetection: { runId, modelAId: a.id, modelBId: b.id, componentAId: candidate.a.id, componentBId: candidate.b.id,
          point: candidate.point as Point3, overlapMm: 0, clearanceMm: candidate.clearanceMm, intersects: candidate.intersects, method: 'triangle_surface_v1' } };
      db.constructionIssues.unshift(issue); created++;
    }
    const result: ClashRun = { id: runId, projectId: project.id, modelAId: a.id, modelBId: b.id, toleranceMm: input.toleranceMm,
      compared: a.componentCount * b.componentCount, candidates: candidates.length, created, runBy: identity.user.id, runAtISO: at, method: 'triangle_surface_v1' };
    ledger.runs.unshift(result); if (ledger.runs.length > 100) ledger.runs.length = 100;
    await audit(identity, client, 'construction.model.clash_scan', project.id, runId, { modelAId: a.id, modelBId: b.id, toleranceMm: input.toleranceMm, candidates: candidates.length, created });
    return { value: structuredClone(result) };
  });
  revalidatePath('/construction/quality'); return run;
}

function stableBcfGuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function topicGuid(issue: Issue): string {
  if (issue.bcf?.guid) return issue.bcf.guid.toLowerCase();
  const suffix = issue.id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0];
  if (suffix) return suffix;
  return stableBcfGuid(issue.tenantId + ':' + issue.id);
}
export async function readConstructionBcfSnapshot(issueId: string, viewpointGuid: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (issueId.length > 100 || !uuid(viewpointGuid)) throw new ConstructionModelError('Snapshot unavailable.', 404);
  const identity = await principal(false);
  return inWorkspace(identity, async () => {
    const issue = db.constructionIssues.find((row) => row.id === issueId && row.tenantId === identity.company.id && row.category === 'Design clash' && qualityIssueVisible(identity.actor, row));
    const snapshot = issue?.bcf?.viewpoints?.find((row) => row.guid === viewpointGuid)?.snapshot;
    if (!snapshot) throw new ConstructionModelError('Snapshot unavailable.', 404);
    const bytes = Buffer.from(snapshot.base64, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new ConstructionModelError('Snapshot unavailable.', 404);
    return { value: { bytes: new Uint8Array(bytes), mediaType: snapshot.mediaType }, commit: false };
  });
}
export async function exportConstructionBcf(projectId: string): Promise<{ name: string; bytes: Uint8Array; count: number }> {
  const identity = await principal(false);
  return inWorkspace(identity, async () => {
    const project = scopedConstructionProjectGet(identity.actor, projectId, 'read');
    if (!project) throw new ConstructionModelError('Project unavailable.', 404);
    const issues = db.constructionIssues.filter((row) => row.tenantId === identity.company.id && row.projectId === projectId && row.category === 'Design clash' &&
      rfiPackageAllowed(identity.actor, project, row.workPackageId));
    if (!issues.length) throw new ConstructionModelError('This project has no visible design conflicts to export.', 404);
    if (issues.length > 100) throw new ConstructionModelError('BCF export supports up to 100 visible topics. Narrow or archive the coordination register first.', 413);
    const topics: BcfTopic[] = issues.map((issue) => {
      const activity = db.constructionAudit.filter((row) => row.tenantId === identity.company.id && row.projectId === project.id &&
        row.entity === 'construction_issue' && row.entityRef === issue.id && row.action !== 'import');
      const activityComments: BcfComment[] = activity.map((row) => {
        const hash = createHash('sha256').update(`${identity.company.id}:${row.id}`).digest('hex');
        return { guid: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
          dateISO: row.atISO, author: row.actorName, text: [row.summary, row.before && row.after ? `${row.before} → ${row.after}` : '', row.note].filter(Boolean).join(' · ').slice(0, 2000) };
      });
      const retainedHistory: BcfComment[] = [
        ...(issue.bcf?.commentRevisions ?? []).map((entry) => ({
          guid: stableBcfGuid(`${issue.id}:comment-revision:${entry.previous.guid}:${entry.savedAtISO}`),
          dateISO: entry.savedAtISO, author: 'Propbrew',
          text: `Earlier version of ${entry.previous.author}'s comment from ${entry.previous.dateISO}: ${entry.previous.text ?? 'Viewpoint only'}`.slice(0, 2000),
        })),
        ...(issue.bcf?.exchangeHistory ?? []).filter((entry) => entry.previousStatus && entry.previousStatus !== entry.status).map((entry) => ({
          guid: stableBcfGuid(`${issue.id}:external-status:${entry.atISO}:${entry.previousStatus}:${entry.status}`),
          dateISO: entry.atISO, author: 'Propbrew',
          text: `External BCF status changed ${entry.previousStatus} → ${entry.status} when ${entry.actor} imported an update.`,
        })),
      ];
      const commentGuids = new Set<string>();
      const comments = [...issue.bcf?.comments ?? [], ...retainedHistory, ...activityComments].filter((comment) => {
        if (commentGuids.has(comment.guid)) return false;
        commentGuids.add(comment.guid); return true;
      });
      const latest = activity.at(-1);
      return { guid: topicGuid(issue), title: issue.title,
        description: [issue.bcf?.description, issue.correctiveAction, issue.clashReview?.rationale].filter(Boolean).join('\n').slice(0, 2000),
        status: issue.status === 'resolved' ? 'Resolved' : issue.status === 'in_progress' ? 'InProgress' : 'Open',
        topicType: issue.bcf?.topicType ?? 'Clash', createdAtISO: issue.bcf?.createdAtISO ?? `${issue.raisedISO}T00:00:00.000Z`,
        createdAuthor: issue.bcf?.createdAuthor ?? 'Propbrew', modifiedAtISO: latest?.atISO ?? issue.bcf?.modifiedAtISO,
        modifiedAuthor: latest?.actorName ?? issue.bcf?.modifiedAuthor,
        componentIds: issue.clashDetection ? [issue.clashDetection.componentAId, issue.clashDetection.componentBId] : issue.bcf?.componentIds ?? [],
        point: issue.clashDetection?.point ?? issue.bcf?.viewpoints?.[0]?.camera?.position,
        comments, viewpoints: issue.bcf?.viewpoints };
    });
    const hash = createHash('sha256').update(identity.company.id + ':' + project.id).digest('hex');
    const projectGuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    let bytes: Uint8Array;
    try { bytes = createBcfZip(project.name, projectGuid, topics); }
    catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'BCF export could not be assembled.', 413); }
    return { value: { name: `${project.code || 'project'}-coordination.bcfzip`, bytes, count: topics.length }, commit: false };
  });
}
export async function importConstructionBcf(input: { expectedCompanyId: string; projectId: string; workPackageId?: string; bytes: Uint8Array }): Promise<{ imported: number; updated: number; skipped: number }> {
  const identity = await principal(true);
  if (identity.company.id !== input.expectedCompanyId) throw new ConstructionModelError('Your company changed. Reopen BCF import.', 409);
  let topics: BcfTopic[];
  try { topics = parseBcfZip(input.bytes); } catch (error) { throw new ConstructionModelError(error instanceof Error ? error.message : 'BCFZIP is invalid.'); }
  const result = await inWorkspace(identity, async (client) => {
    const project = scopedConstructionProjectGet(identity.actor, input.projectId, 'create');
    if (!project || !rfiPackageAllowed(identity.actor, project, input.workPackageId) || identity.actor.constructionPackageIds !== undefined && !input.workPackageId) throw new ConstructionModelError('Choose an assigned project and work package.', 403);
    let imported = 0, updated = 0, skipped = 0;
    for (const topic of topics) {
      const existing = db.constructionIssues.find((row) => row.tenantId === identity.company.id && row.projectId === project.id && row.bcf?.guid === topic.guid);
      if (existing) {
        if (existing.workPackageId !== input.workPackageId || !rfiPackageAllowed(identity.actor, project, existing.workPackageId))
          throw new ConstructionModelError('An existing BCF topic belongs to another work package.', 409);
        const previous = existing.bcf!, oldComments = previous.comments ?? [], oldViews = previous.viewpoints ?? [];
        const comments = [...oldComments], revisions = [...previous.commentRevisions ?? []], views = [...oldViews];
        const newerTopic = !previous.modifiedAtISO || !!topic.modifiedAtISO && topic.modifiedAtISO >= previous.modifiedAtISO;
        const externalStatus = newerTopic ? topic.status : previous.externalStatus ?? topic.status;
        let changed = newerTopic && (previous.externalStatus !== topic.status || previous.modifiedAtISO !== topic.modifiedAtISO);
        for (const comment of topic.comments ?? []) {
          const index = comments.findIndex((row) => row.guid === comment.guid);
          if (index < 0) { comments.push(comment); changed = true; continue; }
          if (JSON.stringify(comments[index]) === JSON.stringify(comment)) continue;
          if (!comment.modifiedAtISO || comment.modifiedAtISO <= (comments[index].modifiedAtISO ?? comments[index].dateISO))
            throw new ConstructionModelError('A BCF comment changed without a newer modification date.', 409);
          revisions.push({ savedAtISO: operatingNowISO(), previous: comments[index] }); comments[index] = comment; changed = true;
        }
        for (const view of topic.viewpoints ?? []) {
          const old = views.find((row) => row.guid === view.guid);
          if (!old) { views.push(view); changed = true; continue; }
          if (JSON.stringify(old) !== JSON.stringify(view)) throw new ConstructionModelError('An existing BCF viewpoint changed. Viewpoints are immutable; issue a new viewpoint.', 409);
        }
        if (!changed) { skipped++; continue; }
        const atISO = operatingNowISO();
        existing.bcf = { ...previous, description: newerTopic ? topic.description || previous.description : previous.description, externalStatus,
          modifiedAtISO: newerTopic ? topic.modifiedAtISO ?? previous.modifiedAtISO : previous.modifiedAtISO,
          modifiedAuthor: newerTopic ? topic.modifiedAuthor ?? previous.modifiedAuthor : previous.modifiedAuthor,
          componentIds: newerTopic ? topic.componentIds : previous.componentIds,
          comments, viewpoints: views, commentRevisions: revisions, importedAtISO: atISO,
          exchangeHistory: [...previous.exchangeHistory ?? [], { atISO, actor: identity.user.name, action: 'updated' as const,
            commentCount: comments.length, viewpointCount: views.length, status: externalStatus, previousStatus: previous.externalStatus }] };
        await audit(identity, client, 'construction.bcf.topic_updated', project.id, existing.id,
          { guid: topic.guid, comments: comments.length, viewpoints: views.length, previousStatus: previous.externalStatus, externalStatus }, 'construction_issue');
        updated++; continue;
      }
      const atISO = operatingNowISO(), id = `is-bcf-${randomUUID()}`;
      db.constructionIssues.unshift({ tenantId: identity.company.id as Issue['tenantId'], id, projectId: project.id,
        category: 'Design clash', title: topic.title, severity: 'medium', owner: 'Design coordination', raisedISO: operatingDateISO(),
        dueISO: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), status: 'open',
        location: topic.point?.map((value) => value.toFixed(2)).join(', ') ?? 'See BCF viewpoint',
        sourceReference: topic.componentIds[0] ?? 'External BCF topic', relatedReference: topic.componentIds[1] ?? 'External BCF topic',
        workPackageId: input.workPackageId, bcf: { guid: topic.guid, source: 'BCF 3.0 import', importedAtISO: atISO,
          description: topic.description, externalStatus: topic.status, componentIds: topic.componentIds,
          createdAtISO: topic.createdAtISO, createdAuthor: topic.createdAuthor, modifiedAtISO: topic.modifiedAtISO,
          modifiedAuthor: topic.modifiedAuthor, topicType: topic.topicType, comments: topic.comments, viewpoints: topic.viewpoints,
          exchangeHistory: [{ atISO, actor: identity.user.name, action: 'imported', commentCount: topic.comments?.length ?? 0,
            viewpointCount: topic.viewpoints?.length ?? 0, status: topic.status }] } });
      await audit(identity, client, 'construction.bcf.topic_imported', project.id, id,
        { guid: topic.guid, comments: topic.comments?.length ?? 0, viewpoints: topic.viewpoints?.length ?? 0, externalStatus: topic.status }, 'construction_issue');
      imported++;
    }
    await audit(identity, client, 'construction.bcf.imported', project.id, project.id, { imported, updated, skipped, workPackageId: input.workPackageId ?? null });
    return { value: { imported, updated, skipped } };
  });
  revalidatePath('/construction/quality'); return result;
}
