import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
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
const safeEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'CI', 'PLAYWRIGHT_BROWSERS_PATH'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
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
let started = false, server, output;
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
  const origin = `http://127.0.0.1:${appPort}`;
  const env = {
    ...safeEnv, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: `postgresql://propbrew_review_app@127.0.0.1:${pgPort}/postgres`,
    DATA_SOURCE: 'postgres', PROPBREW_AUTH_MODE: 'company', PROPBREW_REVIEW_MODE: '0', PROPBREW_WEBSITE_ONLY: '0',
    PROPBREW_DEMO_ACCOUNTS: '1', PROPBREW_DEMO_PASSWORD: demoPassword,
    BETTER_AUTH_URL: origin, NEXT_PUBLIC_SITE_URL: origin, BETTER_AUTH_SECRET: 'disposable-browser-company-account-secret-never-production',
    REEVE_ALLOW_DEMO_IDENTITIES: '0', REEVE_ALLOW_IN_MEMORY_DATA: '0', NEXT_PUBLIC_DEV_IDENTITY: '0',
    CLERK_SECRET_KEY: '', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', BLOB_READ_WRITE_TOKEN: '',
  };
  output = openSync(join(directory, 'next.log'), 'w', 0o600);
  server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: app, env, detached: true, stdio: ['ignore', output, output] });
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try { const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(2000) }); if (response.ok) { ready = true; break; } } catch { /* startup is still in progress */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  if (!ready) throw new Error('The disposable native-account app did not become ready.');
  if (safeEnv.CI) {
    // A shared CI runner compiles dev routes far too slowly to finish inside
    // test interaction timeouts, so compile every route the workflows visit
    // up front. Dynamic segments compile per route pattern; a placeholder id
    // still triggers the compilation even though the record does not exist.
    const routes = [
      '/', '/login', '/sign-up', '/onboarding', '/workspaces',
      '/estate', '/properties', '/facility', '/shortlet', '/construction',
      '/assets', '/billing', '/bookings', '/companies', '/company/team', '/inspections',
      '/inventory', '/people', '/ppm', '/spaces', '/tenancy', '/work-orders',
      '/shortlet/bookings', '/shortlet/properties',
      '/construction/projects', '/construction/digest', '/construction/documents',
      '/construction/field', '/construction/operations',
      '/construction/projects/prewarm', '/construction/projects/prewarm/setup', '/construction/projects/prewarm/lifecycle',
      '/construction/portal/client', '/construction/portal/consultant', '/construction/portal/field', '/construction/portal/subcontractor',
      '/properties/prewarm', '/properties/prewarm/units',
      '/facility/sites/prewarm', '/facility/sites/prewarm/assets',
      '/work-orders/prewarm', '/estate/work-orders/prewarm',
      '/shortlet/properties/prewarm', '/shortlet/properties/prewarm/rooms',
      '/invite/prewarm', '/api/auth/ok',
    ];
    for (const route of routes) {
      try { await fetch(`${origin}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) }); } catch { /* the compilation, not the response, is the point */ }
    }
  }
  await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.company-auth.config.ts', ...process.argv.slice(2)], { cwd: root, visible: true, env: { ...safeEnv, PW_COMPANY_BASE_URL: origin } });
} catch (error) {
  const log = await readFile(join(directory, 'next.log'), 'utf8').catch(() => '');
  if (log) console.error(log.slice(-6000));
  throw error;
} finally {
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
