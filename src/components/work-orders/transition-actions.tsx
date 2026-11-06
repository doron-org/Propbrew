'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { FacilityDialog } from '@/components/facility/facility-ui';
import { fireWoTransition } from '@/server/actions/work-orders';
import layout from '@/components/ui/workspace-layout.module.css';

export type LegalEvent = { event: string; label: string; variant: 'primary' | 'default' | 'danger'; needsAssignee: boolean };
const REVIEW_EVENTS = ['RESOLVE', 'VERIFY', 'CLOSE', 'REJECT', 'CANCEL', 'REOPEN'];

export type AssigneeOption = { key: string; name: string; kind: 'technician' | 'vendor' };
export function TransitionActions({ woRef, events, assignees }: { woRef: string; events: LegalEvent[]; assignees: AssigneeOption[] }) {
  const router = useRouter();
  const selectId = useId();
  const noteId = useId();
  const inFlight = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<LegalEvent | null>(null);
  const [assignee, setAssignee] = useState(assignees[0]?.key ?? '');
  const [review, setReview] = useState<LegalEvent | null>(null);
  const [note, setNote] = useState('');
  function closeDialog() { if (!inFlight.current) { setAssignFor(null); setReview(null); setError(null); setNote(''); } }
  function fire(event: string, options?: { assigneeKey?: string; note?: string }) {
    if (inFlight.current || !events.some((legal) => legal.event === event)) return;
    inFlight.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = await fireWoTransition(woRef, event, options);
        if (!result.ok) { setError(result.error); return; }
        setAssignFor(null); setReview(null); router.refresh();
      } catch { setError('The work-order change could not be confirmed. Refresh the record before retrying.'); }
      finally { inFlight.current = false; }
    });
  }
  if (!events.length) return <p className={layout.body}>No actions available to you from this state.</p>;
  return <div className={layout.layout}>
    <div className={layout.filters}>{events.map((event) => <Button key={event.event} type="button" variant={event.variant === 'primary' ? 'primary' : 'secondary'} className={event.variant === 'danger' ? 'text-negative' : undefined} disabled={pending} aria-haspopup={event.needsAssignee || REVIEW_EVENTS.includes(event.event) ? 'dialog' : undefined} onClick={() => { setError(null); setNote(''); if (event.needsAssignee) { setReview(null); setAssignFor(event); } else if (REVIEW_EVENTS.includes(event.event)) { setAssignFor(null); setReview(event); } else fire(event.event); }}>{event.label}</Button>)}</div>
    {assignFor && <FacilityDialog title={`${assignFor.label} work order`} onClose={closeDialog} pending={pending}><form onSubmit={(event) => { event.preventDefault(); if (assignee) fire(assignFor.event, { assigneeKey: assignee }); }}><fieldset disabled={pending} className="border-0 p-0 m-0 min-w-0 flex flex-col gap-6"><p className={layout.body}>{woRef} · Review the intended owner before confirming this assignment. Only active technicians in this site scope and compliant vendors are available.</p><label htmlFor={selectId} className={layout.field}><span className={layout.label}>Assignee</span><select id={selectId} required aria-label="Assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)} className={layout.control}>{assignees.map((option) => <option key={option.key} value={option.key}>{option.name} · {option.kind}</option>)}</select></label>{!assignees.length && <p className={layout.metadata}>No eligible assignees are available in this scope.</p>}{error && <p role="alert" className="text-sm text-negative">{error}</p>}<div className={layout.actions}><Button type="button" disabled={pending} onClick={closeDialog}>Go back</Button><Button type="submit" variant="primary" disabled={pending || !assignee}>{pending ? 'Saving…' : `Confirm ${assignFor.label.toLowerCase()}`}</Button></div></fieldset></form></FacilityDialog>}
    {review && <FacilityDialog title={`${review.label} work order`} onClose={closeDialog} pending={pending}><form onSubmit={(event) => { event.preventDefault(); fire(review.event, note.trim() ? { note: note.trim() } : undefined); }}><fieldset disabled={pending} className="border-0 p-0 m-0 min-w-0 flex flex-col gap-6"><p className={layout.title}>{woRef} · {review.label}</p><p className={layout.body}>Confirm that the required work, evidence and approvals for this transition are complete. {['CLOSE', 'CANCEL', 'REJECT'].includes(review.event) ? 'This moves the record to a terminal state; later corrections must follow your authorised reopening policy.' : 'The change is recorded in the work-order history.'}</p>{['HOLD', 'RESOLVE'].includes(review.event) ? <label htmlFor={noteId} className={layout.field}><span className={layout.label}>{review.event === 'HOLD' ? 'Blocker' : 'Completion note'}</span><textarea id={noteId} aria-label={review.event === 'HOLD' ? 'Blocker' : 'Completion note'} rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={layout.control} placeholder={review.event === 'HOLD' ? 'What is blocking this job?' : 'What was completed? Technicians and vendors must record a note.'} /></label> : null}<p className={layout.metadata}>A work-order status is not proof of payment or vendor settlement.</p>{error && <p role="alert" className="text-sm text-negative">{error}</p>}<div className={layout.actions}><Button type="button" disabled={pending} onClick={closeDialog}>Go back</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : `Confirm ${review.label.toLowerCase()}`}</Button></div></fieldset></form></FacilityDialog>}
    {!assignFor && !review && error && <p role="alert" className={layout.feedback}>{error}</p>}
  </div>;
}
