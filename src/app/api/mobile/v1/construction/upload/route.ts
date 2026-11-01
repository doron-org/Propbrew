import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { z } from 'zod';
import { canEnterWorkspace } from '@/config/workspaces';
import { can } from '@/lib/authz';
import { constructionControl } from '@/server/construction-control';
import { scopedConstructionProjectGet, scopedConstructionTaskGet } from '@/server/data';
import { withDurableMutation } from '@/server/data/durable-records';
import { getSession } from '@/server/session';

export const runtime = 'nodejs';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_:-]+$/);
const contentTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function validImage(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const actor = session.actor;
  if (!actor.tenantId || !canEnterWorkspace(actor, 'construction') || !can(actor, 'reports_analytics', 'create').allowed)
    return NextResponse.json({ error: 'Construction capture access is required.' }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const opId = z.uuid().safeParse(form?.get('opId'));
  const projectId = identifier.safeParse(form?.get('projectId'));
  const taskId = identifier.safeParse(form?.get('taskId'));
  const index = z.coerce.number().int().min(0).max(19).safeParse(form?.get('index'));
  if (!(file instanceof File) || !opId.success || !projectId.success || !taskId.success || !index.success)
    return NextResponse.json({ error: 'A task, capture ID and photo are required.' }, { status: 400 });
  if (file.size === 0 || file.size > 10 * 1024 * 1024 || !contentTypes[file.type])
    return NextResponse.json({ error: 'Use a JPEG, PNG or WebP photo under 10 MB.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImage(bytes, file.type)) return NextResponse.json({ error: 'The selected file is not a valid image.' }, { status: 400 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    const result = await withDurableMutation(async () => {
      const project = scopedConstructionProjectGet(actor, projectId.data, 'read');
      const task = scopedConstructionTaskGet(actor, taskId.data, 'read');
      if (!project || !task || task.projectId !== project.id) return { ok: false as const, error: 'This task is not assigned to your construction workspace.' };
      const state = constructionControl(actor.tenantId!);
      const prior = state.mobileUploads.find((row) => row.actorId === actor.userId && row.opId === opId.data && row.index === index.data);
      if (prior) return prior.sha256 === sha256 && prior.projectId === project.id && prior.taskId === task.id
        ? { ok: true as const, url: prior.url, duplicate: true }
        : { ok: false as const, error: 'This capture ID already belongs to a different photo.' };
      const blob = await put(`tenants/${actor.tenantId}/construction/field/${opId.data}-${index.data}.${contentTypes[file.type]}`, Buffer.from(bytes), { access: 'private', contentType: file.type, addRandomSuffix: true });
      state.mobileUploads.push({ tenantId: actor.tenantId!, opId: opId.data, actorId: actor.userId, projectId: project.id, taskId: task.id, index: index.data, url: blob.url, contentType: file.type, size: file.size, sha256 });
      return { ok: true as const, url: blob.url, duplicate: false };
    }, 'construction', 'create');
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch {
    return NextResponse.json({ error: 'Photo storage is unavailable. The device copy has not been acknowledged.' }, { status: 503 });
  }
}
