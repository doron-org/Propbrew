'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Building2, Construction, House, LoaderCircle, Wrench } from 'lucide-react';
import { enterDemoAccount } from '@/server/actions/demo-auth';
import styles from './demo-access.module.css';

const WORKSPACES = [
  { id: 'estate', name: 'Estate', detail: 'People & properties', icon: Building2 },
  { id: 'facility', name: 'Facility', detail: 'Assets & maintenance', icon: Wrench },
  { id: 'shortlet', name: 'Shortlet', detail: 'Guests & stays', icon: House },
  { id: 'construction', name: 'Construction', detail: 'Projects & delivery', icon: Construction },
] as const;

export function DemoAccess({ disabled = false }: { disabled?: boolean }) {
  const prefix = useId();
  const [state, action, pending] = useActionState(enterDemoAccount, {});
  const [selected, setSelected] = useState<string | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.error) feedback.current?.focus(); }, [state]);

  return <section className={styles.demo} aria-labelledby={`${prefix}-title`} aria-describedby={`${prefix}-description`}>
    <div className={styles.heading}><h2 id={`${prefix}-title`}>Explore a demo</h2><span className={styles.badge}>Private sandbox</span></div>
    <p id={`${prefix}-description`} className={styles.description}>Add, edit and try workflows with sample data. Your changes stay in your own sandbox. No sign-up required.</p>
    <form action={action} aria-label="Demo workspaces" aria-busy={pending}>
      <fieldset className={styles.grid} disabled={disabled || pending}><legend className="sr-only">Choose a demo workspace</legend>
        {WORKSPACES.map(({ id, name, detail, icon: Icon }) => <button key={id} type="submit" name="module" value={id} className={styles.workspace} onClick={() => setSelected(id)}>
          <span className="sr-only">Explore demo: </span>
          <Icon size={17} aria-hidden="true" className={styles.icon} />
          <span className={styles.label}><strong>{pending && selected === id ? `Opening ${name}…` : name}</strong><span>{detail}</span></span>
          {pending && selected === id ? <LoaderCircle size={14} className={styles.spinner} aria-hidden="true" /> : <ArrowUpRight size={14} className={styles.arrow} aria-hidden="true" />}
        </button>)}
      </fieldset>
      {state.error && <p ref={feedback} role="alert" tabIndex={-1} className={styles.error}>{state.error}</p>}
    </form>
    <div className={styles.divider}><span>or use your own company account</span></div>
  </section>;
}
