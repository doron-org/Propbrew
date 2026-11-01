'use client';

import styles from './construction-commercial-polish.module.css';

import { useConstructionSave, ConstructionSummary, ConstructionPanel, ConstructionToast, ConstructionKpi as Kpi, constructionNaira as naira, ConstructionDialog, ConstructionFrame, ConstructionPanelHeader, ConstructionEmpty } from './construction-ui';
import { Button, CardHeader } from '@/components/ui';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, TrendingDown, TrendingUp, ArrowRightLeft, RefreshCw, Scale, Check, Info } from 'lucide-react';
import { toneVar, type Tone } from '@/lib/status-tones';
import { CURRENCY_SYMBOL, convertMinor, fxSensitivity, type FxExposureRow, type FxPosition, type FxTable } from '@/domain/construction';
import type { CurrencyCode } from '@/domain/primitives';
import { updateFxRate } from '@/server/actions/construction';
import { PageTabs } from '@/components/ui/page-tabs';

export type RatePanelRow = { currency: CurrencyCode; rate: number; priorRate?: number; movementPct: number | null; asOfISO: string; hasExposure: boolean };

/** A payable revalued UP (positive unrealized) is a loss; DOWN is a gain. */
const pnl = (m: number) => (m > 0 ? { label: 'loss', tone: 'danger' as Tone } : m < 0 ? { label: 'gain', tone: 'success' as Tone } : { label: 'flat', tone: 'muted' as Tone });
const fmtForeign = (minor: number, currency: CurrencyCode) => new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
const rateLabel = (rate: number) => rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 20 });
const dateLabel = (iso: string) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? iso || 'No timestamp recorded' : `${at.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', ...(iso.includes('T') ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}), timeZone: 'Africa/Lagos' })} WAT`; };

