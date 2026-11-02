import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
export type DigestReceiptClaim = { tenantId: string; publicationId: string; emailHash: string; expiresISO: string };

function key(): string {
  const value = process.env.CONSTRUCTION_TRANSMITTAL_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('The external digest signing secret is unavailable.');
  return value;
}

function valid(claim: DigestReceiptClaim): boolean {
  return uuid.test(claim.tenantId) && uuid.test(claim.publicationId) && sha256.test(claim.emailHash)
    && Number.isFinite(Date.parse(claim.expiresISO));
}

/** A digest receipt is scoped to one publication and one recipient, not company access. */
export function signDigestReceiptClaim(claim: DigestReceiptClaim): string {
  if (!valid(claim)) throw new Error('Invalid digest receipt link.');
  const payload = Buffer.from(JSON.stringify(claim), 'utf8').toString('base64url');
  return `${payload}.${createHmac('sha256', key()).update(`digest-receipt:${payload}`).digest('base64url')}`;
}

export function verifyDigestReceiptClaim(token: string, now = Date.now()): DigestReceiptClaim | null {
  if (token.length > 700 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key()).update(`digest-receipt:${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DigestReceiptClaim;
    return valid(claim) && Date.parse(claim.expiresISO) > now ? claim : null;
  } catch { return null; }
}
