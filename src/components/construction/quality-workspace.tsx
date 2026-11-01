'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Card, StatusPill } from '@/components/ui';
import { PageTabs } from '@/components/ui/page-tabs';
import type { Issue } from '@/domain/construction/types';
import { advanceConstructionQualityIssue, recordConstructionQualityIssue, reviewConstructionClash, type QualityIssueInput } from '@/server/actions/construction';
import { recordConstructionCorrectiveWork, signOffConstructionQuality } from '@/server/actions/construction-quality';
import { ConstructionFrame, ConstructionKpi, ConstructionPanel, ConstructionPanelHeader } from './construction-ui';
import { InspectionFlow, SignOffForm } from './quality/inspection-flow';
import { QualityPhotoPicker } from './quality/quality-photo-picker';
import { ModelCoordination } from './quality/model-coordination';
import type { ClashRun, StoredModel } from '@/server/construction/models';
import styles from './quality-workspace.module.css';

type Category = 'Punch list' | 'Design clash';
export function QualityWorkspace({ projects, projectId, issues, taskNames, today, canCreate, canUpdate, canSignOff = canUpdate, companyId = '', packages = [], models = [], modelRuns = [], canUploadModels = false, canExportBcf = false }: {
  projects: { id: string; name: string; code: string }[]; projectId: string; issues: Issue[]; taskNames: string[];
  today: string; canCreate: boolean; canUpdate: boolean; canSignOff?: boolean; companyId?: string; packages?: { id: string; name: string }[];
  models?: StoredModel[]; modelRuns?: ClashRun[]; canUploadModels?: boolean; canExportBcf?: boolean;
}) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [category, setCategory] = useState<Category>('Punch list');
  const [showForm, setShowForm] = useState(false); const [message, setMessage] = useState('');
  const punch = issues.filter((issue) => issue.category === 'Punch list');
  const inspections = issues.filter((issue) => issue.category === 'Authority inspection');
  const clashes = issues.filter((issue) => issue.category === 'Design clash');
  function submit(form: FormData) {
    const input: QualityIssueInput = {
      projectId, category, title: String(form.get('title') ?? ''), severity: String(form.get('severity') ?? 'medium') as QualityIssueInput['severity'],
      owner: String(form.get('owner') ?? ''), dueISO: String(form.get('dueISO') ?? ''), location: String(form.get('location') ?? ''),
      sourceReference: String(form.get('sourceReference') ?? ''), relatedReference: String(form.get('relatedReference') ?? ''),
      workPackageId: String(form.get('workPackageId') ?? '') || undefined,
    };
    start(async () => { const result = await recordConstructionQualityIssue(input); setMessage(result.ok ? `${category} recorded.` : result.error); if (result.ok) { setShowForm(false); router.refresh(); } });
  }
  const createPanel = <div className={styles.flow}>
    <div className={styles.sectionHeading}><div><h2>Punch list & design coordination</h2><p>Assign each item, attach field photos and record a reviewed closeout.</p></div>{canCreate && <Button type="button" variant="primary" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Add quality item'}</Button>}</div>
    {message && <p className={styles.feedback} role="status">{message}</p>}
    {showForm && <ConstructionPanel><ConstructionPanelHeader title="Record a quality item" subtitle="Choose a punch item or a reported drawing clash." /><form className={styles.form} action={submit}>
      <label>Record type<select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="Punch list">Punch list</option><option value="Design clash">Design clash</option></select></label>
      <label>Title<input name="title" required minLength={4} maxLength={180} placeholder="Describe the finding" /></label>
      <label>Location / zone<input name="location" required minLength={2} maxLength={160} /></label>
      <label>Corrective-work owner<input name="owner" required minLength={2} maxLength={100} /></label>
      <label>Due date<input name="dueISO" type="date" min={today} defaultValue={today} required /></label>
      <label>Severity<select name="severity" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      {packages.length > 0 && <label>Work package<select name="workPackageId"><option value="">Whole project</option>{packages.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>}
      {category === 'Design clash' ? <><label>Drawing / model reference<input name="sourceReference" required maxLength={160} /></label><label>Conflicting reference<input name="relatedReference" required maxLength={160} /></label></> : <label>Drawing / task reference<input name="sourceReference" list="construction-quality-tasks" maxLength={160} /><datalist id="construction-quality-tasks">{taskNames.map((name) => <option key={name} value={name} />)}</datalist></label>}
      <div className={styles.formAction}><Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : 'Record item'}</Button></div>
    </form></ConstructionPanel>}
  </div>;
  return <ConstructionFrame>
    <div className={styles.heading}><div><p className={styles.eyebrow}>CONSTRUCTION · PROJECT QUALITY</p><h1>Quality & coordination</h1><p>Inspection appointments, corrective work, reinspection and recorded closeout by project.</p></div><label className={styles.projectSelect}>Project<select aria-label="Construction project" value={projectId} onChange={(event) => router.push(`/construction/quality?projectId=${encodeURIComponent(event.target.value)}`)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label></div>
    {!projectId ? <Card><p className={styles.empty}>No construction project is available to this account.</p></Card> : <>
      <div className={styles.metrics}><ConstructionKpi label="Open punch items" value={String(punch.filter((row) => row.status !== 'resolved').length)} tone="warn" /><ConstructionKpi label="Inspection appointments" value={String(inspections.filter((row) => !row.inspection?.visits.at(-1)?.recordedAtISO).length)} tone="info" /><ConstructionKpi label="Awaiting sign-off" value={String(inspections.filter((row) => row.status !== 'resolved' && row.inspection?.visits.at(-1)?.results?.every((result) => result.result !== 'fail')).length)} tone="info" /><ConstructionKpi label="Recorded design clashes" value={String(clashes.filter((row) => row.status !== 'resolved').length)} tone="warn" /></div>
      <PageTabs label="Construction quality workflows" items={[
        { id: 'inspections', label: 'Authority inspections', count: inspections.length, content: <InspectionFlow inspections={inspections} projectId={projectId} companyId={companyId} today={today} canCreate={canCreate} canUpdate={canUpdate} canSignOff={canSignOff} packages={packages} /> },
        { id: 'punch', label: 'Punch list', count: punch.length, content: <div className={styles.flow}>{createPanel}{punch.length ? punch.map((issue) => <PunchCard key={issue.id} issue={issue} companyId={companyId} today={today} canUpdate={canUpdate} canSignOff={canSignOff} />) : <Card><p className={styles.empty}>No punch items recorded for this project.</p></Card>}</div> },
        { id: 'clashes', label: 'Design coordination', count: clashes.length, content: <div className={styles.flow}><ModelCoordination projectId={projectId} companyId={companyId} packages={packages} models={models} runs={modelRuns} issues={clashes} canUpload={canUploadModels} canExport={canExportBcf} />{createPanel}{clashes.length ? clashes.map((issue) => <ClashCard key={issue.id} issue={issue} canUpdate={canUpdate} canReview={canSignOff} />) : <Card><p className={styles.empty}>No design conflicts recorded for this project.</p></Card>}</div> },
      ]} />
    </>}
  </ConstructionFrame>;
}

function PunchCard({ issue, companyId, today, canUpdate, canSignOff }: { issue: Issue; companyId: string; today: string; canUpdate: boolean; canSignOff: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]), [expanded, setExpanded] = useState(false);
  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) { start(async () => { const result = await work(); setMessage(result.ok ? success : result.error ?? 'Could not save.'); if (result.ok) router.refresh(); }); }
  return <Card className={styles.issue}><div className={styles.issueHead}><div><p className={styles.meta}>{issue.location} · due {issue.dueISO}</p><h3>{issue.title}</h3></div><div className={styles.pills}><StatusPill status={issue.severity} tone={issue.severity === 'critical' || issue.severity === 'high' ? 'danger' : 'warn'} /><StatusPill status={issue.status.replaceAll('_', ' ')} tone={issue.status === 'resolved' ? 'success' : 'info'} /></div></div>
    <div className={styles.details}><span>Owner: {issue.owner}</span>{issue.inspectionId && <span>Linked to authority inspection</span>}{issue.workPackageId && <span>Package: {issue.workPackageId}</span>}</div>
    {issue.correctiveAction && <p className={styles.note}>Finding / corrective work: {issue.correctiveAction}</p>}
    {issue.photoIds?.map((id) => <a key={id} className={styles.photoLink} href={`/api/construction/quality/photos/${id}`} target="_blank" rel="noopener noreferrer">View finding photo</a>)}
    {issue.remediation && <div className={styles.signoff}><strong>Corrective work submitted</strong><p>{issue.remediation.description}</p>{issue.remediation.photoIds.map((id) => <a key={id} href={`/api/construction/quality/photos/${id}`} target="_blank" rel="noopener noreferrer">View correction photo</a>)}</div>}
    {issue.inspection?.signOff && <p className={styles.note}>Sign-off: {issue.inspection.signOff.signer} · {issue.inspection.signOff.reference}</p>}
    {(canUpdate || canSignOff) && issue.status !== 'resolved' && <Button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={`punch-${issue.id}`}>{expanded ? 'Hide details' : canUpdate ? 'Record corrective work' : 'Review for sign-off'}</Button>}
    {expanded && <div id={`punch-${issue.id}`} className={styles.editor}>{canUpdate && <><QualityPhotoPicker companyId={companyId} issueId={issue.id} selectedIds={photoIds} onChange={setPhotoIds} disabled={pending} /><form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(() => recordConstructionCorrectiveWork(issue.id, { description: String(form.get('description')), owner: String(form.get('owner')), dueISO: String(form.get('dueISO')), photoIds }), 'Corrective work and photos recorded.'); }}><label>Corrective work<textarea name="description" required minLength={8} maxLength={1000} defaultValue={issue.remediation?.description} /></label><label>Responsible person or firm<input name="owner" required minLength={2} maxLength={100} defaultValue={issue.owner} /></label><label>Deadline<input name="dueISO" type="date" min={today} required defaultValue={issue.dueISO < today ? today : issue.dueISO} /></label><Button type="submit" disabled={pending || !photoIds.length}>{pending ? 'Saving…' : 'Submit corrective work'}</Button></form></>}{!issue.inspectionId && issue.remediation && canSignOff && <SignOffForm pending={pending} onSubmit={(input) => run(() => signOffConstructionQuality(issue.id, input), 'Punch item signed off and closed.')} />}{issue.inspectionId && <p className={styles.meta}>This finding closes when the parent inspection passes reinspection and its sign-off is recorded.</p>}</div>}
    {message && <p className={styles.feedback} role="status">{message}</p>}
  </Card>;
}

