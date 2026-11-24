/**
 * FM-07 / AI-S-02 — reporting metrics catalogue.
 *
 * A small, traceable set of metrics computed over the caller's already-scoped
 * rows. Each metric declares the §14 requirement ids it serves, the dimensions
 * it can break down by, and how to compute its scalar and breakdown. Throughput
 * trends are REAL (bucketed from work-order createdAt); other sparklines are
 * modelled from the current snapshot and labelled as indicative. No LLM.
 */

import type { WorkOrder, Invoice } from './entities';
import { NOW_MS } from './ppm';

export type Unit = 'count' | 'percent' | 'money';
export type Dataset = { workOrders: readonly WorkOrder[]; invoices: readonly Invoice[]; asOfMs?: number };
export type Dimension = { id: string; label: string };
export type Bar = { key: string; label: string; value: number };

const OPEN = (w: WorkOrder) => !['closed', 'cancelled', 'rejected', 'verified'].includes(w.status);
const PRIORITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const ORIGIN_LABEL: Record<string, string> = { resident_request: 'Resident request', manager: 'Manager', ppm_schedule: 'PPM schedule', failed_inspection: 'Failed inspection' };

function group(rows: readonly WorkOrder[], dim: string, weight: (w: WorkOrder) => number = () => 1): Bar[] {
  const m = new Map<string, number>();
  for (const w of rows) {
    const key = dim === 'origin' ? w.origin : dim === 'priority' ? w.priority : dim === 'estate' ? String(w.estateId) : w.status;
    m.set(key, (m.get(key) ?? 0) + weight(w));
  }
  return [...m.entries()]
    .map(([key, value]) => ({ key, value, label: dim === 'origin' ? ORIGIN_LABEL[key] ?? key : dim === 'priority' ? PRIORITY_LABEL[key] ?? key : key.replace(/_/g, ' ') }))
    .sort((a, b) => b.value - a.value);
}

const WO_DIMS: Dimension[] = [
  { id: 'status', label: 'Status' }, { id: 'origin', label: 'Origin' }, { id: 'priority', label: 'Priority' }, { id: 'estate', label: 'Estate' },
];

export type Metric = {
  id: string;
  label: string;
  unit: Unit;
  requirementIds: string[];
  dims: Dimension[];
  needsInvoices?: boolean;
  realTrend?: boolean;
  value: (ds: Dataset) => number;
  breakdown: (ds: Dataset, dim: string) => Bar[];
};

const breached = (w: WorkOrder, asOfMs: number) => OPEN(w) && w.resolveDueAt !== null && Date.parse(w.resolveDueAt) < asOfMs;

