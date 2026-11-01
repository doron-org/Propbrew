'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canEnterWorkspace } from '@/config/workspaces';
import { claimPayableMinor, handoverOmissions, HANDOVER_REQUIREMENTS, type EvidenceSubject, type FieldApprovalKind } from '@/domain/construction/control';
import { ForbiddenError, assertCan, matchesScope, type Actor, type ScopableRow } from '@/lib/authz';
import { repos, scopedConstructionProjectGet, scopedMutableGet } from '@/server/data';
import { withDurableMutation } from '@/server/data/durable-records';
import { nextRecordSequence } from '@/server/data/record-context';
import { db } from '@/server/data/store';
import { getActor } from '@/server/session';
import { nowISO } from '@/server/clock';
import { constructionControl } from '@/server/construction-control';
import { constructionDrawingVisible } from '@/server/construction/drawings';

export type ConstructionControlResult = { ok: true; id?: string; message?: string } | { ok: false; error: string };
const PATHS = ['/construction', '/construction/operations', '/construction/field', '/construction/procurement', '/construction/approvals', '/construction/league', '/construction/evm', '/construction/copilot', '/finance'];
const refresh = () => PATHS.forEach((path) => revalidatePath(path));
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_:-]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)));

async function gate(action: 'create' | 'update' | 'transition') {
  const actor = await getActor();
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction')) return { ok: false as const, error: 'You cannot manage this Construction workspace.' };
  try { assertCan(actor, 'reports_analytics', action); return { actor }; }
  catch (error) { if (error instanceof ForbiddenError) return { ok: false as const, error: 'Your current role cannot perform this Construction action.' }; throw error; }
}
function inConstructionScope(actor: Actor, row: ScopableRow) {
  return matchesScope(row, assertCan(actor, 'reports_analytics', 'read'));
}
function scopedSidecar<T extends ScopableRow>(actor: Actor, rows: T[], predicate: (row: T) => boolean) {
  return rows.find((row) => predicate(row) && inConstructionScope(actor, row));
}
function profileAllowed(actor: Actor, profiles: readonly string[]) {
  const access = actor.companyAccess;
  return !access || access.companyRole === 'owner' || access.companyRole === 'admin'
    || !access.operationalProfileId || profiles.includes(access.operationalProfileId);
}
const actorName = (actor: Actor) => db.users.find((row) => row.id === actor.userId && row.tenantId === actor.tenantId)?.name ?? 'Construction operator';
function audit(actor: Actor, action: 'approve' | 'reject' | 'issue' | 'post_cost' | 'override', entity: string, entityRef: string, projectId: string | undefined, summary: string, amountMinor?: number) {
  const seq = nextRecordSequence('construction:auditSeq', db.constructionAudit.reduce((max, row) => Math.max(max, row.seq), 0), true);
  db.constructionAudit.unshift({ tenantId: actor.tenantId!, id: `ca-${randomUUID()}`, seq, atISO: nowISO(), actorId: actor.userId, actorName: actorName(actor), actorRole: String(actor.roles[0] ?? 'operator'), action, entity, entityRef, projectId, summary, amountMinor } as (typeof db.constructionAudit)[number]);
}

const subcontractorSchema = z.object({
  name: z.string().trim().min(2).max(140), trade: z.string().trim().min(2).max(100), contactName: z.string().trim().min(2).max(120),
  phoneE164: z.string().trim().regex(/^\+234[789][01]\d{8}$/), cacNumber: z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9/-]+$/),
  insuranceExpiryISO: isoDate.optional(), hseInducted: z.boolean(), projectIds: z.array(id).min(1).max(20),
}).strict();

