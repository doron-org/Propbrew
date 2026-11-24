/**
 * The operator portals share an identity and tenant. Estate and Facility have
 * one public property-management entry while retaining their separate module
 * grants and routes. Selecting a workspace is an information-architecture choice, not a
 * permission grant: every page, query and mutation still checks its capability.
 */
import { can, type Actor, type Capability } from '@/lib/authz';
import { canUseCompanyModule } from '@/lib/auth/company-policy';
import type { Role } from '@/domain/enums';
import type { IconName } from '@/components/icon';
import { constructionArchived } from './module-archive';

export type WorkspaceId = 'estate' | 'facility' | 'shortlet' | 'construction';

export type Workspace = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly home: string;
  readonly icon: IconName;
  readonly accent: string;
  readonly description: string;
  readonly audience: string;
  readonly highlights: readonly string[];
  readonly features: readonly string[];
};

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'estate', name: 'Estate', home: '/estate', icon: 'building', accent: '#4242EE',
    description: 'A connected home for your estate, residents and revenue.',
    audience: 'Owners, estate managers and community teams',
    highlights: [
      'Follow rent, service charges and collections in naira.',
      'Manage residents, tenancies and everyday community needs.',
      'Keep announcements, amenities and security in one place.',
      'Use portfolio insights to prioritise the next decision.',
    ],
    features: ['Residents', 'Collections', 'Community'],
  },
  {
    id: 'facility', name: 'Facility', home: '/facility', icon: 'wrench', accent: '#087F6C',
    description: 'Keep buildings running, from the control room to the field.',
    audience: 'Facility managers, maintenance teams and technicians',
    highlights: [
      'Prioritise work orders, preventive maintenance and inspections.',
      'Track assets, generators, diesel, water and utilities.',
      'Coordinate vendors, stock and safety evidence.',
      'Use the AI copilot to investigate operational signals.',
    ],
    features: ['Maintenance', 'Assets', 'AI copilot'],
  },
  {
    id: 'shortlet', name: 'Shortlet', home: '/shortlet', icon: 'calendar', accent: '#8B32B5',
    description: 'Run your stays with a clear view of guests and occupancy.',
    audience: 'Shortlet owners, property managers and hospitality teams',
    highlights: [
      'See bookings, availability and occupancy across your units.',
      'Manage guests, caution fees and stay expenses.',
      'Coordinate inspections, housekeeping and maintenance.',
      'Review pricing, channel performance and guest feedback.',
    ],
    features: ['Bookings', 'Guests', 'Revenue'],
  },
  {
    id: 'construction', name: 'Construction', home: '/construction', icon: 'boxes', accent: '#9B4F13',
    description: 'Bring projects, site teams and commercial decisions together.',
    audience: 'Developers, delivery teams and project managers',
    highlights: [
      'See project cost, schedule and earned-value performance.',
      'Track procurement, materials, labour and approvals.',
      'Capture site evidence and synchronise field records.',
      'Review AI-assisted risks with confidence and source evidence.',
    ],
    features: ['Projects', 'Cost control', 'Site intelligence'],
  },
];

/** One public entry, backed by whichever of the two existing grants is present. */
export const PROPERTY_MANAGEMENT_HOME = '/property-management';
export const PROPERTY_MANAGEMENT_CARD: Workspace = {
  id: 'estate',
  name: 'Property Management',
  home: PROPERTY_MANAGEMENT_HOME,
  icon: 'building',
  accent: '#4242EE',
  description: 'Run residents, buildings, maintenance and property performance together.',
  audience: 'Property, estate and facility teams',
  highlights: [
    'Open each authorised property or facility site from one portfolio.',
    'Coordinate residents, service requests, assets and planned maintenance.',
    'Track collections and community activity where your role permits.',
    'Use permission-aware AI insights across your assigned work.',
  ],
  features: ['Properties', 'Operations', 'Intelligence'],
};
export function propertyManagementWorkspace(actor: Actor): Workspace | undefined {
  const estate = canEnterWorkspace(actor, 'estate');
  const facility = canEnterWorkspace(actor, 'facility');
  if (!estate && !facility) return undefined;
  return { ...PROPERTY_MANAGEMENT_CARD, id: estate ? 'estate' : 'facility' };
}

const ENTRY_POLICY: Record<WorkspaceId, { roles: readonly Role[]; capabilities: readonly Capability[] }> = {
  estate: {
    roles: ['executive', 'estate_manager', 'facility_manager', 'security'],
    capabilities: ['announcements', 'charges_invoicing', 'security_sos'],
  },
  facility: {
    roles: ['executive', 'estate_manager', 'facility_manager', 'technician'],
    capabilities: ['assets_ppm', 'work_orders'],
  },
  shortlet: {
    roles: ['executive', 'estate_manager'],
    capabilities: ['bookings_amenities'],
  },
  construction: {
    roles: ['executive', 'estate_manager', 'facility_manager'],
    capabilities: ['reports_analytics'],
  },
};

export function workspaceById(id: unknown): Workspace | undefined {
  return WORKSPACES.find((workspace) => workspace.id === id);
}

/** Fail closed for platform operators, missing tenants and own-record personas. */
export function canEnterWorkspace(actor: Actor, id: unknown): boolean {
  const workspace = workspaceById(id);
  if (!workspace || !actor.tenantId?.trim() || actor.roles.includes('platform_admin')) return false;
  if (workspace.id === 'construction' && constructionArchived()) return false;
  if (!canUseCompanyModule(actor, workspace.id, 'read')) return false;
  const policy = ENTRY_POLICY[workspace.id];
  return policy.roles.some((role) => actor.roles.includes(role))
    && policy.capabilities.some((capability) => can(actor, capability, 'read').allowed);
}

export function availableWorkspaces(actor: Actor): Workspace[] {
  return [
    propertyManagementWorkspace(actor),
    ...WORKSPACES.filter((workspace) => (workspace.id === 'shortlet' || workspace.id === 'construction') && canEnterWorkspace(actor, workspace.id)),
  ].filter((workspace): workspace is Workspace => Boolean(workspace));
}

const ESTATE_SEGMENTS = new Set([
  'estate', 'community', 'billing', 'collections', 'people', 'properties', 'tenancy',
  'announcements', 'governance', 'board', 'rewards', 'bookings', 'events',
  'security', 'parcels', 'marketplace', 'documents', 'portfolio', 'reports',
  'investors', 'finance', 'settings',
]);

const FACILITY_SEGMENTS = new Set([
  'facility', 'field', 'control-center', 'copilot', 'work-orders', 'assets',
  'ppm', 'inspections', 'energy', 'inventory', 'contracts', 'safety', 'access',
  'sustainability', 'spaces', 'vendors',
]);

/**
 * Classify only safe local paths, by a complete first segment. This is also
 * used to keep legacy deep links in their own module, without a mutable cookie
 * or browser-storage value ever controlling the authorization boundary.
 */
export function workspaceForPath(pathname: string): WorkspaceId | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return null;
  if (/[\\\u0000-\u0020\u007f]/.test(pathname)) return null;
  const path = pathname.split(/[?#]/, 1)[0];
  // Encoded separators and multiple decoding passes must not change the route.
  if (/%(?:2f|5c)/i.test(path)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/[\\%?#\u0000-\u0020\u007f]/.test(decoded) || decoded.includes('//')) return null;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  const first = segments[1];
  if (ESTATE_SEGMENTS.has(first)) return 'estate';
  if (FACILITY_SEGMENTS.has(first)) return 'facility';
  if (first === 'shortlet' || first === 'construction') return first;
  return null;
}