export const METRICS: Metric[] = [
  {
    id: 'open_wo', label: 'Open work orders', unit: 'count', requirementIds: ['FM-07', 'EM-03', '§10'], dims: WO_DIMS, realTrend: true,
    value: (ds) => ds.workOrders.filter(OPEN).length,
    breakdown: (ds, dim) => group(ds.workOrders.filter(OPEN), dim),
  },
  {
    id: 'ppm_share', label: 'Preventive share', unit: 'percent', requirementIds: ['FM-01', 'FM-07', 'AI-F-01'], dims: [{ id: 'origin', label: 'Origin' }],
    value: (ds) => {
      const prev = ds.workOrders.filter((w) => w.origin === 'ppm_schedule').length;
      const react = ds.workOrders.filter((w) => w.origin === 'resident_request').length;
      return prev + react ? Math.round((prev / (prev + react)) * 100) : 0;
    },
    breakdown: (ds, dim) => group(ds.workOrders, dim),
  },
  {
    id: 'sla_breaches', label: 'SLA breaches', unit: 'count', requirementIds: ['FM-05', 'FM-07'], dims: [{ id: 'priority', label: 'Priority' }, { id: 'estate', label: 'Estate' }],
    value: (ds) => ds.workOrders.filter((row) => breached(row, ds.asOfMs ?? NOW_MS)).length,
    breakdown: (ds, dim) => group(ds.workOrders.filter((row) => breached(row, ds.asOfMs ?? NOW_MS)), dim),
  },
  {
    id: 'spend', label: 'Maintenance spend', unit: 'money', requirementIds: ['FM-07', 'EM-01'], dims: WO_DIMS, realTrend: true,
    value: (ds) => ds.workOrders.reduce((n, w) => n + (w.cost?.minor ?? 0), 0),
    breakdown: (ds, dim) => group(ds.workOrders, dim, (w) => w.cost?.minor ?? 0).filter((b) => b.value > 0),
  },
  {
    id: 'collection_rate', label: 'Collection rate', unit: 'percent', requirementIds: ['EM-01', 'SC-02', 'AI-E-03'], dims: [{ id: 'status', label: 'Status' }, { id: 'estate', label: 'Estate' }], needsInvoices: true,
    value: (ds) => {
      const billed = ds.invoices.reduce((n, i) => n + i.amount.minor, 0);
      const paid = ds.invoices.reduce((n, i) => n + i.paid.minor, 0);
      return billed ? Math.round((paid / billed) * 100) : 0;
    },
    breakdown: (ds, dim) => invoiceGroup(ds.invoices, dim, (i) => i.paid.minor),
  },
  {
    id: 'outstanding', label: 'Outstanding', unit: 'money', requirementIds: ['EM-01', 'AI-E-03'], dims: [{ id: 'status', label: 'Status' }, { id: 'estate', label: 'Estate' }], needsInvoices: true,
    value: (ds) => ds.invoices.reduce((n, i) => n + (i.amount.minor - i.paid.minor), 0),
    breakdown: (ds, dim) => invoiceGroup(ds.invoices, dim, (i) => i.amount.minor - i.paid.minor).filter((b) => b.value > 0),
  },
];

function invoiceGroup(rows: readonly Invoice[], dim: string, weight: (i: Invoice) => number): Bar[] {
  const m = new Map<string, number>();
  for (const i of rows) {
    const key = dim === 'estate' ? String(i.estateId) : i.status;
    m.set(key, (m.get(key) ?? 0) + weight(i));
  }
  return [...m.entries()].map(([key, value]) => ({ key, value, label: key.replace(/_/g, ' ') })).sort((a, b) => b.value - a.value);
}

/* --- trends --------------------------------------------------------------- */

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Real weekly buckets of work-order creation ending at the supplied reporting snapshot. */
export function weeklyThroughput(workOrders: readonly WorkOrder[], weeks = 10, weight: (w: WorkOrder) => number = () => 1, asOfMs = NOW_MS): number[] {
  const out = new Array(weeks).fill(0);
  for (const w of workOrders) {
    const created = w.createdAt ? Date.parse(w.createdAt) : NaN;
    if (Number.isNaN(created)) continue;
    const idx = weeks - 1 - Math.floor((asOfMs - created) / WEEK_MS);
    if (idx >= 0 && idx < weeks) out[idx] += weight(w);
  }
  return out;
}

/** Deterministic modelled series ending at `value`, for metrics without a real
 *  time axis. Seeded by the metric id so it is stable across renders. */
export function modelledTrend(seed: string, value: number, points = 10): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const wobble = (((h >> (i % 16)) & 7) - 3.5) / 14; // ±0.25
    out.push(Math.max(0, value * (0.6 + 0.4 * t + wobble)));
  }
  out[points - 1] = value;
  return out;
}

export function metricTrend(metric: Metric, ds: Dataset): { points: number[]; real: boolean } {
  if (metric.realTrend) {
    const weight = metric.id === 'spend' ? (w: WorkOrder) => w.cost?.minor ?? 0 : undefined;
    return { points: weeklyThroughput(ds.workOrders, 10, weight, ds.asOfMs ?? NOW_MS), real: true };
  }
  return { points: modelledTrend(metric.id, metric.value(ds)), real: false };
}

/* --- export --------------------------------------------------------------- */

export function breakdownCsv(metric: Metric, dim: string, bars: Bar[]): string {
  const head = `${metric.label} by ${dim}`;
  const lines = bars.map((b) => `${b.label.replace(/,/g, ' ')},${b.value}`);
  return [`# ${head}`, `${dim},value`, ...lines].join('\n');
}
