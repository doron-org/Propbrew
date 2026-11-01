import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { revalidatePath } from 'next/cache';
import { assertCan, type Actor } from '@/lib/authz';
import { canUseCompanyModule } from '@/lib/auth/company-policy';
import { getCompanyPrincipal, recheckCompanyMembership, type CompanyPrincipal } from '@/server/auth/company';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { runWithRecordContext } from '@/server/data/record-context';
import { db, validateWorkspaceRecordState } from '@/server/data/store';
import { scopedConstructionProjectGet, scopedMutableGet } from '@/server/data';
import { withWorkspaceState } from '@/server/data/workspace-postgres';
import { operatingDateISO, operatingNowISO } from '@/server/operating-clock';
import { nextRevision } from '@/domain/construction';
import type { ConstructionDoc, Project } from '@/domain/construction/types';
import { drawingFileName, drawingUploadSchema, validDrawingFileId, validDrawingPdf, type DrawingUploadInput } from '@/domain/construction/drawings';
import { extractConstructionPdfForIndex, indexConstructionDrawingText, constructionDocumentIndexEntry } from './document-text';
import { constructionOcr } from './document-ocr';

export class ConstructionDrawingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type Upload = DrawingUploadInput & { key: string; name: string; declaredType: string; bytes: Uint8Array };

function allowedPackage(actor: Actor, project: Project, workPackageIds: readonly string[] | undefined): boolean {
  const profile = actor.companyAccess?.operationalProfileId;
  if (profile === 'construction-field-worker') return false;
  const assigned = actor.constructionPackageIds;
  if (profile === 'subcontractor' && !assigned?.length) return false;
  if (assigned === undefined) return true;
  if (!workPackageIds?.length) return false;
  const packages = project.mobilisation?.workPackages ?? [];
  return workPackageIds.some((id) => {
    const pack = packages.find((item) => item.id === id);
    return assigned.includes(id) || Boolean(pack?.costCode && assigned.includes(`${project.id}:${pack.costCode}`));
  });
}
function canBindPackages(actor: Actor, project: Project, ids: string[]): boolean {
  if (!allowedPackage(actor, project, ids)) return false;
  if (actor.constructionPackageIds === undefined) return true;
  return ids.every((id) => allowedPackage(actor, project, [id]));
}
function allowedDoc(actor: Actor, doc: ConstructionDoc, action: 'read' | 'update'): Project | null {
  const project = scopedConstructionProjectGet(actor, doc.projectId, action);
  if (!project || !allowedPackage(actor, project, doc.workPackageIds)) return null;
  return project;
}
export function constructionDrawingVisible(actor: Actor, doc: ConstructionDoc): boolean {
  try { return Boolean(allowedDoc(actor, doc, 'read')); } catch { return false; }
}
export function constructionDrawingEditable(actor: Actor, doc: ConstructionDoc): boolean {
  try { return Boolean(allowedDoc(actor, doc, 'update')); } catch { return false; }
}
function validLinks(project: Project, locations: string[], packages: string[]): boolean {
  if (new Set(locations).size !== locations.length || new Set(packages).size !== packages.length) return false;
  const knownLocations = new Set(project.mobilisation?.locations.map((item) => item.id) ?? []);
  const knownPackages = new Set(project.mobilisation?.workPackages.map((item) => item.id) ?? []);
  return locations.every((id) => knownLocations.has(id)) && packages.every((id) => knownPackages.has(id));
}
function packageScopeIds(project: Project, workPackageIds: string[]): string[] {
  const packs = project.mobilisation?.workPackages ?? [];
  return [...new Set(workPackageIds.flatMap((id) => {
    const pack = packs.find((item) => item.id === id);
    return pack?.costCode ? [id, `${project.id}:${pack.costCode}`] : [id];
  }))];
}
async function principal(write: boolean): Promise<CompanyPrincipal> {
  if (!nativeAuthEnabled() || process.env.DATA_SOURCE !== 'postgres') throw new ConstructionDrawingError('Drawing storage requires a signed-in company workspace with database storage.', 503);
  const identity = await getCompanyPrincipal();
  if (!identity) throw new ConstructionDrawingError('Sign in and choose your company.', 401);
  if (!canUseCompanyModule(identity.actor, 'construction', write ? 'create' : 'read')) throw new ConstructionDrawingError('Your company role cannot access Construction drawings.', 403);
  try { assertCan(identity.actor, 'reports_analytics', write ? 'create' : 'read'); }
  catch { throw new ConstructionDrawingError('Your Construction profile cannot access drawings.', 403); }
  return identity;
}
async function inWorkspace<T>(identity: CompanyPrincipal, fn: (client: PoolClient) => Promise<{ value: T; commit?: boolean }>): Promise<T> {
  let connection: PoolClient | undefined;
  return withWorkspaceState(identity.company.id, identity.company.id, 'write', () => { throw new Error('Company records are unavailable.'); }, async (payload) => {
    if (!connection) throw new Error('Drawing transaction is unavailable.');
    const state = validateWorkspaceRecordState(payload, identity.company.id);
    return runWithRecordContext({ state, domainTenantId: identity.company.id, mode: 'write', companyPrincipal: identity }, async () => ({ ...await fn(connection!), payload: state }));
  }, async (client) => { connection = client; await recheckCompanyMembership(client, identity); });
}
function addAudit(identity: CompanyPrincipal, client: PoolClient, doc: ConstructionDoc, action: string, detail: Record<string, unknown>) {
  const seq = db.constructionAudit.length + 1;
  db.constructionAudit.push({ tenantId: identity.company.id, id: `au-drawing-${randomUUID()}`, seq, atISO: operatingNowISO(), actorId: identity.user.id, actorName: identity.user.name, actorRole: identity.actor.roles[0] ?? 'unknown', action: 'record', entity: 'construction_drawing', entityRef: doc.id, projectId: doc.projectId, summary: `${action}: ${doc.number} rev ${doc.revision}` } as (typeof db.constructionAudit)[number]);
  return client.query('insert into audit_events(tenant_id,actor_subject,action,entity,entity_id,payload) values($1::uuid,$2,$3,$4,$5,$6::jsonb)', [identity.company.id, identity.user.id, action, 'construction_drawing', doc.id, JSON.stringify(detail)]);
}