export async function submitSubcontractorOnboarding(input: z.input<typeof subcontractorSchema>): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const parsed = subcontractorSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Enter the subcontractor, Nigerian phone, CAC reference, compliance checks and assigned projects.' };
    const projectIds = new Set(repos.constructionProjects.list(access.actor, { limit: 200 }).items.map((row) => row.id));
    if (parsed.data.projectIds.some((projectId) => !projectIds.has(projectId))) return { ok: false, error: 'One or more assigned projects are unavailable.' };
    const state = constructionControl(access.actor.tenantId!);
    if (state.subcontractors.some((row) => row.cacNumber.toLowerCase() === parsed.data.cacNumber.toLowerCase() && row.status !== 'rejected')) return { ok: false, error: 'This CAC reference already has an active onboarding record.' };
    const row = { tenantId: access.actor.tenantId!, id: `cso-${randomUUID()}`, ...parsed.data, status: 'pending_review' as const, submittedBy: access.actor.userId, submittedAtISO: nowISO() };
    state.subcontractors.unshift(row); audit(access.actor, 'issue', 'subcontractor_onboarding', row.id, row.projectIds[0], `${row.name} submitted for compliance review`);
    refresh(); return { ok: true, id: row.id, message: 'Subcontractor submitted for compliance and commercial review.' };
  }, 'construction');
}

export async function decideSubcontractorOnboarding(onboardingId: string, decision: 'approved' | 'rejected' | 'suspended', note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'construction-hse'])) return { ok: false, error: 'Your Construction profile cannot decide subcontractor onboarding.' };
    const row = constructionControl(access.actor.tenantId!).subcontractors.find((item) => item.id === onboardingId && inConstructionScope(access.actor, { ...item, subcontractorId: item.id }));
    if (!row || !['pending_review', 'approved'].includes(row.status)) return { ok: false, error: 'Reviewable onboarding record not found.' };
    if (decision === 'approved' && (!row.hseInducted || row.insuranceExpiryISO && row.insuranceExpiryISO < nowISO().slice(0, 10))) return { ok: false, error: 'HSE induction and current insurance are required before approval.' };
    row.status = decision; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO(); row.reviewNote = note.trim().slice(0, 500) || undefined;
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'subcontractor_onboarding', row.id, row.projectIds[0], `${row.name} ${decision}`);
    refresh(); return { ok: true, id: row.id, message: `Subcontractor ${decision}.` };
  }, 'construction');
}

const fieldApprovalSchema = z.object({ projectId: id, kind: z.enum(['progress', 'quality_gate', 'delivery', 'handover']), subjectRef: z.string().trim().min(2).max(160), title: z.string().trim().min(3).max(200), summary: z.string().trim().min(3).max(1000), evidencePackIds: z.array(id).min(1).max(20) }).strict();
export async function submitFieldApproval(input: { projectId: string; kind: FieldApprovalKind; subjectRef: string; title: string; summary: string; evidencePackIds: string[] }): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const parsed = fieldApprovalSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Choose a project and at least one synced evidence pack, then describe the field approval.' };
    if (!scopedConstructionProjectGet(access.actor, parsed.data.projectId, 'read')) return { ok: false, error: 'Project not found.' };
    const state = constructionControl(access.actor.tenantId!);
    const evidence = parsed.data.evidencePackIds.map((packId) => scopedSidecar(access.actor, state.evidencePacks, (row) => row.id === packId && row.projectId === parsed.data.projectId));
    if (evidence.some((row) => !row)) return { ok: false, error: 'Every evidence pack must belong to this project.' };
    const row = { tenantId: access.actor.tenantId!, id: `cfa-${randomUUID()}`, ...parsed.data, status: 'pending' as const, requestedBy: access.actor.userId, requestedAtISO: nowISO() };
    state.fieldApprovals.unshift(row); audit(access.actor, 'issue', 'field_approval', row.subjectRef, row.projectId, row.title);
    refresh(); return { ok: true, id: row.id, message: 'Field approval submitted with its evidence chain.' };
  }, 'construction');
}
export async function decideFieldApproval(approvalId: string, decision: 'approved' | 'rejected', note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'site-manager', 'quality-inspector', 'consultant-approver'])) return { ok: false, error: 'Your Construction profile cannot decide this field approval.' };
    const state = constructionControl(access.actor.tenantId!); const row = scopedSidecar(access.actor, state.fieldApprovals, (item) => item.id === approvalId && item.status === 'pending');
    if (!row) return { ok: false, error: 'Pending field approval not found.' };
    if (decision === 'approved' && row.evidencePackIds.some((packId) => state.evidencePacks.find((pack) => pack.id === packId)?.status !== 'approved')) return { ok: false, error: 'Approve every linked evidence pack before approving field work.' };
    row.status = decision; row.decidedBy = access.actor.userId; row.decidedAtISO = nowISO(); row.decisionNote = note.trim().slice(0, 500) || undefined;
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'field_approval', row.subjectRef, row.projectId, `${row.title} ${decision}`);
    refresh(); return { ok: true, id: row.id, message: `Field approval ${decision}.` };
  }, 'construction');
}
export async function reviewConstructionEvidence(evidenceId: string, decision: 'approved' | 'rejected', note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'site-manager', 'quality-inspector', 'consultant-approver'])) return { ok: false, error: 'Your Construction profile cannot review this evidence.' };
    const row = scopedSidecar(access.actor, constructionControl(access.actor.tenantId!).evidencePacks, (item) => item.id === evidenceId && item.status === 'pending_review');
    if (!row) return { ok: false, error: 'Pending evidence pack not found.' };
    row.status = decision; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO(); row.reviewNote = note.trim().slice(0, 500) || undefined;
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'evidence_pack', row.subjectRef, row.projectId, `${row.title} ${decision}`);
    refresh(); return { ok: true, id: row.id, message: `Evidence pack ${decision}.` };
  }, 'construction');
}

