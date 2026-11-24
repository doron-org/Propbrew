import 'server-only';

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { Actor } from '@/lib/authz';
import { identityByKey, type DevIdentity } from '@/server/identities';
import { trustedCreatedEstateIds } from '@/server/data/estate-creation-scope';
import { currentRecordContext, durableRecordsEnabled } from '@/server/data/record-context';

export const REVIEW_SESSION_COOKIE = '__Host-propbrew_review_session';
export const REVIEW_CSRF_COOKIE = '__Host-propbrew_review_csrf';
export const REVIEW_SESSION_SECONDS = 12 * 60 * 60;
export const REVIEW_COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'strict' as const };
const CSRF_SECONDS = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_USER = 'propbrew-private-review-estate-manager';
const COPILOT_PATHS = new Set(['/api/copilot', '/api/estate/copilot', '/api/property-management/copilot', '/api/shortlet/copilot', '/api/construction/copilot']);

export class ReviewConfigurationError extends Error {
  constructor(field: string) { super(`Private review configuration is invalid: ${field}.`); }
}

export function reviewModeEnabled(): boolean { return process.env.PROPBREW_REVIEW_MODE === '1'; }

function decoded(value: string | undefined, minimum: number, maximum: number): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length >= minimum && bytes.length <= maximum && bytes.toString('base64url') === value ? bytes : null;
}

function reviewConfiguration() {
  if (!reviewModeEnabled()) throw new ReviewConfigurationError('PROPBREW_REVIEW_MODE');
  if (process.env.PROPBREW_WEBSITE_ONLY !== '0') throw new ReviewConfigurationError('PROPBREW_WEBSITE_ONLY');
  for (const field of ['REEVE_ALLOW_DEMO_IDENTITIES', 'REEVE_ALLOW_IN_MEMORY_DATA', 'NEXT_PUBLIC_DEV_IDENTITY']) {
    if (process.env[field] === '1') throw new ReviewConfigurationError(field);
  }
  // Review identity remains separate from customer authentication even with durable records.
  if (process.env.DATA_SOURCE && !['memory', 'postgres'].includes(process.env.DATA_SOURCE)) throw new ReviewConfigurationError('DATA_SOURCE');
  const parts = process.env.PROPBREW_REVIEW_PASSWORD_HASH?.split('$');
  const salt = parts?.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$16384$8$1' ? decoded(parts[4], 16, 64) : null;
  const passwordHash = parts?.length === 6 ? decoded(parts[5], 64, 64) : null;
  if (!salt || !passwordHash) throw new ReviewConfigurationError('PROPBREW_REVIEW_PASSWORD_HASH');
  const secret = decoded(process.env.PROPBREW_REVIEW_SESSION_SECRET, 32, 128);
  if (!secret) throw new ReviewConfigurationError('PROPBREW_REVIEW_SESSION_SECRET');
  const tenantId = process.env.PROPBREW_REVIEW_TENANT_UUID;
  if (!tenantId || !UUID.test(tenantId)) throw new ReviewConfigurationError('PROPBREW_REVIEW_TENANT_UUID');
  const cap = process.env.REEVE_AI_DAILY_CAP_MINOR_NGN;
  if (!cap || !/^\d+$/.test(cap) || !Number.isSafeInteger(Number(cap)) || Number(cap) <= 0) throw new ReviewConfigurationError('REEVE_AI_DAILY_CAP_MINOR_NGN');
  try {
    const database = new URL(process.env.DATABASE_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname) throw new Error();
  } catch { throw new ReviewConfigurationError('DATABASE_URL'); }
  let origin: string;
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error();
    origin = site.origin;
  } catch { throw new ReviewConfigurationError('NEXT_PUBLIC_SITE_URL'); }
  // A review cannot accidentally deliver real payments, messages or private uploads through sample actions.
  for (const field of ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'PAYSTACK_SECRET_KEY', 'FLUTTERWAVE_SECRET_KEY', 'FLUTTERWAVE_WEBHOOK_SECRET', 'TERMII_API_KEY', 'RESEND_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'ANTHROPIC_API_KEY']) {
    if (process.env[field]?.trim()) throw new ReviewConfigurationError(field);
  }
  return { salt, passwordHash, secret, tenantId: tenantId.toLowerCase(), origin, credentialVersion: process.env.PROPBREW_REVIEW_PASSWORD_HASH! };
}

export function assertReviewReadiness(): void { reviewConfiguration(); }

/** Canonical storage UUID; the review actor's logical tenant remains separate. */
export function reviewLedgerTenantId(): string | null {
  return reviewModeEnabled() ? reviewConfiguration().tenantId : null;
}

export function reviewActorIdentity(): DevIdentity {
  assertReviewReadiness();
  const preset = identityByKey('estate_manager');
  const actor = { ...structuredClone(preset.actor), userId: REVIEW_USER };
  actor.estateIds = Array.from(new Set([...actor.estateIds, ...trustedCreatedEstateIds(actor)]));
  return { ...preset, key: 'private-review', label: 'Private reviewer — Estate Manager', tenantLabel: 'Sample portfolio · private review', actor };
}

