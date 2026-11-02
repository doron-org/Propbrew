/**
 * Construction engine (deterministic, no ML). The commercial + predictive heart:
 * Earned-Value Management (PV/EV/AC → CPI/SPI/EAC/ETC/VAC/TCPI), critical-path
 * scheduling (CPM forward/backward pass), procurement bid scoring + award
 * recommendation, budget-exception detection, inventory stock signals + leakage,
 * and a cross-project risk radar. Every "AI/forecast" output is advisory, carries
 * evidence + confidence, and is labelled as such in the UI.
 */

import type { Tone } from '@/lib/status-tones';
import type { CurrencyCode } from '@/domain/primitives';
import { type FxTable, rateOf } from '@/domain/fx';
import type {
  Project, Phase, Task, CostCode, Quote, PurchaseOrder, PurchaseRequest, Material, StockItem,
  StockMovement, Warehouse, Milestone, Issue, DailyReport, RFI, Worker, Vendor, Attendance,
  Zone, Subcontractor, SafetyEvent, SafetyPermit, SafetyPermitType, SafetyEventKind, ToolboxTalk,
  DocStatus, ConstructionDoc, Timesheet, Transmittal, FxRateRow,
  ReasonCode, ReasonDomain, ReasonEvent, ApprovalRule, ApprovalSubject, ApprovalStepState,
  ApprovalRequest, ApprovalStatus, StepStatus, AuditEntry, AuditAction, StockKind,
} from './types';

const DAY = 24 * 3600 * 1000;
const minor = (m: { minor: number }) => m.minor;

/* --- Earned Value Management ---------------------------------------------- */

export type EVM = {
  bac: number; pv: number; ev: number; ac: number;
  cv: number; sv: number; cpi: number; spi: number;
  eac: number; etc: number; vac: number; tcpi: number;
  costBand: Tone; scheduleBand: Tone;
};

/** Project-level earned value. BAC = approved budget; PV/EV scale it by planned
 *  and actual %; AC is the summed actual cost. Classic PMI formulas. */
export function projectEVM(p: Pick<Project, 'approvedBudget' | 'plannedPercent' | 'percentComplete'>, actualMinor: number): EVM {
  const bac = minor(p.approvedBudget);
  const pv = Math.round(bac * p.plannedPercent / 100);
  const ev = Math.round(bac * p.percentComplete / 100);
  const ac = Math.max(0, actualMinor);
  const cpi = ac > 0 ? ev / ac : 1;
  const spi = pv > 0 ? ev / pv : 1;
  const eac = cpi > 0 ? Math.round(bac / cpi) : bac;
  const etc = Math.max(0, eac - ac);
  const vac = bac - eac;
  const tcpi = (bac - ac) !== 0 ? (bac - ev) / (bac - ac) : 1;
  return {
    bac, pv, ev, ac, cv: ev - ac, sv: ev - pv, cpi: round2(cpi), spi: round2(spi),
    eac, etc, vac, tcpi: round2(tcpi),
    costBand: perfBand(cpi), scheduleBand: perfBand(spi),
  };
}

/** Roll several cost codes into one EVM using each code's own budget/earned/actual. */
export function costCodesEVM(codes: readonly CostCode[]): EVM {
  const bac = codes.reduce((n, c) => n + minor(c.budget), 0);
  const pv = codes.reduce((n, c) => n + Math.round(minor(c.budget) * c.plannedPercent / 100), 0);
  const ev = codes.reduce((n, c) => n + Math.round(minor(c.budget) * c.earnedPercent / 100), 0);
  const ac = codes.reduce((n, c) => n + minor(c.actual), 0);
  const cpi = ac > 0 ? ev / ac : 1;
  const spi = pv > 0 ? ev / pv : 1;
  const eac = cpi > 0 ? Math.round(bac / cpi) : bac;
  return { bac, pv, ev, ac, cv: ev - ac, sv: ev - pv, cpi: round2(cpi), spi: round2(spi), eac, etc: Math.max(0, eac - ac), vac: bac - eac, tcpi: round2((bac - ac) !== 0 ? (bac - ev) / (bac - ac) : 1), costBand: perfBand(cpi), scheduleBand: perfBand(spi) };
}

/** Performance-index band: ≥1 good, ≥0.9 watch, else at-risk. */
export function perfBand(index: number): Tone {
  return index >= 1 ? 'success' : index >= 0.9 ? 'warn' : 'danger';
}

export function committedMinor(codes: readonly CostCode[]): number { return codes.reduce((n, c) => n + minor(c.committed), 0); }

/* --- S-curve (planned vs actual cumulative spend) ------------------------- */

export type CurvePoint = { label: string; plannedPct: number; actualPct: number };
/** A smooth cumulative-progress S-curve to `nowPct`, with planned running slightly
 *  ahead — deterministic (logistic shape), for the cash-flow / progress chart. */
export function sCurve(plannedPct: number, actualPct: number, points = 10): CurvePoint[] {
  const logistic = (t: number) => 1 / (1 + Math.exp(-8 * (t - 0.5)));
  const base = logistic(1) - logistic(0);
  const out: CurvePoint[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const s = (logistic(t) - logistic(0)) / base; // 0..1
    out.push({ label: `M${i}`, plannedPct: Math.round(s * plannedPct), actualPct: t <= (actualPct / 100) + 0.0001 ? Math.round(s * actualPct * (plannedPct ? 1 : 1)) : Math.round(s * actualPct) });
  }
  return out;
}

/* --- schedule health ------------------------------------------------------ */

export function scheduleVariancePct(p: Pick<Project, 'plannedPercent' | 'percentComplete'>): number {
  return p.percentComplete - p.plannedPercent;
}

/** Forecast finish from SPI: the slower you earn, the later you finish. */
export function forecastFinishISO(p: Pick<Project, 'startISO' | 'plannedFinishISO'> & Partial<Pick<Project, 'approvedChangeDays' | 'approvedChangeDaysInBaseline' | 'mobilisation'>>, spi: number): { iso: string; slipDays: number } {
  const start = Date.parse(p.startISO), planned = Date.parse(p.plannedFinishISO);
  const dur = Math.max(1, planned - start);
  const forecastDur = spi > 0 ? dur / spi : dur * 2;
  const approvedDays = Math.max(0, (p.approvedChangeDays ?? 0) - (p.approvedChangeDaysInBaseline ?? 0));
  const forecast = new Date(start + forecastDur);
  const workingDays = p.mobilisation?.calendar?.workingDays ?? [1, 2, 3, 4, 5, 6];
  const holidays = new Set(p.mobilisation?.calendar?.holidays ?? []);
  for (let day = 0; day < approvedDays; day++) {
    do { forecast.setUTCDate(forecast.getUTCDate() + 1); }
    while (!workingDays.includes(forecast.getUTCDay()) || holidays.has(forecast.toISOString().slice(0, 10)));
  }
  const iso = forecast.toISOString().slice(0, 10);
  return { iso, slipDays: Math.round((Date.parse(iso) - planned) / DAY) };
}

export function projectHealth(spi: number, cpi: number, openCritical: number): { score: number; band: Tone; label: string } {
  const sched = Math.min(100, Math.round(spi * 100));
  const cost = Math.min(100, Math.round(cpi * 100));
  const score = Math.max(0, Math.round(0.45 * sched + 0.45 * cost - openCritical * 5));
  const band: Tone = score >= 90 ? 'success' : score >= 75 ? 'warn' : 'danger';
  return { score, band, label: score >= 90 ? 'On track' : score >= 75 ? 'Watch' : 'At risk' };
}

/* --- critical path (CPM) -------------------------------------------------- */

export type CpmTask = { id: string; durationDays: number; dependsOn: readonly string[]; startOffsetDays?: number; dependencyLagDays?: Readonly<Record<string, number>> };
export type CpmResult = { es: Map<string, number>; ef: Map<string, number>; ls: Map<string, number>; lf: Map<string, number>; slack: Map<string, number>; critical: Set<string>; durationDays: number };

/** Forward+backward pass over a finish-to-start DAG → earliest/latest times and
 *  the zero-slack critical path. Task durations in days. */
export function criticalPath(tasks: readonly CpmTask[]): CpmResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const es = new Map<string, number>(), ef = new Map<string, number>();
  const visiting = new Set<string>();
  const efOf = (id: string): number => {
    if (ef.has(id)) return ef.get(id)!;
    if (visiting.has(id)) throw new Error('Task dependencies contain a cycle.');
    visiting.add(id);
    const t = byId.get(id)!;
    if (!Number.isSafeInteger(t.durationDays) || t.durationDays < 1) throw new Error('Task duration must be a positive whole working day.');
    for (const lag of Object.values(t.dependencyLagDays ?? {})) if (!Number.isSafeInteger(lag) || lag < 0) throw new Error('Dependency lag must be a non-negative whole working day.');
    const start = Math.max(t.startOffsetDays ?? 0, ...t.dependsOn.filter((d) => byId.has(d)).map((d) => efOf(d) + (t.dependencyLagDays?.[d] ?? 0)));
    es.set(id, start); const finish = start + t.durationDays; ef.set(id, finish); visiting.delete(id); return finish;
  };
  for (const t of tasks) efOf(t.id);
  const projectEnd = Math.max(0, ...[...ef.values()]);
  const dependents = new Map<string, { id: string; lag: number }[]>();
  for (const t of tasks) for (const d of t.dependsOn) if (byId.has(d)) dependents.set(d, [...(dependents.get(d) ?? []), { id: t.id, lag: t.dependencyLagDays?.[d] ?? 0 }]);
  const lf = new Map<string, number>(), ls = new Map<string, number>();
  const lfOf = (id: string): number => {
    if (lf.has(id)) return lf.get(id)!;
    const deps = dependents.get(id) ?? [];
    const finish = deps.length ? Math.min(...deps.map((d) => lsOf(d.id) - d.lag)) : projectEnd;
    lf.set(id, finish); ls.set(id, finish - byId.get(id)!.durationDays); return finish;
  };
  const lsOf = (id: string): number => { lfOf(id); return ls.get(id)!; };
  for (const t of tasks) lfOf(t.id);
  const slack = new Map<string, number>(), critical = new Set<string>();
  for (const t of tasks) { const s = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0); slack.set(t.id, s); if (s <= 0) critical.add(t.id); }
  return { es, ef, ls, lf, slack, critical, durationDays: projectEnd };
}

export type ProgrammeCalendar = { workingDays: readonly number[]; holidays: readonly string[] };
export type ProgrammeNetwork = CpmResult & {
  startISO: Map<string, string>; finishISO: Map<string, string>;
  projectFinishISO: string | null; workingDayISO: readonly string[];
};

/** Date-aware finish-to-start network. All offsets, gaps and float use the
 * project's own working days; an explicit lag supersedes the legacy date gap. */
