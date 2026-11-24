import { buildEstateProperties } from '@/domain/estate/properties';
import type { Page } from '@/domain/primitives';
import { can, type Actor, type Capability } from '@/lib/authz';
import type { PropertyHubPermission } from '@/components/workspaces/property-operating-hub';
import { repos } from '@/server/data';
import { canEnterWorkspace } from '@/config/workspaces';

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

const capabilityByPermission: Record<Exclude<PropertyHubPermission, 'facility' | 'facilityInspections'>, Capability> = {
  users: 'users_roles',
  workOrders: 'work_orders',
  inspections: 'inspections_compliance',
  community: 'announcements',
  bookings: 'bookings_amenities',
  security: 'security_sos',
  billing: 'charges_invoicing',
  marketplace: 'marketplace',
  reports: 'reports_analytics',
};

export function readEstatePropertyOperating(actor: Actor, propertyId: string) {
  const sites = allRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 }));
  const units = allRows((cursor) => repos.units.list(actor, { cursor, limit: 200 }));
  const property = buildEstateProperties(sites, units).find((candidate) => candidate.id === propertyId) ?? null;
  const permissions = {
    ...Object.fromEntries(Object.entries(capabilityByPermission).map(([permission, capability]) => [permission, can(actor, capability, 'read').allowed])),
    facility: canEnterWorkspace(actor, 'facility') && can(actor, 'assets_ppm', 'read').allowed,
    facilityInspections: canEnterWorkspace(actor, 'facility') && can(actor, 'inspections_compliance', 'read').allowed,
  } as Record<PropertyHubPermission, boolean>;
  return { property, permissions };
}
