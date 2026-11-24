import { notFound } from 'next/navigation';
import { can, effectiveLevel } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { operatingClock } from '@/server/operating-clock';
import { withDurableRead } from '@/server/data/durable-records';
import { currentRecordContext, durableRecordsEnabled } from '@/server/data/record-context';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { getSession, devIdentityEnabled } from '@/server/session';
import { isReviewActor } from '@/server/review-auth';
import { requireOperatorSession } from '@/server/workspaces';
import { repos } from '@/server/data';
import { listPropertyWorkOrders } from '@/server/reads/property-work-orders';
import { authorisedPropertySites, selectedProperty, atProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { CLOSED } from '@/domain/work-orders';
import { PageHeader } from '@/components/ui/page-header';
import { PageTabs } from '@/components/ui/page-tabs';
import { ScopeBanner } from '@/components/domain';
import { WorkOrdersBoard } from '@/components/work-orders/work-orders-board';
import { WorkOrdersIntel } from '@/components/work-orders/work-orders-intel';
import { EstateWorkOrderCreate } from '@/components/work-orders/estate-work-order-create';
import { FacilityWorkOrderCreate } from '@/components/work-orders/facility-work-order-create';

const BASE = '/property-management/work-orders';

export default async function PropertyWorkOrdersPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
    const { actor } = await requireOperatorSession();
    if (!can(actor, 'work_orders', 'read').allowed) notFound();
    const estate = canEnterWorkspace(actor, 'estate');
    const facility = canEnterWorkspace(actor, 'facility');
    if (!estate && !facility) notFound();
    const site = selectedProperty(actor, await searchParams);
    const clock = operatingClock();
    const rows = atProperty(listPropertyWorkOrders(actor), site);
    const canMutate = ['F', 'M'].includes(effectiveLevel(actor, 'work_orders'));
    const sites = authorisedPropertySites(actor);
    const allowedEstateSites = sites.filter((entry) => entry.kind === 'estate' && estate && (!site || site.id === entry.id));
    const allowedFacilitySites = sites.filter((entry) => facility && (!site || site.id === entry.id));
    const units = canMutate && allowedEstateSites.length ? repos.units.list(actor, { limit: 500 }).items.filter((unit) => allowedEstateSites.some((entry) => entry.id === unit.siteId && entry.tenantId === unit.tenantId)) : [];
    const assets = canMutate && allowedFacilitySites.length ? repos.assets.list(actor, { limit: 500 }).items.filter((asset) => allowedFacilitySites.some((entry) => entry.id === asset.siteId && entry.tenantId === asset.tenantId) && asset.status !== 'archived') : [];
    const session = await getSession();
    const memory = !process.env.DATA_SOURCE || process.env.DATA_SOURCE === 'memory';
    const persistent = durableRecordsEnabled();
    const privateReview = session?.key === 'private-review' && isReviewActor(actor);
    const demo = (memory || persistent) && privateReview || memory && process.env.NODE_ENV !== 'production' && devIdentityEnabled() && session?.key !== 'clerk';
    const nativeEstate = nativeAuthEnabled() && Boolean(actor.companyAccess) && currentRecordContext()?.domainTenantId === actor.tenantId;
    const scopeQuery = site ? `?siteId=${encodeURIComponent(String(site.id))}` : '';
    const createAction = canMutate && (allowedEstateSites.length > 0 || allowedFacilitySites.length > 0 && nativeEstate) ? <div className="flex flex-wrap gap-2">
      {canMutate && allowedEstateSites.length ? <EstateWorkOrderCreate sites={allowedEstateSites.map((entry) => ({ id: String(entry.id), label: entry.name }))} units={units.map((entry) => ({ id: String(entry.id), siteId: String(entry.siteId), label: entry.label }))} demo={demo} native={nativeEstate} persistent={persistent} detailBase={BASE} detailQuery={scopeQuery} buttonLabel="Resident or property request" /> : null}
      {canMutate && allowedFacilitySites.length && nativeEstate ? <FacilityWorkOrderCreate locations={allowedFacilitySites.map((entry) => ({ id: String(entry.id), label: entry.name }))} assets={assets.map((entry) => ({ id: String(entry.id), siteId: String(entry.siteId), label: entry.name }))} detailBase={BASE} detailQuery={scopeQuery} buttonLabel="Asset maintenance job" /> : null}
    </div> : undefined;
    const boardRows = rows.map((row) => ({
      id: row.id, ref: row.ref, title: row.title, origin: row.origin, requesterName: row.requesterName,
      status: row.status, priority: row.priority, assigneeName: row.assigneeName, respondDueAt: row.respondDueAt,
      breached: !CLOSED.includes(row.status) && row.respondDueAt !== null && Date.parse(row.respondDueAt) < clock.nowMs,
      cost: row.cost,
    }));
    const open = rows.filter((row) => !CLOSED.includes(row.status)).length;
    return <div className="pb-page">
      <PageHeader title="Property work orders" subtitle={`${open} open · ${rows.length} total · resident requests and building maintenance in one register`} scope={<ScopeBanner label={site ? site.name : 'Authorised property portfolio'} />} />
      <PageTabs label="Property work order sections" defaultTab="register" items={[
        { id: 'register', label: 'Work order register', count: rows.length, content: <WorkOrdersBoard rows={boardRows} canMutate={canMutate} basePath={BASE} scopeQuery={scopeQuery} createAction={createAction} /> },
        { id: 'intelligence', label: 'SLA & AI intelligence', content: <WorkOrdersIntel wos={rows} nowMs={clock.nowMs} canMutate={canMutate} basePath={BASE} scopeQuery={scopeQuery} /> },
      ]} />
    </div>;
  });
}
