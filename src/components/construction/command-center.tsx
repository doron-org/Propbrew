'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HardHat, TriangleAlert, Truck, Users, Banknote, Check, ArrowRight, ChartNoAxesCombined, CalendarDays, Package, FileText, Info } from 'lucide-react';
import { Button, StatusPill } from '@/components/ui';
import { toneVar, type Tone } from '@/lib/status-tones';
import { RISK_LABEL, type RiskKind } from '@/domain/construction';
import { acknowledgeSignal } from '@/server/actions/construction';
import { PageTabs } from '@/components/ui/page-tabs';
import { useConstructionReview, ConstructionSummary, ConstructionPanel, ConstructionToast, ConstructionKpi as Kpi, constructionNaira as naira, ConstructionFrame, ConstructionPanelHeader, ConstructionEmpty } from './construction-ui';
import styles from './construction-overview-polish.module.css';

export type SignalRow = { id: string; kind: RiskKind; projectName: string; severity: Tone; confidence: number; title: string; evidence: string; recommendation: string; nairaAtRiskMinor: number; href: string; state?: string };
export type ProjectRow = { id: string; name: string; code: string; status: string; percentComplete: number; plannedPercent: number; cpi: number; spi: number; costBand: Tone; scheduleBand: Tone; eacMinor: number; bacMinor: number; curve: { pv: number; ev: number }[]; onSite: number; planned: number; forecastFinishISO: string; slipDays: number };
export type DeliveryRow = { ref: string; item: string; vendorName: string; expectedISO: string; qty: number; deliveredQty: number; unit: string; late: boolean };

