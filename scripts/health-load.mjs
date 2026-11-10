import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const LIMITS = Object.freeze({ concurrency: 20, durationMs: 10_000, requests: 200, timeoutMs: 2_000 });

function boundedInteger(value, fallback, maximum, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

export function healthLoadOptions(env = process.env) {
  const target = env.PROPBREW_LOAD_TARGET;
  if (!['loopback', 'staging', 'production'].includes(target)) {
    throw new Error('The target must be loopback, staging or production.');
  }
  if (env.PROPBREW_LOAD_CONFIRM !== `${target === 'loopback' ? 'local' : target}-health-only`) {
    throw new Error('Confirmation must explicitly approve a read-only health smoke for the selected target.');
  }
  if (!env.PROPBREW_LOAD_BASE_URL) throw new Error('PROPBREW_LOAD_BASE_URL is required; no target is inferred.');
  const base = new URL(env.PROPBREW_LOAD_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('The load base URL must be an HTTP(S) origin without credentials, query or fragment.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (target === 'loopback' && !loopback) throw new Error('A loopback target must use localhost, 127.0.0.1 or [::1].');
  if (base.protocol !== 'https:' && !loopback) throw new Error('Remote health smoke requires HTTPS; no insecure remote target is allowed.');
  return {
    // The method and path are fixed: callers cannot turn this into a mutation
    // harness or aim it at sync, payment, reconciliation or queue endpoints.
    url: new URL('/api/v1/health', base.origin).href,
    target,
    concurrency: boundedInteger(env.PROPBREW_LOAD_CONCURRENCY, LIMITS.concurrency, LIMITS.concurrency, 'PROPBREW_LOAD_CONCURRENCY'),
    durationMs: boundedInteger(env.PROPBREW_LOAD_DURATION_MS, LIMITS.durationMs, LIMITS.durationMs, 'PROPBREW_LOAD_DURATION_MS'),
    maxRequests: boundedInteger(env.PROPBREW_LOAD_MAX_REQUESTS, LIMITS.requests, LIMITS.requests, 'PROPBREW_LOAD_MAX_REQUESTS'),
    timeoutMs: boundedInteger(env.PROPBREW_LOAD_TIMEOUT_MS, LIMITS.timeoutMs, LIMITS.timeoutMs, 'PROPBREW_LOAD_TIMEOUT_MS'),
  };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export async function runHealthLoad(env = process.env) {
  const options = healthLoadOptions(env);
  const startedAt = new Date().toISOString();
  const started = performance.now(), deadline = started + options.durationMs;
  const results = [];
  let issued = 0;
  async function worker() {
    while (issued < options.maxRequests && performance.now() < deadline) {
      const request = ++issued;
      const requestStarted = performance.now();
      let status = 0, error, validPayload = false;
      try {
        const response = await fetch(options.url, {
          method: 'GET',
          headers: { Accept: 'application/json', 'User-Agent': 'propbrew-health-smoke/1' },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        status = response.status;
        const body = await response.json();
        validPayload = body?.ok === true && body?.service === 'reeve-api' && body?.version === 'v1';
      } catch (cause) {
        error = cause instanceof Error ? cause.name : 'RequestError';
      }
      results.push({ request, status, error, validPayload, latencyMs: performance.now() - requestStarted });
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const wallMs = performance.now() - started;
  const latencies = results.map(({ latencyMs }) => latencyMs).sort((a, b) => a - b);
  const milliseconds = (value) => Number(value.toFixed(3));
  const statusCounts = Object.fromEntries([...new Set(results.map(({ status }) => status))].sort((a, b) => a - b).map((status) => [String(status), results.filter((result) => result.status === status).length]));
  const errors = results.filter(({ error }) => error).map(({ request, error }) => ({ request, error }));
  const invalidPayloads = results.filter(({ validPayload, error }) => !validPayload && !error).map(({ request }) => request);
  const passed = results.length > 0 && results.every(({ status, validPayload }) => status === 200 && validPayload);
  return {
    check: 'bounded-public-health-smoke',
    result: passed ? 'passed' : 'failed',
    startedAt,
    target: options.target,
    url: options.url,
    limits: LIMITS,
    configuration: options,
    wallMs: milliseconds(wallMs),
    requests: results.length,
    requestsPerSecond: milliseconds(results.length / (wallMs / 1000)),
    statusCounts,
    errors,
    invalidPayloads,
    latencyMs: {
      mean: milliseconds(latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1)),
      p50: milliseconds(percentile(latencies, 0.50)),
      p95: milliseconds(percentile(latencies, 0.95)),
      p99: milliseconds(percentile(latencies, 0.99)),
      max: milliseconds(latencies.at(-1) ?? 0),
    },
    note: 'This local or explicitly targeted health-only smoke is not staging acceptance for sync, payment webhooks, reconciliation or queue processing, and has no production-capacity sign-off.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runHealthLoad();
    console.log(JSON.stringify(report, null, 2));
    if (report.result !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Health smoke configuration failed.');
    process.exitCode = 2;
  }
}
