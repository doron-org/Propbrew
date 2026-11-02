import { z } from 'zod';
import { verifyResendSignature } from '@/server/integrations/resend-signature';
import { recordTransmittalDeliveryEvent } from '@/server/construction/transmittal-delivery';
import { recordDigestDeliveryEvent } from '@/server/construction/digest-publications';

export const runtime = 'nodejs';
const schema = z.object({ type: z.string(), created_at: z.string(), data: z.object({ email_id: z.string().optional(), to: z.array(z.string()).optional(), tags: z.union([z.record(z.string(), z.string()), z.array(z.object({ name: z.string(), value: z.string() }))]).optional() }).passthrough() }).passthrough();
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 262144) return new Response('Payload too large.', { status: 413 });
  const raw = await request.text();
  if (raw.length > 262144 || !verifyResendSignature(raw, request.headers)) return new Response('Invalid webhook.', { status: 400 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Invalid event.', { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new Response('Invalid event.', { status: 400 });
  try {
    await recordTransmittalDeliveryEvent({ ...parsed.data, id: request.headers.get('svix-id')! });
    await recordDigestDeliveryEvent({ ...parsed.data, id: request.headers.get('svix-id')! });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response('Delivery event could not be saved.', { status: 503 }); }
}
