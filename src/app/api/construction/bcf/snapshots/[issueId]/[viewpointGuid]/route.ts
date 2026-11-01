import { ConstructionModelError, readConstructionBcfSnapshot } from '@/server/construction/models';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ issueId: string; viewpointGuid: string }> }) {
  try {
    const { issueId, viewpointGuid } = await context.params;
    const image = await readConstructionBcfSnapshot(issueId, viewpointGuid);
    return new Response(Buffer.from(image.bytes), { headers: { 'Content-Type': image.mediaType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
  } catch (error) {
    return Response.json({ error: 'Snapshot unavailable.' }, { status: error instanceof ConstructionModelError ? error.status : 503,
      headers: { 'Cache-Control': 'private, no-store' } });
  }
}
