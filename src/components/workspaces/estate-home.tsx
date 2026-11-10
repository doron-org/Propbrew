import { durableRecordsEnabled } from '@/server/data/record-context';
import { PageTabs } from '@/components/ui/page-tabs';
import 'server-only';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Banknote, CalendarCheck2, ChartNoAxesCombined, CircleCheck, CircleDollarSign, CircleHelp, Clock3, House, Hourglass, Megaphone, ReceiptText, ShieldCheck, Sparkles, Users, Wrench } from 'lucide-react';
import { DomainStatus } from '@/components/domain';
import { can } from '@/lib/authz';
import type { CurrencyCode, Page } from '@/domain/primitives';
import { buildEstateOverview } from '@/domain/estate/overview';
import { NOW } from '@/domain/ppm';
import { repos } from '@/server/data';
import { devIdentityEnabled } from '@/server/session';
import { requireOperatorSession } from '@/server/workspaces';
import { canRegisterEstateRecords } from '@/server/data/estate-creation-scope';
import { isReviewActor, reviewModeEnabled } from '@/server/review-auth';
import { EstateCreateActions } from './estate-create-actions';
import { AskData } from '@/components/reports/ask-data';
import styles from './estate-overview.module.css';
import { withDurableRead } from '@/server/data/durable-records';
import { nativeEstateCreationReady } from '@/server/data/company-estate-access';

/** Summary totals must include every scoped page, not just the first 50 rows. */
function allRows<T>(readPage: (cursor?: string | null) => Page<T>): T[] {
  const rows: T[] = [];
  let cursor: string | null | undefined;
  do {
    const page = readPage(cursor);
    rows.push(...page.items);
    cursor = page.cursor;
  } while (cursor !== null);
  return rows;
}

function money(minor: number, currency: CurrencyCode, compact = false) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency, maximumFractionDigits: compact ? 1 : 2, minimumFractionDigits: 0,
    ...(compact ? { notation: 'compact' as const } : {}),
  }).format(minor / 100);
}

function percent(value: number | null) { return value === null ? '—' : `${Number(value.toFixed(1))}%`; }
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(iso));
}

