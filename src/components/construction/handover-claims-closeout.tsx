'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FileCheck2 } from 'lucide-react';
import { Button, Card, CardHeader, StatusPill } from '@/components/ui';
import { HANDOVER_REQUIREMENTS, type HandoverRequirement } from '@/domain/construction/control';
import {
  approveConstructionHandoverPack, decideConstructionRetentionRelease, requestConstructionRetentionRelease,
  saveConstructionHandoverPack, submitConstructionHandoverPack,
} from '@/server/actions/construction-control';
import { issueWhtCertificate } from '@/server/actions/finance-control';
import styles from './construction-delivery-polish.module.css';

type Result = { ok: boolean; error?: string; message?: string };
type Project = { id: string; name: string };
type Approval = { id: string; projectId: string; kind: string; status: string; title: string };
type ClaimView = { id: string; ref: string; projectId: string; project: string; subcontractor: string; certifiedMinor?: number; retentionMinor: number; whtMinor: number; status: string; paymentReference?: string; whtRecorded: boolean };
export type HandoverDoc = { id: string; projectId: string; number: string; title: string; revision: string; status: string; hasFile: boolean };
export type HandoverPackView = { id: string; ref: string; projectId: string; project: string; title: string; status: string; approvalId: string; items: { requirement: HandoverRequirement; docId: string }[]; omissions: string[]; createdAtISO: string };
export type RetentionView = { id: string; ref: string; claimId: string; projectId: string; amountMinor: number; reason: string; status: string; paymentReference?: string };

const money = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (status: string) => status === 'approved' || status === 'paid' ? 'success' : status === 'rejected' ? 'danger' : 'warn';

export function ConstructionHandoverAndCloseout({ view, projects, docs, approvals, packs, claims, releases, canCreate, canUpdate, canTransition, onDone }: {
  view: 'handover' | 'closeout'; projects: Project[]; docs: HandoverDoc[]; approvals: Approval[]; packs: HandoverPackView[];
  claims: ClaimView[]; releases: RetentionView[]; canCreate: boolean; canUpdate: boolean; canTransition: boolean; onDone: (message: string) => void;
}) {
  return view === 'handover'
    ? <Handover projects={projects} docs={docs} approvals={approvals} packs={packs} canCreate={canCreate} canUpdate={canUpdate} canTransition={canTransition} onDone={onDone} />
    : <Closeout claims={claims} releases={releases} canCreate={canCreate} canUpdate={canUpdate} onDone={onDone} />;
}

function Action({ label, run, disabled, onDone }: { label: string; run: () => Promise<Result>; disabled?: boolean; onDone: (message: string) => void }) {
  const router = useRouter(); const [pending, start] = useTransition();
  return <Button disabled={disabled || pending} onClick={() => start(async () => {
    try { const result = await run(); onDone(result.ok ? result.message ?? `${label} complete.` : result.error ?? `${label} failed.`); if (result.ok) router.refresh(); }
    catch { onDone(`${label} failed. Refresh and try again.`); }
  })}>{pending ? 'Working…' : label}</Button>;
}

