import ControlCenterPage from '../control-center/page';
import { requireWorkspace } from '@/server/workspaces';
import { withDurableRead } from '@/server/data/durable-records';
import type { PropertyQuery } from '@/server/reads/property-management-scope';

export default async function FacilityPortalPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  await requireWorkspace('facility');
  return <ControlCenterPage searchParams={searchParams} />;
  });
}