const claimSchema = z.object({ projectId: id, subcontractorId: id, variationId: id.optional(), periodEndISO: isoDate, description: z.string().trim().min(3).max(1000), claimedNaira: z.number().finite().positive().max(100_000_000_000), retentionPct: z.number().min(0).max(20), whtPct: z.number().min(0).max(20) }).strict();
export async function submitConstructionClaim(input: z.input<typeof claimSchema>): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const parsed = claimSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Enter a valid project, subcontractor, period and NGN claim with retention and WHT.' };
    if (!scopedConstructionProjectGet(access.actor, parsed.data.projectId, 'read')) return { ok: false, error: 'Project not found.' };
    const state = constructionControl(access.actor.tenantId!);
    const newSub = state.subcontractors.find((row) => row.id === parsed.data.subcontractorId && row.status === 'approved' && row.projectIds.includes(parsed.data.projectId) && inConstructionScope(access.actor, { ...row, subcontractorId: row.id }));
    const existingSub = repos.constructionSubcontractors.list(access.actor, { limit: 200 }).items.find((row) => row.id === parsed.data.subcontractorId && row.projectIds.includes(parsed.data.projectId));
    if (!newSub && !existingSub) return { ok: false, error: 'Choose an approved subcontractor assigned to this project.' };
    if (parsed.data.variationId && !repos.constructionVariations.list(access.actor, { limit: 200 }).items.some((row) => row.id === parsed.data.variationId && row.projectId === parsed.data.projectId && row.status === 'approved' && row.changeOrder?.posting)) return { ok: false, error: 'Only an authorized, posted change in this project can be linked to a claim.' };
    const claimedMinor = Math.round(parsed.data.claimedNaira * 100); if (!Number.isSafeInteger(claimedMinor)) return { ok: false, error: 'The claim amount is outside the supported range.' };
    const deductions = claimPayableMinor(claimedMinor, parsed.data.retentionPct, parsed.data.whtPct); const seq = nextRecordSequence('construction:claimSeq', 0, true); const ref = `IPC-${String(seq).padStart(4, '0')}`;
    const row = { tenantId: access.actor.tenantId!, id: `ccm-${randomUUID()}`, ref, projectId: parsed.data.projectId, subcontractorId: parsed.data.subcontractorId, variationId: parsed.data.variationId, periodEndISO: parsed.data.periodEndISO, description: parsed.data.description, claimedMinor, retentionPct: parsed.data.retentionPct, retentionMinor: deductions.retentionMinor, whtPct: parsed.data.whtPct, whtMinor: deductions.whtMinor, status: 'submitted' as const, submittedBy: access.actor.userId, submittedAtISO: nowISO() };
    state.claims.unshift(row); audit(access.actor, 'issue', 'construction_claim', ref, row.projectId, `Submitted ${ref}`, claimedMinor);
    refresh(); return { ok: true, id: row.id, message: `${ref} submitted for QS assessment.` };
  }, 'construction');
}
export async function assessConstructionClaim(claimId: string, assessedNaira: number, note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('update'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'quantity-surveyor'])) return { ok: false, error: 'Only the assigned commercial review team can assess a claim.' };
    const row = scopedSidecar(access.actor, constructionControl(access.actor.tenantId!).claims, (item) => item.id === claimId && item.status === 'submitted');
    const assessedMinor = Math.round(assessedNaira * 100);
    if (!row || !Number.isSafeInteger(assessedMinor) || assessedMinor < 0 || assessedMinor > row.claimedMinor) return { ok: false, error: 'Enter an assessed amount between zero and the submitted claim.' };
    const deductions = claimPayableMinor(assessedMinor, row.retentionPct, row.whtPct);
    row.assessedMinor = assessedMinor; row.retentionMinor = deductions.retentionMinor; row.whtMinor = deductions.whtMinor; row.certifiedMinor = deductions.payableMinor; row.status = 'assessed'; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO(); row.reviewNote = note.trim().slice(0, 500) || undefined;
    audit(access.actor, 'override', 'construction_claim', row.ref, row.projectId, `QS assessed ${row.ref}`, assessedMinor); refresh(); return { ok: true, id: row.id, message: `${row.ref} assessed and ready for approval.` };
  }, 'construction');
}
export async function decideConstructionClaim(claimId: string, decision: 'approved' | 'rejected', note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'construction-finance', 'consultant-approver'])) return { ok: false, error: 'Your Construction profile cannot approve this claim.' };
    const row = scopedSidecar(access.actor, constructionControl(access.actor.tenantId!).claims, (item) => item.id === claimId && ['submitted', 'assessed'].includes(item.status));
    if (!row) return { ok: false, error: 'Reviewable claim not found.' };
    if (decision === 'approved' && (row.status !== 'assessed' || row.certifiedMinor === undefined)) return { ok: false, error: 'The QS assessment must be completed before approval.' };
    row.status = decision; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO(); row.reviewNote = note.trim().slice(0, 500) || undefined;
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'construction_claim', row.ref, row.projectId, `${row.ref} ${decision}`, row.certifiedMinor ?? row.claimedMinor); refresh(); return { ok: true, id: row.id, message: `${row.ref} ${decision}.` };
  }, 'construction');
}

