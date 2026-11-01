'use client';

import { useConstructionSave, useConstructionReview, ConstructionSummary, ConstructionPanel, ConstructionToast, ConstructionKpi as Kpi, constructionNaira as naira, constructionNaira as exact, ConstructionDialog, ConstructionFrame } from './construction-ui';
import { Button, Card, CardHeader, EmptyState, StatusPill } from '@/components/ui';
import styles from './construction-delivery-polish.module.css';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, Check, Banknote, TrendingUp, ArrowRight, Info } from 'lucide-react';
import { humanizeStatus, toneVar, type Tone } from '@/lib/status-tones';

import { submitTimesheet, approveTimesheet, rejectTimesheet } from '@/server/actions/construction';
import { PageTabs } from '@/components/ui/page-tabs';

export type SheetRow = {
  id: string; ref: string; workerName: string; weekEndingISO: string; costCode: string;
  normalHours: number; overtimeHours: number; status: string; submittedBy: string;
  approvedBy?: string; approvedISO?: string; costMinor: number; band: Tone; dayRateMinor: number;
};
export type CodeRow = { code: string; name: string; postedMinor: number; pendingMinor: number; hours: number; actualMinor: number; budgetMinor: number };
const displayDate = (value: string) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', ...(value.includes('T') ? { hour: '2-digit', minute: '2-digit' } as const : {}), timeZone: 'Africa/Lagos' });

