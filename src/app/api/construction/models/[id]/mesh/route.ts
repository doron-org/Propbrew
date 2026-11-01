import { ConstructionModelError, readConstructionMesh } from '@/server/construction/models';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { model, elements } = await readConstructionMesh((await context.params).id);
    return Response.json({ model: { id: model.id, name: model.name, revision: model.revision, format: model.format }, elements },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const status = error instanceof ConstructionModelError ? error.status : 503;
    return Response.json({ error: status === 422 && error instanceof Error ? error.message : 'Model geometry unavailable.' },
      { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
