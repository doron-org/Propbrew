import { can } from '@/lib/authz';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';
import { permitConflicts } from '@/domain/facility';
import { SafetyWorkspace } from '@/components/facility/safety-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** Safety & Permits — permit-to-work register with automatic clash detection
 *  (overlapping permits in the same location), a lifecycle flow, and an
 *  incident log. A live safety score reflects open incidents and conflicts. */
export default async function SafetyPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const permits = atProperty(allPropertyRows((cursor) => repos.facilityPermits.list(actor, { cursor, limit: 200 })), site);
  const incidents = atProperty(allPropertyRows((cursor) => repos.facilityIncidents.list(actor, { cursor, limit: 200 })), site);

  const conflicts = permitConflicts(permits);
  const openIncidents = incidents.filter((i) => i.status === 'open');
  const majorOpen = openIncidents.filter((i) => i.severity === 'major').length;
  const safetyScore = Math.max(0, 100 - conflicts.length * 8 - openIncidents.length * 4 - majorOpen * 8);

  return (
    <div className="pb-page">
      <PageHeader title="Safety &amp; permits" subtitle="Review permits, incidents and work-area conflicts." />
      <SafetyWorkspace
        canMutate={can(actor, 'assets_ppm', 'update').allowed}
        permits={[...permits]}
        incidents={[...incidents]}
        kpis={{
          activePermits: permits.filter((p) => p.status === 'active').length,
          openIncidents: openIncidents.length,
          safetyScore,
        }}
      />
    </div>
  );
  });
}
