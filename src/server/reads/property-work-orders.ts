import 'server-only';

import type { Actor } from '@/lib/authz';
import type { WorkOrder } from '@/domain/entities';
import { repos } from '@/server/data';
import { authorisedPropertySites } from './property-management-scope';

/** One register for both request intake and technical maintenance records. */
export function listPropertyWorkOrders(actor: Actor): WorkOrder[] {
  const sites = new Set(authorisedPropertySites(actor).map((site) => JSON.stringify([site.tenantId, site.id])));
  const rows: WorkOrder[] = [];
  let cursor: string | null = null;
  do {
    const page = repos.workOrders.list(actor, { cursor, limit: 200 });
    rows.push(...page.items.filter((row) => sites.has(JSON.stringify([row.tenantId, row.siteId]))));
    cursor = page.cursor ?? null;
  } while (cursor !== null);
  return rows;
}

export function getPropertyWorkOrder(actor: Actor, ref: string): WorkOrder | null {
  const row = repos.workOrders.getByRef(actor, ref);
  if (!row) return null;
  return authorisedPropertySites(actor).some((site) => site.tenantId === row.tenantId && site.id === row.siteId) ? row : null;
}
