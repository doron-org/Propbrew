import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { closeSync, constants, existsSync, openSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from './migrate.mjs';

// Own the database, app copy and ports. No .env file, deployed data, provider
// credential or existing development/build directory is read or modified.
const root = process.cwd();
const directory = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'propbrew-company-browser-'));
const data = join(directory, 'pg');
const app = join(directory, 'app');
// initdb uses --no-locale; do not pass an unsupported inherited locale to the
// PostgreSQL child (macOS otherwise aborts with a multithreaded-startup error).
const safeEnv = {
  ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'CI', 'PLAYWRIGHT_BROWSERS_PATH'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
  LANG: 'C',
  LC_ALL: 'C',
};
function program(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (process.platform === 'darwin' && existsSync(homebrew)) return homebrew;
  // Ubuntu keeps server executables outside PATH, even when psql is available.
  try {
    const binary = join(execFileSync('pg_config', ['--bindir'], { env: safeEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), name);
    if (existsSync(binary)) return binary;
  } catch { /* a normal PATH installation does not need pg_config */ }
  return name;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env: safeEnv, stdio: options.visible ? 'inherit' : ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout?.on('data', (part) => { output += part; }); child.stderr?.on('data', (part) => { output += part; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveRun() : reject(new Error(`${command.split('/').at(-1)} failed (${code}). ${output.slice(-3000)}`)));
  });
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createServer(); socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const address = socket.address(); socket.close(() => resolvePort(address.port)); });
  });
}
let started = false, server, output, tls;
try {
  const pgPort = await freePort(), appPort = await freePort();
  await run(program('initdb'), ['-D', data, '-U', 'propbrew_company_browser_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  await run(program('pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, '-w', 'start']);
  started = true;
  const adminUrl = `postgresql://propbrew_company_browser_admin@127.0.0.1:${pgPort}/postgres`;
  const demoPassword = randomBytes(32).toString('base64url');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('create role propbrew_review_app login nosuperuser nocreatedb nocreaterole nobypassrls');
    await admin.query('grant usage on schema public to propbrew_review_app');
    await runMigrations({ url: adminUrl });
  } finally { await admin.end(); }
  const demoState = join(directory, 'source-demo-state.json');
  await run(process.execPath, ['scripts/provision-demo-accounts.mjs', '--write-state', demoState], { cwd: root });
  await run(process.execPath, ['scripts/provision-demo-accounts.mjs', '--confirm-demo-seed', '--state-file', demoState, '--database-env', 'PROPBREW_TEST_DEMO_ADMIN_URL'], {
    cwd: root, env: { ...safeEnv, PROPBREW_TEST_DEMO_ADMIN_URL: adminUrl, PROPBREW_DEMO_ACCOUNTS: '1', PROPBREW_DEMO_PASSWORD: demoPassword, PROPBREW_DATABASE_REGION: 'Disposable loopback browser tests' },
  });
  for (const name of ['src', 'public']) await cp(join(root, name), join(app, name), { recursive: true, mode: constants.COPYFILE_FICLONE });
  // Next generates next-env.d.ts itself; it is absent in a clean Git checkout.
  for (const name of ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs']) await cp(join(root, name), join(app, name));
  await symlink(resolve(root, 'node_modules'), join(app, 'node_modules'), 'dir');
  // A shared CI runner cannot keep up with dev-mode compilation, so CI builds
  // once and serves the production bundle instead. The bundle hard-requires an
  // HTTPS account origin, which a plain loopback server cannot provide, so a
  // self-signed TLS proxy fronts it. Local runs keep the fast dev server.
  const production = Boolean(safeEnv.CI);
  const tlsPort = production ? await freePort() : 0;
  const origin = production ? `https://127.0.0.1:${tlsPort}` : `http://127.0.0.1:${appPort}`;
  const env = {
    ...safeEnv, NODE_ENV: production ? 'production' : 'development', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: `postgresql://propbrew_review_app@127.0.0.1:${pgPort}/postgres`,
    DATA_SOURCE: 'postgres', PROPBREW_AUTH_MODE: 'company', PROPBREW_REVIEW_MODE: '0', PROPBREW_WEBSITE_ONLY: '0',
    PROPBREW_DEMO_ACCOUNTS: '1', PROPBREW_DEMO_PASSWORD: demoPassword,
    BETTER_AUTH_URL: origin, NEXT_PUBLIC_SITE_URL: origin, BETTER_AUTH_SECRET: 'disposable-browser-company-account-secret-never-production',
    REEVE_ALLOW_DEMO_IDENTITIES: '0', REEVE_ALLOW_IN_MEMORY_DATA: '0', NEXT_PUBLIC_DEV_IDENTITY: '0',
    CLERK_SECRET_KEY: '', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', BLOB_READ_WRITE_TOKEN: '',
  };
  if (production) {
    const keyFile = join(directory, 'tls.key'), certFile = join(directory, 'tls.crt');
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1']);
    // The build receives only the client-inlined values: handing it runtime
    // database/auth settings breaks static prerendering of public pages, and
    // server settings are still read per request at start time.
    const buildEnv = {
      ...safeEnv, NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SITE_URL: origin, NEXT_PUBLIC_DEV_IDENTITY: '0', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    };
    await run(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: app, env: buildEnv, visible: true });
  }
  output = openSync(join(directory, 'next.log'), 'w', 0o600);
  server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), ...(production ? ['start'] : ['dev', '--webpack']), '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: app, env, detached: true, stdio: ['ignore', output, output] });
  if (production) {
    tls = createTlsServer({ key: await readFile(join(directory, 'tls.key')), cert: await readFile(join(directory, 'tls.crt')) }, (request, response) => {
      const upstream = httpRequest({ host: '127.0.0.1', port: appPort, path: request.url, method: request.method, headers: request.headers }, (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.pipe(upstream);
    });
    await new Promise((resolveListen, rejectListen) => { tls.once('error', rejectListen); tls.listen(tlsPort, '127.0.0.1', resolveListen); });
  }
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try { const response = await fetch(`http://127.0.0.1:${appPort}/api/v1/health`, { signal: AbortSignal.timeout(2000) }); if (response.ok) { ready = true; break; } } catch { /* startup is still in progress */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  if (!ready) throw new Error('The disposable native-account app did not become ready.');
  await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.company-auth.config.ts', ...process.argv.slice(2)], { cwd: root, visible: true, env: { ...safeEnv, PW_COMPANY_BASE_URL: origin } });
} catch (error) {
  // Database startup can fail before the Next.js log exists. Surface both logs
  // so a disposable-browser failure is diagnosable rather than a bare pg_ctl exit.
  for (const name of ['postgres.log', 'next.log']) {
    const log = await readFile(join(directory, name), 'utf8').catch(() => '');
    if (log) console.error(`${name}:\n${log.slice(-6000)}`);
  }
  throw error;
} finally {
  tls?.close();
  if (server?.pid && server.exitCode === null) {
    const stopped = new Promise((resolveStop) => server.once('exit', resolveStop));
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ }
    await Promise.race([stopped, new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
    if (server.exitCode === null) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already stopped */ }
  }
  if (output !== undefined) closeSync(output);
  if (started) await run(program('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
