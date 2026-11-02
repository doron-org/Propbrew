import { describe, expect, it } from 'vitest';
import * as seed from '@/server/data/seed/fixtures';
import {
  projectEVM, costCodesEVM, projectActualMinor, criticalPath, taskDurationDays,
  scoreQuotes, budgetException, materialLeakage, scanRisks, portfolioConfidence,
  weeklyDigest, slipPropagation, moneySCurve, projectEVMOf, recoveryPlan, zoneProgress, activeLevel,
  scoreSubcontractors, safetyStats, permitClashes, askConstruction, suggestedQuestions,
  revisionChain, currentRevision, nextRevision, canSupersede, docRegister, rfiAgeing,
  parseBoq, boqReconciliation, timesheetCostMinor, costTimesheets, labourPosture, labourByCostCode,
  reasonPareto, reasonsFor, movementAllowed, countVariance, stockLedger,
  routeFor, currentStepOrder, pendingSteps, applyDecision, canApprove, overdueSteps, approvalProgress,
  auditSummary, sensitiveEntries,
  fxExposure, fxPositions, fxUnrealizedMinor, fxSensitivity,
  type ConWorld,
} from '@/domain/construction/engine';
import { fxTable, rateOf, convertMinor, toReporting, fxMovementPct, type FxRate } from '@/domain/fx';
import { money } from '@/domain/primitives';

const NOW = Date.parse('2026-07-26');

const world = (): ConWorld => ({
  projects: seed.constructionProjects, phases: seed.constructionPhases, tasks: seed.constructionTasks, costCodes: seed.constructionCostCodes,
  pos: seed.constructionOrders, requests: seed.constructionRequests, reports: seed.constructionReports,
  materials: seed.constructionMaterials, warehouses: seed.constructionWarehouses, stock: seed.constructionStock, movements: seed.constructionMovements,
  docs: seed.constructionDocs, rfis: seed.constructionRfis, workers: seed.constructionWorkers, issues: seed.constructionIssues,
  milestones: seed.constructionMilestones, attendance: seed.constructionAttendance,
  zones: seed.constructionZones, subcontractors: seed.constructionSubcontractors,
  timesheets: seed.constructionTimesheets, transmittals: seed.constructionTransmittals,
  reasonCodes: seed.constructionReasonCodes, reasonEvents: seed.constructionReasonEvents,
  approvalRules: seed.constructionApprovalRules, approvals: seed.constructionApprovals, audit: seed.constructionAudit,
  fxRates: seed.constructionFxRates,
  safetyEvents: seed.constructionSafetyEvents, safetyPermits: seed.constructionSafetyPermits, toolboxTalks: seed.constructionToolboxTalks,
});
const marina = () => seed.constructionProjects.find((p) => p.id === 'cp-marina')!;

describe('earned value', () => {
  it('computes CPI/SPI/EAC/VAC for a behind-and-over project', () => {
    const ac = projectActualMinor('cp-marina', seed.constructionCostCodes); // 1,580m
    const evm = projectEVM(marina(), ac);
    expect(evm.spi).toBe(0.8); // earned 36% vs planned 45%
    expect(evm.cpi).toBe(0.96); // earned < spent
    expect(evm.eac).toBeGreaterThan(evm.bac); // forecast overrun
    expect(evm.vac).toBeLessThan(0);
    expect(evm.scheduleBand).toBe('danger');
  });
  it('rolls cost codes into an EVM and draws a money S-curve', () => {
    const codes = seed.constructionCostCodes.filter((c) => c.projectId === 'cp-marina');
    expect(costCodesEVM(codes).cpi).toBeLessThan(1);
    const curve = moneySCurve(projectEVMOf(marina(), seed.constructionCostCodes), 0.45);
    expect(curve[curve.length - 1].pv).toBe(projectEVMOf(marina(), seed.constructionCostCodes).bac); // planned reaches BAC
    expect(curve[0].pv).toBeLessThan(curve[curve.length - 1].pv); // monotone up
  });
});

