'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowRight, LockKeyhole, TrendingUp } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, StatusPill } from '@/components/ui';
import { PageTabs } from '@/components/ui/page-tabs';
import type { Variation } from '@/domain/construction/types';
import {
  assessConstructionChange, decideConstructionChange, postConstructionChange, proposeConstructionChange,
  requestConstructionChangePricing, submitConstructionChangeQuote,
} from '@/server/actions/construction-change-orders';
import { ConstructionFrame, ConstructionKpi, ConstructionPanel, ConstructionPanelHeader, ConstructionSummary, constructionNaira } from './construction-ui';
import styles from './construction-delivery-polish.module.css';

type Order = Omit<Variation, 'costImpact'> & { costImpact: number };
type Source = { id: string; label: string; workPackageId?: string };
type Project = { id: string; code: string; name: string };
type Cost = { code: string; name: string; budgetMinor: number; committedMinor: number; workPackageId?: string };
type Result = { ok: boolean; error?: string; ref?: string };
const statusLabel: Record<string, string> = {
  draft: 'Proposed', pricing_requested: 'Awaiting contractor price', priced: 'Commercial assessment',
  client_review: 'Client decision', ready_to_post: 'Finance authorization', approved: 'Posted', rejected: 'Rejected',
};
const statusTone = (status: string) => status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'ready_to_post' ? 'warn' : 'info';

