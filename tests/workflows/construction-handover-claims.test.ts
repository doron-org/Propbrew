import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorForCompanyMember } from '@/lib/auth/company-policy';
import type { ConstructionDoc } from '@/domain/construction/types';
import { constructionControl } from '@/server/construction-control';
import { createDemoWorkspaceState } from '@/server/data/demo-state';
import { runWithRecordContext, type WorkspaceRecordState } from '@/server/data/record-context';
import { financeControl } from '@/server/finance-control';
import {
  approveConstructionHandoverPack, assessConstructionClaim, decideConstructionClaim, requestConstructionRetentionRelease,
  saveConstructionHandoverPack, submitConstructionClaim, submitConstructionHandoverPack,
} from '@/server/actions/construction-control';
import { issueWhtCertificate } from '@/server/actions/finance-control';
import { HANDOVER_REQUIREMENTS } from '@/domain/construction/control';

const boundary = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock('@/server/session', () => ({ getActor: boundary.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const tenant = '46a4660b-90d2-478b-89b3-d516779bded2';
let state: WorkspaceRecordState;
const run = <T>(fn: () => T) => runWithRecordContext({ state, domainTenantId: tenant, mode: 'write' }, fn);
const projects = () => state.collections.constructionProjects as { id: string }[];
const docs = () => state.collections.constructionDocs as ConstructionDoc[];
const control = () => run(() => constructionControl(tenant));
const as = (userId: string, role: string, projectIds = ['cp-marina'], companyId = tenant) => boundary.actor.mockResolvedValue(actorForCompanyMember({
  membershipId: userId, userId, companyId, companyRole: 'member', status: 'active', companyStatus: 'active', modules: { construction: 'manage' },
  operationalProfileId: role, estateIds: [], allEstates: false, constructionProjectIds: projectIds, allConstructionProjects: false,
}, userId));

beforeEach(() => { vi.stubEnv('DATA_SOURCE', 'memory'); state = createDemoWorkspaceState(tenant); as('pm-1', 'project-manager'); });

describe('Construction handover and claim closeout', () => {
  it('flags every missing file, blocks superseded revisions and requires independent pack sign-off', async () => {
    const projectId = projects()[0].id;
    const created = await run(() => saveConstructionHandoverPack({ projectId, title: 'Marina practical completion', items: [] }));
    expect(created.ok).toBe(true); if (!created.ok) return;
    expect(control().handoverPacks[0].items).toHaveLength(0);
    const missing = await run(() => submitConstructionHandoverPack(created.id!));
    expect(missing.ok).toBe(false);
    expect(missing.ok ? '' : missing.error).toContain('document missing');

    const source = docs().find((row) => row.projectId === projectId)!;
    const items = HANDOVER_REQUIREMENTS.map((requirement, index) => {
      const id = `handover-doc-${index}`;
      docs().push({ ...source, id, number: `HDP-${index}`, revision: 'A', status: 'approved', fileId: `file-${index}`, fileSha256: `sha-${index}` });
      return { requirement: requirement.key, docId: id };
    });
    control().fieldApprovals.push({ tenantId: tenant, id: 'handover-approval-1', projectId, kind: 'handover', subjectRef: 'PC-001', title: 'Practical completion', summary: 'Approved site evidence', evidencePackIds: [], status: 'approved', requestedBy: 'pm-1', requestedAtISO: '2026-10-01', decidedBy: 'director-1', decidedAtISO: '2026-10-02' });
    expect((await run(() => saveConstructionHandoverPack({ packId: created.id, projectId, title: 'Marina practical completion', approvalId: 'handover-approval-1', items }))).ok).toBe(true);
    docs().find((row) => row.id === items[0].docId)!.status = 'superseded';
    expect((await run(() => submitConstructionHandoverPack(created.id!))).ok).toBe(false);
    docs().find((row) => row.id === items[0].docId)!.status = 'approved';
    expect((await run(() => submitConstructionHandoverPack(created.id!))).ok).toBe(true);
    expect((await run(() => approveConstructionHandoverPack(created.id!))).ok).toBe(false);
    as('director-1', 'project-director');
    expect((await run(() => approveConstructionHandoverPack(created.id!))).ok).toBe(true);
    expect(control().handoverPacks[0].status).toBe('approved');
  });

  it('keeps certified claims as liabilities without an unverified payment confirmation', async () => {
    const projectId = projects()[0].id;
    const subcontractor = (state.collections.constructionSubcontractors as { id: string; projectIds: string[] }[]).find((row) => row.projectIds.includes(projectId))!;
    const created = await run(() => submitConstructionClaim({ projectId, subcontractorId: subcontractor.id, periodEndISO: '2026-10-25', description: 'Measured reinforced concrete work', claimedNaira: 1000, retentionPct: 5, whtPct: 5 }));
    expect(created.ok).toBe(true); if (!created.ok) return;
    const claim = control().claims.find((row) => row.id === created.id)!;
    as('qs-1', 'quantity-surveyor');
    expect((await run(() => assessConstructionClaim(claim.id, 1000))).ok).toBe(true);
    as('director-1', 'project-director');
    expect((await run(() => decideConstructionClaim(claim.id, 'approved'))).ok).toBe(true);
    expect(claim.status).toBe('approved');
    expect(claim.certifiedMinor).toBe(90_250);
    expect(claim.paymentReference).toBeUndefined();
    expect(control().bankDebits).toHaveLength(0);
    expect((await run(() => requestConstructionRetentionRelease(claim.id, 50, 'Defects period complete'))).ok).toBe(false);
    expect((await run(() => issueWhtCertificate('construction_claim', claim.id, '2026-10-01', { externalCertificateRef: 'FIRS-IPC-001', remittanceRef: 'REMIT-IPC-001' }))).ok).toBe(false);
    expect(run(() => financeControl(tenant)).whtCertificates).toHaveLength(0);
  });

  it('rejects actions on a different project and company', async () => {
    const otherProject = projects()[1].id;
    expect((await run(() => saveConstructionHandoverPack({ projectId: otherProject, title: 'Other project handover', items: [] }))).ok).toBe(false);
    as('foreign-director', 'project-director', [projects()[0].id], 'b8e62128-130e-4975-b3be-48d45ca7d9a3');
    expect((await run(() => saveConstructionHandoverPack({ projectId: projects()[0].id, title: 'Foreign company pack', items: [] }))).ok).toBe(false);
  });
});
