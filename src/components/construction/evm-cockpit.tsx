'use client';

import styles from './construction-commercial-polish.module.css';

import { ConstructionFrame, ConstructionSummary, ConstructionPanel, ConstructionKpi as Kpi, constructionNaira as naira, ConstructionPanelHeader } from './construction-ui';
import { Button, CardHeader, EmptyState } from '@/components/ui';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Banknote, Gauge, Target, Wallet, Info } from 'lucide-react';
import { toneVar, type Tone } from '@/lib/status-tones';

import { PageTabs } from '@/components/ui/page-tabs';
import { PageHeader } from '@/components/ui/page-header';

export type EvmView = {
  projectId: string; name: string; code: string;
  bac: number; pv: number; ev: number; ac: number; cv: number; sv: number;
  cpi: number; spi: number; eac: number; etc: number; vac: number; tcpi: number;
  costBand: Tone; scheduleBand: Tone;
  curve: { label: string; pv: number; ev: number; ac: number; forecast: number }[];
  nowFrac: number;
  cashByMonth: { label: string; minor: number }[];
  codes: { code: string; name: string; budget: number; committed: number; actual: number; earnedPercent: number; plannedPercent: number; variance: number }[];
  forecastFinishISO: string; slipDays: number; plannedFinishISO: string;
};
const dateLabel = (iso: string) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }); };

