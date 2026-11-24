import Link from 'next/link';
import { operatingClock } from '@/server/operating-clock';
import { can } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';

import { siteHealth } from '@/domain/facility';
import { ControlCenter, type SystemRow, type SensorRow, type AlarmRow } from '@/components/facility/control-center';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** Facility Control Center — a live building-operations command centre. Composite
 *  site health, live sensors (water/fuel/temp/power/occupancy), building-system
 *  status, and an active-alarm feed where one tap dispatches a work order. */
export default async function ControlCenterPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const sites = new Map<string, string>(repos.sites.all(actor).filter((entry) => !site || entry.id === site.id).map((s) => [s.id, s.name]));
  const systems = atProperty(allPropertyRows((cursor) => repos.buildingSystems.list(actor, { cursor, limit: 200 })), site);
  const sensors = atProperty(allPropertyRows((cursor) => repos.facilitySensors.list(actor, { cursor, limit: 200 })), site);
  const alarms = atProperty(allPropertyRows((cursor) => repos.facilityAlarms.list(actor, { cursor, limit: 200 })), site);

  const health = siteHealth(systems);
  const water = sensors.find((s) => s.kind === 'water_tank');
  const power = sensors.find((s) => s.kind === 'power_source');

  const systemRows: SystemRow[] = systems.map((s) => ({ id: s.id, name: s.name, category: s.category, status: s.status, detail: s.detail, siteName: sites.get(s.siteId) ?? '' }));
  const sensorRows: SensorRow[] = sensors.map((s) => ({ id: s.id, name: s.name, kind: s.kind, value: s.value, unit: s.unit, low: s.low, high: s.high, drift: s.drift, text: s.text, siteName: sites.get(s.siteId) ?? '' }));
  const alarmRows: AlarmRow[] = [...alarms].sort((a, b) => (a.acknowledged === b.acknowledged ? (a.atISO < b.atISO ? 1 : -1) : a.acknowledged ? 1 : -1)).map((a) => ({ id: a.id, system: a.system, severity: a.severity, message: a.message, atISO: a.atISO, acknowledged: a.acknowledged, woRef: a.woRef }));

  return (
    <div className="pb-page">
      <PageHeader title="Facility overview" subtitle="Building systems, sensor readings and operational alarms." />
      {sites.size === 0 && <p className="mb-6 text-sm text-text-2">Start with your operating location. <Link href="/spaces" className="text-primary underline">Set up your first facility site in Spaces</Link>.</p>}
      <ControlCenter
        canCreate={can(actor, 'assets_ppm', 'create').allowed}
        canUpdate={can(actor, 'assets_ppm', 'update').allowed}
        health={health}
        systems={systemRows}
        sensors={sensorRows}
        alarms={alarmRows}
        kpis={{ operational: systems.filter((s) => s.status === 'operational' || s.status === 'standby').length, total: systems.length, powerSource: power?.text ?? '—', waterPct: water?.value ?? 0 }}
        nowMs={clock.nowMs}
      />
    </div>
  );
  });
}
