import { notFound, redirect } from 'next/navigation';
import { getSession, devIdentityEnabled } from '@/server/session';
import { shellFor, homeRouteFor, type Shell } from '@/config/shells';
import { visibleNav, type NavGroup, type NavItem } from '@/config/nav';
import { getNotifications, unreadNotificationCount, getThreads, unreadThreadCount } from '@/server/data/inbox';
import { AppShell, type ShellIdentity } from '@/components/app-shell';
import { RoleSwitcher } from '@/components/dev/role-switcher';
import { getOwnerIdentity } from '@/server/onboarding/identity';
import { requireOperatorSession } from '@/server/workspaces';
import { canEnterWorkspace, propertyManagementWorkspace, workspaceById, type WorkspaceId } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { withDurableRead } from '@/server/data/durable-records';
import { canManageCompanyMembers } from '@/lib/auth/company-policy';
import { isDemoAccount } from '@/server/auth/demo-config';
import { currentRecordContext } from '@/server/data/record-context';
import type { DemoPersonaId } from '@/config/demo-personas';
import { repos } from '@/server/data';
import type { Actor, Capability } from '@/lib/authz';
import { CONSTRUCTION_PROJECT_SETUP_SECTIONS } from '@/config/construction-project-setup';

function firstReadable(actor: Actor, capabilities: readonly Capability[]): Capability | undefined {
  return capabilities.find((capability) => can(actor, capability, 'read').allowed);
}