export function programmeNetwork(tasks: readonly Task[], calendar: ProgrammeCalendar, asOfISO?: string): ProgrammeNetwork {
  const empty = criticalPath([]);
  if (!tasks.length) return { ...empty, startISO: new Map(), finishISO: new Map(), projectFinishISO: null, workingDayISO: [] };
  if (!calendar.workingDays.length) throw new Error('Programme calendar needs a working day.');
  const earliest = tasks.reduce((date, task) => task.plannedStartISO < date ? task.plannedStartISO : date, tasks[0].plannedStartISO);
  const latest = tasks.reduce((date, task) => task.plannedFinishISO > date ? task.plannedFinishISO : date, asOfISO && asOfISO > tasks[0].plannedFinishISO ? asOfISO : tasks[0].plannedFinishISO);
  const holidays = new Set(calendar.holidays);
  const workingDayISO: string[] = [];
  const startMs = Date.parse(`${earliest}T00:00:00Z`);
  const endMs = Date.parse(`${latest}T00:00:00Z`) + 3650 * DAY;
  for (let dateMs = startMs; dateMs <= endMs; dateMs += DAY) {
    const iso = new Date(dateMs).toISOString().slice(0, 10);
    if (calendar.workingDays.includes(new Date(dateMs).getUTCDay()) && !holidays.has(iso)) workingDayISO.push(iso);
  }
  const onOrAfter = (iso: string) => {
    let lo = 0, hi = workingDayISO.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (workingDayISO[mid] < iso) lo = mid + 1; else hi = mid; }
    return Math.min(lo, workingDayISO.length - 1);
  };
  const onOrBefore = (iso: string) => {
    let lo = 0, hi = workingDayISO.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (workingDayISO[mid] <= iso) lo = mid + 1; else hi = mid; }
    return Math.max(0, lo - 1);
  };
  const planned = new Map(tasks.map((task) => [task.id, {
    start: onOrAfter(task.plannedStartISO), finish: onOrBefore(task.plannedFinishISO),
  }]));
  const networkTasks: CpmTask[] = tasks.map((task) => {
    const dates = planned.get(task.id)!;
    const duration = Math.max(1, dates.finish - dates.start + 1);
    const completed = task.status === 'done' || task.percentComplete >= 100;
    const remaining = completed ? duration : asOfISO ? Math.max(1, Math.ceil(duration * (1 - task.percentComplete / 100))) : duration;
    const actualFinish = completed && task.actualFinishISO ? onOrBefore(task.actualFinishISO) : null;
    const offset = completed ? dates.start : Math.max(dates.start, asOfISO ? onOrAfter(asOfISO) : 0);
    const lag = Object.fromEntries(task.dependsOn.map((id) => {
      const predecessor = planned.get(id);
      const inferred = predecessor ? Math.max(0, dates.start - predecessor.finish - 1) : 0;
      return [id, task.dependencyLags?.[id] ?? inferred];
    }));
    return { id: task.id, dependsOn: task.dependsOn, startOffsetDays: actualFinish === null ? offset : Math.max(0, actualFinish - duration + 1), durationDays: actualFinish === null ? remaining + (asOfISO && !completed ? task.programmeDelay?.workingDays ?? 0 : 0) : duration, dependencyLagDays: lag };
  });
  const result = criticalPath(networkTasks);
  const startISO = new Map(tasks.map((task) => [task.id, workingDayISO[result.es.get(task.id) ?? 0]]));
  const finishISO = new Map(tasks.map((task) => [task.id, workingDayISO[Math.max(0, (result.ef.get(task.id) ?? 1) - 1)]]));
  return { ...result, startISO, finishISO, projectFinishISO: workingDayISO[Math.max(0, result.durationDays - 1)] ?? null, workingDayISO };
}

export type LookAheadRow = { id: string; startISO: string; finishISO: string; state: 'overdue' | 'blocked' | 'ready' | 'upcoming'; daysUntilStart: number };
/** Rolling 2/4/6 week window, including overdue unfinished work. */
export function programmeLookAhead(tasks: readonly Task[], network: ProgrammeNetwork, todayISO: string, weeks: 2 | 4 | 6): LookAheadRow[] {
  const horizonMs = Date.parse(`${todayISO}T00:00:00Z`) + weeks * 7 * DAY;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => task.status !== 'done' && task.percentComplete < 100).flatMap((task) => {
    const startISO = network.startISO.get(task.id), finishISO = network.finishISO.get(task.id);
    if (!startISO || !finishISO || Date.parse(startISO) > horizonMs) return [];
    const predecessorOpen = task.dependsOn.some((id) => byId.has(id) && byId.get(id)!.status !== 'done' && byId.get(id)!.percentComplete < 100);
    const state: LookAheadRow['state'] = task.plannedFinishISO < todayISO ? 'overdue' : task.status === 'blocked' || predecessorOpen ? 'blocked' : startISO <= todayISO ? 'ready' : 'upcoming';
    return [{ id: task.id, startISO, finishISO, state, daysUntilStart: Math.round((Date.parse(startISO) - Date.parse(todayISO)) / DAY) }];
  }).sort((a, b) => a.startISO.localeCompare(b.startISO) || a.id.localeCompare(b.id));
}

export function taskDurationDays(t: Pick<Task, 'plannedStartISO' | 'plannedFinishISO'>): number {
  return Math.max(1, Math.round((Date.parse(t.plannedFinishISO) - Date.parse(t.plannedStartISO)) / DAY));
}

/* --- procurement: bid scoring + award ------------------------------------- */

export type ScoredQuote = { quote: Quote; score: number; priceScore: number; leadScore: number; warrantyScore: number; complianceScore: number; recommended: boolean };

/** Score quotes 0–100 (price 45%, lead 20%, warranty 15%, compliance 20%) and
 *  recommend the highest — a transparent award recommendation, not a black box. */
export function scoreQuotes(quotes: readonly Quote[]): ScoredQuote[] {
  if (quotes.length === 0) return [];
  const prices = quotes.map((q) => minor(q.price)), leads = quotes.map((q) => q.leadDays), warr = quotes.map((q) => q.warrantyMonths);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minL = Math.min(...leads), maxL = Math.max(...leads);
  const maxW = Math.max(...warr, 1);
  const norm = (v: number, lo: number, hi: number, invert = false) => hi === lo ? 100 : Math.round(((invert ? hi - v : v - lo) / (hi - lo)) * 100);
  const scored = quotes.map((q) => {
    const priceScore = norm(minor(q.price), minP, maxP, true);
    const leadScore = norm(q.leadDays, minL, maxL, true);
    const warrantyScore = Math.round((q.warrantyMonths / maxW) * 100);
    const complianceScore = q.compliancePct;
    const score = Math.round(0.45 * priceScore + 0.2 * leadScore + 0.15 * warrantyScore + 0.2 * complianceScore);
    return { quote: q, score, priceScore, leadScore, warrantyScore, complianceScore, recommended: false };
  });
  const best = Math.max(...scored.map((s) => s.score));
  for (const s of scored) if (s.score === best) { s.recommended = true; break; }
  return scored.sort((a, b) => b.score - a.score);
}

/** Would this request breach the remaining budget on its cost code? */
export function budgetException(req: Pick<PurchaseRequest, 'estimate' | 'costCode'>, codes: readonly CostCode[]): { exception: boolean; remainingMinor: number } {
  const cc = codes.find((c) => c.code === req.costCode);
  if (!cc) return { exception: false, remainingMinor: 0 };
  const remaining = minor(cc.budget) - minor(cc.committed);
  return { exception: minor(req.estimate) > remaining, remainingMinor: remaining };
}

/** Cash needed to clear open (issued/acknowledged/part-delivered) POs. */
export function cashRequirementMinor(pos: readonly PurchaseOrder[]): number {
  const OPEN: PurchaseOrder['status'][] = ['issued', 'acknowledged', 'part_delivered', 'approved'];
  return pos.filter((p) => OPEN.includes(p.status)).reduce((n, p) => n + Math.round(minor(p.value) * (1 - p.deliveredQty / Math.max(1, p.qty))), 0);
}

/* --- inventory: signals + leakage ----------------------------------------- */

export function stockPosition(item: Pick<StockItem, 'onHand' | 'reserved' | 'inTransit'>): { available: number } {
  return { available: item.onHand - item.reserved };
}

export function stockSignal(material: Pick<Material, 'reorderLevel'>, onHand: number, monthlyConsumption: number): { belowReorder: boolean; daysCover: number | null; band: Tone } {
  const perDay = monthlyConsumption / 30;
  const daysCover = perDay > 0 ? Math.round(onHand / perDay) : null;
  const belowReorder = onHand <= material.reorderLevel;
  const band: Tone = belowReorder || (daysCover !== null && daysCover <= 7) ? 'danger' : daysCover !== null && daysCover <= 21 ? 'warn' : 'success';
  return { belowReorder, daysCover, band };
}

/** Leakage = received − issued − on-hand (what can't be accounted for), and an
 *  anomaly flag when issues run well above the received baseline. */
export function materialLeakage(materialId: string, movements: readonly StockMovement[], onHand: number): { receivedQty: number; issuedQty: number; leakageQty: number; leakagePct: number; anomalous: boolean } {
  const ms = movements.filter((m) => m.materialId === materialId);
  const receivedQty = ms.filter((m) => m.kind === 'receipt').reduce((n, m) => n + m.qty, 0);
  const issuedQty = ms.filter((m) => m.kind === 'issue').reduce((n, m) => n + m.qty, 0);
  const returnedQty = ms.filter((m) => m.kind === 'return').reduce((n, m) => n + m.qty, 0);
  const leakageQty = Math.max(0, receivedQty + returnedQty - issuedQty - onHand);
  const leakagePct = receivedQty > 0 ? Math.round((leakageQty / receivedQty) * 100) : 0;
  return { receivedQty, issuedQty, leakageQty, leakagePct, anomalous: leakagePct >= 5 };
}

/* --- risk radar ----------------------------------------------------------- */

export type RiskKind = 'schedule_slip' | 'cost_overrun' | 'procurement_late' | 'low_stock' | 'missing_report' | 'overdue_rfi' | 'cert_expiry' | 'open_critical_issue' | 'material_leakage';
export type RiskSignal = { id: string; kind: RiskKind; projectId: string; projectName: string; severity: Tone; confidence: number; title: string; evidence: string; recommendation: string; nairaAtRiskMinor: number; href: string };

export const RISK_LABEL: Record<RiskKind, string> = {
  schedule_slip: 'Schedule slip', cost_overrun: 'Cost overrun', procurement_late: 'Late procurement',
  low_stock: 'Low stock', missing_report: 'Missing site report', overdue_rfi: 'Overdue RFI',
  cert_expiry: 'Certificate expiry', open_critical_issue: 'Critical issue open', material_leakage: 'Material leakage',
};

/** Rank a risk by how much it should worry you (severity weight × confidence). */
export function riskWeight(r: Pick<RiskSignal, 'severity' | 'confidence'>): number {
  const sev = r.severity === 'danger' ? 3 : r.severity === 'warn' ? 2 : 1;
  return sev * r.confidence;
}
export function rankRisks(risks: readonly RiskSignal[]): RiskSignal[] {
  return [...risks].sort((a, b) => riskWeight(b) - riskWeight(a));
}

/* --- aging helpers (RFIs, milestones, reports) ---------------------------- */

export function daysUntil(iso: string, nowMs: number): number { return Math.round((Date.parse(iso) - nowMs) / DAY); }
export function isOverdue(iso: string, nowMs: number): boolean { return Date.parse(iso) < nowMs; }

