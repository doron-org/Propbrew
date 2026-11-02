import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeAuthEnabled, nativeRequestOriginAllowed } from '@/server/auth/mode';
import { accountJson, accountResponse } from '@/server/auth/request';

const origin = 'https://app.propbrew.example';
const ingress = 'http://127.0.0.1:3000/api/companies';
function request(body: BodyInit | null = '{}', headers: Record<string, string> = {}, url = ingress) {
  return new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
}
const jsonOfSize = (bytes: number) => JSON.stringify({ text: 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify({ text: '' }))) });

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', origin); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://ignored.example');
  vi.stubEnv('PROPBREW_AUTH_ORIGINS', ''); vi.stubEnv('PROPBREW_AUTH_MODE', 'company');
});
afterEach(() => vi.unstubAllEnvs());

describe('native account origin authority', () => {
  it('accepts the canonical browser origin behind Railway TLS termination without trusting ingress hosts', () => {
    expect(nativeRequestOriginAllowed(request('{}', {
      Host: 'internal.railway:3000', 'X-Forwarded-Host': 'attacker.example',
      'X-Forwarded-Proto': 'http', Forwarded: 'host=attacker.example;proto=http',
    }))).toBe(true);
  });

  it('does not let a foreign Origin borrow canonical forwarded-origin, host or request URL values', () => {
    expect(nativeRequestOriginAllowed(request('{}', {
      Origin: 'https://attacker.example', Host: new URL(origin).host,
      'X-Forwarded-Host': new URL(origin).host, 'X-Forwarded-Proto': 'https',
      'X-Forwarded-Origin': origin, Forwarded: `host=${new URL(origin).host};proto=https`,
    }, `${origin}/api/companies`))).toBe(false);
  });

  it.each(['null', '', origin + '.attacker.example', origin + '/', origin + '/path', origin + '?anything', 'https://app.propbrew.example@attacker.example'])('rejects absent, opaque or misleading Origin %s', (value) => {
    expect(nativeRequestOriginAllowed(request('{}', { Origin: value }))).toBe(false);
  });

  it('requires an Origin even when forwarded headers claim the canonical public host', () => {
    const req = request('{}', { 'X-Forwarded-Origin': origin, 'X-Forwarded-Host': new URL(origin).host });
    req.headers.delete('Origin');
    expect(nativeRequestOriginAllowed(req)).toBe(false);
  });

  it('rejects browser cross-site metadata even if the Origin header otherwise matches', () => {
    expect(nativeRequestOriginAllowed(request('{}', { 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
    expect(nativeRequestOriginAllowed(request('{}', { 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
  });

  it('accepts only exact explicitly configured preview origins', () => {
    vi.stubEnv('PROPBREW_AUTH_ORIGINS', ' https://preview.propbrew.example,https://review.propbrew.example ');
    expect(nativeRequestOriginAllowed(request('{}', { Origin: 'https://preview.propbrew.example' }))).toBe(true);
    expect(nativeRequestOriginAllowed(request('{}', { Origin: 'https://other.propbrew.example' }))).toBe(false);
    expect(nativeRequestOriginAllowed(request('{}', { Origin: 'http://preview.propbrew.example' }))).toBe(false);
    expect(nativeRequestOriginAllowed(request('{}', { Origin: 'https://preview.propbrew.example:444' }))).toBe(false);
  });

  it('uses the site origin only when the canonical auth setting is absent and fails closed for malformed settings', () => {
    vi.stubEnv('BETTER_AUTH_URL', undefined); vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin);
    expect(nativeRequestOriginAllowed(request())).toBe(true);
    vi.stubEnv('BETTER_AUTH_URL', 'malformed');
    expect(nativeRequestOriginAllowed(request())).toBe(false);
  });

  it('enables company identity only through the server runtime mode', () => {
    expect(nativeAuthEnabled()).toBe(true);
    vi.stubEnv('PROPBREW_AUTH_MODE', ''); vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'company');
    expect(nativeAuthEnabled()).toBe(false);
  });
});


describe('bounded account JSON requests', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON; charset=UTF-8'])('parses a valid %s request', async (type) => {
    expect(await accountJson(request('{"companyName":"Abuja Homes"}', { 'Content-Type': type }))).toEqual({ companyName: 'Abuja Homes' });
  });

  it.each(['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded', 'application/jsonp', 'application/json-malicious'])('rejects a non-JSON media type %s', async (type) => {
    await expect(accountJson(request('{}', { 'Content-Type': type }))).rejects.toThrow('body');
  });

  it('rejects a foreign origin before consuming the request body', async () => {
    const req = request('{"companyName":"Forbidden"}', { Origin: 'https://attacker.example' });
    await expect(accountJson(req)).rejects.toThrow('origin');
    expect(req.bodyUsed).toBe(false);
  });

  it('accepts exactly 4096 UTF-8 bytes and rejects the next byte without relying on Content-Length', async () => {
    const exact = jsonOfSize(4096), oversized = jsonOfSize(4097);
    expect(Buffer.byteLength(exact)).toBe(4096);
    expect(await accountJson(request(exact))).toEqual(JSON.parse(exact));
    await expect(accountJson(request(oversized, { 'Content-Length': '0' }))).rejects.toThrow('body');
  });

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const body = JSON.stringify({ text: '🏡'.repeat(1022) });
    expect(body.length).toBeLessThan(4096); expect(Buffer.byteLength(body)).toBeGreaterThan(4096);
    await expect(accountJson(request(body))).rejects.toThrow('body');
  });

  it('cancels an oversized chunked body and releases its reader', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3000)); controller.enqueue(new Uint8Array(1097)); }, cancel,
    });
    const req = new Request(ingress, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    await expect(accountJson(req)).rejects.toThrow('body');
    expect(cancel).toHaveBeenCalledOnce();
    expect(req.body?.locked).toBe(false);
  });

  it('rejects absent or malformed JSON and does not retain a stream lock after parse errors', async () => {
    await expect(accountJson(request(null))).rejects.toThrow('body');
    const malformed = request('{"not-complete":');
    await expect(accountJson(malformed)).rejects.toThrow();
    expect(malformed.body?.locked).toBe(false);
  });

  it('marks account responses private from reusable caches', async () => {
    const response = accountResponse({ message: 'Check your email.' }, 202);
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ message: 'Check your email.' });
  });
});