function dateOnly(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00+01:00`);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
}

export function CommandCenter({ confidence, projects, signals, deliveries, kpis, canMutate }: {
  confidence: { score: number; band: Tone; label: string; nairaAtRiskMinor: number };
  projects: ProjectRow[]; signals: SignalRow[]; deliveries: { late: DeliveryRow[]; today: DeliveryRow[]; upcoming: DeliveryRow[] };
  kpis: { activeProjects: number; onSite: number; plannedCrew: number; openPoValueMinor: number; criticalSignals: number };
  canMutate: boolean;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const flash = (message: string) => { setToast(message); setTimeout(() => setToast(null), 2600); };
  const { act, confirmation, pending } = useConstructionReview(() => router.refresh(), flash);
  const ack = (id: string) => {
    const signal = signals.find((item) => item.id === id);
    act(() => acknowledgeSignal(id), `Acknowledge ${signal?.title ?? 'signal'}`, `${signal?.projectName ?? 'Construction'}: this records your acknowledgement only. It does not resolve the underlying construction risk.`);
  };
  const activeSignals = signals.filter((signal) => signal.state !== 'dismissed' && signal.state !== 'snoozed');
  const deliveryRows = [
    ...deliveries.late.map((delivery) => ({ delivery, tag: 'Late' as const, tone: 'danger' as const })),
    ...deliveries.today.map((delivery) => ({ delivery, tag: 'Due today' as const, tone: 'progress' as const })),
    ...deliveries.upcoming.map((delivery) => ({ delivery, tag: 'Upcoming' as const, tone: 'info' as const })),
  ];
  const averageProgress = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.percentComplete, 0) / projects.length) : 0;
  const averagePlan = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.plannedPercent, 0) / projects.length) : 0;
  const projectsOnPlan = projects.filter((project) => project.percentComplete >= project.plannedPercent).length;
  const reliabilityPct = projects.length ? Math.round(projectsOnPlan / projects.length * 100) : 0;
  const reliableDots = Math.round(reliabilityPct / 100 * 40);
  const liveActivity = [
    ...activeSignals.map((signal) => ({ id: `signal-${signal.id}`, title: signal.title, detail: `${signal.projectName} · ${signal.evidence}`, status: RISK_LABEL[signal.kind], tone: signal.severity, href: signal.href })),
    ...deliveryRows.map(({ delivery, tag, tone }) => ({ id: `delivery-${delivery.ref}-${tag}`, title: delivery.item, detail: `${delivery.vendorName} · ${delivery.deliveredQty}/${delivery.qty} ${delivery.unit} · ${dateOnly(delivery.expectedISO)}`, status: tag, tone, href: '/construction/procurement' })),
  ].slice(0, 8);
  return (
    <ConstructionFrame>
      <ConstructionSummary>
        <div className={styles.summary}>
          <Ring score={confidence.score} band={confidence.band} />
          <div className={styles.summaryCopy}>
            <p className={styles.eyebrow}>Construction portfolio · recorded snapshot</p>
            <h2>Delivery confidence · <span style={{ color: toneVar(confidence.band) }}>{confidence.label}</span></h2>
            <p className={styles.body}>{kpis.activeProjects} active project{kpis.activeProjects === 1 ? '' : 's'} · {kpis.onSite}/{kpis.plannedCrew} crew on site</p>
            <p className={styles.metadata}>A rules-based view of recorded delivery risk. Check site evidence before acting.</p>
          </div>
          <div className={styles.summaryFact}><span>Recorded value at risk</span><strong>{naira(confidence.nairaAtRiskMinor)}</strong><Link href="/construction/risk" className={styles.inlineLink}>Review risk radar <ArrowRight size={16} aria-hidden="true" /></Link></div>
        </div>
      </ConstructionSummary>
      <PageTabs label="Construction overview sections" items={[
        { id: 'overview', label: 'Overview', content: <div className="pb-section">
          <div className={styles.metrics}>
            <Kpi label="Active projects" value={String(kpis.activeProjects)} tone="info" icon={<HardHat size={16} />} />
            <Kpi label="Crew on site" value={`${kpis.onSite}/${kpis.plannedCrew}`} tone={kpis.onSite >= kpis.plannedCrew ? 'success' : 'warn'} icon={<Users size={16} />} />
            <Kpi label="Open PO value" value={naira(kpis.openPoValueMinor)} tone="progress" icon={<Banknote size={16} />} />
            <Kpi label="Critical signals" value={String(kpis.criticalSignals)} tone={kpis.criticalSignals ? 'danger' : 'success'} icon={<TriangleAlert size={16} />} />
          </div>
          <div className={styles.insightGrid}>
            <ConstructionPanel className={styles.insightPanel}>
              <ConstructionPanelHeader title="Delivery trajectory" subtitle="Average recorded progress against the approved programme" />
              <div className={styles.insightBody}>
                <div className={styles.insightValue}><strong>{averageProgress}%</strong><span>portfolio progress · {averagePlan}% planned</span></div>
                {projects.length ? <PortfolioSpark projects={projects} /> : <p className={styles.metadata}>No project progress curve is recorded yet.</p>}
                <div className={styles.trajectoryLegend}><span><i style={{ background: toneVar('progress') }} />Earned / completed</span><span><i className={styles.plannedLine} />Planned</span></div>
              </div>
            </ConstructionPanel>
            <ConstructionPanel className={styles.insightPanel}>
              <ConstructionPanelHeader title="Project reliability" subtitle="Projects at or ahead of their recorded plan" />
              <div className={styles.insightBody}>
                <div className={styles.insightValue}><strong>{reliabilityPct}%</strong><span>{projectsOnPlan} of {projects.length} projects at or ahead of plan</span></div>
                <div className={styles.dotMatrix} role="img" aria-label={`${reliabilityPct}% of recorded projects are at or ahead of plan, shown proportionally across 40 markers`}>{Array.from({ length: 40 }, (_, index) => <span key={index} data-filled={index < reliableDots ? 'true' : undefined} />)}</div>
                <p className={styles.metadata}>Calculated from recorded completion versus planned completion; site evidence remains the source of truth.</p>
              </div>
            </ConstructionPanel>
          </div>
          <ConstructionPanel>
            <ConstructionPanelHeader title="Live activity" subtitle="Latest construction risks and procurement movements"><Link href="/construction/risk" className={styles.actionLink}>Open risk radar <ArrowRight size={16} aria-hidden="true" /></Link></ConstructionPanelHeader>
            {liveActivity.length ? <ul className={styles.activityList}>{liveActivity.map((activity) => <li key={activity.id}>
              <span className={styles.activityMarker} style={{ background: toneVar(activity.tone) }} aria-hidden="true" />
              <div className={styles.activityCopy}><strong>{activity.title}</strong><span>{activity.detail}</span></div>
              <div className={styles.activityAction}><StatusPill status={activity.status} tone={activity.tone} /><Link href={activity.href} aria-label={`Open source for ${activity.title}`}><ArrowRight size={16} aria-hidden="true" /></Link></div>
            </li>)}</ul> : <ConstructionEmpty title="No live activity recorded" description="No active risk signals or open delivery movements are present in this recorded scope." />}
          </ConstructionPanel>
          <ConstructionPanel>
            <ConstructionPanelHeader title="Portfolio readiness" subtitle="Start with the source records behind the portfolio totals." />
            <div className={styles.readiness}>
              <Link href="/construction/projects"><HardHat size={20} aria-hidden="true" /><div><strong>{projects.length} project record{projects.length === 1 ? '' : 's'}</strong><p>Compare progress, cost posture and recorded crew.</p></div><ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/construction/procurement"><Truck size={20} aria-hidden="true" /><div><strong>{deliveries.late.length} late deliver{deliveries.late.length === 1 ? 'y' : 'ies'}</strong><p>{deliveries.today.length} due today · {deliveries.upcoming.length} upcoming.</p></div><ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/construction/risk"><TriangleAlert size={20} aria-hidden="true" /><div><strong>{activeSignals.length} active signal{activeSignals.length === 1 ? '' : 's'}</strong><p>Review evidence, recommendations and acknowledgement state.</p></div><ArrowRight size={18} aria-hidden="true" /></Link>
            </div>
            <div className={styles.footnote}><Info size={16} aria-hidden="true" />No signals recorded does not independently confirm that a project is on plan. Open purchase orders are commitments, not confirmed payments.</div>
          </ConstructionPanel>
        </div> },
        { id: 'operations', label: 'Projects & deliveries', content: <div className="pb-section">
          <div className={styles.operations}>
            <ConstructionPanel>
              <ConstructionPanelHeader title="Projects" subtitle={`${projects.length} project records · progress and commercial posture`}><Link href="/construction/projects" className={styles.actionLink}>Open register <ArrowRight size={16} aria-hidden="true" /></Link></ConstructionPanelHeader>
              <div className={styles.recordList}>
                {projects.map((project) => <article key={project.id} className={styles.project}>
                  <div className={styles.recordHeading}><div><p className={styles.metadata}>{project.code}</p><h3>{project.name}</h3></div><span className={styles.badge}><StatusPill status={project.status.replaceAll('_', ' ')} tone={project.status === 'active' ? 'progress' : 'muted'} /></span></div>
                  <div className={styles.projectProgress}><span><strong>{project.percentComplete}%</strong> complete</span><span>{project.plannedPercent}% planned</span></div>
                  <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.percentComplete} aria-label={`${project.name}: ${project.percentComplete}% complete, ${project.plannedPercent}% planned`}><span style={{ width: `${Math.max(0, Math.min(100, project.percentComplete))}%` }} /></div>
                  <dl className={styles.facts}>
                    <div><dt>Crew on site</dt><dd>{project.onSite}/{project.planned}</dd></div>
                    <div><dt>Forecast finish</dt><dd>{dateOnly(project.forecastFinishISO)}<small>{project.slipDays > 0 ? `${project.slipDays}d later than plan` : project.slipDays < 0 ? `${Math.abs(project.slipDays)}d earlier than plan` : 'Aligned with plan'}</small></dd></div>
                    <div><dt>Forecast final cost (EAC)</dt><dd>{naira(project.eacMinor)}</dd></div>
                    <div><dt>Approved budget (BAC)</dt><dd>{naira(project.bacMinor)}</dd></div>
                  </dl>
                  <div className={styles.projectFooter}><Spark curve={project.curve} /><div className={styles.badges}><span className={styles.badge}><StatusPill status={`CPI ${project.cpi}`} tone={project.costBand} /></span><span className={styles.badge}><StatusPill status={`SPI ${project.spi}`} tone={project.scheduleBand} /></span></div></div>
                </article>)}
                {projects.length === 0 && <ConstructionEmpty title="No project records" />}
              </div>
              <p className={styles.footnote}>CPI compares earned value with actual cost; SPI compares earned value with planned value. Mini curves illustrate recorded totals, rather than a measured history.</p>
            </ConstructionPanel>
            <ConstructionPanel>
              <ConstructionPanelHeader title="Delivery radar" subtitle={`${deliveryRows.length} recorded open deliveries`}><Link href="/construction/procurement" className={styles.actionLink}>Procurement <ArrowRight size={16} aria-hidden="true" /></Link></ConstructionPanelHeader>
              <div className={styles.recordList}>
                {deliveryRows.map(({ delivery, tag, tone }, index) => <article key={`${delivery.ref}-${index}`} className={styles.delivery}>
                  <div className={styles.recordHeading}><span className={styles.recordIcon} style={{ color: toneVar(tone) }}><Truck size={20} aria-hidden="true" /></span><div className={styles.grow}><p className={styles.metadata}>{delivery.ref}</p><h3>{delivery.item}</h3></div><span className={styles.badge}><StatusPill status={tag} tone={tone} /></span></div>
                  <p className={styles.body}>{delivery.vendorName}</p>
                  <dl className={styles.facts}><div><dt>Delivered / ordered</dt><dd>{delivery.deliveredQty}/{delivery.qty} {delivery.unit}</dd></div><div><dt>Expected on</dt><dd>{dateOnly(delivery.expectedISO)}</dd></div></dl>
                </article>)}
                {deliveryRows.length === 0 && <ConstructionEmpty title="No open deliveries" description="There are no late, due-today or upcoming deliveries in the current recorded scope." />}
              </div>
            </ConstructionPanel>
          </div>
        </div> },
        { id: 'attention', label: 'Attention feed', content: <div className="pb-section">
          <ConstructionPanel>
            <ConstructionPanelHeader title="What needs you today" subtitle={`${activeSignals.length} active signals · ranked by ₦ at risk · advisory`}><Link href="/construction/risk" className={styles.actionLink}>Risk radar <ArrowRight size={16} aria-hidden="true" /></Link></ConstructionPanelHeader>
            <div className={styles.recordList}>
              {activeSignals.map((signal) => <article key={signal.id} className={styles.signal}>
                <div className={styles.recordHeading}><div className={styles.grow}><p className={styles.metadata}>{signal.projectName}</p><h3>{signal.title}</h3></div><div className={styles.badges}><span className={styles.badge}><StatusPill status={RISK_LABEL[signal.kind]} tone={signal.severity} /></span><span className={styles.badge}><StatusPill status={signal.state === 'ack' ? 'Acknowledged' : 'Needs review'} tone={signal.state === 'ack' ? 'muted' : signal.severity} /></span></div></div>
                <dl className={styles.evidence}><div><dt>Recorded evidence</dt><dd>{signal.evidence}</dd></div><div><dt>Recommended review</dt><dd>{signal.recommendation}</dd></div></dl>
                <div className={styles.signalFooter}><div><span className={styles.metadata} title="Rules-based match strength, not a probability">Rule match {Math.round(signal.confidence * 100)}%</span>{signal.nairaAtRiskMinor > 0 && <p className={styles.body}>Value at risk <strong>{naira(signal.nairaAtRiskMinor)}</strong></p>}</div><div className={styles.actions}><Link href={signal.href} className={styles.actionLink} aria-label={`Open source for ${signal.title}`}>Open source <ArrowRight size={16} aria-hidden="true" /></Link>{canMutate && signal.state !== 'ack' && <Button type="button" disabled={pending} icon={<Check size={16} />} onClick={() => ack(signal.id)}>Acknowledge</Button>}</div></div>
              </article>)}
              {activeSignals.length === 0 && <ConstructionEmpty title="No active signals recorded" description="This does not independently confirm that every project is on plan. Review site records and reporting coverage." />}
            </div>
          </ConstructionPanel>
        </div> },
        { id: 'explore', label: 'Explore insights', content: <div className="pb-section">
          <ConstructionPanel><ConstructionPanelHeader title="Go deeper into the build" subtitle="Review the operating records behind your next decision." /><div className={styles.explore}>
            {[{ label: 'Earned value', href: '/construction/evm', text: 'Inspect cost performance, forecasts and the cash requirement.', icon: ChartNoAxesCombined }, { label: 'Critical path', href: '/construction/schedule', text: 'Trace zero-float tasks, dependencies and milestones.', icon: CalendarDays }, { label: 'Materials & leakage', href: '/construction/materials', text: 'Compare recorded stock, usage and potential exceptions.', icon: Package }, { label: 'Weekly digest', href: '/construction/digest', text: 'Review source coverage before publishing a progress digest.', icon: FileText }].map(({ label, href, text, icon: Icon }) => <Link key={href} href={href}><span className={styles.recordIcon}><Icon size={22} aria-hidden="true" /></span><h3>{label}</h3><p>{text}</p><span className={styles.inlineLink}>Open workspace <ArrowRight size={16} aria-hidden="true" /></span></Link>)}
          </div></ConstructionPanel>
        </div> },
      ]} />
      {confirmation}
      {toast && <ConstructionToast>{toast}</ConstructionToast>}
    </ConstructionFrame>
  );
}

/** Portfolio-level planned and earned curve derived only from recorded project curve points. */
function PortfolioSpark({ projects }: { projects: ProjectRow[] }) {
  const w = 560, h = 150, pad = 8;
  const length = Math.max(1, ...projects.map((project) => project.curve.length));
  const aggregate = Array.from({ length }, (_, index) => {
    const points = projects.map((project) => project.curve[Math.min(index, Math.max(0, project.curve.length - 1))]).filter(Boolean);
    return {
      pv: points.length ? points.reduce((sum, point) => sum + point.pv, 0) / points.length : 0,
      ev: points.length ? points.reduce((sum, point) => sum + point.ev, 0) / points.length : 0,
    };
  });
  const max = Math.max(1, ...aggregate.flatMap((point) => [point.pv, point.ev]));
  const path = (key: 'pv' | 'ev') => aggregate.map((point, index) => `${index === 0 ? 'M' : 'L'}${pad + (index / Math.max(1, aggregate.length - 1)) * (w - pad * 2)},${h - pad - (point[key] / max) * (h - pad * 2)}`).join(' ');
  return <svg className={styles.portfolioSpark} role="img" aria-label="Portfolio planned and earned value trajectory derived from recorded project curves" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><path d={path('pv')} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="6 5" /><path d={path('ev')} fill="none" stroke={toneVar('progress')} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Illustrative planned-vs-earned curve; both series share the same scale. */
function Spark({ curve }: { curve: { pv: number; ev: number }[] }) {
  const w = 150, h = 36, pad = 3;
  const max = Math.max(1, ...curve.flatMap((point) => [point.pv, point.ev]));
  const path = (key: 'pv' | 'ev') => curve.map((point, index) => `${index === 0 ? 'M' : 'L'}${pad + (index / Math.max(1, curve.length - 1)) * (w - pad * 2)},${h - pad - (point[key] / max) * (h - pad * 2)}`).join(' ');
  return <svg role="img" aria-label="Illustrative planned and earned value curve derived from the recorded totals" width={w} height={h}><path d={path('pv')} fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="3 2" /><path d={path('ev')} fill="none" stroke={toneVar('progress')} strokeWidth="2" strokeLinecap="round" /></svg>;
}

function Ring({ score, band }: { score: number; band: Tone }) {
  const color = toneVar(band);
  return <div className={styles.ring} role="img" aria-label={`Rules-based delivery score: ${score} out of 100`}><svg width={88} height={88} viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3" /><circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(score / 100) * 97.4} 97.4`} /></svg><div><strong style={{ color }}>{score}</strong><span>out of 100</span></div></div>;
}