const paymentSchema = z.object({ poId: id, invoiceRef: z.string().trim().min(3).max(120), invoiceNaira: z.number().finite().positive().max(100_000_000_000), retentionPct: z.number().min(0).max(20), whtPct: z.number().min(0).max(20), note: z.string().trim().max(500).optional() }).strict();
export async function requestProcurementPayment(input: z.input<typeof paymentSchema>): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const parsed = paymentSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Enter a valid PO, supplier invoice, NGN value, retention and WHT.' };
    const po = scopedMutableGet(access.actor, 'reports_analytics', db.constructionOrders, parsed.data.poId, 'read'); if (!po) return { ok: false, error: 'Purchase order not found.' };
    const state = constructionControl(access.actor.tenantId!); if (state.payments.some((row) => row.invoiceRef.toLowerCase() === parsed.data.invoiceRef.toLowerCase() && row.status !== 'rejected')) return { ok: false, error: 'This supplier invoice is already recorded.' };
    const invoiceMinor = Math.round(parsed.data.invoiceNaira * 100); const eligibleDeliveredMinor = Math.round(po.value.minor * po.deliveredQty / Math.max(1, po.qty));
    if (!Number.isSafeInteger(invoiceMinor) || invoiceMinor > eligibleDeliveredMinor) return { ok: false, error: 'The invoice exceeds the value of goods or work recorded as delivered.' };
    const deductions = claimPayableMinor(invoiceMinor, parsed.data.retentionPct, parsed.data.whtPct); const seq = nextRecordSequence('construction:paymentSeq', 0, true); const ref = `PAY-${String(seq).padStart(5, '0')}`;
    const row = { tenantId: access.actor.tenantId!, id: `cpp-${randomUUID()}`, ref, projectId: po.projectId, poId: po.id, invoiceRef: parsed.data.invoiceRef, invoiceMinor, eligibleDeliveredMinor, retentionMinor: deductions.retentionMinor, whtMinor: deductions.whtMinor, payableMinor: deductions.payableMinor, threeWayMatched: false, status: 'pending_match' as const, requestedBy: access.actor.userId, requestedAtISO: nowISO(), note: parsed.data.note };
    state.payments.unshift(row); audit(access.actor, 'issue', 'procurement_payment', ref, row.projectId, `Invoice ${row.invoiceRef} recorded against ${po.ref}`, invoiceMinor); refresh(); return { ok: true, id: row.id, message: `${ref} recorded for three-way match.` };
  }, 'construction');
}
export async function matchProcurementPayment(paymentId: string): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('update'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'procurement-officer', 'quantity-surveyor', 'construction-finance'])) return { ok: false, error: 'Your Construction profile cannot complete a three-way match.' };
    const row = scopedSidecar(access.actor, constructionControl(access.actor.tenantId!).payments, (item) => item.id === paymentId && item.status === 'pending_match'); if (!row) return { ok: false, error: 'Payment awaiting match not found.' };
    const po = scopedMutableGet(access.actor, 'reports_analytics', db.constructionOrders, row.poId, 'read'); if (!po || po.deliveredQty <= 0 || row.invoiceMinor > Math.round(po.value.minor * po.deliveredQty / Math.max(1, po.qty))) return { ok: false, error: 'PO, supplier invoice and recorded delivery do not match.' };
    row.threeWayMatched = true; row.status = 'pending_approval'; audit(access.actor, 'override', 'procurement_payment', row.ref, row.projectId, `${row.ref} three-way matched`, row.invoiceMinor); refresh(); return { ok: true, id: row.id, message: `${row.ref} matched and ready for finance approval.` };
  }, 'construction');
}
export async function decideProcurementPayment(paymentId: string, decision: 'approved' | 'rejected', note = ''): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'project-manager', 'construction-finance'])) return { ok: false, error: 'Only the assigned finance approval team can decide this payment.' };
    const row = scopedSidecar(access.actor, constructionControl(access.actor.tenantId!).payments, (item) => item.id === paymentId && ['pending_match', 'pending_approval'].includes(item.status)); if (!row) return { ok: false, error: 'Reviewable payment not found.' };
    if (decision === 'approved' && (!row.threeWayMatched || row.status !== 'pending_approval')) return { ok: false, error: 'Complete the three-way match before finance approval.' };
    row.status = decision; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO(); row.note = note.trim().slice(0, 500) || row.note;
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'procurement_payment', row.ref, row.projectId, `${row.ref} ${decision}`, row.payableMinor); refresh(); return { ok: true, id: row.id, message: `${row.ref} ${decision}.` };
  }, 'construction');
}
const handoverSchema = z.object({
  packId: id.optional(), projectId: id, title: z.string().trim().min(3).max(160), approvalId: id.optional(),
  items: z.array(z.object({ requirement: z.enum(HANDOVER_REQUIREMENTS.map((row) => row.key)), docId: id }).strict()).max(HANDOVER_REQUIREMENTS.length),
}).strict();
export async function saveConstructionHandoverPack(input: z.input<typeof handoverSchema>): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const parsed = handoverSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Choose a project, title and valid handover document slots.' };
    const { projectId, title, approvalId, packId, items } = parsed.data;
    if (!scopedConstructionProjectGet(access.actor, projectId, 'read')) return { ok: false, error: 'Project unavailable.' };
    if (new Set(items.map((row) => row.requirement)).size !== items.length || new Set(items.map((row) => row.docId)).size !== items.length) return { ok: false, error: 'Each handover requirement needs a different controlled document revision.' };
    const docs = repos.constructionDocs.list(access.actor, { limit: 5000 }).items;
    const selected = items.map((item) => ({ ...item, doc: docs.find((row) => row.id === item.docId && row.projectId === projectId && constructionDrawingVisible(access.actor, row)) }));
    if (selected.some((row) => !row.doc)) return { ok: false, error: 'A selected document is unavailable in this project.' };
    const state = constructionControl(access.actor.tenantId!);
    if (approvalId && !scopedSidecar(access.actor, state.fieldApprovals, (row) => row.id === approvalId && row.projectId === projectId && row.kind === 'handover')) return { ok: false, error: 'Choose a handover approval from this project.' };
    const snapshot = selected.map((row) => ({ requirement: row.requirement, docId: row.doc!.id, number: row.doc!.number, revision: row.doc!.revision, fileSha256: row.doc!.fileSha256 ?? '' }));
    const current = packId ? scopedSidecar(access.actor, state.handoverPacks, (row) => row.id === packId && row.projectId === projectId && row.status === 'draft') : undefined;
    if (packId && !current) return { ok: false, error: 'Editable draft pack not found.' };
    if (current) { current.title = title; current.items = snapshot; current.approvalId = approvalId ?? ''; }
    else {
      const seq = nextRecordSequence('construction:handoverSeq', 0, true);
      state.handoverPacks.unshift({ tenantId: access.actor.tenantId!, id: `chp-${randomUUID()}`, ref: `HDP-${String(seq).padStart(4, '0')}`, projectId, title, items: snapshot, approvalId: approvalId ?? '', status: 'draft', createdBy: access.actor.userId, createdAtISO: nowISO() });
    }
    const pack = current ?? state.handoverPacks[0];
    audit(access.actor, 'issue', 'handover_pack', pack.ref, projectId, `Saved handover pack with ${pack.items.length} document slots`);
    refresh(); return { ok: true, id: pack.id, message: `${pack.ref} saved. ${handoverOmissions(pack, docs).length} omissions remain.` };
  }, 'construction');
}

