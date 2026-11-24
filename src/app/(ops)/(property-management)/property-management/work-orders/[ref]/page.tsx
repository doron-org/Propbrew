import { notFound } from 'next/navigation';
import { can } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { withDurableRead } from '@/server/data/durable-records';
import { requireOperatorSession } from '@/server/workspaces';
import { getPropertyWorkOrder } from '@/server/reads/property-work-orders';
import { selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { WorkOrderDetailView } from '@/components/work-orders/work-order-detail-view';

export default async function PropertyWorkOrderDetail({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
    const { actor } = await requireOperatorSession();
    if (!can(actor, 'work_orders', 'read').allowed) notFound();
    if (!canEnterWorkspace(actor, 'estate') && !canEnterWorkspace(actor, 'facility')) notFound();
    const site = selectedProperty(actor, await searchParams);
    const { ref } = await params;
    const row = getPropertyWorkOrder(actor, ref);
    if (!row || site && (row.siteId !== site.id || row.tenantId !== site.tenantId)) notFound();
    const returnHref = site ? `/property-management/work-orders?siteId=${encodeURIComponent(String(site.id))}` : '/property-management/work-orders';
    return <WorkOrderDetailView actor={actor} wo={row} basePath={canEnterWorkspace(actor, 'facility') ? '/work-orders' : '/estate/work-orders'} returnHref={returnHref} />;
  });
}
