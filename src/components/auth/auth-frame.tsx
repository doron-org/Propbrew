import Link from 'next/link';
import { ArrowUpRight, Building2, Construction, House, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { PropbrewMark } from '@/components/brand/propbrew-logo';
import { constructionArchived } from '@/config/module-archive';
import styles from './auth.module.css';

const MODULES = [{ icon: Building2, name: 'Property Management', detail: 'Estate, Facility & maintenance' }, { icon: House, name: 'Shortlet', detail: 'Guests & stays' }, ...(!constructionArchived() ? [{ icon: Construction, name: 'Construction', detail: 'Projects & delivery' }] : [])];

export function AuthFrame({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return <main className={`pb-app ${styles.authPage}`}><div className={styles.authLayout}>
    <aside className={styles.story} aria-label="Propbrew platform"><Link href="/" className={styles.brand} aria-label="Propbrew home"><PropbrewMark />propbrew</Link><div className={styles.storyBody}><span className={styles.eyebrow}>A clearer view. A stronger business.</span><h2>Good places start<br />with connected teams.</h2><p>Bring your properties and people into one company. Give every team a workspace that fits their work.</p><div className={styles.moduleGrid}>{MODULES.map(({ icon: Icon, name, detail }) => <div className={styles.moduleCard} key={name}><Icon size={20} aria-hidden="true" /><strong>{name}</strong><span>{detail}</span></div>)}</div></div><p className={styles.storyFoot}><ShieldCheck size={16} aria-hidden="true" />One company. Clear access. Room to grow.<ArrowUpRight size={16} aria-hidden="true" /></p></aside>
    <section className={styles.formPanel} aria-labelledby="account-title"><Link href="/" className={`${styles.brand} ${styles.mobileBrand}`} aria-label="Propbrew home"><PropbrewMark />propbrew</Link><div className={styles.formContent}><span className={styles.eyebrow}>Your property operations, together</span><h1 id="account-title">{title}</h1><p className={styles.description}>{description}</p>{children}<div className={styles.authFooter}>{footer}</div></div><p className={styles.panelFoot}>Propbrew · Built for the places people depend on.</p></section>
  </div></main>;
}
