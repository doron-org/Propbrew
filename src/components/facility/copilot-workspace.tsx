'use client';

import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Search, Zap, Package, ShieldAlert, FileText, AlertTriangle, Cpu, Coins, Activity, Gauge } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, KpiCard, StatusPill } from '@/components/ui';
import { PageTabs } from '@/components/ui/page-tabs';
import { CopilotComposer, CopilotConversation, CopilotEmpty, CopilotFrame, CopilotLayout, CopilotMessage, CopilotPanel, CopilotSafeguards, CopilotSuggestions, CopilotSummary } from '@/components/ai/copilot-reference';
import { CopilotStreamReply } from '@/components/ai/copilot-stream-reply';
import { useCopilotAutoScroll, useCopilotStream } from '@/components/ai/use-copilot-stream';
import { FacilityDialog, FacilityFeedback } from './facility-ui';
import { facilityMoney } from './facility-format';
import layout from '@/components/ui/workspace-layout.module.css';
import styles from './copilot-workspace.module.css';
import { toneVar, type Tone } from '@/lib/status-tones';
import { copilotInsights, COPILOT_MODELS, COPILOT_RATE_PER_MIN, copilotModel, type CopilotWorld, type Insight } from '@/domain/facility';
import { dispatchWoFromAlarm, acknowledgeAlarm, receiveStock, logRefuel, setCopilotModel } from '@/server/actions/facility';
import type { CopilotModule } from '@/lib/ai/copilot-protocol';

const SEV_TONE: Record<Insight['severity'], Tone> = { critical: 'danger', warning: 'warn', info: 'info' };
const CAT_ICON: Record<string, React.ReactNode> = { Alarm: <AlertTriangle size={18} />, Energy: <Zap size={18} />, Inventory: <Package size={18} />, Contracts: <FileText size={18} />, Safety: <ShieldAlert size={18} /> };
const SUGGESTIONS = ['What needs me right now?', 'How is our diesel and fuel?', 'Which contracts are expiring?', 'Any parts below reorder?', "What's our carbon and spend?"];
type Usage = { requests: number; inputTokens: number; outputTokens: number; costMinorNgn: number };