export function certBand(w: Pick<Worker, 'certExpiryISO'>, nowMs: number): { days: number | null; band: Tone } {
  if (!w.certExpiryISO) return { days: null, band: 'muted' };
  const days = daysUntil(w.certExpiryISO, nowMs);
  return { days, band: days < 0 ? 'danger' : days <= 30 ? 'warn' : 'success' };
}

export function rfiState(r: Pick<RFI, 'status' | 'dueISO'>, nowMs: number): { band: Tone; label: string } {
  if (r.status === 'closed') return { band: 'muted', label: 'Closed' };
  if (r.status === 'answered') return { band: 'success', label: 'Answered' };
  return isOverdue(r.dueISO, nowMs) ? { band: 'danger', label: 'Overdue' } : { band: 'progress', label: 'Open' };
}

export function vendorBand(v: Pick<Vendor, 'suspended' | 'onTimePct' | 'complianceExpiryISO'>, nowMs: number): Tone {
  if (v.suspended) return 'danger';
  if (v.complianceExpiryISO && isOverdue(v.complianceExpiryISO, nowMs)) return 'danger';
  return v.onTimePct >= 90 ? 'success' : v.onTimePct >= 75 ? 'warn' : 'danger';
}

/* --- misc helpers --------------------------------------------------------- */

function round2(n: number): number { return Math.round(n * 100) / 100; }

export function milestoneBand(m: Pick<Milestone, 'status' | 'dueISO'>, nowMs: number): Tone {
  if (m.status === 'accepted') return 'success';
  if (m.status === 'missed') return 'danger';
  return isOverdue(m.dueISO, nowMs) ? 'danger' : daysUntil(m.dueISO, nowMs) <= 14 ? 'warn' : 'info';
}

export function issueBand(i: Pick<Issue, 'severity' | 'status'>): Tone {
  if (i.status === 'resolved') return 'muted';
  return i.severity === 'critical' || i.severity === 'high' ? 'danger' : i.severity === 'medium' ? 'warn' : 'info';
}

export function reportBand(status: DailyReport['status']): Tone {
  return status === 'approved' ? 'success' : status === 'returned' ? 'danger' : status === 'submitted' || status === 'reviewed' ? 'progress' : 'muted';
}

/* --- the world (for cross-entity scans) ----------------------------------- */

export type ConWorld = {
  projects: readonly Project[]; phases: readonly Phase[]; tasks: readonly Task[]; costCodes: readonly CostCode[];
  pos: readonly PurchaseOrder[]; requests: readonly PurchaseRequest[]; reports: readonly DailyReport[];
  materials: readonly Material[]; warehouses: readonly Warehouse[]; stock: readonly StockItem[]; movements: readonly StockMovement[];
  docs: readonly ConstructionDoc[]; rfis: readonly RFI[]; workers: readonly Worker[]; issues: readonly Issue[];
  milestones: readonly Milestone[]; attendance: readonly Attendance[];
  zones: readonly Zone[]; subcontractors: readonly Subcontractor[]; timesheets: readonly Timesheet[]; transmittals: readonly Transmittal[];
  reasonCodes: readonly ReasonCode[]; reasonEvents: readonly ReasonEvent[];
  approvalRules: readonly ApprovalRule[]; approvals: readonly ApprovalRequest[]; audit: readonly AuditEntry[];
  safetyEvents: readonly SafetyEvent[]; safetyPermits: readonly SafetyPermit[]; toolboxTalks: readonly ToolboxTalk[];
  fxRates: readonly FxRateRow[];
};

/** Actual cost booked against a project (its cost codes' actuals). */
export function projectActualMinor(projectId: string, codes: readonly CostCode[]): number {
  return codes.filter((c) => c.projectId === projectId).reduce((n, c) => n + minor(c.actual), 0);
}
export function projectCommittedMinor(projectId: string, codes: readonly CostCode[]): number {
  return codes.filter((c) => c.projectId === projectId).reduce((n, c) => n + minor(c.committed), 0);
}
export function projectEVMOf(p: Project, codes: readonly CostCode[]): EVM {
  const base = projectEVM(p, projectActualMinor(p.id, codes));
  const eac = Math.max(base.eac, p.approvedChangeForecastMinor ?? 0, projectCommittedMinor(p.id, codes));
  return { ...base, eac, etc: Math.max(0, eac - base.ac), vac: base.bac - eac };
}

/* --- risk radar: five deterministic detectors scanning the world ---------- */

const ACTIVE: Project['status'][] = ['active', 'closing'];

export function scanRisks(w: ConWorld, nowMs: number): RiskSignal[] {
  const out: RiskSignal[] = [];
  const nameOf = (id: string) => w.projects.find((p) => p.id === id)?.name ?? id;
  const stockOf = (materialId: string) => w.stock.filter((s) => s.materialId === materialId).reduce((n, s) => n + s.onHand, 0);

  for (const p of w.projects) {
    const evm = projectEVMOf(p, w.costCodes);
    const dailyBurn = Math.round(evm.bac / Math.max(1, (Date.parse(p.plannedFinishISO) - Date.parse(p.startISO)) / DAY));
    // 1. schedule slip
    if (evm.spi < 0.92 && ACTIVE.includes(p.status)) {
      const ff = forecastFinishISO(p, evm.spi);
      out.push({ id: `rs-slip-${p.id}`, kind: 'schedule_slip', projectId: p.id, projectName: p.name, severity: evm.spi < 0.85 ? 'danger' : 'warn', confidence: clamp01(0.6 + (0.92 - evm.spi) * 2), title: `${p.name} is behind schedule (SPI ${evm.spi})`, evidence: `Earned ${p.percentComplete}% vs planned ${p.plannedPercent}% → forecast finish ${ff.iso} (${ff.slipDays > 0 ? '+' : ''}${ff.slipDays}d)`, recommendation: 'Review critical path; consider crashing the pour sequence.', nairaAtRiskMinor: Math.max(0, ff.slipDays) * Math.round(dailyBurn * 0.15), href: '/construction/schedule' });
    }
    // 2. cost overrun
    if (evm.vac < 0 && ACTIVE.includes(p.status)) {
      out.push({ id: `rs-cost-${p.id}`, kind: 'cost_overrun', projectId: p.id, projectName: p.name, severity: evm.cpi < 0.9 ? 'danger' : 'warn', confidence: clamp01(0.65 + (1 - evm.cpi)), title: `${p.name} forecast to overrun (CPI ${evm.cpi})`, evidence: `EAC ₦${fmtM(evm.eac)} vs budget ₦${fmtM(evm.bac)} → VAC −₦${fmtM(-evm.vac)}`, recommendation: 'QS to review committed costs; raise a budget variation if scope-driven.', nairaAtRiskMinor: -evm.vac, href: '/construction/evm' });
    }
    // 5. missing site report (active projects)
    if (ACTIVE.includes(p.status)) {
      const lastApproved = w.reports.filter((r) => r.projectId === p.id && r.status === 'approved').map((r) => Date.parse(r.dateISO)).sort((a, b) => b - a)[0];
      const startMs = Date.parse(p.startISO);
      const sourceMs = lastApproved ?? (Number.isFinite(startMs) ? startMs : nowMs);
      const daysSince = Math.max(0, Math.floor((nowMs - sourceMs) / DAY));
      if (daysSince >= 2) out.push({ id: `rs-report-${p.id}`, kind: 'missing_report', projectId: p.id, projectName: p.name, severity: daysSince >= 4 ? 'danger' : 'warn', confidence: 0.9, title: `${p.name} — no approved site report in ${daysSince} days`, evidence: lastApproved ? `Last approved daily report was ${daysSince} days ago.` : `No approved daily report since the project started ${daysSince} days ago.`, recommendation: 'Chase the site engineer to submit; review pending reports.', nairaAtRiskMinor: 0, href: '/construction/site' });
    }
  }
  // 3. late procurement (open POs past their promised date)
  const OPEN: PurchaseOrder['status'][] = ['issued', 'acknowledged', 'part_delivered', 'approved'];
  for (const po of w.pos) {
    if (OPEN.includes(po.status) && isOverdue(po.expectedISO, nowMs) && po.deliveredQty < po.qty) {
      const outstanding = Math.round(minor(po.value) * (1 - po.deliveredQty / Math.max(1, po.qty)));
      out.push({ id: `rs-po-${po.id}`, kind: 'procurement_late', projectId: po.projectId, projectName: nameOf(po.projectId), severity: 'danger', confidence: 0.95, title: `${po.ref} late — ${po.item}`, evidence: `Promised ${po.expectedISO}, ${po.deliveredQty}/${po.qty} ${po.unit} delivered (${daysUntil(po.expectedISO, nowMs) * -1}d overdue).`, recommendation: 'Expedite with vendor; source a backup supplier for the balance.', nairaAtRiskMinor: outstanding, href: '/construction/procurement' });
    }
  }
  // 4. low stock
  for (const m of w.materials) {
    const onHand = stockOf(m.id);
    if (onHand <= m.reorderLevel) {
      out.push({ id: `rs-stock-${m.id}`, kind: 'low_stock', projectId: w.stock.find((s) => s.materialId === m.id)?.warehouseId.includes('marina') ? 'cp-marina' : 'cp-cedar', projectName: m.name, severity: onHand <= m.reorderLevel * 0.5 ? 'danger' : 'warn', confidence: 0.85, title: `${m.name} below reorder (${onHand} ${m.unit})`, evidence: `On-hand ${onHand} ${m.unit} ≤ reorder level ${m.reorderLevel}.`, recommendation: 'Raise a purchase request now to avoid a stockout on the pour.', nairaAtRiskMinor: Math.max(0, m.reorderLevel - onHand) * minor(m.unitCost), href: '/construction/materials' });
    }
    // 9. material leakage
    const leak = materialLeakage(m.id, w.movements, stockOf(m.id));
    if (leak.anomalous) out.push({ id: `rs-leak-${m.id}`, kind: 'material_leakage', projectId: 'cp-marina', projectName: m.name, severity: leak.leakagePct >= 12 ? 'danger' : 'warn', confidence: clamp01(0.5 + leak.leakagePct / 40), title: `${m.name} — ${leak.leakagePct}% unaccounted`, evidence: `Received ${leak.receivedQty}, issued ${leak.issuedQty}, on-hand ${stockOf(m.id)} → ${leak.leakageQty} ${m.unit} unexplained.`, recommendation: 'Advisory only. Trigger a stock count and reconcile with reason codes.', nairaAtRiskMinor: leak.leakageQty * minor(m.unitCost), href: '/construction/materials' });
  }
  // 6. overdue RFIs
  for (const r of w.rfis) if (r.status === 'open' && isOverdue(r.dueISO, nowMs)) out.push({ id: `rs-rfi-${r.id}`, kind: 'overdue_rfi', projectId: r.projectId, projectName: nameOf(r.projectId), severity: 'warn', confidence: 0.8, title: `${r.ref} overdue — ${r.discipline}`, evidence: `"${r.question}" due ${r.dueISO} (${daysUntil(r.dueISO, nowMs) * -1}d overdue).`, recommendation: 'Chase the responsible discipline for a response.', nairaAtRiskMinor: 0, href: '/construction/schedule' });
  // 7. cert expiry
  for (const wk of w.workers) { const c = certBand(wk, nowMs); if (c.days !== null && c.days <= 14) out.push({ id: `rs-cert-${wk.id}`, kind: 'cert_expiry', projectId: wk.projectId ?? '', projectName: nameOf(wk.projectId ?? ''), severity: c.days < 0 ? 'danger' : 'warn', confidence: 0.9, title: `${wk.name}'s ${wk.certName} ${c.days < 0 ? 'expired' : 'expiring'}`, evidence: `${wk.certName} ${c.days < 0 ? `expired ${-c.days}d ago` : `expires in ${c.days}d`} (${wk.certExpiryISO}).`, recommendation: 'Renew before it blocks certified work on site.', nairaAtRiskMinor: 0, href: '/construction/workforce' }); }
  // 8. open critical issues
  for (const i of w.issues) if (i.status !== 'resolved' && (i.severity === 'critical' || i.severity === 'high')) out.push({ id: `rs-issue-${i.id}`, kind: 'open_critical_issue', projectId: i.projectId, projectName: nameOf(i.projectId), severity: i.severity === 'critical' ? 'danger' : 'warn', confidence: 0.75, title: `${i.title}`, evidence: `${i.severity} issue open since ${i.raisedISO}, due ${i.dueISO}.`, recommendation: i.correctiveAction ?? 'Assign an owner and corrective action.', nairaAtRiskMinor: 0, href: '/construction/schedule' });

  return rankRisks(out);
}