function ClashCard({ issue, canUpdate, canReview }: { issue: Issue; canUpdate: boolean; canReview: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState(''); const [expanded, setExpanded] = useState(false);
  function advance(form: FormData, status: 'in_progress' | 'resolved') { start(async () => { const result = await advanceConstructionQualityIssue(issue.id, status, String(form.get('action')), String(form.get('evidence'))); setMessage(result.ok ? 'Design conflict updated.' : result.error); if (result.ok) router.refresh(); }); }
  function review(form: FormData) { start(async () => { const result = await reviewConstructionClash(issue.id, String(form.get('disposition')) as NonNullable<Issue['clashReview']>['disposition'], String(form.get('rationale')), String(form.get('evidence'))); setMessage(result.ok ? 'Engineering review recorded.' : result.error); if (result.ok) router.refresh(); }); }
  return <Card className={styles.issue}><div className={styles.issueHead}><div><p className={styles.meta}>{issue.location} · due {issue.dueISO}</p><h3>{issue.title}</h3></div><StatusPill status={issue.status.replaceAll('_', ' ')} tone={issue.status === 'resolved' ? 'success' : 'warn'} /></div><div className={styles.details}><span>Owner: {issue.owner}</span><span>Source: {issue.sourceReference}</span><span>Conflicts with: {issue.relatedReference}</span>{issue.clashDetection && <span>{issue.clashDetection.method === 'triangle_surface_v1' ? issue.clashDetection.intersects ? 'Mesh surfaces intersect' : `Surface clearance ${issue.clashDetection.clearanceMm ?? 0} mm` : `Envelope overlap ${issue.clashDetection.overlapMm} mm`}</span>}{issue.bcf && <span>BCF topic {issue.bcf.guid}</span>}</div>{issue.clashDetection && <p className={styles.note}>Model elements: {issue.clashDetection.componentAId} ↔ {issue.clashDetection.componentBId}. {issue.clashDetection.method === 'triangle_surface_v1' ? 'Triangle-level contact is a review candidate; verify model units, closed solids and approved drawings.' : 'Envelope overlap is a candidate; inspect the actual geometry and controlled drawings.'}</p>}{issue.clashReview && <p className={styles.note}>Engineering review: {issue.clashReview.disposition.replaceAll('_', ' ')} by {issue.clashReview.reviewerName} · {issue.clashReview.rationale} · evidence {issue.clashReview.evidenceReference}</p>}{issue.correctiveAction && <p className={styles.note}>Action: {issue.correctiveAction}</p>}{issue.evidenceReference && <p className={styles.note}>Evidence: {issue.evidenceReference}</p>}{canReview && issue.status !== 'resolved' && <form className={styles.editor} action={review}><strong>Engineering review</strong><label>Decision<select name="disposition" defaultValue={issue.clashReview?.disposition ?? 'needs_redesign'}><option value="needs_redesign">Needs redesign</option><option value="confirmed">Confirmed conflict</option><option value="false_positive">False positive</option><option value="accepted_tolerance">Accepted tolerance</option></select></label><label>Technical rationale<textarea name="rationale" minLength={12} maxLength={1000} required defaultValue={issue.clashReview?.rationale} /></label><label>Drawing or review evidence<input name="evidence" minLength={3} maxLength={500} required defaultValue={issue.clashReview?.evidenceReference} /></label><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Record engineering decision'}</Button></form>}{canUpdate && issue.status !== 'resolved' && <Button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? 'Hide action' : 'Update design conflict'}</Button>}{expanded && <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); advance(new FormData(event.currentTarget), 'in_progress'); }}><label>Action taken<textarea name="action" minLength={8} maxLength={1000} required /></label><label>Evidence reference<input name="evidence" maxLength={500} placeholder="Drawing revision, model or photo reference" /></label><div className={styles.actions}><Button type="submit" disabled={pending}>Mark in progress</Button><Button type="button" variant="primary" disabled={pending || !issue.clashReview} onClick={(event) => { const form = event.currentTarget.closest('form'); if (form?.reportValidity()) advance(new FormData(form), 'resolved'); }}>Resolve after review</Button></div></form>}{message && <p className={styles.feedback} role="status">{message}</p>}</Card>;
}
