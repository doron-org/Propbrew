'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Timer, Users, Wallet, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, StatusPill } from '@/components/ui';
import { FacilityKpi } from '@/components/facility/facility-ui';
import { facilityMoney } from '@/components/facility/facility-format';
import { toneVar, type Tone } from '@/lib/status-tones';
import { slaState, workload, triageSuggestions, costRollup, isOpen, type Sla } from '@/domain/work-orders';
import type { WorkOrder } from '@/domain/entities';
import layout from '@/components/ui/workspace-layout.module.css';
import polish from '@/components/facility/facility-registers-polish.module.css';

const PRIORITY_TONE: Record<string, Tone> = { emergency: 'danger', high: 'danger', routine: 'warn', low: 'neutral' };
function fmtRemaining(milliseconds: number) { const past = milliseconds < 0, amount = Math.abs(milliseconds); const hours = Math.floor(amount / 3600000), minutes = Math.floor(amount % 3600000 / 60000); return `${hours ? `${hours}h ` : ''}${minutes}m ${past ? 'overdue' : 'remaining'}`; }

export function WorkOrdersIntel({ wos, nowMs, canMutate, basePath = '/work-orders', scopeQuery = '' }: { wos: WorkOrder[]; nowMs: number; canMutate: boolean; basePath?: string; scopeQuery?: string }) {
  const [currency, setCurrency] = useState<string>(wos.some((row) => row.cost?.currency === 'NGN') ? 'NGN' : wos.find((row) => row.cost)?.cost?.currency ?? 'NGN');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const open = wos.filter(isOpen);
  const withSla = open.map((row) => ({ row, sla: slaState(row, nowMs) })).filter((item) => item.sla.state !== 'none');
  const breaching = withSla.filter((item) => item.sla.state !== 'ok');
  const unassigned = open.filter((row) => !row.assigneeName || ['Unassigned', '—'].includes(row.assigneeName)).length;
  const loads = workload(wos);
  const maxLoad = Math.max(...loads.map((load) => load.open), 1);
  const triage = triageSuggestions(wos).filter((suggestion) => !dismissed.has(suggestion.id));
  const cost = costRollup(wos.filter((row) => row.cost?.currency === currency));
  const currencies = Array.from(new Set(wos.flatMap((row) => row.cost ? [row.cost.currency] : [])));
  const money = (minor: number) => facilityMoney(minor, currency);
  const watch = [...withSla].sort((a, b) => (a.sla.msRemaining ?? 0) - (b.sla.msRemaining ?? 0)).slice(0, 5);
  return <div className={layout.layout}>
    <div className={layout.toolbar}><p className={layout.metadata}>Recorded snapshot: {new Date(nowMs).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} WAT · advisory rules, not a live forecast.</p><label className={layout.field}><span className={layout.label}>Recorded cost currency</span><select className={layout.select} value={currency} onChange={(event) => setCurrency(event.target.value)}>{(currencies.length ? currencies : ['NGN']).map((value) => <option key={value}>{value}</option>)}</select></label></div>
    <div className={layout.metrics}><FacilityKpi label="Open work orders" value={String(open.length)} note={`${wos.length} total scoped records`} tone="info" icon={<Timer size={18} />} /><FacilityKpi label="SLA attention" value={String(breaching.length)} note="Soon or overdue at recorded snapshot" tone={breaching.length ? 'danger' : 'success'} icon={<AlertTriangle size={18} />} /><FacilityKpi label="Unassigned" value={String(unassigned)} note={unassigned ? 'An operator should assign an owner' : 'No unassigned open records'} tone={unassigned ? 'warn' : 'success'} icon={<Users size={18} />} /><FacilityKpi label={`Recorded cost · ${currency}`} value={money(cost.totalMinor)} note={`${cost.withCost} costed records · average ${money(cost.avgMinor)}`} tone="progress" icon={<Wallet size={18} />} /></div>
    <div className={polish.insights}>
      <Card padded={false}><div className={polish.registerHeader}><CardHeader title="Triage suggestions" subtitle="AI-F-02 · advisory, you decide · rules-based review queue · no automatic assignment" /></div>{triage.length ? <ul className="m-0 p-0 list-none divide-y divide-border">{triage.map((suggestion) => <li key={suggestion.id} className="p-6 max-[640px]:p-4"><div className={layout.toolbar}><Link href={`${basePath}/${suggestion.ref}${scopeQuery}`} className={polish.link}>{suggestion.ref}</Link><StatusPill status={`Suggested ${suggestion.suggestedPriority}${suggestion.escalate ? ' · escalation' : ''}`} tone={PRIORITY_TONE[suggestion.suggestedPriority] ?? 'neutral'} /></div><h4 className={layout.title}>{suggestion.title}</h4><p className={`${polish.body} mt-4`}>Suggested assignee: {suggestion.suggestedAssignee}</p><p className={`${polish.body} mt-2`}>{suggestion.reason}</p><p className={`${polish.metadata} mt-3`}>Keyword and workload rules support review; this is not a calibrated model recommendation.</p>{canMutate ? <div className={`${layout.filters} mt-6`}><Link href={`${basePath}/${suggestion.ref}${scopeQuery}`} className={polish.link}>Open to assign <ArrowUpRight size={16} /></Link><Button variant="ghost" onClick={() => setDismissed((previous) => new Set(previous).add(suggestion.id))}>Dismiss for this session</Button></div> : null}</li>)}</ul> : <EmptyState title="No triage suggestions in this view" description={dismissed.size ? `${dismissed.size} suggestions are hidden in this session. No work orders were changed.` : 'The current rules did not produce a triage suggestion for these records.'} />}{canMutate && dismissed.size ? <div className="p-6 max-[640px]:p-4 border-t border-border"><Button onClick={() => setDismissed(new Set())}>Restore dismissed suggestions</Button></div> : null}</Card>
      <div className={layout.layout}><Card><CardHeader title="SLA watch" subtitle="Nearest recorded response / resolution targets · snapshot only" /><div className={layout.stack}>{watch.length ? watch.map(({ row, sla }) => <SlaRow key={row.id} ref_={row.ref} title={row.title} sla={sla} basePath={basePath} scopeQuery={scopeQuery} />) : <p className={polish.body}>No open SLA deadlines recorded.</p>}</div></Card><Card><CardHeader title="Assigned workload" subtitle="Open jobs per recorded assignee" /><ul className="m-0 p-0 list-none space-y-6">{loads.map((load) => <li key={load.assignee}><div className={layout.toolbar}><span className={polish.body}>{load.assignee}</span><span className={polish.metadata}>{load.open} open{load.critical ? ` · ${load.critical} high / emergency` : ''}</span></div><div role="img" aria-label={`${load.assignee}: ${load.open} open work orders`} className="mt-3 h-2 rounded bg-surface-2 overflow-hidden"><div className="h-full rounded" style={{ width: `${load.open / maxLoad * 100}%`, background: toneVar(load.tone) }} /></div></li>)}</ul>{!loads.length && <p className={polish.body}>No assigned open jobs.</p>}{loads.some((load) => load.tone === 'danger') && <p className="text-sm text-warning mt-6">Review capacity: an assignee has at least four open jobs. Reassignment still requires an authorised operator.</p>}</Card></div>
    </div><p className={layout.metadata}>Recorded costs are currency-separated with no FX conversion. They are not verified invoices, bank payments or vendor settlements.</p>
  </div>;
}

function SlaRow({ ref_, title, sla, basePath, scopeQuery }: { ref_: string; title: string; sla: Sla; basePath: string; scopeQuery: string }) {
  return <Link href={`${basePath}/${ref_}${scopeQuery}`} className={polish.row}><span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: toneVar(sla.tone) }} /><div><span className="text-sm font-medium text-primary">{ref_}</span><p className={polish.metadata}>{title}</p></div><span className="text-sm tabular-nums" style={{ color: toneVar(sla.tone) }}>{sla.msRemaining == null ? 'No target' : fmtRemaining(sla.msRemaining)}</span></Link>;
}
