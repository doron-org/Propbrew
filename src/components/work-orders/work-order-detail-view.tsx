import 'server-only';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can, type Actor, type Role } from '@/lib/authz';
import type { WorkOrder } from '@/domain/entities';
import { facilityAssigneesFor } from '@/server/facility-guards';
import { getHistory } from '@/server/data/store';
import { workOrderMachine } from '@/domain/workflows';
import { Card, CardHeader } from '@/components/ui';
import { PageTabs } from '@/components/ui/page-tabs';
import { DomainStatus, SlaBadge } from '@/components/domain';
import { facilityMoney } from '@/components/facility/facility-format';
import { Timeline } from '@/components/work-orders/timeline';
import { TransitionActions, type LegalEvent } from '@/components/work-orders/transition-actions';
import layout from '@/components/ui/workspace-layout.module.css';
import polish from '@/components/facility/facility-registers-polish.module.css';
import { withDurableRead } from '@/server/data/durable-records';

const NOW = '2026-07-26T09:00:00Z';
const CLOSED = ['closed', 'cancelled', 'rejected', 'verified'];

const EVENT_META: Record<string, { label: string; variant: LegalEvent['variant']; needsAssignee: boolean }> = {
  TRIAGE: { label: 'Triage', variant: 'primary', needsAssignee: false },
  ASSIGN: { label: 'Assign', variant: 'primary', needsAssignee: true },
  REASSIGN: { label: 'Reassign', variant: 'default', needsAssignee: true },
  START: { label: 'Start work', variant: 'primary', needsAssignee: false },
  HOLD: { label: 'Put on hold', variant: 'default', needsAssignee: false },
  RESUME: { label: 'Resume', variant: 'primary', needsAssignee: false },
  RESOLVE: { label: 'Mark resolved', variant: 'primary', needsAssignee: false },
  VERIFY: { label: 'Verify', variant: 'primary', needsAssignee: false },
  CLOSE: { label: 'Close', variant: 'default', needsAssignee: false },
  REOPEN: { label: 'Reopen', variant: 'default', needsAssignee: false },
  REJECT: { label: 'Reject', variant: 'danger', needsAssignee: false },
  CANCEL: { label: 'Cancel', variant: 'danger', needsAssignee: false },
};

export async function WorkOrderDetailView({ actor, wo, basePath, returnHref }: { actor: Actor; wo: WorkOrder; basePath: '/work-orders' | '/estate/work-orders'; returnHref?: string }) {
  return withDurableRead(async () => {
  const canTransition = can(actor, 'work_orders', 'transition').allowed;

  // The legal events for THIS actor from the current state (deduped by event).
  const legalEvents: LegalEvent[] = canTransition
    ? Array.from(
        new Map(
          workOrderMachine.transitions
            .filter((t) => t.from === wo.status && t.actors.some((a) => (actor.roles as Role[]).includes(a as Role)))
            .map((t) => [t.event, t]),
        ).keys(),
      )
        .filter((e) => EVENT_META[e])
        .map((e) => ({ event: e, ...EVENT_META[e] }))
    : [];

  const assignees = (await facilityAssigneesFor(actor, wo.siteId)).map((candidate) => ({ key: candidate.key, name: candidate.assigneeName, kind: candidate.kind }));

  const history = getHistory('work-order', wo.id);
  const breached = !CLOSED.includes(wo.status) && wo.respondDueAt !== null && wo.respondDueAt < NOW;
  const showAiTriage = ['new', 'triaged'].includes(wo.status) && canTransition;

  return (
    <div className="pb-page">
      <Link href={returnHref ?? basePath} className={polish.link}>
        <ArrowLeft size={15} /> Work orders
      </Link>

      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-medium">{wo.ref}</span>
              <DomainStatus type="work_order" status={wo.status} />
              <SlaBadge dueAt={wo.respondDueAt} breached={breached} />
            </div>
            <h2 className="mt-4 text-[22px] font-medium leading-snug tracking-tight">{wo.title}</h2>
            {wo.description && (
              <p className="text-[14px] text-text-2 leading-relaxed mt-2 max-w-[68ch]">{wo.description}</p>
            )}
            <p className="text-[14px] text-text-3 mt-1">
              {wo.origin.replace(/_/g, ' ')} · raised by {wo.requesterName}
            </p>
          </div>
          <div className="text-right">
            <div className={layout.metadata}>Recorded cost</div>
            <div className="text-[18px] font-medium tabular-nums">{wo.cost ? facilityMoney(wo.cost.minor, wo.cost.currency) : '—'}</div>
          </div>
        </div>

        <dl className={`${polish.workFacts} mt-6 pt-6 border-t border-border`}>
          <Field label="Priority" value={wo.priority} />
          <Field label="Assignee" value={wo.assigneeName} />
          <Field label="Respond by" value={fmt(wo.respondDueAt)} />
          <Field label="Resolve by" value={fmt(wo.resolveDueAt)} />
        </dl>
        <p className={`${layout.metadata} mt-6`}>Service targets are assessed against the recorded reference snapshot: {fmt(NOW)}. Cost is not proof of payment or vendor settlement.</p>
      </Card>

      <PageTabs label={`${wo.ref} sections`} items={[
        { id: 'actions', label: 'Actions & triage', content: <div className="flex flex-col gap-6 max-[640px]:gap-4">
      {showAiTriage && basePath === '/work-orders' && (
        <Card><CardHeader title="Triage review" subtitle="AI-F-02 · human review required · no automatic assignment" /><p className="text-[14px] text-text-2 leading-relaxed">Review the recorded <strong>{wo.priority}</strong> priority, request details and available assignees before acting. No calibrated model confidence or similar-job evidence is available for this record.</p></Card>
      )}
      {showAiTriage && basePath === '/estate/work-orders' && <Card>
        <CardHeader title="Triage review" subtitle="Manager review required · no automatic assignment" />
        <p className="text-[14px] text-text-2 leading-relaxed">Review the request and its recorded <strong>{wo.priority}</strong> priority before triaging or assigning it below. Follow your estate’s SLA policy; this guidance does not apply decisions automatically.</p>
      </Card>}

        <Card>
          <CardHeader title="Actions" subtitle={`Legal moves from “${wo.status.replace(/_/g, ' ')}” for your role`} />
          <div className="mt-3">
            {canTransition ? (
              <TransitionActions woRef={wo.ref} events={legalEvents} assignees={assignees} />
            ) : (
              <p className="text-[14px] text-text-3">You have view-only access to work orders.</p>
            )}
          </div>
        </Card>

        </div> },
        { id: 'history', label: 'Activity history', count: history.length, content: <Card>
          <CardHeader title="Activity history" subtitle="Recorded transitions, timestamps and attributed actors" />
          <div className="mt-3">
            <Timeline machineKey="work-order" entries={history} />
          </div>
        </Card> },
      ]} />
    </div>
  );
  });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={layout.metadata}>{label}</dt>
      <dd className="text-sm font-medium mt-2 break-words">{value}</dd>
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return `${new Date(iso).toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })} WAT`;
}

