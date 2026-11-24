import { notFound } from 'next/navigation';
import { can } from '@/lib/authz';
import { canEnterWorkspace } from '@/config/workspaces';
import { withDurableRead } from '@/server/data/durable-records';
import { requireOperatorSession } from '@/server/workspaces';
import { selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';
import { PropertyCopilot } from '@/components/workspaces/property-copilot';

export default async function PropertyCopilotPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
    const { actor } = await requireOperatorSession();
    const estate = canEnterWorkspace(actor, 'estate') && can(actor, 'reports_analytics', 'read').allowed;
    const facility = canEnterWorkspace(actor, 'facility') && can(actor, 'assets_ppm', 'read').allowed;
    if (!estate && !facility) notFound();
    const site = selectedProperty(actor, await searchParams);
    return <div className="pb-page"><PropertyCopilot module={estate ? 'estate' : 'facility'} siteId={site ? String(site.id) : undefined} propertyName={site?.name} /></div>;
  });
}
