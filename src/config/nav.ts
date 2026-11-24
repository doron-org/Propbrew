/**
 * Capability-gated navigation.
 *
 * Each item declares the §7 capability it needs; `visibleNav(actor)` drops any
 * item the actor holds no grant on, and drops emptied groups so no role sees an
 * orphan header. `proposed: true` marks an item whose capability mapping the PRD
 * does NOT supply (FM-04 spaces, FM-05 vendors, EM-07 directory, EM-08 docs,
 * SC-10 audit, §11.4 AI) — visible in code rather than buried.
 *
 * The affordance rule the shell enforces on top of this: at level V, mutating
 * controls are REMOVED (not disabled) and a "Read-only" chip shows; at level O,
 * there is no "show all" and KPI counts are computed under the same scope.
 */

import { can, effectiveLevel, type Actor, type Capability } from '@/lib/authz';
import type { Role } from '@/domain/enums';
import type { IconName } from '@/components/icon';
import type { Shell } from './shells';
import { canEnterWorkspace, workspaceForPath, type WorkspaceId } from './workspaces';

export type NavItem = {
  id: string;
  label: string;
  href: string;
  /** Serializable icon name (resolved to a component in the client shell). */
  icon: IconName;
  /** §7 capability that gates visibility. */
  capability: Capability;
  /**
   * Optional role restriction. The portal serves three personas whose
   * capabilities OVERLAP (a resident and a vendor both hold work_orders and
   * marketplace, via different ownership), so capability-gating alone would show
   * a resident the vendor's "My Jobs". Where the capability is not enough to
   * separate personas, name the roles the item is FOR.
   */
  roles?: readonly Role[];
  /** Capability mapping not supplied by the PRD — confirm at discovery. */
  proposed?: boolean;
  /** Optional second-level rail entries, used for property-scoped workflow menus. */
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
  /** Property groups use an accordion so a multi-estate rail stays compact. */
  collapsible?: boolean;
  defaultOpen?: boolean;
};

/** Detail pages inherit their most-specific local navigation item, never an
 * unrelated workspace or the broad Estate overview prefix. */
