'use server';

import { operatingDateISO, operatingNowISO, operatingNowMs } from '@/server/operating-clock';

import { withDurableMutation } from '@/server/data/durable-records';

import { nextRecordSequence } from '@/server/data/record-context';

/**
 * Construction (ConstructionOS) actions. Every mutation re-checks the §7
 * reports_analytics capability server-side (estate_manager/facility_manager hold
 * M and mutate; executive/investor hold V → rejected). The flagship flows are
 * end-to-end: awarding an RFQ issues a PO and commits budget; receiving a
 * delivery books stock AND actual cost; escalating a risk signal opens a real
 * Issue — so the money and the site stay in one truth.
 */

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getActor } from '@/server/session';
import { ForbiddenError, assertCan, type Actor } from '@/lib/authz';
import { db } from '@/server/data/store';
import { repos, scopedConstructionProjectGet, scopedConstructionRfqGet, scopedConstructionTaskGet, scopedMutableGet } from '@/server/data';
import { money, type Money } from '@/domain/primitives';

import { constructionWorld } from '@/server/reads/construction';
import { canEnterWorkspace } from '@/config/workspaces';
import {
  nextRevision, timesheetCostMinor, movementAllowed, routeFor, stepsFromRule,
  canApprove, applyDecision, pendingSteps, fxExposure, fxTable, scanRisks, programmeNetwork,
} from '@/domain/construction';
import type { CurrencyCode } from '@/domain/primitives';
import type { AuditAction, ProjectMobilisation, ProjectStatus } from '@/domain/construction/types';
import { constructionDrawingEditable } from '@/server/construction/drawings';
import { constructionDrawingVisible } from '@/server/construction/drawings';
import { rfiInScope, rfiManager, rfiPackageAllowed } from '@/server/construction/rfi-access';
import { rfiProjectMembers } from '@/server/construction/rfi-members';
import { getCompanyPrincipal } from '@/server/auth/company';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { pushNotification } from '@/server/data/inbox';
import type { RFI, RFIActivity } from '@/domain/construction/types';
import { CONSTRUCTION_PROJECT_TYPES, type ConstructionProjectType } from '@/domain/construction/forecast-evaluation';
import { canRecordQualitySignOff } from '@/server/construction/quality-access';

export type Res = { ok: true; ref?: string } | { ok: false; error: string };

const PATHS = ['/construction', '/construction/evm', '/construction/schedule', '/construction/materials', '/construction/risk', '/construction/procurement', '/construction/site', '/construction/projects', '/construction/workforce', '/construction/digest', '/construction/documents', '/construction/boq', '/construction/timesheets', '/construction/stock', '/construction/approvals', '/construction/audit', '/construction/fx', '/construction/field', '/construction/simulator', '/construction/twin', '/construction/league', '/construction/safety', '/construction/quality', '/construction/build-watch', '/construction/copilot'];
const revalidate = () => PATHS.forEach((p) => revalidatePath(p));

async function gate(action: 'update' | 'create' | 'approve'): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  const actor = await getActor();
  if (!canEnterWorkspace(actor, 'construction')) return { ok: false, error: 'You cannot enter the construction workspace with this account.' };
  try { assertCan(actor, 'reports_analytics', action); return { ok: true, actor }; }
  catch (e) { if (e instanceof ForbiddenError) return { ok: false, error: 'You need construction-manager access for this.' }; throw e; }
}

const addMinor = (a: Money, b: number): Money => money(a.minor + b, a.currency);
const finiteQty = (value: number) => Number.isFinite(value) && value > 0;
const safeMinor = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
/** The acting user's human name (Actor carries ids, not display names). */
const nameOf = (actor: Actor): string => db.users.find((u) => u.id === actor.userId)?.name ?? 'Site team';
const daysISO = (fromISO: string, days: number) => new Date(Date.parse(fromISO) + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

/* --- daily site reports (state machine) ----------------------------------- */
export async function submitReport(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const r = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReports, id, 'update'); if (!r) return { ok: false, error: 'Report not found.' };
  if (r.status !== 'draft' && r.status !== 'returned') return { ok: false, error: 'Only a draft can be submitted.' };
  r.status = 'submitted'; revalidate(); return { ok: true, ref: r.dateISO };

  }, 'construction');
}
export async function reviewReport(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const r = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReports, id, 'update'); if (!r) return { ok: false, error: 'Report not found.' };
  if (r.status !== 'submitted') return { ok: false, error: 'Only a submitted report can be reviewed.' };
  r.status = 'reviewed'; revalidate(); return { ok: true };

  }, 'construction');
}
export async function approveDailyReport(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const r = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReports, id, 'update'); if (!r) return { ok: false, error: 'Report not found.' };
  if (r.status !== 'submitted' && r.status !== 'reviewed') return { ok: false, error: 'Only a submitted/reviewed report can be approved.' };
  // Segregation of duties: the approver may not be the reporting officer.
  const me = nameOf(g.actor).toLowerCase();
  if (me && r.officer.toLowerCase() === me) return { ok: false, error: 'You submitted this report — a different manager must approve it.' };
  r.status = 'approved'; revalidate(); return { ok: true, ref: r.dateISO };

  }, 'construction');
}
export async function returnDailyReport(id: string, reason: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const r = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReports, id, 'update'); if (!r) return { ok: false, error: 'Report not found.' };
  if (!reason?.trim()) return { ok: false, error: 'A return reason is required.' };
  if (!['submitted', 'reviewed'].includes(r.status)) return { ok: false, error: 'Only a submitted or reviewed report can be returned. Approved reports require an adjustment.' };
  r.status = 'returned'; r.constraints = [...r.constraints, `Returned: ${reason.trim()}`]; revalidate(); return { ok: true };

  }, 'construction');
}

/* --- schedule ------------------------------------------------------------- */
export async function updateTaskProgress(id: string, pct: number): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const t = scopedConstructionTaskGet(g.actor, id, 'update'); if (!t) return { ok: false, error: 'Task not found.' };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: 'Enter progress from 0% to 100%.' };
  if (t.status === 'done' && pct < 100) return { ok: false, error: 'Completed work needs a separate approved adjustment before reopening.' };
  if (pct > 0 && t.dependsOn.some((dependencyId) => db.constructionTasks.find((task) => task.id === dependencyId && task.tenantId === g.actor.tenantId)?.status !== 'done')) return { ok: false, error: 'Complete the predecessor tasks before recording progress.' };
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  t.percentComplete = p; t.status = p === 0 ? 'not_started' : p >= 100 ? 'done' : 'in_progress';
  if (p > 0 && !t.actualStartISO) t.actualStartISO = operatingDateISO();
  if (p >= 100 && !t.actualFinishISO) t.actualFinishISO = operatingDateISO();
  revalidate(); return { ok: true, ref: t.name };

  }, 'construction');
}
export async function advanceMilestone(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const m = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMilestones, id, 'update'); if (!m) return { ok: false, error: 'Milestone not found.' };
  if (m.status === 'accepted') return { ok: false, error: 'This milestone is already accepted.' };
  m.status = 'accepted'; revalidate(); return { ok: true, ref: m.name };

  }, 'construction');
}
export async function escalateTaskToIssue(taskId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  const t = scopedConstructionTaskGet(g.actor, taskId, 'create'); if (!t) return { ok: false, error: 'Task not found.' };
  const id = `is-esc-${nextRecordSequence('construction:issueSeq', 0, true)}`;
  db.constructionIssues.unshift({ tenantId: g.actor.tenantId, id, projectId: t.projectId, category: 'Schedule', title: `Overdue task escalated: ${t.name}`, severity: 'high', owner: t.owner, raisedISO: operatingDateISO(), dueISO: daysISO(operatingDateISO(), 3), status: 'open', correctiveAction: 'Recovery plan required' } as (typeof db.constructionIssues)[number]);
  revalidate(); return { ok: true, ref: t.name };

  }, 'construction');
}

/* --- procurement (PR → RFQ award → PO → delivery) ------------------------- */
export async function approvePurchaseRequest(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const pr = scopedMutableGet(g.actor, 'reports_analytics', db.constructionRequests, id, 'update'); if (!pr) return { ok: false, error: 'Request not found.' };
  if (pr.status !== 'pending' && pr.status !== 'draft') return { ok: false, error: 'Only a pending request can be approved.' };
  pr.status = 'approved'; revalidate(); return { ok: true, ref: pr.ref };

  }, 'construction');
}
/** Award an RFQ to a vendor: issue a PO from the winning quote and commit budget. */
export async function awardRfq(rfqId: string, vendorId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  const rfq = scopedConstructionRfqGet(g.actor, rfqId, 'create'); if (!rfq) return { ok: false, error: 'RFQ not found.' };
  if (rfq.status === 'awarded') return { ok: false, error: 'This RFQ is already awarded. Its order cannot be issued twice.' };
  const q = rfq.quotes.find((x) => x.vendorId === vendorId); if (!q) return { ok: false, error: 'Quote not found.' };
  const req = repos.constructionRequests.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.find((r) => r.ref === rfq.requestRef && r.projectId === rfq.projectId);
  if (!req || !['approved', 'rfq'].includes(req.status)) return { ok: false, error: 'An approved request for this project is required before award.' };
  const cc = repos.constructionCostCodes.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.find((c) => c.projectId === rfq.projectId && c.code === req.costCode);
  if (!cc || !safeMinor(q.price.minor) || q.price.currency !== cc.committed.currency || !Number.isSafeInteger(cc.committed.minor + q.price.minor) || !Number.isFinite(q.leadDays) || q.leadDays < 0 || !finiteQty(rfq.qty)) return { ok: false, error: 'Review the quote currency, amount, delivery lead time and project cost code before award.' };
  const vendor = scopedMutableGet(g.actor, 'reports_analytics', db.constructionVendors, vendorId, 'read');
  if (!vendor || vendor.suspended) return { ok: false, error: 'Choose an authorised, active supplier.' };
  rfq.status = 'awarded'; rfq.awardedVendorId = vendorId;
  const latest = Math.max(3014, ...db.constructionOrders.filter((order) => order.tenantId === g.actor.tenantId).map((order) => Number(/^PO-(\d+)$/.exec(order.ref)?.[1] ?? 0)));
  const ref = `PO-${latest + 1}`;
  db.constructionOrders.unshift({ tenantId: g.actor.tenantId, id: `po-new-${randomUUID()}`, ref, projectId: rfq.projectId, vendorId, vendorName: q.vendorName, item: rfq.item, qty: rfq.qty, unit: rfq.unit, costCode: req.costCode, value: q.price, status: 'issued', issuedISO: operatingDateISO(), expectedISO: daysISO(operatingDateISO(), q.leadDays), deliveredQty: 0 } as (typeof db.constructionOrders)[number]);
  req.status = 'ordered';
  cc.committed = addMinor(cc.committed, q.price.minor);
  revalidate(); return { ok: true, ref };

  }, 'construction');
}
export async function approvePurchaseOrder(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const po = scopedMutableGet(g.actor, 'reports_analytics', db.constructionOrders, id, 'update'); if (!po) return { ok: false, error: 'PO not found.' };
  if (!['draft', 'approved'].includes(po.status)) return { ok: false, error: 'Only a draft or approved order can advance to issue.' };
  po.status = po.status === 'draft' ? 'approved' : 'issued'; revalidate(); return { ok: true, ref: po.ref };

  }, 'construction');
}
/** Receive against a PO: advance delivery, book stock AND actual cost. */
export async function receiveDelivery(poId: string, qty: number): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const po = scopedMutableGet(g.actor, 'reports_analytics', db.constructionOrders, poId, 'update'); if (!po) return { ok: false, error: 'PO not found.' };
  if (!finiteQty(qty)) return { ok: false, error: 'Enter a finite quantity greater than zero.' };
  if (!['issued', 'acknowledged', 'part_delivered'].includes(po.status)) return { ok: false, error: 'Only an issued, acknowledged or part-delivered order can receive goods.' };
  if (!finiteQty(po.qty) || po.deliveredQty < 0 || qty > po.qty - po.deliveredQty) return { ok: false, error: 'The receipt cannot exceed the outstanding order quantity.' };
  const recv = qty;
  // Book actual cost pro-rata into the cost code.
  const cc = repos.constructionCostCodes.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.find((c) => c.projectId === po.projectId && c.code === po.costCode);
  const bookedMinor = Math.round(po.value.minor * ((po.deliveredQty + recv) / po.qty)) - Math.round(po.value.minor * (po.deliveredQty / po.qty));
  if (!cc || cc.actual.currency !== po.value.currency || !safeMinor(bookedMinor) || !Number.isSafeInteger(cc.actual.minor + bookedMinor)) return { ok: false, error: 'Review the order currency, value and project cost code before receiving.' };
  // Match the full name first, then a unique leading-name/unit match. Substring
  // matching "cement" inside "reinforcement" used to receive rebar as cement.
  const normalName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const itemName = normalName(po.item);
  const candidates = repos.constructionMaterials.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.filter((material) => material.unit === po.unit && (itemName.startsWith(normalName(material.name).slice(0, 6)) || normalName(material.name).startsWith(itemName.slice(0, 6))));
  const mat = candidates.find((material) => normalName(material.name) === itemName) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (candidates.length > 1 && !mat) return { ok: false, error: 'The receipt has an ambiguous material match. Review the purchase-order item before receiving.' };
  const warehouse = mat ? repos.constructionWarehouses.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.find((row) => row.projectId === po.projectId) : undefined;
  if (mat && !warehouse) return { ok: false, error: 'A receiving store must be configured for this project first.' };
  po.deliveredQty += recv; po.status = po.deliveredQty >= po.qty ? 'delivered' : 'part_delivered';
  cc.actual = addMinor(cc.actual, bookedMinor);
  if (mat && warehouse) {
    const st = repos.constructionStock.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.find((s) => s.materialId === mat.id && s.warehouseId === warehouse.id);
    if (st) { st.onHand += recv; st.inTransit = Math.max(0, st.inTransit - recv); }
    else db.constructionStock.push({ tenantId: g.actor.tenantId, id: `st-receive-${randomUUID()}`, materialId: mat.id, warehouseId: warehouse.id, onHand: recv, reserved: 0, inTransit: 0 } as (typeof db.constructionStock)[number]);
    db.constructionMovements.unshift({ tenantId: g.actor.tenantId, id: `sm-new-${nextRecordSequence('construction:movSeq', 0, true)}`, materialId: mat.id, kind: 'receipt', qty: recv, atISO: operatingDateISO(), projectId: po.projectId, costCode: po.costCode, ref: po.ref, by: nameOf(g.actor) } as (typeof db.constructionMovements)[number]);
  }
  revalidate(); return { ok: true, ref: `${recv} ${po.unit}` };

  }, 'construction');
}

