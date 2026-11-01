import 'server-only';
import { currentRecordContext } from '@/server/data/record-context';
import { constructionWorld } from '@/server/reads/construction';
import type { Actor } from '@/lib/authz';
import { evaluateConstructionForecasts, type ForecastSnapshot } from '@/domain/construction/forecast-evaluation';

export function constructionForecastSnapshots(write = false): ForecastSnapshot[] {
  const context = currentRecordContext(); if (!context) return [];
  if (write && context.mode !== 'write') throw new Error('Forecast snapshots require a write transaction.');
  const data = context.state.auxiliary.constructionForecastSnapshots as ForecastSnapshot[] | undefined;
  if (!data) return write ? context.state.auxiliary.constructionForecastSnapshots = [] : [];
  if (!Array.isArray(data)) throw new Error('Forecast snapshot ledger is unavailable.');
  return data;
}

export function constructionForecastEvaluation(actor: Actor) {
  const context = currentRecordContext();
  const world = constructionWorld(actor);
  const visible = new Set(world.projects.map((row) => row.id));
  const snapshots = context?.domainTenantId === actor.tenantId ? constructionForecastSnapshots().filter((row) => row.tenantId === actor.tenantId && visible.has(row.projectId)) : [];
  const completed = world.projects.filter((row) => row.status === 'completed');
  const active = world.projects.filter((row) => row.status === 'active' || row.status === 'closing');
  const outcomes = world.projects.filter((row) => row.status === 'completed').flatMap((project) => {
    const completedAtISO = project.mobilisation?.lifecycle.filter((row) => row.action === 'complete').at(-1)?.atISO;
    const costCodes = world.costCodes.filter((row) => row.projectId === project.id && row.actual.currency === 'NGN');
    const actualCostMinor = costCodes.reduce((sum, row) => sum + row.actual.minor, 0);
    return completedAtISO && costCodes.length && Number.isSafeInteger(actualCostMinor) ? [{
      tenantId: actor.tenantId!, projectId: project.id, completedAtISO, actualCostMinor,
      projectType: project.projectType, region: project.region,
    }] : [];
  });
  const evaluated = evaluateConstructionForecasts(snapshots, outcomes);
  const gaps = completed.flatMap((project) => {
    const reasons: string[] = [];
    if (!project.mobilisation?.lifecycle.some((event) => event.action === 'complete')) reasons.push('Closeout date');
    const costs = world.costCodes.filter((cost) => cost.projectId === project.id && cost.actual.currency === 'NGN');
    if (!costs.length || costs.reduce((sum, cost) => sum + cost.actual.minor, 0) <= 0) reasons.push('Positive NGN actual cost');
    if (!evaluated.evaluations.some((item) => item.projectId === project.id)) reasons.push('Eligible pre-completion forecast');
    if (!project.projectType) reasons.push('Project type');
    if (!project.region?.trim()) reasons.push('State or region');
    return reasons.length ? [{ projectId: project.id, projectName: project.name, reasons }] : [];
  });
  return { snapshots, ...evaluated, collection: {
    completedProjects: completed.length,
    missingCloseoutDate: completed.filter((row) => !row.mobilisation?.lifecycle.some((event) => event.action === 'complete')).length,
    missingActualCost: completed.filter((row) => !world.costCodes.some((cost) => cost.projectId === row.id && cost.actual.currency === 'NGN' && cost.actual.minor > 0)).length,
    missingEligibleForecast: outcomes.filter((row) => !evaluated.evaluations.some((item) => item.projectId === row.projectId)).length,
    missingClassification: completed.filter((row) => !row.projectType || !row.region?.trim()).length,
    activeWithoutForecast: active.filter((row) => !snapshots.some((item) => item.projectId === row.id)).length,
    gaps,
  } };
}
