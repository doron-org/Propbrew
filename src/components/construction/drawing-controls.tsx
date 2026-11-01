'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Download, FilePlus2, Upload } from 'lucide-react';
import { Button, Card, CardHeader, StatusPill } from '@/components/ui';
import { ConstructionDialog } from './construction-ui';
import type { DocRev, RegisterRow } from './documents-workspace';
import { DRAWING_MAX_BYTES } from '@/domain/construction/drawings';
import styles from './drawing-controls.module.css';

type Option = { id: string; name: string; code?: string; kind?: string };
type Selection = { mode: 'new' | 'revision' | 'attach'; row?: RegisterRow; revision?: DocRev };

export function DrawingControls({ register, companyId, projectId, projects, locations, workPackages, canUpload }: {
  register: RegisterRow[]; companyId: string; projectId: string;
  projects: { id: string; code: string; name: string }[]; locations: Option[]; workPackages: Option[]; canUpload: boolean;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [indexing, setIndexing] = useState(false); const [indexMessage, setIndexMessage] = useState('');
  const chooseProject = (id: string) => { const tab = new URLSearchParams(window.location.search).get('tab'); router.push(`/construction/documents?projectId=${encodeURIComponent(id)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`); };
  const fileCount = register.reduce((count, row) => count + row.revisions.filter((revision) => revision.fileUrl).length, 0);
  async function reindex() {
    if (!projectId || indexing) return;
    setIndexing(true); setIndexMessage('');
    try {
      const response = await fetch('/api/construction/drawings/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }), cache: 'no-store' });
      const result = await response.json() as { ok?: boolean; error?: string; indexed?: number; remaining?: number; pendingPages?: number; ocrErrors?: number; ocrAvailable?: boolean };
      setIndexMessage(response.ok && result.ok ? `${result.indexed} PDF revision(s) processed. ${result.remaining ? `${result.remaining} more revision(s) remain. ` : ''}${result.ocrErrors ? `${result.ocrErrors} OCR page(s) failed; check the AI provider or budget. ` : ''}${result.pendingPages ? `${result.pendingPages} page(s) await OCR${result.ocrAvailable ? '; run again to continue.' : '; enable the document extraction AI feature and provider.'}` : 'Indexed pages are ready for Copilot.'}` : result.error ?? 'Could not index documents.');
    } catch { setIndexMessage('Connection interrupted. Reopen the project before trying again.'); }
    finally { setIndexing(false); }
  }

  return <>
    <Card className={styles.panel}>
      <div className={styles.header}><CardHeader title="Controlled document files" subtitle="Drawings, specifications and method statements bound to one project and immutable revisions. Location and work-package links travel with each revision." action={canUpload && projectId ? <Button type="button" variant="primary" icon={<FilePlus2 size={16} />} onClick={() => setSelection({ mode: 'new' })}>Upload document</Button> : undefined} /></div>
      <div className={styles.toolbar}><label className={styles.project}>Project<select aria-label="Document project" value={projectId} onChange={(event) => chooseProject(event.target.value)}>{projects.length ? projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>) : <option value="">No authorised project</option>}</select></label><span className={styles.count}>{fileCount} stored PDF revision{fileCount === 1 ? '' : 's'}</span>{canUpload && fileCount > 0 && <Button type="button" disabled={indexing} onClick={() => { void reindex(); }}>{indexing ? 'Indexing…' : 'Index PDFs including scans'}</Button>}</div>
      {indexMessage && <p className={styles.notice} role="status">{indexMessage}</p>}
      {!canUpload && <p className={styles.notice}>File upload is available to signed-in company members with Construction editing access and database storage.</p>}
      {register.length ? <div className={styles.list}>{register.map((row) => <section key={row.number} className={styles.drawing} aria-label={`${row.number} file versions`}><div className={styles.drawingHeader}><div><h3>{row.number} · {row.title}</h3><p>{row.folder} · {row.discipline} · {row.revisions.length} retained revision{row.revisions.length === 1 ? '' : 's'}</p></div><StatusPill status={row.currentRevision ? `Approved rev ${row.currentRevision}` : 'No approved issue'} tone={row.currentRevision ? 'success' : 'warn'} /></div><div className={styles.versions}>{row.revisions.map((revision) => <div key={revision.id} className={styles.version}><div className={styles.versionMain}><strong>Revision {revision.revision}</strong><StatusPill status={revision.status} tone={revision.status === 'approved' ? 'success' : revision.status === 'superseded' ? 'muted' : 'info'} /><span>{revision.fileName ?? 'PDF not attached'}</span>{revision.fileSha256 && <span className={styles.hash} title={revision.fileSha256}>SHA-256 {revision.fileSha256.slice(0, 12)}…</span>}</div><p className={styles.links}>Locations: {revision.locationIds?.length ? revision.locationIds.map((id) => locations.find((item) => item.id === id)?.name ?? id).join(', ') : 'Not linked'} · Packages: {revision.workPackageIds?.length ? revision.workPackageIds.map((id) => workPackages.find((item) => item.id === id)?.code ?? id).join(', ') : 'Not linked'}</p><div className={styles.actions}>{revision.fileUrl && <a href={revision.fileUrl} download className={styles.download}><Download size={15} /> Download PDF</a>}{canUpload && !revision.fileUrl && ['draft', 'review'].includes(revision.status) && <Button type="button" icon={<Upload size={15} />} onClick={() => setSelection({ mode: 'attach', row, revision })}>Attach PDF</Button>}{canUpload && revision.status === 'approved' && <Button type="button" onClick={() => setSelection({ mode: 'revision', row, revision })}>Upload next revision</Button>}</div></div>)}</div></section>)}</div> : <p className={styles.empty}>No controlled PDFs are recorded for this project. Upload the first document to start a revision history.</p>}
    </Card>
    {selection && <DrawingUploadDialog key={`${selection.mode}-${selection.revision?.id ?? 'new'}`} selection={selection} companyId={companyId} projectId={projectId} locations={locations} workPackages={workPackages} onClose={() => setSelection(null)} onSaved={() => { setSelection(null); router.refresh(); }} />}
  </>;
}

function DrawingUploadDialog({ selection, companyId, projectId, locations, workPackages, onClose, onSaved }: {
  selection: Selection; companyId: string; projectId: string; locations: Option[]; workPackages: Option[]; onClose: () => void; onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [folder, setFolder] = useState('Drawings');
  const [changeNote, setChangeNote] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>(selection.revision?.locationIds ?? []);
  const [workPackageIds, setWorkPackageIds] = useState<string[]>(selection.revision?.workPackageIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null);
  const toggle = (list: string[], value: string, save: (ids: string[]) => void) => save(list.includes(value) ? list.filter((id) => id !== value) : [...list, value]);
  const mode = selection.mode;
  const titleText = mode === 'new' ? 'Upload a controlled document' : mode === 'revision' ? `Upload next revision · ${selection.row?.number}` : `Attach PDF · ${selection.row?.number} rev ${selection.revision?.revision}`;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!file || !file.size || file.size > DRAWING_MAX_BYTES || file.type && file.type !== 'application/pdf') { setError('Choose a PDF file of at most 15 MB.'); return; }
    setBusy(true); setError('');
    const form = new FormData();
    form.set('expectedCompanyId', companyId); form.set('projectId', projectId); form.set('mode', mode);
    if (selection.revision) form.set('docId', selection.revision.id);
    if (mode === 'new') { form.set('number', number); form.set('title', title); form.set('discipline', discipline); form.set('folder', folder); }
    if (changeNote.trim()) form.set('changeNote', changeNote.trim());
    form.set('locationIds', JSON.stringify(locationIds)); form.set('workPackageIds', JSON.stringify(workPackageIds)); form.set('file', file);
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch('/api/construction/drawings', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: form, cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) { setError(body.error ?? 'The drawing was not saved.'); return; }
      onSaved();
    } catch { setError('Connection interrupted. Retry to check whether this upload was saved.'); }
    finally { setBusy(false); }
  }
  return <ConstructionDialog title={titleText} onClose={onClose} pending={busy}><form className={styles.form} onSubmit={(event) => { void submit(event); }} onChange={() => { if (!busy) key.current = null; }}>
    <p className={styles.notice}>Upload drawings, specifications and other controlled project PDFs here. The PDF stays private to authorised project members. Approval happens separately after review. When you index scans, page images are sent to your configured AI provider for OCR; verify the extracted text against the original.</p>
    {mode === 'new' && <><label>Document number<input required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="e.g. LAG-SPEC-104" /></label><label>Document title<input required minLength={3} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Discipline<input required minLength={2} maxLength={80} value={discipline} onChange={(event) => setDiscipline(event.target.value)} placeholder="Structural, Architectural, MEP…" /></label><label>Folder<input required minLength={2} maxLength={120} value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Drawings, Specifications, Method statements…" /></label></>}
    {mode === 'revision' && <label>What changed from the approved revision?<textarea required maxLength={1000} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} /></label>}
    <label>Controlled PDF<input type="file" accept=".pdf,application/pdf" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <fieldset><legend>Link to project locations</legend>{locations.length ? <div className={styles.choices}>{locations.map((location) => <label key={location.id}><input type="checkbox" checked={locationIds.includes(location.id)} onChange={() => toggle(locationIds, location.id, setLocationIds)} /> {location.kind} · {location.name}</label>)}</div> : <p>No locations have been configured in project setup.</p>}</fieldset>
    <fieldset><legend>Link to work packages</legend>{workPackages.length ? <div className={styles.choices}>{workPackages.map((pack) => <label key={pack.id}><input type="checkbox" checked={workPackageIds.includes(pack.id)} onChange={() => toggle(workPackageIds, pack.id, setWorkPackageIds)} /> {pack.code} · {pack.name}</label>)}</div> : <p>No work packages have been configured in project setup.</p>}</fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !file}>{busy ? 'Saving PDF…' : 'Save controlled PDF'}</Button></div>
  </form></ConstructionDialog>;
}