describe('critical path (CPM)', () => {
  it('finds the zero-float critical chain over the dependency DAG', () => {
    const tasks = seed.constructionTasks.filter((t) => t.projectId === 'cp-marina');
    const cpm = criticalPath(tasks.map((t) => ({ id: t.id, durationDays: taskDurationDays(t), dependsOn: t.dependsOn })));
    expect(cpm.durationDays).toBe(101); // m1→m2→m3→m4→m6
    expect(cpm.critical.has('tk-m4')).toBe(true);
    expect(cpm.critical.has('tk-m6')).toBe(true);
    expect(cpm.critical.has('tk-m5')).toBe(false); // blockwork has float
    expect(cpm.slack.get('tk-m5')).toBe(5);
  });
  it('propagates a slip to downstream tasks', () => {
    const affected = slipPropagation(seed.constructionTasks, 'tk-m3', 5);
    expect(affected.taskIds).toEqual(expect.arrayContaining(['tk-m4', 'tk-m5', 'tk-m6', 'tk-m7']));
  });
});

describe('procurement + budget', () => {
  it('scores and ranks bids, recommending the top score', () => {
    const scored = scoreQuotes(seed.constructionRfqs[0].quotes);
    expect(scored).toHaveLength(3);
    expect(scored[0].score).toBeGreaterThanOrEqual(scored[1].score);
    expect(scored[0].recommended).toBe(true);
    expect(scored[0].quote.vendorId).toBe('v-blockmasters'); // cheapest wins on the weighted score
  });
  it('flags a purchase request that breaches its cost code budget', () => {
    const craneHire = seed.constructionRequests.find((r) => r.id === 'pr-m2')!; // MAR-PRE, ₦48m
    expect(budgetException(craneHire, seed.constructionCostCodes).exception).toBe(true);
  });
});

describe('materials leakage', () => {
  it('detects unaccounted material (received − issued − on-hand)', () => {
    const leak = materialLeakage('mat-rebar', seed.constructionMovements, 5); // received 60, issued 48, on-hand 5
    expect(leak.leakageQty).toBe(7);
    expect(leak.leakagePct).toBe(12);
    expect(leak.anomalous).toBe(true);
  });
});

describe('risk radar', () => {
  it('scans the world and emits the expected advisory signals', () => {
    const kinds = new Set(scanRisks(world(), NOW).map((s) => s.kind));
    for (const k of ['schedule_slip', 'cost_overrun', 'procurement_late', 'low_stock', 'overdue_rfi', 'cert_expiry', 'material_leakage']) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });
  it('ranks by naira-at-risk × severity and rolls up portfolio confidence', () => {
    const signals = scanRisks(world(), NOW);
    expect(signals.length).toBeGreaterThan(3);
    const conf = portfolioConfidence(seed.constructionProjects, seed.constructionCostCodes, signals);
    expect(conf.score).toBeGreaterThanOrEqual(0);
    expect(conf.score).toBeLessThanOrEqual(100);
    expect(conf.nairaAtRiskMinor).toBeGreaterThan(0);
  });
});

describe('weekly digest', () => {
  it('compiles source-linked sections and honest coverage gaps', () => {
    const d = weeklyDigest(marina(), world(), NOW);
    expect(d.sections).toHaveLength(4);
    expect(d.sections.every((s) => Array.isArray(s.sources))).toBe(true);
    expect(d.coverageGaps.length).toBeGreaterThan(0); // 07-25 report is only 'submitted', not approved
  });
  it('does not claim missing reports before a newly started project existed', () => {
    const project = { ...marina(), id: 'cp-pilot', status: 'active' as const, startISO: '2026-07-26' };
    const pilotWorld = { ...world(), projects: [project], reports: [], pos: [] };
    const digest = weeklyDigest(project, pilotWorld, NOW);
    expect(digest.coverageGaps).toEqual([]);
    expect(scanRisks(pilotWorld, NOW).some((risk) => risk.projectId === project.id && risk.kind === 'missing_report')).toBe(false);
  });
});

