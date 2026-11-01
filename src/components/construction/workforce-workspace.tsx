'use client';

import { ConstructionSearch, ConstructionEmpty, useConstructionReview, ConstructionSummary, ConstructionPanel, ConstructionToast, ConstructionKpi as Kpi, constructionNaira as naira, ConstructionFrame } from './construction-ui';
import { Avatar, CardHeader, EmptyState, IconButton, StatusPill } from '@/components/ui';
import styles from './construction-delivery-polish.module.css';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, MapPin, ShieldAlert, Banknote, Check, X, HardHat } from 'lucide-react';
import { humanizeStatus, toneVar, type Tone } from '@/lib/status-tones';

import { clockWorker } from '@/server/actions/construction';
import { PageTabs } from '@/components/ui/page-tabs';

export type WorkerRow = {
  id: string; name: string; trade: string; kind: string; crew?: string; company?: string;
  dayRateMinor: number; certName?: string; certExpiryISO?: string; certDays: number | null; certBand: Tone;
  status: 'present' | 'absent' | 'pending'; method?: string; withinGeofence?: boolean; clockIn?: string;
};
type CheckInRow = { id: string; actorName: string; siteName: string; capturedAtISO: string; distanceMeters: number; accuracyMeters: number };

const KIND_TONE: Record<string, Tone> = { employee: 'success', subcontractor: 'info', temp: 'muted' };
const displayDate = (value: string) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

