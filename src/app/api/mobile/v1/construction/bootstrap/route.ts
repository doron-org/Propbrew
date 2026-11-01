import { NextResponse } from 'next/server';
import { canEnterWorkspace } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { withDurableRead } from '@/server/data/durable-records';
import { mobileConstructionBootstrap } from '@/server/mobile/construction-bootstrap';
import { getSession } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const actor = session.actor;
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction') || !can(actor, 'reports_analytics', 'read').allowed)
    return NextResponse.json({ error: 'Construction access is required.' }, { status: 403 });
  const data = await withDurableRead(async () => mobileConstructionBootstrap(actor, session.label));
  return NextResponse.json(data, { headers: { 'cache-control': 'private, no-store' } });
}