describe('what-if simulator', () => {
  it('buys back days cheapest-first from the critical chain only', () => {
    const tasks = seed.constructionTasks.filter((t) => t.projectId === 'cp-marina');
    const cpm = criticalPath(tasks.map((t) => ({ id: t.id, durationDays: taskDurationDays(t), dependsOn: t.dependsOn })));
    const plan = recoveryPlan(tasks, cpm.critical, 8);
    // cheapest crashable critical tasks first: tk-m6 (₦1.5m/d, 4d) then tk-m2 (₦1.8m/d)
    expect(plan.crashes[0].taskId).toBe('tk-m6');
    expect(plan.crashes[1].taskId).toBe('tk-m2');
    expect(plan.daysRecovered).toBe(8);
    expect(plan.extraCostMinor).toBe(4 * 150_000_000 + 4 * 180_000_000); // ₦13.2m
    expect(plan.shortfallDays).toBe(0);
    // non-critical blockwork is never crashed — shortening it wouldn't move the finish
    expect(plan.crashes.some((c) => c.taskId === 'tk-m5')).toBe(false);
  });
  it('reports a shortfall when the target exceeds what can be crashed', () => {
    const tasks = seed.constructionTasks.filter((t) => t.projectId === 'cp-marina');
    const cpm = criticalPath(tasks.map((t) => ({ id: t.id, durationDays: taskDurationDays(t), dependsOn: t.dependsOn })));
    expect(recoveryPlan(tasks, cpm.critical, 60).shortfallDays).toBeGreaterThan(0);
  });
});

describe('site twin', () => {
  it('weights the construction sequence and finds the active level', () => {
    const l4 = seed.constructionZones.find((z) => z.id === 'z-m-l4')!;
    expect(zoneProgress(l4)).toBe(32); // structure 80% × 0.4
    expect(zoneProgress(seed.constructionZones.find((z) => z.id === 'z-m-l1')!)).toBe(85);
    expect(activeLevel(seed.constructionZones.filter((z) => z.projectId === 'cp-marina'))).toBe(4);
  });
});

describe('subcontractor league', () => {
  it('ranks on delivery, quality and safety with a transparent composite', () => {
    const league = scoreSubcontractors(seed.constructionSubcontractors);
    expect(league[0].sub.name).toBe('GlazePro Facades'); // perfect delivery, no defects, no incidents
    expect(league[0].rank).toBe(1);
    const worst = league[league.length - 1];
    expect(worst.sub.name).toBe('Lagos Groundworks'); // 7/12 on time, 5 defects, 2 incidents
    expect(worst.band).toBe('danger');
  });
});

describe('safety', () => {
  it('scores posture and flags lapsed permits + location clashes', () => {
    const s = safetyStats(seed.constructionSafetyEvents, seed.constructionSafetyPermits, seed.constructionToolboxTalks, NOW);
    expect(s.daysSinceLTI).toBe(45); // 2026-06-11 → 2026-07-26
    expect(s.expiredPermits).toBe(1); // PTW-9098 ran to 07-24 but is still active
    expect(s.nearMisses).toBe(2);
    const clashes = permitClashes(seed.constructionSafetyPermits);
    expect(clashes).toHaveLength(1); // hot work + work at height, same place, same window
    expect(clashes[0].a.ref).toBe('PTW-9101');
  });
});

describe('construction copilot', () => {
  it('answers from records with citations, and refuses what it cannot ground', () => {
    const behind = askConstruction('which projects are behind schedule?', world(), NOW);
    expect(behind.grounded).toBe(true);
    expect(behind.answer).toContain('Marina Heights');
    expect(behind.sources.length).toBeGreaterThan(0);
    const cost = askConstruction('are we over budget?', world(), NOW);
    expect(cost.answer).toMatch(/over/);
    const nonsense = askConstruction('what is the capital of France?', world(), NOW);
    expect(nonsense.grounded).toBe(false);
    expect(suggestedQuestions(world(), NOW).length).toBeGreaterThan(0);
  });
});