export function TimesheetsWorkspace({ sheets, byCode, posture, projectName, canMutate }: {
  sheets: SheetRow[]; byCode: CodeRow[];
  posture: { postedMinor: number; pendingMinor: number; pendingSheets: number; overtimeHours: number };
  projectName: string; canMutate: boolean;
}) {
  const router = useRouter();

  const [rejectFor, setRejectFor] = useState<SheetRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  const { act, confirmation, pending } = useConstructionReview(() => router.refresh(), flash);

  const awaiting = sheets.filter((s) => s.status === 'submitted');
  const sorted = [...sheets].sort((a, b) => {
    const rank = (s: string) => (s === 'submitted' ? 0 : s === 'draft' ? 1 : s === 'approved' ? 2 : 3);
    return rank(a.status) - rank(b.status) || b.weekEndingISO.localeCompare(a.weekEndingISO);
  });

  return (
    <ConstructionFrame>
      {/* Hero — the point of the page */}
      <ConstructionSummary>
        <div className="relative flex items-center gap-3 flex-wrap">
          <span className="construction-summary-icon" ><Clock size={22} /></span>
          <div className="min-w-0">
            <div className="text-[14px] text-text-3">TIMESHEETS · {projectName.toUpperCase()}</div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em] leading-tight mt-0.5">
              {sheets.length === 0 ? 'No labour records in this snapshot' : posture.pendingMinor > 0
                ? <><span style={{ color: toneVar('warn') }}>{naira(posture.pendingMinor)}</span> of labour the forecast can&apos;t see yet</>
                : 'All recorded labour is posted to cost'}
            </h2>
            <div className="text-[14px] text-text-3 mt-0.5">{naira(posture.postedMinor)} already posted · {posture.pendingSheets} sheet{posture.pendingSheets === 1 ? '' : 's'} awaiting approval · {posture.overtimeHours}h overtime booked</div>
          </div>
        </div>
      </ConstructionSummary>

      {posture.pendingMinor > 0 && (
        <div className={styles.notice}>
          <Info size={18} />
          <div>
            Approving a timesheet posts its calculated cost to the cost code&apos;s recorded actuals, which makes labour appear in earned value. Until then, {naira(posture.pendingMinor)} in pending labour records is excluded from CPI. These are cost records, not proof of paid wages or bank settlement.
            <Link href="/construction/evm" className={styles.link}>Earned Value <ArrowRight size={16} /></Link>
          </div>
        </div>
      )}

      <PageTabs label="Construction timesheet sections" items={[
        {
          id: 'sheets', label: 'Timesheets', content: <div className={styles.stack}>
            <ConstructionPanel >
              <div className={styles.header}><CardHeader title="Timesheets" subtitle="Submitted sheets first, then drafts, posted and rejected records · exact NGN values" /></div>
              <div className={styles.scroll} role="region" aria-label="Construction timesheet register, horizontally scrollable" tabIndex={0}>
                <table className={styles.table}><caption className="sr-only">Recorded labour hours, calculated costs and reviewed approval history; not payroll payments</caption><thead><tr>{['Timesheet / worker', 'Week ending · WAT', 'Hours / day rate', 'Cost code', 'Record status', 'Cost · NGN', 'Approval history', 'Actions'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <th scope="row"><p className={styles.rowTitle}>{s.ref}</p><p className={styles.text}>{s.workerName}</p><p className={styles.metadata}>Submitted by {s.submittedBy || 'Not recorded'}</p></th>
                    <td>{displayDate(s.weekEndingISO)}</td>
                    <td className={styles.wide}><p>{s.normalHours}h normal</p><p>{s.overtimeHours}h overtime @1.5×</p><p>{exact(s.dayRateMinor)} / day</p></td>
                    <td>{s.costCode}</td>
                    <td><StatusPill status={humanizeStatus(s.status)} tone={s.band} /><p className={styles.metadata}>{s.status === 'approved' ? 'Posted to cost actuals' : 'Not posted to cost actuals'}</p></td>
                    <td className={styles.numeric}>{exact(s.costMinor)}</td>
                    <td className={styles.wide}>{s.approvedBy ? <><p>{s.approvedBy}</p><p className={styles.metadata}>{s.approvedISO ? `${displayDate(s.approvedISO)} WAT` : 'Approval date not recorded'}</p></> : 'No approval recorded'}</td>
                    <td><div className={styles.actions}>
                        {canMutate && s.status === 'draft' && <Button type="button" disabled={pending} onClick={() => act(() => submitTimesheet(s.id), 'Submitted')} >Submit</Button>}
                        {canMutate && s.status === 'submitted' && (
                          <>
                            <Button type="button" disabled={pending} onClick={() => setRejectFor(s)} style={{ color: toneVar('danger') }}>Reject</Button>
                            <Button variant="primary" type="button" disabled={pending} onClick={() => act(() => approveTimesheet(s.id), `Approve and post ${s.ref}`, `${s.workerName}: ${s.normalHours} normal hours and ${s.overtimeHours} overtime hours, costing ${exact(s.costMinor)}. Approval adds this amount to ${s.costCode} actuals; it does not pay wages or execute a bank transfer.`)} ><Check size={11} /> Approve &amp; post</Button>
                          </>
                        )}
                    </div></td>
                  </tr>
                ))}
                {sorted.length === 0 && <tr><td colSpan={8}><EmptyState title="No timesheet records" description="Recorded hours and reviewed cost postings will appear here." /></td></tr>}
                </tbody></table>
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'costs', label: 'Labour by cost code', content: <div className={styles.stack}>
            <ConstructionPanel >
              <div className={styles.header}><CardHeader title="Labour by cost code" subtitle="Posted and pending labour compared with each code’s recorded actuals and budget" /></div>
              <div className="divide-y divide-border">
                {byCode.map((c) => {
                  const max = Math.max(1, c.budgetMinor);
                  return (
                    <div key={c.code} className={`${styles.row} ${styles.section}`}>
                      <CardHeader title={c.name} subtitle={c.code} />
                      <dl className={`${styles.facts} ${styles.factsFour}`}><div><dt>Hours recorded</dt><dd>{c.hours}h</dd></div><div><dt>Posted labour · NGN</dt><dd>{naira(c.postedMinor)}</dd></div><div><dt>Pending labour · NGN</dt><dd>{naira(c.pendingMinor)}</dd></div><div><dt>Budget · NGN</dt><dd>{naira(c.budgetMinor)}</dd></div></dl>
                      <div className={`${styles.bar} flex`} role="img" aria-label={`Recorded actual ${naira(c.actualMinor)}, pending labour ${naira(c.pendingMinor)}, budget ${naira(c.budgetMinor)}`}>
                        <div className="h-full" style={{ width: `${Math.min(100, (c.actualMinor / max) * 100)}%`, background: toneVar('progress') }} title={`actual ${naira(c.actualMinor)}`} />
                        <div className="h-full" style={{ width: `${Math.min(100, (c.pendingMinor / max) * 100)}%`, background: `color-mix(in srgb, ${toneVar('warn')} 60%, transparent)` }} title={`pending labour ${naira(c.pendingMinor)}`} />
                      </div>
                      <p className={styles.text}>Actual {naira(c.actualMinor)} of {naira(c.budgetMinor)} budget{c.pendingMinor > 0 ? ` — would become ${naira(c.actualMinor + c.pendingMinor)} once these sheets are approved` : ''}.</p>
                    </div>
                  );
                })}
                {byCode.length === 0 && <EmptyState title="No labour booked yet" description="Cost-code totals appear after labour records are available." />}
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'overview', label: 'Overview', content: <div className="pb-section">
            <div className={styles.metrics}>
              <Kpi label="Posted to actuals" value={naira(posture.postedMinor)} tone="success" icon={<Banknote size={16} />} />
              <Kpi label="Not yet in EVM" value={naira(posture.pendingMinor)} tone={posture.pendingMinor ? 'warn' : 'success'} icon={<TrendingUp size={16} />} />
              <Kpi label="Awaiting approval" value={String(awaiting.length)} tone={awaiting.length ? 'warn' : 'success'} icon={<Clock size={16} />} />
              <Kpi label="Overtime hours" value={`${posture.overtimeHours}h`} tone={posture.overtimeHours > 20 ? 'warn' : 'info'} icon={<Clock size={16} />} />
            </div>
          </div>
        }
      ]} />

      {/* Sheets */}

      {/* Where the labour lands */}

      {rejectFor && <RejectDialog sheet={rejectFor} onClose={() => setRejectFor(null)} onDone={(m) => { setRejectFor(null); flash(m); }} />}
      {confirmation}
      {toast && <ConstructionToast>{toast}</ConstructionToast>}
    </ConstructionFrame>
  );
}

function RejectDialog({ sheet, onClose, onDone }: { sheet: SheetRow; onClose: () => void; onDone: (m: string) => void }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useConstructionSave(setError);
  function submit() { setError(null); start(async () => { const r = await rejectTimesheet(sheet.id, reason); if (!r.ok) { setError(r.error); return; } router.refresh(); onDone(`Rejected · ${r.ref}`); }); }
  return (
    <ConstructionDialog title={"Reject timesheet"} onClose={onClose} pending={pending}>
      <div className={styles.stack}><Card><CardHeader title={`${sheet.ref} · ${sheet.workerName}`} subtitle={`${sheet.normalHours} normal hours + ${sheet.overtimeHours} overtime hours · ${exact(sheet.costMinor)}`} /></Card>
      <label className={styles.field}>Reason (required)<textarea aria-label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Overtime not pre-authorised for this week" /></label>
      <p className={styles.notice}>Review the labour record and rejection reason before confirming. This form only posts a labour cost record.</p>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      <div className={styles.actions}><Button type="button" disabled={pending} onClick={onClose} >Cancel</Button><Button variant="primary" type="button" onClick={submit} disabled={pending || !reason.trim()} >{pending ? 'Saving…' : 'Reject'}</Button></div></div>
    </ConstructionDialog>
  );
}
