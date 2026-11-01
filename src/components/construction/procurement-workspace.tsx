'use client';

import styles from './construction-commercial-polish.module.css';

import { useConstructionSave, useConstructionReview, ConstructionPanel, ConstructionToast, ConstructionKpi as Kpi, constructionNaira as naira, ConstructionDialog, ConstructionFrame, ConstructionPanelHeader, ConstructionEmpty } from './construction-ui';
import { Button, CardHeader, EmptyState, StatusPill } from '@/components/ui';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Truck, Gavel, TriangleAlert, Check, Star, ShieldAlert, Banknote } from 'lucide-react';
import { toneVar, type Tone } from '@/lib/status-tones';

import { approvePurchaseRequest, approvePurchaseOrder, awardRfq, receiveDelivery } from '@/server/actions/construction';
import { PageTabs } from '@/components/ui/page-tabs';
import { PageHeader } from '@/components/ui/page-header';

export type RequestRow = { id: string; ref: string; item: string; qty: number; unit: string; costCode: string; estimateMinor: number; requiredISO: string; requestedBy: string; status: string; justification: string; exception: boolean; remainingMinor: number };
export type ScoredBid = { vendorId: string; vendorName: string; priceMinor: number; leadDays: number; warrantyMonths: number; compliancePct: number; score: number; priceScore: number; leadScore: number; warrantyScore: number; complianceScore: number; recommended: boolean; vendorBand: Tone; suspended: boolean };
export type RfqRow = { id: string; ref: string; item: string; qty: number; unit: string; status: string; bids: ScoredBid[]; awardedVendorId?: string };
export type OrderRow = { id: string; ref: string; item: string; vendorName: string; qty: number; deliveredQty: number; unit: string; valueMinor: number; status: string; expectedISO: string; late: boolean };

const PR_TONE: Record<string, Tone> = { draft: 'muted', pending: 'warn', approved: 'success', rejected: 'danger', rfq: 'progress', ordered: 'info' };
const PO_TONE: Record<string, Tone> = { draft: 'muted', approved: 'info', issued: 'progress', acknowledged: 'progress', part_delivered: 'warn', delivered: 'success', closed: 'muted', cancelled: 'danger' };
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

