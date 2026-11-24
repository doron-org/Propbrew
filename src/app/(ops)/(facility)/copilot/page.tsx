import { operatingClock } from '@/server/operating-clock';
import { requireCapability } from '@/server/guard';
import { repos, seed } from '@/server/data';
import { can } from '@/lib/authz';

import { CopilotWorkspace } from '@/components/facility/copilot-workspace';
import { getTenantModel, type CopilotUsage } from '@/server/copilot/metering';
import { readCopilotLedgerUsage } from '@/server/ai/copilot-ledger';
import { isReviewActor, reviewLedgerTenantId, reviewModeEnabled } from '@/server/review-auth';
import type { CopilotWorld } from '@/domain/facility';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { canEnterWorkspace } from '@/config/workspaces';

/** AI Facility Copilot — reads across every facility signal (alarms, generators,
 *  inventory, contracts, permits, incidents) and fuses them into one ranked list
 *  of actionable priorities, plus a real AI conversation. Actions
 *  fire the real facility mutations (dispatch WO, refuel, receive stock, ack). */
export default async function CopilotPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const world: CopilotWorld = {
    systems: atProperty(allPropertyRows((cursor) => repos.buildingSystems.list(actor, { cursor, limit: 200 })), site),
    alarms: atProperty(allPropertyRows((cursor) => repos.facilityAlarms.list(actor, { cursor, limit: 200 })), site),
    generators: atProperty(allPropertyRows((cursor) => repos.facilityGenerators.list(actor, { cursor, limit: 200 })), site),
    parts: allPropertyRows((cursor) => repos.facilityParts.list(actor, { cursor, limit: 200 })).filter((part) => !site || part.siteId === site.id),
    contracts: atProperty(allPropertyRows((cursor) => repos.facilityContracts.list(actor, { cursor, limit: 200 })), site),
    permits: atProperty(allPropertyRows((cursor) => repos.facilityPermits.list(actor, { cursor, limit: 200 })), site),
    incidents: atProperty(allPropertyRows((cursor) => repos.facilityIncidents.list(actor, { cursor, limit: 200 })), site),
    sensors: atProperty(allPropertyRows((cursor) => repos.facilitySensors.list(actor, { cursor, limit: 200 })), site),
    nowMs: clock.nowMs,
  };
  const userName = seed.users.find((u) => u.id === actor.userId)?.name ?? 'there';
  const tenantId = actor.tenantId!;
  let usage: CopilotUsage | null = null;
  try {
    const ledgerTenantId = reviewModeEnabled() && isReviewActor(actor) ? reviewLedgerTenantId() ?? tenantId : tenantId;
    usage = await readCopilotLedgerUsage(ledgerTenantId);
  } catch { /* An unavailable durable meter is shown explicitly, never as zero usage. */ }

  return (
    <div className="pb-page">
      <CopilotWorkspace
        world={world}
        userName={userName}
        model={getTenantModel(tenantId)}
        usage={usage}
        canConfigure={can(actor, 'reports_analytics', 'update').allowed}
        canCreate={can(actor, 'assets_ppm', 'create').allowed}
        canUpdate={can(actor, 'assets_ppm', 'update').allowed}
        endpoint={site ? `/api/property-management/copilot?siteId=${encodeURIComponent(String(site.id))}` : '/api/property-management/copilot'}
        module={canEnterWorkspace(actor, 'estate') && can(actor, 'reports_analytics', 'read').allowed ? 'estate' : 'facility'}
      />
    </div>
  );
  });
}
