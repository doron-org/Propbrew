'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, FileSearch, Link2, RotateCcw } from 'lucide-react';
import { Button, StatusPill } from '@/components/ui';
import { CopilotActivityPanel, CopilotAnswer, CopilotMessage, copilotStyles as styles } from './copilot-reference';
import type { CopilotExchange } from './use-copilot-stream';

export function copilotSnapshot(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Snapshot date unavailable' : `${date.toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lagos' })} WAT`;
}

/** Render verified public transport only; private provider reasoning is never a UI part. */
export function CopilotStreamReply({ exchange, name, busy, onRetry }: { exchange: CopilotExchange; name: string; busy: boolean; onRetry: (id: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const retryAt = exchange.error?.retryAfterS ? (exchange.completedAt ?? 0) + exchange.error.retryAfterS * 1000 : 0;
  useEffect(() => {
    const wait = retryAt - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 10);
    return () => clearTimeout(timer);
  }, [retryAt]);
  const retryable = exchange.status === 'stopped' || exchange.status === 'error' && exchange.error?.retryable;
  const incomplete = exchange.status === 'stopped' || exchange.status === 'error';
  return <CopilotMessage speaker="copilot" name={name} error={exchange.status === 'error'} badges={<>
    {exchange.meta && <StatusPill status={exchange.status === 'complete' ? 'AI answer' : exchange.text && incomplete ? 'Partial AI response' : incomplete ? 'AI connection confirmed' : 'AI response in progress'} tone="info" />}
    {exchange.status === 'stopped' && <StatusPill status="Stopped · incomplete" tone="warn" />}
    {exchange.status === 'error' && <StatusPill status="Request unsuccessful" tone="danger" />}
    {exchange.meta?.coverage.some((entry) => !entry.complete) && <StatusPill status="Partial record coverage" tone="warn" />}
    {exchange.grounding && <StatusPill status={exchange.grounding.status === 'supported' ? 'PDF citations checked' : exchange.grounding.status === 'needs_review' ? 'PDF claims need review' : 'PDF check unavailable'} tone={exchange.grounding.status === 'supported' ? 'success' : 'warn'} />}
  </>} sources={exchange.meta && <>
    <details className={styles.activity}>
      <summary aria-label="Record context & coverage"><span className={styles.activityMark}><FileSearch size={16} aria-hidden="true" /></span><span>Record context &amp; coverage</span><ChevronDown size={15} className={styles.activityChevron} aria-hidden="true" /></summary>
      <div className={styles.bodyPadding}>
        <p className={styles.sourceLabel}>Recorded snapshot · {copilotSnapshot(exchange.meta.snapshotISO)}</p>
        <p className={styles.metadata}>{exchange.meta.scopeLabel} · Provider model: {exchange.meta.model}</p>
        {exchange.meta.coverage.length > 0 && <ul className={styles.details}>{exchange.meta.coverage.map((entry, index) => <li key={`${entry.collection}-${index}`}>{entry.collection}: {entry.loaded.toLocaleString('en-NG')} loaded{entry.total !== null ? ` of ${entry.total.toLocaleString('en-NG')}` : ' · total unavailable'} · {entry.complete ? 'complete returned coverage' : 'partial coverage; verify the source register'}.</li>)}</ul>}
        {exchange.meta.notices.length > 0 && <ul className={styles.details}>{exchange.meta.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>}
      </div>
    </details>
    <span className={styles.sourceLabel}>Source records · verify before acting</span>
    {exchange.meta.sources.length ? <div className={styles.actions}>{exchange.meta.sources.map((source, index) => <Link key={`${source.id}-${index}`} href={source.href} className={styles.actionLink}><Link2 size={16} aria-hidden="true" />{source.label}</Link>)}</div> : <p className={styles.metadata}>No navigable source records were supplied. Verify the authorised register before relying on this answer.</p>}
    {exchange.status === 'complete' && exchange.usage?.recorded === false && <p className={styles.metadata}>The answer completed, but its usage record was not confirmed. Check the meter before relying on it.</p>}
  </>}>
    <CopilotActivityPanel activities={exchange.activities} status={exchange.status} startedAt={exchange.startedAt} completedAt={exchange.completedAt} />
    {exchange.text ? <CopilotAnswer text={exchange.text} /> : !incomplete && <p role="status">Waiting for the AI response…</p>}
    {exchange.grounding && <p className={styles.metadata} role="status">{exchange.grounding.message}</p>}
    {incomplete && exchange.text && <p className={styles.metadata}>This partial answer is incomplete. Review the source records before using it.</p>}
    {exchange.status === 'stopped' && <p>Request stopped. You can retry explicitly; no source records were changed.</p>}
    {exchange.error && <p>{exchange.error.message}</p>}
    {retryable && <div className={styles.actions}><Button type="button" disabled={busy || now < retryAt} icon={<RotateCcw size={16} />} onClick={() => onRetry(exchange.id)}>Retry question</Button>{now < retryAt && <p className={styles.metadata}>Wait {exchange.error?.retryAfterS} seconds from the failed request before retrying.</p>}</div>}
  </CopilotMessage>;
}
