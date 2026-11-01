import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canEnterWorkspace } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { constructionControl } from '@/server/construction-control';
import { withDurableRead } from '@/server/data/durable-records';
import { syncOperation } from '@/server/actions/sync';
import { syncInputSchema } from '@/server/sync-validation';
import { getSession } from '@/server/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const actor = session.actor;
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction') || !can(actor, 'reports_analytics', 'read').allowed)
    return NextResponse.json({ error: 'Construction access is required.' }, { status: 403 });
  const key = request.headers.get('idempotency-key');
  if (!key || !z.uuid().safeParse(key).success) return NextResponse.json({ error: 'A capture ID is required.' }, { status: 400 });
  const raw = await request.json().catch(() => null);
  const parsed = syncInputSchema.safeParse(raw);
  if (!parsed.success || !['task_progress', 'evidence_pack', 'field_check_in'].includes(parsed.data.kind) || parsed.data.id !== key)
    return NextResponse.json({ error: 'Check the queued construction capture.' }, { status: 400 });
  if (parsed.data.kind === 'evidence_pack') {
    const input = parsed.data;
    const valid = await withDurableRead(async () => {
      const uploads = constructionControl(actor.tenantId!).mobileUploads
        .filter((row) => row.opId === input.id && row.actorId === actor.userId && row.projectId === input.payload.projectId && row.taskId === input.payload.subjectRef);
      return input.payload.subject === 'task' && input.payload.mediaRefs.length > 0
        && input.payload.mediaRefs.every((url) => uploads.some((row) => row.url === url));
    });
    if (!valid) return NextResponse.json({ error: 'Every evidence photo must be uploaded for this assigned task and capture.' }, { status: 422 });
  }
  const result = await syncOperation(parsed.data);
  return NextResponse.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 422 });
}
