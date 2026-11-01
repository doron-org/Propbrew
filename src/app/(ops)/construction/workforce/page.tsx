import { requireCapability } from '@/server/guard';
import { can } from '@/lib/authz';
import { constructionWorld } from '@/server/reads/construction';
import { operatingClock } from '@/server/operating-clock';
import { attendanceSummary, labourCostMinor, certBand } from '@/domain/construction';
import { WorkforceWorkspace, type WorkerRow } from '@/components/construction/workforce-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { constructionControl } from '@/server/construction-control';
import { db } from '@/server/data/store';

/** Workforce — recorded attendance and separate device location attestations, trade mix vs allocation,
 *  labour cost for the day, and a certification-expiry watch that surfaces a
 *  lapsing ticket before it blocks certified work. */
export default async function ConstructionWorkforcePage() {
  return withDurableRead(async () => {
  const { nowMs: NOW_MS, dateISO: TODAY } = operatingClock();
  const { actor } = await requireCapability('reports_analytics', 'read', 'construction');
  const canMutate = can(actor, 'reports_analytics', 'update').allowed;
  const world = constructionWorld(actor);
  const today = TODAY;

  // Focus the busiest site.
  const counts = new Map<string, number>();
  for (const w of world.workers) if (w.projectId) counts.set(w.projectId, (counts.get(w.projectId) ?? 0) + 1);
  const projectId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? world.projects[0]?.id ?? '';
  const project = world.projects.find((p) => p.id === projectId);
  const checkInDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const checkIns = constructionControl(actor.tenantId!).fieldCheckIns
    .filter((row) => row.projectId === projectId && row.dateISO === checkInDate && (actor.companyAccess?.operationalProfileId !== 'construction-field-worker' || row.actorId === actor.userId))
    .map((row) => ({ id: row.id, actorName: db.users.find((user) => user.id === row.actorId && user.tenantId === actor.tenantId)?.name ?? 'Site team member',
      siteName: project?.mobilisation?.locations.find((site) => site.id === row.siteLocationId)?.name ?? 'Configured site',
      capturedAtISO: row.capturedAtISO, distanceMeters: row.distanceMeters, accuracyMeters: row.accuracyMeters }));

  const crew = world.workers.filter((w) => w.projectId === projectId);
  const att = attendanceSummary(world.attendance, world.workers, projectId, today);

  const workers: WorkerRow[] = crew.map((w) => {
    const a = world.attendance.find((x) => x.workerId === w.id && x.dateISO === today);
    const c = certBand(w, NOW_MS);
    return {
      id: w.id, name: w.name, trade: w.trade, kind: w.kind, crew: w.crew, company: w.company,
      dayRateMinor: w.dayRate.minor, certName: w.certName, certExpiryISO: w.certExpiryISO,
      certDays: c.days, certBand: c.band,
      status: a?.status ?? 'pending', method: a?.method, withinGeofence: a?.withinGeofence, clockIn: a?.clockIn,
    };
  });

  const trades = new Map<string, { present: number; total: number }>();
  for (const w of workers) {
    const t = trades.get(w.trade) ?? { present: 0, total: 0 };
    t.total += 1; if (w.status === 'present') t.present += 1;
    trades.set(w.trade, t);
  }

  return (
    <div className="pb-page">
      <WorkforceWorkspace
        workers={workers}
        checkIns={checkIns}
        byTrade={[...trades.entries()].map(([trade, v]) => ({ trade, ...v })).sort((a, b) => b.total - a.total)}
        projectName={project?.name ?? 'Site'}
        projectId={projectId}
        kpis={{
          present: att.present, planned: att.planned, shortfall: att.shortfall,
          dayCostMinor: labourCostMinor(world.attendance, world.workers, projectId, today),
          certAlerts: workers.filter((w) => w.certDays !== null && w.certDays <= 30).length,
        }}
        canMutate={canMutate}
      />
    </div>
  );
  });
}
