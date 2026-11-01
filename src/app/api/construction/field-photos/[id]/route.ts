import { canEnterWorkspace } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { readFieldPhoto } from '@/server/construction/field-photos';
import { withDurableRead } from '@/server/data/durable-records';
import { getSession } from '@/server/session';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Sign in to continue.' }, { status: 401, headers });
  const actor = session.actor;
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction') || !can(actor, 'reports_analytics', 'read').allowed)
    return Response.json({ error: 'Construction access is required.' }, { status: 403, headers });
  try {
    const { id } = await context.params;
    const photo = await withDurableRead(() => readFieldPhoto(actor, id));
    if (!photo) return Response.json({ error: 'Photo not found.' }, { status: 404, headers });
    return new Response(photo.bytes as BodyInit, { headers: { ...headers, 'Content-Type': photo.contentType, 'Content-Length': String(photo.size), 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
  } catch {
    return Response.json({ error: 'Photo storage is temporarily unavailable.' }, { status: 503, headers });
  }
}