export function ChangeOrdersWorkspace({ projects, project, costCodes, rfis, issues, contractors, orders,
  canPropose, canRequest, canQuote, canAssess, canDecide, canPost, actorId }: {
  projects: Project[]; project?: Project & { approvedBudgetMinor: number; contractMinor: number; approvedChangeDays: number };
  costCodes: Cost[]; rfis: Source[]; issues: Source[]; contractors: { id: string; name: string }[]; orders: Order[];
  canPropose: boolean; canRequest: boolean; canQuote: boolean; canAssess: boolean; canDecide: boolean; canPost: boolean; actorId: string;
}) {
  const router = useRouter();
  const controlled = orders.filter((row) => row.changeOrder);
  const legacy = orders.filter((row) => !row.changeOrder);
  const open = controlled.filter((row) => !['approved', 'rejected'].includes(row.status));
  const posted = controlled.filter((row) => row.status === 'approved');
  return <ConstructionFrame>
    <ConstructionSummary><div className={styles.inline}><span className="construction-summary-icon"><TrendingUp size={22} /></span><div><p className={styles.metadata}>CONSTRUCTION · COMMERCIAL CONTROL</p><h1 className={styles.title}>Change orders & budget</h1><p className={styles.text}>Link the site cause, obtain contractor pricing, record independent reviews, then post the authorized change to the cost ledger.</p></div></div></ConstructionSummary>
    <div className={styles.toolbar}><label className={styles.field}>Project<select aria-label="Construction project" value={project?.id ?? ''} onChange={(event) => router.push(`/construction/changes?projectId=${encodeURIComponent(event.target.value)}`)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><Link className={styles.link} href="/construction/documents">Review RFIs <ArrowRight size={16} /></Link></div>
    {!project ? <Card><EmptyState title="No assigned project" description="A Construction project assignment is required to manage changes." /></Card> : <>
      <div className={styles.metrics}>
        <ConstructionKpi label="Approved budget" value={constructionNaira(project.approvedBudgetMinor)} tone="info" />
        <ConstructionKpi label="Proposed changes" value={String(open.length)} tone="warn" />
        <ConstructionKpi label="Awaiting authorization" value={String(controlled.filter((row) => row.status === 'ready_to_post').length)} tone="warn" />
        <ConstructionKpi label="Posted changes" value={String(posted.length)} tone="success" />
      </div>
      <PageTabs label="Construction change-order workflow" items={[
        { id: 'pipeline', label: 'Change pipeline', count: open.length, content: <div className={styles.stack}>
          <Proposal project={project} costCodes={costCodes} rfis={rfis} issues={issues} contractors={contractors} allowed={canPropose} />
          <Card><div className={styles.inline}><LockKeyhole size={18} /><p className={styles.text}>A proposal or quote does not change the budget, commitment or forecast. Only the final authorized posting does.</p></div></Card>
          {open.map((row) => <ChangeCard key={row.id} row={row} actorId={actorId} canRequest={canRequest} canQuote={canQuote} canAssess={canAssess} canDecide={canDecide} canPost={canPost} />)}
          {!open.length && <Card><EmptyState title="No proposed changes" description="Link an RFI or site issue to start a controlled change." /></Card>}
        </div> },
        { id: 'posted', label: 'Approved ledger', count: posted.length, content: <div className={styles.stack}>{posted.map((row) => <ChangeCard key={row.id} row={row} actorId={actorId} canRequest={false} canQuote={false} canAssess={false} canDecide={false} canPost={false} />)}{!posted.length && <Card><EmptyState title="No posted changes" description="Approved budget and commitments remain unchanged until finance posts a fully authorized order." /></Card>}</div> },
        { id: 'history', label: 'Other variations', count: legacy.length + controlled.filter((row) => row.status === 'rejected').length, content: <ConstructionPanel><ConstructionPanelHeader title="Variation history" subtitle="Older and rejected records remain visible; legacy rows do not carry the new budget-posting evidence." /><div className={styles.body}><ul className={styles.list}>{[...controlled.filter((row) => row.status === 'rejected'), ...legacy].map((row) => <li key={row.id} className={styles.listEntry}><div><strong className={styles.rowTitle}>{row.ref} · {row.title}</strong><p className={styles.metadata}>{row.reason}</p></div><StatusPill status={statusLabel[row.status] ?? row.status.replaceAll('_', ' ')} tone={statusTone(row.status) as never} /></li>)}</ul>{!legacy.length && !controlled.some((row) => row.status === 'rejected') && <EmptyState title="No earlier variations" description="Rejected proposals and legacy variation records appear here." />}</div></ConstructionPanel> },
      ]} />
    </>}
  </ConstructionFrame>;
}

function Proposal({ project, costCodes, rfis, issues, contractors, allowed }: { project: Project; costCodes: Cost[]; rfis: Source[]; issues: Source[]; contractors: { id: string; name: string }[]; allowed: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState('');
  const [kind, setKind] = useState<'rfi' | 'site_issue'>('rfi'); const [sourceId, setSourceId] = useState('');
  const sources = kind === 'rfi' ? rfis : issues;
  const selected = sources.find((row) => row.id === sourceId);
  const availableCodes = costCodes.filter((row) => !selected?.workPackageId || row.workPackageId === selected.workPackageId);
  function submit(form: FormData) {
    start(async () => {
      const result = await proposeConstructionChange({ projectId: project.id, sourceKind: kind, sourceId,
        title: String(form.get('title') ?? ''), reason: String(form.get('reason') ?? ''),
        costCode: String(form.get('costCode') ?? ''), subcontractorId: String(form.get('subcontractorId') ?? '') });
      setError(result.ok ? `${result.ref} proposed. Request contractor pricing next.` : result.error);
      if (result.ok) router.refresh();
    });
  }
  return <ConstructionPanel><ConstructionPanelHeader title="Propose a change" subtitle="Start from an RFI or site issue. Choose the cost code and approved contractor before asking for a quote." /><div className={styles.body}>
    {!allowed ? <p className={styles.text}>Your profile can review this register but cannot propose a change.</p> : <form action={submit} className={styles.stack}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Source type<select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setSourceId(''); }}><option value="rfi">RFI</option><option value="site_issue">Site issue</option></select></label>
        <label className={styles.field}>Source record<select value={sourceId} required onChange={(event) => setSourceId(event.target.value)}><option value="">Choose {kind === 'rfi' ? 'an RFI' : 'an issue'}</option>{sources.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <label className={styles.field}>Cost code<select name="costCode" required key={sourceId}><option value="">Choose cost code</option>{availableCodes.map((row) => <option key={row.code} value={row.code}>{row.code} · {row.name}</option>)}</select></label>
        <label className={styles.field}>Assigned contractor<select name="subcontractorId" required><option value="">Choose approved contractor</option>{contractors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={styles.field}>Change title<input name="title" required minLength={4} maxLength={180} placeholder="Describe the proposed scope change" /></label>
        <label className={styles.field}>Why the change is needed<textarea name="reason" required minLength={8} maxLength={1000} placeholder="Explain the RFI answer or site condition" /></label>
      </div>
      {error && <p className={resultTone(error)} role="status">{error}</p>}
      <div className={styles.actions}><Button variant="primary" type="submit" disabled={pending || !sourceId || !availableCodes.length || !contractors.length}>{pending ? 'Saving…' : 'Create proposal'}</Button></div>
    </form>}
    {(rfis.length + issues.length === 0 || !costCodes.length || !contractors.length) && <p className={styles.metadata}>You need a submitted RFI or site issue, a project cost code and an approved contractor before proposing a change.</p>}
  </div></ConstructionPanel>;
}

function resultTone(message: string) { return message.includes('proposed.') || message.includes('saved.') || message.includes('posted.') ? styles.text : styles.error; }
function ChangeCard({ row, actorId, canRequest, canQuote, canAssess, canDecide, canPost }: {
  row: Order; actorId: string; canRequest: boolean; canQuote: boolean; canAssess: boolean; canDecide: boolean; canPost: boolean;
}) {
  const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState('');
  const control = row.changeOrder!;
  const canReviewQuote = actorId !== control.proposedBy && actorId !== control.quote?.submittedBy;
  const canReviewClient = actorId !== control.assessment?.assessedBy;
  const canAuthorize = ![control.proposedBy, control.quote?.submittedBy, control.assessment?.assessedBy, control.clientDecision?.decidedBy].includes(actorId);
  function run(work: () => Promise<Result>, success: string) {
    start(async () => { try { const result = await work(); setMessage(result.ok ? success : result.error ?? 'Could not save.'); if (result.ok) router.refresh(); }
      catch { setMessage('The change could not be saved. Check the record and try again.'); } });
  }
  return <ConstructionPanel><ConstructionPanelHeader title={`${row.ref} · ${row.title}`} subtitle={`${control.sourceKind === 'rfi' ? 'RFI' : 'Site issue'} ${control.sourceRef} · ${control.subcontractorName} · cost code ${control.costCode}`}><StatusPill status={statusLabel[row.status] ?? row.status} tone={statusTone(row.status) as never} /></ConstructionPanelHeader><div className={`${styles.body} ${styles.stack}`}>
    <p className={styles.text}>{row.reason}</p>
    <dl className={styles.facts}><div><dt>Contractor quote</dt><dd>{control.quote ? `${constructionNaira(control.quote.amountMinor)} · ${control.quote.reference}` : 'Awaiting pricing'}</dd></div><div><dt>Assessed budget change</dt><dd>{control.assessment ? constructionNaira(control.assessment.budgetDeltaMinor) : 'Not assessed'}</dd></div><div><dt>Schedule impact</dt><dd>{control.assessment ? `${control.assessment.scheduleDays} days` : 'Not assessed'}</dd></div><div><dt>Client decision</dt><dd>{control.clientDecision ? `${control.clientDecision.decision} · ${control.clientDecision.reference}` : 'Not recorded'}</dd></div></dl>
    {control.quote?.recordedOnBehalf && <p className={styles.metadata}>The project team recorded the contractor&apos;s written quote on their behalf.</p>}
    {control.assessment && <p className={styles.metadata}>Commercial assessment: {control.assessment.note}</p>}
    {control.clientDecision && <p className={styles.metadata}>Client decision note: {control.clientDecision.note}</p>}
    {control.posting && <Card><CardHeader title="Posted financial impact" subtitle={`${control.posting.authorizationReference} · recorded ${control.posting.postedAtISO.slice(0, 10)}`} /><dl className={styles.facts}><div><dt>Project budget</dt><dd>{constructionNaira(control.posting.budgetBeforeMinor)} → {constructionNaira(control.posting.budgetAfterMinor)}</dd></div><div><dt>Cost-code commitment</dt><dd>{constructionNaira(control.posting.commitmentBeforeMinor)} → {constructionNaira(control.posting.commitmentAfterMinor)}</dd></div><div><dt>Cost forecast</dt><dd>{constructionNaira(control.posting.costForecastBeforeMinor)} → {constructionNaira(control.posting.costForecastAfterMinor)}</dd></div><div><dt>Forecast finish</dt><dd>{control.posting.forecastBeforeISO} → {control.posting.forecastAfterISO}</dd></div></dl></Card>}
    {row.status === 'draft' && canRequest && <div className={styles.actions}><Button type="button" disabled={pending} onClick={() => run(() => requestConstructionChangePricing(row.id), 'Pricing requested.')}>Request contractor pricing</Button></div>}
    {row.status === 'pricing_requested' && canQuote && <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(() => submitConstructionChangeQuote(row.id, { amountNaira: Number(form.get('amountNaira')), reference: String(form.get('reference')), scope: String(form.get('scope')) }), 'Contractor price saved.'); }}><div className={styles.formGrid}><label className={styles.field}>Quoted amount · NGN<input name="amountNaira" type="number" min="0.01" step="0.01" required /></label><label className={styles.field}>Contractor quote reference<input name="reference" required minLength={3} maxLength={160} /></label><label className={styles.field}>Quoted scope<textarea name="scope" required minLength={8} maxLength={1000} /></label></div><div className={styles.actions}><Button type="submit" disabled={pending}>Record contractor quote</Button></div></form>}
    {row.status === 'priced' && canAssess && canReviewQuote && <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(() => assessConstructionChange(row.id, { budgetDeltaNaira: Number(form.get('budgetDeltaNaira')), scheduleDays: Number(form.get('scheduleDays')), note: String(form.get('note')) }), 'Commercial assessment saved.'); }}><div className={styles.formGrid}><label className={styles.field}>Assessed budget increase · NGN<input name="budgetDeltaNaira" type="number" min={(control.quote?.amountMinor ?? 1) / 100} step="0.01" required /></label><label className={styles.field}>Assessed programme impact · days<input name="scheduleDays" type="number" min="0" max="365" step="1" defaultValue="0" required /></label><label className={styles.field}>QS review note<textarea name="note" required minLength={8} maxLength={1000} /></label></div><div className={styles.actions}><Button type="submit" disabled={pending}>Submit commercial assessment</Button></div></form>}
    {row.status === 'client_review' && canDecide && canReviewClient && <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(() => decideConstructionChange(row.id, { decision: String(form.get('decision')) as 'approved' | 'rejected', reference: String(form.get('reference')), note: String(form.get('note')) }), 'Client decision saved.'); }}><p className={styles.metadata}>Record the actual client&apos;s written decision and reference. Propbrew does not grant client approval itself.</p><div className={styles.formGrid}><label className={styles.field}>Decision<select name="decision"><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><label className={styles.field}>Signed decision reference<input name="reference" required minLength={3} maxLength={160} /></label><label className={styles.field}>Decision note<textarea name="note" required minLength={8} maxLength={1000} /></label></div><div className={styles.actions}><Button type="submit" disabled={pending}>Record client decision</Button></div></form>}
    {row.status === 'ready_to_post' && canPost && canAuthorize && <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(() => postConstructionChange(row.id, { reference: String(form.get('reference')) }), 'Approved change posted.'); }}><p className={styles.metadata}>Posting increases the approved project and cost-code budget by {constructionNaira(control.assessment!.budgetDeltaMinor)}, commits {constructionNaira(control.quote!.amountMinor)} to the contractor, and updates the forecast finish by {control.assessment!.scheduleDays} approved day(s). It does not make a payment.</p><label className={styles.field}>Finance authorization reference<input name="reference" required minLength={3} maxLength={160} placeholder="Approved board or finance instruction" /></label><div className={styles.actions}><Button type="submit" variant="primary" disabled={pending}>Authorize & post to ledger</Button></div></form>}
    {message && <p className={resultTone(message)} role="status">{message}</p>}
  </div></ConstructionPanel>;
}