export async function storeConstructionDrawing(input: Upload): Promise<{ id: string; docId: string; number: string; revision: string; url: string }> {
  const identity = await principal(true);
  const parsed = drawingUploadSchema.safeParse({ expectedCompanyId: input.expectedCompanyId, projectId: input.projectId, mode: input.mode, docId: input.docId, number: input.number, title: input.title, discipline: input.discipline, folder: input.folder, changeNote: input.changeNote, locationIds: input.locationIds, workPackageIds: input.workPackageIds });
  if (!parsed.success) throw new ConstructionDrawingError('Check the drawing details and project links.');
  const data = parsed.data;
  if (data.expectedCompanyId !== identity.company.id) throw new ConstructionDrawingError('Your company changed. Reopen this form.', 409);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.key)) throw new ConstructionDrawingError('A valid upload request identifier is required.');
  if (input.declaredType && input.declaredType !== 'application/pdf' || !validDrawingPdf(input.bytes)) throw new ConstructionDrawingError('Choose a valid PDF drawing of at most 15 MB.');
  const fileName = drawingFileName(input.name);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  // Store the file even if extraction fails; OCR is a bounded, separately metered index action.
  const extracted = await extractConstructionPdfForIndex(input.bytes).catch(() => null);
  const requestHash = createHash('sha256').update(JSON.stringify([data, fileName, sha256])).digest('hex');
  const saved = await inWorkspace(identity, async (client) => {
    const project = scopedConstructionProjectGet(identity.actor, data.projectId, 'create');
    if (!project) throw new ConstructionDrawingError('Project unavailable.', 404);
    if (!validLinks(project, data.locationIds, data.workPackageIds) || !canBindPackages(identity.actor, project, data.workPackageIds)) throw new ConstructionDrawingError('Choose locations and packages from this project.', 403);
    const replay = await client.query<{ id: string; doc_id: string; request_hash: string }>('select id,doc_id,request_hash from construction_drawing_files where tenant_id=$1::uuid and created_by=$2::uuid and request_key=$3', [identity.company.id, identity.user.id, input.key]);
    if (replay.rows[0]) {
      const match = db.constructionDocs.find((doc) => doc.id === replay.rows[0].doc_id && doc.projectId === project.id && doc.fileId === replay.rows[0].id);
      if (replay.rows[0].request_hash !== requestHash || !match || !allowedDoc(identity.actor, match, 'read')) throw new ConstructionDrawingError('This upload request changed. Reopen the form.', 409);
      return { value: { id: match.fileId!, docId: match.id, number: match.number, revision: match.revision, url: `/api/construction/drawings/${match.fileId}` }, commit: false };
    }
    let doc: ConstructionDoc;
    if (data.mode === 'new') {
      if (!data.number || !data.title || !data.discipline || !data.folder) throw new ConstructionDrawingError('Enter a drawing number, title, discipline and folder.');
      if (db.constructionDocs.some((row) => row.tenantId === identity.company.id && row.projectId === project.id && row.number.toLowerCase() === data.number!.toLowerCase())) throw new ConstructionDrawingError('This drawing number already exists in the project.', 409);
      doc = { tenantId: identity.company.id, id: `doc-${randomUUID()}`, projectId: project.id, number: data.number, title: data.title, discipline: data.discipline, folder: data.folder, revision: 'A', status: 'draft', effectiveISO: operatingDateISO(), uploadedBy: identity.user.name, changeNote: data.changeNote || 'Initial issue' } as ConstructionDoc;
      db.constructionDocs.unshift(doc);
    } else {
      const source = data.docId ? scopedMutableGet(identity.actor, 'reports_analytics', db.constructionDocs, data.docId, 'update') : null;
      if (!source || source.projectId !== project.id || !allowedDoc(identity.actor, source, 'update')) throw new ConstructionDrawingError('Drawing revision unavailable.', 404);
      if (data.mode === 'attach') {
        if (!['draft', 'review'].includes(source.status) || source.fileId) throw new ConstructionDrawingError('Only an empty draft or review revision can receive its first file.', 409);
        doc = source;
      } else {
        if (source.status !== 'approved') throw new ConstructionDrawingError('Choose the current approved revision, or attach the file to an existing draft.', 409);
        if (!data.changeNote?.trim()) throw new ConstructionDrawingError('Explain what changed from the approved issue.');
        const revision = nextRevision(source.revision);
        if (db.constructionDocs.some((row) => row.tenantId === identity.company.id && row.projectId === project.id && row.number === source.number && row.revision === revision)) throw new ConstructionDrawingError('A newer revision already exists. Review it first.', 409);
        doc = { ...source, id: `doc-${randomUUID()}`, revision, status: 'draft', effectiveISO: operatingDateISO(), changeNote: data.changeNote, uploadedBy: identity.user.name, approvedBy: undefined, approvedISO: undefined, supersedesId: source.id, supersededById: undefined, fileId: undefined, fileName: undefined, fileSizeBytes: undefined, fileSha256: undefined, fileSizeKb: undefined, requiresFile: true };
        db.constructionDocs.unshift(doc);
      }
    }
    const fileId = randomUUID();
    await client.query('insert into construction_drawing_files(id,tenant_id,project_id,doc_id,package_scope_ids,request_key,request_hash,name,content_type,size_bytes,sha256,bytes,created_by) values($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::uuid)', [fileId, identity.company.id, project.id, doc.id, JSON.stringify(packageScopeIds(project, data.workPackageIds)), input.key, requestHash, fileName, 'application/pdf', input.bytes.byteLength, sha256, Buffer.from(input.bytes), identity.user.id]);
    doc.fileId = fileId; doc.fileName = fileName; doc.fileSizeBytes = input.bytes.byteLength; doc.fileSizeKb = Math.ceil(input.bytes.byteLength / 1024); doc.fileSha256 = sha256; doc.requiresFile = true;
    doc.locationIds = [...data.locationIds]; doc.workPackageIds = [...data.workPackageIds];
    if (extracted !== null) indexConstructionDrawingText({ tenantId: identity.company.id, projectId: project.id, docId: doc.id, fileId, sha256,
      pages: extracted.pages, pendingPages: extracted.pendingPages, pageCount: extracted.pageCount, extractedAtISO: operatingNowISO() });
    await addAudit(identity, client, doc, 'construction.drawing.uploaded', { projectId: project.id, number: doc.number, revision: doc.revision, sha256, size: input.bytes.byteLength, locationIds: doc.locationIds, workPackageIds: doc.workPackageIds });
    return { value: { id: fileId, docId: doc.id, number: doc.number, revision: doc.revision, url: `/api/construction/drawings/${fileId}` } };
  }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'P0001' && error.message === 'Company drawing storage limit reached') throw new ConstructionDrawingError('This company has reached its drawing storage limit.', 413);
    throw error;
  });
  revalidatePath('/construction/documents'); revalidatePath('/construction/projects');
  revalidatePath(`/construction/projects/${encodeURIComponent(data.projectId)}`);
  return saved;
}

