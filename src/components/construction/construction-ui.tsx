'use client';

import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { Check, Info, Search, X } from 'lucide-react';
import { Card, CardHeader, KpiCard, IconButton, Button, EmptyState } from '@/components/ui';
import { PortalDialog } from '@/components/portal/portal-dialog';
import { toneVar, type Tone } from '@/lib/status-tones';
import shared from '@/components/ui/workspace-layout.module.css';
import styles from './construction-ui.module.css';

export function ConstructionSnapshotProvider({ children }: { snapshot: { iso: string; native: boolean }; children?: ReactNode }) {
  return children;
}
/** Composed operational patterns; construction diagrams keep their own geometry. */
export function ConstructionFrame({ children }: { children: ReactNode; snapshotISO?: string; native?: boolean }) {
  return <div className={`${shared.layout} ${styles.workspace}`}>{children}</div>;
}

export function ConstructionPanel({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={styles.section} style={style}><Card padded={false} className={`${styles.panel} ${className}`}>{children}</Card></section>;
}

export function ConstructionPanelHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return <div className={`${shared.registerHeader} ${styles.panelHeader}`}><CardHeader title={title} subtitle={subtitle} action={children ? <div className={shared.filters}>{children}</div> : undefined} /></div>;
}

export function ConstructionSummary({ children }: { children: ReactNode }) {
  return <Card className={styles.summary}>{children}</Card>;
}

export function ConstructionKpi({ label, value, tone, icon }: { label: string; value: string; tone: Tone; icon?: ReactNode }) {
  const financialOrLong = value.includes('₦') || value.length > 12;
  return <div className={financialOrLong ? `${styles.metric} ${styles.longMetric}` : styles.metric}><KpiCard label={label} value={value} icon={icon} iconColor={toneVar(tone)} /></div>;
}

export function ConstructionSearch({ label, value, onChange, count }: { label: string; value: string; onChange: (value: string) => void; count: number }) {
  return <div className={shared.toolbar}><label className={shared.search}><Search size={18} /><input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} /></label><span className={shared.metadata} role="status">{count} matching record{count === 1 ? '' : 's'}</span></div>;
}

export function ConstructionEmpty({ title, description = 'No records are available in the current scope. Adjust a filter or return when a record is available.' }: { title: string; description?: string }) {
  return <Card><EmptyState title={title} description={description} /></Card>;
}

export function ConstructionDialog({ title, children, onClose, pending = false }: { title: string; children: ReactNode; onClose: () => void; pending?: boolean }) {
  return <PortalDialog label={title} onClose={onClose} canClose={!pending} dismissOnBackdrop={!pending} width={600}>
    <div className={`${shared.modal} ${styles.workspace} ${styles.dialog}`} aria-busy={pending}>
      <header className={shared.dialogHeader}><div><h2 className={shared.dialogTitle}>{title}</h2><p className={shared.metadata}>Construction workspace · human review</p></div><IconButton type="button" aria-label={`Close ${title}`} onClick={onClose} disabled={pending}><X size={18} /></IconButton></header>
      <div className={shared.dialogBody}><fieldset disabled={pending} className={styles.formBody}><legend className="sr-only">{title}</legend>{children}</fieldset></div>
    </div>
  </PortalDialog>;
}

type ActionResult = { ok: boolean; error?: string; ref?: string };
type Review = { run: () => Promise<ActionResult>; title: string; detail?: string };

/** No consequential list action runs before this native, keyboard-safe review. */
export function useConstructionReview(refresh: () => void, flash: (message: string) => void) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submitting = useRef(false);
  const act = (run: Review['run'], title: string, detail?: string) => {
    if (pending) return;
    setError(null);
    setReview({ run, title, detail });
  };
  const confirm = () => {
    if (!review || pending || submitting.current) return;
    submitting.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await review.run();
        if (!result.ok) { setError(result.error ?? 'This change could not be saved. Try again.'); return; }
        refresh();
        flash(result.ref ? `${review.title} · ${result.ref}` : review.title);
        setReview(null);
      } catch { setError('The change could not be confirmed. Check the record before retrying.'); }
      finally { submitting.current = false; }
    });
  };
  const confirmation = review ? <ConstructionDialog title="Review construction change" onClose={() => setReview(null)} pending={pending}>
    <CardHeader title={review.title} subtitle="Confirm only after checking the source record and your approval authority." />
    <div className={shared.notice}><Info size={18} /><p>{review.detail ?? 'This updates the construction record. Review quantities, dates and any financial or safety consequences before continuing.'}<span>Rules-based recommendations are advisory. This confirmation does not verify physical work.</span></p></div>
    {error && <div className={shared.feedback} role="alert">{error}</div>}
    <div className={shared.actions}><Button type="button" onClick={() => setReview(null)} disabled={pending}>Cancel</Button><Button type="button" variant="primary" icon={<Check size={16} />} onClick={confirm} disabled={pending}>{pending ? 'Saving…' : 'Confirm change'}</Button></div>
  </ConstructionDialog> : null;
  return { act, confirmation, pending };
}

/** Duplicate protection and local feedback for every construction form dialog. */
export function useConstructionSave(onError: (message: string) => void) {
  const [pending, transition] = useTransition();
  const submitting = useRef(false);
  const start = (save: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    transition(async () => {
      try { await save(); }
      catch { onError('The change could not be confirmed. Check the source record before retrying.'); }
      finally { submitting.current = false; }
    });
  };
  return [pending, start] as const;
}

export function ConstructionToast({ children }: { children: ReactNode }) {
  return <div role="status" className={shared.toast}>{children}</div>;
}

/** All amounts stay exact to kobo; compact millions belong only in chart axes. */
export function constructionNaira(minor: number) {
  return `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
