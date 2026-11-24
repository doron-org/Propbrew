'use client';

import { useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Download, X } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, IconButton, KpiCard, StatusPill } from '@/components/ui';
import { METRICS, weeklyThroughput, breakdownCsv, type Dataset, type Metric, type Unit } from '@/domain/reports';
import type { CurrencyCode } from '@/domain/primitives';
import { NOW } from '@/domain/ppm';
import common from '@/components/ui/workspace-layout.module.css';
import styles from './reports-workspace.module.css';

const RANGES = [{ w: 6, label: '6 weeks' }, { w: 10, label: '10 weeks' }, { w: 12, label: '12 weeks' }];
export function reportValue(unit: Unit, value: number, currency: CurrencyCode = 'NGN'): string {
  if (unit === 'money') return new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value / 100);
  return unit === 'percent' ? `${value}%` : value.toLocaleString('en-NG');
}

/** Keep counts across the entire scope, but never add one currency to another. */
export function reportCurrencyDataset(dataset: Dataset, currency: CurrencyCode): Dataset {
  return { workOrders: dataset.workOrders.map((w) => w.cost && w.cost.currency !== currency ? { ...w, cost: null } : w), invoices: dataset.invoices.filter((i) => i.amount.currency === currency && i.paid.currency === currency), ...(dataset.asOfMs === undefined ? {} : { asOfMs: dataset.asOfMs }) };
}
type View = { name: string; metricId: string; dim: string; currency: CurrencyCode };

