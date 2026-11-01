'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Layers3, ScanSearch, Upload } from 'lucide-react';
import { Button, Card, CardHeader, StatusPill } from '@/components/ui';
import { ConstructionPanel, ConstructionPanelHeader } from '../construction-ui';
import { MODEL_MAX_BYTES } from '@/domain/construction/model-clashes';
import type { ClashRun, StoredModel } from '@/server/construction/models';
import type { RevisionChange } from '@/domain/construction/model-mesh';
import type { Issue } from '@/domain/construction/types';
import { ModelViewer } from './model-viewer';
import styles from '../quality-workspace.module.css';

export function ModelCoordination({ projectId, companyId, packages, models, runs, issues = [], canUpload, canExport }: {
  projectId: string; companyId: string; packages: { id: string; name: string }[];
  models: StoredModel[]; runs: ClashRun[]; issues?: Issue[]; canUpload: boolean; canExport: boolean;
}) {
  const router = useRouter(); const key = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null), [discipline, setDiscipline] = useState(''), [packageId, setPackageId] = useState('');
  const [modelCode, setModelCode] = useState(''), [revision, setRevision] = useState('');
  const [activeModelId, setActiveModelId] = useState(models[0]?.id ?? ''), [focusElementId, setFocusElementId] = useState<string | undefined>();
  const [beforeId, setBeforeId] = useState(''), [afterId, setAfterId] = useState('');
  const [comparison, setComparison] = useState<{ changes: RevisionChange[]; added: number; removed: number; changed: number } | null>(null);
  const [modelAId, setModelAId] = useState(''), [modelBId, setModelBId] = useState(''), [toleranceMm, setToleranceMm] = useState(5);
  const [bcfFile, setBcfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (!file || file.size < 32 || file.size > MODEL_MAX_BYTES || !/\.(obj|glb|ifc)$/i.test(file.name)) { setError('Choose an IFC, OBJ or GLB model of at most 12 MB.'); return; }
    setBusy(true); setError(''); setMessage(''); key.current ??= crypto.randomUUID();
    const form = new FormData(); form.set('expectedCompanyId', companyId); form.set('projectId', projectId);
    form.set('discipline', discipline); form.set('modelCode', modelCode.trim().toUpperCase()); form.set('revision', revision.trim().toUpperCase());
    if (packageId) form.set('workPackageId', packageId); form.set('file', file);
    try {
      const response = await fetch('/api/construction/models', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: form, cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) { setError(body.error ?? 'The model was not saved.'); return; }
      setMessage('Revision uploaded. Open it in the viewer or compare it with another revision.'); setFile(null); setRevision(''); key.current = null; router.refresh();
    } catch { setError('Connection interrupted. Retry to check whether the model was saved.'); }
    finally { setBusy(false); }
  }
  async function scan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !modelAId || !modelBId || modelAId === modelBId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/construction/models/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedCompanyId: companyId, projectId, modelAId, modelBId, toleranceMm }), cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; error?: string; run?: ClashRun };
      if (!response.ok || !body.ok || !body.run) { setError(body.error ?? 'The comparison could not complete.'); return; }
      setMessage(`${body.run.candidates} triangle surface contact${body.run.candidates === 1 ? '' : 's'} or near-miss${body.run.candidates === 1 ? '' : 'es'} found; ${body.run.created} new coordination issue${body.run.created === 1 ? '' : 's'} linked below.`);
      router.refresh();
    } catch { setError('Connection interrupted. Reopen this page to check the scan history.'); }
    finally { setBusy(false); }
  }
  async function importBcf(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !bcfFile) return;
    setBusy(true); setError(''); setMessage('');
    const form = new FormData(); form.set('expectedCompanyId', companyId); form.set('projectId', projectId);
    if (packageId) form.set('workPackageId', packageId); form.set('file', bcfFile);
    try {
      const response = await fetch('/api/construction/models/bcf', { method: 'POST', body: form, cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; error?: string; imported?: number; updated?: number; skipped?: number };
      if (!response.ok || !body.ok) { setError(body.error ?? 'Could not import BCF topics.'); return; }
      setMessage(`${body.imported} BCF topics added, ${body.updated} updated, ${body.skipped} unchanged. Comments, snapshots and viewpoints are retained; imported decisions still require local engineering review.`);
      setBcfFile(null); router.refresh();
    } catch { setError('Connection interrupted. Reopen this page to check the coordination register.'); }
    finally { setBusy(false); }
  }
  async function compareRevisions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !beforeId || !afterId || beforeId === afterId) return;
    setBusy(true); setError(''); setMessage(''); setComparison(null);
    try {
      const response = await fetch('/api/construction/models/revisions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beforeId, afterId, toleranceMm: 2 }), cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; error?: string; comparison?: { changes: RevisionChange[]; added: number; removed: number; changed: number } };
      if (!response.ok || !body.ok || !body.comparison) { setError(body.error ?? 'Revision comparison failed.'); return; }
      setComparison(body.comparison); setMessage('Revision comparison completed using element IDs and triangle geometry.');
    } catch { setError('Connection interrupted while comparing revisions.'); }
    finally { setBusy(false); }
  }
  const active = models.find((row) => row.id === activeModelId) ?? models[0];
  const before = models.find((row) => row.id === beforeId);
  const laterRevisions = before ? models.filter((row) => row.id !== before.id && row.projectId === before.projectId &&
    row.workPackageId === before.workPackageId && row.modelCode === before.modelCode) : [];
  function inspect(modelId: string, elementId?: string) { setActiveModelId(modelId); setFocusElementId(elementId); }
  return <div className={styles.flow}>
    <Card className={styles.boundary}><strong>Model review and coordination</strong><p>Open controlled IFC, OBJ or GLB geometry, inspect individual elements and compare revisions. Surface intersection and clearance checks find engineering candidates; the design lead still reviews model units, closed solids and approved drawings before sign-off.</p></Card>
    {active && <ConstructionPanel><ConstructionPanelHeader title="3D model reviewer" subtitle="Orbit the actual triangle geometry, search element IDs, inspect bounds and isolate a selected element." />
      <div className={styles.editor}><label>Open model<select value={active.id} onChange={(event) => inspect(event.target.value)}>{models.map((row) => <option key={row.id} value={row.id}>{row.modelCode ?? row.discipline} · {row.revision ?? 'Unversioned'} · {row.name}</option>)}</select></label>
        <ModelViewer key={`${active.id}:${focusElementId ?? ''}`} modelId={active.id} focusElementId={focusElementId} />
      </div>
    </ConstructionPanel>}
    <ConstructionPanel><ConstructionPanelHeader title="Project models" subtitle="Private, immutable files kept in your company project." />
      <div className={styles.editor}>{models.length ? models.map((model) => <Card key={model.id} className={styles.issue}><CardHeader title={model.name} subtitle={`${model.discipline} · ${model.componentCount} components · ${(model.size / 1048576).toFixed(1)} MB`} action={<StatusPill status={model.revision ? `Rev ${model.revision}` : model.format.toUpperCase()} tone="info" />} /><div className={styles.details}><span>{model.modelCode ?? 'Unversioned model'}</span><span>Uploaded {model.uploadedAtISO.slice(0, 10)}</span><span>{model.workPackageId ? `Package ${packages.find((row) => row.id === model.workPackageId)?.name ?? model.workPackageId}` : 'Whole project'}</span><span>SHA-256 {model.sha256.slice(0, 12)}…</span></div><div className={styles.actions}><Button type="button" variant="secondary" onClick={() => inspect(model.id)}><Layers3 size={15} /> View in 3D</Button><a href={`/api/construction/models/${model.id}`} download><Download size={15} aria-hidden="true" /> Download model</a></div></Card>) : <p className={styles.empty}>No models uploaded for this project.</p>}</div>
    </ConstructionPanel>
    {models.length >= 2 && <ConstructionPanel><ConstructionPanelHeader title="Revision comparison" subtitle="Match the same model code and package; detect changed triangles even when the element bounding box stays the same." />
      <form className={styles.form} onSubmit={(event) => { void compareRevisions(event); }}><label>Earlier revision<select required value={beforeId} onChange={(event) => { setBeforeId(event.target.value); setAfterId(''); setComparison(null); }}><option value="">Choose earlier revision</option>{models.map((row) => <option key={row.id} value={row.id}>{row.modelCode ?? row.discipline} · {row.revision ?? 'Unversioned'} · {row.name}</option>)}</select></label>
        <label>Later revision<select required value={afterId} onChange={(event) => { setAfterId(event.target.value); setComparison(null); }}><option value="">Choose later revision</option>{laterRevisions.map((row) => <option key={row.id} value={row.id}>{row.modelCode ?? row.discipline} · {row.revision ?? 'Unversioned'} · {row.name}</option>)}</select></label>
        <div className={styles.formAction}><Button type="submit" disabled={busy || !beforeId || !afterId || beforeId === afterId}>Compare revisions</Button></div>
      </form>
      {comparison && <div className={styles.editor}><p className={styles.meta}>{comparison.added} added · {comparison.removed} removed · {comparison.changed} geometry changed · 2 mm comparison grid</p>
        {comparison.changes.length ? comparison.changes.map((row) => <div key={row.id} className={styles.details}><StatusPill status={row.kind.replace('_', ' ')} tone={row.kind === 'removed' ? 'danger' : row.kind === 'added' ? 'success' : 'warn'} /><strong>{row.name}</strong><span>{row.id}</span><span>{row.beforeTriangles ?? 0} → {row.afterTriangles ?? 0} triangles</span><Button type="button" variant="secondary" onClick={() => inspect(row.kind === 'removed' ? beforeId : afterId, row.id)}>Inspect element</Button></div>) : <p className={styles.empty}>No element geometry changes at the selected tolerance.</p>}
      </div>}
    </ConstructionPanel>}
    {canUpload ? <ConstructionPanel><ConstructionPanelHeader title="Upload coordination model" subtitle="IFC, OBJ or GLB, up to 12 MB and 100,000 triangles per model. Export a floor or package for larger models. Give successive revisions the same model code and work package." /><form className={styles.form} onSubmit={(event) => { void upload(event); }} onChange={() => { if (!busy) key.current = null; }}>
      <label>Discipline<input required minLength={2} maxLength={80} value={discipline} onChange={(event) => setDiscipline(event.target.value)} placeholder="e.g. Structure or MEP" /></label>
      <label>Model code<input required minLength={2} maxLength={60} pattern="[A-Za-z0-9._-]+" value={modelCode} onChange={(event) => setModelCode(event.target.value)} placeholder="e.g. STR-L4" /></label>
      <label>Revision<input required minLength={1} maxLength={30} pattern="[A-Za-z0-9._-]+" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="e.g. P02" /></label>
      {packages.length > 0 && <label>Work package<select value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Whole project</option>{packages.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>}
      <label>IFC, OBJ or GLB file<input type="file" accept=".ifc,.obj,.glb,application/x-step,model/gltf-binary,text/plain" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <div className={styles.formAction}><Button type="submit" variant="primary" icon={<Upload size={16} />} disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload model'}</Button></div>
    </form></ConstructionPanel> : <Card className={styles.boundary}><strong>Company model upload</strong><p>Sign in to a company with Construction editing access and PostgreSQL storage to upload or scan models.</p></Card>}
    {canUpload && models.length >= 2 && <ConstructionPanel><ConstructionPanelHeader title="Precise geometry check" subtitle="Broad-phase bounds narrow the search; triangle surfaces then determine intersection or clearance within the selected tolerance." /><form className={styles.form} onSubmit={(event) => { void scan(event); }}>
      <label>First model<select required value={modelAId} onChange={(event) => setModelAId(event.target.value)}><option value="">Choose a model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.discipline} · {model.name}</option>)}</select></label>
      <label>Second model<select required value={modelBId} onChange={(event) => setModelBId(event.target.value)}><option value="">Choose a different model</option>{models.filter((model) => model.id !== modelAId).map((model) => <option key={model.id} value={model.id}>{model.discipline} · {model.name}</option>)}</select></label>
      <label>Clearance tolerance · mm<input type="number" min="0" max="1000" step="1" value={toleranceMm} onChange={(event) => setToleranceMm(Number(event.target.value))} required /></label>
      <div className={styles.formAction}><Button type="submit" variant="primary" icon={<ScanSearch size={16} />} disabled={busy || !modelAId || !modelBId || modelAId === modelBId}>{busy ? 'Comparing…' : 'Check surfaces'}</Button></div>
    </form></ConstructionPanel>}
    {issues.some((issue) => issue.clashDetection) && <ConstructionPanel><ConstructionPanelHeader title="Inspect detected contacts" subtitle="Open each recorded model and focus the exact linked element before engineering review." />
      <div className={styles.editor}>{issues.filter((issue) => issue.clashDetection).slice(0, 20).map((issue) => <div key={issue.id} className={styles.details}><strong>{issue.title}</strong><Button type="button" variant="secondary" onClick={() => inspect(issue.clashDetection!.modelAId, issue.clashDetection!.componentAId)}>Inspect first element</Button><Button type="button" variant="secondary" onClick={() => inspect(issue.clashDetection!.modelBId, issue.clashDetection!.componentBId)}>Inspect second element</Button></div>)}</div>
    </ConstructionPanel>}
    {(canUpload || canExport) && <ConstructionPanel><ConstructionPanelHeader title="BCF 3.0 exchange" subtitle="Share design topics, dated comments, snapshots, full viewpoints and local issue activity with BIM coordination tools. Models and private drawings stay in Propbrew." />
      <div className={styles.editor}>{canExport && <a href={`/api/construction/models/bcf?projectId=${encodeURIComponent(projectId)}`} download><Download size={16} aria-hidden="true" /> Export visible issues as BCFZIP</a>}
      {canUpload && <form className={styles.form} onSubmit={(event) => { void importBcf(event); }}>
        {packages.length > 0 && <label>Import into work package<select value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Whole project</option>{packages.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>}
        <label>BCFZIP file<input type="file" accept=".bcfzip,application/zip" required onChange={(event) => setBcfFile(event.target.files?.[0] ?? null)} /></label>
        <div className={styles.formAction}><Button type="submit" disabled={busy || !bcfFile}>{busy ? 'Importing…' : 'Import BCF topics'}</Button></div>
      </form>}</div>
    </ConstructionPanel>}
    {error && <p className={styles.feedback} role="alert">{error}</p>}{message && <p className={styles.feedback} role="status">{message}</p>}
    {runs.length > 0 && <ConstructionPanel><ConstructionPanelHeader title="Recent scans" subtitle="Repeated scans do not create duplicate issues for the same model components." /><div className={styles.editor}>{runs.slice(0, 5).map((run) => <p key={run.id} className={styles.meta}>{run.runAtISO.slice(0, 16).replace('T', ' ')} · {run.candidates} candidates · {run.created} new issues · {run.toleranceMm} mm tolerance</p>)}</div></ConstructionPanel>}
  </div>;
}
