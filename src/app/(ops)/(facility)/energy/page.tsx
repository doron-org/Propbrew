import { operatingClock } from '@/server/operating-clock';
import { can } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';

import { gridReliancePct, dieselCost, costPerKwhMinor, co2Kg } from '@/domain/facility';
import { EnergyWorkspace, type GenRow, type MeterRow } from '@/components/facility/energy-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** Energy & Utilities — Nigeria-first facility energy intelligence: generator
 *  runtime + fuel with AI refuel prediction and efficiency-anomaly detection,
 *  genset-vs-grid reliance, diesel spend + cost/kWh + carbon, and meter readings. */
export default async function EnergyPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const sites = new Map<string, string>(repos.sites.all(actor).filter((entry) => !site || entry.id === site.id).map((s) => [s.id, s.name]));
  const generators = atProperty(allPropertyRows((cursor) => repos.facilityGenerators.list(actor, { cursor, limit: 200 })), site);
  const meters = atProperty(allPropertyRows((cursor) => repos.facilityMeters.list(actor, { cursor, limit: 200 })), site);

  const litresMonth = generators.reduce((n, g) => n + Math.round(g.runtimeHoursMonth * g.litresPerHour), 0);
  const genRows: GenRow[] = generators.map((g) => ({ ...g, siteName: sites.get(g.siteId) ?? '' }));
  const meterRows: MeterRow[] = meters.map((m) => ({ id: m.id, label: m.label, kind: m.kind, unit: m.unit, reading: m.reading, previous: m.previous, atISO: m.atISO }));

  return (
    <div className="pb-page">
      <PageHeader title="Energy &amp; utilities" subtitle="Generators, fuel forecasts and meter readings." />
      <EnergyWorkspace
        canMutate={can(actor, 'assets_ppm', 'update').allowed}
        generators={genRows}
        meters={meterRows}
        kpis={{ dieselSpendMinor: dieselCost(litresMonth), litresMonth, costPerKwhMinor: costPerKwhMinor(), co2Kg: co2Kg(litresMonth) }}
        reliance={gridReliancePct(generators)}
        nowMs={clock.nowMs}
      />
    </div>
  );
  });
}
