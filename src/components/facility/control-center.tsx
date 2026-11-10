'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Droplet, Gauge, Plug, Send, ShieldCheck, Zap } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, KpiCard, StatusPill } from '@/components/ui';
import { PageTabs } from '@/components/ui/page-tabs';
import { FacilityDialog, FacilityFeedback } from './facility-ui';
import { toneVar, type Tone } from '@/lib/status-tones';
import { acknowledgeAlarm, dispatchWoFromAlarm } from '@/server/actions/facility';
import styles from './facility-specialists.module.css';

export type SystemRow = { id: string; name: string; category: string; status: string; detail: string; siteName: string };
export type SensorRow = { id: string; name: string; kind: string; value: number; unit: string; low?: number; high?: number; drift?: number; text?: string; siteName: string };
export type AlarmRow = { id: string; system: string; severity: string; message: string; atISO: string; acknowledged: boolean; woRef?: string };
export type Health = { score: number; band: Tone; label: string };
const STATUS_TONE: Record<string, Tone> = { operational: 'success', standby: 'info', degraded: 'warn', down: 'danger' };
const SEVERITY_TONE: Record<string, Tone> = { critical: 'danger', warning: 'warn', info: 'info' };
const date = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });

export function ControlCenter({ health, systems, sensors, alarms, kpis, nowMs, canUpdate = false, canCreate = false }: {
  health: Health; systems: SystemRow[]; sensors: SensorRow[]; alarms: AlarmRow[];
  kpis: { operational: number; total: number; powerSource: string; waterPct: number };
  nowMs: number; canUpdate?: boolean; canCreate?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<AlarmRow | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const open = alarms.filter((alarm) => !alarm.acknowledged);
  const systemAvailability = kpis.total ? Math.round((kpis.operational / kpis.total) * 100) : 0;
  const statusCounts = systems.reduce<Record<string, number>>((counts, system) => {
    counts[system.status] = (counts[system.status] ?? 0) + 1;
    return counts;
  }, {});
  const systemDots = systems.slice(0, 36);
  const liveAlarms = [...alarms]
    .sort((left, right) => Number(left.acknowledged) - Number(right.acknowledged) || right.atISO.localeCompare(left.atISO))
    .slice(0, 6);

  function update(id: string, dispatch: boolean) {
    if (inFlight.current || (dispatch ? !canCreate : !canUpdate)) return;
    inFlight.current = true;
    setFeedback(null);
    start(async () => {
      try {
        const result = await (dispatch ? dispatchWoFromAlarm(id) : acknowledgeAlarm(id));
        if (!result.ok) { setFeedback(result.error); return; }
        setSelected(null);
        router.refresh();
        setFeedback(dispatch ? 'Created ' + result.ref + ' for triage. No technician assignment or external notification confirmed.' : 'Alarm acknowledgement recorded.');
      } catch {
        setFeedback('The update could not be confirmed. Refresh the record before retrying.');
      } finally { inFlight.current = false; }
    });
  }

  return <div className={styles.stack}>
    <Card className={styles.panel}>
      <CardHeader title="Building operations" subtitle={'Recorded snapshot · ' + date(new Date(nowMs).toISOString()) + ' · not a connected live sensor feed'} action={<StatusPill status={health.label} tone={health.band} />} />
      <div className={styles.summary}>
        <div className={styles.ring} role="meter" aria-label="Rules-based system health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health.score}>
          <svg width={96} height={96} viewBox="0 0 36 36" className="-rotate-90" aria-hidden="true"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3" /><circle cx="18" cy="18" r="15.5" fill="none" stroke={toneVar(health.band)} strokeWidth="3" strokeLinecap="round" strokeDasharray={String(Math.max(0, Math.min(100, health.score)) * .974) + ' 97.4'} /></svg>
          <span className={styles.ringLabel}><strong>{health.score}</strong><small>/ 100</small></span>
        </div>
        <div><h2 className={styles.title}>Your facility at a glance</h2><p className={styles.body}>{kpis.operational} of {kpis.total} building systems are marked operational or on standby. {open.length} alarm(s) remain unacknowledged.</p><p className={styles.metadata}>Rules-based system health · not a certified safety assessment</p></div>
      </div>
    </Card>
    <div className={styles.threeColumns}><KpiCard label="Recorded power source" value={kpis.powerSource} icon={<Plug size={18} />} /><KpiCard label="Water tank" value={kpis.waterPct + '%'} icon={<Droplet size={18} />} /><KpiCard label="Open alarms" value={String(open.length)} icon={<AlertTriangle size={18} />} iconColor={toneVar(open.length ? 'danger' : 'success')} /></div>
    <PageTabs label="Facility control center sections" items={[
      { id: 'overview', label: 'Overview', content: <div className={styles.overviewComposition}>
        <div className={styles.analyticsGrid}>
          <Card padded={false} className={styles.panel}>
            <div className={styles.panelHeader}><CardHeader title="Systems availability" subtitle="Recorded equipment state across the current facility scope" action={<StatusPill status={systemAvailability + '% available'} tone={systemAvailability >= 90 ? 'success' : systemAvailability >= 70 ? 'warn' : 'danger'} />} /></div>
            <div className={styles.insightBody}>
              <div className={styles.insightValue}><strong>{kpis.operational}</strong><span>of {kpis.total} systems operational or on standby</span></div>
              <div className={styles.availabilityTrack} role="img" aria-label={`${kpis.operational} of ${kpis.total} recorded systems are operational or on standby`}>
                {(['operational', 'standby', 'degraded', 'down'] as const).map((status) => {
                  const value = statusCounts[status] ?? 0;
                  return value ? <span key={status} style={{ width: `${kpis.total ? value / kpis.total * 100 : 0}%`, background: toneVar(STATUS_TONE[status]) }} /> : null;
                })}
              </div>
              <dl className={styles.statusLegend}>{(['operational', 'standby', 'degraded', 'down'] as const).map((status) => <div key={status}><dt><i style={{ background: toneVar(STATUS_TONE[status]) }} />{status}</dt><dd>{statusCounts[status] ?? 0}</dd></div>)}</dl>
            </div>
          </Card>
          <Card padded={false} className={styles.panel}>
            <div className={styles.panelHeader}><CardHeader title="Operating health" subtitle="Each marker represents one recorded building system" action={<StatusPill status={health.label} tone={health.band} />} /></div>
            <div className={styles.insightBody}>
              <div className={styles.insightValue}><strong>{health.score}</strong><span>rules-based health score out of 100</span></div>
              {systemDots.length ? <div className={styles.dotMatrix} role="img" aria-label={systemDots.map((system) => `${system.name}: ${system.status}`).join('; ')}>{systemDots.map((system) => <span key={system.id} title={`${system.name}: ${system.status}`} style={{ background: toneVar(STATUS_TONE[system.status] ?? 'neutral') }} />)}</div> : <p className={styles.notice}>No systems are recorded in the current scope.</p>}
              <p className={styles.metadata}>{sensors.length} sensor reading{sensors.length === 1 ? '' : 's'} recorded · this is not a connected live telemetry feed.</p>
            </div>
          </Card>
        </div>
        <Card padded={false} className={styles.panel}>
          <div className={styles.panelHeader}><CardHeader title="Live activity" subtitle="Latest recorded alarms, acknowledgement state and work-order handoff" action={<StatusPill status={open.length + ' open'} tone={open.length ? 'danger' : 'success'} />} /></div>
          {liveAlarms.length ? <ul className={styles.activityList}>{liveAlarms.map((alarm) => <li key={alarm.id}>
            <span className={styles.activityMarker} style={{ background: toneVar(SEVERITY_TONE[alarm.severity] ?? 'neutral') }} aria-hidden="true" />
            <div className={styles.activityCopy}><strong>{alarm.system}</strong><span>{alarm.message}</span></div>
            <div className={styles.activityMeta}><StatusPill status={alarm.acknowledged ? 'Acknowledged' : alarm.severity} tone={alarm.acknowledged ? 'muted' : SEVERITY_TONE[alarm.severity] ?? 'neutral'} /><time dateTime={alarm.atISO}>{date(alarm.atISO)}</time>{alarm.woRef ? <Link href={'/work-orders/' + encodeURIComponent(alarm.woRef)}>{alarm.woRef}</Link> : null}</div>
          </li>)}</ul> : <div className={styles.empty}><EmptyState icon={<ShieldCheck size={26} />} title="No alarms recorded" description="This recorded snapshot contains no alarms. It does not replace physical checks or live monitoring." /></div>}
        </Card>
      </div> },
      { id: 'sensors', label: 'Sensor readings', content: sensors.length ? <div className={styles.sensorGrid}>{sensors.map((sensor) => {
        const breach = (sensor.low !== undefined && sensor.value < sensor.low) || (sensor.high !== undefined && sensor.value > sensor.high);
        return <Card key={sensor.id} className={styles.panel}><CardHeader title={sensor.name} subtitle={sensor.siteName} action={<Gauge size={18} className="text-primary" />} /><div className={styles.stack}><span className={styles.number}>{sensor.text ?? String(sensor.value) + sensor.unit}</span><StatusPill status={breach ? 'Outside recorded threshold' : 'Recorded reading'} tone={breach ? 'danger' : 'info'} /><p className={styles.metadata}>{sensor.low !== undefined ? 'Low: ' + sensor.low + sensor.unit : 'No low threshold'} · {sensor.high !== undefined ? 'High: ' + sensor.high + sensor.unit : 'No high threshold'}</p>{['water_tank', 'fuel', 'occupancy'].includes(sensor.kind) ? <progress className={styles.progress} max={100} value={Math.max(0, Math.min(100, sensor.value))} aria-label={sensor.name + ' recorded percentage'} /> : null}</div></Card>;
      })}</div> : <Card><EmptyState icon={<Gauge size={26} />} title="No sensor readings" description="No readings are recorded for the facilities in your current scope." /></Card> },
      { id: 'systems', label: 'Building systems', content: <Card padded={false} className={styles.panel}><div className={styles.panelHeader}><CardHeader title="Building systems" subtitle="Recorded equipment state and operating notes" action={<StatusPill status={kpis.operational + '/' + kpis.total + ' available'} tone="info" />} /></div>{systems.length ? <div className={styles.scroll} role="region" tabIndex={0} aria-label="Building systems register"><table className={'pb-data-table ' + styles.table}><thead><tr>{['System', 'Location', 'Recorded state', 'Operating notes'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{systems.map((system) => <tr key={system.id}><td><p className={styles.rowTitle}>{system.name}</p><p className={styles.metadata}>{system.category.replaceAll('_', ' ')}</p></td><td>{system.siteName || 'Not recorded'}</td><td><StatusPill status={system.status.replaceAll('_', ' ')} tone={STATUS_TONE[system.status] ?? 'neutral'} /></td><td><p className={styles.body}>{system.detail || 'No operating note recorded.'}</p></td></tr>)}</tbody></table></div> : <div className={styles.empty}><EmptyState icon={<Zap size={26} />} title="No building systems" description="No equipment is recorded in your current scope." /></div>}<p className={styles.footer}>Status labels reflect application records. They do not confirm live telemetry or physical equipment safety.</p></Card> },
      { id: 'alarms', label: 'Alarms', count: open.length, content: <Card padded={false} className={styles.panel}><div className={styles.panelHeader}><CardHeader title="Alarm register" subtitle="Review the message, acknowledgement and work-order follow-up" action={<StatusPill status={open.length + ' unacknowledged'} tone={open.length ? 'danger' : 'success'} />} /></div>{alarms.length ? <ul className={styles.list}>{alarms.map((alarm) => <li key={alarm.id} className={styles.row}><div className={styles.rowContent}><div className={styles.toolbar}><h3 className={styles.rowTitle}>{alarm.system}</h3><StatusPill status={alarm.severity} tone={SEVERITY_TONE[alarm.severity] ?? 'neutral'} /></div><p className={styles.body}>{alarm.message}</p><p className={styles.metadata}>{date(alarm.atISO)} · {alarm.acknowledged ? 'Acknowledged' : 'Awaiting acknowledgement'}{alarm.woRef ? <> · <Link href={'/work-orders/' + encodeURIComponent(alarm.woRef)} className="text-primary underline">{alarm.woRef}</Link></> : null}</p></div>{!alarm.acknowledged && (canCreate || canUpdate) ? <div className={styles.actions}>{canCreate && !alarm.woRef ? <Button variant="primary" disabled={pending} icon={<Send size={16} />} onClick={() => { setFeedback(null); setSelected(alarm); }}>Create work order</Button> : null}{canUpdate ? <Button disabled={pending} icon={<Check size={16} />} onClick={() => update(alarm.id, false)}>Acknowledge</Button> : null}</div> : null}</li>)}</ul> : <div className={styles.empty}><EmptyState icon={<ShieldCheck size={26} />} title="No alarms recorded" description="This is a recorded snapshot, not a live all-clear signal." /></div>}<p className={styles.footer}>Creating a work order records an unassigned job for triage. It does not confirm a technician dispatch or external notification.</p></Card> },
    ]} />
    {selected ? <FacilityDialog title="Create work order from alarm" onClose={() => setSelected(null)} pending={pending}><div className={styles.stack}><p className={styles.title}>{selected.system}</p><p className={styles.body}>{selected.message}</p><p className={styles.body}>Creates a new, unassigned work order and acknowledges the alarm. A manager must triage and assign the job. This does not confirm an external notification to a field team.</p>{feedback ? <p role="alert" className="text-[14px] text-negative">{feedback}</p> : null}<div className={styles.actions}><Button disabled={pending} onClick={() => setSelected(null)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => update(selected.id, true)}>{pending ? 'Creating…' : 'Confirm work order'}</Button></div></div></FacilityDialog> : feedback ? <FacilityFeedback message={feedback} onDismiss={() => setFeedback(null)} /> : null}
  </div>;
}