/* --- materials ------------------------------------------------------------ */
export async function issueMaterials(materialId: string, qty: number, projectId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (!scopedConstructionProjectGet(g.actor, projectId, 'update')) return { ok: false, error: 'Project not found.' };
  const stock = repos.constructionStock.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items.filter((row) => row.materialId === materialId);
  if (!stock.length) return { ok: false, error: 'Stock not found.' };
  if (!finiteQty(qty)) return { ok: false, error: 'Enter a finite quantity greater than zero.' };
  if (qty > stock.reduce((total, row) => total + row.onHand, 0)) return { ok: false, error: 'Cannot issue more than on-hand (negative stock blocked).' };
  let remaining = qty;
  for (const row of stock) {
    const issued = Math.min(row.onHand, remaining);
    row.onHand -= issued; row.reserved = Math.max(0, row.reserved - issued); remaining -= issued;
    if (remaining === 0) break;
  }
  const movSeq = nextRecordSequence('construction:movSeq', 0, true);
  db.constructionMovements.unshift({ tenantId: g.actor.tenantId, id: `sm-new-${movSeq}`, materialId, kind: 'issue', qty, atISO: operatingDateISO(), projectId, ref: `MI-${470 + movSeq}`, by: nameOf(g.actor) } as (typeof db.constructionMovements)[number]);
  revalidate(); return { ok: true };

  }, 'construction');
}

/* --- cost control --------------------------------------------------------- */
export type VariationInput = { projectId: string; title: string; reason: string; costImpactNaira: number; scheduleImpactDays: number };
export async function raiseVariation(input: VariationInput): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  if (!input.title?.trim()) return { ok: false, error: 'Enter a variation title.' };
  if (!scopedConstructionProjectGet(g.actor, input.projectId, 'create')) return { ok: false, error: 'Project not found.' };
  if (!Number.isFinite(input.costImpactNaira) || !Number.isSafeInteger(Math.round(input.costImpactNaira * 100)) || !Number.isFinite(input.scheduleImpactDays) || !Number.isSafeInteger(Math.round(input.scheduleImpactDays))) return { ok: false, error: 'Enter finite cost and schedule impacts.' };
  const varSeq = nextRecordSequence('construction:varSeq', 0, true);
  const ref = `VO-${12 + db.constructionVariations.length + (varSeq)}`;
  db.constructionVariations.unshift({ tenantId: g.actor.tenantId, id: `var-new-${varSeq}`, ref, projectId: input.projectId, title: input.title.trim(), reason: input.reason.trim() || 'Not stated', costImpact: money(Math.round((input.costImpactNaira || 0) * 100)), scheduleImpactDays: Math.round(input.scheduleImpactDays || 0), status: 'submitted', raisedISO: operatingDateISO() } as (typeof db.constructionVariations)[number]);
  revalidate(); return { ok: true, ref };

  }, 'construction');
}
export async function approveVariation(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const v = scopedMutableGet(g.actor, 'reports_analytics', db.constructionVariations, id, 'update'); if (!v) return { ok: false, error: 'Variation not found.' };
  if (v.changeOrder) return { ok: false, error: 'Use the staged change-order approvals and finance posting workflow.' };
  if (v.status !== 'submitted') return { ok: false, error: 'Only a submitted variation can be approved.' };
  v.status = 'approved'; revalidate(); return { ok: true, ref: v.ref };

  }, 'construction');
}

/* --- risk radar (advisory lifecycle) -------------------------------------- */
function setSignalState(actor: Actor, signalId: string, state: 'ack' | 'snoozed' | 'escalated' | 'dismissed') {
  const existing = db.constructionSignalStates.find((s) => s.tenantId === actor.tenantId && s.signalId === signalId);
  if (existing) { existing.state = state; return existing; }
  const row: (typeof db.constructionSignalStates)[number] = { tenantId: actor.tenantId!, signalId, state, atISO: operatingNowISO() };
  db.constructionSignalStates.push(row); return row;
}
export async function acknowledgeSignal(signalId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (!scanRisks(constructionWorld(g.actor), operatingNowMs()).some((signal) => signal.id === signalId)) return { ok: false, error: 'Signal not found in your authorised projects.' };
  setSignalState(g.actor, signalId, 'ack'); revalidate(); return { ok: true };

  }, 'construction');
}
export async function snoozeSignal(signalId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (!scanRisks(constructionWorld(g.actor), operatingNowMs()).some((signal) => signal.id === signalId)) return { ok: false, error: 'Signal not found in your authorised projects.' };
  setSignalState(g.actor, signalId, 'snoozed'); revalidate(); return { ok: true };

  }, 'construction');
}
export async function dismissSignal(signalId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (!scanRisks(constructionWorld(g.actor), operatingNowMs()).some((signal) => signal.id === signalId)) return { ok: false, error: 'Signal not found in your authorised projects.' };
  setSignalState(g.actor, signalId, 'dismissed'); revalidate(); return { ok: true };

  }, 'construction');
}
export async function escalateSignalToIssue(signalId: string, projectId: string, title: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  if (!scopedConstructionProjectGet(g.actor, projectId, 'create')) return { ok: false, error: 'Project not found.' };
  const signal = scanRisks(constructionWorld(g.actor), operatingNowMs()).find((row) => row.id === signalId && row.projectId === projectId);
  if (!signal || !title?.trim()) return { ok: false, error: 'Signal not found in this authorised project.' };
  const receipt = db.constructionSignalStates.find((row) => row.tenantId === g.actor.tenantId && row.signalId === signalId);
  if (receipt?.escalatedIssueId) {
    const linked = scopedMutableGet(g.actor, 'reports_analytics', db.constructionIssues, receipt.escalatedIssueId, 'read');
    if (!linked || linked.projectId !== projectId) return { ok: false, error: 'This signal was already escalated. Review its recorded site issue before taking further action.' };
    return { ok: true, ref: linked.id };
  }
  if (receipt?.state === 'escalated') return { ok: false, error: 'This signal has already been escalated.' };
  const id = `is-esc-${nextRecordSequence('construction:issueSeq', 0, true)}`;
  db.constructionIssues.unshift({ tenantId: g.actor.tenantId, id, projectId, category: 'Risk', title: `Escalated: ${signal.title}`, severity: 'high', owner: nameOf(g.actor), raisedISO: operatingDateISO(), dueISO: daysISO(operatingDateISO(), 5), status: 'open', correctiveAction: 'From risk radar' } as (typeof db.constructionIssues)[number]);
  setSignalState(g.actor, signalId, 'escalated').escalatedIssueId = id; revalidate(); return { ok: true, ref: id };

  }, 'construction');
}

/* --- project quality and design coordination ----------------------------- */
const qualityCategories = ['Punch list', 'Authority inspection', 'Design clash'] as const;
const qualityInput = z.object({
  projectId: z.string().min(1),
  category: z.enum(qualityCategories),
  title: z.string().trim().min(4).max(180),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  owner: z.string().trim().min(2).max(100),
  dueISO: z.iso.date(),
  location: z.string().trim().min(2).max(160),
  sourceReference: z.string().trim().max(160).optional(),
  relatedReference: z.string().trim().max(160).optional(),
  authority: z.string().trim().max(160).optional(),
  evidenceReference: z.string().trim().max(500).optional(),
  workPackageId: z.string().trim().min(1).max(200).optional(),
});
export type QualityIssueInput = z.infer<typeof qualityInput>;

export async function recordConstructionQualityIssue(input: QualityIssueInput): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('create'); if (!g.ok) return g;
    const parsed = qualityInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Check the project, title, owner, location and due date.' };
    const data = parsed.data;
    const project = scopedConstructionProjectGet(g.actor, data.projectId, 'create');
    if (!project || !rfiPackageAllowed(g.actor, project, data.workPackageId)) return { ok: false, error: 'Project or work package not found.' };
    if (data.category === 'Authority inspection' && !data.authority) return { ok: false, error: 'Record the inspecting authority.' };
    if (data.category === 'Design clash' && (!data.sourceReference || !data.relatedReference)) return { ok: false, error: 'Record both conflicting drawing or model references.' };
    const id = `is-quality-${randomUUID()}`;
    db.constructionIssues.unshift({ tenantId: g.actor.tenantId, id, ...data, raisedISO: operatingDateISO(), status: 'open' } as (typeof db.constructionIssues)[number]);
    audit(g.actor, { action: 'record', entity: 'construction_issue', entityRef: id, projectId: data.projectId, summary: `${data.category}: ${data.title}` });
    revalidate();
    return { ok: true, ref: id };
  }, 'construction');
}

export async function advanceConstructionQualityIssue(id: string, status: 'in_progress' | 'resolved', correctiveAction: string, evidenceReference?: string): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const issue = scopedMutableGet(g.actor, 'reports_analytics', db.constructionIssues, id, 'update');
    if (!issue || !scopedConstructionProjectGet(g.actor, issue.projectId, 'update')) return { ok: false, error: 'Issue not found.' };
    if (!rfiPackageAllowed(g.actor, scopedConstructionProjectGet(g.actor, issue.projectId, 'update')!, issue.workPackageId)) return { ok: false, error: 'Issue not found.' };
    if (!qualityCategories.some((category) => category === issue.category)) return { ok: false, error: 'Use the source workflow for this issue.' };
    if (status === 'resolved' && issue.category !== 'Design clash') return { ok: false, error: 'Record corrective work and sign-off in Quality & coordination before closing this item.' };
    if (status === 'resolved' && !issue.clashReview) return { ok: false, error: 'An authorised engineering review is required before closing a design conflict.' };
    if (issue.status === 'resolved') return { ok: false, error: 'Resolved issues require a separate adjustment to reopen.' };
    const note = correctiveAction?.trim();
    if (!note || note.length < 8 || note.length > 1000) return { ok: false, error: 'Describe the action in at least 8 characters.' };
    const evidence = evidenceReference?.trim();
    if (status === 'resolved' && !evidence && !issue.evidenceReference) return { ok: false, error: 'Add an evidence reference before resolution.' };
    const before = issue.status;
    issue.status = status;
    issue.correctiveAction = note;
    if (evidence) issue.evidenceReference = evidence.slice(0, 500);
    if (status === 'resolved') issue.closedISO = operatingDateISO();
    audit(g.actor, { action: status === 'resolved' ? 'resolve' : 'record', entity: 'construction_issue', entityRef: id, projectId: issue.projectId, summary: `${issue.category}: ${issue.title}`, before, after: status, note });
    revalidate();
    return { ok: true, ref: id };
  }, 'construction');
}