/* --- portfolio confidence ------------------------------------------------- */

export function portfolioConfidence(projects: readonly Project[], codes: readonly CostCode[], signals: readonly RiskSignal[]): { score: number; band: Tone; label: string; nairaAtRiskMinor: number } {
  const active = projects.filter((p) => ACTIVE.includes(p.status));
  const list = active.length ? active : projects;
  const avg = (f: (e: EVM) => number) => list.length ? list.reduce((n, p) => n + f(projectEVMOf(p, codes)), 0) / list.length : 1;
  const spi = avg((e) => e.spi), cpi = avg((e) => e.cpi);
  const danger = signals.filter((s) => s.severity === 'danger').length;
  const score = Math.max(0, Math.min(100, Math.round(0.4 * Math.min(1, spi) * 100 + 0.4 * Math.min(1, cpi) * 100 - danger * 5)));
  const band: Tone = score >= 85 ? 'success' : score >= 70 ? 'warn' : 'danger';
  return { score, band, label: score >= 85 ? 'Healthy' : score >= 70 ? 'Watch' : 'At risk', nairaAtRiskMinor: signals.reduce((n, s) => n + s.nairaAtRiskMinor, 0) };
}

/* --- money S-curve (planned/earned/actual/forecast, minor units) ---------- */

export type MoneyCurvePoint = { label: string; pv: number; ev: number; ac: number; forecast: number };
export function moneySCurve(evm: EVM, nowFrac: number, points = 12): MoneyCurvePoint[] {
  const logistic = (t: number) => 1 / (1 + Math.exp(-8 * (t - 0.5)));
  const base = logistic(1) - logistic(0);
  const s = (t: number) => (logistic(t) - logistic(0)) / base;
  const nf = Math.max(0.05, Math.min(0.99, nowFrac));
  const evAtNow = evm.ev, acAtNow = evm.ac;
  const out: MoneyCurvePoint[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const pv = Math.round(s(t) * evm.bac);
    const ev = t <= nf ? Math.round((s(t) / s(nf)) * evAtNow) : evAtNow;
    const ac = t <= nf ? Math.round((s(t) / s(nf)) * acAtNow) : 0;
    const forecast = t >= nf ? Math.round(acAtNow + ((t - nf) / (1 - nf)) * (evm.eac - acAtNow)) : 0;
    out.push({ label: `M${i}`, pv, ev, ac, forecast });
  }
  return out;
}

/* --- schedule: slip propagation ------------------------------------------- */

/** If `taskId` slips `days`, which downstream tasks and milestones move? */
export function slipPropagation(tasks: readonly Task[], taskId: string, days: number): { taskIds: string[]; latestFinishISO: string } {
  const affected = new Set<string>();
  const walk = (id: string) => { for (const t of tasks) if (t.dependsOn.includes(id) && !affected.has(t.id)) { affected.add(t.id); walk(t.id); } };
  walk(taskId);
  const base = tasks.find((t) => t.id === taskId);
  const latest = base ? new Date(Date.parse(base.plannedFinishISO) + days * DAY).toISOString().slice(0, 10) : '';
  return { taskIds: [...affected], latestFinishISO: latest };
}

/* --- delivery radar + workforce ------------------------------------------- */

export function deliveryRadar(pos: readonly PurchaseOrder[], nowMs: number): { today: PurchaseOrder[]; late: PurchaseOrder[]; upcoming: PurchaseOrder[] } {
  const OPEN: PurchaseOrder['status'][] = ['issued', 'acknowledged', 'part_delivered', 'approved'];
  const open = pos.filter((p) => OPEN.includes(p.status) && p.deliveredQty < p.qty);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return {
    today: open.filter((p) => p.expectedISO === today),
    late: open.filter((p) => isOverdue(p.expectedISO, nowMs)),
    upcoming: open.filter((p) => !isOverdue(p.expectedISO, nowMs) && p.expectedISO !== today).sort((a, b) => Date.parse(a.expectedISO) - Date.parse(b.expectedISO)),
  };
}

export function attendanceSummary(attendance: readonly Attendance[], workers: readonly Worker[], projectId: string, dateISO: string): { present: number; absent: number; planned: number; shortfall: number; byTrade: { trade: string; present: number }[] } {
  const today = attendance.filter((a) => a.projectId === projectId && a.dateISO === dateISO);
  const present = today.filter((a) => a.status === 'present').length;
  const absent = today.filter((a) => a.status === 'absent').length;
  const planned = workers.filter((w) => w.projectId === projectId).length;
  const map = new Map<string, number>();
  for (const a of today.filter((x) => x.status === 'present')) { const w = workers.find((x) => x.id === a.workerId); if (w) map.set(w.trade, (map.get(w.trade) ?? 0) + 1); }
  return { present, absent, planned, shortfall: Math.max(0, planned - present), byTrade: [...map.entries()].map(([trade, p]) => ({ trade, present: p })).sort((a, b) => b.present - a.present) };
}

export function labourCostMinor(attendance: readonly Attendance[], workers: readonly Worker[], projectId: string, dateISO: string): number {
  return attendance.filter((a) => a.projectId === projectId && a.dateISO === dateISO && a.status === 'present')
    .reduce((n, a) => n + (minor(workers.find((w) => w.id === a.workerId)?.dayRate ?? { minor: 0 })), 0);
}

/* --- material money-trail (kobo-weighted flow) ---------------------------- */

export type TrailNode = { id: string; label: string; minor: number; tone: Tone };
export function moneyTrail(projectId: string, codes: readonly CostCode[], pos: readonly PurchaseOrder[]): TrailNode[] {
  const cc = codes.filter((c) => c.projectId === projectId);
  const budget = cc.reduce((n, c) => n + minor(c.budget), 0);
  const committed = cc.reduce((n, c) => n + minor(c.committed), 0);
  const ordered = pos.filter((p) => p.projectId === projectId).reduce((n, p) => n + minor(p.value), 0);
  const received = pos.filter((p) => p.projectId === projectId).reduce((n, p) => n + Math.round(minor(p.value) * (p.deliveredQty / Math.max(1, p.qty))), 0);
  const actual = cc.reduce((n, c) => n + minor(c.actual), 0);
  return [
    { id: 'budget', label: 'Approved budget', minor: budget, tone: 'info' },
    { id: 'committed', label: 'Committed', minor: committed, tone: 'progress' },
    { id: 'ordered', label: 'On order (PO)', minor: ordered, tone: 'progress' },
    { id: 'received', label: 'Goods received', minor: received, tone: 'warn' },
    { id: 'actual', label: 'Actual cost', minor: actual, tone: 'danger' },
  ];
}

/* --- weekly digest (source-linked, approved records only) ----------------- */

export type DigestSection = { title: string; text: string; confidence: number; sources: { label: string; href: string }[] };
export function weeklyDigest(p: Project, w: ConWorld, nowMs: number): { sections: DigestSection[]; coverageGaps: string[] } {
  const evm = projectEVMOf(p, w.costCodes);
  const approved = w.reports.filter((r) => r.projectId === p.id && r.status === 'approved').sort((a, b) => Date.parse(b.dateISO) - Date.parse(a.dateISO));
  const openPos = w.pos.filter((po) => po.projectId === p.id && po.status !== 'delivered' && po.status !== 'closed');
  const risks = scanRisks({ ...w, projects: [p] }, nowMs);
  const sections: DigestSection[] = [
    { title: 'Progress', text: approved.length ? `${p.name} is ${p.percentComplete}% complete against a ${p.plannedPercent}% plan (${scheduleVariancePct(p) >= 0 ? 'ahead' : `${-scheduleVariancePct(p)}pt behind`}). ${approved[0]?.completed.slice(0, 2).join('; ') || 'Work ongoing'}.` : 'No approved site reports this week — progress unverified.', confidence: approved.length ? 0.9 : 0.4, sources: approved.slice(0, 2).map((r) => ({ label: `Report ${r.dateISO}`, href: '/construction/site' })) },
    { title: 'Cost & earned value', text: `CPI ${evm.cpi} · SPI ${evm.spi}. Forecast out-turn ₦${fmtM(evm.eac)} vs budget ₦${fmtM(evm.bac)} (${evm.vac >= 0 ? 'under' : 'over'} by ₦${fmtM(Math.abs(evm.vac))}).`, confidence: 0.95, sources: [{ label: 'Earned Value Cockpit', href: '/construction/evm' }] },
    { title: 'Procurement', text: openPos.length ? `${openPos.length} open PO(s); ${w.pos.filter((po) => po.projectId === p.id && isOverdue(po.expectedISO, nowMs) && po.deliveredQty < po.qty).length} past their promised date.` : 'No open purchase orders.', confidence: 0.9, sources: openPos.slice(0, 2).map((po) => ({ label: po.ref, href: '/construction/procurement' })) },
    { title: 'Risks flagged', text: risks.length ? risks.slice(0, 3).map((r) => `${RISK_LABEL[r.kind]}: ${r.title}`).join(' · ') : 'No advisory risk signals this week.', confidence: 0.8, sources: [{ label: 'Risk Radar', href: '/construction/risk' }] },
  ];
  return { sections, coverageGaps: coverageGaps(w.reports, p.id, nowMs, 7, p.startISO) };
}

/** Dates in the last `days` with no approved report for a project. */
export function coverageGaps(reports: readonly DailyReport[], projectId: string, nowMs: number, days: number, startISO?: string): string[] {
  const have = new Set(reports.filter((r) => r.projectId === projectId && r.status === 'approved').map((r) => r.dateISO));
  const gaps: string[] = [];
  for (let i = 1; i <= days; i++) { const d = new Date(nowMs - i * DAY).toISOString().slice(0, 10); if ((!startISO || d >= startISO) && !have.has(d)) gaps.push(d); }
  return gaps;
}

/* --- report completeness / quality ---------------------------------------- */

