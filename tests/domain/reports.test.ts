import { describe, expect, it } from 'vitest';
import * as seed from '@/server/data/seed/fixtures';
import { METRICS, metricTrend, weeklyThroughput, breakdownCsv, type Dataset } from '@/domain/reports';
import type { WorkOrder, Invoice } from '@/domain/entities';

const A = seed.workOrders[0].tenantId;
const ds: Dataset = {
  workOrders: seed.workOrders.filter((w) => w.tenantId === A) as WorkOrder[],
  invoices: seed.invoices.filter((i) => i.tenantId === A) as Invoice[],
};

describe('metric catalogue', () => {
  it('every metric declares requirement ids and computes in range', () => {
    for (const m of METRICS) {
      expect(m.requirementIds.length).toBeGreaterThan(0);
      const v = m.value(ds);
      expect(v).toBeGreaterThanOrEqual(0);
      if (m.unit === 'percent') expect(v).toBeLessThanOrEqual(100);
      const bars = m.breakdown(ds, m.dims[0].id);
      expect(Array.isArray(bars)).toBe(true);
    }
  });

  it('open-wo breakdown by status sums to the open count', () => {
    const open = METRICS.find((m) => m.id === 'open_wo')!;
    const total = open.breakdown(ds, 'status').reduce((n, b) => n + b.value, 0);
    expect(total).toBe(open.value(ds));
  });
});

describe('trends', () => {
  it('throughput buckets are real and length-stable', () => {
    const t = weeklyThroughput(ds.workOrders, 10);
    expect(t).toHaveLength(10);
    expect(t.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
  it('metricTrend ends at the current value for modelled series', () => {
    const rate = METRICS.find((m) => m.id === 'collection_rate')!;
    const { points, real } = metricTrend(rate, ds);
    expect(real).toBe(false);
    expect(points[points.length - 1]).toBe(rate.value(ds));
  });
  it('uses the supplied reporting snapshot for SLA and weekly activity', () => {
    const asOfMs = Date.parse('2028-01-01T12:00:00Z');
    const workOrder = { ...ds.workOrders[0], status: 'new', createdAt: '2027-12-30T12:00:00Z', resolveDueAt: '2027-12-31T12:00:00Z' } as WorkOrder;
    const scoped: Dataset = { workOrders: [workOrder], invoices: [], asOfMs };
    expect(METRICS.find((metric) => metric.id === 'sla_breaches')!.value(scoped)).toBe(1);
    expect(weeklyThroughput(scoped.workOrders, 10, undefined, asOfMs).reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});

describe('csv export', () => {
  it('emits a header and one row per bar', () => {
    const m = METRICS[0];
    const bars = m.breakdown(ds, 'status');
    const csv = breakdownCsv(m, 'status', bars);
    expect(csv.split('\n').length).toBe(bars.length + 2);
  });
});
