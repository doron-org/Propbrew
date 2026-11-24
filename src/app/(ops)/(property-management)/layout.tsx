import { notFound } from 'next/navigation';
import { ShellFrame } from '@/components/shell-frame';
import { canEnterWorkspace } from '@/config/workspaces';
import { withDurableRead } from '@/server/data/durable-records';
import { requireOperatorSession } from '@/server/workspaces';

export default async function PropertyManagementLayout({ children }: { children: React.ReactNode }) {
  return withDurableRead(async () => {
    const { actor } = await requireOperatorSession();
    const workspace = canEnterWorkspace(actor, 'estate') ? 'estate'
      : canEnterWorkspace(actor, 'facility') ? 'facility' : null;
    if (!workspace) notFound();
    return <ShellFrame expected="ops" workspace={workspace}>{children}</ShellFrame>;
  });
}
