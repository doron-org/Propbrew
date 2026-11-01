import { z } from 'zod';
import { nativeRequestOriginAllowed } from '@/server/auth/mode';
import { compareConstructionRevisions, ConstructionModelError } from '@/server/construction/models';

export const runtime = 'nodejs';
const schema = z.strictObject({ beforeId: z.uuid(), afterId: z.uuid(), toleranceMm: z.number().int().min(0).max(1000) });
export async function POST(request: Request) {
  if (!nativeRequestOriginAllowed(request)) return Response.json({ error: 'Start the comparison from your Propbrew workspace.' }, { status: 403 });
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'Choose two revisions.' }, { status: 400 });
  try {
    const body = await request.text();
    if (body.length > 2048) return Response.json({ error: 'Comparison request is too large.' }, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(body));
    if (!parsed.success) return Response.json({ error: 'Choose two different revisions and a valid tolerance.' }, { status: 400 });
    return Response.json({ ok: true, comparison: await compareConstructionRevisions(parsed.data) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof ConstructionModelError ? error.message : 'Revision comparison is unavailable.' },
      { status: error instanceof ConstructionModelError ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