export function FxWorkspace({ rows, positions, rates, table, unrealizedMinor, spotExposureMinor, canMutate }: {
  rows: FxExposureRow[]; positions: FxPosition[]; rates: RatePanelRow[]; table: FxTable;
  unrealizedMinor: number; spotExposureMinor: number; canMutate: boolean;
}) {
  const shockId = useId();
  const [display, setDisplay] = useState<CurrencyCode>('NGN');
  const [shock, setShock] = useState(10);
  const [rateFor, setRateFor] = useState<RatePanelRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3600); };

  // Reporting-currency toggle: reconvert the NGN headline into the chosen lens.
  const inDisplay = (ngnMinor: number) => convertMinor(ngnMinor, 'NGN', display, table);
  const fmtDisplay = (ngnMinor: number) => `${CURRENCY_SYMBOL[display]}${(inDisplay(ngnMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const netPnl = pnl(unrealizedMinor);
  const sensitivity = useMemo(() => fxSensitivity(rows, shock), [rows, shock]);
  const displayCurrencies: CurrencyCode[] = ['NGN', 'USD', 'GHS', 'KES'];
  const maxPos = Math.max(1, ...positions.map((p) => Math.abs(p.unrealizedMinor)));

  return (
    <ConstructionFrame><div className={styles.workspace}>
      {/* Hero */}
      <ConstructionSummary>
        <div className="relative flex items-center gap-3 flex-wrap">
          <span className="construction-summary-icon" ><Coins size={22} /></span>
          <div className="min-w-0">
            <div className="text-[14px] text-text-3">FX EXPOSURE · REPORTING IN NGN</div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em] leading-tight mt-0.5">
              {rows.length === 0 ? 'No open foreign commitments' : unrealizedMinor === 0 ? 'No net unrealized FX movement' : <>{naira(Math.abs(unrealizedMinor))} unrealized FX <span style={{ color: toneVar(netPnl.tone) }}>{netPnl.label}</span></>}
            </h2>
            <div className="text-[14px] text-text-3 mt-0.5">{naira(spotExposureMinor)} of undelivered foreign commitments · estimated exposure, not a confirmed settlement balance</div>
          </div>
          {/* Reporting-currency toggle */}
          <div className="ml-auto flex items-center gap-1 flex-none rounded-lg p-1 bg-surface-2 border border-border" aria-label="Reporting currency">
            {displayCurrencies.map((c) => (
              <Button type="button" key={c} disabled={c !== 'NGN' && !table[c]} title={c !== 'NGN' && !table[c] ? `No recorded ${c} reporting rate` : `Reporting lens: ${c}`} onClick={() => setDisplay(c)} aria-pressed={display === c} style={display === c ? { color: 'var(--primary)', borderColor: 'var(--primary)', background: 'var(--primary-weak)' } : undefined}>{c}</Button>
            ))}
          </div>
        </div>
        <p className={`${styles.metadata} mt-6`}>Reporting lens: {display}. {display === 'NGN' ? 'The books remain in NGN.' : `Converted from NGN using the recorded rate of ₦${rateLabel(table[display]?.rate ?? 0)} per ${display}, as of ${dateLabel(table[display]?.asOfISO ?? '')}.`} This is an illustrative reporting conversion, not a live market quote, bank balance or trade execution. Native currency commitments remain separate below.</p>
      </ConstructionSummary>

      {/* KPIs (respond to the reporting-currency toggle) */}
      <PageTabs label="Foreign exchange sections" items={[
        {
          id: 'overview', label: 'Exposure overview', content: <div className="pb-section">
            <div className="grid grid-cols-1 min-[520px]:grid-cols-2 min-[1100px]:grid-cols-4 gap-6">
              <Kpi label={`Outstanding (in ${display})`} value={fmtDisplay(spotExposureMinor)} tone="info" icon={<ArrowRightLeft size={16} />} />
              <Kpi label={`Unrealized (in ${display})`} value={fmtDisplay(unrealizedMinor)} tone={netPnl.tone} icon={unrealizedMinor > 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />} />
              <Kpi label="Currencies exposed" value={String(positions.length)} tone="progress" icon={<Coins size={16} />} />
              <Kpi label="Commitments" value={String(rows.length)} tone="neutral" icon={<Scale size={16} />} />
            </div>
            {positions.length > 0 && (
              <ConstructionPanel>
                <div className={styles.header}><CardHeader title="Net position by currency" subtitle="Native foreign balances remain separate · gains/losses below are estimated NGN revaluations" /></div><div className={styles.body}><ul className={styles.chartRows}>
                  {positions.map((p) => {
                    const pl = pnl(p.unrealizedMinor);
                    return (
                      <li key={p.currency}>
                        <div className={styles.chartLabel}>
                          <strong>{p.currency} · {fmtForeign(p.outstandingForeignMinor, p.currency)} outstanding · {p.count} commitments</strong>
                          <span className="font-mono flex-none ml-2" style={{ color: toneVar(pl.tone) }}>{p.unrealizedMinor > 0 ? '−' : p.unrealizedMinor < 0 ? '+' : ''}{naira(Math.abs(p.unrealizedMinor))} {pl.label}</span>
                        </div>
                        <div className={styles.bar} role="img" aria-label={`${p.currency}: estimated unrealized ${pl.label} ${naira(Math.abs(p.unrealizedMinor))}`}><span style={{ width: `${(Math.abs(p.unrealizedMinor) / maxPos) * 100}%`, background: toneVar(pl.tone) }} /></div>
                        <dl className={styles.facts}><div><dt>Booked NGN equivalent</dt><dd>{naira(p.bookedMinor)}</dd></div><div><dt>Recorded spot NGN equivalent</dt><dd>{naira(p.spotMinor)}</dd></div></dl>
                      </li>
                    );
                  })}
                </ul></div>
              </ConstructionPanel>
            )}
          </div>
        },
        {
          id: 'rates', label: 'Rates & sensitivity', content: <div className="pb-section">
            <ConstructionPanel >
              <ConstructionPanelHeader title="Exchange rates"><span className="text-[12px] text-text-3">· NGN per 1 unit · move shown vs the rate it replaced</span></ConstructionPanelHeader>
              <div className="divide-y divide-border">
                {rates.map((r) => {
                  const up = (r.movementPct ?? 0) > 0;
                  return (
                    <div key={r.currency} className="px-6 py-4 flex items-center gap-3 flex-wrap">
                      <span className="w-9 h-9 rounded-xl grid place-items-center flex-none text-[14px] font-bold" style={{ background: 'var(--surface-2)' }}>{CURRENCY_SYMBOL[r.currency]}</span>
                      <div className="min-w-0">
                        <p className={styles.title}>{r.currency} · ₦{rateLabel(r.rate)} per unit</p>
                        <p className={styles.metadata}>Recorded as of <time dateTime={r.asOfISO}>{dateLabel(r.asOfISO)}</time>{!r.hasExposure && ' · no open exposure'}</p>
                      </div>
                      {r.movementPct !== null && (
                        <span className="text-[14px] font-medium inline-flex items-center gap-0.5 flex-none" style={{ color: toneVar(up ? 'danger' : 'success') }}>
                          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{up ? '+' : ''}{r.movementPct}%
                          <span className="text-text-3 font-normal ml-1">from ₦{r.priorRate === undefined ? 'Not recorded' : rateLabel(r.priorRate)}</span>
                        </span>
                      )}
                      {canMutate && <Button type="button" onClick={() => setRateFor(r)} className="ml-auto flex-none"><RefreshCw size={12} /> Reprice</Button>}
                    </div>
                  );
                })}
                {rates.length === 0 && <ConstructionEmpty title="No exchange rates recorded" />}
              </div>
            </ConstructionPanel>
            <ConstructionPanel>
              <div className={styles.header}><CardHeader title="If the naira moves further" subtitle="Linear sensitivity estimate · not an FX forecast or execution instruction" /></div><div className={`${styles.body} ${styles.stack}`}>
              <p className={styles.text}>The outstanding foreign book is fixed, so the NGN cost moves linearly with the rate. Adjust the scenario to inspect estimated extra or saved cost. No rate or commitment is changed.</p>
              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor={shockId} className={styles.field}><span>Naira move percentage</span><input id={shockId} type="range" min={-20} max={20} step={1} value={shock} onChange={(e) => setShock(Number(e.target.value))} className={styles.sensitivity} aria-label="Naira move percentage" aria-valuetext={`${Math.abs(shock)}% ${shock >= 0 ? 'weakening' : 'strengthening'}`} /></label>
                <div className="text-right flex-none">
                  <div className="text-[12px] text-text-3">naira {shock >= 0 ? 'weakens' : 'strengthens'} {Math.abs(shock)}%</div>
                  <div className="text-[18px] font-bold tracking-[-0.02em] font-mono" style={{ color: toneVar(shock === 0 ? 'muted' : shock > 0 ? 'danger' : 'success') }}>{shock > 0 ? '+' : shock < 0 ? '−' : ''}{naira(Math.abs(sensitivity))}</div>
                </div>
              </div>
              </div>
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {[-10, -5, 5, 10, 15].map((s) => <Button type="button" aria-pressed={shock === s} key={s} onClick={() => setShock(s)} style={shock === s ? { borderColor: 'transparent', background: `color-mix(in srgb, ${toneVar('progress')} 15%, transparent)`, color: toneVar('progress') } : undefined}>{s > 0 ? '+' : ''}{s}%</Button>)}
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'commitments', label: 'Foreign commitments', content: <div className="pb-section">
            <ConstructionPanel className="pb-table-frame">
              <ConstructionPanelHeader title="Foreign commitments"><span className="text-[12px] text-text-3 font-normal">· revalued on the undelivered portion only</span></ConstructionPanelHeader>
              <div role="region" tabIndex={0} aria-label="Foreign currency commitments · scroll horizontally" className={styles.scroll}>
                <table aria-label="Foreign currency commitments" className={`pb-data-table ${styles.table} ${styles.wideTable}`}>
                  <thead><tr>{['Order', 'Currency', 'Outstanding', 'Booked ₦/fx', 'Spot ₦/fx', 'Booked NGN', 'Spot NGN', 'Unrealized'].map((h, i) => <th scope="col" key={h} className={`text-[12px] font-medium uppercase text-text-3 px-6 py-4 border-b border-border ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const pl = pnl(r.unrealizedMinor);
                      return (
                        <tr key={r.id} className="hover:bg-surface-2">
                          <th scope="row"><div className={styles.title}>{r.item}</div><p className={styles.metadata}>{r.ref} · {r.vendorName}</p></th>
                          <td className="px-6 py-4 border-b border-border"><span className="text-[12px] font-semibold px-1.5 h-5 inline-flex items-center rounded-full" style={{ background: 'var(--surface-2)' }}>{r.currency}</span></td>
                          <td className="px-6 py-4 border-b border-border text-right"><div className="text-[12px] font-mono">{fmtForeign(r.outstandingForeignMinor, r.currency)}</div><div className="text-[12px] text-text-3">{Math.round(r.outstandingFraction * 100)}% of {fmtForeign(r.foreignMinor, r.currency)}</div></td>
                          <td className={styles.numeric}>₦{rateLabel(r.bookedRate)}</td>
                          <td className={styles.numeric}>₦{rateLabel(r.spotRate)}</td>
                          <td className="px-6 py-4 border-b border-border text-right text-[12px] font-mono text-text-3">{naira(r.bookedMinor)}</td>
                          <td className="px-6 py-4 border-b border-border text-right text-[12px] font-mono">{naira(r.spotMinor)}</td>
                          <td className="px-6 py-4 border-b border-border text-right text-[14px] font-mono font-medium" style={{ color: toneVar(pl.tone) }}>{r.unrealizedMinor > 0 ? '−' : r.unrealizedMinor < 0 ? '+' : ''}{naira(Math.abs(r.unrealizedMinor))}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[14px] text-text-3">No foreign-currency commitments.</td></tr>}
                  </tbody>
                </table>
              </div>
            </ConstructionPanel>
            <div className="text-[14px] text-text-3 flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 flex-none" />
              The books stay in NGN: each order posted its NGN value at the booking rate, so earned value and budgets are unaffected. This page revalues only what is still owed. Repricing a currency writes to the audit log and records a market-price variance.
            </div>
          </div>
        }
      ]} />

      {/* Rates */}

      {/* Positions by currency */}

      {/* Sensitivity */}

      {/* Exposure detail */}

      {rateFor && <RepriceDialog key={rateFor.currency} row={rateFor} onClose={() => setRateFor(null)} onDone={(m) => { setRateFor(null); flash(m); }} />}
      {toast && <ConstructionToast>{toast}</ConstructionToast>}
    </div></ConstructionFrame>
  );
}