/** Estate overview: all reads stay capability-gated and actor-scoped. */
export async function EstateHome({ currency = 'NGN' }: { currency?: CurrencyCode } = {}) {
  return withDurableRead(async () => {
  const session = await requireOperatorSession();
  const { actor } = session;
  const access = {
    properties: can(actor, 'assets_ppm', 'read').allowed,
    billing: can(actor, 'charges_invoicing', 'read').allowed,
    people: can(actor, 'users_roles', 'read').allowed,
    maintenance: can(actor, 'work_orders', 'read').allowed,
    security: can(actor, 'security_sos', 'read').allowed,
    bookings: can(actor, 'bookings_amenities', 'read').allowed,
    announcements: can(actor, 'announcements', 'read').allowed,
    insights: can(actor, 'reports_analytics', 'read').allowed,
  };
  // A hidden section must not trigger a repository read or serialize its data.
  const sites = access.properties ? allRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 })) : [];
  const units = access.properties ? allRows((cursor) => repos.units.list(actor, { cursor, limit: 200 })) : [];
  const residents = access.people ? allRows((cursor) => repos.residents.list(actor, { cursor, limit: 200 })) : [];
  const invoices = access.billing ? allRows((cursor) => repos.invoices.list(actor, { cursor, limit: 200 })) : [];
  const workOrders = access.maintenance ? allRows((cursor) => repos.workOrders.list(actor, { cursor, limit: 200 })) : [];
  const sosEvents = access.security ? allRows((cursor) => repos.sosEvents.list(actor, { cursor, limit: 200 })) : [];
  const bookings = access.bookings ? allRows((cursor) => repos.bookings.list(actor, { cursor, limit: 200 })) : [];
  const announcements = access.announcements ? allRows((cursor) => repos.announcements.list(actor, { cursor, limit: 200 })) : [];

  const review = session.key === 'private-review' && reviewModeEnabled() && isReviewActor(actor);
  const demo = review || session.key !== 'clerk' && devIdentityEnabled();
  const persistent = durableRecordsEnabled();
  const native = nativeEstateCreationReady(actor);
  const canAdd = canRegisterEstateRecords(actor) && (!actor.companyAccess || native);
  const now = demo ? `${NOW}T09:00:00Z` : new Date().toISOString();
  const overview = buildEstateOverview({ sites, units, residents, invoices, workOrders, currency, now });
  const { collections, maintenance } = overview;
  const name = session.key === 'clerk' ? session.label.split(' ')[0] : session.label.split(' — ')[0];
  const activeSos = sosEvents.filter((event) => !['resolved', 'reviewed'].includes(event.status));
  const openBookings = bookings.filter((booking) => !['completed', 'declined', 'cancelled'].includes(booking.status));
  const recentAnnouncements = announcements.filter((announcement) => announcement.sentAt !== null)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? '')).slice(0, 3);
  const availableUnits = canAdd ? units.filter((unit) => unit.occupancy === 'vacant'
    && sites.some((site) => site.kind === 'estate' && site.id === unit.siteId && site.tenantId === unit.tenantId)
    && !residents.some((resident) => resident.tenantId === unit.tenantId && resident.unitId === unit.id && ['active', 'invited'].includes(resident.status)))
    .map((unit) => ({ id: String(unit.id), label: unit.label, propertyName: sites.find((site) => site.id === unit.siteId && site.tenantId === unit.tenantId)?.name ?? 'Property' })) : [];
  const quickActions = [
    { label: 'Payments & collections', href: '/collections', icon: Banknote, visible: access.billing },
    { label: 'Invoices', href: '/billing', icon: ReceiptText, visible: access.billing },
    { label: 'Residents & tenants', href: '/people', icon: Users, visible: access.people },
    { label: 'Estate work orders', href: '/estate/work-orders', icon: Wrench, visible: access.maintenance },
  ].filter((action) => action.visible);
  const reviewQueues = [
    { label: 'SOS response desk', detail: 'Unresolved estate events', count: activeSos.length, href: '/security', icon: ShieldCheck, urgent: activeSos.length > 0, visible: access.security },
    { label: 'Overdue charges', detail: `${currency} · issued invoices`, count: overview.paymentsDue.filter((payment) => payment.overdue).length, href: '/collections', icon: ReceiptText, urgent: false, visible: access.billing },
    { label: 'Repairs to confirm', detail: 'Resolved, awaiting verification', count: maintenance.awaitingConfirmation, href: '/estate/work-orders', icon: Wrench, urgent: false, visible: access.maintenance },
    { label: 'Amenity requests', detail: 'Bookings awaiting review', count: openBookings.filter((booking) => booking.status === 'requested').length, href: '/bookings', icon: CalendarCheck2, urgent: false, visible: access.bookings },
  ].filter((queue) => queue.visible);

  return (
    <div className={styles.overview}>
<header className={styles.welcome}>
        <div><p className={styles.eyebrow}>Your estate, at a glance</p><h2>Welcome back, {name}</h2><p className={styles.subtitle}>A clear view of your properties, residents, collections and care.</p></div>
        <div className={styles.headerActions}>
          {access.billing ? <form action="/estate" method="get" className={styles.currencyForm} aria-label="Overview currency">
            <label htmlFor="overview-currency">Display currency<select id="overview-currency" name="currency" defaultValue={currency}>
              <option value="NGN">NGN (₦)</option><option value="USD">USD ($)</option><option value="GHS">GHS (GH₵)</option><option value="KES">KES (KSh)</option>
            </select></label><button className={styles.button} type="submit">Apply</button>
          </form> : null}
          <EstateCreateActions canAddProperty={canAdd} canAddTenant={canAdd} persistent={persistent} demo={review || demo && process.env.NODE_ENV !== 'production' && (!process.env.DATA_SOURCE || process.env.DATA_SOURCE === 'memory')} native={native} asOfDate={overview.asOfLagosDate ?? now.slice(0, 10)} units={availableUnits} />
        </div>
      </header>
<p className={styles.scope}><ShieldCheck size={13} aria-hidden="true" />{session.tenantLabel} · only your authorised records<span aria-hidden="true">·</span><span>{demo ? 'Sample snapshot' : 'Snapshot'} as of {dateLabel(now)} · Lagos time</span>{demo ? <span className={styles.demo}>Demo data, not live operations</span> : null}</p>
{access.security && activeSos.length > 0 ? <p role="status" className={styles.sosAlert}><ShieldCheck size={16} aria-hidden="true" /><strong>{activeSos.length} active SOS event{activeSos.length === 1 ? '' : 's'}</strong><span>Response needs your attention.</span><Link href="/security" className={styles.link}>Open security response desk <ArrowUpRight size={14} aria-hidden="true" /></Link></p> : null}
<PageTabs label="Estate overview sections" items={[
{ id: 'overview', label: 'Overview', content: <div className={styles.sectionStack}>

<section className={styles.metrics} aria-label="Portfolio overview metrics">
        {access.properties ? <Metric title="Total properties" value={String(overview.propertiesCount)} note={`${overview.units.total} registered units · estate properties only`} icon={<House size={16} />} href="/properties" /> : null}
        {access.people ? <Metric title="Active residents / tenants" displayTitle="Active residents" value={String(overview.residents.activeCount)} note="Unique active resident records · households not multiplied" icon={<Users size={16} />} href="/people" /> : null}
        {access.properties ? <Metric title="Occupancy rate" value={percent(overview.units.occupancyPct)} note={overview.units.total ? `${overview.units.occupied} occupied of ${overview.units.total} registered units` : 'No registered units to measure yet'} icon={<ChartNoAxesCombined size={16} />} href="/properties" progress={overview.units.occupancyPct === null ? undefined : { value: overview.units.occupancyPct, label: 'Occupied', detail: `${overview.units.occupied}/${overview.units.total}` }} /> : null}
        {access.billing ? <Metric title="Charges collected" value={money(collections.collectedMinor, currency)} note={`${currency} · all recorded non-draft invoices, including service charges`} icon={<Banknote size={16} />} href="/collections" /> : null}
        {!access.properties && access.security ? <Metric title="Active SOS events" value={String(activeSos.length)} note="Unresolved events in your authorised estates" icon={<ShieldCheck size={16} />} href="/security" /> : null}
      </section>
{access.billing ? <div className={styles.commandGrid}>
        <section className={`${styles.panel} ${styles.chartPanel}`} aria-labelledby="estate-overview-collection-trends">
          <PanelHeader id="estate-overview-collection-trends" title="Rent collection trends" subtitle="Billed versus collected across the last six invoice due months" action={<span className={styles.chip}>{currency}</span>} />
          <CollectionChart months={overview.collectionTrend} currency={currency} />
          <p className={styles.chartCaption}>Due-month view · drafts excluded · currencies are never converted or combined.</p>
        </section>
        <section className={`${styles.panel} ${styles.pulsePanel}`} aria-labelledby="estate-overview-portfolio-pulse">
          <PanelHeader id="estate-overview-portfolio-pulse" title="Portfolio pulse" subtitle="Collection health and next actions" action={<span className={styles.chip}>{collections.collectionRatePct === null ? 'No issued charges' : `${percent(collections.collectionRatePct)} collected`}</span>} />
          <div className={styles.progressRow}><span>Payment collection rate</span><strong>{money(collections.collectedMinor, currency)} of {money(collections.billedMinor, currency)}</strong></div>
          <Progress label="Amount collection rate" value={collections.collectionRatePct ?? 0} />
          <div className={styles.total}><span>Outstanding charges</span><strong>{money(collections.outstandingMinor, currency)}</strong></div>
          <div className={styles.pulseHeading}><strong>Upcoming and overdue</strong><Link href="/collections" className={styles.link}>View payments <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
          {overview.paymentsDue.length ? <ul className={styles.attention}>{overview.paymentsDue.slice(0, 3).map((payment) => <li key={payment.id}><Link href="/billing"><span><span className={styles.attentionName}>{payment.residentName}</span><span className={styles.attentionDate}>{payment.ref} · due {dateLabel(payment.dueDate)}</span></span><span className={styles.attentionAmount}>{money(payment.outstandingMinor, currency)}<span className={payment.overdue ? styles.overdue : styles.upcoming}>{payment.overdue ? `${-payment.daysUntilDue} days overdue` : payment.daysUntilDue === 0 ? 'Due today' : `Due in ${payment.daysUntilDue} days`}</span></span></Link></li>)}</ul> : <p className={styles.smallEmpty}>No upcoming or overdue payments in this view.</p>}
          <nav className={styles.quickActions} aria-label="Overview quick actions">{quickActions.map(({ label, href, icon: Icon }) => <Link key={label} href={href}><Icon size={13} aria-hidden="true" />{label}</Link>)}</nav>
        </section>
      </div> : null}
<div className={styles.operationsGrid}>
        {access.properties ? <section className={styles.panel} aria-labelledby="estate-overview-property-performance">
          <PanelHeader id="estate-overview-property-performance" title="Property performance" subtitle={access.billing ? `Recorded collections by property in ${currency}` : 'Occupancy across estate properties'} action={<Link href="/properties" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          {overview.propertyPerformance.length ? <ul className={styles.propertyList}>{overview.propertyPerformance.slice(0, 4).map((property) => <li key={property.id}><div className={styles.progressRow}><strong>{property.name}</strong><strong>{access.billing ? money(property.collectedMinor, currency) : percent(property.occupancyPct)}</strong></div><Progress label={`${property.name} performance`} value={(access.billing ? property.collectionRatePct : property.occupancyPct) ?? 0} /></li>)}</ul> : <p className={styles.smallEmpty}>No registered estate properties yet.</p>}
        </section> : null}
        {access.maintenance ? <section className={styles.panel} aria-labelledby="estate-overview-maintenance-summary">
          <PanelHeader id="estate-overview-maintenance-summary" title="Maintenance summary" subtitle="Current estate request status" action={<Link href="/estate/work-orders" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          <div className={styles.statusList}>{[
            { label: 'Open', value: maintenance.open, color: 'var(--tone-danger)' },
            { label: 'In progress', value: maintenance.inProgress, color: 'var(--tone-info)' },
            { label: 'Awaiting confirmation', value: maintenance.awaitingConfirmation, color: 'var(--tone-warn)' },
            { label: 'Resolved', value: maintenance.resolved, color: 'var(--tone-success)' },
          ].map(({ label, value, color }) => <div key={label}><div className={styles.progressRow}><span>{label}</span><strong>{value}</strong></div><Progress label={`${label} requests`} value={maintenance.total ? value / maintenance.total * 100 : 0} color={color} /></div>)}</div>
          <div className={styles.total}><span>Total requests</span><strong>{maintenance.total}</strong></div>
        </section> : null}
        {(access.billing || access.maintenance) ? <section className={styles.panel} aria-labelledby="estate-overview-analytics-snapshot">
          <PanelHeader id="estate-overview-analytics-snapshot" title="Analytics snapshot" subtitle="Key performance indicators" action={access.insights ? <Link href="/reports" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link> : undefined} />
          <div className={styles.snapshot}>
            {access.maintenance ? <><Snapshot label="Open issues" value={String(maintenance.open + maintenance.inProgress)} icon={<Wrench size={14} />} /><Snapshot label="Awaiting confirmation" value={String(maintenance.awaitingConfirmation)} icon={<Hourglass size={14} />} /><Snapshot label="Verified / closed" value={percent(maintenance.resolutionRatePct)} icon={<CircleCheck size={14} />} /></> : null}
            {access.billing ? <Snapshot label="Invoices settled" value={percent(collections.settledInvoicePct)} icon={<ReceiptText size={14} />} /> : null}
          </div>
        </section> : null}
</div>
{reviewQueues.length ? <section className={styles.attentionStrip} aria-labelledby="estate-review-queues"><PanelHeader id="estate-review-queues" title="Live activity" subtitle="Current review queues from your authorised estate records" /><ul className={styles.reviewQueueGrid}>{reviewQueues.map(({ label, detail, count, href, icon: Icon, urgent }) => <li key={label}><Link href={href} className={styles.reviewLink} data-urgent={urgent ? 'true' : undefined}><span className={styles.reviewIcon}><Icon size={17} aria-hidden="true" /></span><span className={styles.reviewCopy}><strong>{label}</strong><span>{detail}</span></span><span className={styles.reviewCount}>{count}</span><ArrowUpRight size={14} className={styles.reviewArrow} aria-hidden="true" /></Link></li>)}</ul></section> : null}
</div> },
...(access.billing ? [{ id: 'collections', label: 'Collections', content: <div className={styles.sectionStack}>

{access.billing ? <div className={styles.primaryGrid}>
        <section className={styles.panel} aria-labelledby="estate-collection-trends">
          <PanelHeader id="estate-collection-trends" title="Collection trends" subtitle="Last six invoice due months · billed versus collected" action={<span className={styles.chip}>{currency}</span>} />
          <CollectionChart months={overview.collectionTrend} currency={currency} />
          <p className={styles.chartCaption}>Collections are grouped by invoice due month, not receipt date. Drafts are excluded; currencies are never converted or combined.</p>
        </section>
        <section className={styles.panel} aria-labelledby="estate-portfolio-pulse">
          <PanelHeader id="estate-portfolio-pulse" title="Portfolio pulse" subtitle="Collection health and the next charges needing attention" action={<span className={styles.chip}>{collections.collectionRatePct === null ? 'No issued charges' : `${percent(collections.collectionRatePct)} collected`}</span>} />
          <div className={styles.progressRow}><span>Amount collected</span><strong>{money(collections.collectedMinor, currency)} of {money(collections.billedMinor, currency)}</strong></div>
          <Progress label="Amount collection rate" value={collections.collectionRatePct ?? 0} />
          <p className={styles.snapshotNote}>{collections.settledInvoices} of {collections.invoiceCount} invoices fully settled · {currency} only</p>
          <div className={styles.total}><span>Outstanding charges</span><strong>{money(collections.outstandingMinor, currency)}</strong></div>
          <div className={styles.panelHeader} style={{ marginTop: 18, marginBottom: 5 }}><h3 className={styles.sectionTitle} style={{ margin: 0 }}>Overdue &amp; due in 30 days</h3><Link href="/collections" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
          {overview.paymentsDue.length ? <ul className={styles.attention}>{overview.paymentsDue.slice(0, 4).map((payment) => <li key={payment.id}>
            <Link href="/billing"><span><span className={styles.attentionName}>{payment.residentName}</span><span className={styles.attentionDate}>{payment.ref} · due {dateLabel(payment.dueDate)}</span></span>
              <span className={styles.attentionAmount}>{money(payment.outstandingMinor, currency)}<span className={payment.overdue ? styles.overdue : styles.upcoming}>{payment.overdue ? `${-payment.daysUntilDue} days overdue` : payment.daysUntilDue === 0 ? 'Due today' : `Due in ${payment.daysUntilDue} days`}</span></span></Link>
          </li>)}</ul> : <p className={styles.smallEmpty}>No outstanding {currency} charges overdue or due in the next 30 days.</p>}
          <nav className={styles.quickActions} aria-label="Overview quick actions">{quickActions.map(({ label, href, icon: Icon }) => <Link key={label} href={href}><Icon size={13} aria-hidden="true" />{label}</Link>)}</nav>
        </section>
      </div> : null}
</div> }] : []),
...(access.properties ? [{ id: 'properties', label: 'Properties', content: <div className={styles.sectionStack}>

{access.properties ? <section className={styles.panel} aria-labelledby="estate-property-performance">
          <PanelHeader id="estate-property-performance" title="Property performance" subtitle={access.billing ? `Recorded collections by property in ${currency}` : 'Occupancy across registered estate properties'} action={<Link href="/properties" className={styles.link}>Manage <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          {overview.propertyPerformance.length ? <ul className={styles.propertyList}>{overview.propertyPerformance.map((property) => <li key={property.id}>
            <div className={styles.progressRow}><strong>{property.name}</strong><strong>{access.billing ? money(property.collectedMinor, currency) : percent(property.occupancyPct)}</strong></div>
            <Progress label={`${property.name} ${access.billing ? 'collection rate' : 'occupancy'}`} value={(access.billing ? property.collectionRatePct : property.occupancyPct) ?? 0} />
            <div className={styles.propertyMeta}><span>{property.occupiedUnits}/{property.unitCount} registered units occupied</span>{access.billing ? <><span>{property.collectionRatePct === null ? 'No issued charges' : `${percent(property.collectionRatePct)} collected`}</span><span>{money(property.outstandingMinor, currency)} outstanding</span></> : null}</div>
          </li>)}</ul> : <p className={styles.smallEmpty}>No registered estate properties in your current access scope.</p>}
          <p className={styles.snapshotNote}>Occupancy covers registered unit records, not declared estate capacity. Historical growth comparisons are not yet available.</p>
        </section> : null}
</div> }] : []),
...(access.maintenance ? [{ id: 'maintenance', label: 'Maintenance', content: <div className={styles.sectionStack}>

{access.maintenance ? <section className={styles.panel} aria-labelledby="estate-maintenance-summary">
          <PanelHeader id="estate-maintenance-summary" title="Maintenance summary" subtitle="Estate requests · current workflow status" action={<Link href="/estate/work-orders" className={styles.link}>View work orders <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          <div className={styles.statusList}>{[
            { label: 'Open', value: maintenance.open, icon: CircleHelp, color: 'var(--tone-danger)' },
            { label: 'In progress / on hold', value: maintenance.inProgress, icon: Clock3, color: 'var(--tone-info)' },
            { label: 'Awaiting confirmation', value: maintenance.awaitingConfirmation, icon: Hourglass, color: 'var(--tone-warn)' },
            { label: 'Verified / closed', value: maintenance.resolved, icon: CircleCheck, color: 'var(--tone-success)' },
          ].map(({ label, value, icon: Icon, color }) => <div key={label}><div className={styles.progressRow}><span className={styles.statusLabel}><Icon size={12} aria-hidden="true" style={{ color }} />{label}</span><strong>{value}</strong></div><Progress label={`${label} requests`} value={maintenance.total ? value / maintenance.total * 100 : 0} color={color} /></div>)}</div>
          <div className={styles.total}><span>Total active &amp; completed requests</span><strong>{maintenance.total}</strong></div>
          {maintenance.cancelled + maintenance.rejected > 0 ? <p className={styles.snapshotNote}>{maintenance.cancelled} cancelled · {maintenance.rejected} rejected, excluded above.</p> : null}
        </section> : null}
</div> }] : []),
...(access.security || access.bookings || access.announcements ? [{ id: 'community', label: 'Community', content: <div className={styles.sectionStack}>

<div className={styles.communityGrid}>
        {access.security ? <section className={styles.panel} aria-labelledby="estate-security-status"><PanelHeader id="estate-security-status" title="Security & SOS" subtitle={`${activeSos.length} active event${activeSos.length === 1 ? '' : 's'} within your estate scope`} action={<Link href="/security" className={styles.link}>Open security <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          {activeSos.length ? <ul className={styles.recordList}>{activeSos.slice(0, 3).map((event) => <li key={event.id}><div><p className={styles.recordTitle}>{event.ref} · {event.residentName}</p><p className={styles.recordDetail}>{event.responder ?? 'Awaiting responder'}</p></div><DomainStatus type="sos" status={event.status} /></li>)}</ul> : <p className={styles.smallEmpty}>No unresolved SOS events in your visible records.</p>}
        </section> : null}
        {access.bookings ? <section className={styles.panel} aria-labelledby="estate-amenity-bookings"><PanelHeader id="estate-amenity-bookings" title="Amenity bookings" subtitle={`${openBookings.length} open · ${openBookings.filter((booking) => booking.status === 'requested').length} awaiting review`} action={<Link href="/bookings" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          {openBookings.length ? <ul className={styles.recordList}>{[...openBookings].sort((a, b) => a.slot.localeCompare(b.slot)).slice(0, 3).map((booking) => <li key={booking.id}><div><p className={styles.recordTitle}>{booking.amenity}</p><p className={styles.recordDetail}>{booking.residentName} · {new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(booking.slot))}</p></div><DomainStatus type="booking" status={booking.status} /></li>)}</ul> : <p className={styles.smallEmpty}>No open amenity bookings in your visible records.</p>}
        </section> : null}
        {access.announcements ? <section className={styles.panel} aria-labelledby="estate-resident-announcements"><PanelHeader id="estate-resident-announcements" title="Resident announcements" subtitle="Latest published notices within your scope" action={<Link href="/announcements" className={styles.link}>View all <ArrowUpRight size={12} aria-hidden="true" /></Link>} />
          {recentAnnouncements.length ? <ul className={styles.recordList}>{recentAnnouncements.map((announcement) => <li key={announcement.id}><div><p className={styles.recordTitle}><Megaphone size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 6 }} />{announcement.title}</p><p className={styles.recordDetail}>{announcement.audience} · {announcement.read} read of {announcement.delivered} delivered</p></div></li>)}</ul> : <p className={styles.smallEmpty}>No published announcements in your visible records.</p>}
        </section> : null}
      </div>
</div> }] : []),
...(access.insights && access.announcements ? [{ id: 'ai', label: 'AI assistance', content: <div className={styles.sectionStack}>
<AskData />
{access.insights && access.announcements ? <section className={styles.ai} aria-labelledby="estate-ai-assistance"><div className={styles.aiCopy}><Sparkles size={18} aria-hidden="true" /><div><h2 id="estate-ai-assistance">AI-assisted resident communication</h2><p>Turn a collection follow-up or community update into a clear resident notice. Review the draft and obtain manager approval before any AI-generated message is sent.</p></div></div><Link href="/announcements" className={styles.link}>Open composer <ArrowUpRight size={13} aria-hidden="true" /></Link></section> : null}
</div> }] : [])
]} />

</div>
  );
  });
}