export async function reviewConstructionClash(id: string, disposition: 'confirmed' | 'false_positive' | 'accepted_tolerance' | 'needs_redesign', rationale: string, evidenceReference: string): Promise<Res> {
  return withDurableMutation(async () => {
    const actor = await getActor();
    const g = await gate(actor.companyAccess?.operationalProfileId === 'consultant-approver' ? 'approve' : 'update'); if (!g.ok) return g;
    if (!canRecordQualitySignOff(g.actor)) return { ok: false, error: 'A project manager, quality inspector or consultant must review this clash.' };
    const issue = scopedMutableGet(g.actor, 'reports_analytics', db.constructionIssues, id, 'update');
    const project = issue && scopedConstructionProjectGet(g.actor, issue.projectId, 'update');
    if (!issue || !project || !rfiPackageAllowed(g.actor, project, issue.workPackageId) || issue.category !== 'Design clash') return { ok: false, error: 'Design conflict not found.' };
    if (issue.status === 'resolved') return { ok: false, error: 'Closed conflicts cannot be reviewed again without reopening.' };
    const note = rationale.trim(), evidence = evidenceReference.trim();
    if (!['confirmed', 'false_positive', 'accepted_tolerance', 'needs_redesign'].includes(disposition) || note.length < 12 || note.length > 1000 || evidence.length < 3 || evidence.length > 500) return { ok: false, error: 'Choose a decision and record a rationale and verifiable evidence reference.' };
    const identity = nativeAuthEnabled() ? await getCompanyPrincipal() : null;
    issue.clashReview = { disposition, rationale: note, evidenceReference: evidence, reviewerId: g.actor.userId, reviewerName: identity?.user.name ?? g.actor.userId, reviewedAtISO: operatingNowISO() };
    audit(g.actor, { action: 'approve', entity: 'construction_issue', entityRef: id, projectId: issue.projectId, summary: `Engineering review: ${disposition} · ${issue.title}`, note: `${note} · ${evidence}` });
    revalidate(); return { ok: true, ref: id };
  }, 'construction');
}

/* --- projects ------------------------------------------------------------- */
export type ProjectInput = { name: string; location: string; clientName: string; contractNaira: number; budgetNaira: number; plannedFinishISO: string; projectType: ConstructionProjectType; region: string };
export async function createProject(input: ProjectInput): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  if (!input.name?.trim()) return { ok: false, error: 'Enter a project name.' };
  const cohort = z.object({ projectType: z.enum(CONSTRUCTION_PROJECT_TYPES), region: z.string().trim().min(2).max(80) }).safeParse(input);
  if (!cohort.success) return { ok: false, error: 'Choose a project type and enter a state or region for forecast evaluation.' };
  if (!Number.isFinite(input.contractNaira) || !safeMinor(Math.round(input.contractNaira * 100)) || !Number.isFinite(input.budgetNaira) || !safeMinor(Math.round(input.budgetNaira * 100))) return { ok: false, error: 'Enter finite, non-negative NGN contract and budget amounts.' };
  if (input.plannedFinishISO && (!validDate(input.plannedFinishISO) || input.plannedFinishISO < operatingDateISO())) return { ok: false, error: 'Choose a valid planned finish on or after the project start.' };
  const projSeq = nextRecordSequence('construction:projSeq', 0, true);
  const id = `cp-new-${projSeq}`;
  db.constructionProjects.unshift({ tenantId: g.actor.tenantId, id, projectId: id, code: `NEW-${projSeq}`, name: input.name.trim(), location: input.location.trim() || 'Lagos', clientName: input.clientName.trim() || 'Not recorded', projectType: cohort.data.projectType, region: cohort.data.region, pmName: nameOf(g.actor), status: 'planning', contractValue: money(Math.round((input.contractNaira || 0) * 100)), approvedBudget: money(Math.round((input.budgetNaira || 0) * 100)), startISO: operatingDateISO(), plannedFinishISO: input.plannedFinishISO || daysISO(operatingDateISO(), 540), plannedPercent: 0, percentComplete: 0 } as (typeof db.constructionProjects)[number]);
  revalidate(); return { ok: true, ref: input.name.trim() };

  }, 'construction');
}

export async function updateProjectDetails(id: string, input: { name: string; location: string; clientName: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ name: z.string().trim().min(2).max(120), location: z.string().trim().min(2).max(200), clientName: z.string().trim().min(2).max(120) }).strict().safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Enter a project name, location and client within the stated limits.' };
    const project = scopedConstructionProjectGet(g.actor, id, 'update');
    if (!project) return { ok: false, error: 'Project not found.' };
    if (project.status === 'completed' || project.status === 'closing') return { ok: false, error: 'Closed projects retain their recorded details.' };
    const before = JSON.stringify({ name: project.name, location: project.location, clientName: project.clientName });
    Object.assign(project, parsed.data);
    audit(g.actor, { action: 'override', entity: 'project_details', entityRef: project.code, projectId: project.id, summary: 'Updated project identity details', before, after: JSON.stringify(parsed.data) });
    revalidate(); return { ok: true, ref: project.name };
  }, 'construction');
}

/** Cohort metadata may be corrected after closeout; the audited change never alters
 * the recorded forecast, outcome, programme or financial ledger. */
export async function classifyProjectForForecast(id: string, input: { projectType: ConstructionProjectType; region: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ projectType: z.enum(CONSTRUCTION_PROJECT_TYPES), region: z.string().trim().min(2).max(80) }).strict().safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Choose a project type and enter a state or region.' };
    const project = scopedConstructionProjectGet(g.actor, id, 'update');
    if (!project) return { ok: false, error: 'Project not found.' };
    const before = JSON.stringify({ projectType: project.projectType ?? null, region: project.region ?? null });
    Object.assign(project, parsed.data);
    audit(g.actor, { action: 'override', entity: 'project_forecast_cohort', entityRef: project.code, projectId: project.id,
      summary: 'Updated project forecast cohort', before, after: JSON.stringify(parsed.data) });
    revalidate(); return { ok: true, ref: project.name };
  }, 'construction');
}

const calendarSchema = z.object({
  name: z.string().trim().min(2).max(80),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  hoursPerDay: z.number().min(1).max(24),
  timeZone: z.string().trim().min(2).max(80),
  holidays: z.array(z.string().refine(validDate)).max(100),
}).strict();

function mobilisationOf(project: (typeof db.constructionProjects)[number]): ProjectMobilisation {
  if (!project.mobilisation) project.mobilisation = {
    calendar: { name: 'Nigeria standard working week', workingDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8, timeZone: 'Africa/Lagos', holidays: [] },
    baselines: [], team: [], workPackages: [], locations: [], parties: [], lifecycle: [],
  };
  return project.mobilisation;
}

export async function saveProjectCalendar(projectId: string, input: z.input<typeof calendarSchema>): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = calendarSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Review the calendar name, working days, hours, time zone and holiday dates.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    mobilisationOf(project).calendar = parsed.data;
    audit(g.actor, { action: 'override', entity: 'project_calendar', entityRef: project.code, projectId, summary: `Updated programme calendar: ${parsed.data.name}` });
    revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

const phaseSchema = z.object({ id: z.string().optional(), projectId: z.string().min(1), name: z.string().trim().min(2).max(120), startISO: z.string().refine(validDate), finishISO: z.string().refine(validDate), weight: z.number().min(0).max(100) }).strict();
export async function saveProjectPhase(input: z.input<typeof phaseSchema>): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate(input.id ? 'update' : 'create'); if (!g.ok) return g;
    const parsed = phaseSchema.safeParse(input); if (!parsed.success || parsed.data.finishISO < parsed.data.startISO) return { ok: false, error: 'Enter a phase name, valid date range and weight from 0% to 100%.' };
    const project = scopedConstructionProjectGet(g.actor, parsed.data.projectId, input.id ? 'update' : 'create'); if (!project) return { ok: false, error: 'Project not found.' };
    if (input.id) {
      const phase = scopedMutableGet(g.actor, 'reports_analytics', db.constructionPhases, input.id, 'update');
      if (!phase || phase.projectId !== project.id) return { ok: false, error: 'Phase not found.' };
      Object.assign(phase, { name: parsed.data.name, startISO: parsed.data.startISO, finishISO: parsed.data.finishISO, weight: parsed.data.weight });
    } else {
      db.constructionPhases.push({ tenantId: g.actor.tenantId, id: `ph-${randomUUID()}`, projectId: project.id, name: parsed.data.name, order: db.constructionPhases.filter((row) => row.tenantId === g.actor.tenantId && row.projectId === project.id).length + 1, startISO: parsed.data.startISO, finishISO: parsed.data.finishISO, weight: parsed.data.weight, percentComplete: 0 } as (typeof db.constructionPhases)[number]);
    }
    audit(g.actor, { action: 'override', entity: 'wbs_phase', entityRef: project.code, projectId: project.id, summary: `${input.id ? 'Updated' : 'Created'} WBS phase ${parsed.data.name}` });
    revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

const taskSchema = z.object({ id: z.string().optional(), projectId: z.string().min(1), phaseId: z.string().min(1), name: z.string().trim().min(2).max(160), owner: z.string().trim().min(2).max(120), plannedStartISO: z.string().refine(validDate), plannedFinishISO: z.string().refine(validDate), priority: z.enum(['low', 'medium', 'high']), dependsOn: z.array(z.string()).max(50), dependencyLags: z.record(z.string(), z.number().int().min(0).max(120)).optional(), budgetNaira: z.number().min(0) }).strict();
export async function saveProgrammeTask(input: z.input<typeof taskSchema>): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate(input.id ? 'update' : 'create'); if (!g.ok) return g;
    const parsed = taskSchema.safeParse(input); if (!parsed.success || parsed.data.plannedFinishISO < parsed.data.plannedStartISO || !safeMinor(Math.round(parsed.data.budgetNaira * 100))) return { ok: false, error: 'Review the task, owner, dates, priority, dependencies and budget.' };
    const project = scopedConstructionProjectGet(g.actor, parsed.data.projectId, input.id ? 'update' : 'create'); if (!project) return { ok: false, error: 'Project not found.' };
    const phase = db.constructionPhases.find((row) => row.tenantId === g.actor.tenantId && row.projectId === project.id && row.id === parsed.data.phaseId); if (!phase) return { ok: false, error: 'Choose a phase in this project.' };
    const allowedTasks = new Set(db.constructionTasks.filter((row) => row.tenantId === g.actor.tenantId && row.projectId === project.id && row.id !== input.id).map((row) => row.id));
    if (parsed.data.dependsOn.some((id) => !allowedTasks.has(id))) return { ok: false, error: 'Every predecessor must be another task in this project.' };
    if (Object.keys(parsed.data.dependencyLags ?? {}).some((id) => !parsed.data.dependsOn.includes(id))) return { ok: false, error: 'Dependency gaps must belong to selected predecessors.' };
    const projectTasks = db.constructionTasks.filter((row) => row.tenantId === g.actor.tenantId && row.projectId === project.id);
    if (parsed.data.dependsOn.some((id) => projectTasks.find((row) => row.id === id)!.plannedFinishISO >= parsed.data.plannedStartISO))
      return { ok: false, error: 'A task must start after each predecessor finishes.' };
    if (input.id && projectTasks.some((row) => row.id !== input.id && row.dependsOn.includes(input.id!) && row.plannedStartISO <= parsed.data.plannedFinishISO))
      return { ok: false, error: 'A successor must start after this task finishes.' };
    if (input.id) {
      const dependencies = new Map(projectTasks.map((row) => [row.id, row.id === input.id ? parsed.data.dependsOn : row.dependsOn]));
      const visiting = new Set<string>(); const visited = new Set<string>();
      const cyclic = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        if ((dependencies.get(id) ?? []).some(cyclic)) return true;
        visiting.delete(id); visited.add(id); return false;
      };
      if ([...dependencies.keys()].some(cyclic)) return { ok: false, error: 'Task dependencies cannot form a loop.' };
    }
    if (input.id) {
      const task = scopedConstructionTaskGet(g.actor, input.id, 'update'); if (!task || task.projectId !== project.id) return { ok: false, error: 'Task not found.' };
      Object.assign(task, { phaseId: phase.id, name: parsed.data.name, owner: parsed.data.owner, plannedStartISO: parsed.data.plannedStartISO, plannedFinishISO: parsed.data.plannedFinishISO, priority: parsed.data.priority, dependsOn: parsed.data.dependsOn, dependencyLags: parsed.data.dependencyLags, budget: money(Math.round(parsed.data.budgetNaira * 100)) });
    } else db.constructionTasks.push({ tenantId: g.actor.tenantId, id: `tk-${randomUUID()}`, projectId: project.id, phaseId: phase.id, name: parsed.data.name, owner: parsed.data.owner, plannedStartISO: parsed.data.plannedStartISO, plannedFinishISO: parsed.data.plannedFinishISO, percentComplete: 0, status: 'not_started', priority: parsed.data.priority, dependsOn: parsed.data.dependsOn, dependencyLags: parsed.data.dependencyLags, budget: money(Math.round(parsed.data.budgetNaira * 100)) } as (typeof db.constructionTasks)[number]);
    audit(g.actor, { action: 'override', entity: 'programme_task', entityRef: project.code, projectId: project.id, summary: `${input.id ? 'Updated' : 'Created'} programme task ${parsed.data.name}` });
    revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

