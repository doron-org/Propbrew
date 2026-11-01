import { z } from 'zod';
import { MODEL_MAX_BYTES } from '@/domain/construction/model-clashes';
import { nativeRequestOriginAllowed } from '@/server/auth/mode';
import { ConstructionModelError, storeConstructionModel } from '@/server/construction/models';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const failure = (error: unknown) => error instanceof ConstructionModelError ? reply({ error: error.message }, error.status) : reply({ error: 'Model storage is unavailable. The file was not saved.' }, 503);
const schema = z.object({ expectedCompanyId: z.string().uuid(), projectId: z.string().min(1).max(200),
  workPackageId: z.string().min(1).max(200).optional(), discipline: z.string().trim().min(2).max(80),
  modelCode: z.string().trim().min(2).max(60).optional(), revision: z.string().trim().min(1).max(30).optional() }).strict();

export async function POST(request: Request) {
  if (!nativeRequestOriginAllowed(request)) return reply({ error: 'Upload from your Propbrew workspace.' }, 403);
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return reply({ error: 'Choose an IFC, OBJ or GLB model.' }, 400);
  const reader = request.body?.getReader(); if (!reader) return reply({ error: 'Choose a model.' }, 400);
  try {
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > MODEL_MAX_BYTES + 65536) { await reader.cancel(); return reply({ error: 'Choose a model of at most 12 MB.' }, 413); }
      chunks.push(part.value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData();
    const keys = [...form.keys()];
    if (keys.some((key) => !['expectedCompanyId', 'projectId', 'workPackageId', 'discipline', 'modelCode', 'revision', 'file'].includes(key)) || new Set(keys).size !== keys.length) return reply({ error: 'Provide one model and its project details.' }, 400);
    const file = form.get('file'), parsed = schema.safeParse(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file')));
    if (!parsed.success || !(file instanceof File) || file.size < 32 || file.size > MODEL_MAX_BYTES) return reply({ error: 'Choose a valid IFC, OBJ or GLB model of at most 12 MB.' }, 400);
    const model = await storeConstructionModel({ ...parsed.data, key: request.headers.get('Idempotency-Key') ?? '', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return reply({ ok: true, model }, 201);
  } catch (error) { return failure(error); }
  finally { reader.releaseLock(); }
}