function Metric({ title, displayTitle = title, value, note, icon, href, progress }: { title: string; displayTitle?: string; value: string; note: string; icon: ReactNode; href: string; progress?: { value: number; label: string; detail: string } }) {
  return <article className={styles.metric} aria-label={title}>
    <div className={styles.metricTop}>
      <span className={styles.metricIcon} aria-hidden="true">{icon}</span><h3>{displayTitle}</h3>
      <Link href={href} aria-label={`View ${title.toLowerCase()}`}><ArrowUpRight size={17} aria-hidden="true" /></Link>
    </div>
    <div className={styles.metricBody}>
      <div className={styles.metricValueRow}>
        <p className={styles.metricValue} data-long={value.length > 9 ? 'true' : undefined}>{value}</p>
        {progress ? <div className={styles.metricContext}>
          <span className={styles.metricPie} role="meter" aria-label={progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.value} aria-valuetext={`${progress.detail} · ${percent(progress.value)}`} style={{ background: `conic-gradient(var(--primary) ${progress.value}%, var(--border-2) 0)` }} />
          <span><small>{progress.label}</small><strong>{progress.detail}</strong></span>
        </div> : null}
      </div>
      <p className={styles.metricNote}>{note}</p>
    </div>
  </article>;
}

function PanelHeader({ id, title, subtitle, action }: { id: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className={styles.panelHeader}><div><h2 id={id}>{title}</h2><p className={styles.panelSubtitle}>{subtitle}</p></div>{action}</div>;
}

function Progress({ label, value, color }: { label: string; value: number; color?: string }) {
  const safe = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return <div className={styles.progress} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(safe.toFixed(1))}><span style={{ width: `${safe}%`, ...(color ? { background: color } : {}) }} /></div>;
}

