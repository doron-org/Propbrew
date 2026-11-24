import { can } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';
import { gridReliancePct, co2Kg, esgScore, reductionScenarios } from '@/domain/facility';
import { SustainabilityWorkspace, type MonthPoint } from '@/components/facility/sustainability-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, selectedProperty, atProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { Card, KpiCard } from '@/components/ui';
import Link from 'next/link';

/** Sustainability — Nigeria-first ESG: diesel carbon, grid-vs-genset mix, water,
 *  a 6-month carbon trend, modelled reduction pathways (solar/service/LED/gas with
 *  CO₂, ₦ savings and payback), and editable reduction targets. */
export default async function SustainabilityPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const generators = atProperty(allPropertyRows((cursor) => repos.facilityGenerators.list(actor, { cursor, limit: 200 })), site);
  if (site) {
    const litres = generators.reduce((sum, row) => sum + Math.round(row.runtimeHoursMonth * row.litresPerHour), 0);
    return <div className="pb-page">
      <PageHeader title={`${site.name} sustainability`} subtitle="Site-linked generator estimates; company-wide utility months and targets are not attributed to this property." />
      <div className="grid gap-4 sm:grid-cols-2"><KpiCard label="Recorded generators" value={String(generators.length)} /><KpiCard label="Modelled diesel CO₂" value={`${co2Kg(litres).toLocaleString('en-NG')} kg`} /></div>
      <Card><p>Monthly utility totals and sustainability targets do not yet have a property assignment. They remain in the <Link className="text-primary underline" href="/sustainability">company-wide sustainability view</Link> until site attribution is recorded.</p></Card>
    </div>;
  }
  const months = allPropertyRows((cursor) => repos.emissionMonths.list(actor, { cursor, limit: 200 }));
  const targets = allPropertyRows((cursor) => repos.sustainabilityTargets.list(actor, { cursor, limit: 200 }));

  const litresMonth = generators.reduce((n, g) => n + Math.round(g.runtimeHoursMonth * g.litresPerHour), 0);
  const reliance = gridReliancePct(generators);
  const latest = months[months.length - 1];
  const trend: MonthPoint[] = months.map((m) => ({ label: m.monthLabel, co2Kg: co2Kg(m.dieselLitres), dieselLitres: m.dieselLitres }));

  return (
    <div className="pb-page">
      <PageHeader title="Sustainability" subtitle="Resource efficiency, carbon estimates and your targets." />
      <SustainabilityWorkspace
        canMutate={can(actor, 'assets_ppm', 'update').allowed}
        esg={esgScore(reliance.gensetPct, targets)}
        kpis={{ carbonKg: co2Kg(litresMonth), gensetPct: reliance.gensetPct, waterM3: latest?.waterM3 ?? 0, renewableReadiness: reliance.gridPct }}
        months={trend}
        mix={{ gridKwh: latest?.gridKwh ?? 0, gensetKwh: latest?.gensetKwh ?? 0 }}
        scenarios={reductionScenarios(litresMonth)}
        targets={[...targets]}
      />
    </div>
  );
  });
}
