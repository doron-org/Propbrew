import { createHmac, randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../scripts/migrate.mjs';
import { getNativeAuth } from '@/server/auth/auth';
import { authDatabasePool, withAuthTransaction } from '@/server/auth/database';
import {
  activateCompany, companyPrincipalFor, getCompanyPrincipal, invitationHash, listCompanies,
  newInvitationToken, provisionCompany, recheckCompanyMembership, withCompanyManagement,
  type CompanyPrincipal, type NativeIdentity,
} from '@/server/auth/company';
import { canUseCompanyModule } from '@/lib/auth/company-policy';
import { hashPassword } from 'better-auth/crypto';
import { DEMO_ACCOUNTS, DEMO_TENANT_ID } from '@/server/auth/demo-config';

const request = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { request.cookies.set(name, value); },
    delete: (name: string) => { request.cookies.delete(name); },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// This suite must never be pointed at a deployed or application database.
const testUrl = process.env.PROPBREW_TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) {
  throw new Error('Company integration tests require a disposable loopback database.');
}
const origin = 'https://company-integration.example';
const password = 'Local-test-passphrase-4-module!';
const role = 'propbrew_review_app';
const runId = randomUUID().slice(0, 8);
type Browser = { cookies: Map<string, string>; identity: NativeIdentity; email: string };
let admin: Client;
let ownerA: Browser;
let ownerB: Browser;
let recipient: Browser;
let outsider: Browser;
let companyA: string;
let companyB: string;
let ownerPrincipal: CompanyPrincipal;
let demoVisitor: Browser;
const demoPassword = 'Disposable-native-demo-password-123456789!';