/** Record a coded working-day delay in the live forecast, leaving the approved baseline untouched. */
export async function recordProgrammeDelay(taskId: string, input: { workingDays: number; reasonCodeId: string; note?: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ workingDays: z.number().int().min(0).max(120), reasonCodeId: z.string().min(1), note: z.string().trim().max(500).optional() }).strict().safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Enter a delay of 0–120 working days and a valid reason.' };
    const task = scopedConstructionTaskGet(g.actor, taskId, 'update'); if (!task) return { ok: false, error: 'Task not found.' };
    if ((task.status === 'done' || task.percentComplete >= 100) && parsed.data.workingDays > 0) return { ok: false, error: 'Completed tasks cannot receive a new forecast delay.' };
    const code = db.constructionReasonCodes.find((row) => row.tenantId === g.actor.tenantId && row.id === parsed.data.reasonCodeId && row.domain === 'delay' && row.active);
    if (!code) return { ok: false, error: 'Select an active delay reason for this company.' };
    if (code.requiresNote && !parsed.data.note) return { ok: false, error: 'This delay reason requires a note.' };
    const before = task.programmeDelay;
    task.programmeDelay = { ...parsed.data, recordedBy: nameOf(g.actor), recordedAtISO: operatingNowISO() };
    recordReason(g.actor, { domain: 'delay', codeId: code.id, subjectKind: 'programme_task', subjectRef: task.id, projectId: task.projectId, note: parsed.data.note, impactDays: parsed.data.workingDays - (before?.workingDays ?? 0) });
    audit(g.actor, { action: 'override', entity: 'programme_delay', entityRef: task.id, projectId: task.projectId, summary: `Recorded ${parsed.data.workingDays} working-day forecast impact for ${task.name}`, before: JSON.stringify(before ?? null), after: JSON.stringify(task.programmeDelay), reasonCodeId: code.id, note: parsed.data.note });
    revalidate(); return { ok: true, ref: task.name };
  }, 'construction');
}

const milestoneSchema = z.object({ id: z.string().optional(), projectId: z.string().min(1), name: z.string().trim().min(2).max(140), dueISO: z.string().refine(validDate) }).strict();
export async function saveProjectMilestone(input: z.input<typeof milestoneSchema>): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate(input.id ? 'update' : 'create'); if (!g.ok) return g;
    const parsed = milestoneSchema.safeParse(input); if (!parsed.success) return { ok: false, error: 'Enter a milestone name and valid due date.' };
    const project = scopedConstructionProjectGet(g.actor, parsed.data.projectId, input.id ? 'update' : 'create'); if (!project) return { ok: false, error: 'Project not found.' };
    if (input.id) { const row = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMilestones, input.id, 'update'); if (!row || row.projectId !== project.id) return { ok: false, error: 'Milestone not found.' }; Object.assign(row, { name: parsed.data.name, dueISO: parsed.data.dueISO }); }
    else db.constructionMilestones.push({ tenantId: g.actor.tenantId, id: `ms-${randomUUID()}`, projectId: project.id, name: parsed.data.name, dueISO: parsed.data.dueISO, status: 'pending' } as (typeof db.constructionMilestones)[number]);
    revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

export async function submitBaselineRevision(projectId: string, input: { name: string; reason: string; plannedFinishISO: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ name: z.string().trim().min(2).max(100), reason: z.string().trim().min(5).max(500), plannedFinishISO: z.string().refine(validDate) }).strict().safeParse(input); if (!parsed.success) return { ok: false, error: 'Enter a revision name, reason and valid forecast finish.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    if (parsed.data.plannedFinishISO <= project.startISO) return { ok: false, error: 'The baseline finish must be after the project starts.' };
    const scheduled = db.constructionTasks.filter((row) => row.tenantId === g.actor.tenantId && row.projectId === projectId);
    const networkFinish = programmeNetwork(scheduled, mobilisationOf(project).calendar).projectFinishISO;
    if (networkFinish && parsed.data.plannedFinishISO < networkFinish) return { ok: false, error: `The baseline must include the full working-day task network through ${networkFinish}.` };
    const setup = mobilisationOf(project); if (setup.baselines.some((row) => row.status === 'pending_approval')) return { ok: false, error: 'Decide the pending baseline before submitting another.' };
    const revision = `B${setup.baselines.length + 1}`;
    setup.baselines.push({ id: `bl-${randomUUID()}`, revision, name: parsed.data.name, reason: parsed.data.reason, plannedFinishISO: parsed.data.plannedFinishISO, includedApprovedChangeDays: project.approvedChangeDays ?? 0, status: 'pending_approval', submittedBy: nameOf(g.actor), submittedById: g.actor.userId, submittedISO: operatingNowISO() });
    audit(g.actor, { action: 'override', entity: 'programme_baseline', entityRef: revision, projectId, summary: `Submitted programme baseline ${revision} for independent approval` });
    revalidate(); return { ok: true, ref: revision };
  }, 'construction');
}