export async function submitConstructionHandoverPack(packId: string): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const state = constructionControl(access.actor.tenantId!);
    const pack = scopedSidecar(access.actor, state.handoverPacks, (row) => row.id === packId && row.status === 'draft');
    if (!pack) return { ok: false, error: 'Draft handover pack unavailable.' };
    const omissions = handoverOmissions(pack, repos.constructionDocs.list(access.actor, { limit: 5000 }).items);
    if (omissions.length) return { ok: false, error: `Complete the handover pack: ${omissions.join('; ')}.` };
    const approval = scopedSidecar(access.actor, state.fieldApprovals, (row) => row.id === pack.approvalId && row.projectId === pack.projectId && row.kind === 'handover' && row.status === 'approved');
    if (!approval) return { ok: false, error: 'An approved evidence-backed handover decision for this project is required.' };
    pack.status = 'submitted'; pack.submittedBy = access.actor.userId; pack.submittedAtISO = nowISO();
    audit(access.actor, 'issue', 'handover_pack', pack.ref, pack.projectId, 'Handover pack submitted for final review'); refresh();
    return { ok: true, id: pack.id, message: `${pack.ref} submitted for final handover review.` };
  }, 'construction');
}

export async function approveConstructionHandoverPack(packId: string): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'consultant-approver'])) return { ok: false, error: 'Only a project director or consultant approver can sign off handover.' };
    const state = constructionControl(access.actor.tenantId!);
    const pack = scopedSidecar(access.actor, state.handoverPacks, (row) => row.id === packId && row.status === 'submitted');
    if (!pack || pack.submittedBy === access.actor.userId) return { ok: false, error: 'A separate approver is required for a submitted pack.' };
    const omissions = handoverOmissions(pack, repos.constructionDocs.list(access.actor, { limit: 5000 }).items);
    if (omissions.length || !state.fieldApprovals.some((row) => row.id === pack.approvalId && row.projectId === pack.projectId && row.status === 'approved')) return { ok: false, error: 'Handover documents or the linked evidence approval are no longer valid.' };
    pack.status = 'approved'; pack.approvedBy = access.actor.userId; pack.approvedAtISO = nowISO();
    audit(access.actor, 'approve', 'handover_pack', pack.ref, pack.projectId, 'Complete handover pack signed off'); refresh();
    return { ok: true, id: pack.id, message: `${pack.ref} signed off with current approved files.` };
  }, 'construction');
}

