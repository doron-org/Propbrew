import { operatingClock } from '@/server/operating-clock';
import { can } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';

import { visitorStats, accessThreats } from '@/domain/facility';
import { AccessWorkspace } from '@/components/facility/access-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** Access & Visitors — visitor passes with pre-registration and gate check-in/out,
 *  a live access-event feed, per-point secure/unlock control, and a one-tap estate
 *  lockdown. Overstays and forced/held/offline points are flagged. */
export default async function AccessPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const points = atProperty(allPropertyRows((cursor) => repos.accessPoints.list(actor, { cursor, limit: 200 })), site);
  const passes = atProperty(allPropertyRows((cursor) => repos.visitorPasses.list(actor, { cursor, limit: 200 })), site);
  const events = atProperty(allPropertyRows((cursor) => repos.accessEvents.list(actor, { cursor, limit: 200 })), site);

  const stats = visitorStats(passes, clock.nowMs);
  return (
    <div className="pb-page">
      <PageHeader title="Access &amp; visitors" subtitle="Review access points, visitor passes and gate activity." />
      <AccessWorkspace
        canCreate={can(actor, 'assets_ppm', 'create').allowed}
        canUpdate={can(actor, 'assets_ppm', 'update').allowed}
        points={[...points]}
        passes={[...passes]}
        events={[...events]}
        kpis={{
          onSite: stats.onSite,
          expectedToday: stats.expectedToday,
          online: points.filter((p) => p.status === 'online').length,
          totalPoints: points.length,
          threats: accessThreats(points).length,
        }}
        nowMs={clock.nowMs}
      />
    </div>
  );
  });
}