export function ProcurementWorkspace({ requests, rfqs, orders, kpis, canMutate }: {
  requests: RequestRow[]; rfqs: RfqRow[]; orders: OrderRow[];
  kpis: { pending: number; openPoMinor: number; lateDeliveries: number; exceptions: number };
  canMutate: boolean;
}) {
  const router = useRouter();

  const [receiveFor, setReceiveFor] = useState<OrderRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const { act, confirmation, pending } = useConstructionReview(() => router.refresh(), flash);

  return (
    <ConstructionFrame><div className={styles.workspace}>
      <PageHeader title="Procurement" subtitle="Review requests, compare bids and track purchase orders to delivery." />
      <PageTabs label="Construction procurement sections" items={[
        {
          id: 'orders', label: 'Purchase orders', content: <div className="pb-section">
            <ConstructionPanel >
              <ConstructionPanelHeader title="Purchase requests"></ConstructionPanelHeader>
              <div className="divide-y divide-border">
                {requests.map((r) => (
                  <div key={r.id} className="px-6 py-4" style={r.exception ? { background: 'color-mix(in srgb, var(--tone-danger) 5%, transparent)' } : undefined}>
                    <div className={styles.requestRow}>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium flex items-center gap-1.5 flex-wrap">
                          {r.item}
                          {r.exception && <span className="text-[12px] font-semibold px-1.5 min-h-6 inline-flex items-center rounded-full gap-1" style={{ background: `color-mix(in srgb, ${toneVar('danger')} 15%, transparent)`, color: toneVar('danger') }}><TriangleAlert size={9} /> budget exception</span>}
                        </div>
                        <p className={styles.metadata}>{r.ref} · {r.costCode}</p><dl className={styles.facts}><div><dt>Requested quantity</dt><dd>{r.qty} {r.unit}</dd></div><div><dt>Required operating date · WAT</dt><dd><time dateTime={r.requiredISO}>{dateLabel(r.requiredISO)}</time></dd></div><div><dt>Requested by</dt><dd>{r.requestedBy}</dd></div><div><dt>Remaining code budget</dt><dd>{naira(r.remainingMinor)}</dd></div></dl><p className={`${styles.text} mt-4`}><strong className="font-medium">Justification: </strong>{r.justification || 'No justification recorded.'}</p>
                        {r.exception && <div className="text-[12px] mt-1" style={{ color: toneVar('danger') }}>{naira(r.estimateMinor)} exceeds the {naira(r.remainingMinor)} left on {r.costCode} — routes to QS/executive for override or a budget revision.</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <span className="text-[14px] font-medium font-mono">{naira(r.estimateMinor)}</span>
                        <span className="text-[12px] font-semibold px-2 h-6 inline-flex items-center rounded-full capitalize" style={{ background: `color-mix(in srgb, ${toneVar(PR_TONE[r.status] ?? 'muted')} 14%, transparent)`, color: toneVar(PR_TONE[r.status] ?? 'muted') }}>{r.status}</span>
                        {canMutate && (r.status === 'pending' || r.status === 'draft') && <Button type="button" disabled={pending} onClick={() => act(() => approvePurchaseRequest(r.id), `Approve ${r.ref}`, `${r.item}: ${r.qty} ${r.unit}, estimated ${naira(r.estimateMinor)} against ${r.costCode}. ${r.exception ? 'A budget exception is flagged; check the authorised override route before proceeding.' : 'Review the request justification and required date.'}`)} ><Check size={12} /> Approve</Button>}
                      </div>
                    </div>
                  </div>
                ))}
                {requests.length === 0 && <ConstructionEmpty title="No purchase requests" />}
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'rfqs', label: 'RFQs & awards', content: <div className="pb-section">
            {rfqs.map((rfq) => (
              <ConstructionPanel key={rfq.id} style={{ borderColor: rfq.status === 'awarded' ? 'var(--border)' : 'color-mix(in srgb, var(--tone-progress) 35%, transparent)' }}>
                <div className={styles.header}><CardHeader title={`Bid comparison · ${rfq.item}`} subtitle={`${rfq.ref} · ${rfq.qty} ${rfq.unit} · ${rfq.bids.length} quotes scored`} action={<StatusPill status={rfq.status} tone={rfq.status === 'awarded' ? 'success' : 'progress'} />} /></div>
                <div className={styles.footer}>Weighted score — price 45% · lead time 20% · compliance 20% · warranty 15%. Advisory: a human awards. These are deterministic rule scores, not verified supplier capability or an AI decision.</div>
                <div className="divide-y divide-border">
                  {rfq.bids.map((b) => (
                    <div key={b.vendorId} className="px-6 py-4" style={b.recommended && rfq.status !== 'awarded' ? { background: 'color-mix(in srgb, var(--tone-success) 5%, transparent)' } : undefined}>
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium flex items-center gap-1.5 flex-wrap">
                            {b.vendorName}
                            {b.recommended && <span className="text-[12px] font-semibold px-1.5 min-h-6 inline-flex items-center rounded-full gap-1" style={{ background: `color-mix(in srgb, ${toneVar('success')} 15%, transparent)`, color: toneVar('success') }}><Star size={9} /> recommended</span>}
                            {rfq.awardedVendorId === b.vendorId && <span className="text-[12px] font-semibold px-1.5 min-h-6 inline-flex items-center rounded-full" style={{ background: `color-mix(in srgb, ${toneVar('info')} 15%, transparent)`, color: toneVar('info') }}>awarded</span>}
                            {b.suspended && <span className="text-[12px] font-semibold px-1.5 min-h-6 inline-flex items-center rounded-full gap-1" style={{ background: `color-mix(in srgb, ${toneVar('danger')} 15%, transparent)`, color: toneVar('danger') }}><ShieldAlert size={9} /> suspended</span>}
                          </div>
                          <dl className={styles.facts}><div><dt>Quoted price · NGN</dt><dd>{naira(b.priceMinor)}</dd></div><div><dt>Lead time</dt><dd>{b.leadDays} days</dd></div><div><dt>Recorded compliance</dt><dd>{b.compliancePct}%</dd></div><div><dt>Warranty</dt><dd>{b.warrantyMonths} months</dd></div></dl>
                        </div>
                        <div className="flex items-center gap-2 flex-none">
                          <div className="text-right"><div className="text-[19px] font-bold tracking-[-0.02em] leading-none" style={{ color: toneVar(b.score >= 75 ? 'success' : b.score >= 55 ? 'warn' : 'muted') }}>{b.score}</div><div className="text-[12px] text-text-3">score</div></div>
                          {canMutate && rfq.status !== 'awarded' && !b.suspended && <Button variant="primary" type="button" disabled={pending} onClick={() => act(() => awardRfq(rfq.id, b.vendorId), `Award ${rfq.ref} to ${b.vendorName}`, `This issues a purchase order and commits ${naira(b.priceMinor)} for ${rfq.qty} ${rfq.unit} of ${rfq.item}. The weighted score is advisory, not an approval.`)} >Award</Button>}
                        </div>
                      </div>
                      {/* score breakdown */}
                      <div className={styles.scoreGrid}>
                        {[['Price', b.priceScore], ['Lead', b.leadScore], ['Compliance', b.complianceScore], ['Warranty', b.warrantyScore]].map(([label, v]) => (
                          <div key={label as string}>
                            <div className={styles.chartLabel}><span>{label}</span><strong>{v as number} / 100</strong></div>
                            <div className={styles.bar} role="img" aria-label={`${label} rule score ${v} out of 100`}><span style={{ width: `${v as number}%`, background: toneVar('progress') }} /></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {rfq.bids.length === 0 && <div className={styles.body}><EmptyState title="No bids recorded" description="Record supplier quotations before comparing or awarding this RFQ. No supplier is selected automatically." /></div>}
              </ConstructionPanel>
            ))}
            {rfqs.length === 0 && <ConstructionEmpty title="No requests for quotation" />}
          </div>
        },
        {
          id: 'deliveries', label: 'Deliveries', content: <div className="pb-section">
            <ConstructionPanel >
              <ConstructionPanelHeader title="Purchase orders"></ConstructionPanelHeader>
              <div className="divide-y divide-border">
                {orders.map((o) => (
                  <div key={o.id} className="px-6 py-4 flex items-center gap-4 flex-wrap" style={o.late ? { background: 'color-mix(in srgb, var(--tone-danger) 5%, transparent)' } : undefined}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium flex items-center gap-1.5 flex-wrap">{o.item}{o.late && <span className="text-[12px] font-semibold px-1.5 min-h-6 inline-flex items-center rounded-full" style={{ background: `color-mix(in srgb, ${toneVar('danger')} 15%, transparent)`, color: toneVar('danger') }}>late</span>}</div>
                      <p className={styles.metadata}>{o.ref} · {o.vendorName}</p><dl className={styles.facts}><div><dt>Expected operating date · WAT</dt><dd><time dateTime={o.expectedISO}>{dateLabel(o.expectedISO)}</time></dd></div><div><dt>Ordered</dt><dd>{o.qty} {o.unit}</dd></div><div><dt>Received in record</dt><dd>{o.deliveredQty} {o.unit}</dd></div><div><dt>Outstanding</dt><dd>{o.qty - o.deliveredQty} {o.unit}</dd></div></dl>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden max-w-[180px]"><div className="h-full rounded-full" style={{ width: `${(o.deliveredQty / Math.max(1, o.qty)) * 100}%`, background: toneVar(o.deliveredQty >= o.qty ? 'success' : o.late ? 'danger' : 'progress') }} /></div>
                        <span className="text-[12px] text-text-3">{o.deliveredQty}/{o.qty} {o.unit}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      <span className="text-[14px] font-medium font-mono">{naira(o.valueMinor)}</span>
                      <span className="text-[12px] font-semibold px-2 h-6 inline-flex items-center rounded-full capitalize" style={{ background: `color-mix(in srgb, ${toneVar(PO_TONE[o.status] ?? 'muted')} 14%, transparent)`, color: toneVar(PO_TONE[o.status] ?? 'muted') }}>{o.status.replace('_', ' ')}</span>
                      {canMutate && ['draft', 'approved'].includes(o.status) && <Button type="button" disabled={pending} onClick={() => act(() => approvePurchaseOrder(o.id), `${o.status === 'draft' ? 'Approve' : 'Issue'} ${o.ref}`, `Review ${o.item}, ${o.qty} ${o.unit} and the recorded commitment of ${naira(o.valueMinor)} before advancing this purchase order. No supplier payment is made.`)}>{o.status === 'draft' ? 'Approve order' : 'Issue order'}</Button>}
                      {canMutate && ['issued', 'acknowledged', 'part_delivered'].includes(o.status) && o.deliveredQty < o.qty && <Button variant="primary" type="button" disabled={pending} onClick={() => setReceiveFor(o)} >Receive</Button>}
                    </div>
                  </div>
                ))}
                {orders.length === 0 && <ConstructionEmpty title="No purchase orders" />}
              </div>
            </ConstructionPanel>
          </div>
        },
        {
          id: 'overview', label: 'Overview', content: <div className="pb-section">
            <div className="grid grid-cols-1 min-[520px]:grid-cols-2 min-[1100px]:grid-cols-4 gap-6">
              <Kpi label="Awaiting approval" value={String(kpis.pending)} tone={kpis.pending ? 'warn' : 'success'} icon={<Gavel size={16} />} />
              <Kpi label="Open PO value" value={naira(kpis.openPoMinor)} tone="progress" icon={<Banknote size={16} />} />
              <Kpi label="Late deliveries" value={String(kpis.lateDeliveries)} tone={kpis.lateDeliveries ? 'danger' : 'success'} icon={<Truck size={16} />} />
              <Kpi label="Budget exceptions" value={String(kpis.exceptions)} tone={kpis.exceptions ? 'danger' : 'success'} icon={<TriangleAlert size={16} />} />
            </div>
          </div>
        }
      ]} />

      {/* Bid intelligence — the crown */}

      {/* Requests */}

      {/* Orders */}

      {receiveFor && <ReceiveDialog order={receiveFor} onClose={() => setReceiveFor(null)} onDone={(m) => { setReceiveFor(null); flash(m); }} />}
      {confirmation}
      {toast && <ConstructionToast>{toast}</ConstructionToast>}
    </div></ConstructionFrame>
  );
}

function ReceiveDialog({ order, onClose, onDone }: { order: OrderRow; onClose: () => void; onDone: (m: string) => void }) {
  const fieldId = useId();
  const router = useRouter();
  const outstanding = order.qty - order.deliveredQty;
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useConstructionSave(setError);
  function submit() { setError(null); start(async () => { const r = await receiveDelivery(order.id, Number(qty)); if (!r.ok) { setError(r.error); return; } router.refresh(); onDone(`Received ${r.ref} · stock and cost booked`); }); }
  return (
    <ConstructionDialog title={"Record goods receipt"} onClose={onClose} pending={pending}>
      <div className={styles.notice}><div><p className={styles.title}>{order.item}</p><p className={styles.metadata}>{order.ref} · {order.vendorName}</p><dl className={styles.facts}><div><dt>Order value · NGN</dt><dd>{naira(order.valueMinor)}</dd></div><div><dt>Received / ordered</dt><dd>{order.deliveredQty} / {order.qty} {order.unit}</dd></div><div><dt>Outstanding</dt><dd>{outstanding} {order.unit}</dd></div></dl></div></div>
      <label htmlFor={fieldId} className="pb-form-label">Quantity physically received · {order.unit}</label>
      <input id={fieldId} aria-label="Quantity received" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" type="number" min="0" max={outstanding} step="any" className={styles.control} autoFocus />
      <p className="text-[12px] text-text-3 mt-1.5">Confirm the physically received quantity. This books stock and pro-rata actual cost against {order.ref}&apos;s cost code. It does not verify goods independently.</p>
      {error && <div role="alert" className="text-[12px] text-negative mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-4"><Button type="button" disabled={pending} onClick={onClose} >Cancel</Button><Button variant="primary" type="button" onClick={submit} disabled={pending || !(Number(qty) > 0) || Number(qty) > outstanding} >{pending ? 'Booking…' : 'Confirm goods receipt'}</Button></div>
    </ConstructionDialog>
  );
}
