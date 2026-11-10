/**
 * Independent verification of the construction forecast calibration engine.
 *
 * Every expectation below is hand-computed from the fixture design — not
 * captured from the implementation. Complements the existing behaviour tests
 * in tests/domain/construction-bim-intelligence.test.ts with:
 *   - the exact 14-day pre-closeout eligibility boundary
 *   - latest-eligible-snapshot selection (including fallback)
 *   - a fully calibrated golden cohort with exact metric values
 *   - drift window boundaries (relative ratio vs absolute margin)
 *   - invalid-row handling and classification counts
 */
import { describe, expect, it } from 'vitest';
import { evaluateConstructionForecasts, type ForecastOutcome, type ForecastSnapshot } from '@/domain/construction/forecast-evaluation';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 2, 1); // 2026-03-01: completion of project 0 in the golden set

function snapshot(projectId: string, overrides: Partial<ForecastSnapshot> = {}): ForecastSnapshot {
  return {
    id: `snap-${projectId}`, tenantId: 'tenant-a', projectId, projectName: `Project ${projectId}`,
    recordedAtISO: '2026-01-15T10:00:00Z', predictedFinishISO: '2026-03-01',
    predictedCostMinor: 1_000_000, baselineFinishISO: '2026-03-01', cpi: 1, spi: 1, recordedBy: 'pm', ...overrides,
  };
}
function outcome(projectId: string, overrides: Partial<ForecastOutcome> = {}): ForecastOutcome {
  return {
    tenantId: 'tenant-a', projectId, completedAtISO: iso(T0),
    actualCostMinor: 1_000_000, projectType: 'residential', region: 'Lagos, Nigeria', ...overrides,
  };
}

describe('forecast calibration — eligibility boundaries', () => {
  it('accepts a snapshot recorded exactly 14 days before completion and rejects 13 days', () => {
    const completed = Date.UTC(2026, 2, 15); // 2026-03-15
    const atBoundary = snapshot('p1', { recordedAtISO: iso(completed - 14 * DAY) });
    const tooLate = snapshot('p2', { recordedAtISO: iso(completed - 13 * DAY) });
    const afterCompletion = snapshot('p3', { recordedAtISO: iso(completed + DAY) });
    const outcomes = ['p1', 'p2', 'p3'].map((id) => outcome(id, { completedAtISO: iso(completed) }));
    const result = evaluateConstructionForecasts([atBoundary, tooLate, afterCompletion], outcomes);
    expect(result.count).toBe(1);
    expect(result.evaluations[0].projectId).toBe('p1');
    expect(result.validationReady).toBe(false);
  });

  it('uses the latest eligible snapshot and falls back when the newest is inside 14 days', () => {
    const completed = Date.UTC(2026, 2, 15);
    const older = snapshot('p1', { id: 'older', recordedAtISO: '2026-01-01T00:00:00Z', predictedFinishISO: '2026-03-10' });
    const newer = snapshot('p1', { id: 'newer', recordedAtISO: '2026-02-01T00:00:00Z', predictedFinishISO: '2026-03-12' });
    const completedOutcome = outcome('p1', { completedAtISO: iso(completed) });
    const result = evaluateConstructionForecasts([older, newer], [completedOutcome]);
    expect(result.evaluations[0].snapshotId).toBe('newer');
    expect(result.evaluations[0].predictedFinishISO).toBe('2026-03-12');
    expect(result.evaluations[0].finishErrorDays).toBe(3); // 15 − 12 March
    const insideWindow = snapshot('p1', { id: 'too-late', recordedAtISO: iso(completed - 5 * DAY), predictedFinishISO: '2026-03-14' });
    const fallback = evaluateConstructionForecasts([older, newer, insideWindow], [completedOutcome]);
    expect(fallback.evaluations[0].snapshotId).toBe('newer');
  });

  it('skips non-positive or invalid costs and dates, and counts each project once', () => {
    const snap = snapshot('p1');
    const outcomes = [
      outcome('p1'), outcome('p1'), // duplicate outcome — one evaluation only
      outcome('p2', { actualCostMinor: 0 }),
      outcome('p3', { actualCostMinor: -500 }),
      outcome('p4', { actualCostMinor: 1.5 }),
      outcome('p5', { completedAtISO: 'not-a-date' }),
    ];
    const result = evaluateConstructionForecasts([snap, snapshot('p2'), snapshot('p3'), snapshot('p4'), snapshot('p5')], outcomes);
    expect(result.count).toBe(1);
    expect(result.evaluations[0].projectId).toBe('p1');
    // A snapshot with a non-positive predicted cost cannot support an evaluation either.
    expect(evaluateConstructionForecasts([snapshot('p1', { predictedCostMinor: 0 })], [outcome('p1')]).count).toBe(0);
  });

  it('folds region case for cohort grouping and counts unclassified outcomes', () => {
    const snapshots = [snapshot('p1'), snapshot('p2'), snapshot('p3')];
    const outcomes = [
      outcome('p1', { region: 'Lagos, Nigeria' }),
      outcome('p2', { region: 'LAGOS, NIGERIA ' }),
      outcome('p3', { projectType: undefined, region: undefined }),
    ];
    const result = evaluateConstructionForecasts(snapshots, outcomes);
    expect(result.count).toBe(3);
    expect(result.cohorts.filter((row) => row.dimension === 'region')).toHaveLength(1);
    expect(result.cohorts.find((row) => row.dimension === 'region')?.count).toBe(2);
    expect(result.cohorts.filter((row) => row.dimension === 'project_type')).toHaveLength(1);
    expect(result.unclassifiedTypeCount).toBe(1);
    expect(result.unclassifiedRegionCount).toBe(1);
  });
});