function Handover({ projects, docs, approvals, packs, canCreate, canUpdate, canTransition, onDone }: { projects: Project[]; docs: HandoverDoc[]; approvals: Approval[]; packs: HandoverPackView[]; canCreate: boolean; canUpdate: boolean; canTransition: boolean; onDone: (message: string) => void }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [packId, setPackId] = useState(''); const [title, setTitle] = useState('Project handover pack');
  const [approvalId, setApprovalId] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const available = docs.filter((row) => row.projectId === projectId && row.status === 'approved' && row.hasFile);
  const projectApprovals = approvals.filter((row) => row.projectId === projectId && row.kind === 'handover' && row.status === 'approved');
  const save = () => start(async () => {
    const result = await saveConstructionHandoverPack({ packId: packId || undefined, projectId, title, approvalId: approvalId || undefined,
      items: HANDOVER_REQUIREMENTS.flatMap((row) => selected[row.key] ? [{ requirement: row.key, docId: selected[row.key] }] : []),
    });
    onDone(result.ok ? result.message ?? 'Pack saved.' : result.error);
    if (result.ok) { if (result.id) setPackId(result.id); router.refresh(); }
  });
  const load = (pack: HandoverPackView) => { setProjectId(pack.projectId); setPackId(pack.id); setTitle(pack.title); setApprovalId(pack.approvalId); setSelected(Object.fromEntries(pack.items.map((row) => [row.requirement, row.docId]))); };
  return <div className={styles.stack}>
    <Card><CardHeader title="Assemble a controlled handover pack" subtitle="Select the approved file revision for each required item. Missing or superseded files block submission." />
      <div className={styles.formGrid}>
        <label className={styles.field}><span>Project</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setPackId(''); setSelected({}); setApprovalId(''); }}>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={styles.field}><span>Pack title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className={styles.field}><span>Evidence-backed handover approval</span><select value={approvalId} onChange={(event) => setApprovalId(event.target.value)}><option value="">Choose approved decision</option>{projectApprovals.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      </div>
      <div className={styles.stack}>{HANDOVER_REQUIREMENTS.map((requirement) => <label className={styles.field} key={requirement.key}><span>{requirement.label}</span><select value={selected[requirement.key] ?? ''} onChange={(event) => setSelected((current) => ({ ...current, [requirement.key]: event.target.value }))}><option value="">Missing document</option>{available.map((row) => <option key={row.id} value={row.id}>{row.number} rev {row.revision} · {row.title}</option>)}</select></label>)}</div>
      <div className={styles.actions}><Link className={styles.link} href="/construction/documents">Manage project documents →</Link><Button variant="primary" disabled={!canCreate || !projectId || pending || title.trim().length < 3} onClick={save}>{pending ? 'Saving…' : packId ? 'Update draft pack' : 'Create draft pack'}</Button></div>
      {!available.length ? <p className={styles.metadata}>No approved uploaded files are available for this project. Upload and approve actual documents first.</p> : null}
    </Card>
    <Card><CardHeader title="Handover register" subtitle="Document completeness is checked again at submission and sign-off" />
      <div className={styles.stack}>{packs.length ? packs.map((pack) => <div key={pack.id} className={styles.listEntry}><div><strong>{pack.ref} · {pack.title}</strong><p className={styles.metadata}>{pack.project} · {pack.items.length}/{HANDOVER_REQUIREMENTS.length} slots filled</p><StatusPill status={pack.status} tone={tone(pack.status)} />
        {pack.omissions.length ? <ul className={styles.list}>{pack.omissions.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className={styles.metadata}><FileCheck2 size={14} aria-hidden="true" /> All required approved files present</p>}
      </div><div className={styles.actions}>{pack.status === 'draft' ? <><Button onClick={() => load(pack)}>Edit</Button><Action label="Submit" disabled={!canUpdate || Boolean(pack.omissions.length) || !pack.approvalId} run={() => submitConstructionHandoverPack(pack.id)} onDone={onDone} /></> : null}{pack.status === 'submitted' ? <Action label="Sign off" disabled={!canTransition || Boolean(pack.omissions.length)} run={() => approveConstructionHandoverPack(pack.id)} onDone={onDone} /> : null}{pack.status === 'approved' ? <a className={styles.link} href={`/api/construction/handover/${encodeURIComponent(pack.id)}`}>Download signed pack ZIP →</a> : null}</div></div>) : <p className={styles.text}>No handover packs assembled yet.</p>}</div>
    </Card>
  </div>;
}

function Closeout({ claims, releases, canCreate, canUpdate, onDone }: { claims: ClaimView[]; releases: RetentionView[]; canCreate: boolean; canUpdate: boolean; onDone: (message: string) => void }) {
  return <div className={styles.stack}>
    <Card><CardHeader title="Certified claims and retention" subtitle="Review certified liabilities, retained balances and tax evidence" />
      <p className={styles.metadata}>An approved claim is a certified liability. Payment confirmation is handled outside Construction; approval alone does not mark it paid.</p>
      <div className={styles.stack}>{claims.length ? claims.map((claim) => <ClaimCloseout key={claim.id} claim={claim} releases={releases.filter((row) => row.claimId === claim.id)} canCreate={canCreate} canUpdate={canUpdate} onDone={onDone} />) : <p className={styles.text}>No claims recorded.</p>}</div>
    </Card>
  </div>;
}

function ClaimCloseout({ claim, releases, canCreate, canUpdate, onDone }: { claim: ClaimView; releases: RetentionView[]; canCreate: boolean; canUpdate: boolean; onDone: (message: string) => void }) {
  const [retentionAmount, setRetentionAmount] = useState(''); const [reason, setReason] = useState('');
  const [taxPeriod, setTaxPeriod] = useState(''); const [certificateRef, setCertificateRef] = useState(''); const [remittanceRef, setRemittanceRef] = useState('');
  const committed = releases.filter((row) => row.status !== 'rejected').reduce((sum, row) => sum + row.amountMinor, 0);
  const remaining = Math.max(0, claim.retentionMinor - committed);
  return <div className={styles.listEntry}><div className={styles.stack}><div><strong>{claim.ref} · {claim.subcontractor}</strong><p className={styles.metadata}>{claim.project} · net certified {money(claim.certifiedMinor ?? 0)} · retention {money(claim.retentionMinor)} · WHT {money(claim.whtMinor)}</p><StatusPill status={claim.status} tone={tone(claim.status)} /> {claim.paymentReference ? <span className={styles.metadata}>Payment reference {claim.paymentReference}</span> : null}</div>
    {claim.status === 'paid' ? <><p className={styles.metadata}>WHT certificate: {claim.whtMinor === 0 ? 'Not applicable' : claim.whtRecorded ? 'Recorded in company finance register' : 'Missing tax certificate and remittance evidence'}</p>{claim.whtMinor > 0 && !claim.whtRecorded ? <div className={styles.formGrid}><label className={styles.field}><span>WHT tax period</span><input type="date" value={taxPeriod} onChange={(event) => setTaxPeriod(event.target.value)} /></label><label className={styles.field}><span>Issued certificate reference</span><input value={certificateRef} onChange={(event) => setCertificateRef(event.target.value)} /></label><label className={styles.field}><span>Tax remittance reference</span><input value={remittanceRef} onChange={(event) => setRemittanceRef(event.target.value)} /></label><Action label="Record WHT evidence" disabled={!canUpdate || !taxPeriod || certificateRef.trim().length < 5 || remittanceRef.trim().length < 5} run={() => issueWhtCertificate('construction_claim', claim.id, taxPeriod, { externalCertificateRef: certificateRef, remittanceRef })} onDone={onDone} /></div> : null}
      {remaining > 0 ? <div className={styles.formGrid}><label className={styles.field}><span>Retention release · NGN (remaining {money(remaining)})</span><input type="number" min="0.01" max={remaining / 100} step="0.01" value={retentionAmount} onChange={(event) => setRetentionAmount(event.target.value)} /></label><label className={styles.field}><span>Contract milestone / defects clearance reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label><Action label="Request retention release" disabled={!canCreate || !retentionAmount || reason.trim().length < 5} run={() => requestConstructionRetentionRelease(claim.id, Number(retentionAmount), reason)} onDone={onDone} /></div> : null}</> : null}
    {releases.map((release) => <RetentionCloseout key={release.id} release={release} canUpdate={canUpdate} onDone={onDone} />)}
  </div></div>;
}

function RetentionCloseout({ release, canUpdate, onDone }: { release: RetentionView; canUpdate: boolean; onDone: (message: string) => void }) {
  return <div className={styles.listEntry}><div><strong>{release.ref} · {money(release.amountMinor)}</strong><p className={styles.metadata}>{release.reason}</p><StatusPill status={release.status} tone={tone(release.status)} /> {release.paymentReference ? <span>Payment reference {release.paymentReference}</span> : null}</div><div className={styles.actions}>{release.status === 'requested' ? <><Action label="Approve release" disabled={!canUpdate} run={() => decideConstructionRetentionRelease(release.id, 'approved')} onDone={onDone} /><Action label="Reject" disabled={!canUpdate} run={() => decideConstructionRetentionRelease(release.id, 'rejected')} onDone={onDone} /></> : null}</div></div>;
}
