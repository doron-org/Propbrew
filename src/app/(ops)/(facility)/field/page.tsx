import { operatingClock } from '@/server/operating-clock';
import { PageHeader } from '@/components/ui/page-header';
import { requireCapability } from '@/server/guard';
import { can } from '@/lib/authz';
import { repos } from '@/server/data';
import { getSession } from '@/server/session';
import type { Page } from '@/domain/primitives';

import { TechnicianWorkspace, type Job } from '@/components/facility/technician-workspace';
import { withDurableRead } from '@/server/data/durable-records';
import { atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';

function allRows<T>(read: (cursor?: string | null) => Page<T>): T[] {
  const rows: T[] = [];
  let cursor: string | null | undefined;
  do {
    const page = read(cursor);
    rows.push(...page.items);
    cursor = page.cursor;
  } while (cursor !== null);
  return rows;
}

const keyFor = (tenantId: string, id: string) => JSON.stringify([tenantId, id]);

/** My Day — the field technician's mobile-first job list. Their own assigned work
 *  (scoped to assigned_to_me), grouped On now / Up next / Waiting / Done, with big
 *  tap targets that fire the real §10 work-order transitions and live SLA counts. */
export default async function FieldPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('work_orders', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const jobs = atProperty(allRows((cursor) => repos.workOrders.list(actor, { cursor, limit: 200 })), site);
  const seesSpaces = can(actor, 'assets_ppm', 'read').allowed;
  const sites = new Map(seesSpaces ? allRows((cursor) => repos.sites.list(actor, { cursor, limit: 200 })).filter((entry) => !site || entry.id === site.id).map((entry) => [keyFor(entry.tenantId, entry.id), entry.name]) : []);
  const assets = new Map(seesSpaces ? atProperty(allRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 })), site).map((asset) => [keyFor(asset.tenantId, asset.id), asset.name]) : []);
  const units = new Map(seesSpaces ? allRows((cursor) => repos.units.list(actor, { cursor, limit: 200 })).filter((unit) => sites.has(keyFor(unit.tenantId, unit.siteId))).map((unit) => [keyFor(unit.tenantId, unit.id), unit.label]) : []);
  const session = await getSession();
  const techName = session?.actor.userId === actor.userId ? session.label.split(' — ')[0] : 'there';

  const rows: Job[] = jobs.map((w) => ({
    ref: w.ref, title: w.title, priority: w.priority, status: w.status, origin: w.origin,
    dueISO: w.resolveDueAt ?? null,
    location: (w.unitId && units.get(keyFor(w.tenantId, w.unitId))) || sites.get(keyFor(w.tenantId, w.estateId)) || sites.get(keyFor(w.tenantId, w.siteId)) || 'Estate',
    assetName: w.assetId ? assets.get(keyFor(w.tenantId, w.assetId)) : undefined,
  }));

  return (
    <div className="pb-page">
      <PageHeader title="My day" subtitle="Your assigned jobs, priorities and next steps." />
      <TechnicianWorkspace jobs={rows} techName={techName} nowMs={clock.nowMs} canTransition={can(actor, 'work_orders', 'transition').allowed} />
    </div>
  );
  });
}
