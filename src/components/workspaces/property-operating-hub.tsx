import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileText,
  House,
  Megaphone,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  Vote,
  Wrench,
} from 'lucide-react';
import { PageTabs } from '@/components/ui/page-tabs';
import type { EstatePropertySummary } from '@/domain/estate/properties';
import styles from './property-operating-hub.module.css';

export type PropertyHubPermission =
  | 'users'
  | 'workOrders'
  | 'inspections'
  | 'community'
  | 'bookings'
  | 'security'
  | 'billing'
  | 'marketplace'
  | 'reports';

type HubTool = {
  label: string;
  description: string;
  href: string;
  permission: PropertyHubPermission;
  icon: typeof Building2;
};

const tools = {
  operations: [
    { label: 'Work orders', description: 'Requests, assignments, vendors and resolution for this property.', href: '/estate/work-orders', permission: 'workOrders', icon: Wrench },
    { label: 'Inspections & compliance', description: 'Property inspections, obligations, evidence and follow-up.', href: '/estate/inspections', permission: 'inspections', icon: ClipboardCheck },
    { label: 'Community pulse', description: 'Resident sentiment, service signals and emerging risks.', href: '/community', permission: 'community', icon: ChartNoAxesCombined },
    { label: 'Bookings', description: 'Shared-space reservations and approval queues.', href: '/bookings', permission: 'bookings', icon: CalendarDays },
    { label: 'Events & amenities', description: 'Programmes, amenities, capacity and attendance.', href: '/events', permission: 'bookings', icon: CalendarDays },
    { label: 'Security & SOS', description: 'Incidents, escalation ownership, patrols and response.', href: '/security', permission: 'security', icon: ShieldCheck },
    { label: 'Parcels & lockers', description: 'Inbound parcels, custody and resident collection.', href: '/parcels', permission: 'security', icon: PackageCheck },
  ] satisfies HubTool[],
  community: [
    { label: 'Announcements', description: 'Targeted property updates across resident channels.', href: '/announcements', permission: 'community', icon: Megaphone },
    { label: 'Governance', description: 'Motions, voting, quorum and decision records.', href: '/governance', permission: 'community', icon: Vote },
    { label: 'Board & committee', description: 'Property committee members, meetings and approvals.', href: '/board', permission: 'community', icon: Users },
    { label: 'Rewards', description: 'Resident points, tiers and property-specific benefits.', href: '/rewards', permission: 'community', icon: Sparkles },
    { label: 'Documents', description: 'Policies, minutes and controlled resident documents.', href: '/documents', permission: 'community', icon: FileText },
  ] satisfies HubTool[],
  finance: [
    { label: 'Billing', description: 'Rent, service charges, recurring invoices and adjustments.', href: '/billing', permission: 'billing', icon: ReceiptText },
    { label: 'Collections', description: 'Receivables, arrears, promises and reconciliation.', href: '/collections', permission: 'billing', icon: Banknote },
    { label: 'Marketplace', description: 'Approved vendors, resident orders and property services.', href: '/marketplace', permission: 'marketplace', icon: ShoppingBag },
  ] satisfies HubTool[],
  intelligence: [
    { label: 'Finance centre', description: 'Property cash flow, reconciliation and executive finance view.', href: '/finance', permission: 'billing', icon: Banknote },
    { label: 'Reports', description: 'Property KPIs, operational performance and exports.', href: '/reports', permission: 'reports', icon: ChartNoAxesCombined },
    { label: 'Ask Copilot', description: 'Permission-aware AI answers grounded in this property’s records.', href: '/estate/copilot', permission: 'reports', icon: Sparkles },
  ] satisfies HubTool[],
};

function scopedHref(href: string, property: EstatePropertySummary) {
  const query = new URLSearchParams({ propertyId: property.id, returnTo: `/properties/${property.id}` });
  return `${href}?${query.toString()}`;
}

function ToolGrid({ entries, property, permissions }: { entries: HubTool[]; property: EstatePropertySummary; permissions: Record<PropertyHubPermission, boolean> }) {
  const visible = entries.filter((entry) => permissions[entry.permission]);
  if (!visible.length) return <div className={styles.empty}><ShieldCheck size={22} /><h3>No tools are assigned to this role</h3><p>Ask a company administrator to update your property and role access.</p></div>;
  return <div className={styles.toolGrid}>{visible.map((entry) => {
    const Icon = entry.icon;
    return <Link key={entry.label} className={styles.toolCard} href={scopedHref(entry.href, property)}>
      <span className={styles.toolIcon}><Icon size={19} aria-hidden="true" /></span>
      <span className={styles.toolCopy}><strong>{entry.label}</strong><small>{entry.description}</small></span>
      <ArrowUpRight size={17} aria-hidden="true" />
    </Link>;
  })}</div>;
}

function UnitRegister({ property }: { property: EstatePropertySummary }) {
  return <section className={styles.panel} id="units" aria-labelledby="property-units-heading">
    <header className={styles.panelHeader}><div><p>Property inventory</p><h2 id="property-units-heading">Units</h2></div><span>{property.unitCount.toLocaleString('en-NG')} registered</span></header>
    {property.units.length ? <div className={styles.tableScroll}><table><thead><tr><th scope="col">Unit</th><th scope="col">Type</th><th scope="col">Occupancy</th></tr></thead><tbody>{property.units.map((unit) => <tr key={unit.id}><th scope="row">{unit.label}</th><td>{unit.type}</td><td><span className={styles.status} data-state={unit.occupancy}>{unit.occupancy}</span></td></tr>)}</tbody></table></div> : <div className={styles.empty}><House size={22} /><h3>No units registered</h3><p>Add units to connect residents, charges and operations to this property.</p></div>}
  </section>;
}

