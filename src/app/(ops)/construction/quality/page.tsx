import { requireCapability } from '@/server/guard';
import { can } from '@/lib/authz';
import { repos } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { operatingDateISO } from '@/server/operating-clock';
import { QualityWorkspace } from '@/components/construction/quality-workspace';
import { canRecordQualitySignOff, qualityIssueVisible } from '@/server/construction/quality-access';
import { constructionModelsFor } from '@/server/construction/models';
import { nativeAuthEnabled } from '@/server/auth/mode';

export const dynamic = 'force-dynamic';

export default async function ConstructionQualityPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  return withDurableRead(async () => {
    const { actor } = await requireCapability('reports_analytics', 'read', 'construction');
    const { projectId } = await searchParams;
    const scopedProjects = repos.constructionProjects.list(actor, { limit: Number.MAX_SAFE_INTEGER }).items;
    const projects = scopedProjects.map((project) => ({ id: project.id, name: project.name, code: project.code }));
    const selectedProjectId = projects.some((project) => project.id === projectId) ? projectId! : projects[0]?.id ?? '';
    const issues = repos.constructionIssues.list(actor, { limit: Number.MAX_SAFE_INTEGER }).items.filter((issue) => issue.projectId === selectedProjectId && ['Punch list', 'Authority inspection', 'Design clash'].includes(issue.category) && qualityIssueVisible(actor, issue));
    const renderedIssues = issues.map((issue) => issue.bcf ? { ...issue, bcf: { ...issue.bcf,
      viewpoints: issue.bcf.viewpoints?.map((view) => ({ ...view,
        snapshot: view.snapshot ? { ...view.snapshot, base64: '' } : undefined,
        bitmaps: view.bitmaps?.map((bitmap) => ({ ...bitmap, base64: '' })) })) } } : issue);
    const visibleIssueIds = new Set(issues.filter((issue) => issue.category === 'Design clash').map((issue) => issue.id));
    const issueHistory = repos.constructionAudit.list(actor, { limit: Number.MAX_SAFE_INTEGER }).items.filter((entry) => entry.projectId === selectedProjectId && entry.entity === 'construction_issue' && visibleIssueIds.has(entry.entityRef));
    const taskNames = repos.constructionTasks.list(actor, { limit: Number.MAX_SAFE_INTEGER }).items.filter((task) => task.projectId === selectedProjectId).map((task) => task.name);
    const packages = scopedProjects.find((project) => project.id === selectedProjectId)?.mobilisation?.workPackages.filter((pack) => !actor.constructionPackageIds || actor.constructionPackageIds.includes(pack.id) || Boolean(pack.costCode && actor.constructionPackageIds.includes(`${selectedProjectId}:${pack.costCode}`))).map((pack) => ({ id: pack.id, name: pack.name })) ?? [];
    const modelRegister = constructionModelsFor(actor, selectedProjectId);
    return <div className="pb-page"><QualityWorkspace projects={projects} projectId={selectedProjectId} issues={renderedIssues} issueHistory={issueHistory} taskNames={taskNames} today={operatingDateISO()} canCreate={can(actor, 'reports_analytics', 'create').allowed} canUpdate={can(actor, 'reports_analytics', 'update').allowed} canSignOff={canRecordQualitySignOff(actor) && (can(actor, 'reports_analytics', 'approve').allowed || can(actor, 'reports_analytics', 'update').allowed)} companyId={actor.tenantId ?? ''} packages={packages} models={modelRegister.models} modelRuns={modelRegister.runs} canUploadModels={nativeAuthEnabled() && process.env.DATA_SOURCE === 'postgres' && can(actor, 'reports_analytics', 'create').allowed} canExportBcf={nativeAuthEnabled() && process.env.DATA_SOURCE === 'postgres'} /></div>;
  });
}