export async function readConstructionDrawing(id: string): Promise<{ name: string; bytes: Uint8Array; size: number }> {
  if (!validDrawingFileId(id)) throw new ConstructionDrawingError('Drawing unavailable.', 404);
  const identity = await principal(false);
  return inWorkspace(identity, async (client) => {
    const doc = db.constructionDocs.find((row) => row.fileId === id && row.tenantId === identity.company.id);
    if (!doc || !allowedDoc(identity.actor, doc, 'read')) throw new ConstructionDrawingError('Drawing unavailable.', 404);
    const result = await client.query<{ bytes: Buffer; size_bytes: number; sha256: string; name: string }>('select bytes,size_bytes,sha256,name from construction_drawing_files where id=$1::uuid and tenant_id=$2::uuid and project_id=$3 and doc_id=$4', [id, identity.company.id, doc.projectId, doc.id]);
    const file = result.rows[0];
    if (!file || file.size_bytes !== doc.fileSizeBytes || file.sha256 !== doc.fileSha256 || createHash('sha256').update(file.bytes).digest('hex') !== file.sha256) throw new ConstructionDrawingError('Drawing unavailable.', 404);
    return { value: { name: file.name, bytes: new Uint8Array(file.bytes), size: file.size_bytes }, commit: false };
  });
}

