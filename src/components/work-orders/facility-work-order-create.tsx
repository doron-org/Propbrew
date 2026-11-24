'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { FacilityDialog } from '@/components/facility/facility-ui';
import { createFacilityWorkOrder } from '@/server/actions/facility-registration';

export type FacilityWorkOrderLocation = { id: string; label: string };
export type FacilityWorkOrderAsset = { id: string; siteId: string; label: string };
export function FacilityWorkOrderCreate({ locations, assets, detailBase = '/work-orders', detailQuery = '', buttonLabel = 'New work order' }: { locations: FacilityWorkOrderLocation[]; assets: FacilityWorkOrderAsset[]; detailBase?: string; detailQuery?: string; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button type="button" variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>{buttonLabel}</Button>{open && <WorkOrderForm locations={locations} assets={assets} detailBase={detailBase} detailQuery={detailQuery} onClose={() => setOpen(false)} />}</>;
}
function WorkOrderForm({ locations, assets, detailBase, detailQuery, onClose }: { locations: FacilityWorkOrderLocation[]; assets: FacilityWorkOrderAsset[]; detailBase: string; detailQuery: string; onClose: () => void }) {
  const router = useRouter(), prefix = useId(), key = useRef(crypto.randomUUID()); const [siteId, setSiteId] = useState(locations[0]?.id ?? '');
  const [error, setError] = useState<string>(); const [pending, start] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; const form = new FormData(event.currentTarget), value = (name: string) => String(form.get(name) ?? '').trim(); setError(undefined);
    start(async () => { try { const result = await createFacilityWorkOrder({ siteId, assetId: value('assetId') || undefined, title: value('title'), description: value('description') || undefined, priority: value('priority'), idempotencyKey: key.current }); if (!result.ok) { setError(result.error); return; } onClose(); router.push(`${detailBase}/${encodeURIComponent(result.ref!)}${detailQuery}`); router.refresh(); } catch { setError('The work order could not be confirmed. Your entries are still here; retry to check the submission safely.'); } });
  }
  return <FacilityDialog title="New facility work order" onClose={onClose} pending={pending}><form onSubmit={submit} className="pb-section"><p className="text-sm text-text-2">Create an unassigned maintenance request. Triage, assignment and completion remain recorded workflow steps.</p><fieldset disabled={pending} className="m-0 grid gap-4 border-0 p-0"><label className="pb-form-label" htmlFor={`${prefix}-site`}>Location<select id={`${prefix}-site`} name="siteId" required value={siteId} onChange={(event) => setSiteId(event.target.value)} className="pb-form-control mt-2">{locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select></label><label className="pb-form-label" htmlFor={`${prefix}-asset`}>Asset (optional)<select key={siteId} id={`${prefix}-asset`} name="assetId" className="pb-form-control mt-2"><option value="">No linked asset</option>{assets.filter((asset) => asset.siteId === siteId).map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label><label className="pb-form-label" htmlFor={`${prefix}-title`}>Work order title<input id={`${prefix}-title`} name="title" required minLength={3} maxLength={160} className="pb-form-control mt-2" /></label><label className="pb-form-label" htmlFor={`${prefix}-details`}>Details<textarea id={`${prefix}-details`} name="description" maxLength={3000} rows={3} className="pb-form-control mt-2" /></label><label className="pb-form-label" htmlFor={`${prefix}-priority`}>Priority<select id={`${prefix}-priority`} name="priority" defaultValue="routine" className="pb-form-control mt-2">{['low', 'routine', 'high', 'emergency'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label></fieldset>{error && <p role="alert" className="text-sm text-tone-danger">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={pending || !siteId}>{pending ? 'Creating…' : 'Create work order'}</Button></div></form></FacilityDialog>;
}
