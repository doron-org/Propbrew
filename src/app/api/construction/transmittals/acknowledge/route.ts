import { acknowledgePublicTransmittal } from '@/server/construction/transmittal-delivery';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  // This public email form has no session authority. The expiring, HMAC-signed
  // receipt token is its sole write credential; mail/embedded browsers may omit
  // Origin and Referer even when the form is submitted from this app.
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Invalid form.', { status: 415 });
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 4096) return new Response('Form too large.', { status: 413 });
    const data = await request.formData();
    const token = String(data.get('token') ?? '');
    const result = await acknowledgePublicTransmittal(token, { name: data.get('name'), organisation: data.get('organisation'), confirmed: data.get('confirmed') });
    if (!result.ok) return new Response(result.error ?? 'Could not acknowledge.', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const url = new URL('/construction/transmittals/acknowledge', request.url);
    url.searchParams.set('token', token); url.searchParams.set('done', '1');
    return Response.redirect(url, 303);
  } catch { return new Response('Acknowledgement unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