/** Bounded backfill for PDFs uploaded before text indexing was introduced. */
export async function reindexConstructionDrawings(projectId: string): Promise<{ indexed: number; remaining: number; pendingPages: number; ocrErrors: number; ocrAvailable: boolean }> {
  const identity = await principal(true);
  if (!projectId || projectId.length > 200) throw new ConstructionDrawingError('Choose a project.');
  const ocrPage = await constructionOcr(identity.company.id, identity.user.id);
  const batch = await inWorkspace(identity, async (client) => {
    const project = scopedConstructionProjectGet(identity.actor, projectId, 'create');
    if (!project) throw new ConstructionDrawingError('Project unavailable.', 404);
    const pending = db.constructionDocs.filter((doc) => doc.tenantId === identity.company.id && doc.projectId === projectId && doc.fileId && doc.fileSha256 && allowedDoc(identity.actor, doc, 'read') &&
      (!constructionDocumentIndexEntry(doc.fileId) || constructionDocumentIndexEntry(doc.fileId)?.pageCount === undefined || (constructionDocumentIndexEntry(doc.fileId)?.pendingPages?.length ?? 0) > 0));
    const files: Array<{ docId: string; fileId: string; sha256: string; bytes: Uint8Array; existing: ReturnType<typeof constructionDocumentIndexEntry> }> = [];
    for (const doc of pending.slice(0, ocrPage ? 2 : 5)) {
      const result = await client.query<{ bytes: Buffer; sha256: string }>('select bytes,sha256 from construction_drawing_files where id=$1::uuid and tenant_id=$2::uuid and project_id=$3 and doc_id=$4', [doc.fileId, identity.company.id, projectId, doc.id]);
      const file = result.rows[0];
      if (!file || file.sha256 !== doc.fileSha256 || createHash('sha256').update(file.bytes).digest('hex') !== file.sha256) throw new ConstructionDrawingError('A stored PDF failed its integrity check.', 503);
      files.push({ docId: doc.id, fileId: doc.fileId!, sha256: file.sha256, bytes: new Uint8Array(file.bytes), existing: constructionDocumentIndexEntry(doc.fileId!) });
    }
    return { value: { files, pendingCount: pending.length }, commit: false };
  });
  let indexed = 0, pendingPages = 0, ocrErrors = 0;
  for (const file of batch.files) {
    let extracted: Awaited<ReturnType<typeof extractConstructionPdfForIndex>>;
    try { extracted = await extractConstructionPdfForIndex(file.bytes, { existing: file.existing, ocrPage, maxOcrPages: ocrPage ? 2 : 0 }); }
    catch { throw new ConstructionDrawingError('PDF text extraction failed. The controlled PDF is safe; retry indexing.', 422); }
    await inWorkspace(identity, async (client) => {
      const doc = db.constructionDocs.find((row) => row.id === file.docId && row.fileId === file.fileId && row.fileSha256 === file.sha256 && row.projectId === projectId);
      if (!doc || !allowedDoc(identity.actor, doc, 'read')) throw new ConstructionDrawingError('Document access changed during indexing.', 409);
      const current = constructionDocumentIndexEntry(file.fileId);
      const pages = [...new Map([...(current?.pages ?? []), ...extracted.pages].map((row) => [row.page, row])).values()].sort((a, b) => a.page - b.page);
      const pending = extracted.pendingPages.filter((page) => !pages.some((row) => row.page === page));
      indexConstructionDrawingText({ tenantId: identity.company.id, projectId, docId: doc.id, fileId: file.fileId, sha256: file.sha256,
        pages, pendingPages: pending, pageCount: extracted.pageCount, extractedAtISO: operatingNowISO() });
      await client.query('insert into audit_events(tenant_id,actor_subject,action,entity,entity_id,payload) values($1::uuid,$2,$3,$4,$5,$6::jsonb)',
        [identity.company.id, identity.user.id, 'construction.document.text_indexed', 'construction_document', doc.id,
          JSON.stringify({ projectId, fileId: file.fileId, indexedPages: pages.length, pendingPages: pending.length, ocrAvailable: Boolean(ocrPage) })]);
      return { value: null };
    });
    indexed++; pendingPages += extracted.pendingPages.length; ocrErrors += extracted.ocrErrors;
  }
  return { indexed, remaining: Math.max(0, batch.pendingCount - indexed), pendingPages, ocrErrors, ocrAvailable: Boolean(ocrPage) };
}
