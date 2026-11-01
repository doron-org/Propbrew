export const CONSTRUCTION_PROJECT_TYPES = ['residential', 'commercial', 'mixed_use', 'infrastructure', 'industrial', 'other'] as const;
export type ConstructionProjectType = typeof CONSTRUCTION_PROJECT_TYPES[number];

export type ForecastSnapshot = { id: string; tenantId: string; projectId: string; projectName: string; recordedAtISO: string;
  predictedFinishISO: string; predictedCostMinor: number; baselineFinishISO: string; cpi: number; spi: number; recordedBy: string };
export type ForecastOutcome = { tenantId: string; projectId: string; completedAtISO: string; actualCostMinor: number;
  projectType?: ConstructionProjectType; region?: string };
export type ForecastEvaluation = { projectId: string; projectName: string; snapshotId: string; forecastAtISO: string;
  predictedFinishISO: string; actualFinishISO: string; finishErrorDays: number; predictedCostMinor: number;
  actualCostMinor: number; costErrorPct: number; projectType?: ConstructionProjectType; region?: string };
export type ForecastCohort = {
  dimension: 'project_type' | 'region'; label: string; count: number; validationReady: boolean;
  calibrated: boolean; meanAbsoluteFinishErrorDays: number; meanAbsoluteCostErrorPct: number;
  holdoutFinishCoveragePct: number | null; holdoutCostCoveragePct: number | null;
  drift: 'insufficient_history' | 'stable' | 'review_trigger';
  recentFinishErrorDays: number | null; recentCostErrorPct: number | null;
};

export const FORECAST_MIN_COMPLETED_PROJECTS = 20;
export const FORECAST_DRIFT_WINDOW = 10;
const day = 86400000;
const dateMs = (value: string) => Date.parse(value.slice(0, 10) + 'T00:00:00Z');
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const mean = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
const projectKey = (tenantId: string, projectId: string) => `${tenantId.length}:${tenantId}${projectId}`;

function accuracy(rows: ForecastEvaluation[]) {
  const chronological = [...rows].sort((a, b) => a.actualFinishISO.localeCompare(b.actualFinishISO) || a.projectId.localeCompare(b.projectId));
  const validationReady = rows.length >= FORECAST_MIN_COMPLETED_PROJECTS;
  const split = validationReady ? Math.floor(rows.length * .7) : 0;
  const training = chronological.slice(0, split), holdout = chronological.slice(split);
  const empirical80FinishDays = validationReady ? percentile(training.map((row) => Math.abs(row.finishErrorDays)), .8) : null;
  const empirical80CostPct = validationReady ? percentile(training.map((row) => Math.abs(row.costErrorPct)), .8) : null;
  const holdoutFinishCoveragePct = validationReady ? Math.round(holdout.filter((row) => Math.abs(row.finishErrorDays) <= empirical80FinishDays!).length / holdout.length * 100) : null;
  const holdoutCostCoveragePct = validationReady ? Math.round(holdout.filter((row) => Math.abs(row.costErrorPct) <= empirical80CostPct!).length / holdout.length * 100) : null;
  // Review trigger, not a statistical drift claim: compare two non-overlapping windows.
  const previous = chronological.slice(-2 * FORECAST_DRIFT_WINDOW, -FORECAST_DRIFT_WINDOW);
  const recent = chronological.slice(-FORECAST_DRIFT_WINDOW);
  const previousFinish = previous.length === FORECAST_DRIFT_WINDOW ? mean(previous.map((row) => Math.abs(row.finishErrorDays))) : null;
  const previousCost = previous.length === FORECAST_DRIFT_WINDOW ? mean(previous.map((row) => Math.abs(row.costErrorPct))) : null;
  const recentFinish = validationReady ? mean(recent.map((row) => Math.abs(row.finishErrorDays))) : null;
  const recentCost = validationReady ? mean(recent.map((row) => Math.abs(row.costErrorPct))) : null;
  const drift: ForecastCohort['drift'] = !validationReady || previousFinish === null || previousCost === null ? 'insufficient_history'
    : (recentFinish! >= previousFinish * 1.25 && recentFinish! - previousFinish >= 2)
      || (recentCost! >= previousCost * 1.25 && recentCost! - previousCost >= 5) ? 'review_trigger' : 'stable';
  return { validationReady, calibrated: validationReady && holdoutFinishCoveragePct! >= 70 && holdoutCostCoveragePct! >= 70,
    trainingCount: training.length, holdoutCount: validationReady ? holdout.length : 0,
    empirical80FinishDays, empirical80CostPct, holdoutFinishCoveragePct, holdoutCostCoveragePct,
    meanAbsoluteFinishErrorDays: rows.length ? mean(rows.map((row) => Math.abs(row.finishErrorDays))) : null,
    meanFinishBiasDays: rows.length ? mean(rows.map((row) => row.finishErrorDays)) : null,
    meanAbsoluteCostErrorPct: rows.length ? mean(rows.map((row) => Math.abs(row.costErrorPct))) : null,
    drift, previousFinishErrorDays: previousFinish, previousCostErrorPct: previousCost,
    recentFinishErrorDays: recentFinish, recentCostErrorPct: recentCost };
}