export function PropertyOperatingHub({ property, permissions, defaultSection = 'residents' }: { property: EstatePropertySummary; permissions: Record<PropertyHubPermission, boolean>; defaultSection?: string }) {
  const occupancy = property.occupancyPct === null ? '—' : `${property.occupancyPct}%`;
  const residentsTool: HubTool = { label: 'Residents', description: 'People, households and resident-unit assignments.', href: '/people', permission: 'users', icon: Users };
  const tenancyTool: HubTool = { label: 'Tenancy', description: 'Agreements, lifecycle stages, renewals and deposits.', href: '/tenancy', permission: 'users', icon: BookOpenCheck };
  const foundationTools = [residentsTool, tenancyTool];

  return <div className={styles.workspace}>
    <Link className={styles.back} href="/properties"><ArrowLeft size={15} />All properties</Link>
    <header className={styles.hero}>
      <div className={styles.heroIdentity}><span><Building2 size={26} /></span><div><p>Property operating hub</p><h1>{property.name}</h1><small>{property.address || 'Address not recorded'}</small></div></div>
      <div className={styles.heroScope}><ShieldCheck size={14} /><span>Every tool below is scoped to this property and your assigned access.</span></div>
    </header>

    <section className={styles.metrics} aria-label={`${property.name} summary`}>
      <article><small>Registered units</small><strong>{property.unitCount.toLocaleString('en-NG')}</strong><span>Property inventory</span></article>
      <article><small>Occupied</small><strong>{property.occupiedUnits.toLocaleString('en-NG')}</strong><span>{occupancy} occupancy</span></article>
      <article><small>Vacant</small><strong>{property.vacantUnits.toLocaleString('en-NG')}</strong><span>{property.reservedUnits.toLocaleString('en-NG')} reserved</span></article>
      <article><small>Operating areas</small><strong>{Object.values(tools).flat().filter((entry) => permissions[entry.permission]).length + foundationTools.filter((entry) => permissions[entry.permission]).length}</strong><span>Available to your role</span></article>
    </section>

    {defaultSection === 'residents' || defaultSection === 'tenancy' ? <PageTabs label={`${property.name} resident and tenancy pages`} defaultTab={defaultSection} items={[
      { id: 'residents', label: 'Residents', content: <div className={styles.stack}><section className={styles.panel}><header className={styles.panelHeader}><div><p>Property residents</p><h2>Residents and households</h2></div></header><ToolGrid entries={[residentsTool]} property={property} permissions={permissions} /></section><UnitRegister property={property} /></div> },
      { id: 'tenancy', label: 'Tenancy', content: <section className={styles.panel}><header className={styles.panelHeader}><div><p>Property tenancy</p><h2>Agreements and tenancy lifecycle</h2></div></header><ToolGrid entries={[tenancyTool]} property={property} permissions={permissions} /></section> },
    ]} /> : null}
    {defaultSection === 'operations' ? <section className={styles.panel}><header className={styles.panelHeader}><div><p>Estate operations</p><h2>Run this property</h2></div><span>{tools.operations.filter((entry) => permissions[entry.permission]).length} workflows in the Operations rail menu</span></header><div className={styles.empty}><Wrench size={22} /><h3>Choose a workflow from Operations</h3><p>Expand Operations in the property rail to open work orders, inspections, bookings, security and resident services.</p></div></section> : null}
    {defaultSection === 'community' ? <section className={styles.panel}><header className={styles.panelHeader}><div><p>Resident experience</p><h2>Community and governance</h2></div><span>{tools.community.filter((entry) => permissions[entry.permission]).length} workflows in the rail menu</span></header><div className={styles.empty}><Users size={22} /><h3>Choose a community workflow</h3><p>Expand Community & governance in the property rail to open announcements, governance, committee, rewards and documents.</p></div></section> : null}
    {defaultSection === 'finance' ? <section className={styles.panel}><header className={styles.panelHeader}><div><p>Property commercial</p><h2>Finance and commerce</h2></div><span>{tools.finance.filter((entry) => permissions[entry.permission]).length} workflows in the rail menu</span></header><div className={styles.empty}><Banknote size={22} /><h3>Choose a finance workflow</h3><p>Expand Finance & commerce in the property rail to open billing, collections and marketplace operations.</p></div></section> : null}
    {defaultSection === 'intelligence' ? <section className={styles.panel}><header className={styles.panelHeader}><div><p>Decision support</p><h2>Reports and AI intelligence</h2></div><span>{tools.intelligence.filter((entry) => permissions[entry.permission]).length} workflows in the rail menu</span></header><div className={styles.empty}><Sparkles size={22} /><h3>Choose an intelligence workflow</h3><p>Expand Intelligence in the property rail to open finance insights, reports and the property-aware AI copilot.</p></div></section> : null}
  </div>;
}