export function reportCompleteness(r: Pick<DailyReport, 'completed' | 'ongoing' | 'plannedNext' | 'workforceCount' | 'weather'>): { pct: number; missing: string[] } {
  const checks: [boolean, string][] = [
    [r.completed.length > 0, 'Completed activities'], [r.ongoing.length > 0, 'Ongoing activities'],
    [r.plannedNext.length > 0, 'Planned next'], [r.workforceCount > 0, 'Workforce count'], [!!r.weather, 'Weather'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, l]) => l) };
}

/* --- structured reason codes ---------------------------------------------- */

export const REASON_DOMAIN_LABEL: Record<ReasonDomain, string> = {
  rejection: 'Rejections', delay: 'Delays', variance: 'Cost variance',
  stock_adjust: 'Stock adjustments', stock_return: 'Stock returns',
};

export function reasonsFor(codes: readonly ReasonCode[], domain: ReasonDomain): ReasonCode[] {
  return codes.filter((c) => c.domain === domain && c.active).sort((a, b) => a.label.localeCompare(b.label));
}

export type ReasonStat = { code: ReasonCode; count: number; sharePct: number; cumulativePct: number; impactMinor: number; impactDays: number; vital: boolean };

/**
 * A Pareto over reason codes: which few causes account for most of the pain.
 * `vital` marks the codes inside the first 80% of occurrences — the ones worth
 * fixing. This is the whole point of coding reasons rather than typing prose.
 */
export function reasonPareto(events: readonly ReasonEvent[], codes: readonly ReasonCode[], domain?: ReasonDomain): ReasonStat[] {
  const scoped = domain ? events.filter((e) => e.domain === domain) : events;
  const total = scoped.length;
  if (total === 0) return [];
  const byCode = new Map<string, ReasonEvent[]>();
  for (const e of scoped) byCode.set(e.codeId, [...(byCode.get(e.codeId) ?? []), e]);

  let running = 0;
  return [...byCode.entries()]
    .map(([codeId, evs]) => ({ codeId, evs }))
    .sort((a, b) => b.evs.length - a.evs.length)
    .map(({ codeId, evs }) => {
      const code = codes.find((c) => c.id === codeId);
      const sharePct = Math.round((evs.length / total) * 1000) / 10;
      running += sharePct;
      return {
        code: code ?? ({ id: codeId, code: codeId, label: codeId, category: '—', domain: 'rejection', requiresNote: false, active: false } as ReasonCode),
        count: evs.length, sharePct,
        cumulativePct: Math.round(running * 10) / 10,
        impactMinor: evs.reduce((n, e) => n + (e.impactMinor ?? 0), 0),
        impactDays: evs.reduce((n, e) => n + (e.impactDays ?? 0), 0),
        vital: false,
      };
    })
    .map((r, i, all) => ({ ...r, vital: i === 0 || (all[i - 1]?.cumulativePct ?? 0) < 80 }));
}

/* --- stock movements & physical count -------------------------------------- */

export const STOCK_KIND_LABEL: Record<StockKind, string> = {
  receipt: 'Receipt', issue: 'Issue', transfer: 'Transfer', return: 'Return', adjust: 'Adjustment',
};

/** System-vs-counted variance for one stock line. A shortfall is the number that
 *  needs a reason before anyone touches the books. */
export function countVariance(systemQty: number, countedQty: number): { deltaQty: number; pct: number; band: Tone; direction: 'short' | 'over' | 'exact' } {
  const deltaQty = countedQty - systemQty;
  const pct = systemQty > 0 ? Math.round(Math.abs(deltaQty / systemQty) * 1000) / 10 : deltaQty === 0 ? 0 : 100;
  const band: Tone = deltaQty === 0 ? 'success' : pct >= 10 ? 'danger' : pct >= 3 ? 'warn' : 'info';
  return { deltaQty, pct, band, direction: deltaQty < 0 ? 'short' : deltaQty > 0 ? 'over' : 'exact' };
}

/** Would this movement drive stock negative? Blocking that is the single most
 *  important inventory invariant — a negative bin means the records are fiction. */
export function movementAllowed(kind: StockKind, onHand: number, qty: number): { allowed: boolean; reason?: string } {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(onHand)) return { allowed: false, reason: 'Quantity and stock must be finite; quantity must be greater than zero.' };
  const reduces = kind === 'issue' || kind === 'transfer';
  if (reduces && qty > onHand) return { allowed: false, reason: `Only ${onHand} on hand — stock can never go negative.` };
  return { allowed: true };
}