/** One pre-completion snapshot per project, at least 14 days before recorded completion.
 * Results remain descriptive until each cohort has its own 20 eligible outcomes. */
export function evaluateConstructionForecasts(snapshots: ForecastSnapshot[], outcomes: ForecastOutcome[]) {
  const byProject = new Map<string, ForecastSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = projectKey(snapshot.tenantId, snapshot.projectId);
    byProject.set(key, [...byProject.get(key) ?? [], snapshot]);
  }
  const evaluations: ForecastEvaluation[] = [];
  const seen = new Set<string>();
  for (const outcome of outcomes) {
    const key = projectKey(outcome.tenantId, outcome.projectId);
    if (seen.has(key)) continue;
    seen.add(key);
    const observed = dateMs(outcome.completedAtISO);
    if (!Number.isFinite(observed) || !Number.isSafeInteger(outcome.actualCostMinor) || outcome.actualCostMinor <= 0) continue;
    const eligible = (byProject.get(key) ?? []).filter((row) => Number.isFinite(dateMs(row.recordedAtISO)) && dateMs(row.recordedAtISO) <= observed - 14 * day)
      .sort((a, b) => b.recordedAtISO.localeCompare(a.recordedAtISO));
    const row = eligible[0]; if (!row) continue;
    const predicted = dateMs(row.predictedFinishISO);
    if (!Number.isFinite(predicted) || !Number.isSafeInteger(row.predictedCostMinor) || row.predictedCostMinor <= 0) continue;
    evaluations.push({ projectId: row.projectId, projectName: row.projectName, snapshotId: row.id, forecastAtISO: row.recordedAtISO,
      predictedFinishISO: row.predictedFinishISO, actualFinishISO: outcome.completedAtISO.slice(0, 10),
      finishErrorDays: Math.round((observed - predicted) / day), predictedCostMinor: row.predictedCostMinor,
      actualCostMinor: outcome.actualCostMinor, costErrorPct: Math.round((outcome.actualCostMinor - row.predictedCostMinor) / outcome.actualCostMinor * 1000) / 10,
      projectType: outcome.projectType, region: outcome.region?.trim() || undefined });
  }
  const cohorts: ForecastCohort[] = [];
  for (const dimension of ['project_type', 'region'] as const) {
    const labels = [...new Set(evaluations.map((row) => dimension === 'project_type' ? row.projectType : row.region?.toLocaleLowerCase('en')).filter((value): value is string => Boolean(value)))];
    for (const label of labels.sort()) {
      const members = evaluations.filter((row) => (dimension === 'project_type' ? row.projectType : row.region?.toLocaleLowerCase('en')) === label);
      const metrics = accuracy(members);
      cohorts.push({ dimension, label: dimension === 'region' ? members[0].region! : label, count: members.length,
        validationReady: metrics.validationReady, calibrated: metrics.calibrated,
        meanAbsoluteFinishErrorDays: metrics.meanAbsoluteFinishErrorDays!, meanAbsoluteCostErrorPct: metrics.meanAbsoluteCostErrorPct!,
        holdoutFinishCoveragePct: metrics.holdoutFinishCoveragePct, holdoutCostCoveragePct: metrics.holdoutCostCoveragePct,
        drift: metrics.drift, recentFinishErrorDays: metrics.recentFinishErrorDays, recentCostErrorPct: metrics.recentCostErrorPct });
    }
  }
  return { evaluations: evaluations.sort((a, b) => b.forecastAtISO.localeCompare(a.forecastAtISO)), count: evaluations.length,
    cohorts, unclassifiedTypeCount: evaluations.filter((row) => !row.projectType).length,
    unclassifiedRegionCount: evaluations.filter((row) => !row.region).length, ...accuracy(evaluations) };
}