export function WorkforceWorkspace({ workers, checkIns = [], byTrade, kpis, projectName, projectId, canMutate }: {
  workers: WorkerRow[]; byTrade: { trade: string; present: number; total: number }[];
  checkIns?: CheckInRow[];
  kpis: { present: number; planned: number; shortfall: number; dayCostMinor: number; certAlerts: number };
  projectName: string; projectId: string; canMutate: boolean;
}) {
  const router = useRouter();

  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const shown = workers.filter((worker) => `${worker.name} ${worker.trade} ${worker.company ?? ''} ${worker.crew ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const { act, confirmation, pending } = useConstructionReview(() => router.refresh(), flash);
  const toggle = (w: WorkerRow) => act(() => clockWorker(w.id, projectId, w.status !== 'present'), w.status === 'present' ? `Mark ${w.name} absent` : `Record ${w.name} present`, 'This is a manual attendance record, not independently verified geofence evidence.');

  const maxTrade = Math.max(1, ...byTrade.map((t) => t.total));

  return (
    <ConstructionFrame>
      <ConstructionSummary>
        <div className="relative flex items-center gap-2 flex-wrap">
          <span className="construction-summary-icon" ><HardHat size={22} /></span>
          <div className="min-w-0">
            <div className="text-[14px] text-text-3">WORKFORCE · {projectName.toUpperCase()} · RECORDED ATTENDANCE</div>
            <h2 className="text-[21px] font-medium tracking-[-0.02em] leading-tight mt-0.5">{kpis.present} of {kpis.planned} on site</h2>
            <div className="text-[14px] text-text-3 mt-0.5">
              {workers.length === 0 ? 'No crew allocation recorded' : kpis.shortfall > 0 ? <span style={{ color: toneVar('warn') }}>{kpis.shortfall} short of the planned crew</span> : 'Full recorded crew present'} · {naira(kpis.dayCostMinor)} estimated daily labour cost
            </div>
          </div>
        </div>
      </ConstructionSummary>

      {workers.some((w) => w.certDays !== null && w.certDays <= 30) && (
        <ConstructionPanel>
          <div className={styles.header}><CardHeader title="Certification alerts" subtitle="Recorded expiry dates require operator review; they are not independent credential verification." action={<ShieldAlert size={20} className="text-warning" />} /></div>
          <div className={`${styles.body} ${styles.stack}`}>
            {workers.filter((w) => w.certDays !== null && w.certDays <= 30).map((w) => (
              <div key={w.id} className={styles.toolbar}>
                <div><p className={styles.rowTitle}>{w.name}</p><p className={styles.text}>{w.certName || 'Credential name not recorded'}</p>{w.certExpiryISO && <p className={styles.metadata}>Expiry: {displayDate(w.certExpiryISO)} · WAT</p>}</div>
                <StatusPill status={(w.certDays ?? 0) < 0 ? `Expired ${-(w.certDays ?? 0)} days ago` : `${w.certDays} days left`} tone={w.certBand} />
              </div>
            ))}
          <p className={styles.notice}>Review certification and renew expired tickets before assigning certified work. This view does not independently verify a credential or confirm that an operational access block is enforced.</p>
          </div>
        </ConstructionPanel>
      )}

      <PageTabs label="Construction workforce sections" items={[
        {
          id: 'attendance', label: 'Attendance', content: <div className={styles.stack}>
            <ConstructionPanel>
              <div className={styles.header}><CardHeader title="Device location check-ins" subtitle="Today · separate from the manual crew register. Device location can be spoofed; review before payroll or access decisions." /></div>
              <div className={`${styles.body} ${styles.stack}`}>
                {checkIns.length ? <ul className={styles.list} aria-label="Location-attested site check-ins">{checkIns.map((row) => <li className={styles.listEntry} key={row.id}><div><strong>{row.actorName}</strong><p className={styles.metadata}>{row.siteName} · {new Date(row.capturedAtISO).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })} WAT</p><p className={styles.metadata}>{row.distanceMeters} m from site · ±{Math.round(row.accuracyMeters)} m device accuracy</p></div><StatusPill status="Location attested" tone="info" /></li>)}</ul> : <p className={styles.text}>No site check-ins today. Assigned field staff can check in from the native app after site coordinates are configured.</p>}
              </div>
            </ConstructionPanel>
            <ConstructionSearch label="Search construction workers" value={query} onChange={setQuery} count={shown.length} />
            <ConstructionPanel >
              <div className={styles.header}><CardHeader title="Attendance register" subtitle="Recorded roster and capture method · all manual attendance changes require review" /></div>
              <div className={styles.scroll} role="region" aria-label="Construction workforce attendance register, horizontally scrollable" tabIndex={0}>
                <table className={styles.table}><caption className="sr-only">Recorded workforce attendance and credential references, not independent physical-presence verification</caption><thead><tr>{['Worker / trade', 'Engagement', 'Day rate · NGN', 'Credential reference', 'Attendance', 'Clock / source', 'Geofence record', 'Action'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>
                {shown.map((w) => (
                  <tr key={w.id}>
                    <th scope="row"><div className={styles.identity}><Avatar name={w.name} size={40} /><div><p className={styles.rowTitle}>{w.name}</p><p className={styles.text}>{w.trade}</p></div></div></th>
                    <td className={styles.wide}><StatusPill status={humanizeStatus(w.kind)} tone={KIND_TONE[w.kind] ?? 'muted'} />{w.crew && <p className={styles.text}>Crew: {w.crew}</p>}{w.company && <p className={styles.text}>{w.company}</p>}</td>
                    <td>{naira(w.dayRateMinor)}</td>
                    <td className={styles.wide}><p className={styles.text}>{w.certName || 'Not recorded'}</p><p className={styles.metadata}>{w.certExpiryISO ? displayDate(w.certExpiryISO) : 'Expiry not recorded'}</p>{w.certDays !== null && <StatusPill status={w.certDays < 0 ? `Expired ${-w.certDays} days ago` : `${w.certDays} days left`} tone={w.certBand} />}</td>
                    <td><StatusPill status={humanizeStatus(w.status)} tone={w.status === 'present' ? 'success' : w.status === 'absent' ? 'danger' : 'muted'} /></td>
                    <td className={styles.wide}><p className={styles.text}>{w.clockIn ? `${w.clockIn} WAT` : 'Clock time not recorded'}</p><p className={styles.text}>{w.method || 'Capture method not recorded'}</p></td>
                    <td className={styles.wide}>{/^(manual|offline)\b/i.test(w.method ?? '') ? 'Not verified' : w.withinGeofence === undefined ? 'Not recorded' : w.withinGeofence ? 'Recorded inside' : 'Recorded outside'}</td>
                    <td>{canMutate && <IconButton aria-label={`${w.status === 'present' ? 'Mark absent' : 'Clock in'} ${w.name}`} type="button" disabled={pending} onClick={() => toggle(w)} title={w.status === 'present' ? 'Mark absent' : 'Clock in'}>{w.status === 'present' ? <X size={18} /> : <Check size={18} />}</IconButton>}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={8}><EmptyState title="No matching workers" description="Change the search to review other scoped roster records." /></td></tr>}
                </tbody></table>
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'overview', label: 'Crew & trade mix', content: <div className="pb-section">
            <div className={styles.metrics}>
              <Kpi label="On site" value={`${kpis.present}/${kpis.planned}`} tone={kpis.shortfall ? 'warn' : 'success'} icon={<Users size={16} />} />
              <Kpi label="Shortfall" value={String(kpis.shortfall)} tone={kpis.shortfall ? 'danger' : 'success'} icon={<MapPin size={16} />} />
              <Kpi label="Labour cost today" value={naira(kpis.dayCostMinor)} tone="progress" icon={<Banknote size={16} />} />
              <Kpi label="Certificate alerts" value={String(kpis.certAlerts)} tone={kpis.certAlerts ? 'danger' : 'success'} icon={<ShieldAlert size={16} />} />
            </div>
            <ConstructionPanel>
              <div className={styles.header}><CardHeader title="Trade mix" subtitle="Recorded present workers compared with allocated crew · not an independently verified headcount" /></div>
              <div className={`${styles.body} ${styles.stack}`}>
                {byTrade.map((t) => (
                  <div key={t.trade}>
                    <div className={styles.barLabel}><span>{t.trade}</span><span>{t.present}/{t.total} present / allocated</span></div>
                    <div className={styles.bar} role="img" aria-label={`${t.trade}: ${t.present} recorded present, ${t.total} allocated`}>
                      <div style={{ width: `${(t.total / maxTrade) * 100}%`, background: toneVar('info'), opacity: .3 }} />
                      <div className="absolute top-0 left-0" style={{ width: `${(t.present / maxTrade) * 100}%`, background: toneVar(t.present >= t.total ? 'success' : 'warn') }} />
                    </div>
                  </div>
                ))}
                {byTrade.length === 0 && <ConstructionEmpty title="No trade allocation records" />}
              </div>
            </ConstructionPanel>
          </div>
        }
      ]} />

      {/* Trade mix */}

      {/* Certificates */}

      {/* Roster */}

      {confirmation}
      {toast && <ConstructionToast>{toast}</ConstructionToast>}
    </ConstructionFrame>
  );
}