export function CopilotWorkspace({ world, userName, model, usage, canConfigure, canCreate = false, canUpdate = false, endpoint = '/api/copilot', module = 'facility' }: { world: CopilotWorld; userName: string; model: string; usage: Usage | null; canConfigure: boolean; canCreate?: boolean; canUpdate?: boolean; endpoint?: string; module?: Extract<CopilotModule, 'estate' | 'facility'> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('conversation');
  const [review, setReview] = useState<Insight | null>(null);
  const { exchanges: thread, busy: asking, submit, stop, retry } = useCopilotStream({ endpoint, module, onComplete: (exchange) => { if (exchange.usage?.recorded) router.refresh(); } });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const actionRef = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const insights = useMemo(() => copilotInsights(world), [world]);
  const counts = { critical: insights.filter((i) => i.severity === 'critical').length, warning: insights.filter((i) => i.severity === 'warning').length };
  const shown = insights.filter((i) => (filter === 'all' || i.severity === filter) && (i.title + ' ' + i.detail + ' ' + i.category).toLowerCase().includes(search.trim().toLowerCase()));
  const canReview = (insight: Insight) => !!insight.action.refId && (insight.action.kind === 'dispatch_alarm' ? canCreate : ['ack_alarm', 'reorder_part', 'refuel_gen'].includes(insight.action.kind) && canUpdate);

  useCopilotAutoScroll(log, thread);

  function ask(question: string) {
    const query = question.trim();
    if (!query || asking || pending) return;
    setSection('conversation'); setQ('');
    void submit(query);
  }

  function runAction(insight: Insight) {
    if (pending || actionRef.current || !canReview(insight)) return;
    actionRef.current = true;
    start(async () => {
      try {
        let result: { ok: boolean; error?: string; ref?: string } = { ok: false, error: 'The source record is no longer available. Refresh before acting.' };
        const refId = insight.action.refId!;
        if (insight.action.kind === 'dispatch_alarm') result = await dispatchWoFromAlarm(refId);
        else if (insight.action.kind === 'ack_alarm') result = await acknowledgeAlarm(refId);
        else if (insight.action.kind === 'reorder_part') {
          const part = world.parts.find((item) => item.id === refId);
          if (part) result = await receiveStock(refId, Math.max(part.reorderPoint * 2 - part.stock, part.usedPerMonth));
        } else if (insight.action.kind === 'refuel_gen') {
          const generator = world.generators.find((item) => item.id === refId);
          if (generator) result = await logRefuel(refId, Math.round(generator.tankLitres * (100 - generator.fuelPct) / 100));
        }
        if (result.ok) { setReview(null); router.refresh(); setToast(result.ref ? 'Work order created for triage · ' + result.ref : 'Operational record updated. No purchase, payment or external dispatch was confirmed.'); }
        else setToast(result.error ?? 'The update could not be confirmed.');
      } catch { setToast('The update could not be confirmed. Refresh before retrying.'); }
      finally { actionRef.current = false; }
    });
  }

  const context = <CopilotPanel title="Context & controls" subtitle="The records available to this facility briefing">
      <div className={styles.context}>
        <dl className={styles.contextSources}>{[['Building systems', world.systems.length], ['Alarms', world.alarms.length], ['Generators', world.generators.length], ['Parts', world.parts.length], ['Contracts', world.contracts.length], ['Permits', world.permits.length], ['Incidents', world.incidents.length], ['Sensors', world.sensors.length]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className={layout.footnote}>Snapshot · {new Date(world.nowMs).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })} WAT. Not a connected live sensor feed.</p>
        <ModelPicker key={model} model={model} canConfigure={canConfigure} onToast={setToast} />
      </div>
    </CopilotPanel>;

  return <CopilotFrame>
    <CopilotSummary eyebrow="Facility Copilot · scoped record context" title="Ask about your facility" description={'Good day, ' + userName.split(' ')[0] + '. ' + (insights.length ? insights.length + ' recorded priorities to review across your facility, including ' + counts.critical + ' critical and ' + counts.warning + ' warning signals.' : 'No priority signals were found in this snapshot. This is not confirmation that every system is healthy.')} note="A connected AI provider is required for conversation. Ask in your own words about the supplied facility context. Priority actions remain recorded rules and require their existing human review." />
    <PageTabs label="Facility AI copilot sections" activeTab={section} onTabChange={setSection} items={[
      { id: 'conversation', label: 'Ask Copilot', count: thread.length, content: <CopilotLayout
        conversation={<CopilotPanel title="Facility conversation" subtitle="Visible activity reports application steps, not private model reasoning." action={<StatusPill status={asking ? 'Request in progress' : 'Ready for a question'} tone={asking ? 'progress' : 'neutral'} />}>
          <CopilotConversation label="Facility copilot conversation" busy={asking} logRef={log}>
            {thread.length ? thread.map((message) => <Fragment key={message.id}>
              <CopilotMessage speaker="you">{message.question}</CopilotMessage>
              <CopilotStreamReply exchange={message} name="Facility Copilot" busy={asking || pending} onRetry={(id) => { void retry(id); }} />
            </Fragment>) : <CopilotEmpty title="Start with a question" description="Ask about fuel, contracts, stock, safety or carbon in your recorded facility operations." />}
          </CopilotConversation>
          <CopilotComposer label="Ask the facility copilot" value={q} onChange={setQ} onSubmit={ask} busy={asking} onStop={stop} disabled={pending} inputRef={composer} maxLength={2000} placeholder="Ask about your recorded facility operations…" hint="AI can make mistakes; verify its sources. Asking a question does not update operational records." />
        </CopilotPanel>}
        sidebar={<><CopilotSuggestions items={SUGGESTIONS} disabled={asking || pending} onSelect={(suggestion) => { setQ(suggestion); composer.current?.focus(); }} note="Selecting a suggestion prepares a question—it does not send it. Choose Ask Copilot when your draft is ready." />{context}</>}
      /> },
      { id: 'priorities', label: 'Priority actions', count: insights.length, content: <div className={layout.layout}>
        <div className={layout.metrics}><KpiCard label="Recorded priorities" value={String(insights.length)} icon={<Sparkles size={18} />} /><KpiCard label="Critical signals" value={String(counts.critical)} icon={<ShieldAlert size={18} />} iconColor={toneVar('danger')} /><KpiCard label="Warning signals" value={String(counts.warning)} icon={<AlertTriangle size={18} />} iconColor={toneVar('warn')} /><KpiCard label="Recorded requests" value={usage ? usage.requests.toLocaleString('en-NG') : 'Unavailable'} icon={<Activity size={18} />} /></div>
        <Card padded={false} className={layout.panel}><div className={layout.registerHeader}><CardHeader title="Priority actions" subtitle="Rules-based attention signals, ranked from the recorded snapshot" action={<StatusPill status={insights.length + ' recorded'} tone="neutral" />} /><div className={layout.toolbar}><div className={layout.filters} aria-label="Priority severity">{(['all', 'critical', 'warning', 'info'] as const).map((value) => <Button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All priorities' : value === 'info' ? 'Information' : value === 'critical' ? 'Critical' : 'Warnings'}</Button>)}</div><label className={layout.search}><Search size={16} /><input type="search" aria-label="Search copilot priorities" placeholder="Search priorities…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div></div>
        {shown.length ? <div className="pb-table-scroll" role="region" tabIndex={0} aria-label="Facility copilot priority register"><table className={'pb-data-table ' + styles.priorityTable}><thead><tr><th scope="col">Priority</th><th scope="col">Recorded signal & guidance</th><th scope="col">Category</th><th scope="col">Next step</th></tr></thead><tbody>{shown.map((insight) => <tr key={insight.id}><td><StatusPill status={insight.severity} tone={SEV_TONE[insight.severity]} /></td><td><span className={layout.title}>{insight.title}</span><p className={layout.body + ' mt-1'}>{insight.detail}</p></td><td><span className={styles.category}>{CAT_ICON[insight.category] ?? <Sparkles size={18} />}{insight.category}</span></td><td>{canReview(insight) ? <Button type="button" disabled={pending || asking} aria-label={'Review action for ' + insight.title} onClick={() => { setToast(null); setReview(insight); }}>Review action</Button> : <span className={layout.metadata}>{insight.action.kind === 'none' ? 'Manager review' : 'Read-only'}</span>}</td></tr>)}</tbody></table></div> : <EmptyState title={insights.length ? 'No priorities match these filters' : 'No priority signals in this snapshot'} description={insights.length ? 'Try another severity or search term.' : 'An empty rules result is not a certified safety or service-health assessment.'} />}
        <p className={layout.registerFooter}>Showing {shown.length} of {insights.length} priorities · Reviewing a recommendation does not execute it.</p>
      </Card></div> },
      { id: 'usage', label: 'Usage & cost', content: <UsageMeter usage={usage} model={model} /> },
      { id: 'safeguards', label: 'Safeguards', content: <CopilotSafeguards items={[
        { title: 'Check the recorded context', text: 'The briefing uses the facility records available in this scope and snapshot. Rule context labels are not independent citations. Verify the original alarm, stock, fuel, contract or safety record before relying on an answer.' },
        { title: 'Recognise the answer method', text: 'AI answers are labelled only after the server confirms the provider. Expand activity to review real application stages, not private model reasoning. Provider failures stay visible; no built-in answer is substituted. Model selection does not verify sensor freshness or system health. Usage and spend are estimates, not provider invoices.' },
        { title: 'Review before a record changes', text: 'Questions and suggested drafts do not execute actions. Eligible priority actions require a separate review and confirmation, with your existing permissions. Stock receipts and refuels must reflect actual deliveries; no purchase, payment or external dispatch is confirmed.' },
      ]} /> },
    ]} />

    {review && <FacilityDialog title="Review copilot recommendation" onClose={() => setReview(null)} pending={pending}><StatusPill status={review.category} tone="info" /><p className={layout.title}>{review.title}</p><p className={layout.body}>{review.detail}</p><ActionSummary insight={review} world={world} />{toast && <p role="alert" className="text-sm text-negative">{toast}</p>}<div className={layout.actions}><Button type="button" disabled={pending} onClick={() => setReview(null)}>Cancel</Button><Button type="button" variant="primary" disabled={pending || !canReview(review)} onClick={() => runAction(review)}>{pending ? 'Saving…' : 'Confirm recorded action'}</Button></div></FacilityDialog>}
    {toast && !review && <FacilityFeedback message={toast} onDismiss={() => setToast(null)} />}
  </CopilotFrame>;
}

function ActionSummary({ insight, world }: { insight: Insight; world: CopilotWorld }) {
  if (insight.action.kind === 'reorder_part') {
    const part = world.parts.find((item) => item.id === insight.action.refId);
    return <div className={layout.notice}><Package size={18} /><p>Record receipt{part && <span>{Math.max(part.reorderPoint * 2 - part.stock, part.usedPerMonth)} recorded units · {part.name}</span>}<span>Confirm the goods have physically arrived. This updates recorded stock; it does not place a supplier order, verify delivery evidence or pay a vendor.</span></p></div>;
  }
  if (insight.action.kind === 'refuel_gen') {
    const generator = world.generators.find((item) => item.id === insight.action.refId);
    return <div className={layout.notice}><Zap size={18} /><p>Record refuel{generator && <span>{Math.round(generator.tankLitres * (100 - generator.fuelPct) / 100)} litres · {generator.name}</span>}<span>Suggested fill-to-capacity amount. Confirm the actual delivery before recording it; this does not buy fuel or pay a supplier.</span></p></div>;
  }
  return <p className={layout.body}>{insight.action.kind === 'dispatch_alarm' ? 'Creates an unassigned work order for triage and acknowledges the alarm. No field-team notification or attendance is confirmed.' : 'Records acknowledgement of the selected alarm.'}</p>;
}

function ModelPicker({ model, canConfigure, onToast }: { model: string; canConfigure: boolean; onToast: (message: string) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(model);
  const [reviewing, setReviewing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = copilotModel(model);
  function save() {
    if (!canConfigure || inFlight.current) return;
    inFlight.current = true; setError(null);
    start(async () => { try { const result = await setCopilotModel(draft); if (!result.ok) { setError(result.error ?? 'The model selection could not be saved.'); return; } setReviewing(false); router.refresh(); onToast('Recorded model selection: ' + copilotModel(draft).label + '. Provider routing must be verified separately.'); } catch { setError('The model selection could not be confirmed. Refresh before retrying.'); } finally { inFlight.current = false; } });
  }
  return <div className={styles.modelControls}><label className={layout.field}><span className={layout.label}>Copilot model</span>{canConfigure ? <select className={layout.select} aria-label="Copilot model" value={draft} disabled={pending} onChange={(event) => setDraft(event.target.value)}>{COPILOT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.tier}</option>)}</select> : <span className={layout.body}>{current.label} · View only</span>}</label>{canConfigure && <Button type="button" disabled={draft === model || pending} onClick={() => { setError(null); setReviewing(true); }}>Review model change</Button>}<p className={layout.metadata}>Recorded tenant selection, not proof of the provider used for an answer.</p>{reviewing && <FacilityDialog title="Review tenant model selection" pending={pending} onClose={() => setReviewing(false)}><p className={layout.body}>Change the recorded tenant-wide selection from {current.label} to {copilotModel(draft).label}. This may affect estimated cost. It does not verify gateway routing or provider availability.</p>{error && <p role="alert" className="text-sm text-negative">{error}</p>}<div className={layout.actions}><Button disabled={pending} onClick={() => setReviewing(false)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Confirm model selection'}</Button></div></FacilityDialog>}</div>;
}

function UsageMeter({ usage, model }: { usage: Usage | null; model: string }) {
  if (!usage) return <Card><CardHeader title="Usage unavailable" subtitle="The usage ledger could not be read" /><EmptyState title="Usage totals are unavailable" description="No request, token or cost total is inferred. Refresh the page before relying on the usage meter or making a spend decision." /></Card>;
  return <div className={layout.layout}><div className={layout.metrics}><KpiCard label="Recorded requests" value={usage.requests.toLocaleString('en-NG')} icon={<Activity size={18} />} /><KpiCard label="Confirmed input tokens" value={usage.inputTokens.toLocaleString('en-NG')} icon={<Cpu size={18} />} /><KpiCard label="Confirmed output tokens" value={usage.outputTokens.toLocaleString('en-NG')} icon={<Gauge size={18} />} /><KpiCard label="Estimated cost · NGN" value={facilityMoney(usage.costMinorNgn)} icon={<Coins size={18} />} /></div><Card><CardHeader title="Usage & safeguards" subtitle="Tenant-level application meter, not a provider invoice" /><dl className={layout.facts}><div><dt>Recorded model selection</dt><dd>{copilotModel(model).label}</dd></div><div><dt>Configured request limit</dt><dd>{COPILOT_RATE_PER_MIN} per minute</dd></div><div><dt>Meter basis</dt><dd>Confirmed provider-reported token counts</dd></div></dl><p className={layout.footnote}>Token totals include confirmed provider-reported counts only. Interrupted calls without confirmed usage may retain a conservative cost charge; missing token counts are not evidence of zero usage. Cost uses model list-price assumptions and fixed planning FX, not a provider invoice or a current exchange-rate quote.</p></Card></div>;
}