function Snapshot({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className={styles.snapshotItem}><span aria-hidden="true">{icon}</span><div><p className={styles.snapshotLabel}>{label}</p><p className={styles.snapshotValue}>{value}</p></div></div>;
}

function CollectionChart({ months, currency }: { months: ReturnType<typeof buildEstateOverview>['collectionTrend']; currency: CurrencyCode }) {
  const max = Math.max(0, ...months.map((month) => month.billedMinor));
  if (!max) return <div className={styles.empty}><CircleDollarSign size={26} aria-hidden="true" /><p>No issued {currency} charges in these six due months.<br />Recorded collections will appear here when available.</p></div>;
  const ceiling = max * 1.12;
  return <figure>
    <div className={styles.legend} aria-hidden="true"><span><i style={{ background: 'var(--border-2)' }} />Billed</span><span><i style={{ background: 'var(--primary)' }} />Collected</span></div>
    <svg className={styles.chart} viewBox="0 0 640 260" role="img">
      <title>Billed and collected charges by invoice due month</title><desc>{`${months.map((month) => `${month.label}: billed ${money(month.billedMinor, currency)}, collected ${money(month.collectedMinor, currency)}`).join('; ')}. Invoice due dates are not payment receipt dates.`}</desc>
      {[0, 1, 2, 3].map((step) => <g key={step}><line x1="83" x2="630" y1={220 - step * 65} y2={220 - step * 65} stroke="var(--border)" strokeDasharray="3 4" /><text x="73" y={224 - step * 65} textAnchor="end" fontSize="10" fill="var(--text-2)">{money(ceiling * step / 3, currency, true)}</text></g>)}
      {months.map((month, index) => {
        const x = 110 + index * 89;
        const billedHeight = month.billedMinor / ceiling * 195;
        const collectedHeight = month.collectedMinor / ceiling * 195;
        return <g key={month.month}><rect x={x - 15} y={220 - billedHeight} width="19" height={billedHeight} rx="4" fill="var(--border-2)"><title>{`${month.label} billed: ${money(month.billedMinor, currency)}`}</title></rect><rect x={x + 8} y={220 - collectedHeight} width="19" height={collectedHeight} rx="4" fill="var(--primary)"><title>{`${month.label} collected: ${money(month.collectedMinor, currency)}`}</title></rect><text x={x + 6} y="244" textAnchor="middle" fontSize="11" fill="var(--text-2)">{month.label}</text></g>;
      })}
    </svg>
    <figcaption className="sr-only">{currency} charges grouped by invoice due month. Figures reflect currently recorded invoice balances.</figcaption>
    <table className="sr-only"><caption>Collection trend data in {currency}</caption><thead><tr><th scope="col">Due month</th><th scope="col">Billed</th><th scope="col">Collected</th></tr></thead><tbody>{months.map((month) => <tr key={month.month}><th scope="row">{month.month}</th><td>{money(month.billedMinor, currency)}</td><td>{money(month.collectedMinor, currency)}</td></tr>)}</tbody></table>
  </figure>;
}

export default EstateHome;
