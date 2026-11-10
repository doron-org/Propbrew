import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, LayoutGrid, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { PropbrewMark } from '@/components/brand/propbrew-logo';
import { Icon } from '@/components/icon';
import { WORKSPACES, availableWorkspaces, canEnterWorkspace, workspaceById } from '@/config/workspaces';
import { requireOperatorSession } from '@/server/workspaces';
import { devIdentityEnabled } from '@/server/session';
import styles from '@/components/workspaces/workspace-chooser.module.css';
import { withDurableRead } from '@/server/data/durable-records';
import { isDemoAccount } from '@/server/auth/demo-config';
import { currentRecordContext } from '@/server/data/record-context';
import { getOwnerSetup } from '@/server/onboarding/repository';
import { canUseCompanyModule } from '@/lib/auth/company-policy';
import { db } from '@/server/data/store';

export const metadata: Metadata = { title: 'Choose your workspace · Propbrew', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  return withDurableRead(async () => {
  const session = await requireOperatorSession();
  const { actor } = session;
  const from = (await searchParams).from;
  const current = workspaceById(typeof from === 'string' ? from : undefined);
  const available = availableWorkspaces(actor);
  const name = session.key === 'clerk' ? session.label : session.label.split(' — ')[0];
  const demo = session.key !== 'clerk' && devIdentityEnabled();
  const principal = currentRecordContext()?.companyPrincipal;
  const ownerSetup = principal?.membership.companyRole === 'owner' && !isDemoAccount(actor.userId)
    && canUseCompanyModule(actor, 'estate', 'create')
    ? await getOwnerSetup(`company:${principal.company.id}`) : null;
  const showSetup = ownerSetup && !ownerSetup.completedAt && (ownerSetup.version > 0
    || !db.sites.some((site) => site.tenantId === actor.tenantId && site.kind === 'estate'));

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link href="/workspaces" className={styles.brand} aria-label="Propbrew workspaces"><PropbrewMark />propbrew</Link>
          <div className={styles.identity}><strong>{name} · {session.roleSummary}</strong><span>{session.tenantLabel}</span></div>
          {actor.companyAccess && <nav aria-label="Company account"><Link href="/companies">Switch company</Link>{['owner','admin'].includes(actor.companyAccess.companyRole) && <> · <Link href="/company/team">Team & access</Link></>} · <Link href="/account/security">Account security</Link></nav>}
        </header>
        <section className={styles.intro} aria-labelledby="workspace-title">
          <p className={styles.eyebrow}><LayoutGrid size={13} aria-hidden="true" />One account. Focused workspaces.</p>
          <h1 id="workspace-title">Choose your workspace</h1>
          <p>Different operations deserve different views. Enter the portal built for the work you need to do—each with its own home, navigation, and tools.</p>
        </section>
        {showSetup && <section className={styles.setupPrompt} aria-label="Portfolio setup">
          <div><strong>{ownerSetup.version > 0 ? 'Your portfolio setup is saved' : 'Make this company your own'}</strong>
            <p>{ownerSetup.version > 0 ? 'Continue from your last saved step and create your first property and units.' : 'Set up your portfolio and create your first property and units when you are ready.'}</p></div>
          <Link href="/onboarding">{ownerSetup.version > 0 ? 'Resume portfolio setup' : 'Start portfolio setup'}<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>}
        <p className={styles.accessNote}><ShieldCheck size={14} aria-hidden="true" /><span><strong>{available.length} of 4 workspaces</strong> available to your current role. Your account, organisation, and permissions stay the same.</span></p>
        <div className={styles.grid}>
          {WORKSPACES.map((workspace) => {
            const allowed = canEnterWorkspace(actor, workspace.id);
            const active = allowed && current?.id === workspace.id;
            return (
              <section key={workspace.id} className={`${styles.card} ${active ? styles.cardCurrent : ''} ${!allowed ? styles.cardLocked : ''}`}
                style={{ '--workspace-accent': workspace.accent } as CSSProperties} aria-labelledby={`workspace-${workspace.id}`}>
                <span className={`${styles.status} ${!allowed ? styles.statusLocked : ''}`}>
                  {allowed ? <ShieldCheck size={10} aria-hidden="true" /> : <LockKeyhole size={10} aria-hidden="true" />}
                  {active ? 'Current view' : allowed ? 'Available to your role' : 'Not in your current role'}
                </span>
                <div className={styles.cardHeader}>
                  <span className={styles.symbol}><Icon name={workspace.icon} size={23} /></span>
                  <div><h2 id={`workspace-${workspace.id}`}>{workspace.name}</h2><p className={styles.audience}>{workspace.audience}</p></div>
                </div>
                <p className={styles.description}>{workspace.description}</p>
                <ul className={styles.highlights}>{workspace.highlights.map((point) => <li key={point}><Check size={13} aria-hidden="true" /><span>{point}</span></li>)}</ul>
                <div className={styles.features}>{workspace.features.map((feature) => <span key={feature}>{feature}</span>)}</div>
                <div className={styles.cardFooter}>
                  {allowed ? <Link href={workspace.home} className={styles.enter}>Enter {workspace.name} workspace<ArrowRight size={14} aria-hidden="true" /></Link>
                    : <span className={styles.locked}><LockKeyhole size={12} aria-hidden="true" />Requires a different assigned role</span>}
                </div>
              </section>
            );
          })}
        </div>
        {!available.length && <p className={styles.empty}>No operational workspace is assigned to this account. Ask your organisation’s administrator to review your existing role and estate assignments.</p>}
        <p className={styles.footer}><Sparkles size={14} aria-hidden="true" /><span>AI-assisted tools stay within the permissions of the records they use. Human review remains part of the workflow.</span></p>
        {demo && <p className={styles.footer}>Development demo · these workspaces use sample operational records. Do not enter sensitive live data.</p>}
      </div>
    </main>
  );
  });
}