/** Identity marker is server-derived; callers must still obtain their actor through getSession(). */
export function isReviewActor(actor: Actor): boolean {
  if (!reviewModeEnabled()) return false;
  assertReviewReadiness();
  const fixed = { ...identityByKey('estate_manager').actor, userId: REVIEW_USER };
  const permittedEstateIds = new Set([...fixed.estateIds, ...trustedCreatedEstateIds(fixed)]);
  // Creation may occur during another request. An earlier, narrower actor stays
  // a review actor, but no client-supplied extra estate or missing base scope does.
  const validEstates = Array.isArray(actor.estateIds) && new Set(actor.estateIds).size === actor.estateIds.length
    && fixed.estateIds.every((id) => actor.estateIds.includes(id)) && actor.estateIds.every((id) => permittedEstateIds.has(id));
  return actor.userId === fixed.userId && actor.tenantId === fixed.tenantId
    && JSON.stringify(actor.roles) === JSON.stringify(fixed.roles)
    && validEstates
    && actor.allEstates === fixed.allEstates && actor.vendorOrgId === fixed.vendorOrgId
    && JSON.stringify(actor.unitIds) === JSON.stringify(fixed.unitIds)
    && JSON.stringify(actor.investorProjectIds) === JSON.stringify(fixed.investorProjectIds);
}

function signature(value: string, domain: string): string {
  const config = reviewConfiguration();
  return createHmac('sha256', config.secret).update(`${domain}:${config.credentialVersion}:${config.tenantId}:${config.origin}:${value}`).digest('base64url');
}

function matches(left: string, right: string): boolean {
  const first = Buffer.from(left), second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function issueReviewSession(now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: 'sample-estate-manager', iat, exp: iat + REVIEW_SESSION_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  return `${payload}.${signature(payload, 'review-session-v1')}`;
}

export function verifyReviewSession(token: string | undefined, now = Date.now()): boolean {
  assertReviewReadiness();
  if (!token || token.length > 1024) return false;
  const [payload, supplied, extra] = token.split('.');
  if (extra !== undefined || !decoded(payload, 1, 600) || !decoded(supplied, 32, 32) || !matches(supplied, signature(payload, 'review-session-v1'))) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const seconds = Math.floor(now / 1000);
    return Object.keys(value).sort().join(',') === 'exp,iat,nonce,sub,v' && value.v === 1 && value.sub === 'sample-estate-manager'
      && typeof value.iat === 'number' && Number.isSafeInteger(value.iat) && value.iat > 0 && value.iat <= seconds + 30
      && typeof value.exp === 'number' && Number.isSafeInteger(value.exp) && value.exp > seconds && value.exp - value.iat === REVIEW_SESSION_SECONDS
      && typeof value.nonce === 'string' && decoded(value.nonce, 16, 16) !== null;
  } catch { return false; }
}

export async function getReviewSession(): Promise<DevIdentity | null> {
  if (!reviewModeEnabled()) return null;
  const token = (await cookies()).get(REVIEW_SESSION_COOKIE)?.value;
  if (!verifyReviewSession(token)) return null;
  if (durableRecordsEnabled() && !currentRecordContext()) {
    const { withDurableRead } = await import('@/server/data/durable-records');
    return withDurableRead(async () => reviewActorIdentity());
  }
  return reviewActorIdentity();
}

export function issueReviewCsrf(now = Date.now()): string {
  const payload = `${Math.floor(now / 1000) + CSRF_SECONDS}.${randomBytes(32).toString('base64url')}`;
  return `${payload}.${signature(payload, 'review-csrf-v1')}`;
}

function validReviewCsrf(cookie: string | undefined, supplied: string | null, now = Date.now()): boolean {
  if (!cookie || !supplied || cookie.length > 256 || !matches(cookie, supplied)) return false;
  const [expires, nonce, signed, extra] = cookie.split('.');
  const seconds = Math.floor(now / 1000), expiration = Number(expires);
  return extra === undefined && /^\d+$/.test(expires) && Number.isSafeInteger(expiration) && expiration > seconds && expiration <= seconds + CSRF_SECONDS
    && decoded(nonce, 32, 32) !== null && decoded(signed, 32, 32) !== null && matches(signed, signature(`${expires}.${nonce}`, 'review-csrf-v1'));
}

export function reviewOriginAllowed(request: Request): boolean {
  const config = reviewConfiguration();
  return request.headers.get('Origin') === config.origin && !['cross-site', 'none'].includes(request.headers.get('Sec-Fetch-Site') ?? '');
}

