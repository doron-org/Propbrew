import { can, assertCan, matchesScope } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';
import { stockSignal, stockValueMinor } from '@/domain/facility';
import { InventoryWorkspace } from '@/components/facility/inventory-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { inventoryValuation } from '@/domain/facility/inventory-setup';
import { listFacilityInventory } from '@/server/reads/facility-inventory';
import { db } from '@/server/data/store';
import { selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** Inventory — spare-parts stock with stock-out forecasting and receive-to-stock.
 *  Below-reorder and soon-to-stock-out parts are flagged so nothing runs dry
 *  mid-repair. */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ before?: string; view?: string } & PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const params = await searchParams;
  const site = selectedProperty(actor, params);
  const native = nativeAuthEnabled();
  const setup = native ? listFacilityInventory(actor, { before: typeof params.before === 'string' ? params.before : undefined, siteId: site ? String(site.id) : undefined, limit: 50, includeArchived: true }) : null;
  const parts = setup ? setup.parts : repos.facilityParts.list(actor).items.filter((part) => !site || part.siteId === site.id);
  const scope = assertCan(actor, 'assets_ppm', 'read');
  const sites = native ? db.sites.filter((entry) => matchesScope({ ...entry, siteId: entry.id }, scope) && (!site || entry.id === site.id)).map((entry) => ({ id: String(entry.id), name: entry.name })) : [];

  return (
    <div className="pb-page">
      <PageHeader title="Inventory" subtitle="Track spare parts, stock signals and receiving." />
      <InventoryWorkspace
        setup={setup ? { ...setup, sites, expectedCompanyId: actor.tenantId ?? '', canCreate: can(actor, 'assets_ppm', 'create').allowed, canMutate: can(actor, 'assets_ppm', 'update').allowed, defaultTab: params.view === 'movements' ? 'movements' : 'register' } : undefined}
        canMutate={can(actor, 'assets_ppm', 'update').allowed}
        parts={[...parts]}
        kpis={{
          total: parts.length,
          belowReorder: parts.filter((p) => stockSignal(p).belowReorder).length,
          stockValueMinor: setup ? inventoryValuation(parts).ngnMinor : stockValueMinor(parts),
          stockoutsSoon: parts.filter((p) => { const s = stockSignal(p); return s.daysToStockout !== null && s.daysToStockout <= 7; }).length,
        }}
      />
    </div>
  );
  });
}