function RepriceDialog({ row, onClose, onDone }: { row: RatePanelRow; onClose: () => void; onDone: (m: string) => void }) {
  const fieldId = useId();
  const router = useRouter();
  const [rate, setRate] = useState(String(row.rate));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useConstructionSave(setError);
  const next = Number(rate);
  const movePct = next > 0 ? Math.round(((next - row.rate) / row.rate) * 1000) / 10 : 0;
  function submit() { setError(null); start(async () => { const r = await updateFxRate(row.currency, next); if (!r.ok) { setError(r.error); return; } router.refresh(); onDone(`Repriced · ${r.ref}`); }); }
  return (
    <ConstructionDialog title={`Reprice ${row.currency}`} onClose={onClose} pending={pending}>
      <div className={styles.notice}><div><p className={styles.title}>Current: ₦{rateLabel(row.rate)} / {row.currency}</p><p className={styles.text}>Every outstanding {row.currency} commitment is revalued at the new rate. This is a recorded valuation change, not a currency purchase, bank settlement or live quote.</p><p className={styles.metadata}>Current rate as of {dateLabel(row.asOfISO)}</p></div></div>
      <label htmlFor={fieldId} className="pb-form-label">New rate · NGN per {row.currency}</label>
      <input id={fieldId} aria-label="New rate · NGN per" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className={styles.control} autoFocus />
      {next > 0 && next !== row.rate && <div className="text-[14px] mt-1.5" style={{ color: toneVar(movePct > 0 ? 'danger' : 'success') }}>{movePct > 0 ? '+' : ''}{movePct}% — naira {movePct > 0 ? 'weakens' : 'strengthens'}, foreign payables cost {movePct > 0 ? 'more' : 'less'}</div>}
      {error && <div role="alert" className="text-[12px] text-negative mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-4"><Button type="button" disabled={pending} onClick={onClose} >Cancel</Button><Button variant="primary" type="button" onClick={submit} disabled={pending || !(next > 0) || next === row.rate} ><Check size={13} /> {pending ? 'Saving…' : 'Reprice'}</Button></div>
    </ConstructionDialog>
  );
}
