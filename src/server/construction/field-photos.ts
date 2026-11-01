import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '@/lib/authz';
import { currentRecordContext } from '@/server/data/record-context';
import { withTenantTransaction } from '@/server/db';

export const fieldPhotoUrl = (id: string) => `https://app.usepropbrew.com/api/construction/field-photos/${id}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireCompanyContext(actor: Actor) {
  const principal = currentRecordContext()?.companyPrincipal;
  if (!actor.tenantId || !principal || principal.company.id !== actor.tenantId || principal.user.id !== actor.userId) throw new Error('Company photo storage is unavailable. Keep the device copy and retry.');
  return actor.tenantId;
}

export async function storeFieldPhoto(actor: Actor, input: { projectId: string; taskId: string; opId: string; index: number; contentType: string; bytes: Uint8Array; sha256: string }) {
  const tenantId = requireCompanyContext(actor);
  const result = await withTenantTransaction(tenantId, async (client) => {
    const previous = await client.query<{ id: string; project_id: string; task_id: string; sha256: string }>(
      'select id,project_id,task_id,sha256 from construction_field_photos where tenant_id=$1::uuid and created_by=$2::uuid and capture_id=$3::uuid and photo_index=$4',
      [tenantId, actor.userId, input.opId, input.index]);
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (row.project_id !== input.projectId || row.task_id !== input.taskId || row.sha256 !== input.sha256) return { ok: false as const, error: 'This capture ID already belongs to a different photo.' };
      return { ok: true as const, id: row.id, duplicate: true };
    }
    const id = randomUUID();
    await client.query('insert into construction_field_photos(id,tenant_id,project_id,task_id,capture_id,photo_index,content_type,size_bytes,sha256,bytes,created_by) values($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11::uuid)',
      [id, tenantId, input.projectId, input.taskId, input.opId, input.index, input.contentType, input.bytes.byteLength, input.sha256, Buffer.from(input.bytes), actor.userId]);
    await client.query('insert into audit_events(tenant_id,actor_subject,action,entity,entity_id,payload) values($1::uuid,$2,$3,$4,$5,$6::jsonb)',
      [tenantId, actor.userId, 'construction.field.photo.stored', 'construction_field_photo', id, JSON.stringify({ projectId: input.projectId, taskId: input.taskId, captureId: input.opId, index: input.index, sha256: input.sha256, size: input.bytes.byteLength })]);
    return { ok: true as const, id, duplicate: false };
  });
  return result.ok ? { ok: true as const, url: fieldPhotoUrl(result.id), duplicate: result.duplicate } : result;
}

export async function readFieldPhoto(actor: Actor, id: string) {
  if (!uuid.test(id)) return null;
  const tenantId = requireCompanyContext(actor);
  const rows = await withTenantTransaction(tenantId, async (client) => client.query<{ bytes: Buffer; content_type: string; size_bytes: number; sha256: string }>(
    'select bytes,content_type,size_bytes,sha256 from construction_field_photos where id=$1::uuid and tenant_id=$2::uuid', [id, tenantId]));
  const row = rows.rows[0];
  if (!row || !/^image\/(jpeg|png|webp)$/.test(row.content_type) || row.bytes.length !== row.size_bytes || createHash('sha256').update(row.bytes).digest('hex') !== row.sha256) return null;
  return { bytes: row.bytes, contentType: row.content_type, size: row.size_bytes, sha256: row.sha256 };
}
