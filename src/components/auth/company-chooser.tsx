'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, Building2, Check, Plus, ShieldCheck } from 'lucide-react';
import { PropbrewMark } from '@/components/brand/propbrew-logo';
import { signOut } from '@/server/actions/auth';
import styles from './auth.module.css';

export type CompanyActionState = { error?: string; fieldErrors?: Record<string, string[] | undefined>; message?: string; inviteUrl?: string };
export type CompanyFormAction = (data: FormData) => Promise<CompanyActionState | void>;
export type CompanySummary = { id: string; name: string; role: string; modules: string[] };
const workspaceLabels = (modules: string[]) => [
  ...(modules.includes('estate') || modules.includes('facility') ? ['Property Management'] : []),
  ...modules.filter((module) => module !== 'estate' && module !== 'facility').map((module) => module === 'shortlet' ? 'Shortlet' : module === 'construction' ? 'Construction' : module),
];

export function CompanyChooser({ companies, currentCompanyId, userName, createCompany, selectCompany, demo = false }: { companies: CompanySummary[]; currentCompanyId?: string | null; userName?: string; createCompany: CompanyFormAction; selectCompany: (companyId: string) => Promise<CompanyActionState | void>; demo?: boolean }) {
  const [selection, choose, choosing] = useActionState(async (_state: CompanyActionState, form: FormData) => await selectCompany(String(form.get('companyId') ?? '')) ?? {}, {});
  const active = companies.find((company) => company.id === currentCompanyId);
  return <main className={`pb-app ${styles.companyPage}`}><div className={styles.companyContainer}><header className={styles.companyHeader}><Link href="/companies" className={styles.brand} aria-label="Propbrew companies"><PropbrewMark />propbrew</Link><div className={styles.accountNavigation}>{userName && <span className={styles.hint}>Signed in as {userName}</span>}<nav aria-label="Company account"><Link href="/account/security">Account security</Link>{active && ['owner', 'admin'].includes(active.role) && <Link href="/company/team">Team & access</Link>}<form action={signOut}><SignOutButton /></form></nav></div></header><section className={styles.companyIntro}><span className={styles.eyebrow}>One account. Your companies.</span><h1>{companies.length ? 'Where are we working today?' : 'Give your team a place to grow.'}</h1><p>{companies.length ? 'Choose a company to open its records, team and available workspaces.' : 'Create a company to start your property operations. Your new company begins with an empty portfolio.'}</p></section>
    {selection.error && <p role="alert" className={styles.error}>{selection.error}</p>}
    {companies.length > 0 ? <div className={styles.companyGrid}>{companies.map((company) => <section key={company.id} className={`${styles.companyCard} ${company.id === currentCompanyId ? styles.activeCompany : ''}`} aria-labelledby={`company-${company.id}`}><div className={styles.companyCardHeader}><span className={styles.companyIcon}><Building2 size={23} aria-hidden="true" /></span>{company.id === currentCompanyId && <span className={styles.badge}><Check size={13} aria-hidden="true" />Current company</span>}</div><h2 id={`company-${company.id}`}>{company.name}</h2><p className={styles.hint}>{company.role.replaceAll('_', ' ')} access</p><div className={styles.moduleTags}>{company.modules.length ? workspaceLabels(company.modules).map((module) => <span key={module}>{module}</span>) : <span>Workspace access not assigned</span>}</div><form action={choose} aria-busy={choosing}><input type="hidden" name="companyId" value={company.id} /><button type="submit" disabled={choosing} className={styles.primary}>{choosing ? 'Opening company…' : 'Open company'}<ArrowRight size={16} aria-hidden="true" /></button></form></section>)}</div> : <div className={styles.companyEmpty}><span className={styles.companyIcon}><Building2 size={26} aria-hidden="true" /></span><h2>No company yet</h2><p>Create your company below, or open the private invitation link your company administrator shared with you.</p></div>}
    {!demo && (companies.length ? <details className={styles.createAnother}><summary><Plus size={17} aria-hidden="true" />Create another company</summary><CreateCompanyForm action={createCompany} /></details> : <section className={styles.createCompany}><h2>Create your company</h2><CreateCompanyForm action={createCompany} /></section>)}
    <p className={styles.companyFoot}><ShieldCheck size={16} aria-hidden="true" />Each company has its own records and team permissions.</p>
  </div></main>;
}

function SignOutButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button>;
}

function CreateCompanyForm({ action }: { action: CompanyFormAction }) {
  const id = useId();
  const [state, submit, pending] = useActionState(async (_previous: CompanyActionState, form: FormData) => await action(form) ?? {}, {});
  return <form action={submit} className={styles.form} aria-busy={pending}>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}<fieldset disabled={pending} className={styles.fieldset}><legend className="sr-only">New company details</legend><div className={styles.field}><label htmlFor={`${id}-company`}>Company name</label><input id={`${id}-company`} name="companyName" required minLength={2} maxLength={120} autoComplete="organization" placeholder="e.g. Palm Court Properties" aria-describedby={`${id}-hint`} /><p id={`${id}-hint`} className={styles.hint}>You will be the owner of this new company.</p></div><button type="submit" className={styles.primary} disabled={pending}><Plus size={16} aria-hidden="true" />{pending ? 'Creating company…' : 'Create company'}</button></fieldset></form>;
}