export type StockLedgerRow = { movement: StockMovement; runningQty: number };
/** Transfers move quantity between stores; adjustments carry a signed variance. */
export function stockMovementQuantity(kind: StockKind, qty: number): string {
  if (kind === 'transfer') return String(Math.abs(qty));
  const delta = kind === 'issue' ? -qty : qty;
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta)}`;
}
/** Replay movements oldest-first into a running balance — the perpetual ledger
 *  that must reconcile to the counted figure. */
export function stockLedger(movements: readonly StockMovement[], materialId: string): StockLedgerRow[] {
  // This ledger aggregates a material across all authorised stores. Transfers
  // conserve that total; adjustment quantities retain their signed variance.
  const sign = (k: StockKind) => (k === 'transfer' ? 0 : k === 'receipt' || k === 'return' || k === 'adjust' ? 1 : -1);
  let running = 0;
  return movements
    .filter((m) => m.materialId === materialId)
    .sort((a, b) => Date.parse(a.atISO) - Date.parse(b.atISO))
    .map((movement) => { running += sign(movement.kind) * movement.qty; return { movement, runningQty: running }; });
}

/* --- approval workflow engine ---------------------------------------------- */

/** Pick the route: the highest-threshold active rule the amount clears, matching
 *  the category when the rule names one. Most-specific-first. */
export function routeFor(rules: readonly ApprovalRule[], subject: ApprovalSubject, amountMinor: number, category?: string): ApprovalRule | null {
  return rules
    .filter((r) => r.active && r.subject === subject && amountMinor >= r.thresholdMinor)
    .filter((r) => !r.category || r.category === category)
    .sort((a, b) => b.thresholdMinor - a.thresholdMinor || (b.category ? 1 : 0) - (a.category ? 1 : 0))[0] ?? null;
}

export function stepsFromRule(rule: ApprovalRule): ApprovalStepState[] {
  return [...rule.steps]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ order: s.order, role: s.role, label: s.label, slaHours: s.slaHours, status: 'pending' as StepStatus }));
}

/** The order currently in play: the lowest order with anything still pending.
 *  Steps sharing an order are parallel and must ALL approve to advance. */
export function currentStepOrder(req: Pick<ApprovalRequest, 'steps'>): number | null {
  const pending = req.steps.filter((s) => s.status === 'pending').map((s) => s.order);
  return pending.length ? Math.min(...pending) : null;
}

export function pendingSteps(req: Pick<ApprovalRequest, 'steps'>): ApprovalStepState[] {
  const order = currentStepOrder(req);
  return order === null ? [] : req.steps.filter((s) => s.order === order && s.status === 'pending');
}

/**
 * May this actor act on this request now? Enforces the live step, the role, any
 * delegation, and segregation of duties — the requester can never be the
 * approver of their own transaction (PRD §15.2).
 */
export function canApprove(req: Pick<ApprovalRequest, 'steps' | 'raisedBy' | 'status'>, actorRoles: readonly string[], actorName: string): { allowed: boolean; step?: ApprovalStepState; reason?: string } {
  if (req.status !== 'in_flight') return { allowed: false, reason: 'This request is already resolved.' };
  if (req.raisedBy.toLowerCase() === actorName.toLowerCase()) return { allowed: false, reason: 'You raised this — segregation of duties requires a different approver.' };
  const live = pendingSteps(req);
  const step = live.find((s) => (s.delegatedTo ? s.delegatedTo.toLowerCase() === actorName.toLowerCase() : actorRoles.includes(s.role)));
  if (!step) return { allowed: false, reason: live.length ? `Waiting on ${live.map((s) => s.label).join(' and ')}.` : 'Nothing pending.' };
  return { allowed: true, step };
}

/** Fold an approval/rejection in. A rejection stops the whole request; an
 *  approval only advances once every parallel step at that order is in. */
export function applyDecision(req: ApprovalRequest, order: number, role: string, decision: 'approved' | 'rejected', by: string, atISO: string, comment?: string): ApprovalRequest {
  const steps = req.steps.map((s) =>
    s.order === order && s.role === role && s.status === 'pending'
      ? { ...s, status: decision, actedBy: by, actedISO: atISO, comment }
      : s);
  if (decision === 'rejected') {
    return { ...req, steps: steps.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' as StepStatus } : s)), status: 'rejected' };
  }
  const done = steps.every((s) => s.status !== 'pending');
  return { ...req, steps, status: done ? 'approved' : 'in_flight' };
}

/** Steps past their SLA — what an escalation would act on. */
export function overdueSteps(req: Pick<ApprovalRequest, 'steps' | 'raisedISO' | 'status'>, nowMs: number): ApprovalStepState[] {
  if (req.status !== 'in_flight') return [];
  const elapsedH = (nowMs - Date.parse(req.raisedISO)) / 3_600_000;
  return pendingSteps(req).filter((s) => elapsedH > s.slaHours);
}

export function approvalProgress(req: Pick<ApprovalRequest, 'steps'>): { done: number; total: number; pct: number } {
  const total = req.steps.length;
  const done = req.steps.filter((s) => s.status === 'approved').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export const APPROVAL_SUBJECT_LABEL: Record<ApprovalSubject, string> = {
  purchase_request: 'Purchase request', variation: 'Variation', timesheet: 'Timesheet',
  stock_adjust: 'Stock adjustment', budget_override: 'Budget override',
};
export const APPROVAL_TONE: Record<ApprovalStatus, Tone> = {
  in_flight: 'progress', approved: 'success', rejected: 'danger', cancelled: 'muted',
};

/* --- audit trail ----------------------------------------------------------- */

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  approve: 'Approved', reject: 'Rejected', issue: 'Issued', supersede: 'Superseded',
  post_cost: 'Posted cost', import: 'Imported', stock_move: 'Stock movement',
  stock_count: 'Stock count', override: 'Override', delegate: 'Delegated', cancel: 'Cancelled',
  fx_revalue: 'FX revalue', record: 'Recorded', resolve: 'Resolved',
};
export const AUDIT_TONE: Record<AuditAction, Tone> = {
  approve: 'success', reject: 'danger', issue: 'info', supersede: 'warn',
  post_cost: 'progress', import: 'info', stock_move: 'progress',
  stock_count: 'warn', override: 'danger', delegate: 'info', cancel: 'muted',
  fx_revalue: 'warn', record: 'info', resolve: 'success',
};

/** Money-moving actions an auditor looks at first. */
export function sensitiveEntries(entries: readonly AuditEntry[]): AuditEntry[] {
  return entries.filter((e) => e.action === 'override' || e.action === 'post_cost' || (e.amountMinor ?? 0) > 0);
}

export type AuditSummary = { total: number; sensitive: number; overrides: number; valueMovedMinor: number; actors: number };
export function auditSummary(entries: readonly AuditEntry[]): AuditSummary {
  return {
    total: entries.length,
    sensitive: sensitiveEntries(entries).length,
    overrides: entries.filter((e) => e.action === 'override').length,
    valueMovedMinor: entries.reduce((n, e) => n + (e.amountMinor ?? 0), 0),
    actors: new Set(entries.map((e) => e.actorId)).size,
  };
}

/* --- foreign-exchange exposure -------------------------------------------- */

/**
 * A foreign-denominated commitment carries FX exposure: the NGN cost was fixed
 * at the booking rate, but the UNDELIVERED portion still floats with the spot
 * rate until it is received and paid. Delivered work is treated as settled, so
 * only the outstanding fraction is revalued — the same fraction the open-PO
 * commitment figure already uses.
 */
export type FxExposureRow = {
  id: string; ref: string; vendorName: string; item: string; projectId: string;
  currency: CurrencyCode; foreignMinor: number; bookedRate: number; spotRate: number;
  /** fraction not yet delivered (1 = nothing received). */
  outstandingFraction: number;
  outstandingForeignMinor: number;
  /** NGN locked at award on the outstanding portion. */
  bookedMinor: number;
  /** NGN it would cost to settle the outstanding portion at today's rate. */
  spotMinor: number;
  /** spot − booked on the outstanding portion. Positive = extra NGN cost = loss. */
  unrealizedMinor: number;
  tone: Tone;
};

/** Per-PO FX exposure on foreign-denominated, not-yet-settled commitments. */
export function fxExposure(pos: readonly PurchaseOrder[], table: FxTable): FxExposureRow[] {
  const SETTLED: PurchaseOrder['status'][] = ['delivered', 'closed', 'cancelled'];
  return pos
    .filter((p): p is PurchaseOrder & { fx: NonNullable<PurchaseOrder['fx']> } => !!p.fx)
    .map((p) => {
      const spotRate = rateOf(p.fx.currency, table);
      const delivered = SETTLED.includes(p.status) ? 1 : Math.min(1, p.deliveredQty / Math.max(1, p.qty));
      const outstandingFraction = Math.max(0, 1 - delivered);
      const outstandingForeignMinor = Math.round(p.fx.foreignMinor * outstandingFraction);
      const bookedMinor = Math.round(outstandingForeignMinor * p.fx.bookedRate);
      const spotMinor = Math.round(outstandingForeignMinor * spotRate);
      const unrealizedMinor = spotMinor - bookedMinor;
      const swingPct = bookedMinor > 0 ? Math.abs(unrealizedMinor / bookedMinor) : 0;
      const tone: Tone = unrealizedMinor <= 0 ? 'success' : swingPct >= 0.05 ? 'danger' : 'warn';
      return {
        id: p.id, ref: p.ref, vendorName: p.vendorName, item: p.item, projectId: p.projectId,
        currency: p.fx.currency, foreignMinor: p.fx.foreignMinor, bookedRate: p.fx.bookedRate, spotRate,
        outstandingFraction, outstandingForeignMinor, bookedMinor, spotMinor, unrealizedMinor, tone,
      };
    });
}

export type FxPosition = {
  currency: CurrencyCode; count: number;
  outstandingForeignMinor: number; bookedMinor: number; spotMinor: number; unrealizedMinor: number;
};

/** Exposure aggregated by currency — the net position a treasurer would hedge. */
export function fxPositions(rows: readonly FxExposureRow[]): FxPosition[] {
  const by = new Map<CurrencyCode, FxPosition>();
  for (const r of rows) {
    const p = by.get(r.currency) ?? { currency: r.currency, count: 0, outstandingForeignMinor: 0, bookedMinor: 0, spotMinor: 0, unrealizedMinor: 0 };
    p.count += 1;
    p.outstandingForeignMinor += r.outstandingForeignMinor;
    p.bookedMinor += r.bookedMinor;
    p.spotMinor += r.spotMinor;
    p.unrealizedMinor += r.unrealizedMinor;
    by.set(r.currency, p);
  }
  return [...by.values()].sort((a, b) => Math.abs(b.unrealizedMinor) - Math.abs(a.unrealizedMinor));
}

/** Net unrealized FX gain/loss across all exposure, in NGN minor units. */
export function fxUnrealizedMinor(rows: readonly FxExposureRow[]): number {
  return rows.reduce((n, r) => n + r.unrealizedMinor, 0);
}

/**
 * What a further move in the naira does to the NGN cost of the OUTSTANDING
 * foreign book. `shockPct` of +10 means the naira weakens another 10% (every
 * spot rate ×1.1); the delta is the extra NGN required to settle. Linear in the
 * shock because the outstanding foreign amount is fixed.
 */
export function fxSensitivity(rows: readonly FxExposureRow[], shockPct: number): number {
  return Math.round(rows.reduce((n, r) => n + r.spotMinor, 0) * (shockPct / 100));
}

/* --- document revision control -------------------------------------------- */

/** Every revision of one document number, newest issue first. */
export function revisionChain(docs: readonly ConstructionDoc[], number: string): ConstructionDoc[] {
  return docs.filter((d) => d.number === number).sort((a, b) => b.revision.localeCompare(a.revision));
}

/** The revision people must actually build from. Only an `approved` row counts —
 *  a drawing in review is explicitly NOT the current issue. */
export function currentRevision(docs: readonly ConstructionDoc[], number: string): ConstructionDoc | null {
  return docs.find((d) => d.number === number && d.status === 'approved') ?? null;
}

/** Next letter in the revision sequence (C → D). Wraps past Z to AA. */
export function nextRevision(current: string): string {
  const up = current.toUpperCase();
  if (up.length === 1 && up < 'Z') return String.fromCharCode(up.charCodeAt(0) + 1);
  if (up === 'Z') return 'AA';
  return up + 'A';
}

/** Can this revision be superseded, and does doing so need a change note? */
export function canSupersede(doc: Pick<ConstructionDoc, 'status'>): { allowed: boolean; requiresNote: boolean; reason?: string } {
  if (doc.status === 'superseded') return { allowed: false, requiresNote: false, reason: 'This revision is already superseded.' };
  if (doc.status === 'approved') return { allowed: true, requiresNote: true };
  return { allowed: true, requiresNote: false };
}

export const DOC_STATUS_TONE: Record<DocStatus, Tone> = {
  draft: 'muted', review: 'warn', approved: 'success', superseded: 'neutral', rejected: 'danger',
};

/** Documents grouped by number, with the current issue and how deep the chain is. */
export type DocRegisterRow = { number: string; title: string; discipline: string; folder: string; current: ConstructionDoc | null; revisions: ConstructionDoc[]; inReview: number };
export function docRegister(docs: readonly ConstructionDoc[]): DocRegisterRow[] {
  const numbers = [...new Set(docs.map((d) => d.number))];
  return numbers.map((number) => {
    const revisions = revisionChain(docs, number);
    const head = revisions[0];
    return {
      number, title: head?.title ?? number, discipline: head?.discipline ?? '', folder: head?.folder ?? '',
      current: currentRevision(docs, number), revisions,
      inReview: revisions.filter((r) => r.status === 'review' || r.status === 'draft').length,
    };
  }).sort((a, b) => a.number.localeCompare(b.number));
}

/** RFI ageing — an unanswered RFI past its due date is blocking someone. */
export function rfiAgeing(r: Pick<RFI, 'status' | 'dueISO' | 'raisedISO'>, nowMs: number): { daysOpen: number; overdueDays: number; band: Tone } {
  const daysOpen = Math.max(0, Math.round((nowMs - Date.parse(r.raisedISO)) / DAY));
  const awaitingResponse = r.status === 'open' || r.status === 'submitted';
  const overdueDays = awaitingResponse ? Math.max(0, Math.round((nowMs - Date.parse(r.dueISO)) / DAY)) : 0;
  const band: Tone = overdueDays > 7 ? 'danger' : overdueDays > 0 ? 'warn' : awaitingResponse ? 'progress' : 'success';
  return { daysOpen, overdueDays, band };
}

/* --- BOQ import ----------------------------------------------------------- */

export type BoqRow = { code: string; name: string; category: string; budgetMinor: number; line: number };
export type BoqIssue = { line: number; message: string; severity: 'error' | 'warning' };
export type BoqParse = { rows: BoqRow[]; issues: BoqIssue[]; totalMinor: number };

/**
 * Parse a pasted BOQ (tab- or comma-separated: code, name, category, amount).
 * Validation is the point — a silently-mangled import corrupts every cost report
 * downstream, so bad lines are REPORTED and excluded, never guessed at.
 */
export function parseBoq(text: string, existingCodes: readonly string[] = []): BoqParse {
  const rows: BoqRow[] = [];
  const issues: BoqIssue[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  lines.forEach((raw, i) => {
    const line = i + 1;
    // Skip an obvious header row.
    if (i === 0 && /^(code|item)\b/i.test(raw)) return;
    // Delimiter is per-line: a tab-separated paste must NOT also split on the
    // commas inside "120,000,000", or the amount silently becomes 120.
    const cells = (raw.includes('\t')
      ? raw.split('\t')
      : raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    ).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 4) { issues.push({ line, message: `Expected 4 columns (code, name, category, amount) — found ${cells.length}.`, severity: 'error' }); return; }
    const [code, name, category, amountRaw] = cells;
    if (!code) { issues.push({ line, message: 'Missing cost code.', severity: 'error' }); return; }
    if (!name) { issues.push({ line, message: `“${code}” has no description.`, severity: 'error' }); return; }
    // Money: strip ₦ and thousands separators, reject anything left over.
    const cleaned = amountRaw.replace(/[₦\s,]/g, '');
    const amount = Number(cleaned);
    if (!cleaned || Number.isNaN(amount)) { issues.push({ line, message: `“${amountRaw}” is not a number.`, severity: 'error' }); return; }
    if (amount < 0) { issues.push({ line, message: `“${code}” has a negative amount.`, severity: 'error' }); return; }
    if (seen.has(code)) { issues.push({ line, message: `Duplicate cost code “${code}” in this paste — the later line was dropped.`, severity: 'error' }); return; }
    if (existingCodes.includes(code)) issues.push({ line, message: `“${code}” already exists on this project — importing will UPDATE its budget.`, severity: 'warning' });
    if (amount === 0) issues.push({ line, message: `“${code}” has a zero budget.`, severity: 'warning' });
    seen.add(code);
    rows.push({ code, name, category: category || 'Uncategorised', budgetMinor: Math.round(amount * 100), line });
  });

  return { rows, issues, totalMinor: rows.reduce((n, r) => n + r.budgetMinor, 0) };
}

/** Does the parsed BOQ reconcile with the approved budget? */
export function boqReconciliation(totalMinor: number, approvedBudgetMinor: number): { deltaMinor: number; pct: number; band: Tone; label: string } {
  const deltaMinor = totalMinor - approvedBudgetMinor;
  const pct = approvedBudgetMinor > 0 ? Math.round((deltaMinor / approvedBudgetMinor) * 1000) / 10 : 0;
  const band: Tone = Math.abs(pct) <= 0.5 ? 'success' : Math.abs(pct) <= 5 ? 'warn' : 'danger';
  return { deltaMinor, pct, band, label: deltaMinor === 0 ? 'Reconciles exactly' : deltaMinor > 0 ? 'Over the approved budget' : 'Under the approved budget' };
}

/* --- timesheets → labour cost → earned value ------------------------------ */

/** Hours are costed off the worker's day rate (8-hour day), overtime at 1.5×.
 *  This is the number that gets posted to a cost code's actual on approval. */
export const OVERTIME_MULTIPLIER = 1.5;
export const HOURS_PER_DAY = 8;

export function timesheetCostMinor(ts: Pick<Timesheet, 'normalHours' | 'overtimeHours'>, dayRateMinor: number): number {
  const hourly = dayRateMinor / HOURS_PER_DAY;
  return Math.round(ts.normalHours * hourly + ts.overtimeHours * hourly * OVERTIME_MULTIPLIER);
}

export type TimesheetView = { ts: Timesheet; costMinor: number; hours: number; band: Tone };

export function costTimesheets(sheets: readonly Timesheet[], workers: readonly Worker[]): TimesheetView[] {
  return sheets.map((ts) => {
    const w = workers.find((x) => x.id === ts.workerId);
    const costMinor = timesheetCostMinor(ts, w ? minor(w.dayRate) : 0);
    const band: Tone = ts.status === 'approved' ? 'success' : ts.status === 'submitted' ? 'warn' : ts.status === 'rejected' ? 'danger' : 'muted';
    return { ts, costMinor, hours: ts.normalHours + ts.overtimeHours, band };
  });
}

/** Labour already posted into actuals, and what is still awaiting approval —
 *  the second number is cost the EVM does NOT yet see. */
export function labourPosture(views: readonly TimesheetView[]): { postedMinor: number; pendingMinor: number; pendingSheets: number; overtimeHours: number } {
  const posted = views.filter((v) => v.ts.status === 'approved');
  const pending = views.filter((v) => v.ts.status === 'submitted' || v.ts.status === 'draft');
  return {
    postedMinor: posted.reduce((n, v) => n + v.costMinor, 0),
    pendingMinor: pending.reduce((n, v) => n + v.costMinor, 0),
    pendingSheets: pending.length,
    overtimeHours: views.reduce((n, v) => n + v.ts.overtimeHours, 0),
  };
}

/** Labour cost grouped by cost code — how the payroll lands on the budget. */
export function labourByCostCode(views: readonly TimesheetView[]): { code: string; postedMinor: number; pendingMinor: number; hours: number }[] {
  const map = new Map<string, { code: string; postedMinor: number; pendingMinor: number; hours: number }>();
  for (const v of views) {
    const row = map.get(v.ts.costCode) ?? { code: v.ts.costCode, postedMinor: 0, pendingMinor: 0, hours: 0 };
    if (v.ts.status === 'approved') row.postedMinor += v.costMinor;
    else if (v.ts.status !== 'rejected') row.pendingMinor += v.costMinor;
    row.hours += v.hours;
    map.set(v.ts.costCode, row);
  }
  return [...map.values()].sort((a, b) => b.postedMinor + b.pendingMinor - (a.postedMinor + a.pendingMinor));
}

/* --- what-if simulator: recovery / crash optimizer ------------------------ */

export type CrashCandidate = { taskId: string; name: string; days: number; costPerDayMinor: number; totalMinor: number };
export type RecoveryPlan = { crashes: CrashCandidate[]; daysRecovered: number; extraCostMinor: number; costPerDayMinor: number; shortfallDays: number };

/** Buy back `targetDays` for the least money: only CRITICAL tasks shorten the
 *  project, so we crash those cheapest-first. Deterministic and explainable —
 *  a greedy pass over cost-per-day, which is optimal for independent day-buys. */
export function recoveryPlan(tasks: readonly Task[], critical: ReadonlySet<string>, targetDays: number): RecoveryPlan {
  const candidates = tasks
    .filter((t) => critical.has(t.id) && t.crash && t.crash.crashableDays > 0 && t.status !== 'done')
    .map((t) => ({ taskId: t.id, name: t.name, maxDays: t.crash!.crashableDays, costPerDayMinor: minor(t.crash!.crashCostPerDay) }))
    .sort((a, b) => a.costPerDayMinor - b.costPerDayMinor);

  const crashes: CrashCandidate[] = [];
  let remaining = Math.max(0, Math.round(targetDays));
  for (const c of candidates) {
    if (remaining <= 0) break;
    const days = Math.min(c.maxDays, remaining);
    crashes.push({ taskId: c.taskId, name: c.name, days, costPerDayMinor: c.costPerDayMinor, totalMinor: days * c.costPerDayMinor });
    remaining -= days;
  }
  const daysRecovered = crashes.reduce((n, c) => n + c.days, 0);
  const extraCostMinor = crashes.reduce((n, c) => n + c.totalMinor, 0);
  return { crashes, daysRecovered, extraCostMinor, costPerDayMinor: daysRecovered ? Math.round(extraCostMinor / daysRecovered) : 0, shortfallDays: remaining };
}

/** Re-forecast EAC/finish under simulator assumptions. Pure: nothing is saved. */
export type Assumptions = { productivityPct: number; dieselShockPct: number; extraRainDays: number; crashDays: number };
export type SimResult = { eac: number; vac: number; finishISO: string; slipDays: number; extraCostMinor: number; spi: number; cpi: number };

export function simulate(p: Project, evm: EVM, plan: RecoveryPlan, a: Assumptions, dieselExposureMinor: number): SimResult {
  // Productivity scales SPI; rain adds raw days; crashing buys days back.
  const spi = Math.max(0.1, evm.spi * (a.productivityPct / 100));
  // Derive from the SAME forecast the rest of the app uses, then apply the
  // scenario's own day adjustments — so at default assumptions the scenario is
  // identical to the baseline rather than a rounding step away from it.
  const ff = forecastFinishISO(p, spi);
  const adjust = a.extraRainDays - plan.daysRecovered;
  const slipDays = ff.slipDays + adjust;
  const finishISO = new Date(Date.parse(ff.iso) + adjust * DAY).toISOString().slice(0, 10);
  // Cost: baseline EAC + diesel shock on the exposed spend + the crash bill.
  const dieselExtra = Math.round(dieselExposureMinor * (a.dieselShockPct / 100));
  const eac = evm.eac + dieselExtra + plan.extraCostMinor;
  const cpi = eac > 0 ? Math.round((evm.bac / eac) * 100) / 100 : evm.cpi;
  return { eac, vac: evm.bac - eac, finishISO, slipDays, extraCostMinor: dieselExtra + plan.extraCostMinor, spi: Math.round(spi * 100) / 100, cpi };
}

/* --- site twin ------------------------------------------------------------ */

const LAYER_WEIGHT = { structure: 0.4, blockwork: 0.2, mep: 0.2, finishes: 0.2 } as const;

/** A zone's overall completion — the construction sequence, weighted. */
export function zoneProgress(z: Pick<Zone, 'layers'>): number {
  return Math.round(z.layers.structure * LAYER_WEIGHT.structure + z.layers.blockwork * LAYER_WEIGHT.blockwork + z.layers.mep * LAYER_WEIGHT.mep + z.layers.finishes * LAYER_WEIGHT.finishes);
}
export function zoneBand(pct: number): Tone {
  return pct >= 95 ? 'success' : pct >= 40 ? 'progress' : pct > 0 ? 'warn' : 'muted';
}
/** The level currently being worked — the visible top of the build. */
export function activeLevel(zones: readonly Zone[]): number {
  const started = zones.filter((z) => zoneProgress(z) > 0 && zoneProgress(z) < 100);
  return started.length ? Math.max(...started.map((z) => z.level)) : Math.max(0, ...zones.map((z) => z.level));
}
export function twinRollup(zones: readonly Zone[]): { levels: number; avgProgress: number; topped: number; openIssues: number } {
  const levels = new Set(zones.map((z) => z.level)).size;
  const avg = zones.length ? Math.round(zones.reduce((n, z) => n + zoneProgress(z), 0) / zones.length) : 0;
  return { levels, avgProgress: avg, topped: zones.filter((z) => z.layers.structure >= 100).length, openIssues: zones.reduce((n, z) => n + z.openIssues, 0) };
}

/* --- subcontractor league ------------------------------------------------- */

export type SubScore = {
  sub: Subcontractor; score: number; band: Tone; rank: number;
  deliveryPct: number; qualityScore: number; safetyScore: number; valueMinor: number; defectRate: number;
};

/** Composite 0–100: delivery 45%, quality 30%, safety 25%. Transparent and
 *  comparable across trades — the league every subcontractor can audit. */
export function scoreSubcontractors(subs: readonly Subcontractor[]): SubScore[] {
  const scored = subs.map((s) => {
    const deliveryPct = s.tasksCompleted > 0 ? Math.round((s.tasksOnTime / s.tasksCompleted) * 100) : 0;
    const defectRate = s.tasksCompleted > 0 ? s.defects / s.tasksCompleted : 0;
    const qualityScore = Math.max(0, Math.round(100 - defectRate * 40));
    const safetyScore = Math.max(0, 100 - s.safetyIncidents * 25);
    const score = Math.round(0.45 * deliveryPct + 0.3 * qualityScore + 0.25 * safetyScore);
    const band: Tone = score >= 85 ? 'success' : score >= 70 ? 'warn' : 'danger';
    return { sub: s, score, band, rank: 0, deliveryPct, qualityScore, safetyScore, valueMinor: minor(s.contractValue), defectRate: Math.round(defectRate * 100) / 100 };
  }).sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}

/* --- safety --------------------------------------------------------------- */

export type SafetyStats = { daysSinceLTI: number | null; lostTimeEvents: number; nearMisses: number; observations: number; activePermits: number; expiredPermits: number; talksThisMonth: number; openCorrectiveActions: number; overdueCorrectiveActions: number; score: number; band: Tone };

/** Site-safety posture: days since the last lost-time injury, permit hygiene and
 *  reporting culture (near-misses reported is a POSITIVE signal). */
export function safetyStats(events: readonly SafetyEvent[], permits: readonly SafetyPermit[], talks: readonly ToolboxTalk[], nowMs: number): SafetyStats {
  const lti = events.filter((e) => e.kind === 'lost_time').map((e) => Date.parse(e.atISO)).sort((a, b) => b - a)[0];
  const daysSinceLTI = lti ? Math.floor((nowMs - lti) / DAY) : null;
  const openLti = events.filter((e) => e.kind === 'lost_time' && !e.closed).length;
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  const expired = permits.filter((p) => ['approved', 'active'].includes(p.status) && p.validToISO < todayISO).length;
  const openCorrectiveActions = events.filter((e) => e.corrective && e.corrective.status !== 'verified').length;
  const overdueCorrectiveActions = events.filter((e) => e.corrective && e.corrective.status !== 'verified' && e.corrective.dueISO < todayISO).length;
  const talksThisMonth = talks.filter((t) => nowMs - Date.parse(t.atISO) <= 30 * DAY).length;
  const nearMisses = events.filter((e) => e.kind === 'near_miss').length;
  // Reporting culture earns credit; lapsed permits and open LTIs cost.
  const score = Math.max(0, Math.min(100, 70 + Math.min(15, nearMisses * 3) + Math.min(15, talksThisMonth * 5) - expired * 10 - openLti * 20 - overdueCorrectiveActions * 10));
  return {
    daysSinceLTI, lostTimeEvents: events.filter((e) => e.kind === 'lost_time').length, nearMisses,
    observations: events.filter((e) => e.kind === 'observation').length,
    activePermits: permits.filter((p) => p.status === 'active' && p.validToISO >= todayISO).length, expiredPermits: expired, talksThisMonth, openCorrectiveActions, overdueCorrectiveActions,
    score, band: score >= 85 ? 'success' : score >= 65 ? 'warn' : 'danger',
  };
}

/** Two live permits overlapping in time AND place — the classic hot-work clash. */
export function permitClashes(permits: readonly SafetyPermit[]): { a: SafetyPermit; b: SafetyPermit }[] {
  const live = permits.filter((p) => ['requested', 'approved', 'active'].includes(p.status));
  const out: { a: SafetyPermit; b: SafetyPermit }[] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.projectId !== b.projectId || a.location.trim().toLowerCase() !== b.location.trim().toLowerCase()) continue;
    const start = Math.max(Date.parse(a.validFromISO), Date.parse(b.validFromISO));
    const end = Math.min(Date.parse(a.validToISO), Date.parse(b.validToISO));
    if (end >= start) out.push({ a, b });
  }
  return out;
}

export const PERMIT_LABEL: Record<SafetyPermitType, string> = {
  hot_work: 'Hot work', height: 'Work at height', excavation: 'Excavation',
  confined_space: 'Confined space', lifting: 'Lifting operation', electrical: 'Electrical',
};
export const SAFETY_EVENT_LABEL: Record<SafetyEventKind, string> = {
  near_miss: 'Near miss', first_aid: 'First aid', lost_time: 'Lost time', observation: 'Observation',
};

/* --- investor build-watch ------------------------------------------------- */

export type BuildConfidence = { score: number; band: Tone; label: string; drivers: { label: string; value: string; tone: Tone }[] };

/** An investor-legible fusion of schedule, cost, quality and reporting —
 *  deliberately coarser than the operator view, and never exposes vendor prices. */
export function buildConfidence(evm: EVM, openCritical: number, reportCoveragePct: number, safety: number): BuildConfidence {
  const sched = Math.min(100, Math.round(evm.spi * 100));
  const cost = Math.min(100, Math.round(evm.cpi * 100));
  const score = Math.max(0, Math.round(0.35 * sched + 0.3 * cost + 0.2 * reportCoveragePct + 0.15 * safety - openCritical * 3));
  const band: Tone = score >= 85 ? 'success' : score >= 70 ? 'warn' : 'danger';
  return {
    score, band, label: score >= 85 ? 'On track' : score >= 70 ? 'Watch' : 'At risk',
    drivers: [
      { label: 'Schedule', value: `SPI ${evm.spi.toFixed(2)}`, tone: perfBand(evm.spi) },
      { label: 'Cost', value: `CPI ${evm.cpi.toFixed(2)}`, tone: perfBand(evm.cpi) },
      { label: 'Reporting', value: `${reportCoveragePct}% days covered`, tone: reportCoveragePct >= 85 ? 'success' : 'warn' },
      { label: 'Safety', value: `${safety}/100`, tone: safety >= 85 ? 'success' : safety >= 65 ? 'warn' : 'danger' },
    ],
  };
}

/* --- construction copilot (deterministic grounding) ----------------------- */

export type ConAnswer = { answer: string; sources: { label: string; href: string }[]; grounded: boolean };

/** Deterministic Q&A over an already scoped world. The caller must derive
 *  commercial access from the authenticated actor, never from request input.
 *  The default preserves existing trusted commercial callers. Limited readers
 *  receive non-financial answers only, without an LLM rewriting this boundary. */
export function askConstruction(question: string, w: ConWorld, nowMs: number, canSeeCommercials = true): ConAnswer {
  const q = question.toLowerCase();
  const src = (label: string, href: string) => ({ label, href });
  const active = w.projects.filter((p) => p.status === 'active' || p.status === 'closing');

  const has = (...words: string[]) => words.some((x) => q.includes(x));

  if (has('behind', 'late', 'slip', 'schedule', 'delay')) {
    const rows = active.map((p) => ({ p, e: projectEVMOf(p, w.costCodes) })).filter((r) => r.e.spi < 1).sort((a, b) => a.e.spi - b.e.spi);
    if (rows.length === 0) return { answer: 'No active project is behind its baseline right now — every SPI is at or above 1.00.', sources: [src('Earned Value', '/construction/evm')], grounded: true };
    const lines = rows.map((r) => `${r.p.name} is at ${r.p.percentComplete}% against a ${r.p.plannedPercent}% plan (SPI ${r.e.spi}), forecast to finish ${forecastFinishISO(r.p, r.e.spi).iso}`);
    return { answer: `${rows.length} project${rows.length === 1 ? ' is' : 's are'} behind: ${lines.join('; ')}.`, sources: [src('Critical Path', '/construction/schedule'), src('Earned Value', '/construction/evm')], grounded: true };
  }
  if (has('cost', 'budget', 'overrun', 'eac', 'over')) {
    if (!canSeeCommercials) return { answer: 'Commercial cost, budget and forecast amounts are restricted for your access level. Ask about schedule, materials, deliveries, workforce or non-financial risk instead.', sources: [src('Earned Value', '/construction/evm')], grounded: true };
    const rows = active.map((p) => ({ p, e: projectEVMOf(p, w.costCodes) }));
    const over = rows.filter((r) => r.e.vac < 0);
    if (over.length === 0) return { answer: 'Every active project is forecast within budget on current performance.', sources: [src('Earned Value', '/construction/evm')], grounded: true };
    return { answer: over.map((r) => `${r.p.name} is forecast to finish at ₦${fmtM(r.e.eac)} against a ₦${fmtM(r.e.bac)} budget — ₦${fmtM(-r.e.vac)} over, at CPI ${r.e.cpi}`).join('; ') + '.', sources: [src('Earned Value', '/construction/evm'), src('Cost codes', '/construction/evm')], grounded: true };
  }
  if (has('material', 'stock', 'leak', 'cement', 'rebar', 'shortage')) {
    const low = w.materials.filter((m) => { const on = w.stock.filter((s) => s.materialId === m.id).reduce((n, s) => n + s.onHand, 0); return on <= m.reorderLevel; });
    const leaks = w.materials.map((m) => ({ m, l: materialLeakage(m.id, w.movements, w.stock.filter((s) => s.materialId === m.id).reduce((n, s) => n + s.onHand, 0)) })).filter((x) => x.l.anomalous);
    const parts: string[] = [];
    if (low.length) parts.push(`${low.length} material${low.length === 1 ? ' is' : 's are'} at or below reorder level (${low.map((m) => m.name).join(', ')})`);
    if (leaks.length) parts.push(`${leaks.map((x) => `${x.m.name} shows ${x.l.leakagePct}% unaccounted (${x.l.leakageQty} ${x.m.unit})`).join('; ')}`);
    return { answer: parts.length ? `${parts.join('. ')}.` : 'Stock levels are healthy and nothing is showing an unexplained variance.', sources: [src('Materials', '/construction/materials')], grounded: true };
  }
  if (has('procure', 'purchase', 'vendor', 'supplier', 'delivery', 'po ', 'order')) {
    const late = w.pos.filter((p) => ['issued', 'acknowledged', 'part_delivered', 'approved'].includes(p.status) && p.deliveredQty < p.qty && isOverdue(p.expectedISO, nowMs));
    if (late.length === 0) return { answer: 'No purchase order is past its promised delivery date.', sources: [src('Procurement', '/construction/procurement')], grounded: true };
    return { answer: `${late.length} order${late.length === 1 ? ' is' : 's are'} late: ${late.map((p) => `${p.ref} (${p.item}) from ${p.vendorName}, promised ${p.expectedISO}, ${p.deliveredQty}/${p.qty} ${p.unit} delivered`).join('; ')}.`, sources: late.slice(0, 3).map((p) => src(p.ref, '/construction/procurement')), grounded: true };
  }
  if (has('risk', 'worry', 'attention', 'problem', 'wrong')) {
    const top = scanRisks(w, nowMs).filter((risk) => canSeeCommercials || risk.kind !== 'cost_overrun').slice(0, 3);
    if (top.length === 0) return { answer: 'The radar is quiet — no detector is flagging anything right now.', sources: [src('Risk Radar', '/construction/risk')], grounded: true };
    return { answer: `Top ${top.length}: ${top.map((r) => `${r.title} (${RISK_LABEL[r.kind]}, ${Math.round(r.confidence * 100)}% confidence${canSeeCommercials && r.nairaAtRiskMinor ? `, ₦${fmtM(r.nairaAtRiskMinor)} at risk` : ''})`).join('; ')}.`, sources: [src('Risk Radar', '/construction/risk')], grounded: true };
  }
  if (has('crew', 'worker', 'labour', 'labor', 'attendance', 'on site')) {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const present = w.attendance.filter((a) => a.dateISO === today && a.status === 'present').length;
    return { answer: `${present} of ${w.workers.length} allocated workers are clocked in today. ${w.workers.filter((x) => x.certExpiryISO && certBand(x, nowMs).days !== null && certBand(x, nowMs).days! <= 30).length} certificate(s) expire within 30 days.`, sources: [src('Workforce', '/construction/workforce')], grounded: true };
  }
  if (has('safe', 'incident', 'permit', 'injur')) {
    return { answer: 'Safety detail lives on the Safety & Permits page — it tracks days since the last lost-time injury, live permits and any location clashes.', sources: [src('Safety & Permits', '/construction/safety')], grounded: true };
  }
  if (has('progress', 'status', 'how are', 'summary', 'overall')) {
    const conf = portfolioConfidence(w.projects, w.costCodes, scanRisks(w, nowMs));
    return { answer: `Portfolio delivery confidence is ${conf.score}/100 (${conf.label}). ${active.map((p) => `${p.name} ${p.percentComplete}%`).join(', ')}.${canSeeCommercials ? ` ₦${fmtM(conf.nairaAtRiskMinor)} is flagged at risk across open signals.` : ''}`, sources: [src('Command Center', '/construction'), src('Weekly Digest', '/construction/digest')], grounded: true };
  }
  return {
    answer: 'I can answer from the construction records on schedule and slippage, cost and forecast out-turn, materials and stock variance, procurement and late deliveries, workforce and certificates, and the risk radar. Ask about any of those and I will cite the records.',
    sources: [], grounded: false,
  };
}

/** Deterministic starter questions, chosen from what is actually wrong today. */
export function suggestedQuestions(w: ConWorld, nowMs: number): string[] {
  const out: string[] = [];
  const risks = scanRisks(w, nowMs);
  if (risks.some((r) => r.kind === 'schedule_slip')) out.push('Which projects are behind schedule?');
  if (risks.some((r) => r.kind === 'cost_overrun')) out.push('Are we forecast to go over budget?');
  if (risks.some((r) => r.kind === 'procurement_late')) out.push('Which deliveries are late?');
  if (risks.some((r) => r.kind === 'material_leakage' || r.kind === 'low_stock')) out.push('Any material shortages or unexplained stock?');
  out.push('What should I worry about today?');
  return out.slice(0, 5);
}

/* --- misc formatting ------------------------------------------------------ */

function clamp01(n: number): number { return Math.max(0, Math.min(1, Math.round(n * 100) / 100)); }
/** Compact ₦ millions/billions for evidence strings. */
export function fmtM(m: number): string { const n = m / 100; return n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : `${Math.round(n / 1000)}k`; }