export function MetricsExplorer({ dataset, seesInvoices }: { dataset: Dataset; seesInvoices: boolean }) {
  const available = useMemo(() => METRICS.filter((m) => !m.needsInvoices || seesInvoices), [seesInvoices]);
  const currencies = useMemo(() => Array.from(new Set<CurrencyCode>([...dataset.workOrders.flatMap((w) => w.cost ? [w.cost.currency] : []), ...(seesInvoices ? dataset.invoices.map((i) => i.amount.currency) : [])])).sort(), [dataset, seesInvoices]);
  const [currency, setCurrency] = useState<CurrencyCode>(() => currencies.includes('NGN') ? 'NGN' : currencies[0] ?? 'NGN');
  const currencyDataset = useMemo(() => reportCurrencyDataset(dataset, currency), [dataset, currency]);
  const [metricId, setMetricId] = useState(available[0].id);
  const [dim, setDim] = useState(available[0].dims[0].id);
  const [weeks, setWeeks] = useState(10);
  const [views, setViews] = useState<View[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const metric = available.find((m) => m.id === metricId) ?? available[0];
  const activeDim = metric.dims.some((d) => d.id === dim) ? dim : metric.dims[0].id;
  const bars = metric.breakdown(currencyDataset, activeDim);
  const maxBar = Math.max(...bars.map((b) => b.value), 1);
  const breakdownUnit: Unit = metric.id === 'collection_rate' ? 'money' : metric.id === 'ppm_share' ? 'count' : metric.unit;
  const points = metric.realTrend ? weeklyThroughput(currencyDataset.workOrders, weeks, metric.id === 'spend' ? (w) => w.cost?.minor ?? 0 : undefined, currencyDataset.asOfMs ?? Date.parse(NOW)) : [];
  const snapshotDate = new Date(currencyDataset.asOfMs ?? Date.parse(NOW)).toISOString().slice(0, 10);
  const chartUnit: Unit = metric.id === 'spend' ? 'money' : 'count';

  function selectMetric(m: Metric) { setMetricId(m.id); if (!m.dims.some((d) => d.id === dim)) setDim(m.dims[0].id); }
  function saveView() {
    const name = `${metric.label} · ${activeDim} · ${currency}`;
    if (!views.some((v) => v.name === name)) setViews((p) => [{ name, metricId: metric.id, dim: activeDim, currency }, ...p]);
    setFeedback('View saved for this session. It will not persist after leaving or reloading this page.');
  }
  function exportCsv() {
    const label = metric.id === 'collection_rate' ? 'Collected payments' : metric.id === 'ppm_share' ? 'Work orders' : metric.label;
    const csv = breakdownCsv({ ...metric, label: `${label} (${breakdownUnit === 'money' ? `${currency} minor units` : breakdownUnit})` }, activeDim, bars);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${metric.id}-by-${activeDim}-${currency}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback('CSV prepared from this scoped breakdown. Monetary values are labelled in minor units; no currency conversion is applied.');
  }
  return <div className={common.layout}>
    <div className={common.context}><p className={common.metadata}>Recorded snapshot · {snapshotDate} · Native currency only, no FX conversion</p><label className={styles.currency}><span className={common.label}>Report currency</span><select className={common.select} value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>{(currencies.length ? currencies : ['NGN']).map((c) => <option key={c}>{c}</option>)}</select></label></div>
    <div className={styles.metricGrid} aria-label="Choose a reporting metric">{available.map((m) => <button key={m.id} type="button" className={styles.metricChoice} aria-pressed={m.id === metric.id} onClick={() => selectMetric(m)}><KpiCard label={m.label} value={reportValue(m.unit, m.value(currencyDataset), currency)} /><span className={styles.requirements}>{m.requirementIds.join(' · ')}</span></button>)}</div>
    <Card className={common.panel}>
      <CardHeader title={metric.label} subtitle={metric.id === 'collection_rate' ? `Breakdown shows collected payment amounts in ${currency}, not percentages.` : metric.id === 'ppm_share' ? 'Breakdown shows work-order counts by origin, not percentage values.' : `Break down the records in your authorised scope${metric.unit === 'money' ? ` · ${currency}` : ''}.`} action={<div className={common.filters}><Button type="button" icon={<BookmarkPlus size={16} />} onClick={saveView}>Save view</Button><Button type="button" variant="primary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button></div>} />
      <div className={common.stack}>
        <div className={common.filters} aria-label="Breakdown dimension"><span className={common.label}>Group by</span>{metric.dims.map((d) => <Button type="button" key={d.id} aria-pressed={activeDim === d.id} onClick={() => setDim(d.id)}>{d.label}</Button>)}</div>
        <div className={styles.explorer}>
          <div className={common.stack}>{bars.length ? bars.map((b) => <div key={b.key} className={styles.barRow}><div className={styles.barLabels}><span>{b.label}</span><strong>{reportValue(breakdownUnit, b.value, currency)}</strong></div><div className={styles.barTrack} aria-hidden="true"><div className={styles.barFill} style={{ width: `${Math.max(0, b.value / maxBar * 100)}%` }} /></div></div>) : <EmptyState title="No data for this breakdown." description="Choose another metric or currency to inspect its recorded values." />}</div>
          <section className={styles.trend} aria-label="Metric history"><h3 className={common.sectionTitle}>{metric.realTrend ? 'Weekly recorded activity' : 'Snapshot metric'}</h3>
            {metric.realTrend ? <><div className={common.filters} aria-label="Trend date range">{RANGES.map((r) => <Button type="button" key={r.w} aria-pressed={weeks === r.w} onClick={() => setWeeks(r.w)}>{r.label}</Button>)}</div><Trend points={points} label={metric.id === 'spend' ? `Weekly recorded work-order cost in ${currency}` : 'Weekly work orders created'} /><p className={common.metadata}>{metric.id === 'spend' ? 'Cost grouped by work-order creation date, not payment date.' : 'Work orders created each week, not a historical count of open work orders.'} Ending {snapshotDate}.</p><details><summary className={styles.summary}>View weekly values</summary><ol className={styles.weeklyValues}>{points.map((p, i) => <li key={i}>Week {i + 1} of {weeks}<span>{reportValue(chartUnit, p, currency)}</span></li>)}</ol></details></> : <><p className={common.metric}>{reportValue(metric.unit, metric.value(currencyDataset), currency)}</p><StatusPill status="No historical series" tone="muted" /><p className={common.body}>This metric is calculated from the current record snapshot. No illustrative trend is presented as measured history.</p></>}
          </section>
        </div>
        {!!views.length && <div className={styles.saved}><span className={common.metadata}>Saved in this session</span><div className={common.filters}>{views.map((v) => <Button type="button" key={v.name} icon={<Bookmark size={16} />} onClick={() => { setMetricId(v.metricId); setDim(v.dim); setCurrency(v.currency); }}>{v.name}</Button>)}</div></div>}
      </div>
    </Card>
    {feedback && <div className={common.feedback} role="status"><span>{feedback}</span><IconButton type="button" aria-label="Dismiss report feedback" onClick={() => setFeedback(null)}><X size={18} /></IconButton></div>}
  </div>;
}

function Trend({ points, label }: { points: number[]; label: string }) {
  const width = 320, height = 100, max = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${i * step} ${height - (p / max) * (height - 8) - 4}`).join(' ');
  return <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><title>{label}</title><path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" /><line x1="0" y1={height - 2} x2={width} y2={height - 2} stroke="var(--border)" /></svg>;
}