export function EvmCockpit({ views }: { views: EvmView[] }) {
  const [idx, setIdx] = useState(0);
  const [method, setMethod] = useState<'cpi' | 'recover'>('cpi');
  const v = views[idx];
  if (!v) return <ConstructionFrame><div className={styles.workspace}><PageHeader title="Earned value" subtitle="Review project cost, schedule performance and forecast out-turn." /><PageTabs label="Earned value sections" items={[{ id: 'overview', label: 'Overview', content: <ConstructionPanel><div className={styles.body}><EmptyState title="No earned-value projects" description="Scoped project budgets, progress and actual costs are needed to calculate earned value and forecast indicators." /></div></ConstructionPanel> }]} /></div></ConstructionFrame>;

  // What-if: "CPI holds" = BAC/CPI (classic). "Productivity recovers" = AC + (BAC−EV).
  const eac = method === 'cpi' ? v.eac : v.ac + (v.bac - v.ev);
  const vac = v.bac - eac;
  const etc = Math.max(0, eac - v.ac);

  return (
    <ConstructionFrame><div className={styles.workspace}>
      {/* Project switcher */}
      <div style={{ justifyContent: 'flex-start', marginBottom: 0 }} className="pb-register-toolbar flex items-center gap-2 flex-wrap">
        {views.map((x, i) => (
          <Button type="button" aria-pressed={i === idx} key={x.projectId} onClick={() => setIdx(i)} style={i === idx ? { borderColor: 'transparent', background: `color-mix(in srgb, ${toneVar('progress')} 15%, transparent)`, color: toneVar('progress') } : { borderColor: 'var(--border-2)', background: 'var(--surface)' }}>{x.name}</Button>
        ))}
      </div>

      {/* Hero verdict */}
      <ConstructionSummary>
        <div className="relative flex items-center gap-5 flex-wrap">
          <div className="flex gap-3">
            <IndexRing label="CPI" value={v.cpi} band={v.costBand} />
            <IndexRing label="SPI" value={v.spi} band={v.scheduleBand} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] text-text-3 flex items-center gap-1.5"><Gauge size={12} /> EARNED VALUE · {v.code}</div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em] leading-tight mt-1">
              {vac < 0 ? <>Forecast to overrun by <span style={{ color: toneVar('danger') }}>{naira(-vac)}</span></> : <>Forecast under budget by <span style={{ color: toneVar('success') }}>{naira(vac)}</span></>}
            </h2>
            <div className="text-[14px] text-text-3 mt-0.5">
              Earned {naira(v.ev)} against {naira(v.ac)} recorded cost · forecast finish <time dateTime={v.forecastFinishISO}>{dateLabel(v.forecastFinishISO)}</time>{v.slipDays > 0 ? ` (${v.slipDays} days late vs ${dateLabel(v.plannedFinishISO)})` : ' (on plan)'} · WAT operating dates, not verified completion.
            </div>
          </div>
        </div>
      </ConstructionSummary>

      {/* EVM suite */}
      <PageTabs label="Earned value sections" items={[
        {
          id: 'overview', label: 'Overview', content: <div className="pb-section">
            <div className={styles.evmMetrics}>
              <Kpi label="Budget (BAC)" value={naira(v.bac)} tone="info" icon={<Wallet size={16} />} />
              <Kpi label="Earned (EV)" value={naira(v.ev)} tone="progress" icon={<Target size={16} />} />
              <Kpi label="Actual (AC)" value={naira(v.ac)} tone={v.ac > v.ev ? 'warn' : 'success'} icon={<Banknote size={16} />} />
              <Kpi label="Forecast (EAC)" value={naira(eac)} tone={vac < 0 ? 'danger' : 'success'} icon={vac < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />} />
            </div>
            <div className={styles.evmMetrics}>
              <Stat label="Cost variance (CV)" value={`${v.cv < 0 ? '−' : '+'}${naira(Math.abs(v.cv))}`} tone={v.cv < 0 ? 'danger' : 'success'} note={v.cv < 0 ? 'spending above value earned' : 'earning above spend'} />
              <Stat label="Schedule variance (SV)" value={`${v.sv < 0 ? '−' : '+'}${naira(Math.abs(v.sv))}`} tone={v.sv < 0 ? 'danger' : 'success'} note={v.sv < 0 ? 'behind the baseline' : 'ahead of baseline'} />
              <Stat label="To complete (ETC)" value={naira(etc)} tone="progress" note="remaining cost to finish" />
              <Stat label="TCPI" value={v.tcpi.toFixed(2)} tone={v.tcpi > 1.1 ? 'danger' : v.tcpi > 1 ? 'warn' : 'success'} note={v.tcpi > 1 ? `need ${v.tcpi.toFixed(2)}× efficiency` : 'achievable at current pace'} />
            </div>
          </div>
        },
        {
          id: 'curve', label: 'S-curve', content: <div className="pb-section">
            <ConstructionPanel>
              <div className={styles.header}><CardHeader title="S-curve · planned vs earned vs actual" subtitle="Modelled interpolation · exact supplied values available below" /></div><div className={`${styles.body} ${styles.stack}`}>
                <div className={styles.actions} role="group" aria-label="Earned-value forecast assumption">
                  {([['cpi', 'If CPI holds'], ['recover', 'If productivity recovers']] as const).map(([k, label]) => (
                    <Button type="button" aria-pressed={method === k} key={k} onClick={() => setMethod(k)} style={method === k ? { background: `color-mix(in srgb, ${toneVar('progress')} 15%, transparent)`, color: toneVar('progress') } : { color: 'var(--text-3)' }}>{label}</Button>
                  ))}
                </div>
              <p className={styles.text}>Illustrative interpolated curves from the recorded totals, not historical transactions. Forecasts use two standard EAC formulas; toggle to compare assumptions. The supplied curve retains its baseline forecast series; the selected method updates EAC, ETC and VAC totals, not historical values.</p>
              <dl className={styles.facts}><div><dt>Selected method</dt><dd>{method === 'cpi' ? 'CPI holds · BAC / CPI' : 'Productivity recovers · AC + (BAC − EV)'}</dd></div><div><dt>Selected EAC</dt><dd>{naira(eac)}</dd></div><div><dt>Selected ETC</dt><dd>{naira(etc)}</dd></div><div><dt>Selected VAC</dt><dd>{naira(vac)}</dd></div></dl>
              <SCurve curve={v.curve} nowFrac={v.nowFrac} eac={eac} bac={v.bac} />
              <div className="flex gap-4 text-[14px] text-text-3 mt-2.5 flex-wrap">
                <Legend color="var(--border-2)" dashed label="Planned value (PV)" />
                <Legend color={toneVar('progress')} label="Earned value (EV)" />
                <Legend color={toneVar('warn')} label="Actual cost (AC)" />
                <Legend color={toneVar(vac < 0 ? 'danger' : 'success')} dashed label={`Forecast to ${naira(eac)}`} />
              </div>
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'costs', label: 'Cost codes & forecast', content: <div className="pb-section">
            <div className="grid grid-cols-1 min-[900px]:grid-cols-[1fr_320px] gap-6 items-start">
              {/* Cost codes */}
              <ConstructionPanel className="pb-table-frame">
                <ConstructionPanelHeader title="Budget vs committed vs actual · by cost code"></ConstructionPanelHeader>
                <div role="region" tabIndex={0} aria-label="Cost code budget, commitments and actual costs · scroll horizontally" className={styles.scroll}>
                  <table aria-label="Cost code budget, commitments and actual costs" className={`pb-data-table ${styles.table}`}>
                    <thead><tr>{['Cost code', 'Budget', 'Committed', 'Actual', 'Variance'].map((h, i) => <th scope="col" key={h} className={`text-[12px] font-medium uppercase text-text-3 px-6 py-4 border-b border-border ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {v.codes.map((c) => (
                        <tr key={c.code} className="hover:bg-surface-2">
                          <th scope="row"><div className={styles.title}>{c.name}</div><p className={styles.metadata}>{c.code} · {c.earnedPercent}% earned · {c.plannedPercent}% planned</p></th>
                          <td className="px-6 py-4 border-b border-border text-right text-[12px] font-mono">{naira(c.budget)}</td>
                          <td className="px-6 py-4 border-b border-border text-right text-[12px] font-mono text-text-3">{naira(c.committed)}</td>
                          <td className="px-6 py-4 border-b border-border text-right text-[12px] font-mono">{naira(c.actual)}</td>
                          <td className="px-6 py-4 border-b border-border text-right"><span className="text-[14px] font-medium font-mono" style={{ color: toneVar(c.variance < 0 ? 'danger' : 'success') }}>{c.variance < 0 ? '−' : '+'}{naira(Math.abs(c.variance))}</span></td>
                        </tr>
                      ))}
                      {!v.codes.length && <tr><td colSpan={5}><EmptyState title="No cost-code records" description="Scoped budget, commitment and actual-cost lines appear when available." /></td></tr>}
                    </tbody>
                  </table>
                </div>
              </ConstructionPanel>

              {/* Cash requirement */}
              <ConstructionPanel>
                <div className={styles.header}><CardHeader title="Modelled cash requirement" subtitle="Open purchase-order commitments · not a payment schedule" /></div><div className={styles.body}>
                <ul className={styles.chartRows}>
                  {v.cashByMonth.map((m) => {
                    const max = Math.max(1, ...v.cashByMonth.map((x) => x.minor));
                    return (
                      <li key={m.label}>
                        <div className={styles.chartLabel}><strong>{m.label}</strong><span>{naira(m.minor)}</span></div>
                        <div className={styles.bar} role="img" aria-label={`${m.label}: estimated cash requirement ${naira(m.minor)}`}><span style={{ width: `${(m.minor / max) * 100}%`, background: toneVar('progress') }} /></div>
                      </li>
                    );
                  })}
                </ul>{v.cashByMonth.length === 0 && <EmptyState title="No open commitments recorded" description="Purchase-order funding estimates appear when scoped commitments are available." />}
                <div className="mt-3 pt-3 border-t border-border text-[14px] text-text-3 flex items-start gap-1.5"><Info size={12} className="mt-0.5 flex-none" /> EAC/VAC are estimates from the standard PMI formulas against the pinned clock — not financial advice.</div>
                </div>
              </ConstructionPanel>
            </div>
          </div>
        }
      ]} />

      {/* S-curve */}

    </div></ConstructionFrame>
  );
}

/** Planned/earned/actual cumulative curves + a forecast tail, all inline SVG. */
function SCurve({ curve, nowFrac, eac, bac }: { curve: EvmView['curve']; nowFrac: number; eac: number; bac: number }) {
  const w = 640, h = 180, pad = 4;
  const max = Math.max(bac, eac, 1);
  const x = (i: number) => pad + (i / Math.max(1, curve.length - 1)) * (w - pad * 2);
  const y = (val: number) => h - pad - (val / max) * (h - pad * 2);
  const line = (key: 'pv' | 'ev' | 'ac', upto?: number) => curve.filter((_, i) => upto === undefined || i <= upto).map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(c[key])}`).join(' ');
  const nowIdx = Math.round(nowFrac * (curve.length - 1));
  const forecast = curve.map((c, i) => ({ c, i })).filter(({ i }) => i >= nowIdx).map(({ c, i }, k) => `${k === 0 ? 'M' : 'L'}${x(i)},${y(c.forecast || (i === nowIdx ? curve[nowIdx].ac : 0))}`).join(' ');
  if (!curve.length) return <EmptyState title="No illustrative curve points" description="No supplied interpolation series is available. Project headline calculations remain above." />;
  return (
    <div className={styles.stack}><div role="region" tabIndex={0} aria-label="Construction chart · scroll horizontally" className={styles.scroll}>
      <svg role="img" aria-label={`Illustrative planned, earned and actual value curves. Forecast ${naira(eac)} against budget ${naira(bac)}.`} viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[420px]" style={{ height: h }}>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth="1" />)}
        <line x1={x(nowIdx)} x2={x(nowIdx)} y1={pad} y2={h - pad} stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        <path d={line('pv')} fill="none" stroke="var(--border-2)" strokeWidth="2" strokeDasharray="5 3" />
        <path d={forecast} fill="none" stroke={toneVar(eac > bac ? 'danger' : 'success')} strokeWidth="2" strokeDasharray="4 3" />
        <path d={line('ac', nowIdx)} fill="none" stroke={toneVar('warn')} strokeWidth="2.5" strokeLinecap="round" />
        <path d={line('ev', nowIdx)} fill="none" stroke={toneVar('progress')} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={x(nowIdx)} cy={y(curve[nowIdx]?.ev ?? 0)} r="3.5" fill={toneVar('progress')} />
        <text x={Math.min(w - 70, x(nowIdx) + 5)} y={pad + 14} fontSize="12" fill="var(--text-3)">snapshot</text>
      </svg>
    </div><details><summary className={styles.disclosure}>View exact illustrative curve values</summary><div className={styles.scroll} role="region" tabIndex={0} aria-label="Illustrative earned-value curve values, horizontally scrollable"><table className={styles.table}><caption className="sr-only">Supplied interpolated series in NGN, not historical transactions</caption><thead><tr><th scope="col">Period</th><th scope="col" className={styles.numeric}>Planned value</th><th scope="col" className={styles.numeric}>Earned value</th><th scope="col" className={styles.numeric}>Actual cost</th><th scope="col" className={styles.numeric}>Supplied forecast</th></tr></thead><tbody>{curve.map((point, index) => <tr key={`${point.label}-${index}`}><th scope="row">{point.label}</th><td className={styles.numeric}>{naira(point.pv)}</td><td className={styles.numeric}>{naira(point.ev)}</td><td className={styles.numeric}>{naira(point.ac)}</td><td className={styles.numeric}>{naira(point.forecast)}</td></tr>)}</tbody></table></div></details></div>
  );
}
function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />{label}</span>;
}
function IndexRing({ label, value, band }: { label: string; value: number; band: Tone }) {
  const color = toneVar(band);
  const pct = Math.max(0, Math.min(1, value / 1.2));
  return (
    <div className="relative flex-none" style={{ width: 72, height: 72 }}>
      <svg width={72} height={72} viewBox="0 0 36 36" className="-rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3" /><circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${pct * 97.4} 97.4`} /></svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[16px] font-bold leading-none" style={{ color }}>{value.toFixed(2)}</span><span className="text-[12px] text-text-3 uppercase tracking-wide mt-0.5">{label}</span></div>
    </div>
  );
}

function Stat({ label, value, tone, note }: { label: string; value: string; tone: Tone; note: string }) {
  return <ConstructionPanel className={styles.stat}><dl><dt>{label}</dt><dd style={{ color: toneVar(tone) }}>{value}</dd></dl><p className={styles.metadata}>{note}</p></ConstructionPanel>;
}
