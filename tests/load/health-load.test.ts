import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/health-load.mjs', import.meta.url));
const servers = new Set<ReturnType<typeof createServer>>();
afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  servers.clear();
});

function configuration(base: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PROPBREW_LOAD_BASE_URL: base,
    PROPBREW_LOAD_TARGET: 'loopback',
    PROPBREW_LOAD_CONFIRM: 'local-health-only',
    PROPBREW_LOAD_CONCURRENCY: '4',
    PROPBREW_LOAD_MAX_REQUESTS: '9',
  };
}

describe('bounded health load smoke', () => {
  it('issues real capped GET requests and records status and latency distribution', async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url });
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, service: 'reeve-api', version: 'v1' }));
      }, 5);
    });
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address.');
    const { stdout, stderr } = await execute(process.execPath, [script], { env: configuration(`http://127.0.0.1:${address.port}`) });
    expect(stderr).toBe('');
    const report = JSON.parse(stdout);
    expect(report.result).toBe('passed');
    expect(report.requests).toBe(9);
    expect(report.statusCounts).toEqual({ '200': 9 });
    expect(report.errors).toEqual([]);
    expect(report.invalidPayloads).toEqual([]);
    expect(report.limits).toEqual({ concurrency: 20, durationMs: 10_000, requests: 200, timeoutMs: 2_000 });
    expect(report.configuration.concurrency).toBe(4);
    expect(report.configuration.maxRequests).toBe(9);
    expect(report.latencyMs.max).toBeGreaterThanOrEqual(report.latencyMs.p99);
    expect(report.latencyMs.p99).toBeGreaterThanOrEqual(report.latencyMs.p95);
    expect(report.latencyMs.p95).toBeGreaterThanOrEqual(report.latencyMs.p50);
    expect(report.latencyMs.p50).toBeGreaterThan(0);
    expect(requests).toHaveLength(9);
    expect(requests.every(({ method, url }) => method === 'GET' && url === '/api/v1/health')).toBe(true);
  }, 15_000);

  it('rejects missing targets and attempts to exceed the hard request cap', async () => {
    await expect(execute(process.execPath, [script], { env: { NODE_ENV: 'test', PATH: process.env.PATH } })).rejects.toMatchObject({ code: 2 });
    await expect(execute(process.execPath, [script], {
      env: { ...configuration('https://app.usepropbrew.com'), PROPBREW_LOAD_TARGET: 'production', PROPBREW_LOAD_CONFIRM: 'production-health-only', PROPBREW_LOAD_MAX_REQUESTS: '201' },
    })).rejects.toMatchObject({ code: 2 });
  });
});
