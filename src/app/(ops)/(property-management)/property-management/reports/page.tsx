import { notFound } from 'next/navigation';
import { can } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import type { Invoice } from '@/domain/entities';
import type { Page } from '@/domain/primitives';
import type { Dataset } from '@/domain/reports';
import { repos } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { requireOperatorSession } from '@/server/workspaces';
import { authorisedPropertySites, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { listPropertyWorkOrders } from '@/server/reads/property-work-orders';
import { operatingClock } from '@/server/operating-clock';
import { PageHeader } from '@/components/ui/page-header';
import { PageTabs } from '@/components/ui/page-tabs';
import { KpiCard } from '@/components/ui';
import { ScopeBanner } from '@/components/domain';
import { MetricsExplorer } from '@/components/reports/metrics-explorer';

function allRows<T>(read: (cursor: string | null) => Page<T>): T[] {
  const rows: T[] = [];
  let cursor: string | null = null;
  do { const page = read(cursor); rows.push(...page.items); cursor = page.cursor; } while (cursor !== null);
  return rows;
}

export default async function PropertyReportsPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
    const { actor } = await requireOperatorSession();
    const estate = canEnterWorkspace(actor, 'estate');
    const facility = canEnterWorkspace(actor, 'facility');
    if ((!estate && !facility) || !(estate && can(actor, 'reports_analytics', 'read').allowed) && !(facility && can(actor, 'assets_ppm', 'read').allowed)) notFound();
    const site = selectedProperty(actor, await searchParams);
    const sites = authorisedPropertySites(actor);
    const estateSites = new Set(sites.filter((entry) => entry.kind === 'estate' && estate).map((entry) => JSON.stringify([entry.tenantId, entry.id])));
    const workOrders = can(actor, 'work_orders', 'read').allowed ? atProperty(listPropertyWorkOrders(actor), site) : [];
    const invoices: Invoice[] = estate && can(actor, 'charges_invoicing', 'read').allowed && (!site || site.kind === 'estate')
      ? allRows((cursor) => repos.invoices.list(actor, { cursor, limit: 200 })).filter((row) => estateSites.has(JSON.stringify([row.tenantId, row.estateId])) && (!site || row.tenantId === site.tenantId && row.estateId === site.id)) : [];
    const assets = facility && can(actor, 'assets_ppm', 'read').allowed ? atProperty(allRows((cursor) => repos.assets.list(actor, { cursor, limit: 200 })), site) : [];
    const plans = facility && can(actor, 'assets_ppm', 'read').allowed ? atProperty(allRows((cursor) => repos.ppmPlans.list(actor, { cursor, limit: 200 })), site) : [];
    const dataset: Dataset = { workOrders, invoices, asOfMs: operatingClock().nowMs };
    const seesInvoices = estate && can(actor, 'charges_invoicing', 'read').allowed && (!site || site.kind === 'estate');
    return <div className="pb-page">
      <PageHeader title="Property performance" subtitle="One view of resident requests, building maintenance and authorised property finance. Figures retain their recorded currency." scope={<ScopeBanner label={site ? site.name : 'Authorised property portfolio'} />} />
      <PageTabs label="Property reporting sections" defaultTab="overview" items={[
        { id: 'overview', label: 'Overview', content: <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Work orders" value={String(workOrders.length)} />
          <KpiCard label="Assets" value={String(assets.length)} />
          <KpiCard label="Maintenance plans" value={String(plans.length)} />
          {seesInvoices ? <KpiCard label="Invoices" value={String(invoices.length)} /> : null}
        </div> },
        { id: 'metrics', label: 'Metrics & exports', content: <MetricsExplorer dataset={dataset} seesInvoices={seesInvoices} /> },
      ]} />
    </div>;
  });
}
