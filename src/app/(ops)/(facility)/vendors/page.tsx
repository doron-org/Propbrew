import { requireCapability } from '@/server/guard';
import { effectiveLevel } from '@/lib/authz';
import { repos } from '@/server/data';
import { PageHeader } from '@/components/ui/page-header';
import { ScopeBanner } from '@/components/domain';
import { VendorsExplorer } from '@/components/vendors/vendors-explorer';
import { facilityMoney } from '@/components/facility/facility-format';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** FM-05 — vendor management. Document-expiry compliance drives an alert tone;
 *  performance metrics (jobs, SLA hit rate, rating) come straight off the org.
 *  The directory is interactive: filter, search, sort and drill into a profile. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('work_orders', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const canMutate = ['F', 'M'].includes(effectiveLevel(actor, 'work_orders'));
  const allVendors = allPropertyRows((cursor) => repos.vendors.list(actor, { cursor, limit: 200 }));

  // A vendor's assigned jobs — scoped work orders that name it as the vendor.
  const woList = atProperty(allPropertyRows((cursor) => repos.workOrders.list(actor, { cursor, limit: 200 })), site);
  const vendorIds = new Set(woList.map((row) => String(row.vendorOrgId)).filter(Boolean));
  const vendors = site ? allVendors.filter((row) => vendorIds.has(String(row.id))) : allVendors;
  const jobs = woList
    .filter((w) => w.vendorOrgId)
    .map((w) => ({ id: w.id, ref: w.ref, title: w.title, status: w.status, vendorOrgId: w.vendorOrgId }));

  // Spend-to-date per vendor, summed from real work-order costs (minor units).
  const spend: Record<string, number> = {};
  const nativeSpend: Record<string, Record<string, number>> = {};
  for (const work of woList) if (work.vendorOrgId && work.cost) {
    const vendor = String(work.vendorOrgId);
    const currencies = nativeSpend[vendor] ?? (nativeSpend[vendor] = {});
    currencies[work.cost.currency] = (currencies[work.cost.currency] ?? 0) + work.cost.minor;
    if (work.cost.currency === 'NGN') spend[vendor] = (spend[vendor] ?? 0) + work.cost.minor;
  }
  const spendLabels = Object.fromEntries(Object.entries(nativeSpend).map(([vendor, currencies]) => [vendor, Object.entries(currencies).map(([currency, minor]) => facilityMoney(minor, currency)).join(' · ')]));

  return (
    <div className="pb-page">
      <PageHeader title={`${vendors.length} vendors`} subtitle="Your approved contractor network — filter, search and drill in"
        scope={<ScopeBanner label={actor.allEstates ? 'all estates' : `${actor.estateIds.length} estate(s)`} />}
      />
      <VendorsExplorer
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, services: [...v.services], coverage: v.coverage, compliance: v.compliance, insuranceExpiry: v.insuranceExpiry, jobsCompleted: v.jobsCompleted, slaHitRate: v.slaHitRate, rating: v.rating }))}
        jobs={jobs}
        spend={spend}
        spendLabels={spendLabels}
        canMutate={canMutate}
        expectedCompanyId={actor.tenantId ?? undefined}
      />
    </div>
  );
  });
}