describe('document revision control', () => {
  it('exposes the chain and only ever one current (approved) issue', () => {
    const chain = revisionChain(seed.constructionDocs, 'MAR-ST-104');
    expect(chain.map((d) => d.revision)).toEqual(['C', 'B']); // newest first
    expect(currentRevision(seed.constructionDocs, 'MAR-ST-104')!.revision).toBe('C');
    // a drawing still in review is explicitly NOT the current issue
    expect(currentRevision(seed.constructionDocs, 'MAR-ME-210')).toBeNull();
  });
  it('sequences revision letters and demands a note over an approved issue', () => {
    expect(nextRevision('C')).toBe('D');
    expect(nextRevision('Z')).toBe('AA');
    const approved = seed.constructionDocs.find((d) => d.id === 'doc-m1')!;
    expect(canSupersede(approved)).toEqual({ allowed: true, requiresNote: true });
    const superseded = seed.constructionDocs.find((d) => d.id === 'doc-m2')!;
    expect(canSupersede(superseded).allowed).toBe(false);
  });
  it('keeps the approved issue current while a draft revision is in progress', () => {
    // A site must always have something to build to: starting rev D must NOT
    // retire rev C — only APPROVING D does that.
    const withDraft = [
      ...seed.constructionDocs,
      { ...seed.constructionDocs[0], id: 'doc-m1-d', revision: 'D', status: 'draft' as const },
    ];
    expect(currentRevision(withDraft, 'MAR-ST-104')!.revision).toBe('C');
    const row = docRegister(withDraft).find((r) => r.number === 'MAR-ST-104')!;
    expect(row.revisions).toHaveLength(3);
    expect(row.inReview).toBe(1);
    expect(row.current!.revision).toBe('C'); // still buildable
  });
  it('builds a register keyed by document number', () => {
    const reg = docRegister(seed.constructionDocs);
    const st = reg.find((r) => r.number === 'MAR-ST-104')!;
    expect(st.revisions).toHaveLength(2);
    expect(st.current!.revision).toBe('C');
    expect(reg.find((r) => r.number === 'MAR-ME-210')!.inReview).toBe(1);
  });
  it('ages an unanswered RFI past its due date', () => {
    const overdue = seed.constructionRfis.find((r) => r.id === 'rfi-m1')!; // due 07-18, still open
    expect(rfiAgeing(overdue, NOW).overdueDays).toBe(8);
    expect(rfiAgeing(overdue, NOW).band).toBe('danger');
    const answered = seed.constructionRfis.find((r) => r.id === 'rfi-m2')!;
    expect(rfiAgeing(answered, NOW).overdueDays).toBe(0); // answered stops the clock
  });
});

