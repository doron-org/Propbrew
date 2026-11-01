import { ConstructionOperationsWorkspace } from '@/components/construction/operations-workspace';
import { forecastFinishISO, projectEVMOf } from '@/domain/construction';
import { assertCan, can, matchesScope } from '@/lib/authz';
import { constructionControl } from '@/server/construction-control';
import { financeControl } from '@/server/finance-control';
import { handoverOmissions } from '@/domain/construction/control';
import { constructionDrawingVisible } from '@/server/construction/drawings';
import { repos } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { requireCapability } from '@/server/guard';
import { constructionWorld } from '@/server/reads/construction';
import { constructionForecastEvaluation } from '@/server/construction/forecast-evaluations';

export default async function ConstructionOperationsPage() {
  return withDurableRead(async () => {
    const { actor } = await requireCapability('reports_analytics', 'read', 'construction');
    const world = constructionWorld(actor);
    const variations = repos.constructionVariations.list(actor, { limit: 200 }).items;
    const state = constructionControl(actor.tenantId!);
    const issuedWht = new Set(financeControl(actor.tenantId!).whtCertificates.map((row) => row.sourceId));
    const scope = assertCan(actor, 'reports_analytics', 'read');
    const visible = <T extends { tenantId: string; projectId: string; subcontractorId?: string }>(rows: T[]) => rows.filter((row) => matchesScope(row, scope));
    const projectName = (id: string) => world.projects.find((row) => row.id === id)?.name ?? id;
    const seededSubcontractors = world.subcontractors.map((row) => ({ id: row.id, name: row.name, trade: row.trade, projects: row.projectIds.map(projectName), status: 'approved', complianceReady: true }));
    const onboardedSubcontractors = state.subcontractors.filter((row) => matchesScope({ ...row, subcontractorId: row.id }, scope)).map((row) => ({ id: row.id, name: row.name, trade: row.trade, projects: row.projectIds.map(projectName), status: row.status, cacNumber: row.cacNumber, contactName: row.contactName, phoneE164: row.phoneE164, complianceReady: row.hseInducted && (!row.insuranceExpiryISO || row.insuranceExpiryISO >= new Date().toISOString().slice(0, 10)) }));
    const subName = (id: string) => [...onboardedSubcontractors, ...seededSubcontractors].find((row) => row.id === id)?.name ?? id;
    const poById = new Map(world.pos.map((row) => [row.id, row]));
    const projects = world.projects.map((row) => ({ id: row.id, name: row.name, code: row.code }));
    const forecasts = world.projects.filter((row) => row.status !== 'planning').map((project) => {
      const evm = projectEVMOf(project, world.costCodes); const finish = forecastFinishISO(project, evm.spi);
      const reports = world.reports.filter((row) => row.projectId === project.id);
      const approvedReports = reports.filter((row) => row.status === 'approved').length;
      const dataConfidence = Math.round(Math.min(95, 45 + Math.min(25, approvedReports * 5) + (world.costCodes.some((row) => row.projectId === project.id) ? 15 : 0) + (world.tasks.some((row) => row.projectId === project.id) ? 10 : 0)));
      return { projectId: project.id, project: project.name, cpi: evm.cpi, spi: evm.spi, eacMinor: evm.eac, vacMinor: evm.vac, slipDays: finish.slipDays, finishISO: finish.iso, confidence: dataConfidence };
    });
    return <div className="pb-page"><ConstructionOperationsWorkspace
      projects={projects}
      subcontractors={[...onboardedSubcontractors, ...seededSubcontractors]}
      evidence={visible(state.evidencePacks).map((row) => ({ id: row.id, projectId: row.projectId, project: projectName(row.projectId), subject: row.subject, subjectRef: row.subjectRef, title: row.title, fileCount: row.mediaRefs.length, sha256: row.sha256, status: row.status, capturedAtISO: row.capturedAtISO }))}
      fieldApprovals={visible(state.fieldApprovals).map((row) => ({ id: row.id, projectId: row.projectId, project: projectName(row.projectId), kind: row.kind, subjectRef: row.subjectRef, title: row.title, summary: row.summary, evidenceCount: row.evidencePackIds.length, status: row.status, requestedAtISO: row.requestedAtISO }))}
      handoverDocs={world.docs.filter((row) => constructionDrawingVisible(actor, row)).map((row) => ({ id: row.id, projectId: row.projectId, number: row.number, title: row.title, revision: row.revision, status: row.status, hasFile: Boolean(row.fileId && row.fileSha256) }))}
      handoverPacks={visible(state.handoverPacks).map((row) => ({ id: row.id, ref: row.ref, projectId: row.projectId, project: projectName(row.projectId), title: row.title, status: row.status, approvalId: row.approvalId, items: row.items.map((item) => ({ requirement: item.requirement, docId: item.docId })), omissions: handoverOmissions(row, world.docs), createdAtISO: row.createdAtISO }))}
      variations={variations.map((row) => ({ id: row.id, projectId: row.projectId, ref: row.ref, title: row.title, status: row.status, posted: Boolean(row.changeOrder?.posting) }))}
      claims={visible(state.claims).map((row) => ({ id: row.id, ref: row.ref, projectId: row.projectId, project: projectName(row.projectId), subcontractor: subName(row.subcontractorId), description: row.description, claimedMinor: row.claimedMinor, assessedMinor: row.assessedMinor, certifiedMinor: row.certifiedMinor, retentionMinor: row.retentionMinor, whtMinor: row.whtMinor, status: row.status, periodEndISO: row.periodEndISO, paymentReference: row.paymentReference, whtRecorded: issuedWht.has(row.id) }))}
      retentionReleases={visible(state.retentionReleases).map((row) => ({ id: row.id, ref: row.ref, claimId: row.claimId, projectId: row.projectId, amountMinor: row.amountMinor, reason: row.reason, status: row.status, paymentReference: row.paymentReference }))}
      orders={world.pos.map((row) => ({ id: row.id, projectId: row.projectId, ref: row.ref, item: row.item, vendorName: row.vendorName, valueMinor: row.value.minor, qty: row.qty, deliveredQty: row.deliveredQty, status: row.status }))}
      payments={visible(state.payments).map((row) => { const po = poById.get(row.poId); return { id: row.id, ref: row.ref, poRef: po?.ref ?? row.poId, vendor: po?.vendorName ?? 'Supplier', invoiceRef: row.invoiceRef, invoiceMinor: row.invoiceMinor, retentionMinor: row.retentionMinor, whtMinor: row.whtMinor, payableMinor: row.payableMinor, status: row.status, threeWayMatched: row.threeWayMatched, paymentReference: row.paymentReference }; })}
      forecasts={forecasts}
      forecastEvaluation={constructionForecastEvaluation(actor)}
      canCreate={can(actor, 'reports_analytics', 'create').allowed}
      canUpdate={can(actor, 'reports_analytics', 'update').allowed}
    /></div>;
  });
}