/** Property-first Estate rail: property accordion → compact workflow accordions. */
function propertyNavigation(actor: Actor): NavGroup[] {
  if (!canEnterWorkspace(actor, 'estate') || !can(actor, 'assets_ppm', 'read').allowed) return [];
  const sites = repos.sites?.all?.(actor)?.map(({ id, name, kind }) => ({ id: String(id), name, kind })) ?? [];

  const sectionCapabilities = {
    operations: firstReadable(actor, ['work_orders', 'inspections_compliance', 'bookings_amenities', 'security_sos']),
    community: firstReadable(actor, ['announcements']),
    finance: firstReadable(actor, ['charges_invoicing', 'marketplace']),
    intelligence: firstReadable(actor, ['reports_analytics']),
  };

  const scopedHref = (href: string, siteId: string) => `${href}?${new URLSearchParams({ propertyId: siteId, returnTo: `/properties/${siteId}` }).toString()}`;

  const operationItems = (siteId: string): NavItem[] => [
    can(actor, 'work_orders', 'read').allowed ? { id: `property-${siteId}-work-orders`, label: 'Work orders', href: scopedHref('/estate/work-orders', siteId), icon: 'wrench' as const, capability: 'work_orders' as const } : null,
    canEnterWorkspace(actor, 'facility') && can(actor, 'work_orders', 'read').allowed ? { id: `property-${siteId}-maintenance-orders`, label: 'Maintenance work orders', href: scopedWorkspaceHref('/work-orders', 'siteId', siteId, `/properties/${siteId}`), icon: 'wrench' as const, capability: 'work_orders' as const } : null,
    canEnterWorkspace(actor, 'facility') && can(actor, 'work_orders', 'read').allowed ? { id: `property-${siteId}-field`, label: 'Field jobs', href: scopedWorkspaceHref('/field', 'siteId', siteId, `/properties/${siteId}`), icon: 'checks' as const, capability: 'work_orders' as const } : null,
    canEnterWorkspace(actor, 'facility') && can(actor, 'work_orders', 'read').allowed ? { id: `property-${siteId}-vendors`, label: 'Vendors & contractors', href: scopedWorkspaceHref('/vendors', 'siteId', siteId, `/properties/${siteId}`), icon: 'truck' as const, capability: 'work_orders' as const } : null,
    can(actor, 'inspections_compliance', 'read').allowed ? { id: `property-${siteId}-inspections`, label: 'Inspections & compliance', href: scopedHref('/estate/inspections', siteId), icon: 'checks' as const, capability: 'inspections_compliance' as const } : null,
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-community-pulse`, label: 'Community pulse', href: scopedHref('/community', siteId), icon: 'trending' as const, capability: 'announcements' as const } : null,
    can(actor, 'bookings_amenities', 'read').allowed ? { id: `property-${siteId}-bookings`, label: 'Bookings', href: scopedHref('/bookings', siteId), icon: 'calendar' as const, capability: 'bookings_amenities' as const } : null,
    can(actor, 'bookings_amenities', 'read').allowed ? { id: `property-${siteId}-events`, label: 'Events & amenities', href: scopedHref('/events', siteId), icon: 'calendar' as const, capability: 'bookings_amenities' as const } : null,
    can(actor, 'security_sos', 'read').allowed ? { id: `property-${siteId}-security`, label: 'Security & SOS', href: scopedHref('/security', siteId), icon: 'shield' as const, capability: 'security_sos' as const } : null,
    can(actor, 'security_sos', 'read').allowed ? { id: `property-${siteId}-parcels`, label: 'Parcels & lockers', href: scopedHref('/parcels', siteId), icon: 'package' as const, capability: 'security_sos' as const } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const communityItems = (siteId: string): NavItem[] => [
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-announcements`, label: 'Announcements', href: scopedHref('/announcements', siteId), icon: 'bell' as const, capability: 'announcements' as const } : null,
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-governance`, label: 'Governance', href: scopedHref('/governance', siteId), icon: 'clipboard' as const, capability: 'announcements' as const } : null,
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-board`, label: 'Board & committee', href: scopedHref('/board', siteId), icon: 'users' as const, capability: 'announcements' as const } : null,
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-rewards`, label: 'Rewards', href: scopedHref('/rewards', siteId), icon: 'sparkles' as const, capability: 'announcements' as const } : null,
    can(actor, 'announcements', 'read').allowed ? { id: `property-${siteId}-documents`, label: 'Documents', href: scopedHref('/documents', siteId), icon: 'file' as const, capability: 'announcements' as const } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const financeItems = (siteId: string): NavItem[] => [
    can(actor, 'charges_invoicing', 'read').allowed ? { id: `property-${siteId}-billing`, label: 'Billing', href: scopedHref('/billing', siteId), icon: 'receipt' as const, capability: 'charges_invoicing' as const } : null,
    can(actor, 'charges_invoicing', 'read').allowed ? { id: `property-${siteId}-collections`, label: 'Collections', href: scopedHref('/collections', siteId), icon: 'banknote' as const, capability: 'charges_invoicing' as const } : null,
    can(actor, 'marketplace', 'read').allowed ? { id: `property-${siteId}-marketplace`, label: 'Marketplace', href: scopedHref('/marketplace', siteId), icon: 'shop' as const, capability: 'marketplace' as const } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const intelligenceItems = (siteId: string): NavItem[] => [
    can(actor, 'charges_invoicing', 'read').allowed ? { id: `property-${siteId}-finance-centre`, label: 'Finance centre', href: scopedHref('/finance', siteId), icon: 'banknote' as const, capability: 'charges_invoicing' as const } : null,
    can(actor, 'reports_analytics', 'read').allowed ? { id: `property-${siteId}-reports`, label: 'Reports', href: scopedHref('/reports', siteId), icon: 'trending' as const, capability: 'reports_analytics' as const } : null,
    can(actor, 'reports_analytics', 'read').allowed ? { id: `property-${siteId}-copilot`, label: 'Ask Copilot', href: scopedHref('/estate/copilot', siteId), icon: 'sparkles' as const, capability: 'reports_analytics' as const } : null,
    canEnterWorkspace(actor, 'facility') ? { id: `property-${siteId}-control-center`, label: 'Building control centre', href: scopedWorkspaceHref('/control-center', 'siteId', siteId, `/properties/${siteId}`), icon: 'gauge' as const, capability: 'assets_ppm' as const } : null,
    canEnterWorkspace(actor, 'facility') ? { id: `property-${siteId}-facility-copilot`, label: 'Ask building Copilot', href: scopedWorkspaceHref('/copilot', 'siteId', siteId, `/properties/${siteId}`), icon: 'sparkles' as const, capability: 'assets_ppm' as const } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const facilityItems = (siteId: string, section: 'asset-care' | 'building-services'): NavItem[] => {
    const hub = `/properties/${encodeURIComponent(siteId)}`;
    const link = (href: string) => scopedWorkspaceHref(href, 'siteId', siteId, hub);
    const entries: Array<[string, string, string, NavItem['icon'], Capability]> = section === 'asset-care'
      ? [['assets', 'Asset register', '/assets', 'boxes', 'assets_ppm'], ['ppm', 'Maintenance plans', '/ppm', 'calendar', 'assets_ppm'], ['facility-inspections', 'Facility inspections', '/inspections', 'clipboard', 'inspections_compliance'], ['inventory', 'Inventory', '/inventory', 'package', 'assets_ppm']]
      : [['energy', 'Energy & utilities', '/energy', 'trending', 'assets_ppm'], ['safety', 'Safety & permits', '/safety', 'shield', 'assets_ppm'], ['access', 'Access & visitors', '/access', 'users', 'assets_ppm'], ['spaces', 'Spaces', '/spaces', 'grid', 'assets_ppm'], ['contracts', 'Contracts & SLAs', '/contracts', 'scroll', 'assets_ppm'], ['sustainability', 'Sustainability', '/sustainability', 'trending', 'assets_ppm']];
    return entries.filter(([, , , , capability]) => can(actor, capability, 'read').allowed).map(([id, label, href, icon, capability]) => ({ id: `property-${siteId}-${id}`, label, href: link(href), icon, capability }));
  };

  return sites.filter((site) => site.kind === 'estate')
    .sort((a, b) => a.name.localeCompare(b.name, 'en-NG', { numeric: true }))
    .map((site) => ({
      label: site.name,
      collapsible: true,
      items: [
        { id: `property-${site.id}-dashboard`, label: 'Dashboard', href: `/properties/${encodeURIComponent(site.id)}`, icon: 'gauge' as const, capability: 'assets_ppm' as const },
        sectionCapabilities.operations ? { id: `property-${site.id}-operations`, label: 'Operations', href: `/properties/${encodeURIComponent(site.id)}/operations`, icon: 'wrench' as const, capability: sectionCapabilities.operations, children: operationItems(site.id) } : null,
        canEnterWorkspace(actor, 'facility') ? { id: `property-${site.id}-asset-care`, label: 'Asset care', href: `/properties/${encodeURIComponent(site.id)}/asset-care`, icon: 'boxes' as const, capability: 'assets_ppm' as const, children: facilityItems(site.id, 'asset-care') } : null,
        canEnterWorkspace(actor, 'facility') ? { id: `property-${site.id}-building-services`, label: 'Building services', href: `/properties/${encodeURIComponent(site.id)}/building-services`, icon: 'building' as const, capability: 'assets_ppm' as const, children: facilityItems(site.id, 'building-services') } : null,
        sectionCapabilities.community ? { id: `property-${site.id}-community`, label: 'Community & governance', href: `/properties/${encodeURIComponent(site.id)}/community-governance`, icon: 'users' as const, capability: sectionCapabilities.community, children: communityItems(site.id) } : null,
        sectionCapabilities.finance ? { id: `property-${site.id}-finance`, label: 'Finance & commerce', href: `/properties/${encodeURIComponent(site.id)}/finance-commerce`, icon: 'banknote' as const, capability: sectionCapabilities.finance, children: financeItems(site.id) } : null,
        sectionCapabilities.intelligence ? { id: `property-${site.id}-intelligence`, label: 'Intelligence', href: `/properties/${encodeURIComponent(site.id)}/intelligence`, icon: 'sparkles' as const, capability: sectionCapabilities.intelligence, children: intelligenceItems(site.id) } : null,
      ].filter((item): item is NonNullable<typeof item> => item !== null),
    }));
}

function scopedWorkspaceHref(href: string, key: string, value: string, returnTo: string) {
  return `${href}?${new URLSearchParams({ [key]: value, returnTo }).toString()}`;
}

/** Buildsite-inspired project rail: each project owns its delivery workflows. */
function constructionProjectNavigation(actor: Actor): NavGroup[] {
  if (!can(actor, 'reports_analytics', 'read').allowed) return [];
  const projects = repos.constructionProjects?.list?.(actor, { limit: 100 })?.items ?? [];
  const sortedProjects = projects
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'en-NG', { numeric: true }));

  return sortedProjects.map((project) => {
    const projectId = String(project.id);
    const hub = `/construction/projects/${encodeURIComponent(projectId)}`;
    const link = (href: string) => scopedWorkspaceHref(href, 'projectId', projectId, hub);
    const children = (entries: Array<[string, string, string, NavItem['icon']]>) => entries.map(([id, label, href, icon]) => ({
      id: `construction-${projectId}-${id}`,
      label,
      href: link(href),
      icon,
      capability: 'reports_analytics' as const,
    }));
    return {
      label: project.name,
      collapsible: true,
      items: [
        { id: `construction-${projectId}-dashboard`, label: 'Project dashboard', href: hub, icon: 'gauge' as const, capability: 'reports_analytics' as const },
        { id: `construction-${projectId}-setup`, label: 'Project setup & mobilisation', href: `${hub}/setup`, icon: 'clipboard' as const, capability: 'reports_analytics' as const, children: CONSTRUCTION_PROJECT_SETUP_SECTIONS.map((section) => ({
          id: `construction-${projectId}-setup-${section.id}`,
          label: section.label,
          href: `${hub}/setup?${new URLSearchParams({ section: section.id }).toString()}`,
          icon: section.icon,
          capability: 'reports_analytics' as const,
        })) },
        { id: `construction-${projectId}-planning`, label: 'Planning & controls', href: `${hub}/planning-controls`, icon: 'calendar' as const, capability: 'reports_analytics' as const, children: children([
          ['evm', 'Earned value', '/construction/evm', 'trending'], ['schedule', 'Programme & critical path', '/construction/schedule', 'calendar'], ['risk', 'Risk & delay forecast', '/construction/risk', 'sparkles'], ['simulator', 'Scenario simulator', '/construction/simulator', 'grid'],
        ]) },
        { id: `construction-${projectId}-commercial`, label: 'Commercial & procurement', href: `${hub}/commercial-procurement`, icon: 'banknote' as const, capability: 'reports_analytics' as const, children: children([
          ['procurement', 'Procurement', '/construction/procurement', 'truck'], ['materials', 'Materials & inventory', '/construction/materials', 'boxes'], ['boq', 'BOQ & cost codes', '/construction/boq', 'file'], ['changes', 'Change orders', '/construction/changes', 'checks'], ['fx', 'FX exposure', '/construction/fx', 'banknote'], ['approvals', 'Approvals', '/construction/approvals', 'checks'], ['audit', 'Commercial audit', '/construction/audit', 'scroll'],
        ]) },
        { id: `construction-${projectId}-delivery`, label: 'Site delivery', href: `${hub}/site-delivery`, icon: 'checks' as const, capability: 'reports_analytics' as const, children: children([
          ['site', 'Daily site log', '/construction/site', 'clipboard'], ['field', 'Mobile field capture', '/construction/field', 'checks'], ['workforce', 'Workforce', '/construction/workforce', 'users'], ['timesheets', 'Timesheets', '/construction/timesheets', 'clipboard'], ['stock', 'Stock movements', '/construction/stock', 'boxes'], ['safety', 'Safety & permits', '/construction/safety', 'shield'], ['watch', 'Evidence & build watch', '/construction/build-watch', 'grid'],
        ]) },
        { id: `construction-${projectId}-intelligence`, label: 'Collaboration & intelligence', href: `${hub}/intelligence`, icon: 'sparkles' as const, capability: 'reports_analytics' as const, children: children([
          ['documents', 'Documents & RFIs', '/construction/documents', 'file'], ['twin', 'Site twin', '/construction/twin', 'building'], ['league', 'Subcontractor performance', '/construction/league', 'users'], ['copilot', 'Ask construction Copilot', '/construction/copilot', 'sparkles'], ['digest', 'Executive digest', '/construction/digest', 'trending'],
        ]) },
      ],
    };
  });
}

/** Facility sites follow the same asset-first operating model as Estate. */
function facilitySiteNavigation(actor: Actor): NavGroup[] {
  if (!canEnterWorkspace(actor, 'facility') || !can(actor, 'assets_ppm', 'read').allowed) return [];
  const sites = (repos.sites?.all?.(actor) ?? []).filter((site) => site.kind === 'facility' || (site.kind === 'estate' && !canEnterWorkspace(actor, 'estate')))
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'en-NG', { numeric: true }));
  return sites.map((site) => {
    const siteId = String(site.id);
    const hub = `/facility/sites/${encodeURIComponent(siteId)}`;
    const link = (href: string) => scopedWorkspaceHref(href, 'siteId', siteId, hub);
    const entry = (id: string, label: string, href: string, icon: NavItem['icon'], capability: Capability = 'assets_ppm'): NavItem => ({ id: `facility-${siteId}-${id}`, label, href: link(href), icon, capability });
    return { label: `${site.name} · Facilities`, collapsible: true, items: [
      { id: `facility-${siteId}-dashboard`, label: 'Site dashboard', href: hub, icon: 'gauge', capability: 'assets_ppm' },
      { id: `facility-${siteId}-operations`, label: 'Operations', href: `${hub}/operations`, icon: 'wrench', capability: 'work_orders', children: [entry('work-orders', 'Work orders', '/work-orders', 'wrench', 'work_orders'), entry('field', 'Mobile jobs', '/field', 'checks', 'work_orders'), entry('vendors', 'Vendors & contractors', '/vendors', 'truck', 'work_orders')] },
      { id: `facility-${siteId}-asset-care`, label: 'Asset care', href: `${hub}/asset-care`, icon: 'boxes', capability: 'assets_ppm', children: [entry('assets', 'Asset register', '/assets', 'boxes'), entry('ppm', 'Maintenance plans', '/ppm', 'calendar'), entry('inspections', 'Inspections & compliance', '/inspections', 'clipboard', 'inspections_compliance'), entry('inventory', 'Inventory', '/inventory', 'package')] },
      { id: `facility-${siteId}-services`, label: 'Building services', href: `${hub}/building-services`, icon: 'building', capability: 'assets_ppm', children: [entry('energy', 'Energy & utilities', '/energy', 'trending'), entry('safety', 'Safety & permits', '/safety', 'shield'), entry('access', 'Access & visitors', '/access', 'users'), entry('spaces', 'Spaces', '/spaces', 'grid'), entry('contracts', 'Contracts & SLAs', '/contracts', 'scroll')] },
      { id: `facility-${siteId}-intelligence`, label: 'Intelligence', href: `${hub}/intelligence`, icon: 'sparkles', capability: 'assets_ppm', children: [entry('control', 'Control centre', '/control-center', 'gauge'), entry('copilot', 'Ask facility Copilot', '/copilot', 'sparkles')] },
    ] };
  });
}

/** Shortlet properties own their availability, guest, revenue and team workflows. */
function shortletPropertyNavigation(actor: Actor): NavGroup[] {
  if (!can(actor, 'bookings_amenities', 'read').allowed) return [];
  const properties = repos.shortletProperties?.list?.(actor, { limit: 100 })?.items ?? [];
  const sortedProperties = properties
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'en-NG', { numeric: true }));
  return sortedProperties.map((property) => {
    const propertyId = String(property.id);
    const hub = `/shortlet/properties/${encodeURIComponent(propertyId)}`;
    const link = (href: string) => scopedWorkspaceHref(href, 'propertyId', propertyId, hub);
    const entry = (id: string, label: string, href: string, icon: NavItem['icon']): NavItem => ({ id: `shortlet-${propertyId}-${id}`, label, href: link(href), icon, capability: 'bookings_amenities' });
    return { label: property.name, collapsible: true, items: [
      { id: `shortlet-${propertyId}-dashboard`, label: 'Property dashboard', href: hub, icon: 'gauge', capability: 'bookings_amenities' },
      { id: `shortlet-${propertyId}-reservations`, label: 'Reservations', href: `${hub}/reservations`, icon: 'calendar', capability: 'bookings_amenities', children: [entry('bookings', 'Bookings', '/shortlet/bookings', 'calendar'), entry('calendar', 'Availability calendar', '/shortlet/calendar', 'calendar'), entry('booking-page', 'Direct booking page', '/shortlet/booking-page', 'grid')] },
      { id: `shortlet-${propertyId}-guest-ops`, label: 'Guest operations', href: `${hub}/guest-operations`, icon: 'users', capability: 'bookings_amenities', children: [entry('guests', 'Guests & verification', '/shortlet/guests', 'users'), entry('operations', 'Check-in & turnover', '/shortlet/operations', 'checks'), entry('inspections', 'Inspections & damages', '/shortlet/inspections', 'clipboard'), entry('maintenance', 'Maintenance handoff', '/shortlet/maintenance', 'wrench'), entry('whatsapp', 'Guest messaging', '/shortlet/whatsapp', 'bell')] },
      { id: `shortlet-${propertyId}-revenue`, label: 'Revenue & growth', href: `${hub}/revenue-growth`, icon: 'banknote', capability: 'bookings_amenities', children: [entry('pricing', 'Pricing', '/shortlet/pricing', 'banknote'), entry('expenses', 'Expenses & reconciliation', '/shortlet/expenses', 'receipt'), entry('channels', 'Channels', '/shortlet/channels', 'grid'), entry('analytics', 'Analytics & forecasting', '/shortlet/analytics', 'trending'), entry('reviews', 'Reviews', '/shortlet/reviews', 'sparkles')] },
      { id: `shortlet-${propertyId}-intelligence`, label: 'Team & intelligence', href: `${hub}/intelligence`, icon: 'sparkles', capability: 'bookings_amenities', children: [entry('team', 'Team & approvals', '/shortlet/team', 'users'), entry('agents', 'Agents', '/shortlet/agents', 'users'), entry('copilot', 'Ask shortlet Copilot', '/shortlet/copilot', 'sparkles')] },
    ] };
  });
}

/**
 * Server frame for an authenticated route group. Redirects to /login when there
 * is no session; confirms the actor belongs in THIS shell (bouncing it home
 * otherwise so a resident can never land on the ops dashboard); builds the
 * capability-gated nav and the inbox; and renders the client AppShell. The
 * per-page capability guard (`requireCapability`) is layered on top inside pages.
 */
export async function ShellFrame({ expected, workspace, children }: { expected: Shell; workspace?: WorkspaceId; children: React.ReactNode }) {
  return withDurableRead(async () => {
  const session = expected === 'ops' ? await requireOperatorSession() : await getSession();
  if (!session) {
    if (await getOwnerIdentity()) redirect('/onboarding');
    redirect('/login');
  }
  const actor = session.actor;

  const shell = shellFor(actor);
  if (shell !== expected) redirect(homeRouteFor(actor));
  if (expected === 'ops' && (!workspace || !canEnterWorkspace(actor, workspace))) notFound();

  let groups = visibleNav(shell, actor, workspace);
  if (workspace === 'estate' || workspace === 'facility') {
    const propertyWorkspace = propertyManagementWorkspace(actor);
    const homeCapability = firstReadable(actor, ['assets_ppm', 'work_orders', 'announcements', 'charges_invoicing', 'security_sos']);
    const portfolio = canEnterWorkspace(actor, 'estate') ? visibleNav(shell, actor, 'estate').find((group) => group.label === 'Property portfolio') : undefined;
    groups = [
      ...(propertyWorkspace && homeCapability ? [{
        label: 'Property management',
        items: [
          { id: 'property-management-home', label: 'Overview', href: propertyWorkspace.home, icon: 'gauge' as const, capability: homeCapability },
          ...(portfolio?.items.map((item) => ({ ...item, label: 'All estate properties' })) ?? []),
        ],
      }] : []),
      ...[...propertyNavigation(actor), ...facilitySiteNavigation(actor)].sort((a, b) => a.label.localeCompare(b.label, 'en-NG', { numeric: true })),
    ];
  } else if (workspace === 'construction') {
    const overview = groups.find((group) => group.label === 'Construction overview');
    groups = [
      ...(overview ? [{ label: 'Construction overview', items: overview.items.map((item) => item.id === 'con-projects' ? { ...item, label: 'All projects' } : item) }] : []),
      ...constructionProjectNavigation(actor),
    ];
  } else if (workspace === 'shortlet') {
    const overview = groups.find((group) => group.label === 'Shortlet overview');
    groups = [
      ...(overview ? [{ label: 'Shortlet overview', items: overview.items.map((item) => item.id === 'sl-properties' ? { ...item, label: 'All properties' } : item) }] : []),
      ...shortletPropertyNavigation(actor),
    ];
  }
  const companyPrincipal = currentRecordContext()?.companyPrincipal;

  const identity: ShellIdentity = {
    name: session.key === 'clerk' ? session.label : session.label.split(' — ')[0],
    roleSummary: session.roleSummary,
    tenantLabel: session.tenantLabel,
    outboxOwner: actor.tenantId ? JSON.stringify([actor.tenantId, actor.userId]) : undefined,
    companyAccount: Boolean(actor.companyAccess) && !companyPrincipal?.sandbox,
    canManageTeam: Boolean(actor.companyAccess) && !companyPrincipal?.sandbox && canManageCompanyMembers(actor),
    demoAccount: isDemoAccount(actor.userId) && !companyPrincipal?.sandbox,
    demoPersonaId: companyPrincipal?.demoPersona?.id as DemoPersonaId | undefined,
  };

  const canReadWorkOrders = can(actor, 'work_orders', 'read').allowed;
  // A shared notification may point at the legacy Facility route. Keep Estate
  // maintenance in its own portal without changing the stored event or grants.
  const notifications = getNotifications(actor.userId, actor.roles).map((notification) => {
    if (workspace !== 'estate' || !notification.href || !/^\/work-orders(?:\/[^/?#]+)?(?:[?#].*)?$/.test(notification.href)) return notification;
    return {
      ...notification,
      href: canReadWorkOrders ? notification.href.replace(/^\/work-orders/, '/estate/work-orders') : undefined,
    };
  });
  const unreadNotifications = unreadNotificationCount(actor.userId, actor.roles);
  const threads = getThreads(actor.userId, actor.roles);
  const unreadMessages = unreadThreadCount(actor.userId, actor.roles);

  return (
    <AppShell
      groups={groups}
      workspace={workspace === 'estate' || workspace === 'facility' ? propertyManagementWorkspace(actor) : workspaceById(workspace)}
      identity={identity}
      notifications={notifications}
      unreadNotifications={unreadNotifications}
      threads={threads}
      unreadMessages={unreadMessages}
      devSwitcher={devIdentityEnabled() ? <RoleSwitcher currentKey={session.key} /> : undefined}
    >
      {children}
    </AppShell>
  );
  });
}
