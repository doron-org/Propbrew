import { requireCapability } from '@/server/guard';
import { effectiveLevel } from '@/lib/authz';
import { repos } from '@/server/data';
import { scoreAssets } from '@/server/data/ppm-risk';
import { PageHeader } from '@/components/ui/page-header';
import { ScopeBanner } from '@/components/domain';
import { facilityMoney } from '@/components/facility/facility-format';
import { AssetsExplorer, type AssetHealth } from '@/components/assets/assets-explorer';
import { withDurableRead } from '@/server/data/durable-records';
import { currentRecordContext } from '@/server/data/record-context';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** FM-01 — asset register. Facility Manager can add (M); Executive/Technician are
 *  view-only (V). Assets are archived, never deleted. The register is
 *  interactive: filter by status/category, search, and drill into an asset's PPM
 *  plans and full work-order service history. */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const canMutate = ['F', 'M'].includes(effectiveLevel(actor, 'assets_ppm'));
  const registrationReady = nativeAuthEnabled() && Boolean(actor.companyAccess) && currentRecordContext()?.domainTenantId === actor.tenantId;
  const assets = atProperty(allPropertyRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 })), site);
  const ppm = atProperty(allPropertyRows((cursor) => repos.ppmPlans.list(actor, { cursor, limit: 200 })), site);

  const jobs = atProperty(allPropertyRows((cursor) => repos.workOrders.list(actor, { cursor, limit: 200 })), site)
    .filter((w) => w.assetId)
    .map((w) => ({ id: w.id, ref: w.ref, title: w.title, status: w.status, assetId: w.assetId, costLabel: w.cost ? facilityMoney(w.cost.minor, w.cost.currency) : '—' }));

  // AI-F-01 asset-health from the PPM risk engine, keyed by asset for the cards.
  const health: Record<string, AssetHealth> = {};
  for (const r of scoreAssets(actor).filter((row) => assets.some((asset) => String(asset.id) === String(row.assetId)))) health[String(r.assetId)] = { score: r.score, band: r.band, topDriver: r.topDriver, confidence: r.confidence };

  return (
    <div className="pb-page">
      <PageHeader title={`${assets.length} assets`} subtitle="The register of everything under management — filter, search and drill in"
        scope={<ScopeBanner label={actor.allEstates ? 'all estates' : `${actor.estateIds.length} estate(s)`} />}
      />
      <AssetsExplorer
        assets={assets.map((a) => ({ id: a.id, name: a.name, category: a.category, serial: a.serial, locationLabel: a.locationLabel, status: a.status, purchaseDate: a.purchaseDate, warrantyExpiry: a.warrantyExpiry }))}
        ppm={ppm.map((p) => ({ id: p.id, assetId: p.assetId, frequency: p.frequency, nextDue: p.nextDue, overdue: p.overdue, checklistItems: p.checklistItems, assignee: p.assignee }))}
        jobs={jobs}
        health={health}
        canMutate={canMutate}
        registrationReady={registrationReady}
        locations={allPropertyRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 })).filter((entry) => !site || entry.id === site.id).map((entry) => ({ id: String(entry.id), label: entry.name }))}
      />
    </div>
  );
  });
}