export async function decideBaselineRevision(projectId: string, baselineId: string, decision: 'approved' | 'rejected'): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    const setup = mobilisationOf(project); const baseline = setup.baselines.find((row) => row.id === baselineId); if (!baseline || baseline.status !== 'pending_approval') return { ok: false, error: 'Pending baseline revision not found.' };
    const approver = nameOf(g.actor); if (baseline.submittedById ? baseline.submittedById === g.actor.userId : baseline.submittedBy.toLowerCase() === approver.toLowerCase()) return { ok: false, error: 'A different authorised manager must approve this baseline revision.' };
    baseline.status = decision; baseline.approvedBy = approver; baseline.approvedById = g.actor.userId; baseline.approvedISO = operatingNowISO();
    if (decision === 'approved') { for (const row of setup.baselines) if (row.id !== baseline.id && row.status === 'approved') row.status = 'superseded'; project.plannedFinishISO = baseline.plannedFinishISO; project.approvedChangeDaysInBaseline = baseline.includedApprovedChangeDays ?? 0; }
    audit(g.actor, { action: decision === 'approved' ? 'approve' : 'reject', entity: 'programme_baseline', entityRef: baseline.revision, projectId, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} programme baseline ${baseline.revision}` });
    revalidate(); return { ok: true, ref: baseline.revision };
  }, 'construction');
}

export async function addProjectTeamMember(projectId: string, input: { name: string; organisation: string; role: string; responsibility: string; accountable: boolean; email?: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ name: z.string().trim().min(2).max(100), organisation: z.string().trim().min(2).max(120), role: z.string().trim().min(2).max(100), responsibility: z.string().trim().min(2).max(240), accountable: z.boolean(), email: z.string().trim().email().optional().or(z.literal('')) }).strict().safeParse(input); if (!parsed.success) return { ok: false, error: 'Review the team member, organisation, role, responsibility and email.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    mobilisationOf(project).team.push({ id: `tm-${randomUUID()}`, ...parsed.data, email: parsed.data.email || undefined }); revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

export async function addProjectLocation(projectId: string, input: { name: string; kind: 'site' | 'block' | 'floor' | 'zone'; parentId?: string; latitude?: number; longitude?: number }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(['site', 'block', 'floor', 'zone']), parentId: z.string().optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).strict().safeParse(input); if (!parsed.success) return { ok: false, error: 'Review the location hierarchy and geocoordinates.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    const setup = mobilisationOf(project); if (parsed.data.parentId && !setup.locations.some((row) => row.id === parsed.data.parentId)) return { ok: false, error: 'Choose a parent location in this project.' };
    setup.locations.push({ id: `loc-${randomUUID()}`, ...parsed.data }); revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

export async function addProjectParty(projectId: string, input: { name: string; kind: 'client' | 'consultant' | 'contractor' | 'authority'; discipline: string; contractPackage?: string; permitReference?: string; permitExpiryISO?: string }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const parsed = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['client', 'consultant', 'contractor', 'authority']), discipline: z.string().trim().min(2).max(100), contractPackage: z.string().trim().max(120).optional(), permitReference: z.string().trim().max(100).optional(), permitExpiryISO: z.string().refine(validDate).optional() }).strict().safeParse(input); if (!parsed.success) return { ok: false, error: 'Review the party, discipline, package and permit details.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    mobilisationOf(project).parties.push({ id: `party-${randomUUID()}`, ...parsed.data }); revalidate(); return { ok: true, ref: parsed.data.name };
  }, 'construction');
}

export async function createWorkPackage(projectId: string, input: { code: string; name: string; phaseId?: string; contractor?: string; manager?: string; budgetNaira: number }): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('create'); if (!g.ok) return g;
    const parsed = z.object({ code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(140), phaseId: z.string().optional(), contractor: z.string().trim().max(120).optional(), manager: z.string().trim().max(120).optional(), budgetNaira: z.number().min(0) }).strict().safeParse(input); if (!parsed.success || !safeMinor(Math.round(input.budgetNaira * 100))) return { ok: false, error: 'Review the package code, name, owner and NGN budget.' };
    const project = scopedConstructionProjectGet(g.actor, projectId, 'create'); if (!project) return { ok: false, error: 'Project not found.' };
    if (parsed.data.phaseId && !db.constructionPhases.some((row) => row.tenantId === g.actor.tenantId && row.projectId === projectId && row.id === parsed.data.phaseId)) return { ok: false, error: 'Choose a phase in this project.' };
    if (db.constructionCostCodes.some((row) => row.tenantId === g.actor.tenantId && row.projectId === projectId && row.code.toLowerCase() === parsed.data.code.toLowerCase())) return { ok: false, error: 'That package / cost code already exists.' };
    const id = `pkg-${randomUUID()}`; mobilisationOf(project).workPackages.push({ id, code: parsed.data.code, name: parsed.data.name, phaseId: parsed.data.phaseId, costCode: parsed.data.code, contractor: parsed.data.contractor, manager: parsed.data.manager, status: 'planned' });
    db.constructionCostCodes.push({ tenantId: g.actor.tenantId, id: `cc-${randomUUID()}`, projectId, code: parsed.data.code, name: parsed.data.name, category: 'Work package', budget: money(Math.round(parsed.data.budgetNaira * 100)), committed: money(0), actual: money(0), plannedPercent: 0, earnedPercent: 0 } as (typeof db.constructionCostCodes)[number]);
    audit(g.actor, { action: 'override', entity: 'work_package', entityRef: parsed.data.code, projectId, summary: `Created work package and BOQ cost code ${parsed.data.code}` }); revalidate(); return { ok: true, ref: parsed.data.code };
  }, 'construction');
}

export async function transitionProjectLifecycle(projectId: string, action: 'activate' | 'suspend' | 'reopen' | 'start_closeout' | 'complete', reason: string): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const project = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!project) return { ok: false, error: 'Project not found.' };
    if (reason.trim().length < 5) return { ok: false, error: 'Record a clear reason for this controlled project transition.' };
    const allowed: Record<typeof action, ProjectStatus[]> = { activate: ['planning'], suspend: ['planning', 'active'], reopen: ['on_hold', 'closing', 'completed'], start_closeout: ['active'], complete: ['closing'] };
    if (!allowed[action].includes(project.status)) return { ok: false, error: `This project cannot ${action.replaceAll('_', ' ')} from ${project.status.replaceAll('_', ' ')}.` };
    if (action === 'complete') {
      const unfinished = db.constructionTasks.some((row) => row.tenantId === g.actor.tenantId && row.projectId === projectId && row.status !== 'done');
      const unaccepted = db.constructionMilestones.some((row) => row.tenantId === g.actor.tenantId && row.projectId === projectId && row.status !== 'accepted');
      if (unfinished || unaccepted) return { ok: false, error: 'Complete every task and accept every milestone before project completion.' };
    }
    const next: Record<typeof action, ProjectStatus> = { activate: 'active', suspend: 'on_hold', reopen: 'active', start_closeout: 'closing', complete: 'completed' };
    const before = project.status; project.status = next[action]; mobilisationOf(project).lifecycle.push({ atISO: operatingNowISO(), by: nameOf(g.actor), action, reason: reason.trim() });
    audit(g.actor, { action: 'override', entity: 'project_lifecycle', entityRef: project.code, projectId, summary: `${before.replaceAll('_', ' ')} → ${project.status.replaceAll('_', ' ')}: ${reason.trim()}` }); revalidate(); return { ok: true, ref: project.status };
  }, 'construction');
}

/* --- workforce ------------------------------------------------------------ */
export async function clockWorker(workerId: string, projectId: string, present: boolean): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const worker = scopedMutableGet(g.actor, 'reports_analytics', db.constructionWorkers, workerId, 'update');
  if (!worker || !scopedConstructionProjectGet(g.actor, projectId, 'update') || worker.projectId !== projectId) return { ok: false, error: 'Worker and project assignment not found.' };
  const today = operatingDateISO();
  const existing = db.constructionAttendance.find((a) => a.tenantId === g.actor.tenantId && a.projectId === projectId && a.workerId === workerId && a.dateISO === today);
  if (existing && ['gps', 'qr'].includes(existing.method)) return { ok: false, error: 'Manual attendance cannot replace recorded GPS or QR evidence. Review the source attendance record.' };
  if (existing) { existing.status = present ? 'present' : 'absent'; existing.clockIn = present ? '07:30' : undefined; existing.method = 'manual'; existing.withinGeofence = false; }
  else db.constructionAttendance.unshift({ tenantId: g.actor.tenantId, id: `at-new-${workerId}`, workerId, projectId, dateISO: today, clockIn: present ? '07:30' : undefined, hours: 0, overtime: 0, method: 'manual', withinGeofence: false, status: present ? 'present' : 'absent' } as (typeof db.constructionAttendance)[number]);
  revalidate(); return { ok: true };

  }, 'construction');
}

/* --- digest --------------------------------------------------------------- */
export async function publishDigest(projectId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const p = scopedConstructionProjectGet(g.actor, projectId, 'update'); if (!p) return { ok: false, error: 'Project not found.' };
  revalidate(); return { ok: true, ref: p.name };

  }, 'construction');
}

/* --- document revision control -------------------------------------------- */

/** Issue a new revision over an existing one. The prior revision is marked
 *  superseded rather than edited — an approved issue is immutable, which is the
 *  whole point of a controlled register (PRD §12 "Prevent approved revisions
 *  from being overwritten"). */
export async function issueRevision(docId: string, changeNote: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  const prior = scopedMutableGet(g.actor, 'reports_analytics', db.constructionDocs, docId, 'update');
  if (!prior || !constructionDrawingEditable(g.actor, prior)) return { ok: false, error: 'Document not found.' };
  if (prior.status === 'superseded') return { ok: false, error: 'That revision is already superseded — issue from the current one.' };
  if (prior.status === 'approved' && !changeNote.trim()) return { ok: false, error: 'A change note is required when superseding an approved revision.' };

  const revision = nextRevision(prior.revision);
  if (db.constructionDocs.some((doc) => doc.tenantId === prior.tenantId && doc.projectId === prior.projectId && doc.number === prior.number && doc.revision === revision)) return { ok: false, error: `Revision ${revision} already exists. Review that revision before issuing another.` };
  const id = `doc-rev-${nextRecordSequence('construction:revSeq', 0, true)}`;
  db.constructionDocs.unshift({
    ...prior, id, revision, status: 'draft',
    effectiveISO: operatingDateISO(), changeNote: changeNote.trim() || undefined,
    uploadedBy: nameOf(g.actor), approvedBy: undefined, approvedISO: undefined,
    supersedesId: prior.id, supersededById: undefined,
    fileId: undefined, fileName: undefined, fileSizeBytes: undefined, fileSha256: undefined, fileSizeKb: undefined,
    requiresFile: true,
  } as (typeof db.constructionDocs)[number]);
  // The prior revision is NOT retired yet. A drawing under revision must keep
  // its approved issue current — the site has to have something to build to
  // until the replacement is itself approved. `approveRevision` does the swap.
  revalidate();
  return { ok: true, ref: `${prior.number} rev ${revision}` };

  }, 'construction');
}

export async function approveRevision(docId: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const doc = scopedMutableGet(g.actor, 'reports_analytics', db.constructionDocs, docId, 'update');
  if (!doc || !constructionDrawingEditable(g.actor, doc)) return { ok: false, error: 'Document not found.' };
  if (doc.status === 'approved') return { ok: false, error: 'Already approved.' };
  if (doc.status === 'superseded') return { ok: false, error: 'A superseded revision cannot be approved.' };
  if (doc.requiresFile && !doc.fileId) return { ok: false, error: 'Attach the drawing PDF before approving this revision.' };
  if (db.constructionDocs.some((other) => other.tenantId === doc.tenantId && other.projectId === doc.projectId && other.number === doc.number && other.revision === doc.revision && other.id !== doc.id && other.status === 'approved')) return { ok: false, error: 'This revision label already has an approved issue. Review the duplicate record instead.' };
  // Exactly one approved revision per document number.
  for (const other of db.constructionDocs) {
    if (other.tenantId === doc.tenantId && other.projectId === doc.projectId && other.number === doc.number && other.id !== doc.id && other.status === 'approved') {
      other.status = 'superseded';
      other.supersededById = doc.id;
    }
  }
  doc.status = 'approved'; doc.approvedBy = nameOf(g.actor); doc.approvedISO = operatingDateISO();
  audit(g.actor, { action: 'approve', entity: 'construction_drawing', entityRef: doc.id, projectId: doc.projectId, summary: `Approved ${doc.number} rev ${doc.revision}`, note: doc.fileSha256 ? `PDF SHA-256 ${doc.fileSha256}` : 'Legacy revision without a stored PDF' });
  revalidate();
  return { ok: true, ref: `${doc.number} rev ${doc.revision}` };

  }, 'construction');
}

/** Formally issue a revision to a party — the distribution record an audit asks for. */
export async function sendTransmittal(docId: string, toParty: string, purpose: 'for_construction' | 'for_review' | 'for_information'): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  const doc = scopedMutableGet(g.actor, 'reports_analytics', db.constructionDocs, docId, 'update');
  if (!doc || !constructionDrawingEditable(g.actor, doc)) return { ok: false, error: 'Document not found.' };
  if (!toParty.trim()) return { ok: false, error: 'Name the party being issued to.' };
  if (doc.status !== 'approved' && purpose === 'for_construction') {
    return { ok: false, error: 'Only an approved revision can be issued for construction.' };
  }
  if (purpose === 'for_construction' && !doc.fileId) return { ok: false, error: 'Attach the approved drawing PDF before issuing it for construction.' };
  db.constructionTransmittals.unshift({
    tenantId: g.actor.tenantId, id: `tr-new-${nextRecordSequence('construction:trSeq', 0, true)}`, docId, docNumber: doc.number,
    revision: doc.revision, toParty: toParty.trim(), sentISO: operatingDateISO(), purpose,
  } as unknown as (typeof db.constructionTransmittals)[number]);
  revalidate();
  return { ok: true, ref: `${doc.number} rev ${doc.revision} → ${toParty.trim()}` };

  }, 'construction');
}

const rfiInput = z.object({
  projectId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(3).max(150),
  question: z.string().trim().min(10).max(3000),
  discipline: z.string().trim().min(2).max(80),
  dueISO: z.string().refine(validDate),
  responderUserId: z.string().trim().max(100).optional(),
  drawingDocId: z.string().trim().max(200).optional(),
  workPackageId: z.string().trim().max(200).optional(),
}).strict();
export type RfiInput = z.infer<typeof rfiInput>;

async function rfiMembers(actor: Actor, projectId: string) {
  if (!nativeAuthEnabled()) return [{ userId: actor.userId, name: nameOf(actor), canRespond: true, packageIds: [], profileId: null }];
  const principal = await getCompanyPrincipal();
  return principal?.company.id === actor.tenantId ? rfiProjectMembers(principal, projectId) : [];
}
function rfiMemberForPackage(member: { packageIds: string[]; profileId: string | null }, projectId: string, packageId?: string): boolean {
  if ((member.profileId === 'site-engineer' || member.profileId === 'subcontractor') && !member.packageIds.length) return false;
  if (!member.packageIds.length) return true;
  if (!packageId) return false;
  const project = db.constructionProjects.find((item) => item.id === projectId);
  const pack = project?.mobilisation?.workPackages.find((item) => item.id === packageId);
  return member.packageIds.includes(packageId) || Boolean(pack?.costCode && member.packageIds.includes(`${projectId}:${pack.costCode}`));
}
function rfiDrawing(actor: Actor, projectId: string, docId?: string) {
  if (!docId) return null;
  const doc = db.constructionDocs.find((item) => item.id === docId && item.tenantId === actor.tenantId && item.projectId === projectId);
  return doc?.status === 'approved' && doc.fileId && constructionDrawingVisible(actor, doc) ? doc : null;
}
function rfiRecord(actor: Actor, id: string, action: 'read' | 'update' | 'approve' = 'update') {
  const row = db.constructionRfis.find((item) => item.id === id && item.tenantId === actor.tenantId);
  return row && rfiInScope(actor, row, action) ? row : null;
}
function rfiEvent(actor: Actor, row: RFI, action: RFIActivity['action'], note?: string) {
  row.activity ??= [];
  row.activity.push({ atISO: operatingNowISO(), byUserId: actor.userId, by: nameOf(actor), action, ...(note ? { note } : {}) });
  audit(actor, { action: action === 'reviewed' ? 'approve' : action === 'closed' ? 'resolve' : 'record', entity: 'construction_rfi', entityRef: row.id, projectId: row.projectId, summary: `${row.ref} ${action}`, note });
}
function notifyRfi(userId: string, row: RFI, body: string) {
  pushNotification(userId, ['estate_manager'], { title: `${row.ref} · ${row.title ?? 'RFI'}`, body, kind: 'info', href: `/construction/documents?projectId=${encodeURIComponent(row.projectId)}&tab=rfis` });
}
function nextRfiRef(actor: Actor): string {
  const number = Math.max(0, ...db.constructionRfis.filter((row) => row.tenantId === actor.tenantId).map((row) => Number(/^RFI-(\d+)$/i.exec(row.ref)?.[1] ?? 0))) + 1;
  return `RFI-${String(number).padStart(4, '0')}`;
}

export async function createRfi(input: RfiInput, submit = false): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('create'); if (!g.ok) return g;
    const parsed = rfiInput.safeParse(input);
    if (!parsed.success || parsed.data.dueISO < operatingDateISO()) return { ok: false, error: 'Enter a title, clear question, discipline and a valid future due date.' };
    const data = parsed.data;
    const project = scopedConstructionProjectGet(g.actor, data.projectId, 'create');
    if (!project || !rfiPackageAllowed(g.actor, project, data.workPackageId)) return { ok: false, error: 'Project or work package unavailable.' };
    const drawing = rfiDrawing(g.actor, project.id, data.drawingDocId);
    if (data.drawingDocId && !drawing) return { ok: false, error: 'Choose an approved PDF revision from this project.' };
    const members = await rfiMembers(g.actor, project.id);
    const responder = members.find((member) => member.userId === data.responderUserId && member.canRespond && rfiMemberForPackage(member, project.id, data.workPackageId));
    if (data.responderUserId && !responder || submit && !responder) return { ok: false, error: 'Choose an active Construction member assigned to this project as responder.' };
    const row: RFI = {
      tenantId: g.actor.tenantId! as RFI['tenantId'], id: `rfi-${randomUUID()}`, ref: nextRfiRef(g.actor), projectId: project.id,
      title: data.title, question: data.question, discipline: data.discipline, dueISO: data.dueISO,
      raisedBy: nameOf(g.actor), creatorUserId: g.actor.userId, raisedISO: operatingDateISO(),
      assignedTo: responder?.name ?? '', responderUserId: responder?.userId,
      drawingRef: drawing ? `${drawing.number} rev ${drawing.revision}` : undefined,
      drawingDocId: drawing?.id, drawingFileId: drawing?.fileId, workPackageId: data.workPackageId || undefined,
      status: submit ? 'submitted' : 'draft', submittedISO: submit ? operatingNowISO() : undefined,
    };
    db.constructionRfis.unshift(row);
    rfiEvent(g.actor, row, 'created');
    if (submit) { rfiEvent(g.actor, row, 'submitted'); if (responder?.userId !== g.actor.userId) notifyRfi(responder!.userId, row, 'You have been assigned to answer this RFI.'); }
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction', 'create');
}

export async function saveRfiDraft(id: string, input: RfiInput): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const row = rfiRecord(g.actor, id); if (!row || row.status !== 'draft') return { ok: false, error: 'Draft RFI unavailable.' };
    if (row.creatorUserId && row.creatorUserId !== g.actor.userId && !rfiManager(g.actor)) return { ok: false, error: 'Only the creator or project manager can edit this draft.' };
    const parsed = rfiInput.safeParse(input);
    if (!parsed.success || parsed.data.dueISO < operatingDateISO() || parsed.data.projectId !== row.projectId) return { ok: false, error: 'Review the draft details and due date.' };
    const data = parsed.data;
    const project = scopedConstructionProjectGet(g.actor, row.projectId, 'update');
    if (!project || !rfiPackageAllowed(g.actor, project, data.workPackageId)) return { ok: false, error: 'Work package unavailable.' };
    const drawing = rfiDrawing(g.actor, project.id, data.drawingDocId);
    if (data.drawingDocId && !drawing) return { ok: false, error: 'Choose an approved PDF revision from this project.' };
    const responder = (await rfiMembers(g.actor, project.id)).find((member) => member.userId === data.responderUserId && member.canRespond && rfiMemberForPackage(member, project.id, data.workPackageId));
    if (data.responderUserId && !responder) return { ok: false, error: 'Choose an active project responder.' };
    Object.assign(row, { title: data.title, question: data.question, discipline: data.discipline, dueISO: data.dueISO,
      assignedTo: responder?.name ?? '', responderUserId: responder?.userId,
      drawingRef: drawing ? `${drawing.number} rev ${drawing.revision}` : undefined, drawingDocId: drawing?.id, drawingFileId: drawing?.fileId,
      workPackageId: data.workPackageId || undefined });
    rfiEvent(g.actor, row, 'updated', 'Draft updated'); revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

export async function submitRfi(id: string): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const row = rfiRecord(g.actor, id); if (!row || row.status !== 'draft') return { ok: false, error: 'Only a draft RFI can be submitted.' };
    if (row.creatorUserId && row.creatorUserId !== g.actor.userId && !rfiManager(g.actor)) return { ok: false, error: 'Only the creator or project manager can submit this draft.' };
    const responder = (await rfiMembers(g.actor, row.projectId)).find((member) => member.userId === row.responderUserId && member.canRespond && rfiMemberForPackage(member, row.projectId, row.workPackageId));
    if (!responder || !row.title || !row.question || !validDate(row.dueISO) || row.dueISO < operatingDateISO()) return { ok: false, error: 'Complete the question, due date and active project responder before submitting.' };
    row.status = 'submitted'; row.submittedISO = operatingNowISO(); row.assignedTo = responder.name;
    rfiEvent(g.actor, row, 'submitted'); if (responder.userId !== g.actor.userId) notifyRfi(responder.userId, row, 'You have been assigned to answer this RFI.');
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

export async function assignRfiResponder(id: string, responderUserId: string): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    if (!z.string().trim().min(1).max(100).safeParse(responderUserId).success) return { ok: false, error: 'Choose a valid project responder.' };
    const row = rfiRecord(g.actor, id); if (!row || !rfiManager(g.actor) || !['submitted', 'open'].includes(row.status)) return { ok: false, error: 'Only a project manager can reassign an awaiting RFI.' };
    const responder = (await rfiMembers(g.actor, row.projectId)).find((member) => member.userId === responderUserId && member.canRespond && rfiMemberForPackage(member, row.projectId, row.workPackageId));
    if (!responder) return { ok: false, error: 'Choose an active Construction member assigned to this project.' };
    row.responderUserId = responder.userId; row.assignedTo = responder.name;
    rfiEvent(g.actor, row, 'assigned', `Responder: ${responder.name}`); if (responder.userId !== g.actor.userId) notifyRfi(responder.userId, row, 'This RFI has been assigned to you.');
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

export async function answerRfi(rfiId: string, answer: string, responseDrawingDocId?: string): Promise<Res> {
  return withDurableMutation(async () => {
    const parsed = z.object({ answer: z.string().trim().min(1).max(5000), responseDrawingDocId: z.string().trim().max(200).optional() }).strict().safeParse({ answer, responseDrawingDocId });
    if (!parsed.success) return { ok: false, error: 'Enter a technical answer of at most 5,000 characters.' };
    let g = await gate('update'); if (!g.ok) g = await gate('approve'); if (!g.ok) return g;
    const action = g.actor.companyAccess?.operationalProfileId === 'consultant-approver' ? 'approve' : 'update';
    const row = rfiRecord(g.actor, rfiId, action); if (!row) return { ok: false, error: 'RFI not found.' };
    if (!['submitted', 'open'].includes(row.status)) return { ok: false, error: 'Only an awaiting RFI can be answered.' };
    if (row.responderUserId ? row.responderUserId !== g.actor.userId : !rfiManager(g.actor)) return { ok: false, error: 'Only the assigned responder can answer this RFI.' };
    const drawing = rfiDrawing(g.actor, row.projectId, parsed.data.responseDrawingDocId);
    if (parsed.data.responseDrawingDocId && !drawing) return { ok: false, error: 'Choose an approved response drawing from this project.' };
    row.answer = parsed.data.answer; row.answeredISO = operatingNowISO(); row.answerByUserId = g.actor.userId;
    row.responseDrawingDocId = drawing?.id; row.responseDrawingFileId = drawing?.fileId;
    row.responses ??= []; row.responses.push({ atISO: row.answeredISO, byUserId: g.actor.userId, text: row.answer, drawingDocId: drawing?.id, drawingFileId: drawing?.fileId });
    row.status = 'answered'; rfiEvent(g.actor, row, 'answered');
    if (row.creatorUserId && row.creatorUserId !== g.actor.userId) notifyRfi(row.creatorUserId, row, 'A technical answer is ready for review.');
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

export async function reviewRfiAnswer(id: string, decision: 'accept' | 'return', note = ''): Promise<Res> {
  return withDurableMutation(async () => {
    const parsed = z.object({ decision: z.enum(['accept', 'return']), note: z.string().trim().max(2000) }).strict().safeParse({ decision, note });
    if (!parsed.success || parsed.data.decision === 'return' && !parsed.data.note) return { ok: false, error: 'Give a return reason of at most 2,000 characters.' };
    const g = await gate('approve'); if (!g.ok) return g;
    const row = rfiRecord(g.actor, id, 'approve'); if (!row || row.status !== 'answered') return { ok: false, error: 'Only an answered RFI can be reviewed.' };
    if (!rfiManager(g.actor) && g.actor.companyAccess?.operationalProfileId !== 'consultant-approver') return { ok: false, error: 'Project review authority is required.' };
    if (nativeAuthEnabled() && row.answerByUserId === g.actor.userId) return { ok: false, error: 'The responder cannot approve their own answer. Assign a separate reviewer.' };
    if (parsed.data.decision === 'return') {
      row.status = 'submitted'; row.answer = undefined; row.answeredISO = undefined; row.answerByUserId = undefined;
      row.responseDrawingDocId = undefined; row.responseDrawingFileId = undefined;
      rfiEvent(g.actor, row, 'returned', parsed.data.note);
      if (row.responderUserId && row.responderUserId !== g.actor.userId) notifyRfi(row.responderUserId, row, 'The answer needs revision. Review the manager note.');
    } else {
      row.status = 'reviewed'; row.reviewedISO = operatingNowISO(); row.reviewedByUserId = g.actor.userId; row.reviewNote = parsed.data.note || undefined;
      rfiEvent(g.actor, row, 'reviewed', row.reviewNote);
    }
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction', 'approve');
}

export async function distributeRfi(id: string, recipientUserIds: string[], note = ''): Promise<Res> {
  return withDurableMutation(async () => {
    const parsed = z.object({ recipientUserIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50).refine((ids) => new Set(ids).size === ids.length), note: z.string().trim().max(2000) }).strict().safeParse({ recipientUserIds, note });
    if (!parsed.success) return { ok: false, error: 'Choose up to 50 unique recipients and a brief distribution note.' };
    const g = await gate('update'); if (!g.ok) return g;
    const row = rfiRecord(g.actor, id); if (!row || !rfiManager(g.actor) || row.status !== 'reviewed') return { ok: false, error: 'Only a reviewed RFI can be distributed by a project manager.' };
    const eligible = new Set((await rfiMembers(g.actor, row.projectId)).filter((member) => rfiMemberForPackage(member, row.projectId, row.workPackageId)).map((member) => member.userId));
    if (parsed.data.recipientUserIds.some((userId) => !eligible.has(userId))) return { ok: false, error: 'Recipients must be active members assigned to this project.' };
    row.status = 'distributed'; row.distributedISO = operatingNowISO(); row.distributionUserIds = [...parsed.data.recipientUserIds]; row.distributionNote = parsed.data.note || undefined;
    for (const userId of parsed.data.recipientUserIds) notifyRfi(userId, row, 'The reviewed official answer has been distributed to you in Propbrew.');
    rfiEvent(g.actor, row, 'distributed', `${parsed.data.recipientUserIds.length} project member(s)`);
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

export async function closeRfi(rfiId: string): Promise<Res> {
  return withDurableMutation(async () => {
    const g = await gate('update'); if (!g.ok) return g;
    const row = rfiRecord(g.actor, rfiId); if (!row || !rfiManager(g.actor) || row.status !== 'distributed') return { ok: false, error: 'Distribute the reviewed answer before closing this RFI.' };
    row.status = 'closed'; row.closedISO = operatingNowISO(); rfiEvent(g.actor, row, 'closed');
    revalidate(); return { ok: true, ref: row.ref };
  }, 'construction');
}

/* --- BOQ import ------------------------------------------------------------ */

export type BoqImportRow = { code: string; name: string; category: string; budgetMinor: number };

/** Commit a parsed BOQ. Existing codes have their BUDGET updated (committed and
 *  actual are untouched — those are transaction history, not a spreadsheet's to
 *  overwrite); new codes are created. */
export async function importBoq(projectId: string, rows: BoqImportRow[]): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  if (!scopedConstructionProjectGet(g.actor, projectId, 'create')) return { ok: false, error: 'Project not found.' };
  if (rows.length === 0) return { ok: false, error: 'Nothing to import.' };
  if (rows.length > 1000 || rows.some((row) => !row.code?.trim() || !row.name?.trim() || !safeMinor(row.budgetMinor)) || new Set(rows.map((row) => row.code)).size !== rows.length) return { ok: false, error: 'Import at most 1,000 unique cost codes with names and non-negative whole-kobo budgets.' };

  let created = 0, updated = 0;
  for (const r of rows) {
    const existing = repos.constructionCostCodes.list(g.actor, { limit: 500 }).items.find((c) => c.projectId === projectId && c.code === r.code);
    if (existing) {
      existing.budget = money(r.budgetMinor);
      existing.name = r.name;
      existing.category = r.category;
      updated += 1;
    } else {
      db.constructionCostCodes.push({
        tenantId: g.actor.tenantId, id: `cc-boq-${nextRecordSequence('construction:ccSeq', 0, true)}`, projectId,
        code: r.code, name: r.name, category: r.category,
        budget: money(r.budgetMinor), committed: money(0), actual: money(0),
        plannedPercent: 0, earnedPercent: 0,
      } as unknown as (typeof db.constructionCostCodes)[number]);
      created += 1;
    }
  }
  revalidate();
  return { ok: true, ref: `${created} created, ${updated} updated` };

  }, 'construction');
}

/* --- timesheets → earned value -------------------------------------------- */

export async function submitTimesheet(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const ts = scopedMutableGet(g.actor, 'reports_analytics', db.constructionTimesheets, id, 'update');
  if (!ts) return { ok: false, error: 'Timesheet not found.' };
  if (ts.status !== 'draft' && ts.status !== 'rejected') return { ok: false, error: 'Only a draft can be submitted.' };
  ts.status = 'submitted';
  revalidate();
  return { ok: true, ref: ts.ref };

  }, 'construction');
}

/**
 * Approve a timesheet and POST its labour cost to the cost code's actual — the
 * step that makes labour visible in earned value. `postedMinor` records what was
 * posted so a re-approval can never double-count.
 */
export async function approveTimesheet(id: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const ts = scopedMutableGet(g.actor, 'reports_analytics', db.constructionTimesheets, id, 'update');
  if (!ts) return { ok: false, error: 'Timesheet not found.' };
  if (ts.status === 'approved') return { ok: false, error: 'Already approved and posted.' };
  if (ts.status !== 'submitted') return { ok: false, error: 'Only a submitted timesheet can be approved.' };
  // Segregation of duties: you cannot approve the hours you booked yourself.
  if (ts.submittedBy.toLowerCase() === nameOf(g.actor).toLowerCase()) {
    return { ok: false, error: 'You submitted these hours — a different approver is required.' };
  }
  const worker = scopedMutableGet(g.actor, 'reports_analytics', db.constructionWorkers, ts.workerId, 'read');
  if (!worker || worker.projectId !== ts.projectId || ![ts.normalHours, ts.overtimeHours].every((hours) => Number.isFinite(hours) && hours >= 0) || ts.normalHours + ts.overtimeHours > 7 * 24) return { ok: false, error: 'Review the worker assignment and recorded weekly hours before posting.' };
  const costMinor = timesheetCostMinor(ts, worker.dayRate.minor);
  const code = repos.constructionCostCodes.list(g.actor, { limit: 500 }).items.find((c) => c.projectId === ts.projectId && c.code === ts.costCode);
  if (!code) return { ok: false, error: `Cost code ${ts.costCode} does not exist on this project.` };
  if (code.actual.currency !== worker.dayRate.currency || !safeMinor(costMinor) || !Number.isSafeInteger(code.actual.minor + costMinor)) return { ok: false, error: 'Labour currency and finite cost must match the project cost code.' };

  code.actual = addMinor(code.actual, costMinor);
  ts.status = 'approved'; ts.approvedBy = nameOf(g.actor); ts.approvedISO = operatingDateISO(); ts.postedMinor = costMinor;
  revalidate();
  return { ok: true, ref: `${ts.ref} · ₦${Math.round(costMinor / 100).toLocaleString('en-NG')} posted to ${ts.costCode}` };

  }, 'construction');
}

export async function rejectTimesheet(id: string, reason: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const ts = scopedMutableGet(g.actor, 'reports_analytics', db.constructionTimesheets, id, 'update');
  if (!ts) return { ok: false, error: 'Timesheet not found.' };
  if (ts.status === 'approved') return { ok: false, error: 'An approved timesheet is already posted — raise an adjustment instead.' };
  if (!reason.trim()) return { ok: false, error: 'A rejection reason is required.' };
  ts.status = 'rejected';
  revalidate();
  return { ok: true, ref: ts.ref };

  }, 'construction');
}

/* --- audit trail ----------------------------------------------------------- */

/** Append an immutable audit entry. Called by every sensitive action; nothing in
 *  the app ever updates or deletes one (PRD §18.3 / SC-10). */
function audit(actor: Actor, entry: {
  action: AuditAction;
  entity: string; entityRef: string; summary: string;
  projectId?: string; amountMinor?: number; before?: string; after?: string; reasonCodeId?: string; note?: string;
}): void {
  const seq = db.constructionAudit.length + 1;
  db.constructionAudit.push({
    tenantId: actor.tenantId, id: `au-${seq}-${Date.now().toString(36)}`, seq,
    atISO: new Date(Date.parse(operatingNowISO())).toISOString(),
    actorId: actor.userId, actorName: nameOf(actor), actorRole: actor.roles[0] ?? 'unknown',
    ...entry,
  } as unknown as (typeof db.constructionAudit)[number]);
}

/** Record a coded reason alongside whatever it explains. */
function recordReason(actor: Actor, e: {
  domain: 'rejection' | 'delay' | 'variance' | 'stock_adjust' | 'stock_return';
  codeId: string; subjectKind: string; subjectRef: string;
  projectId?: string; note?: string; impactMinor?: number; impactDays?: number;
}): void {
  db.constructionReasonEvents.push({
    tenantId: actor.tenantId, id: `re-${db.constructionReasonEvents.length + 1}-${Date.now().toString(36)}`,
    atISO: operatingDateISO(), by: nameOf(actor), ...e,
  } as unknown as (typeof db.constructionReasonEvents)[number]);
}

/* --- stock movements (the full set) ---------------------------------------- */

const onHandOf = (actor: Actor, materialId: string, warehouseId?: string) =>
  repos.constructionStock.list(actor, { limit: Number.MAX_SAFE_INTEGER }).items
    .filter((s) => s.materialId === materialId && (!warehouseId || s.warehouseId === warehouseId))
    .reduce((n, s) => n + s.onHand, 0);

function writeMovement(actor: Actor, kind: 'receipt' | 'issue' | 'transfer' | 'return' | 'adjust', materialId: string, qty: number, extra: { projectId?: string; costCode?: string; ref?: string } = {}): void {
  db.constructionMovements.unshift({
    tenantId: actor.tenantId, id: `mv-${kind}-${nextRecordSequence('construction:mvSeq', 0, true)}`, materialId, kind, qty,
    atISO: new Date(Date.parse(operatingNowISO())).toISOString(), by: nameOf(actor), ...extra,
  } as unknown as (typeof db.constructionMovements)[number]);
}

/** Move stock between stores. Never allowed to drive the source negative. */
export async function transferStock(materialId: string, fromWarehouseId: string, toWarehouseId: string, qty: number): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (fromWarehouseId === toWarehouseId) return { ok: false, error: 'Pick two different stores.' };
  if (!finiteQty(qty)) return { ok: false, error: 'Enter a finite quantity greater than zero.' };
  if (!scopedMutableGet(g.actor, 'reports_analytics', db.constructionWarehouses, fromWarehouseId, 'update') || !scopedMutableGet(g.actor, 'reports_analytics', db.constructionWarehouses, toWarehouseId, 'update')) return { ok: false, error: 'Store not found.' };
  const from = repos.constructionStock.list(g.actor, { limit: 1000 }).items.find((s) => s.materialId === materialId && s.warehouseId === fromWarehouseId);
  const mat = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMaterials, materialId, 'read');
  if (!from || !mat) return { ok: false, error: 'Stock line not found.' };
  if (!Number.isFinite(from.reserved) || from.reserved < 0 || qty > from.onHand - from.reserved) return { ok: false, error: `Only ${Math.max(0, from.onHand - from.reserved)} unreserved ${mat.unit} available for transfer. Reserved stock must stay in its source store.` };
  const check = movementAllowed('transfer', from.onHand, qty);
  if (!check.allowed) return { ok: false, error: check.reason! };

  from.onHand -= qty;
  const to = repos.constructionStock.list(g.actor, { limit: 1000 }).items.find((s) => s.materialId === materialId && s.warehouseId === toWarehouseId);
  if (to) to.onHand += qty;
  else db.constructionStock.push({ tenantId: g.actor.tenantId, id: `st-tr-${nextRecordSequence('construction:mvSeq', 0, true)}`, materialId, warehouseId: toWarehouseId, onHand: qty, reserved: 0, inTransit: 0 } as unknown as (typeof db.constructionStock)[number]);

  writeMovement(g.actor, 'transfer', materialId, qty, { ref: `${fromWarehouseId}→${toWarehouseId}` });
  audit(g.actor, { action: 'stock_move', entity: 'material', entityRef: mat.name, summary: `Transferred ${qty} ${mat.unit} between stores`, amountMinor: qty * mat.unitCost.minor });
  revalidate();
  return { ok: true, ref: `${qty} ${mat.unit} moved` };

  }, 'construction');
}

/** Surplus coming back from site — needs a coded reason so returns are analysable. */
export async function returnStock(materialId: string, warehouseId: string, qty: number, reasonCodeId: string, note?: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const mat = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMaterials, materialId, 'read');
  if (!mat) return { ok: false, error: 'Material not found.' };
  if (!finiteQty(qty)) return { ok: false, error: 'Quantity must be finite and greater than zero.' };
  if (!scopedMutableGet(g.actor, 'reports_analytics', db.constructionWarehouses, warehouseId, 'update')) return { ok: false, error: 'Store not found.' };
  const code = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReasonCodes, reasonCodeId, 'read');
  if (!code || !code.active || code.domain !== 'stock_return') return { ok: false, error: 'Choose an active stock-return reason.' };
  if (code.requiresNote && !note?.trim()) return { ok: false, error: `“${code.label}” needs a note.` };

  const line = repos.constructionStock.list(g.actor, { limit: 1000 }).items.find((s) => s.materialId === materialId && s.warehouseId === warehouseId);
  if (line) line.onHand += qty;
  else db.constructionStock.push({ tenantId: g.actor.tenantId, id: `st-rt-${nextRecordSequence('construction:mvSeq', 0, true)}`, materialId, warehouseId, onHand: qty, reserved: 0, inTransit: 0 } as unknown as (typeof db.constructionStock)[number]);

  writeMovement(g.actor, 'return', materialId, qty, { ref: code.code });
  recordReason(g.actor, { domain: 'stock_return', codeId: reasonCodeId, subjectKind: 'material', subjectRef: materialId, note, impactMinor: qty * mat.unitCost.minor });
  audit(g.actor, { action: 'stock_move', entity: 'material', entityRef: mat.name, summary: `${qty} ${mat.unit} returned to store — ${code.label}`, amountMinor: qty * mat.unitCost.minor, reasonCodeId, note });
  revalidate();
  return { ok: true, ref: `${qty} ${mat.unit} returned` };

  }, 'construction');
}

/** Record a physical count. The variance is NOT written to stock until it is
 *  reconciled with a reason — counting and adjusting are deliberately separate. */
export async function recordStockCount(materialId: string, warehouseId: string, countedQty: number): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  const mat = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMaterials, materialId, 'read');
  if (!mat) return { ok: false, error: 'Material not found.' };
  if (!Number.isFinite(countedQty) || countedQty < 0) return { ok: false, error: 'A count must be finite and cannot be negative.' };
  if (!scopedMutableGet(g.actor, 'reports_analytics', db.constructionWarehouses, warehouseId, 'create')) return { ok: false, error: 'Store not found.' };
  const systemQty = onHandOf(g.actor, materialId, warehouseId);
  const scSeq = nextRecordSequence('construction:scSeq', 0, true);
  const ref = `SC-${2040 + db.constructionStockCounts.length + (scSeq)}`;
  db.constructionStockCounts.unshift({
    tenantId: g.actor.tenantId!, id: `sc-${scSeq}`, ref, warehouseId, materialId,
    systemQty, countedQty, countedBy: nameOf(g.actor), countedISO: operatingDateISO(), status: 'open',
  });
  audit(g.actor, { action: 'stock_count', entity: 'material', entityRef: mat.name, summary: `Counted ${countedQty} vs ${systemQty} on system`, before: String(systemQty), after: String(countedQty) });
  revalidate();
  return { ok: true, ref };

  }, 'construction');
}

/** Apply a count's variance to stock, with a mandatory coded reason. This is the
 *  only path by which a count can change the books. */
export async function reconcileStockCount(countId: string, reasonCodeId: string, note?: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const count = scopedMutableGet(g.actor, 'reports_analytics', db.constructionStockCounts, countId, 'update');
  if (!count) return { ok: false, error: 'Count not found.' };
  if (count.status === 'reconciled') return { ok: false, error: 'Already reconciled.' };
  const code = scopedMutableGet(g.actor, 'reports_analytics', db.constructionReasonCodes, reasonCodeId, 'read');
  if (!code || !code.active || code.domain !== 'stock_adjust') return { ok: false, error: 'An active stock-adjustment reason is required to move stock.' };
  if (code.requiresNote && !note?.trim()) return { ok: false, error: `“${code.label}” needs a note.` };

  const mat = scopedMutableGet(g.actor, 'reports_analytics', db.constructionMaterials, count.materialId, 'read');
  if (!mat || !Number.isFinite(count.countedQty) || count.countedQty < 0 || !scopedMutableGet(g.actor, 'reports_analytics', db.constructionWarehouses, count.warehouseId, 'update')) return { ok: false, error: 'Review the counted quantity, material and store before reconciliation.' };
  const delta = count.countedQty - count.systemQty;
  const line = repos.constructionStock.list(g.actor, { limit: 1000 }).items.find((s) => s.materialId === count.materialId && s.warehouseId === count.warehouseId);
  const adjustedQty = (line?.onHand ?? 0) + delta;
  if (adjustedQty < 0) return { ok: false, error: 'Stock changed after this count; record a fresh count before reconciling.' };
  if (line) line.onHand = adjustedQty;
  else if (adjustedQty > 0) db.constructionStock.push({ tenantId: g.actor.tenantId, id: `st-sc-${nextRecordSequence('construction:mvSeq', 0, true)}`, materialId: count.materialId, warehouseId: count.warehouseId, onHand: adjustedQty, reserved: 0, inTransit: 0 } as unknown as (typeof db.constructionStock)[number]);

  if (delta !== 0) writeMovement(g.actor, 'adjust', count.materialId, delta, { ref: `${count.ref} · ${code.code}` });
  count.status = 'reconciled'; count.reasonCodeId = reasonCodeId; count.note = note; count.approvedBy = nameOf(g.actor);

  recordReason(g.actor, { domain: 'stock_adjust', codeId: reasonCodeId, subjectKind: 'material', subjectRef: count.materialId, note, impactMinor: Math.abs(delta) * (mat?.unitCost.minor ?? 0) });
  audit(g.actor, { action: 'stock_count', entity: 'material', entityRef: mat?.name ?? count.materialId, summary: `${count.ref} reconciled: ${delta >= 0 ? '+' : ''}${delta} ${mat?.unit ?? ''} — ${code.label}`, amountMinor: Math.abs(delta) * (mat?.unitCost.minor ?? 0), before: String(count.systemQty), after: String(count.countedQty), reasonCodeId, note });
  revalidate();
  return { ok: true, ref: `${count.ref} · ${delta >= 0 ? '+' : ''}${delta}` };

  }, 'construction');
}

/* --- approval workflow ------------------------------------------------------ */

/** Raise a request onto the route its value and category select. */
export async function raiseApproval(subject: 'purchase_request' | 'variation' | 'timesheet' | 'stock_adjust' | 'budget_override', subjectRef: string, title: string, projectId: string, amountMinor: number, category?: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('create'); if (!g.ok) return g;
  if (!safeMinor(amountMinor) || !title?.trim() || !subjectRef?.trim() || !scopedConstructionProjectGet(g.actor, projectId, 'create')) return { ok: false, error: 'Choose an authorised project and enter a title, reference and valid whole-kobo amount.' };
  const rule = routeFor(repos.constructionApprovalRules.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items, subject, amountMinor, category);
  if (!rule) return { ok: false, error: 'No approval route is configured for this.' };
  const aprSeq = nextRecordSequence('construction:aprSeq', 0, true);
  const ref = `APR-${1050 + db.constructionApprovals.length + (aprSeq)}`;
  db.constructionApprovals.unshift({
    tenantId: g.actor.tenantId, id: `apr-new-${aprSeq}`, ref, subject, subjectRef, title, projectId,
    amountMinor, raisedBy: nameOf(g.actor), raisedISO: new Date(Date.parse(operatingNowISO())).toISOString(),
    ruleId: rule.id, steps: stepsFromRule(rule), status: 'in_flight',
  } as unknown as (typeof db.constructionApprovals)[number]);
  audit(g.actor, { action: 'issue', entity: 'approval', entityRef: ref, projectId, summary: `Raised for approval on “${rule.name}”`, amountMinor });
  revalidate();
  return { ok: true, ref };

  }, 'construction');
}

/** Approve or reject the step this actor actually owns. Segregation of duties and
 *  the parallel-step rule are enforced in the engine, not the UI. */
export async function decideApproval(requestId: string, decision: 'approved' | 'rejected', comment?: string, reasonCodeId?: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (!['approved', 'rejected'].includes(decision)) return { ok: false, error: 'Choose approve or reject.' };
  const req = scopedMutableGet(g.actor, 'reports_analytics', db.constructionApprovals, requestId, 'update');
  if (!req) return { ok: false, error: 'Request not found.' };
  const idx = db.constructionApprovals.indexOf(req);
  const check = canApprove(req, g.actor.roles as string[], nameOf(g.actor));
  if (!check.allowed || !check.step) return { ok: false, error: check.reason ?? 'You cannot act on this step.' };
  if (decision === 'rejected') {
    const code = reasonCodeId ? scopedMutableGet(g.actor, 'reports_analytics', db.constructionReasonCodes, reasonCodeId, 'read') : null;
    if (!code || !code.active || code.domain !== 'rejection') return { ok: false, error: 'A rejection needs an active rejection reason.' };
    if (code.requiresNote && !comment?.trim()) return { ok: false, error: `“${code.label}” needs a note.` };
  }

  const next = applyDecision(req, check.step.order, check.step.role, decision, nameOf(g.actor), operatingDateISO(), comment);
  db.constructionApprovals[idx] = next as (typeof db.constructionApprovals)[number];

  if (decision === 'rejected' && reasonCodeId) {
    recordReason(g.actor, { domain: 'rejection', codeId: reasonCodeId, subjectKind: req.subject, subjectRef: req.subjectRef, projectId: req.projectId, note: comment, impactMinor: req.amountMinor });
  }
  audit(g.actor, {
    action: decision === 'approved' ? 'approve' : 'reject',
    entity: 'approval', entityRef: req.ref, projectId: req.projectId,
    summary: `${check.step.label} ${decision} — ${req.title}`,
    amountMinor: req.amountMinor, reasonCodeId, note: comment,
    before: 'in_flight', after: next.status,
  });
  revalidate();
  return { ok: true, ref: `${req.ref} · ${next.status === 'in_flight' ? 'advanced' : next.status}` };

  }, 'construction');
}

/** Hand a live step to a named person (PRD §15.3 delegation). */
export async function delegateApproval(requestId: string, toName: string): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  const req = scopedMutableGet(g.actor, 'reports_analytics', db.constructionApprovals, requestId, 'update');
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status !== 'in_flight') return { ok: false, error: 'This request is already resolved.' };
  if (!toName.trim()) return { ok: false, error: 'Name the delegate.' };
  const live = pendingSteps(req);
  if (live.length === 0) return { ok: false, error: 'Nothing pending to delegate.' };
  const mine = live.find((s) => (g.actor.roles as string[]).includes(s.role));
  if (!mine) return { ok: false, error: 'You can only delegate a step you hold.' };
  const step = req.steps.find((s) => s.order === mine.order && s.role === mine.role && s.status === 'pending');
  if (step) step.delegatedTo = toName.trim();
  audit(g.actor, { action: 'delegate', entity: 'approval', entityRef: req.ref, projectId: req.projectId, summary: `${mine.label} delegated to ${toName.trim()}`, amountMinor: req.amountMinor });
  revalidate();
  return { ok: true, ref: `${req.ref} → ${toName.trim()}` };

  }, 'construction');
}

/* --- FX revaluation -------------------------------------------------------- */

/**
 * Update the spot rate for a foreign currency. The change is a sensitive action:
 * it revalues every outstanding foreign commitment, so it writes an immutable
 * audit entry AND records a market-price variance event (VAR-PRICE) carrying the
 * NGN swing — which is why that cause shows up, weighted, in the reason Pareto.
 * The reporting currency (NGN) cannot be repriced against itself.
 */
export async function updateFxRate(currency: CurrencyCode, newRate: number): Promise<Res> {
  return withDurableMutation(async () => {
  const g = await gate('update'); if (!g.ok) return g;
  if (currency === 'NGN') return { ok: false, error: 'NGN is the reporting currency — it cannot be repriced.' };
  if (!finiteQty(newRate)) return { ok: false, error: 'Rate must be finite and greater than zero.' };
  const row = repos.constructionFxRates.list(g.actor, { limit: 50 }).items.find((r) => r.currency === currency);
  if (!row) return { ok: false, error: `No ${currency} rate on file.` };
  const oldRate = row.rate;
  if (newRate === oldRate) return { ok: false, error: 'That is already the current rate.' };

  // Revaluation swing = the outstanding foreign book × the rate move (NGN).
  const rows = fxExposure(repos.constructionOrders.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items, fxTable(repos.constructionFxRates.list(g.actor, { limit: Number.MAX_SAFE_INTEGER }).items)).filter((r) => r.currency === currency);
  const outstandingForeignMinor = rows.reduce((n, r) => n + r.outstandingForeignMinor, 0);
  const swingMinor = Math.round(outstandingForeignMinor * (newRate - oldRate));
  if (!Number.isSafeInteger(swingMinor)) return { ok: false, error: 'The revaluation is outside the supported monetary range.' };

  row.priorRate = oldRate;
  row.rate = newRate;
  row.asOfISO = operatingDateISO();

  const dir = newRate > oldRate ? 'weakened' : 'strengthened';
  audit(g.actor, {
    action: 'fx_revalue', entity: 'fx_rate', entityRef: currency,
    summary: `${currency} repriced ${oldRate} → ${newRate} — naira ${dir}; outstanding book revalued`,
    amountMinor: Math.abs(swingMinor), before: `₦${oldRate}/${currency}`, after: `₦${newRate}/${currency}`,
  });
  if (swingMinor !== 0) {
    const code = repos.constructionReasonCodes.list(g.actor, { limit: 100 }).items.find((c) => c.code === 'VAR-PRICE');
    if (code) recordReason(g.actor, {
      domain: 'variance', codeId: code.id, subjectKind: 'fx_rate', subjectRef: currency,
      note: `${currency} ${dir} ${oldRate}→${newRate}`, impactMinor: Math.abs(swingMinor),
    });
  }
  revalidate();
  return { ok: true, ref: `${currency} → ₦${newRate}` };

  }, 'construction');
}