export async function verifyReviewPassword(password: string): Promise<boolean> {
  const config = reviewConfiguration();
  if (!password || Buffer.byteLength(password, 'utf8') > 1024) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(password, config.salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return timingSafeEqual(derived, config.passwordHash);
}

const loginAttempts = new Map<string, number[]>();
function loginRate(request: Request, now = Date.now()): { allowed: boolean; retryAfter: number } {
  // Ingress headers are only a hint. The shared five-attempt ceiling also holds when they are spoofed.
  const candidate = request.headers.get('X-Forwarded-For')?.split(',').at(-1)?.trim();
  const peer = candidate && isIP(candidate) ? candidate : 'unknown';
  const key = signature(peer, 'review-login-rate');
  const sharedKey = signature('all-reviewers', 'review-login-global');
  for (const [entry, times] of loginAttempts) {
    const recent = times.filter((time) => time + 60_000 > now);
    if (recent.length) loginAttempts.set(entry, recent); else loginAttempts.delete(entry);
  }
  const times = loginAttempts.get(key) ?? [], shared = loginAttempts.get(sharedKey) ?? [];
  const blocked = [times, shared].filter((attempts) => attempts.length >= 5);
  if (blocked.length) return { allowed: false, retryAfter: Math.max(...blocked.map((attempts) => Math.max(1, Math.ceil((attempts[0] + 60_000 - now) / 1000)))) };
  if (!loginAttempts.has(key) && loginAttempts.size >= 4096) return { allowed: false, retryAfter: 60 };
  times.push(now); shared.push(now);
  loginAttempts.set(key, times); loginAttempts.set(sharedKey, shared);
  return { allowed: true, retryAfter: 0 };
}

function unavailable(): NextResponse { return new NextResponse('Private review is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }

/** Review adds an independent signed-session boundary without changing normal production auth. */
export function reviewProxy(request: NextRequest): NextResponse {
  try {
    assertReviewReadiness();
    const path = request.nextUrl.pathname;
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (/[\\%]/.test(path) || path.includes('//')) return new NextResponse('Not found', { status: 404 });
    const asset = path.startsWith('/_next/static/') || path === '/_next/image' || path.startsWith('/brand/') || path === '/icon.svg' || path === '/favicon.ico';
    if (asset || path === '/api/v1/health') return read ? NextResponse.next() : new NextResponse('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    if (path === '/review/login/auth') return request.method === 'POST' && reviewOriginAllowed(request) ? NextResponse.next() : new NextResponse('Forbidden', { status: 403 });
    const authenticated = verifyReviewSession(request.cookies.get(REVIEW_SESSION_COOKIE)?.value);
    if (path === '/review/login') {
      if (!read) return new NextResponse('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      if (authenticated) return NextResponse.redirect(new URL('/workspaces', reviewConfiguration().origin), 303);
      const csrf = issueReviewCsrf();
      request.cookies.set(REVIEW_CSRF_COOKIE, csrf);
      const response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
      response.cookies.set(REVIEW_CSRF_COOKIE, csrf, { ...REVIEW_COOKIE_OPTIONS, maxAge: CSRF_SECONDS });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (path === '/api' || path.startsWith('/api/')) {
      if (!COPILOT_PATHS.has(path)) return new NextResponse('Unavailable in private review', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      if (request.method !== 'POST') return new NextResponse('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    if (!authenticated) return read && !path.startsWith('/api/')
      ? NextResponse.redirect(new URL('/review/login', reviewConfiguration().origin), 307)
      : NextResponse.json({ error: 'Private review sign-in required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    if (!read && !reviewOriginAllowed(request)) return new NextResponse('Forbidden', { status: 403 });
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch { return unavailable(); }
}

/** Native form submission: password values never enter HTML, URLs, session claims or application logs. */
export async function reviewLogin(request: NextRequest): Promise<NextResponse> {
  if (!reviewModeEnabled()) return new NextResponse('Not found', { status: 404 });
  try {
    assertReviewReadiness();
    if (!reviewOriginAllowed(request)) return new NextResponse('Forbidden', { status: 403 });
    const rate = loginRate(request);
    if (!rate.allowed) return new NextResponse('Too many sign-in attempts. Try again in a minute.', { status: 429, headers: { 'Retry-After': String(rate.retryAfter), 'Cache-Control': 'no-store' } });
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return new NextResponse('Unsupported form', { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse('Invalid form', { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 8192) { await reader.cancel(); return new NextResponse('Form too large', { status: 413 }); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    if (form.getAll('password').length !== 1 || form.getAll('csrf').length !== 1 || !validReviewCsrf(request.cookies.get(REVIEW_CSRF_COOKIE)?.value, form.get('csrf'))) return new NextResponse('This sign-in form has expired. Reload the sign-in page.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    const verified = await verifyReviewPassword(form.get('password') ?? '');
    const response = NextResponse.redirect(new URL(verified ? '/workspaces' : '/review/login?error=invalid', reviewConfiguration().origin), 303);
    response.headers.set('Cache-Control', 'no-store');
    if (verified) {
      response.cookies.set(REVIEW_SESSION_COOKIE, issueReviewSession(), { ...REVIEW_COOKIE_OPTIONS, maxAge: REVIEW_SESSION_SECONDS });
      response.cookies.set(REVIEW_CSRF_COOKIE, '', { ...REVIEW_COOKIE_OPTIONS, maxAge: 0 });
    }
    return response;
  } catch { return unavailable(); }
}