describe('BOQ import', () => {
  it('parses a clean paste and totals it', () => {
    const p = parseBoq('Code\tName\tCategory\tAmount\nMAR-EXT\tExternal works\tExternal\t120,000,000\nMAR-LFT\tLifts\tServices\t₦85000000');
    expect(p.rows).toHaveLength(2); // header skipped
    expect(p.rows[0].budgetMinor).toBe(12_000_000_000); // ₦120m in kobo
    expect(p.rows[1].budgetMinor).toBe(8_500_000_000); // ₦ and separators stripped
    expect(p.totalMinor).toBe(20_500_000_000);
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
  it('reports bad lines instead of guessing, and never imports them', () => {
    const p = parseBoq([
      'GOOD\tFine line\tStructure\t1000',
      'SHORT\tonly three',
      'BAD\tNot a number\tStructure\tabc',
      '\tNo code\tStructure\t500',
      'NEG\tNegative\tStructure\t-5',
      'GOOD\tDuplicate code\tStructure\t99',
    ].join('\n'));
    expect(p.rows.map((r) => r.code)).toEqual(['GOOD']); // only the clean line survives
    const errs = p.issues.filter((i) => i.severity === 'error');
    expect(errs).toHaveLength(5);
    expect(errs.some((e) => /Duplicate cost code/.test(e.message))).toBe(true);
    expect(errs.some((e) => /not a number/.test(e.message))).toBe(true);
  });
  it('warns (not errors) when a code already exists, and reconciles to budget', () => {
    const p = parseBoq('MAR-SUP\tSuperstructure\tStructure\t100', ['MAR-SUP']);
    expect(p.rows).toHaveLength(1); // still imported — it's an update
    expect(p.issues[0].severity).toBe('warning');
    expect(boqReconciliation(10_000, 10_000).band).toBe('success');
    expect(boqReconciliation(12_000, 10_000).pct).toBe(20);
    expect(boqReconciliation(12_000, 10_000).band).toBe('danger');
  });
});

describe('timesheets → earned value', () => {
  it('costs hours off the day rate with overtime at 1.5x', () => {
    // ₦45,000/day → ₦5,625/hour. 48 normal + 6 OT = 270,000 + 50,625 = ₦320,625
    expect(timesheetCostMinor({ normalHours: 48, overtimeHours: 6 }, 4_500_000)).toBe(32_062_500); // ₦320,625
    expect(timesheetCostMinor({ normalHours: 8, overtimeHours: 0 }, 4_500_000)).toBe(4_500_000); // one 8h day == the day rate
  });
  it('separates posted labour from cost the EVM cannot yet see', () => {
    const views = costTimesheets(seed.constructionTimesheets, seed.constructionWorkers);
    const p = labourPosture(views);
    expect(p.pendingSheets).toBe(4); // 3 submitted + 1 draft
    expect(p.pendingMinor).toBeGreaterThan(0);
    expect(p.postedMinor).toBeGreaterThan(0);
    // grouping lands on the right cost codes
    const byCode = labourByCostCode(views);
    expect(byCode[0].code).toBe('MAR-SUP');
    expect(byCode.some((r) => r.code === 'MAR-MEP')).toBe(true);
  });
});

describe('reason codes', () => {
  it('builds a Pareto and marks the vital few', () => {
    const p = reasonPareto(seed.constructionReasonEvents, seed.constructionReasonCodes, 'delay');
    expect(p[0].code.code).toBe('DLY-MAT'); // 3 of 7 delays
    expect(p[0].count).toBe(3);
    expect(p[0].vital).toBe(true);
    // cumulative share is monotonic and lands at 100
    expect(p[p.length - 1].cumulativePct).toBeGreaterThanOrEqual(99.9);
    // the long tail is not "vital"
    expect(p[p.length - 1].vital).toBe(false);
    // impact is summed, so a weighted view is possible
    expect(p[0].impactDays).toBe(9); // 4 + 3 + 2
  });
  it('offers only active codes for a domain', () => {
    const rejections = reasonsFor(seed.constructionReasonCodes, 'rejection');
    expect(rejections.every((c) => c.domain === 'rejection' && c.active)).toBe(true);
    expect(rejections.some((c) => c.code === 'REJ-OT')).toBe(true);
  });
});

describe('stock movements', () => {
  it('never lets stock go negative', () => {
    expect(movementAllowed('issue', 10, 12).allowed).toBe(false);
    expect(movementAllowed('transfer', 10, 12).allowed).toBe(false);
    expect(movementAllowed('issue', 10, 10).allowed).toBe(true);
    expect(movementAllowed('receipt', 0, 50).allowed).toBe(true); // receipts always fine
    expect(movementAllowed('issue', 10, 0).allowed).toBe(false); // zero is not a movement
  });
  it('bands a count variance by direction and severity', () => {
    expect(countVariance(100, 100)).toMatchObject({ deltaQty: 0, direction: 'exact', band: 'success' });
    expect(countVariance(100, 88)).toMatchObject({ deltaQty: -12, pct: 12, direction: 'short', band: 'danger' });
    expect(countVariance(100, 96)).toMatchObject({ direction: 'short', band: 'warn' });
    expect(countVariance(100, 101)).toMatchObject({ direction: 'over', band: 'info' });
  });
  it('replays movements into a running balance', () => {
    const ledger = stockLedger(seed.constructionMovements, 'mat-rebar');
    expect(ledger.length).toBeGreaterThan(0);
    // receipts add, issues subtract — the last running figure is the book balance
    expect(ledger[ledger.length - 1].runningQty).toBe(12); // 60 received − 48 issued
  });
});

describe('approval workflow', () => {
  it('routes by value, most-specific first', () => {
    const rules = seed.constructionApprovalRules;
    expect(routeFor(rules, 'purchase_request', 500_000_00)!.id).toBe('ar-pr-base');
    expect(routeFor(rules, 'purchase_request', 2_000_000_000)!.id).toBe('ar-pr-mid');
    expect(routeFor(rules, 'purchase_request', 12_000_000_000)!.id).toBe('ar-pr-high');
    expect(routeFor(rules, 'timesheet', 1_000)).toBeNull(); // no route configured
  });
  it('holds at a parallel step until every approver is in', () => {
    const req = seed.constructionApprovals.find((a) => a.id === 'apr-1')!; // QS in, Finance out
    expect(currentStepOrder(req)).toBe(2);
    expect(pendingSteps(req).map((s) => s.label)).toEqual(['Finance']);
    // executive approving Finance advances to order 3, not to done
    const after = applyDecision(req, 2, 'executive', 'approved', 'Chidi Okonkwo', '2026-07-26');
    expect(after.status).toBe('in_flight');
    expect(currentStepOrder(after)).toBe(3);
  });
  it('enforces segregation of duties and role ownership', () => {
    const req = seed.constructionApprovals.find((a) => a.id === 'apr-2')!; // raised by Emeka
    expect(canApprove(req, ['estate_manager'], 'Emeka Nwosu').allowed).toBe(false); // own request
    expect(canApprove(req, ['facility_manager'], 'Bola Adeyemi').allowed).toBe(false); // wrong role
    expect(canApprove(req, ['estate_manager'], 'Ngozi Okafor').allowed).toBe(true);
    const done = seed.constructionApprovals.find((a) => a.id === 'apr-3')!;
    expect(canApprove(done, ['executive'], 'Chidi Okonkwo').allowed).toBe(false); // already resolved
  });
  it('a rejection stops the whole request', () => {
    const req = seed.constructionApprovals.find((a) => a.id === 'apr-2')!;
    const rejected = applyDecision(req, 1, 'estate_manager', 'rejected', 'Ngozi Okafor', '2026-07-26', 'no');
    expect(rejected.status).toBe('rejected');
    expect(rejected.steps.every((s) => s.status !== 'pending')).toBe(true); // downstream skipped
  });
  it('flags steps past their SLA', () => {
    const req = seed.constructionApprovals.find((a) => a.id === 'apr-2')!; // raised 07-20, 48h SLA
    expect(overdueSteps(req, NOW).length).toBe(1);
    expect(overdueSteps(seed.constructionApprovals.find((a) => a.id === 'apr-3')!, NOW)).toHaveLength(0);
    expect(approvalProgress(req).pct).toBe(0);
  });
});

describe('audit trail', () => {
  it('summarises what an auditor looks at first', () => {
    const s = auditSummary(seed.constructionAudit);
    expect(s.total).toBe(6);
    expect(s.overrides).toBe(1);
    expect(s.actors).toBe(3);
    expect(sensitiveEntries(seed.constructionAudit).some((e) => e.action === 'override')).toBe(true);
    expect(s.valueMovedMinor).toBeGreaterThan(0);
  });
});

describe('multi-currency — conversion', () => {
  const table = fxTable(seed.constructionFxRates as unknown as FxRate[]);
  it('prices foreign minor units through the reporting currency', () => {
    expect(rateOf('NGN', table)).toBe(1);
    expect(rateOf('USD', table)).toBe(1600);
    expect(convertMinor(100, 'USD', 'NGN', table)).toBe(160_000); // $1 → ₦1,600
    expect(convertMinor(100, 'USD', 'GHS', table)).toBe(Math.round((100 * 1600) / 102)); // cross rate
    expect(convertMinor(500, 'NGN', 'NGN', table)).toBe(500); // identity, no rounding
  });
  it('leaves NGN Money untouched and converts foreign Money', () => {
    const ngn = money(250_000, 'NGN');
    expect(toReporting(ngn, table)).toBe(ngn); // same reference — no work done
    expect(toReporting(money(100, 'USD'), table)).toEqual({ minor: 160_000, currency: 'NGN' });
  });
  it('reports rate movement against the prior rate', () => {
    const usd = (seed.constructionFxRates as unknown as FxRate[]).find((r) => r.currency === 'USD')!;
    expect(fxMovementPct(usd)).toBe(5.3); // (1600-1520)/1520
    expect(fxMovementPct({ currency: 'USD', rate: 1600, asOfISO: '2026-07-26' })).toBeNull(); // no prior
  });
  it('refuses to price an unrated currency rather than assume 1:1', () => {
    expect(() => rateOf('USD', fxTable([]))).toThrow();
  });
});

describe('multi-currency — exposure & revaluation', () => {
  const table = fxTable(seed.constructionFxRates as unknown as FxRate[]);
  const rows = fxExposure(seed.constructionOrders, table);

  it('revalues only foreign, unsettled commitments on their outstanding portion', () => {
    expect(rows).toHaveLength(3); // the NGN POs carry no fx tag
    const lifts = rows.find((r) => r.ref === 'PO-3021')!; // USD, 0 delivered → fully outstanding
    expect(lifts.outstandingForeignMinor).toBe(18_000_000);
    expect(lifts.bookedMinor).toBe(27_000_000_000); // @1500
    expect(lifts.spotMinor).toBe(28_800_000_000);   // @1600
    expect(lifts.unrealizedMinor).toBe(1_800_000_000); // ₦18.0m loss
    expect(lifts.tone).toBe('danger');

    const facade = rows.find((r) => r.ref === 'PO-3022')!; // GHS, 40/100 delivered
    expect(facade.outstandingForeignMinor).toBe(72_000_000); // 60% of 120m
    expect(facade.unrealizedMinor).toBe(288_000_000); // @(102-98)
    expect(facade.tone).toBe('warn'); // < 5% swing
  });

  it('treats a delivered order as settled — no exposure', () => {
    const settled = fxExposure([{ ...seed.constructionOrders.find((p) => p.ref === 'PO-3021')!, status: 'delivered' }], table);
    expect(settled[0].outstandingFraction).toBe(0);
    expect(settled[0].unrealizedMinor).toBe(0);
  });

  it('nets exposure by currency, worst first', () => {
    const positions = fxPositions(rows);
    expect(positions[0].currency).toBe('USD'); // biggest swing
    expect(positions.find((p) => p.currency === 'USD')!.count).toBe(2);
    expect(fxUnrealizedMinor(rows)).toBe(3_421_333_360); // ₦34.2m total loss
  });

  it('scales linearly with a further naira move', () => {
    const totalSpot = rows.reduce((n, r) => n + r.spotMinor, 0);
    expect(fxSensitivity(rows, 10)).toBe(Math.round(totalSpot * 0.1));
    expect(fxSensitivity(rows, -10)).toBe(-fxSensitivity(rows, 10));
    expect(fxSensitivity(rows, 0)).toBe(0);
  });
});
