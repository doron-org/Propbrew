import { requireCapability } from '@/server/guard';
import { can } from '@/lib/authz';
import { repos } from '@/server/data';
import type { Page } from '@/domain/primitives';
import { ScopeBanner } from '@/components/domain';
import { FacilitySiteCreate } from '@/components/spaces/facility-site-create';
import { currentRecordContext } from '@/server/data/record-context';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { SpacesExplorer } from '@/components/spaces/spaces-explorer';
import { PageHeader } from '@/components/ui/page-header';
import { withDurableRead } from '@/server/data/durable-records';
import { selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

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

const keyFor = (tenantId: string, id: string) => JSON.stringify([tenantId, id]);

/** FM-04 — space management (Should). The estate → building → unit hierarchy,
 *  maintained once and shared with the Estate module. Sites come scoped; the
 *  buildings/units are filtered to those sites, and resident names are attached
 *  only if the actor may read them (§7). */
export default async function SpacesPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const sites = allRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 })).filter((entry) => !site || entry.id === site.id);
  const siteIds = new Set(sites.map((site) => keyFor(site.tenantId, site.id)));
  const buildings = allRows((cursor) => repos.buildings.list(actor, { cursor, limit: 200 })).filter((building) => siteIds.has(keyFor(building.tenantId, building.siteId)));
  const units = allRows((cursor) => repos.units.list(actor, { cursor, limit: 200 })).filter((unit) => siteIds.has(keyFor(unit.tenantId, unit.siteId)));

  const residentByUnit = new Map<string, string>();
  if (can(actor, 'users_roles', 'read').allowed) {
    for (const resident of allRows((cursor) => repos.residents.list(actor, { cursor, limit: 200 }))) {
      if (resident.status !== 'moved_out') residentByUnit.set(keyFor(resident.tenantId, resident.unitId), resident.name);
    }
  }

  const unitNodes = units.map((u) => ({
    id: u.id,
    siteId: u.siteId,
    buildingId: u.buildingId,
    label: u.label,
    type: u.type,
    occupancy: u.occupancy,
    residentName: residentByUnit.get(keyFor(u.tenantId, u.id)),
  }));

  return (
    <div className="pb-page">
      <PageHeader title="Spaces" subtitle="Explore your properties, buildings and units in one place."
        actions={!site && nativeAuthEnabled() && currentRecordContext()?.companyPrincipal && actor.tenantId ? <FacilitySiteCreate companyId={actor.tenantId} canCreate={actor.allEstates && can(actor, 'assets_ppm', 'create').allowed} /> : undefined}
        scope={<ScopeBanner label={actor.allEstates ? 'all estates' : `${actor.estateIds.length} estate(s)`} />}
      />
      <SpacesExplorer
        sites={sites.map((s) => ({ id: s.id, name: s.name, address: s.address, kind: s.kind, buildingCount: s.buildingCount, unitCount: s.unitCount }))}
        buildings={buildings.map((b) => ({ id: b.id, siteId: b.siteId, name: b.name, floors: b.floors }))}
        units={unitNodes}
      />
    </div>
  );
  });
}
