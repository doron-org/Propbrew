import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityByKey } from '@/server/identities';
import { db } from '@/server/data/store';
import { constructionControl } from '@/server/construction-control';
import * as operations from '@/server/actions/construction-control';

const session = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock('@/server/session', () => ({ getActor: session.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/clock', () => ({ nowISO: () => '2026-10-26T12:00:00.000Z' }));

const manager = () => structuredClone(identityByKey('estate_manager').actor);
beforeEach(() => session.actor.mockResolvedValue(manager()));

describe('Construction commercial operating loop', () => {
  it('requires onboarding compliance before subcontractor approval', async () => {
    const project = db.constructionProjects[0];
    const created = await operations.submitSubcontractorOnboarding({ name: 'QA Build Nigeria Ltd', trade: 'Concrete works', contactName: 'Ada Test', phoneE164: '+2348012345678', cacNumber: `RCQA${Date.now()}`, hseInducted: true, projectIds: [project.id] });
    expect(created.ok).toBe(true); if (!created.ok) return;
    const row = constructionControl(manager().tenantId!).subcontractors.find((item) => item.id === created.id)!;
    expect(row.status).toBe('pending_review');
    expect((await operations.decideSubcontractorOnboarding(row.id, 'approved')).ok).toBe(true);
    expect(row.status).toBe('approved');
  });

  it('assesses a claim before approval and preserves retention plus WHT', async () => {
    const project = db.constructionProjects[0];
    const subcontractor = db.constructionSubcontractors.find((row) => row.projectIds.includes(project.id))!;
    const submitted = await operations.submitConstructionClaim({ projectId: project.id, subcontractorId: subcontractor.id, periodEndISO: '2026-10-25', description: 'Measured reinforced concrete works', claimedNaira: 1_000_000, retentionPct: 5, whtPct: 5 });
    expect(submitted.ok).toBe(true); if (!submitted.ok) return;
    const claim = constructionControl(manager().tenantId!).claims.find((row) => row.id === submitted.id)!;
    expect((await operations.decideConstructionClaim(claim.id, 'approved')).ok).toBe(false);
    expect((await operations.assessConstructionClaim(claim.id, 900_000)).ok).toBe(true);
    expect(claim.certifiedMinor).toBe(81_225_000);
    expect((await operations.decideConstructionClaim(claim.id, 'approved')).ok).toBe(true);
    expect(claim.status).toBe('approved');
  });

  it('blocks payment approval until PO, delivery and invoice are matched', async () => {
    const po = db.constructionOrders.find((row) => row.deliveredQty > 0)!;
    const submitted = await operations.requestProcurementPayment({ poId: po.id, invoiceRef: `QA-INV-${Date.now()}`, invoiceNaira: 100_000, retentionPct: 0, whtPct: 5 });
    expect(submitted.ok).toBe(true); if (!submitted.ok) return;
    const payment = constructionControl(manager().tenantId!).payments.find((row) => row.id === submitted.id)!;
    expect((await operations.decideProcurementPayment(payment.id, 'approved')).ok).toBe(false);
    expect((await operations.matchProcurementPayment(payment.id)).ok).toBe(true);
    expect((await operations.decideProcurementPayment(payment.id, 'approved')).ok).toBe(true);
    expect(payment.status).toBe('approved');
    expect(payment.paymentReference).toBeUndefined();
  });
});
