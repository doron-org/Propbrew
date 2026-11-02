import { acknowledgePublicDigestReceipt } from '@/server/construction/digest-publications';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  // The expiring, recipient-bound signed link is the only write credential.
  // Mail browsers may omit both Origin and Referer on this public form.
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Invalid form.', { status: 415 });
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 4096) return new Response('Form too large.', { status: 413 });
    const data = await request.formData();
    const token = String(data.get('token') ?? '');
    const result = await acknowledgePublicDigestReceipt(token, { name: data.get('name'), organisation: data.get('organisation'), confirmed: data.get('confirmed') });
    if (!result.ok) return new Response(result.error ?? 'Could not acknowledge.', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const url = new URL('/construction/digest/acknowledge', request.url);
    url.searchParams.set('token', token); url.searchParams.set('done', '1');
    return Response.redirect(url, 303);
  } catch { return new Response('Acknowledgement unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