export function activeNavHref(groups: readonly NavGroup[], pathname: string, currentQuery = ''): string | undefined {
  const hrefs = (items: readonly NavItem[]): string[] => items.flatMap((item) => [item.href, ...hrefs(item.children ?? [])]);
  const current = new URLSearchParams(currentQuery);
  return groups.flatMap((group) => hrefs(group.items))
    .filter((href) => {
      const path = href.split('?')[0];
      return pathname === path || pathname.startsWith(path + '/');
    })
    .map((href) => {
      const query = href.includes('?') ? new URLSearchParams(href.slice(href.indexOf('?') + 1)) : null;
      const queryMatches = !query || [...query.entries()].every(([key, value]) => current.get(key) === value);
      return { href, score: queryMatches ? href.split('?')[0].length * 100 + (query?.size ?? 0) * 10_000 : -1 };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || b.href.length - a.href.length)[0]?.href;
}

/* --- OPS console (executive, estate/facility managers, technician, security) */

const OPS_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'gauge', capability: 'reports_analytics' }],
  },
  {
    label: 'Facility operations',
    items: [
      { id: 'field', label: 'My Day', href: '/field', icon: 'checks', capability: 'work_orders', roles: ['technician'], proposed: true },
      { id: 'control-center', label: 'Control Center', href: '/control-center', icon: 'gauge', capability: 'assets_ppm', proposed: true },
      { id: 'work-orders', label: 'Work Orders', href: '/work-orders', icon: 'wrench', capability: 'work_orders' },
      { id: 'copilot', label: 'AI Copilot', href: '/copilot', icon: 'sparkles', capability: 'assets_ppm', proposed: true },
    ],
  },
  {
    label: 'Asset care',
    items: [
      { id: 'assets', label: 'Assets', href: '/assets', icon: 'boxes', capability: 'assets_ppm' },
      { id: 'ppm', label: 'Maintenance Plans', href: '/ppm', icon: 'calendar', capability: 'assets_ppm' },
      { id: 'inspections', label: 'Inspections', href: '/inspections', icon: 'clipboard', capability: 'inspections_compliance' },
      { id: 'inventory', label: 'Inventory', href: '/inventory', icon: 'package', capability: 'assets_ppm', proposed: true },
      { id: 'vendors', label: 'Vendors', href: '/vendors', icon: 'truck', capability: 'work_orders', proposed: true },
    ],
  },
  {
    label: 'Building services',
    items: [
      { id: 'energy', label: 'Energy & Utilities', href: '/energy', icon: 'trending', capability: 'assets_ppm', proposed: true },
      { id: 'safety', label: 'Safety & Permits', href: '/safety', icon: 'shield', capability: 'assets_ppm', proposed: true },
      { id: 'access', label: 'Access & Visitors', href: '/access', icon: 'users', capability: 'assets_ppm', proposed: true },
      { id: 'sustainability', label: 'Sustainability', href: '/sustainability', icon: 'trending', capability: 'assets_ppm', proposed: true },
      { id: 'spaces', label: 'Spaces', href: '/spaces', icon: 'grid', capability: 'assets_ppm', proposed: true },
    ],
  },
  {
    label: 'Facility commercial',
    items: [
      { id: 'contracts', label: 'Contracts & SLAs', href: '/contracts', icon: 'scroll', capability: 'assets_ppm', proposed: true },
    ],
  },
  {
    label: 'Property portfolio',
    items: [
      { id: 'properties', label: 'Properties', href: '/properties', icon: 'building', capability: 'assets_ppm', proposed: true },
    ],
  },
  {
    label: 'Estate operations',
    items: [
      { id: 'estate-work-orders', label: 'Work Orders', href: '/estate/work-orders', icon: 'wrench', capability: 'work_orders' },
      { id: 'estate-inspections', label: 'Inspections & Compliance', href: '/estate/inspections', icon: 'clipboard', capability: 'inspections_compliance' },
      { id: 'community', label: 'Community Pulse', href: '/community', icon: 'sparkles', capability: 'announcements', proposed: true },
      { id: 'bookings', label: 'Bookings', href: '/bookings', icon: 'calendar', capability: 'bookings_amenities' },
      { id: 'events', label: 'Events & Amenities', href: '/events', icon: 'calendar', capability: 'bookings_amenities', proposed: true },
      { id: 'security', label: 'Security & SOS', href: '/security', icon: 'shield', capability: 'security_sos' },
      { id: 'parcels', label: 'Parcels & Lockers', href: '/parcels', icon: 'package', capability: 'security_sos', proposed: true },
    ],
  },
  {
    label: 'Community & governance',
    items: [
      { id: 'announcements', label: 'Announcements', href: '/announcements', icon: 'bell', capability: 'announcements' },
      { id: 'governance', label: 'Governance', href: '/governance', icon: 'scroll', capability: 'announcements', proposed: true },
      { id: 'board', label: 'Board & Committee', href: '/board', icon: 'users', capability: 'announcements', proposed: true },
      { id: 'rewards', label: 'Rewards', href: '/rewards', icon: 'sparkles', capability: 'announcements', proposed: true },
      { id: 'documents', label: 'Documents', href: '/documents', icon: 'file', capability: 'announcements', proposed: true },
    ],
  },
  {
    label: 'Finance & commerce',
    items: [
      { id: 'billing', label: 'Billing', href: '/billing', icon: 'banknote', capability: 'charges_invoicing' },
      { id: 'collections', label: 'Collections', href: '/collections', icon: 'banknote', capability: 'charges_invoicing', proposed: true },
      { id: 'marketplace', label: 'Marketplace', href: '/marketplace', icon: 'store', capability: 'marketplace' },
    ],
  },
  {
    label: 'Estate insights',
    items: [
      { id: 'portfolio', label: 'Portfolio', href: '/portfolio', icon: 'grid', capability: 'reports_analytics', proposed: true },
      { id: 'reports', label: 'Reports', href: '/reports', icon: 'trending', capability: 'reports_analytics' },
      { id: 'estate-copilot', label: 'Ask Copilot', href: '/estate/copilot', icon: 'sparkles', capability: 'reports_analytics', proposed: true },
      { id: 'investors', label: 'Investors', href: '/investors', icon: 'building', capability: 'investor_projects' },
    ],
  },
  // Short-Let PMS rides the §7 bookings capability (matrix is CR-locked).
  // Purpose-led groups keep the long operator rail scannable on desktop.
  {
    label: 'Shortlet overview',
    items: [
      { id: 'sl-dash', label: 'Dashboard', href: '/shortlet', icon: 'gauge', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-properties', label: 'Properties', href: '/shortlet/properties', icon: 'boxes', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-copilot', label: 'Ask Copilot', href: '/shortlet/copilot', icon: 'sparkles', capability: 'bookings_amenities', roles: ['executive', 'estate_manager'], proposed: true },
    ],
  },
  {
    label: 'Reservations',
    items: [
      { id: 'sl-calendar', label: 'Calendar', href: '/shortlet/calendar', icon: 'calendar', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-bookings', label: 'Bookings', href: '/shortlet/bookings', icon: 'receipt', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-booking-page', label: 'Booking page', href: '/shortlet/booking-page', icon: 'store', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-channels', label: 'Channels', href: '/shortlet/channels', icon: 'store', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Guest operations',
    items: [
      { id: 'sl-operations', label: 'Operations', href: '/shortlet/operations', icon: 'checks', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-guests', label: 'Guests', href: '/shortlet/guests', icon: 'users', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-inspections', label: 'Inspections', href: '/shortlet/inspections', icon: 'clipboard', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-maintenance', label: 'Maintenance', href: '/shortlet/maintenance', icon: 'wrench', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-whatsapp', label: 'WhatsApp', href: '/shortlet/whatsapp', icon: 'bell', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-reviews', label: 'Reviews', href: '/shortlet/reviews', icon: 'clipboard', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Revenue & growth',
    items: [
      { id: 'sl-pricing', label: 'Seasonal pricing', href: '/shortlet/pricing', icon: 'trending', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-expenses', label: 'Expenses', href: '/shortlet/expenses', icon: 'banknote', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-analytics', label: 'Analytics', href: '/shortlet/analytics', icon: 'trending', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-agents', label: 'Agents', href: '/shortlet/agents', icon: 'store', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'sl-team', label: 'Team', href: '/shortlet/team', icon: 'users', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
      { id: 'sl-plan', label: 'Plan & billing', href: '/shortlet/plan', icon: 'banknote', capability: 'bookings_amenities', roles: ['executive', 'estate_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Construction overview',
    items: [
      { id: 'con-home', label: 'Command Center', href: '/construction', icon: 'gauge', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-projects', label: 'Projects', href: '/construction/projects', icon: 'building', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-copilot', label: 'Copilot', href: '/construction/copilot', icon: 'sparkles', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-digest', label: 'Weekly Digest', href: '/construction/digest', icon: 'sparkles', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Planning & controls',
    items: [
      { id: 'con-operations', label: 'Operations', href: '/construction/operations', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-evm', label: 'Earned Value', href: '/construction/evm', icon: 'trending', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-schedule', label: 'Critical Path', href: '/construction/schedule', icon: 'calendar', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-risk', label: 'Risk Radar', href: '/construction/risk', icon: 'shield', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-simulator', label: 'What-If', href: '/construction/simulator', icon: 'gauge', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Commercial & procurement',
    items: [
      { id: 'con-changes', label: 'Change orders', href: '/construction/changes', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-procurement', label: 'Procurement', href: '/construction/procurement', icon: 'truck', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-materials', label: 'Materials', href: '/construction/materials', icon: 'package', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-boq', label: 'BOQ Import', href: '/construction/boq', icon: 'file', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-fx', label: 'FX Exposure', href: '/construction/fx', icon: 'banknote', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-approvals', label: 'Approvals', href: '/construction/approvals', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-audit', label: 'Audit Log', href: '/construction/audit', icon: 'scroll', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Site delivery',
    items: [
      { id: 'con-site', label: 'Site Log', href: '/construction/site', icon: 'clipboard', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-field', label: 'Field Capture', href: '/construction/field', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-workforce', label: 'Workforce', href: '/construction/workforce', icon: 'users', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-timesheets', label: 'Timesheets', href: '/construction/timesheets', icon: 'clipboard', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-stock', label: 'Stock', href: '/construction/stock', icon: 'boxes', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-safety', label: 'Site Safety', href: '/construction/safety', icon: 'shield', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-quality', label: 'Quality & Coordination', href: '/construction/quality', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-watch', label: 'Build Watch', href: '/construction/build-watch', icon: 'grid', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Collaboration & intelligence',
    items: [
      { id: 'con-docs', label: 'Documents & RFIs', href: '/construction/documents', icon: 'scroll', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-twin', label: 'Site Twin', href: '/construction/twin', icon: 'building', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
      { id: 'con-league', label: 'Sub League', href: '/construction/league', icon: 'checks', capability: 'reports_analytics', roles: ['executive', 'estate_manager', 'facility_manager', 'platform_admin'], proposed: true },
    ],
  },
  {
    label: 'Estate workspace',
    items: [{ id: 'settings', label: 'Settings', href: '/settings', icon: 'settings', capability: 'tenant_config' }],
  },
];

/* --- PORTAL (resident, vendor, investor) — own-records-only surfaces ------- */

const PORTAL_NAV: NavGroup[] = [
  {
    label: 'My home',
    items: [
      { id: 'portal-home', label: 'Home', href: '/portal', icon: 'gauge', capability: 'work_orders', roles: ['resident'] },
      { id: 'requests', label: 'My Requests', href: '/portal/requests', icon: 'checks', capability: 'work_orders', roles: ['resident'] },
      { id: 'bills', label: 'My Bills', href: '/portal/bills', icon: 'receipt', capability: 'charges_invoicing', roles: ['resident'] },
      { id: 'p-bookings', label: 'Bookings', href: '/portal/bookings', icon: 'calendar', capability: 'bookings_amenities', roles: ['resident'] },
      { id: 'sos', label: 'Safety & SOS', href: '/portal/security', icon: 'lifebuoy', capability: 'security_sos', roles: ['resident'] },
      { id: 'shop', label: 'Marketplace', href: '/portal/marketplace', icon: 'shop', capability: 'marketplace', roles: ['resident'] },
      { id: 'p-community', label: 'Community', href: '/portal/community', icon: 'sparkles', capability: 'announcements', roles: ['resident'] },
      { id: 'p-news', label: 'Announcements', href: '/portal/announcements', icon: 'bell', capability: 'announcements', roles: ['resident'] },
    ],
  },
  {
    label: 'Vendor',
    items: [
      { id: 'jobs', label: 'My Jobs', href: '/portal/jobs', icon: 'wrench', capability: 'work_orders', roles: ['vendor'] },
      { id: 'orders', label: 'Orders', href: '/portal/orders', icon: 'receipt', capability: 'marketplace', roles: ['vendor'] },
      { id: 'listings', label: 'My Listings', href: '/portal/listings', icon: 'package', capability: 'marketplace', roles: ['vendor'] },
    ],
  },
  {
    label: 'Investor',
    items: [
      { id: 'projects', label: 'My Projects', href: '/portal/projects', icon: 'building', capability: 'investor_projects', roles: ['investor'] },
      { id: 'returns', label: 'Returns', href: '/portal/returns', icon: 'trending', capability: 'investor_projects', roles: ['investor'] },
      { id: 'updates', label: 'Updates', href: '/portal/updates', icon: 'bell', capability: 'investor_projects', roles: ['investor'] },
    ],
  },
];

/* --- ADMIN console (platform_admin only) ---------------------------------- */

const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { id: 'overview', label: 'Overview', href: '/admin/overview', icon: 'gauge', capability: 'tenant_config' },
      { id: 'tenants', label: 'Tenants', href: '/admin/tenants', icon: 'building', capability: 'tenant_config' },
      { id: 'users', label: 'Users & Roles', href: '/admin/users', icon: 'users', capability: 'users_roles' },
      { id: 'investor-projects', label: 'Investor Projects', href: '/admin/investors', icon: 'trending', capability: 'investor_projects' },
      { id: 'admin-reports', label: 'Reports', href: '/admin/reports', icon: 'gauge', capability: 'reports_analytics' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'audit', label: 'Audit Log', href: '/admin/audit', icon: 'scroll', capability: 'tenant_config', proposed: true },
      { id: 'ai', label: 'AI & Usage', href: '/admin/ai', icon: 'sparkles', capability: 'tenant_config', proposed: true },
      { id: 'requirements', label: 'Requirements', href: '/admin/requirements', icon: 'checks', capability: 'tenant_config' },
    ],
  },
];

const NAV_BY_SHELL: Record<Shell, NavGroup[]> = {
  ops: OPS_NAV,
  portal: PORTAL_NAV,
  admin: ADMIN_NAV,
};

const WORKSPACE_GROUPS: Record<WorkspaceId, readonly string[]> = {
  // Estate is property-first: operational, community, governance and finance
  // tools are revealed from an authorised property, not duplicated in the
  // portfolio rail. Portfolio intelligence and workspace settings remain global.
  estate: ['Property portfolio', 'Estate insights', 'Estate workspace'],
  facility: ['Facility operations', 'Asset care', 'Building services', 'Facility commercial'],
  shortlet: ['Shortlet overview', 'Reservations', 'Guest operations', 'Revenue & growth', 'Workspace'],
  construction: ['Construction overview', 'Planning & controls', 'Commercial & procurement', 'Site delivery', 'Collaboration & intelligence'],
};

/** Nav groups visible to this actor, limited to the selected operator portal. */
export function visibleNav(shell: Shell, actor: Actor, workspace?: WorkspaceId): NavGroup[] {
  let groups = NAV_BY_SHELL[shell];
  if (shell === 'ops') {
    // No workspace means no mixed-module sidebar. The chooser is the entrypoint.
    if (!workspace || !canEnterWorkspace(actor, workspace)) return [];
    groups = groups.filter((group) => WORKSPACE_GROUPS[workspace].includes(group.label));
    if (workspace === 'estate' || workspace === 'facility') {
      const capabilities: Capability[] = workspace === 'estate'
        ? ['announcements', 'charges_invoicing', 'security_sos']
        : ['assets_ppm', 'work_orders'];
      const capability = capabilities.find((candidate) => can(actor, candidate, 'read').allowed);
      if (capability) {
        groups = [{
          label: 'Overview',
          items: [{
            id: `${workspace}-home`,
            label: workspace === 'estate' ? 'Estate overview' : 'Facility overview',
            href: `/${workspace}`,
            icon: workspace === 'estate' ? 'building' : 'gauge',
            capability,
          }],
        }, ...groups];
      }
    }
  }

  return groups
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => {
        if (shell === 'ops') {
          if (workspaceForPath(item.href) !== workspace || !can(actor, item.capability, 'read').allowed) return false;
        } else if (effectiveLevel(actor, item.capability) === 'none') return false;
        // Where the capability does not separate personas, honour the role list.
        if (item.roles && !item.roles.some((r) => actor.roles.includes(r))) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Page title + subtitle per route. */
export const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/property-management': { title: 'Property Management', subtitle: 'Estate and facility operations in one portfolio' },
  '/estate': { title: 'Estate overview', subtitle: 'Residents, community and collections in one workspace' },
  '/estate/work-orders': { title: 'Estate work orders', subtitle: 'Requests, assignments and resolution within Estate' },
  '/estate/inspections': { title: 'Estate inspections', subtitle: 'Estate compliance obligations and inspection evidence' },
  '/estate/copilot': { title: 'Estate Copilot', subtitle: 'Ask about scoped estate records and review the source' },
  '/properties': { title: 'Properties', subtitle: 'Your estate properties, buildings and units' },
  '/facility': { title: 'Facility overview', subtitle: 'Maintenance, assets and building operations in one workspace' },
  '/dashboard': { title: 'Dashboard', subtitle: 'Your operation at a glance' },
  '/control-center': { title: 'Control Center', subtitle: 'Live building operations at a glance' },
  '/energy': { title: 'Energy & Utilities', subtitle: 'Generators, diesel, grid and water' },
  '/inventory': { title: 'Inventory', subtitle: 'Spare parts and stock levels' },
  '/contracts': { title: 'Contracts & SLAs', subtitle: 'Service contracts, renewals and SLA' },
  '/safety': { title: 'Safety & Permits', subtitle: 'Permits to work and incidents' },
  '/access': { title: 'Access & Visitors', subtitle: 'Gates, visitor passes and live access events' },
  '/sustainability': { title: 'Sustainability', subtitle: 'Carbon, energy mix and reduction pathways' },
  '/copilot': { title: 'AI Copilot', subtitle: 'Your facility, read across every signal' },
  '/shortlet/copilot': { title: 'Shortlet Copilot', subtitle: 'Recorded stay operations, with decisions in your hands' },
  '/work-orders': { title: 'Work Orders', subtitle: 'Every maintenance job from request to close' },
  '/assets': { title: 'Assets', subtitle: 'The register of everything under management' },
  '/ppm': { title: 'Maintenance Plans', subtitle: 'Preventive maintenance, scheduled before failure' },
  '/inspections': { title: 'Inspections', subtitle: 'Compliance, evidenced not assumed' },
  '/spaces': { title: 'Spaces', subtitle: 'Estate → building → floor → unit' },
  '/vendors': { title: 'Vendors', subtitle: 'Your approved contractor network' },
  '/billing': { title: 'Billing', subtitle: 'Service charges, collection and arrears' },
  '/community': { title: 'Community Pulse', subtitle: 'Resident sentiment, engagement and churn risk' },
  '/collections': { title: 'Collections', subtitle: 'Arrears recovery, risk and payment promises' },
  '/tenancy': { title: 'Tenancy', subtitle: 'Move-in to move-out, leases and deposits' },
  '/parcels': { title: 'Parcels & Lockers', subtitle: 'The parcel room and smart lockers' },
  '/governance': { title: 'Governance', subtitle: 'AGM motions, weighted voting and quorum' },
  '/board': { title: 'Board & Committee', subtitle: 'Committee roster, meetings and motions' },
  '/portal/community': { title: 'Community', subtitle: 'Vote, RSVP to events, and spend your points' },
  '/events': { title: 'Events & Amenities', subtitle: 'Community programme, RSVPs and venue demand' },
  '/rewards': { title: 'Rewards', subtitle: 'Loyalty points, tiers and redeemable perks' },
  '/people': { title: 'Residents', subtitle: 'Who lives on the estate, and their units' },
  '/announcements': { title: 'Announcements', subtitle: 'Reach the right residents on the right channel' },
  '/bookings': { title: 'Bookings', subtitle: 'Amenity reservations and availability' },
  '/security': { title: 'Security & SOS', subtitle: 'Live alerts, patrols and incidents' },
  '/marketplace': { title: 'Marketplace', subtitle: 'Vendor listings and resident orders' },
  '/documents': { title: 'Documents', subtitle: 'Estate documents, shared by audience' },
  '/portfolio': { title: 'Portfolio', subtitle: 'Every estate, ranked and compared' },
  '/field': { title: 'My Day', subtitle: 'Your jobs for today, built for the field' },
  '/reports': { title: 'Reports', subtitle: 'Portfolio performance and KPIs' },
  '/finance': { title: 'Finance Command Centre', subtitle: 'Receivables, payables, cash flow, WHT and bank reconciliation across every module' },
  '/investors': { title: 'Investors', subtitle: 'Off-plan projects, sales and returns' },
  '/settings': { title: 'Settings', subtitle: 'Estate configuration and preferences' },
  '/construction': { title: 'Command Center', subtitle: 'Every project, cost and crew — live' },
  '/construction/projects': { title: 'Projects', subtitle: 'The delivery side of the off-plan portfolio' },
  '/construction/operations': { title: 'Construction Operations', subtitle: 'Subcontractors, field approvals, claims, evidence and payments' },
  '/construction/changes': { title: 'Change orders', subtitle: 'RFI and site issues to authorized budget and commitments' },
  '/construction/evm': { title: 'Earned Value', subtitle: 'CPI, SPI, EAC and the S-curve' },
  '/construction/schedule': { title: 'Critical Path', subtitle: 'Float, slip cascade and forecast finish' },
  '/construction/procurement': { title: 'Procurement', subtitle: 'Request → RFQ → scored award → PO' },
  '/construction/materials': { title: 'Materials', subtitle: 'Stock, money-trail and leakage forensics' },
  '/construction/boq': { title: 'BOQ Import', subtitle: 'Paste, validate, reconcile, commit' },
  '/construction/timesheets': { title: 'Timesheets', subtitle: 'Labour hours → posted cost → earned value' },
  '/construction/stock': { title: 'Stock', subtitle: 'Movements, perpetual ledger and physical counts' },
  '/construction/approvals': { title: 'Approvals', subtitle: 'Configurable routes, SLAs and delegation' },
  '/construction/audit': { title: 'Audit Log', subtitle: 'Who did what, and why it keeps happening' },
  '/construction/fx': { title: 'FX Exposure', subtitle: 'Foreign commitments revalued as the naira moves' },
  '/construction/documents': { title: 'Documents & RFIs', subtitle: 'Controlled revisions and technical queries' },
  '/construction/site': { title: 'Site Log', subtitle: 'Daily reports, draft to approved' },
  '/construction/field': { title: 'Field Capture', subtitle: 'Works with no signal — everything queues and syncs' },
  '/construction/workforce': { title: 'Workforce', subtitle: 'Attendance, crews and certifications' },
  '/construction/risk': { title: 'Risk Radar', subtitle: 'Advisory signals with confidence and evidence' },
  '/construction/digest': { title: 'Weekly Digest', subtitle: 'Source-linked, from approved records only' },
  '/construction/copilot': { title: 'Copilot', subtitle: 'Grounded, permission-aware Q&A' },
  '/construction/simulator': { title: 'What-If', subtitle: 'Crash the plan, shock the diesel price' },
  '/construction/twin': { title: 'Site Twin', subtitle: 'Watch the building grow, floor by floor' },
  '/construction/league': { title: 'Sub League', subtitle: 'Delivery, quality and safety, ranked' },
  '/construction/safety': { title: 'Site Safety', subtitle: 'Permits to work, events and toolbox talks' },
  '/construction/quality': { title: 'Quality & Coordination', subtitle: 'Punch list, authority inspections and recorded design clashes' },
  '/construction/build-watch': { title: 'Build Watch', subtitle: 'The client-facing view of delivery' },
  '/shortlet': { title: 'Short-Let', subtitle: 'Your short-let portfolio at a glance' },
  '/shortlet/calendar': { title: 'Calendar', subtitle: 'Occupancy across every unit' },
  '/shortlet/bookings': { title: 'Bookings', subtitle: 'Stays, payments and caution fees' },
  '/shortlet/operations': { title: 'Operations', subtitle: 'Guest readiness, finance controls and turnovers' },
  '/shortlet/booking-page': { title: 'Booking page', subtitle: 'Your public direct-booking link' },
  '/shortlet/inspections': { title: 'Inspections', subtitle: 'Checkout inspections and caution decisions' },
  '/shortlet/expenses': { title: 'Expenses', subtitle: 'Know your real profit — diesel included' },
  '/shortlet/analytics': { title: 'Analytics', subtitle: 'Revenue, occupancy and source performance' },
  '/shortlet/guests': { title: 'Guests', subtitle: 'Your guest CRM — repeat and VIP guests' },
  '/shortlet/reviews': { title: 'Reviews', subtitle: 'Guest feedback after their stay' },
  '/shortlet/pricing': { title: 'Seasonal pricing', subtitle: 'Seasonal rate rules per apartment' },
  '/shortlet/maintenance': { title: 'Maintenance', subtitle: 'Issue tracker across your units' },
  '/shortlet/agents': { title: 'Agents', subtitle: 'Agent performance and commission' },
  '/shortlet/whatsapp': { title: 'WhatsApp', subtitle: 'Automated guest messaging' },
  '/shortlet/channels': { title: 'Channels', subtitle: 'iCal sync and double-booking guard' },
  '/shortlet/team': { title: 'Team', subtitle: 'Members and role-based access' },
  '/shortlet/plan': { title: 'Plan & billing', subtitle: 'Your subscription and apartment usage' },
  '/shortlet/properties': { title: 'Properties', subtitle: 'Buildings, apartments and access details' },
  '/portal': { title: 'My Estate', subtitle: 'Everything for your home in one place' },
  '/portal/requests': { title: 'My Requests', subtitle: 'Maintenance you have raised' },
  '/portal/bills': { title: 'My Bills', subtitle: 'Your service charges and payments' },
  '/portal/bookings': { title: 'Bookings', subtitle: 'Book shared amenities' },
  '/portal/security': { title: 'Safety & SOS', subtitle: 'Raise an alert, manage visitor passes' },
  '/portal/marketplace': { title: 'Marketplace', subtitle: 'Buy from approved vendors' },
  '/portal/announcements': { title: 'Announcements', subtitle: 'Updates from your estate' },
  '/portal/jobs': { title: 'My Jobs', subtitle: 'Work assigned to you' },
  '/portal/orders': { title: 'Orders', subtitle: 'Accept and fulfil resident orders' },
  '/portal/listings': { title: 'My Listings', subtitle: 'Your marketplace products and services' },
  '/portal/projects': { title: 'My Projects', subtitle: 'Your off-plan investments' },
  '/portal/returns': { title: 'Returns', subtitle: 'Project your investment returns' },
  '/portal/updates': { title: 'Updates', subtitle: 'Construction progress and documents' },
  '/admin/overview': { title: 'Platform Overview', subtitle: 'Tenants, revenue, AI spend and system health' },
  '/admin/tenants': { title: 'Tenants', subtitle: 'Organisations on the platform' },
  '/admin/users': { title: 'Users & Roles', subtitle: 'Everyone across every tenant' },
  '/admin/investors': { title: 'Investor Projects', subtitle: 'Off-plan projects platform-wide' },
  '/admin/reports': { title: 'Reports', subtitle: 'Cross-tenant platform analytics' },
  '/admin/audit': { title: 'Audit Log', subtitle: 'Who did what, when (SC-10)' },
  '/admin/ai': { title: 'AI & Usage', subtitle: 'Feature flags, caps and metering' },
  '/admin/requirements': { title: 'Requirements', subtitle: 'PRD traceability — every screen to its ids' },
};
