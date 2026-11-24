import { withDurableRead } from '@/server/data/durable-records';
import { getSession } from '@/server/session';
import { canEnterWorkspace } from '@/config/workspaces';
import { selectedProperty } from '@/server/reads/property-management-scope';
import { buildPropertyManagementContext } from '@/server/ai/context/property-management';
import { handleCopilot } from '@/server/ai/copilot';
import { can } from '@/lib/authz';

export async function POST(request: Request) {
  return withDurableRead(async () => {
    const actor = (await getSession())?.actor;
    const copilotModule = actor && canEnterWorkspace(actor, 'estate') && can(actor, 'reports_analytics', 'read').allowed ? 'estate' : 'facility';
    const id = new URL(request.url).searchParams.get('siteId');
    const site = actor && new URL(request.url).searchParams.has('siteId') ? selectedProperty(actor, { siteId: id ?? '' }) : null;
    return handleCopilot(request, copilotModule, (authorisedActor) => buildPropertyManagementContext(authorisedActor, copilotModule, site));
  });
}