describe('forecast calibration — golden calibrated cohort (hand-computed)', () => {
  // Finish errors (actual − predicted, days): first 14 = training, last 6 = holdout.
  const finishErrors = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 1, 2, 2, 3, 3, 5];
  // Cost errors ((actual − predicted)/actual, %): actual = 1,000,000 → predicted = 1,000,000 − pct × 10,000.
  const costPcts = [0.5, 1, 1, 1.5, 2, 2, 2.5, 3, 3, 3.5, 4, 4, 5, 5, 0.5, 1, 1.5, 2, 2.5, 3.2];
  const snapshots = finishErrors.map((finish, i) => snapshot(`p-${i}`, {
    predictedFinishISO: iso(T0 + (i - finish) * DAY).slice(0, 10),
    predictedCostMinor: 1_000_000 - Math.round(costPcts[i] * 10_000),
  }));
  const outcomes = finishErrors.map((_, i) => outcome(`p-${i}`, { completedAtISO: iso(T0 + i * DAY) }));
  const result = evaluateConstructionForecasts(snapshots, outcomes);

  it('matches every hand-computed aggregate', () => {
    expect(result.count).toBe(20);
    expect(result.trainingCount).toBe(14); // floor(20 × 0.7)
    expect(result.holdoutCount).toBe(6);
    // 80th percentile of training |errors| = 12th of 14 sorted values.
    expect(result.empirical80FinishDays).toBe(6);
    expect(result.empirical80CostPct).toBe(4);
    expect(result.holdoutFinishCoveragePct).toBe(100); // all 6 holdout errors ≤ 6 days
    expect(result.holdoutCostCoveragePct).toBe(100); // all 6 holdout errors ≤ 4%
    expect(result.validationReady).toBe(true);
    expect(result.calibrated).toBe(true);
    expect(result.meanAbsoluteFinishErrorDays).toBe(3.6); // 72 / 20
    expect(result.meanAbsoluteCostErrorPct).toBe(2.4); // 48.7 / 20 → 2.435 → 2.4
  });

  it('stays stable despite a 40% relative increase because the absolute margin is under 2 days', () => {
    expect(result.previousFinishErrorDays).toBe(3.0); // first 10: 30 / 10
    expect(result.recentFinishErrorDays).toBe(4.2); // last 10: 42 / 10
    expect(result.previousCostErrorPct).toBe(2.0); // 20 / 10
    expect(result.recentCostErrorPct).toBe(2.9); // 28.7 / 10
    expect(result.drift).toBe('stable'); // 4.2 ≥ 3.75 but 4.2 − 3.0 < 2
    const cohort = result.cohorts.find((row) => row.dimension === 'project_type' && row.label === 'residential');
    expect(cohort).toMatchObject({ count: 20, validationReady: true, calibrated: true, drift: 'stable',
      meanAbsoluteFinishErrorDays: 3.6, meanAbsoluteCostErrorPct: 2.4,
      holdoutFinishCoveragePct: 100, holdoutCostCoveragePct: 100, recentFinishErrorDays: 4.2, recentCostErrorPct: 2.9 });
  });
});

describe('forecast calibration — drift window boundaries', () => {
  function driftSet(recentError: number) {
    // First 10 projects err by 4 days; last 10 by `recentError` days. Cost error flat at 1%.
    const snapshots = Array.from({ length: 20 }, (_, i) => snapshot(`p-${i}`, {
      predictedFinishISO: iso(T0 + (i - (i < 10 ? 4 : recentError)) * DAY).slice(0, 10),
      predictedCostMinor: 990_000,
    }));
    const outcomes = Array.from({ length: 20 }, (_, i) => outcome(`p-${i}`, { completedAtISO: iso(T0 + i * DAY) }));
    return evaluateConstructionForecasts(snapshots, outcomes);
  }

  it('triggers review at exactly 1.25× with a 2-day absolute increase', () => {
    const result = driftSet(6);
    expect(result.previousFinishErrorDays).toBe(4.0);
    expect(result.recentFinishErrorDays).toBe(6.0);
    expect(result.drift).toBe('review_trigger'); // 6 ≥ 4 × 1.25 and 6 − 4 ≥ 2
    expect(result.calibrated).toBe(true); // calibration and drift are independent signals
  });

  it('stays stable at exactly 1.25× when the absolute increase is only 1 day', () => {
    const result = driftSet(5);
    expect(result.recentFinishErrorDays).toBe(5.0);
    expect(result.drift).toBe('stable'); // 5 ≥ 4 × 1.25 but 5 − 4 < 2
  });
});
