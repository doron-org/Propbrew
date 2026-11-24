import { operatingClock } from '@/server/operating-clock';
import { requireCapability } from '@/server/guard';
import { effectiveLevel } from '@/lib/authz';
import { repos, runtimeForActor } from '@/server/data';
import { scoreAssets, coverageGaps } from '@/server/data/ppm-risk';
import { WEEKLY_CAPACITY_HOURS } from '@/domain/ppm';
import { PageHeader } from '@/components/ui/page-header';
import { ScopeBanner } from '@/components/domain';
import { MaintenanceWorkspace } from '@/components/ppm/maintenance-workspace';
import type { PpmData } from '@/components/ppm/types';
import { readFacilityMaintenanceSetup } from '@/server/reads/facility-maintenance';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

/** FM-02 preventive maintenance + AI-F-01 predictive maintenance — a calendar-
 *  first workspace. Everything is computed from the actor's scoped repos, so the
 *  calendar, risk engine and runtime feeds never cross the estate/tenant
 *  boundary (§8.2). Modify actions are Facility-Manager-gated (assets_ppm = M);
 *  everyone else gets a read-only workspace. */
export default async function PpmPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const canMutate = effectiveLevel(actor, 'assets_ppm') === 'M' || effectiveLevel(actor, 'assets_ppm') === 'F';

  const plans: Array<ReturnType<typeof repos.ppmPlans.list>['items'][number]> = [];
  let cursor: string | null = null;
  do { const page = repos.ppmPlans.list(actor, { limit: 500, cursor }); plans.push(...page.items); cursor = page.cursor; } while (cursor !== null);
  const occurrences: Array<ReturnType<typeof repos.ppmOccurrences.list>['items'][number]> = [];
  do { const page = repos.ppmOccurrences.list(actor, { limit: 500, cursor }); occurrences.push(...page.items); cursor = page.cursor; } while (cursor !== null);
  const rawSetup = readFacilityMaintenanceSetup(actor);
  const setup = rawSetup && site ? { ...rawSetup,
    assets: rawSetup.assets.filter((row) => row.siteId === site.id),
    plans: rawSetup.plans.filter((row) => row.siteId === site.id),
    services: rawSetup.services.filter((row) => row.siteId === site.id),
    archivedOccurrenceIds: rawSetup.archivedOccurrenceIds.filter((id) => occurrences.some((row) => row.id === id && row.siteId === site.id)),
  } : rawSetup;
  const visiblePlans = atProperty(plans, site);
  const visibleOccurrences = atProperty(occurrences, site);
  const visibleAssets = atProperty(allPropertyRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 })), site);
  const visibleAssetIds = new Set(visibleAssets.map((row) => String(row.id)));
  const nameById = new Map((setup?.assets ?? allPropertyRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 }))).map((a) => [String(a.id), a.name]));

  const data: PpmData = {
    setup,
    now: clock.dateISO,
    canMutate,
    weeklyCapacityHours: WEEKLY_CAPACITY_HOURS,
    occurrences: visibleOccurrences.filter((row) => !setup?.archivedOccurrenceIds.includes(row.id) && (row.status === 'completed' || setup?.plans.find((p) => p.planId === String(row.planId))?.enabled !== false)).map((row) => !row.workOrderRef && ['scheduled', 'overdue'].includes(row.status) ? { ...row, status: row.dueDate < clock.dateISO ? 'overdue' as const : 'scheduled' as const } : row),
    plans: visiblePlans.map((p) => ({
      id: String(p.id),
      assetId: String(p.assetId),
      assetName: p.assetName,
      category: p.category,
      frequency: p.frequency,
      basis: p.basis,
      leadTimeDays: p.leadTimeDays,
      runtimeIntervalHours: p.runtimeIntervalHours,
      checklist: [...p.checklist],
      evidenceRequired: p.evidenceRequired,
      lastServicedAt: p.lastServicedAt,
      estimatedHours: p.estimatedHours,
      assignee: p.assignee,
      statutory: p.statutory,
      statutoryDeadline: p.statutoryDeadline,
      nextDue: p.nextDue,
      rescheduleCount: p.rescheduleCount,
    })),
    assessments: scoreAssets(actor).filter((row) => visibleAssetIds.has(String(row.assetId))),
    runtime: runtimeForActor(actor).filter((row) => visibleAssetIds.has(String(row.assetId))).map((r) => ({ ...r, assetName: nameById.get(String(r.assetId)) ?? String(r.assetId) })),
    gaps: coverageGaps(actor).filter((row) => visibleAssetIds.has(String(row.id))).map((a) => ({ id: String(a.id), name: a.name, category: a.category, locationLabel: a.locationLabel, status: a.status })),
  };

  return (
    <div className="pb-page">
      <PageHeader title="Maintenance" subtitle="Preventive schedules, runtime readings and advisory risk review."
        scope={<ScopeBanner label={actor.allEstates ? 'all estates' : `${actor.estateIds.length} estate(s)`} />}
      />
      <MaintenanceWorkspace {...data} />
    </div>
  );
  });
}