function cookieHeader(browser: Pick<Browser, 'cookies'>): string {
  return [...browser.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** An independent authenticator: the enrollment URI uses a base32-encoded key. */
function totpCode(encoded: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const decoded: number[] = [];
  for (const character of encoded.toUpperCase().replaceAll('=', '')) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { decoded.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1)! & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function http(browser: Pick<Browser, 'cookies'>, path: string, body?: Record<string, unknown>) {
  const headers = new Headers({ origin, 'x-forwarded-for': '127.0.0.1', cookie: cookieHeader(browser) });
  if (body) headers.set('content-type', 'application/json');
  const response = await getNativeAuth().handler(new Request(`${origin}/api/auth${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
  }));
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator), value = pair.slice(separator + 1);
    if (/max-age=0(?:;|$)/i.test(cookie) || !value) browser.cookies.delete(name);
    else browser.cookies.set(name, value);
  }
  const data = await response.json();
  return { response, data };
}

async function signup(label: string): Promise<Browser> {
  const browser = { cookies: new Map<string, string>() };
  const email = `${label}-${runId}@example.test`;
  const result = await http(browser, '/sign-up/email', {
    name: `Disposable ${label}`, email, password,
    // Neither identity privilege nor selected company may be client supplied.
    role: 'owner', modules: { estate: 'manage' }, activeCompanyId: randomUUID(), twoFactorEnabled: true,
  });
  expect(result.response.status).toBe(200);
  const session = await http(browser, '/get-session');
  expect(session.response.status).toBe(200);
  expect(session.data.user.email).toBe(email);
  expect(session.data.session.activeCompanyId ?? null).toBeNull();
  expect(session.data.user.twoFactorEnabled).toBe(false);
  return { ...browser, identity: session.data as NativeIdentity, email };
}

async function selectedPrincipal(browser: Browser, companyId: string) {
  await activateCompany(browser.identity, companyId);
  const session = await http(browser, '/get-session');
  browser.identity = session.data as NativeIdentity;
  const principal = await companyPrincipalFor(browser.identity);
  expect(principal?.company.id).toBe(companyId);
  return principal!;
}

async function invite(email: string, modules: Record<string, string> = { estate: 'view', facility: 'manage' }, extra = '') {
  const token = newInvitationToken();
  const result = await withCompanyManagement(ownerPrincipal, (client) => client.query(
    `insert into company_invitations(tenant_id,email,token_hash,company_role,modules,created_by,expires_at${extra ? ',cancelled_at' : ''})
     values($1::uuid,$2,$3,'member',$4::jsonb,$5::uuid,now()+interval '1 day'${extra ? ',now()' : ''}) returning id`,
    [companyA, email, token.hash, JSON.stringify(modules), ownerA.identity.user.id],
  ));
  return { ...token, id: result.rows[0].id as string };
}

/** Explicit synthetic fixture in this suite's disposable loopback database.
 * Public demo provisioning never borrows an existing company or review record. */
async function createDemoVisitor(): Promise<Browser> {
  vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '1');
  vi.stubEnv('PROPBREW_DEMO_PASSWORD', demoPassword);
  const account = DEMO_ACCOUNTS[0];
  await admin.query('insert into auth_users(id,name,email,"createdAt","updatedAt") values($1::uuid,$2,$3,now(),now())', [account.userId, account.name, account.email]);
  await admin.query('insert into auth_accounts("accountId","providerId","userId",password,"createdAt","updatedAt") values($1::text,$2,$1::uuid,$3,now(),now())', [account.userId, 'credential', await hashPassword(demoPassword)]);
  await admin.query('insert into tenants(id,name,country_code,data_residency,created_by_auth_user) values($1::uuid,$2,$3,$4,$5::uuid)', [DEMO_TENANT_ID, 'Disposable public demo', 'NG', 'Disposable loopback', account.userId]);
  await admin.query("insert into company_memberships(tenant_id,user_id,company_role,modules) values($1::uuid,$2::uuid,'member',$3::jsonb)", [DEMO_TENANT_ID, account.userId, JSON.stringify({ estate: 'view', facility: 'view', shortlet: 'view', construction: 'view' })]);
  const { blankCompanyWorkspaceState } = await import('@/server/data/store');
  await admin.query('insert into workspace_records(tenant_id,domain_tenant_id,payload) values($1::uuid,$1::text,$2::jsonb)', [DEMO_TENANT_ID, JSON.stringify(blankCompanyWorkspaceState())]);
  const browser = { cookies: new Map<string, string>() };
  const signedIn = await http(browser, '/sign-in/email', { email: account.email, password: demoPassword, rememberMe: false });
  expect(signedIn.response.status).toBe(200);
  const session = await http(browser, '/get-session');
  const result = { ...browser, identity: session.data as NativeIdentity, email: account.email };
  expect(await companyPrincipalFor(result.identity)).not.toBeNull();
  result.identity = (await http(result, '/get-session')).data as NativeIdentity;
  return result;
}

describe.skipIf(!testUrl)('native company accounts with real restricted PostgreSQL and Better Auth', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} login nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$`);
    await admin.query(`grant usage on schema public to ${role}`);
    await runMigrations({ url: testUrl });
    const url = new URL(testUrl!); url.username = role;
    for (const [name, value] of Object.entries({
      DATABASE_URL: url.toString(), DATA_SOURCE: 'postgres', PROPBREW_AUTH_MODE: 'company',
      PROPBREW_REVIEW_MODE: '0', NODE_ENV: 'production', BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'disposable-company-account-secret-32-characters',
      NEXT_PUBLIC_SITE_URL: origin, PROPBREW_AUTH_ORIGINS: '', REEVE_ALLOW_DEMO_IDENTITIES: '',
      REEVE_ALLOW_IN_MEMORY_DATA: '', NEXT_PUBLIC_DEV_IDENTITY: '',
    })) vi.stubEnv(name, value);
    ownerA = await signup('owner-a');
    ownerB = await signup('owner-b');
    recipient = await signup('recipient');
    outsider = await signup('outsider');
    companyA = await provisionCompany(ownerA.identity, 'Disposable Lagos company');
    companyB = await provisionCompany(ownerB.identity, 'Disposable Abuja company');
    ownerPrincipal = await selectedPrincipal(ownerA, companyA);
  }, 30_000);

  afterAll(async () => {
    request.headers = new Headers();
    const global = globalThis as typeof globalThis & {
      __propbrewAuthPool?: { pool: Pool }; __propbrewPgPool?: { pool: Pool }; __propbrewNativeAuth?: unknown;
    };
    await global.__propbrewAuthPool?.pool.end();
    await global.__propbrewPgPool?.pool.end();
    delete global.__propbrewAuthPool; delete global.__propbrewPgPool; delete global.__propbrewNativeAuth;
    vi.unstubAllEnvs();
    await admin?.end();
  });

  it('runs the application as a non-owner, non-superuser role with forced RLS', async () => {
    const runtime = await authDatabasePool().query('select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user');
    expect(runtime.rows).toEqual([{ current_user: role, rolsuper: false, rolbypassrls: false }]);
    const tables = await admin.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('company_memberships','company_invitations','tenants','workspace_records','auth_security_events')");
    expect(tables.rows).toHaveLength(5);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('creates each owner, four module controls and completely blank company data atomically', async () => {
    const workspaces = await admin.query('select tenant_id,domain_tenant_id,payload from workspace_records where tenant_id=any($1::uuid[])', [[companyA, companyB]]);
    expect(workspaces.rows).toHaveLength(2);
    for (const row of workspaces.rows) {
      expect(row.domain_tenant_id).toBe(row.tenant_id);
      expect(Object.keys(row.payload.collections)).toHaveLength(106);
      for (const [key, value] of Object.entries(row.payload.collections)) {
        if (key === 'shortletPlanKey') expect(value).toBe('lite');
        else if (key === 'shortletBookingPage') expect(value).toEqual({ enabled: false, slug: 'portfolio', cancellationPolicy: '', holdHours: 0, promoCodes: [] });
        else expect(value).toEqual([]);
      }
      expect(row.payload.history).toEqual({}); expect(row.payload.auxiliary).toEqual({}); expect(row.payload.sequences).toEqual({});
      expect(JSON.stringify(row.payload)).not.toMatch(/t-lekki|ngoz|dangote|seed-row|sample road/i);
    }
    expect((await admin.query('select tenant_id,count(*)::int n from ai_feature_controls where tenant_id=any($1::uuid[]) group by tenant_id', [[companyA, companyB]])).rows).toEqual(expect.arrayContaining([{ tenant_id: companyA, n: 4 }, { tenant_id: companyB, n: 4 }]));
    expect(ownerPrincipal.actor.companyAccess).toMatchObject({ companyRole: 'owner', modules: { estate: 'manage', facility: 'manage', shortlet: 'manage', construction: 'manage' } });
    expect(ownerPrincipal.actor.roles).not.toContain('platform_admin');
    expect((await admin.query("select count(*)::int n from audit_events where tenant_id=any($1::uuid[]) and action='company.created'", [[companyA, companyB]])).rows[0].n).toBe(2);
  });

  it('rolls back company, membership, AI controls and audit when workspace creation fails', async () => {
    const name = `Atomic rollback ${runId}`;
    await admin.query(`create function reject_disposable_company_workspace() returns trigger language plpgsql as $$ begin if exists(select from tenants where id=new.tenant_id and name like 'Atomic rollback %') then raise exception 'disposable injected failure'; end if; return new; end $$`);
    await admin.query('create trigger reject_disposable_company_workspace before insert on workspace_records for each row execute function reject_disposable_company_workspace()');
    try {
      await expect(provisionCompany(ownerA.identity, name)).rejects.toThrow('disposable injected failure');
      expect((await admin.query('select id from tenants where name=$1', [name])).rows).toEqual([]);
      expect((await admin.query('select count(*)::int n from company_memberships where user_id=$1::uuid', [ownerA.identity.user.id])).rows[0].n).toBe(1);
      expect((await admin.query('select "activeCompanyId" from auth_sessions where id=$1::uuid', [ownerA.identity.session.id])).rows[0].activeCompanyId).toBe(companyA);
    } finally {
      await admin.query('drop trigger reject_disposable_company_workspace on workspace_records');
      await admin.query('drop function reject_disposable_company_workspace()');
    }
  });

  it('loads fresh server-owned company membership and rejects another company or forged privilege fields', async () => {
    expect(await listCompanies(ownerA.identity)).toEqual([{ id: companyA, name: 'Disposable Lagos company', role: 'owner', modules: ['estate', 'facility', 'shortlet', 'construction'] }]);
    await expect(activateCompany(ownerA.identity, companyB)).rejects.toThrow('unavailable');
    expect(await companyPrincipalFor({ ...ownerA.identity, session: { ...ownerA.identity.session, activeCompanyId: companyB } })).toBeNull();
    expect(await companyPrincipalFor({ ...ownerA.identity, session: { ...ownerA.identity.session, activeCompanyId: 'not-a-uuid' } })).toBeNull();
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    expect((await getCompanyPrincipal())?.actor.userId).toBe(ownerA.identity.user.id);
    expect((await getCompanyPrincipal())?.company.id).toBe(companyA);
    request.headers = new Headers();
    expect(await getCompanyPrincipal()).toBeNull();
  });

  it('isolates company directories and workspace rows and rejects cross-tenant writes at RLS', async () => {
    const own = await withAuthTransaction(ownerA.identity.user.id, async (client) => {
      expect((await client.query('select tenant_id from company_memberships')).rows).toEqual([{ tenant_id: companyA }]);
      expect((await client.query('select id from tenants')).rows).toEqual([{ id: companyA }]);
      await client.query("select set_config('app.tenant_id',$1,true)", [companyA]);
      expect((await client.query('select tenant_id from workspace_records')).rows).toEqual([{ tenant_id: companyA }]);
      return (await client.query('update workspace_records set version=version+1 where tenant_id=$1::uuid', [companyB])).rowCount;
    });
    expect(own).toBe(0);
    expect((await authDatabasePool().query('select id from company_memberships')).rows).toEqual([]);
    await expect(withAuthTransaction(ownerA.identity.user.id, async (client) => {
      await client.query("select set_config('app.tenant_id',$1,true)", [companyA]);
      await client.query('insert into workspace_records(tenant_id,domain_tenant_id,payload) select $1::uuid,$1,payload from workspace_records where tenant_id=$2::uuid', [companyB, companyA]);
    })).rejects.toThrow(/row-level security/i);
  });

  it('keeps passwords hashed and records durable identity and session events', async () => {
    const account = (await admin.query('select password from auth_accounts where "userId"=$1::uuid', [ownerA.identity.user.id])).rows[0];
    expect(typeof account.password).toBe('string'); expect(account.password.length).toBeGreaterThan(80);
    expect(account.password).not.toContain(password);
    const events = await withAuthTransaction(ownerA.identity.user.id, (client) => client.query('select event from auth_security_events'));
    expect(events.rows).toEqual(expect.arrayContaining([{ event: 'account.created' }, { event: 'session.created' }]));
    expect((await withAuthTransaction(ownerB.identity.user.id, (client) => client.query('select user_id from auth_security_events where user_id=$1::uuid', [ownerA.identity.user.id]))).rows).toEqual([]);
    const fresh = { cookies: new Map<string, string>() };
    expect((await http(fresh, '/sign-in/email', { email: ownerA.email, password: 'incorrect-passphrase-123' })).response.status).toBe(401);
    expect((await http(fresh, '/sign-in/email', { email: ownerA.email, password })).response.status).toBe(200);
    expect((await http(fresh, '/get-session')).data.user.id).toBe(ownerA.identity.user.id);
  });

  it('shares signup attempt limits between raw HTTP and server-side auth calls', async () => {
    const anonymous = { cookies: new Map<string, string>() };
    const body = { name: 'Duplicate disposable owner', email: ownerA.email, password };
    for (let attempt = 0; attempt < 2; attempt++) expect((await http(anonymous, '/sign-up/email', body)).response.status).toBe(422);
    for (let attempt = 0; attempt < 2; attempt++) await expect(getNativeAuth().api.signUpEmail({ body })).rejects.toThrow();
    expect((await http(anonymous, '/sign-up/email', body)).response.status).toBe(429);
    const counters = (await admin.query("select key,count from auth_action_limits where key like 'signup-email:%'")).rows;
    expect(counters.some((row) => row.count === 6)).toBe(true);
    expect(counters.some((row) => row.key.includes(ownerA.email))).toBe(false);
  });

  it('stores only invitation hashes, hides wrong-email lookups and atomically consumes an invitation once', async () => {
    const invitation = await invite(recipient.email.toUpperCase());
    expect(invitation.hash).toBe(invitationHash(invitation.token));
    expect((await admin.query('select token_hash from company_invitations where id=$1', [invitation.id])).rows).toEqual([{ token_hash: invitation.hash }]);
    expect((await withAuthTransaction(outsider.identity.user.id, (client) => client.query('select * from company_invitation_for_token($1)', [invitation.hash]))).rows).toEqual([]);
    await expect(withAuthTransaction(outsider.identity.user.id, (client) => client.query('select accept_company_invitation($1)', [invitation.hash]))).rejects.toThrow('unavailable');
    expect((await withAuthTransaction(recipient.identity.user.id, (client) => client.query('select company_name from company_invitation_for_token($1)', [invitation.hash]))).rows).toEqual([{ company_name: 'Disposable Lagos company' }]);
    const accepted = await Promise.allSettled([1, 2].map(() => withAuthTransaction(recipient.identity.user.id, (client) => client.query('select accept_company_invitation($1) company', [invitation.hash]))));
    expect(accepted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(accepted.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await admin.query('select count(*)::int n from company_memberships where tenant_id=$1::uuid and user_id=$2::uuid', [companyA, recipient.identity.user.id])).rows[0].n).toBe(1);
    expect((await admin.query("select count(*)::int n from audit_events where tenant_id=$1::uuid and actor_subject=$2 and action='company.invitation.accepted'", [companyA, recipient.identity.user.id])).rows[0].n).toBe(1);
    const principal = await selectedPrincipal(recipient, companyA);
    expect(principal.membership.companyRole).toBe('member');
    expect(canUseCompanyModule(principal.actor, 'estate', 'read')).toBe(true);
    expect(canUseCompanyModule(principal.actor, 'estate', 'create')).toBe(false);
    expect(canUseCompanyModule(principal.actor, 'facility', 'create')).toBe(true);
    expect(canUseCompanyModule(principal.actor, 'shortlet', 'read')).toBe(false);
    await expect(withCompanyManagement(principal, async () => true)).rejects.toThrow('Only company owners');
  });

  it('rejects cancelled and expired invitations without adding membership', async () => {
    const cancelled = await invite(outsider.email, {}, 'cancelled');
    const expired = await invite(outsider.email);
    await admin.query("update company_invitations set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    for (const invitation of [cancelled, expired]) {
      await expect(withAuthTransaction(outsider.identity.user.id, (client) => client.query('select accept_company_invitation($1)', [invitation.hash]))).rejects.toThrow('unavailable');
      expect((await withAuthTransaction(outsider.identity.user.id, (client) => client.query('select * from company_invitation_for_token($1)', [invitation.hash]))).rows).toEqual([]);
    }
    expect((await admin.query('select id from company_memberships where tenant_id=$1::uuid and user_id=$2::uuid', [companyA, outsider.identity.user.id])).rows).toEqual([]);
  });

  it('enforces mixed module grants before entering a durable write and binds reads to the selected company', async () => {
    const { withDurableMutation, withDurableRead } = await import('@/server/data/durable-records');
    const { currentRecordContext } = await import('@/server/data/record-context');
    request.headers = new Headers({ cookie: cookieHeader(recipient) });
    const denied = vi.fn(async () => 'must not execute');
    await expect(withDurableMutation(denied, 'estate', 'create')).rejects.toThrow('cannot perform');
    await expect(withDurableMutation(denied, 'shortlet', 'update')).rejects.toThrow('cannot perform');
    const { addEstateProperty } = await import('@/server/actions/estate-registration');
    await expect(addEstateProperty({ name: 'Forbidden viewer property', address: '10 Integration Way, Lagos', unitCount: 1, unitType: 'Apartment', idempotencyKey: randomUUID() })).rejects.toThrow('cannot perform');
    expect(denied).not.toHaveBeenCalled();
    await withDurableMutation(async () => {
      const context = currentRecordContext()!;
      expect(context.domainTenantId).toBe(companyA); expect(context.mode).toBe('write');
      context.state.auxiliary.nativeIntegrationProof = 'persisted only in company A';
    }, 'facility');
    expect(await withDurableRead(async () => currentRecordContext()!.state.auxiliary.nativeIntegrationProof)).toBe('persisted only in company A');
    await selectedPrincipal(ownerB, companyB);
    request.headers = new Headers({ cookie: cookieHeader(ownerB) });
    expect(await withDurableRead(async () => ({
      tenant: currentRecordContext()!.domainTenantId,
      proof: currentRecordContext()!.state.auxiliary.nativeIntegrationProof,
    }))).toEqual({ tenant: companyB, proof: undefined });
    request.headers = new Headers();
  });

  it('persists real Estate and Construction actions from the native session and isolates a fresh second-company request', async () => {
    const { withDurableRead } = await import('@/server/data/durable-records');
    const { getSession } = await import('@/server/session');
    const { repos } = await import('@/server/data');
    const { db } = await import('@/server/data/store');
    const { addEstateProperty } = await import('@/server/actions/estate-registration');
    const { createEstateWorkOrder } = await import('@/server/actions/estate-work-orders');
    const { createProject } = await import('@/server/actions/construction');
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    const session = await getSession();
    expect(session?.key).toBe('company'); expect(session?.actor.tenantId).toBe(companyA);
    const input = { name: 'Native Lagos property', address: '14 Integration Street, Lagos, Nigeria', unitCount: 2, unitType: 'Apartment', idempotencyKey: randomUUID() };
    const property = await addEstateProperty(input);
    expect(property.ok).toBe(true); if (!property.ok) throw new Error(property.error);
    expect(await addEstateProperty(input)).toEqual(property);
    const order = await createEstateWorkOrder({ siteId: property.id, title: 'Inspect native company property', priority: 'routine', idempotencyKey: randomUUID() });
    expect(order.ok).toBe(true);
    expect(await createProject({ name: 'Native company construction', location: 'Lagos', clientName: 'Disposable client', contractNaira: 1000.01, budgetNaira: 900, plannedFinishISO: '2030-01-01', projectType: 'residential', region: 'Lagos, Nigeria' })).toMatchObject({ ok: true });
    const runtime = globalThis as typeof globalThis & { __propbrewPgPool?: { pool: Pool } };
    await runtime.__propbrewPgPool?.pool.end(); delete runtime.__propbrewPgPool;
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    await withDurableRead(async () => {
      const actor = (await getSession())!.actor;
      expect(repos.sites.list(actor).items).toEqual([expect.objectContaining({ id: property.id, tenantId: companyA, name: input.name })]);
      expect(repos.workOrders.list(actor).items).toEqual([expect.objectContaining({ siteId: property.id, tenantId: companyA })]);
      expect(repos.constructionProjects.list(actor).items).toEqual([expect.objectContaining({ tenantId: companyA, contractValue: { minor: 100001, currency: 'NGN' } })]);
      expect(db.units).toHaveLength(2);
    });
    request.headers = new Headers({ cookie: cookieHeader(ownerB) });
    await withDurableRead(async () => {
      const actor = (await getSession())!.actor;
      expect(actor.tenantId).toBe(companyB);
      expect(repos.sites.list(actor).items).toEqual([]);
      expect(repos.workOrders.list(actor).items).toEqual([]);
      expect(repos.constructionProjects.list(actor).items).toEqual([]);
    });
    const before = (await admin.query('select version from workspace_records where tenant_id=$1::uuid', [companyB])).rows[0].version;
    expect(await createEstateWorkOrder({ siteId: property.id, title: 'Forbidden cross-company work', priority: 'routine', idempotencyKey: randomUUID() })).toMatchObject({ ok: false });
    expect((await admin.query('select version from workspace_records where tenant_id=$1::uuid', [companyB])).rows[0].version).toBe(before);
    request.headers = new Headers();
  });

  it('rechecks changed membership versions and observes role/module revocation on a fresh request', async () => {
    const old = await selectedPrincipal(recipient, companyA);
    const actions = await import('@/server/actions/companies');
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    const form = new FormData();
    form.set('memberId', old.membership.membershipId); form.set('companyRole', 'member'); form.set('operationalProfileId', 'auditor');
    expect(await actions.updateCompanyMember(form)).toHaveProperty('message');
    await expect(withAuthTransaction(recipient.identity.user.id, (client) => recheckCompanyMembership(client, old))).rejects.toThrow('access changed');
    const fresh = await companyPrincipalFor(recipient.identity);
    expect(fresh?.membership.version).not.toBe(old.membership.version);
    expect(canUseCompanyModule(fresh!.actor, 'facility', 'read')).toBe(false);
    const selfEscalation = await withAuthTransaction(recipient.identity.user.id, (client) => client.query("update company_memberships set company_role='owner',modules=$1::jsonb where id=$2::uuid", [JSON.stringify({ estate: 'manage' }), old.membership.membershipId]));
    expect(selfEscalation.rowCount).toBe(0);
    expect(await actions.removeCompanyMember(form)).toHaveProperty('message');
    expect(await companyPrincipalFor(recipient.identity)).toBeNull();
    request.headers = new Headers({ cookie: cookieHeader(recipient) });
    expect(await getCompanyPrincipal()).toBeNull();
    const before = (await admin.query('select version from workspace_records where tenant_id=$1::uuid', [companyA])).rows[0].version;
    const { addEstateProperty } = await import('@/server/actions/estate-registration');
    expect(await addEstateProperty({ name: 'Forbidden revoked-member property', address: '12 Integration Street, Lagos', unitCount: 1, unitType: 'Apartment', idempotencyKey: randomUUID() })).toMatchObject({ ok: false });
    expect((await admin.query('select version from workspace_records where tenant_id=$1::uuid', [companyA])).rows[0].version).toBe(before);
    request.headers = new Headers();
    await expect(withAuthTransaction(recipient.identity.user.id, (client) => recheckCompanyMembership(client, fresh!))).rejects.toThrow('access changed');
  });

  it('prevents administrators from promoting themselves to owner or altering owner membership', async () => {
    const membershipId = (await admin.query("update company_memberships set company_role='admin',status='active',modules=$1::jsonb,version=version+1 where tenant_id=$2::uuid and user_id=$3::uuid returning id", [JSON.stringify({ estate: 'manage' }), companyA, recipient.identity.user.id])).rows[0].id;
    await expect(withAuthTransaction(recipient.identity.user.id, (client) => client.query("update company_memberships set company_role='owner' where id=$1::uuid", [membershipId]))).rejects.toThrow(/row-level security/i);
    expect((await withAuthTransaction(recipient.identity.user.id, (client) => client.query("update company_memberships set status='revoked' where id=$1::uuid", [ownerPrincipal.membership.membershipId]))).rowCount).toBe(0);
    expect((await admin.query('select company_role from company_memberships where id=$1::uuid', [membershipId])).rows[0].company_role).toBe('admin');
  });

  it('rejects a suspended company even when the browser session and membership are still active', async () => {
    await admin.query("update tenants set status='suspended' where id=$1::uuid", [companyA]);
    try {
      expect(await companyPrincipalFor(ownerA.identity)).toBeNull();
      await expect(withAuthTransaction(ownerA.identity.user.id, (client) => recheckCompanyMembership(client, ownerPrincipal))).rejects.toThrow('access changed');
    } finally { await admin.query("update tenants set status='active' where id=$1::uuid", [companyA]); }
  });

  it('authenticates company API requests and lists only the signed-in account companies', async () => {
    const route = await import('@/app/api/companies/route');
    request.headers = new Headers();
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(new Request(`${origin}/api/companies`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyName: 'Anonymous company' }) }))).status).toBe(401);
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    const response = await route.GET();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ companies: [{ id: companyA, name: 'Disposable Lagos company', role: 'owner', modules: ['estate', 'facility', 'shortlet', 'construction'] }], activeCompanyId: companyA });
    request.headers = new Headers();
  });

  it('rejects company API privilege fields, foreign selection, cross-origin and oversized requests', async () => {
    const create = await import('@/app/api/companies/route');
    const select = await import('@/app/api/companies/select/route');
    const post = (path: string, body: unknown, requestOrigin = origin) => new Request(`${origin}${path}`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    const count = (await admin.query('select count(*)::int n from tenants')).rows[0].n;
    for (const body of [{ companyName: 'Injected owner', role: 'owner' }, { companyName: 'Injected tenant', tenantId: companyB }, { companyName: 'Injected modules', modules: { estate: 'manage' } }]) expect((await create.POST(post('/api/companies', body))).status).toBe(400);
    expect((await create.POST(post('/api/companies', { companyName: 'Wrong origin' }, 'https://foreign.example'))).status).toBe(400);
    expect((await create.POST(post('/api/companies', { companyName: 'Oversized company', padding: 'x'.repeat(5000) }))).status).toBe(400);
    expect((await create.POST(new Request(`${origin}/api/companies`, { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '{}' }))).status).toBe(400);
    expect((await select.POST(post('/api/companies/select', { companyId: companyB }))).status).toBe(404);
    expect((await select.POST(post('/api/companies/select', { companyId: companyA, role: 'owner' }))).status).toBe(400);
    expect((await select.POST(post('/api/companies/select', { companyId: companyA }))).status).toBe(200);
    expect((await admin.query('select count(*)::int n from tenants')).rows[0].n).toBe(count);
    request.headers = new Headers();
  });

  it('creates a blank company through the normal API and selects only an authorised company', async () => {
    const create = await import('@/app/api/companies/route');
    const select = await import('@/app/api/companies/select/route');
    request.headers = new Headers({ cookie: cookieHeader(ownerA) });
    const response = await create.POST(new Request(`${origin}/api/companies`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyName: 'Native API-created company' }) }));
    expect(response.status).toBe(201);
    const { companyId } = await response.json();
    expect((await getCompanyPrincipal())?.company.id).toBe(companyId);
    const workspace = (await admin.query('select domain_tenant_id,payload from workspace_records where tenant_id=$1::uuid', [companyId])).rows[0];
    expect(workspace.domain_tenant_id).toBe(companyId);
    expect(Object.values(workspace.payload.collections).filter(Array.isArray).every((rows) => rows.length === 0)).toBe(true);
    expect((await select.POST(new Request(`${origin}/api/companies/select`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyId: companyA }) }))).status).toBe(200);
    expect((await getCompanyPrincipal())?.company.id).toBe(companyA);
    request.headers = new Headers();
  });

  it('enables real TOTP and withholds authenticated sessions until the second factor succeeds', async () => {
    const enabled = await http(ownerB, '/two-factor/enable', { password });
    expect(enabled.response.status).toBe(200);
    expect(enabled.data.backupCodes).toHaveLength(10);
    const secret = new URL(enabled.data.totpURI).searchParams.get('secret')!;
    const verified = await http(ownerB, '/two-factor/verify-totp', { code: totpCode(secret) });
    expect(verified.response.status, verified.data.code ?? verified.data.message).toBe(200);
    expect((await admin.query('select "twoFactorEnabled" from auth_users where id=$1::uuid', [ownerB.identity.user.id])).rows[0].twoFactorEnabled).toBe(true);
    const factor = (await admin.query('select secret,"backupCodes" from auth_two_factor where "userId"=$1::uuid', [ownerB.identity.user.id])).rows[0];
    expect(factor.secret).not.toBe(secret);
    expect(factor.backupCodes).not.toContain(enabled.data.backupCodes[0]);
    await http(ownerB, '/sign-out', {});
    const signIn = await http(ownerB, '/sign-in/email', { email: ownerB.email, password });
    expect(signIn.response.status).toBe(200); expect(signIn.data.twoFactorRedirect).toBe(true);
    expect((await http(ownerB, '/get-session')).data).toBeNull();
    expect((await http(ownerB, '/two-factor/verify-totp', { code: totpCode(secret) })).response.status).toBe(200);
    expect((await http(ownerB, '/get-session')).data.user.id).toBe(ownerB.identity.user.id);
  });

  it('uses real, short-lived demo sessions while withholding credential, MFA and other visitors’ session controls', async () => {
    demoVisitor = await createDemoVisitor();
    const session = (await http(demoVisitor, '/get-session')).data;
    expect(session.user.id).toBe(DEMO_ACCOUNTS[0].userId);
    expect(Date.parse(session.session.expiresAt) - Date.now()).toBeLessThanOrEqual(86400_000);
    expect(Date.parse(session.session.expiresAt) - Date.now()).toBeGreaterThan(86300_000);
    const sessionCount = (await admin.query('select count(*)::int n from auth_sessions where "userId"=$1::uuid', [demoVisitor.identity.user.id])).rows[0].n;
    const accountBefore = (await admin.query('select password from auth_accounts where "userId"=$1::uuid', [demoVisitor.identity.user.id])).rows[0].password;
    const blocked: [string, Record<string, unknown> | undefined][] = [
      ['/change-password', { currentPassword: demoPassword, newPassword: 'Attempted-replacement-password-123', revokeOtherSessions: true }],
      ['/two-factor/enable', { password: demoPassword, method: 'totp' }],
      ['/two-factor/disable', { password: demoPassword }],
      ['/two-factor/get-totp-uri', { password: demoPassword }],
      ['/two-factor/generate-backup-codes', { password: demoPassword }],
      ['/two-factor/verify-totp', { code: '000000' }],
      ['/two-factor/verify-backup-code', { code: 'not-a-real-code' }],
      ['/list-sessions', undefined],
      ['/revoke-session', { token: session.session.token }],
      ['/revoke-other-sessions', {}],
      ['/sign-up/email', { email: `forbidden-demo-signup-${runId}@example.test`, name: 'Forbidden demo signup', password }],
    ];
    for (const [path, body] of blocked) {
      const response = await http(demoVisitor, path, body);
      expect(response.response.status, `demo path ${path}`).toBe(403);
    }
    const headers = new Headers({ origin, cookie: cookieHeader(demoVisitor) });
    await expect(getNativeAuth().api.changePassword({ headers, body: { currentPassword: demoPassword, newPassword: 'Attempted-server-api-password-123' } })).rejects.toThrow(/protected|private.sandbox/i);
    await expect(getNativeAuth().api.enableTwoFactor({ headers, body: { password: demoPassword, method: 'totp' } })).rejects.toThrow(/protected|private.sandbox/i);
    expect((await admin.query('select password from auth_accounts where "userId"=$1::uuid', [demoVisitor.identity.user.id])).rows[0].password).toBe(accountBefore);
    expect((await admin.query('select "twoFactorEnabled" from auth_users where id=$1::uuid', [demoVisitor.identity.user.id])).rows[0].twoFactorEnabled).toBe(false);
    expect((await admin.query('select id from auth_two_factor where "userId"=$1::uuid', [demoVisitor.identity.user.id])).rows).toEqual([]);
    expect((await admin.query('select count(*)::int n from auth_sessions where "userId"=$1::uuid', [demoVisitor.identity.user.id])).rows[0].n).toBe(sessionCount);
  });

  it('rejects company creation, external selection and invitations while permitting owned sandbox changes', async () => {
    const actions = await import('@/server/actions/companies');
    const create = await import('@/app/api/companies/route');
    const { withDurableMutation } = await import('@/server/data/durable-records');
    request.headers = new Headers({ origin, cookie: cookieHeader(demoVisitor) });
    const invitation = await invite(demoVisitor.email, { estate: 'manage' });
    const companyCount = (await admin.query('select count(*)::int n from tenants')).rows[0].n;
    const before = (await admin.query('select version,payload from workspace_records where tenant_id=$1::uuid', [DEMO_TENANT_ID])).rows[0];
    await expect(provisionCompany(demoVisitor.identity, 'Forbidden demo company')).rejects.toThrow(/protected|private.sandbox/i);
    await expect(activateCompany(demoVisitor.identity, companyA)).rejects.toThrow(/private.demo.sandbox|unavailable/i);
    const form = new FormData(); form.set('token', invitation.token);
    expect(await actions.acceptCompanyInvite(form)).toHaveProperty('error');
    expect((await admin.query('select id from company_memberships where tenant_id=$1::uuid and user_id=$2::uuid', [companyA, demoVisitor.identity.user.id])).rows).toEqual([]);
    expect((await admin.query('select accepted_at from company_invitations where id=$1::uuid', [invitation.id])).rows[0].accepted_at).toBeNull();
    const response = await create.POST(new Request(`${origin}/api/companies`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyName: 'Forbidden API demo company' }) }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await admin.query('select count(*)::int n from tenants')).rows[0].n).toBe(companyCount);
    const mutation = vi.fn(async () => 'own sandbox mutation');
    await expect(withDurableMutation(mutation, ['estate', 'facility', 'shortlet', 'construction'], 'read')).resolves.toBe('own sandbox mutation');
    expect(mutation).toHaveBeenCalledOnce();
    expect((await admin.query('select version,payload from workspace_records where tenant_id=$1::uuid', [DEMO_TENANT_ID])).rows[0]).toEqual(before);
    request.headers = new Headers();
  });

  it('keeps the demo tenant separate from real accounts and closes old demo sessions when access is disabled', async () => {
    expect(await listCompanies(ownerA.identity)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: DEMO_TENANT_ID })]));
    await expect(activateCompany(ownerA.identity, DEMO_TENANT_ID)).rejects.toThrow(/unavailable/i);
    const principal = await companyPrincipalFor(demoVisitor.identity);
    expect(principal?.company.id).not.toBe(DEMO_TENANT_ID);
    expect(principal?.sandbox?.id).toBe(principal?.company.id);
    for (const workspace of ['estate', 'facility', 'shortlet', 'construction'] as const) {
      expect(canUseCompanyModule(principal!.actor, workspace, 'read')).toBe(true);
      expect(canUseCompanyModule(principal!.actor, workspace, 'update')).toBe(true);
    }
    vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '0');
    try {
      expect(await companyPrincipalFor(demoVisitor.identity)).toBeNull();
      const anonymous = { cookies: new Map<string, string>() };
      expect((await http(anonymous, '/sign-in/email', { email: demoVisitor.email, password: demoPassword })).response.status).toBe(403);
    } finally { vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '1'); }
    expect((await http(demoVisitor, '/sign-out', {})).response.status).toBe(200);
    expect((await http(demoVisitor, '/get-session')).data).toBeNull();
  });

  it('revokes the actual database session on sign-out and rejects its previously valid cookie', async () => {
    const stolenCookie = cookieHeader(ownerA);
    const sessionId = ownerA.identity.session.id;
    expect((await http(ownerA, '/sign-out', {})).response.status).toBe(200);
    expect((await admin.query('select id from auth_sessions where id=$1::uuid', [sessionId])).rows).toEqual([]);
    request.headers = new Headers({ cookie: stolenCookie });
    expect(await getCompanyPrincipal()).toBeNull();
    expect((await admin.query("select count(*)::int n from auth_security_events where user_id=$1::uuid and event='session.revoked'", [ownerA.identity.user.id])).rows[0].n).toBeGreaterThanOrEqual(1);
    request.headers = new Headers();
  });
});
