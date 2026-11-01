import { canEnterWorkspace } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { constructionControl } from '@/server/construction-control';
import { scopedConstructionProjectGet } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { getSession } from '@/server/session';
import { readFieldPhoto } from '@/server/construction/field-photos';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export async function GET(_request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Sign in to continue.' }, { status: 401, headers });
  const actor = session.actor;
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction') || !can(actor, 'reports_analytics', 'read').allowed)
    return Response.json({ error: 'Construction access is required.' }, { status: 403, headers });
  const { id, index: rawIndex } = await context.params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index > 19) return Response.json({ error: 'Photo not found.' }, { status: 404, headers });
  let photo;
  try { photo = await withDurableRead(async () => {
    const state = constructionControl(actor.tenantId!);
    const pack = state.evidencePacks.find((row) => row.tenantId === actor.tenantId && row.id === id);
    if (!pack || pack.subject !== 'task' || !scopedConstructionProjectGet(actor, pack.projectId, 'read')) return null;
    if (['construction-field-worker', 'subcontractor'].includes(actor.companyAccess?.operationalProfileId ?? '') && pack.capturedBy !== actor.userId) return null;
    const target = pack.mediaRefs[index];
    const upload = state.mobileUploads.find((row) => row.tenantId === actor.tenantId && row.url === target && row.projectId === pack.projectId && row.taskId === pack.subjectRef && row.actorId === pack.capturedBy);
    const fileId = upload?.url.match(/^https:\/\/app\.usepropbrew\.com\/api\/construction\/field-photos\/([0-9a-f-]{36})$/i)?.[1];
    return fileId ? readFieldPhoto(actor, fileId) : null;
  }); } catch { return Response.json({ error: 'Photo storage is temporarily unavailable.' }, { status: 503, headers }); }
  if (!photo) return Response.json({ error: 'Photo not found.' }, { status: 404, headers });
  return new Response(photo.bytes as BodyInit, { status: 200, headers: { ...headers, 'Content-Type': photo.contentType, 'Content-Length': String(photo.size), 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
}
