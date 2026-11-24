'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { PortalDialog } from '@/components/portal/portal-dialog';
import { createEstateWorkOrder } from '@/server/actions/estate-work-orders';

export type EstateWorkOrderSiteOption = { id: string; label: string };
export type EstateWorkOrderUnitOption = { id: string; siteId: string; label: string };

export function EstateWorkOrderCreate({ sites, units = [], demo, native = false, persistent = false, detailBase = '/estate/work-orders', detailQuery = '', buttonLabel = 'New work order' }: {
  sites: EstateWorkOrderSiteOption[];
  units?: EstateWorkOrderUnitOption[];
  demo: boolean;
  native?: boolean;
  persistent?: boolean;
  detailBase?: string;
  detailQuery?: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const prefix = useId();
  const requestKey = useRef('');
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function show() {
    requestKey.current = crypto.randomUUID();
    setSiteId(sites[0]?.id ?? '');
    setError(null);
    setOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !demo && !native) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    setError(null);
    start(async () => {
      try {
        const result = await createEstateWorkOrder({
          siteId: value('siteId'), unitId: value('unitId') || undefined,
          title: value('title'), description: value('description') || undefined,
          priority: value('priority'), idempotencyKey: requestKey.current,
        });
        if (!result.ok) { setError(result.error); return; }
        setOpen(false);
        router.push(`${detailBase}/${encodeURIComponent(result.ref)}${detailQuery}`);
        router.refresh();
      } catch {
        setError('We could not confirm the save. Your entries are still here. Try again to safely check this request.');
      }
    });
  }

  return <>
    <Button type="button" variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={show}>{buttonLabel}</Button>
    {open ? <PortalDialog label="New estate work order" width={560} onClose={() => setOpen(false)} canClose={!pending} dismissOnBackdrop={false}>
      <div className="pb-panel">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div><p className="text-[12px] text-text-3 mb-1">Estate workspace</p><h2 className="pb-dialog-title">New work order</h2></div>
          <IconButton type="button" aria-label="Close work order form" disabled={pending} onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></IconButton>
        </div>
        {!demo && !native ? <div className="pb-section"><p className="text-[14px] text-text-2">Durable estate work-order creation is not connected yet. This form will not claim to save a production work order until storage is activated.</p><Button type="button" onClick={() => setOpen(false)}>Close</Button></div>
          : !sites.length ? <div className="pb-section"><p className="text-[14px] text-text-2">There are no authorised estate properties available. Register an estate property before raising a work order.</p><Button type="button" onClick={() => setOpen(false)}>Close</Button></div>
            : <form onSubmit={submit} className="pb-section" aria-busy={pending}>
              <p className="text-[14px] text-text-2">Raise a maintenance request without leaving Estate. It starts as New and unassigned; triage and assignment remain human decisions.</p>
              <p id={`${prefix}-demo`} className="rounded-lg border border-border bg-surface-2 p-3 text-[12px] text-text-3">{native ? 'This request is saved to your company database. Access follows your company and property permissions.' : persistent ? 'Database-backed review · use sample information only. Records are saved to the database.' : 'Sample workspace · use sample information only. Records reset when the application restarts.'} For an immediate danger, follow your estate’s emergency procedure.</p>
              <fieldset disabled={pending} className="grid gap-4 border-0 p-0 m-0 min-w-0" aria-describedby={`${prefix}-demo`}>
                <div><label className="pb-form-label" htmlFor={`${prefix}-site`}>Estate property</label><select id={`${prefix}-site`} name="siteId" className="pb-form-control" value={siteId} onChange={(event) => setSiteId(event.target.value)} required>{sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></div>
                <div><label className="pb-form-label" htmlFor={`${prefix}-unit`}>Unit (optional)</label><select key={siteId} id={`${prefix}-unit`} name="unitId" className="pb-form-control" defaultValue=""><option value="">Common area / no unit</option>{units.filter((unit) => unit.siteId === siteId).map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}</select></div>
                <div><label className="pb-form-label" htmlFor={`${prefix}-title`}>Work order title</label><input id={`${prefix}-title`} name="title" className="pb-form-control" required minLength={3} maxLength={160} placeholder="e.g. Repair a leaking pipe at the gatehouse" /></div>
                <div><label className="pb-form-label" htmlFor={`${prefix}-description`}>Details (optional)</label><textarea id={`${prefix}-description`} name="description" className="pb-form-control" rows={4} maxLength={3000} placeholder="Describe the issue, location and access instructions." /></div>
                <div><label className="pb-form-label" htmlFor={`${prefix}-priority`}>Priority</label><select id={`${prefix}-priority`} name="priority" className="pb-form-control" defaultValue="routine" required><option value="low">Low</option><option value="routine">Routine</option><option value="high">High</option><option value="emergency">Emergency</option></select></div>
              </fieldset>
              {error ? <p role="alert" className="text-[14px] text-tone-danger">{error}</p> : null}
              <div className="flex flex-wrap justify-end gap-2"><Button type="button" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? 'Creating…' : 'Create work order'}</Button></div>
            </form>}
      </div>
    </PortalDialog> : null}
  </>;
}