export async function requestConstructionRetentionRelease(claimId: string, amountNaira: number, reason: string): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('create'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    const state = constructionControl(access.actor.tenantId!);
    const claim = scopedSidecar(access.actor, state.claims, (row) => row.id === claimId && row.status === 'paid');
    const amountMinor = Math.round(amountNaira * 100);
    if (!claim || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || reason.trim().length < 5 || reason.length > 500) return { ok: false, error: 'Choose a paid claim, positive release amount and reason.' };
    const committed = state.retentionReleases.filter((row) => row.claimId === claimId && row.status !== 'rejected').reduce((sum, row) => sum + row.amountMinor, 0);
    if (amountMinor > claim.retentionMinor - committed) return { ok: false, error: 'Release exceeds the remaining retained balance.' };
    const seq = nextRecordSequence('construction:retentionSeq', 0, true);
    const row = { tenantId: access.actor.tenantId!, id: `crr-${randomUUID()}`, claimId, projectId: claim.projectId, ref: `RET-${String(seq).padStart(4, '0')}`, amountMinor, reason: reason.trim(), status: 'requested' as const, requestedBy: access.actor.userId, requestedAtISO: nowISO() };
    state.retentionReleases.unshift(row); audit(access.actor, 'issue', 'retention_release', row.ref, row.projectId, reason.trim(), amountMinor); refresh();
    return { ok: true, id: row.id, message: `${row.ref} requested for approval.` };
  }, 'construction');
}
export async function decideConstructionRetentionRelease(releaseId: string, decision: 'approved' | 'rejected'): Promise<ConstructionControlResult> {
  return withDurableMutation(async () => {
    const access = await gate('transition'); if (!access.actor) return { ok: false, error: access.error ?? 'Access denied.' };
    if (!profileAllowed(access.actor, ['project-director', 'construction-finance'])) return { ok: false, error: 'Only the director or Construction finance can decide retention release.' };
    const state = constructionControl(access.actor.tenantId!);
    const row = scopedSidecar(access.actor, state.retentionReleases, (item) => item.id === releaseId && item.status === 'requested');
    if (!row || row.requestedBy === access.actor.userId || !state.claims.some((claim) => claim.id === row.claimId && claim.status === 'paid')) return { ok: false, error: 'A separate approver and paid parent claim are required.' };
    row.status = decision; row.reviewedBy = access.actor.userId; row.reviewedAtISO = nowISO();
    audit(access.actor, decision === 'approved' ? 'approve' : 'reject', 'retention_release', row.ref, row.projectId, `Retention release ${decision}`, row.amountMinor); refresh();
    return { ok: true, id: row.id, message: `${row.ref} ${decision}.` };
  }, 'construction');
}
export type { EvidenceSubject };
