import Link from 'next/link';
import { ArrowUpRight, Boxes, Building2, ClipboardCheck, House, Sparkles, Wrench } from 'lucide-react';
import { can } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import type { Page } from '@/domain/primitives';
import { repos } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { requireOperatorSession } from '@/server/workspaces';
import styles from './property-management.module.css';

export const dynamic = 'force-dynamic';

function allRows<T>(read: (cursor?: string | null) => Page<T>): T[] {
  const rows: T[] = [];
  let cursor: string | null | undefined;
  do {
    const page = read(cursor);
    rows.push(...page.items);
    cursor = page.cursor;
  } while (cursor !== null);
  return rows;
}

export default async function PropertyManagementPage() {
  return withDurableRead(async () => {
    const { actor, tenantLabel } = await requireOperatorSession();
    const estate = canEnterWorkspace(actor, 'estate');
    const facility = canEnterWorkspace(actor, 'facility');
    const canReadSites = can(actor, 'assets_ppm', 'read').allowed;
    const sites = canReadSites ? allRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 }))
      .filter((site) => site.kind === 'estate' ? estate || facility : site.kind === 'facility' && facility) : [];
    const siteIds = new Set(sites.map((site) => String(site.id)));
    const units = estate && canReadSites ? allRows((cursor) => repos.units.list(actor, { cursor, limit: 200 }))
      .filter((unit) => siteIds.has(String(unit.siteId))) : [];
    const assets = facility && canReadSites ? allRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 }))
      .filter((asset) => siteIds.has(String(asset.siteId))) : [];
    const workOrders = can(actor, 'work_orders', 'read').allowed && (estate || facility)
      ? allRows((cursor) => repos.workOrders.list(actor, { cursor, limit: 200 }))
        .filter((order) => siteIds.has(String(order.siteId))) : [];
    const closedStatuses = new Set(['closed', 'cancelled', 'rejected', 'verified', 'resolved']);
    const openOrders = workOrders.filter((order) => !closedStatuses.has(order.status));
    const quickLinks = [
      estate ? { label: 'Estate dashboard', detail: 'Residents, collections and community', href: '/estate', icon: House } : null,
      facility ? { label: 'Facility control centre', detail: 'Building systems and operational alarms', href: '/facility', icon: Building2 } : null,
      estate && canReadSites ? { label: 'Estate properties', detail: 'Units, residents and tenancy', href: '/properties', icon: House } : null,
      estate && can(actor, 'charges_invoicing', 'read').allowed ? { label: 'Finance & collections', detail: 'Naira charges and receivables', href: '/collections', icon: ClipboardCheck } : null,
      facility && canReadSites ? { label: 'Assets & maintenance', detail: 'Equipment, service history and planned care', href: '/assets', icon: Boxes } : null,
      facility && can(actor, 'work_orders', 'read').allowed ? { label: 'Facility work orders', detail: 'Dispatch, field jobs and follow-up', href: '/work-orders', icon: Wrench } : null,
      estate && can(actor, 'reports_analytics', 'read').allowed ? { label: 'Property AI Copilot', detail: 'Answers grounded in authorised estate records', href: '/estate/copilot', icon: Sparkles } : null,
      facility && canReadSites ? { label: 'Facility AI Copilot', detail: 'Investigate operational signals and assets', href: '/copilot', icon: Sparkles } : null,
    ].filter((link): link is NonNullable<typeof link> => link !== null);

    return <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>One connected property workspace</p><h1>Property Management</h1><p>Estate and facility operations for {tenantLabel}, together in one place.</p></div>
        {estate && canReadSites ? <Link className={styles.headerLink} href="/properties">Open property register <ArrowUpRight size={16} aria-hidden="true" /></Link> : null}
      </header>

      <section className={styles.metrics} aria-label="Property operations summary">
        <article><span>Authorised properties & sites</span><strong>{sites.length.toLocaleString('en-NG')}</strong><small>Across your assigned portfolio</small></article>
        {estate && canReadSites ? <article><span>Registered estate units</span><strong>{units.length.toLocaleString('en-NG')}</strong><small>{units.filter((unit) => unit.occupancy === 'occupied').length.toLocaleString('en-NG')} occupied</small></article> : null}
        {facility && canReadSites ? <article><span>Facility assets</span><strong>{assets.length.toLocaleString('en-NG')}</strong><small>{assets.filter((asset) => asset.status === 'operational').length.toLocaleString('en-NG')} operational</small></article> : null}
        {can(actor, 'work_orders', 'read').allowed ? <article><span>Open work orders</span><strong>{openOrders.length.toLocaleString('en-NG')}</strong><small>Across properties shown below</small></article> : null}
      </section>

      <section className={styles.section} aria-labelledby="portfolio-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Portfolio</p><h2 id="portfolio-title">Your properties and sites</h2></div><span>{sites.length} in your scope</span></div>
        {sites.length ? <div className={styles.propertyGrid}>{sites.sort((a, b) => a.name.localeCompare(b.name, 'en-NG', { numeric: true })).map((site) => {
          const isEstate = site.kind === 'estate' && estate;
          const href = isEstate ? `/properties/${encodeURIComponent(String(site.id))}` : `/facility/sites/${encodeURIComponent(String(site.id))}`;
          const count = isEstate ? units.filter((unit) => unit.siteId === site.id).length : assets.filter((asset) => asset.siteId === site.id).length;
          const outstanding = openOrders.filter((order) => order.siteId === site.id).length;
          return <Link key={`${site.kind}-${site.id}`} href={href} className={styles.propertyCard}>
            <span className={styles.propertyIcon}><Building2 size={20} aria-hidden="true" /></span>
            <span className={styles.propertyBody}><span className={styles.kind}>{isEstate ? 'Estate property' : 'Facility site'}</span><strong>{site.name}</strong><small>{site.address || 'Address not recorded'}</small><span className={styles.propertyMeta}>{count} {isEstate ? 'registered units' : 'assets'}<span aria-hidden="true">·</span>{outstanding} open work orders</span></span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>;
        })}</div> : <p className={styles.empty}>No property or facility site is assigned to this role yet. Your company administrator can add you to a property in Team & access.</p>}
      </section>

      {quickLinks.length ? <section className={styles.section} aria-labelledby="workflows-title"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Workflows</p><h2 id="workflows-title">Continue your work</h2></div></div><div className={styles.linkGrid}>{quickLinks.map(({ label, detail, href, icon: Icon }) => <Link key={href} href={href} className={styles.quickLink}><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}</div></section> : null}
    </div>;
  });
}
