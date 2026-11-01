import { requireCapability } from '@/server/guard';
import { can } from '@/lib/authz';
import { constructionWorld } from '@/server/reads/construction';
import { operatingClock } from '@/server/operating-clock';
import { projectEVMOf, forecastFinishISO, projectHealth, projectCommittedMinor, projectActualMinor, milestoneBand } from '@/domain/construction';
import { ProjectsWorkspace, type ProjectCard } from '@/components/construction/projects-workspace';
import { withDurableRead } from '@/server/data/durable-records';

/** Projects Register — the delivery side of the off-plan portfolio: contract vs
 *  budget vs committed vs actual, physical progress against the baseline, a
 *  composite health score, forecast finish and milestone status. */
export default async function ConstructionProjectsPage() {
  return withDurableRead(async () => {
  const { nowMs: NOW_MS } = operatingClock();
  const { actor } = await requireCapability('reports_analytics', 'read', 'construction');
  const canMutate = can(actor, 'reports_analytics', 'create').allowed;
  const world = constructionWorld(actor);

  const projects: ProjectCard[] = world.projects.map((p) => {
    const evm = projectEVMOf(p, world.costCodes);
    const ff = forecastFinishISO(p, evm.spi);
    const openCritical = world.issues.filter((i) => i.projectId === p.id && i.status !== 'resolved' && (i.severity === 'critical' || i.severity === 'high')).length;
    const health = projectHealth(evm.spi, evm.cpi, openCritical);
    return {
      id: p.id, name: p.name, code: p.code, location: p.location, clientName: p.clientName, pmName: p.pmName, status: p.status, projectType: p.projectType, region: p.region,
      contractMinor: p.contractValue.minor, budgetMinor: p.approvedBudget.minor,
      committedMinor: projectCommittedMinor(p.id, world.costCodes), actualMinor: projectActualMinor(p.id, world.costCodes),
      percentComplete: p.percentComplete, plannedPercent: p.plannedPercent, cpi: evm.cpi, spi: evm.spi,
      healthScore: health.score, healthBand: health.band, healthLabel: health.label,
      startISO: p.startISO, plannedFinishISO: p.plannedFinishISO, forecastFinishISO: ff.iso, slipDays: ff.slipDays,
      milestones: world.milestones.filter((m) => m.projectId === p.id).map((m) => ({ name: m.name, dueISO: m.dueISO, band: milestoneBand(m, NOW_MS), status: m.status })),
      investorProjectId: p.investorProjectId,
    };
  });

  return (
    <div className="pb-page">
      <ProjectsWorkspace
        projects={projects}
        kpis={{
          total: projects.length,
          contractMinor: projects.reduce((n, p) => n + p.contractMinor, 0),
          budgetMinor: projects.reduce((n, p) => n + p.budgetMinor, 0),
          committedMinor: projects.reduce((n, p) => n + p.committedMinor, 0),
        }}
        canMutate={canMutate}
      />
    </div>
  );
  });
}
