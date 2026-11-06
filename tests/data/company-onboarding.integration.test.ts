import { randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
import { runMigrations } from '../../scripts/migrate.mjs';
import { getNativeAuth } from '@/server/auth/auth';
import { activateCompany, companyPrincipalFor, provisionCompany, type NativeIdentity } from '@/server/auth/company';
import { DEMO_ACCOUNTS } from '@/server/auth/demo-config';
import { addEstateProperty } from '@/server/actions/estate-registration';
import { EMPTY_OWNER_SETUP, type OwnerSetupDraft } from '@/domain/owner-onboarding';
import { completeNativeOwnerSetup, getNativeOwnerSetup, saveNativeOwnerSetup } from '@/server/onboarding/native-repository';

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

// This suite owns synthetic accounts only in the runner's disposable cluster.
const testUrl = process.env.PROPBREW_TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) {
  throw new Error('Company onboarding tests require a disposable loopback database.');
}
const origin = 'https://onboarding-integration.example';
const password = 'Disposable-onboarding-passphrase-24!';
const runId = randomUUID().slice(0, 8);
type Browser = { cookies: Map<string, string>; identity: NativeIdentity };
let admin: Client;
let owner: Browser, other: Browser, member: Browser;
let company: string, otherCompany: string, secondCompany: string, rollbackCompany: string;
const scope = (id: string) => `company:${id}`;

function cookieHeader(browser: Pick<Browser, 'cookies'>): string {
  return [...browser.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
}
function requestAs(browser: Pick<Browser, 'cookies'>) {
  request.headers = new Headers({ origin, cookie: cookieHeader(browser) });
}
async function http(browser: Pick<Browser, 'cookies'>, path: string, body?: Record<string, unknown>) {
  // Give this suite its own synthetic loopback client; the account suite
  // intentionally exhausts signup limits on its distinct test IP.
  const headers = new Headers({ origin, 'x-forwarded-for': '127.0.0.42', cookie: cookieHeader(browser) });
  if (body) headers.set('content-type', 'application/json');
  const response = await getNativeAuth().handler(new Request(`${origin}/api/auth${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
  }));
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0], separator = pair.indexOf('=');
    const name = pair.slice(0, separator), value = pair.slice(separator + 1);
    if (!value || /max-age=0(?:;|$)/i.test(cookie)) browser.cookies.delete(name);
    else browser.cookies.set(name, value);
  }
  return { response, data: await response.json() };
}
async function signup(label: string): Promise<Browser> {
  const browser = { cookies: new Map<string, string>() };
  const result = await http(browser, '/sign-up/email', { name: `Synthetic ${label}`, email: `${label}-${runId}@example.invalid`, password });
  expect(result.response.status).toBe(200);
  return { ...browser, identity: (await http(browser, '/get-session')).data as NativeIdentity };
}
async function select(browser: Browser, id: string) {
  await activateCompany(browser.identity, id);
  browser.identity = (await http(browser, '/get-session')).data as NativeIdentity;
  requestAs(browser);
}
async function snapshot(id: string) {
  return (await admin.query('select version::text,payload from workspace_records where tenant_id=$1::uuid', [id])).rows[0];
}
function draft(name = 'Synthetic Surulere property'): OwnerSetupDraft {
  return {
    ...structuredClone(EMPTY_OWNER_SETUP), portfolioType: 'growing_landlord', propertyCount: 'two_to_five',
    tenantCount: 'none', rentWorkflow: 'spreadsheets', rentPaymentMethods: ['bank_transfer', 'cash_manual'],
    priority: 'records', firstProperty: {
      name, address: '10 Synthetic Avenue', city: 'Lagos', state: 'Lagos', country: 'NG', propertyType: 'building', units: 3,
    }, step: 6,
  };
}

describe.skipIf(!testUrl)('company onboarding with actual sessions and restricted PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: testUrl }); await admin.connect();
    await admin.query("do $$ begin if not exists(select from pg_roles where rolname='propbrew_review_app') then create role propbrew_review_app login nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$");
    await admin.query('grant usage on schema public to propbrew_review_app');
    await runMigrations({ url: testUrl });
    const url = new URL(testUrl!); url.username = 'propbrew_review_app';
    for (const [key, value] of Object.entries({
      DATABASE_URL: url.toString(), DATA_SOURCE: 'postgres', PROPBREW_AUTH_MODE: 'company', PROPBREW_REVIEW_MODE: '0',
      NODE_ENV: 'production', BETTER_AUTH_URL: origin, NEXT_PUBLIC_SITE_URL: origin,
      BETTER_AUTH_SECRET: 'disposable-onboarding-secret-at-least-32-characters', PROPBREW_AUTH_ORIGINS: '',
      REEVE_ALLOW_DEMO_IDENTITIES: '', REEVE_ALLOW_IN_MEMORY_DATA: '', NEXT_PUBLIC_DEV_IDENTITY: '',
    })) vi.stubEnv(key, value);
    owner = await signup('owner'); other = await signup('other-owner'); member = await signup('invited-manager');
    company = await provisionCompany(owner.identity, 'Synthetic Lagos operator');
    otherCompany = await provisionCompany(other.identity, 'Synthetic Abuja operator');
    secondCompany = await provisionCompany(owner.identity, 'Synthetic second company');
    rollbackCompany = await provisionCompany(owner.identity, 'Synthetic rollback company');
    await admin.query("insert into company_memberships(tenant_id,user_id,company_role,modules) values($1,$2,'admin','{\"estate\":\"manage\"}'::jsonb)", [company, member.identity.user.id]);
    await select(owner, company);
  }, 30_000);

  afterAll(async () => {
    request.headers = new Headers();
    const globals = globalThis as typeof globalThis & { __propbrewAuthPool?: { pool: Pool }; __propbrewPgPool?: { pool: Pool }; __propbrewNativeAuth?: unknown };
    await globals.__propbrewAuthPool?.pool.end(); await globals.__propbrewPgPool?.pool.end();
    delete globals.__propbrewAuthPool; delete globals.__propbrewPgPool; delete globals.__propbrewNativeAuth;
    vi.unstubAllEnvs(); await admin?.end();
  });

  it('reads an empty setup without changing existing workspace records', async () => {
    await select(owner, company);
    const before = await snapshot(company);
    const record = await getNativeOwnerSetup(scope(company));
    expect(record).toMatchObject({ version: 0, completedAt: null, updatedAt: null, draft: EMPTY_OWNER_SETUP });
    expect(record.activatedProperty).toBeUndefined();
    expect(await snapshot(company)).toEqual(before);
  });

  it('persists a draft and rejects stale updates without changing any records', async () => {
    await select(owner, company);
    const saved = await saveNativeOwnerSetup(scope(company), draft(), 0);
    expect(saved.version).toBe(1); expect(saved.completedAt).toBeNull();
    const before = await snapshot(company);
    expect((await getNativeOwnerSetup(scope(company))).draft).toEqual(draft());
    await expect(saveNativeOwnerSetup(scope(company), draft('Stale tab name'), 0)).rejects.toThrow();
    expect(await snapshot(company)).toEqual(before);
  });

  it('rejects a stale form after selecting another owned company and isolates both companies', async () => {
    const a = await snapshot(company), b = await snapshot(secondCompany), foreign = await snapshot(otherCompany);
    await select(owner, secondCompany);
    await expect(getNativeOwnerSetup(scope(company))).rejects.toThrow();
    await expect(saveNativeOwnerSetup(scope(company), draft(), 0)).rejects.toThrow();
    await expect(completeNativeOwnerSetup(scope(company), draft(), 1)).rejects.toThrow();
    await expect(getNativeOwnerSetup(scope(otherCompany))).rejects.toThrow();
    expect(await snapshot(company)).toEqual(a); expect(await snapshot(secondCompany)).toEqual(b);
    expect(await snapshot(otherCompany)).toEqual(foreign);
    await saveNativeOwnerSetup(scope(secondCompany), draft('Separate company draft'), 0);
    expect((await getNativeOwnerSetup(scope(secondCompany))).draft.firstProperty.name).toBe('Separate company draft');
    await select(owner, company);
    expect((await getNativeOwnerSetup(scope(company))).draft.firstProperty.name).toBe(draft().firstProperty.name);
  });

  it('denies invited administrators and members even with Estate manage access', async () => {
    const before = await snapshot(company);
    await select(member, company);
    for (const role of ['admin', 'member']) {
      await admin.query('update company_memberships set company_role=$1,version=version+1 where tenant_id=$2 and user_id=$3', [role, company, member.identity.user.id]);
      await expect(getNativeOwnerSetup(scope(company))).rejects.toThrow();
      await expect(saveNativeOwnerSetup(scope(company), draft(), 0)).rejects.toThrow();
      await expect(completeNativeOwnerSetup(scope(company), draft(), 1)).rejects.toThrow();
    }
    expect(await snapshot(company)).toEqual(before);
    await select(owner, company);
  });

  it('completes concurrent submissions once while preserving existing properties and unrelated modules', async () => {
    await select(owner, company);
    const existing = await addEstateProperty({ name: 'Existing operational property', address: '20 Existing Synthetic Road, Lagos', unitCount: 1, unitType: 'Apartment', idempotencyKey: randomUUID() });
    expect(existing.ok).toBe(true);
    const before = await snapshot(company), otherBefore = await snapshot(otherCompany);
    const [a, b] = await Promise.all([
      completeNativeOwnerSetup(scope(company), draft(), 1), completeNativeOwnerSetup(scope(company), draft(), 1),
    ]);
    expect(a).toEqual(b); expect(a.activatedProperty).toMatchObject({ name: draft().firstProperty.name, unitCount: 3 });
    expect(a.completedAt).toBeTruthy();
    const state = (await snapshot(company)).payload;
    const propertyId = a.activatedProperty!.id;
    expect(state.collections.sites.filter((row: { id: string }) => row.id === propertyId)).toHaveLength(1);
    expect(state.collections.sites).toHaveLength(2);
    expect(state.collections.buildings.filter((row: { siteId: string }) => row.siteId === propertyId)).toHaveLength(1);
    const units = state.collections.units.filter((row: { siteId: string }) => row.siteId === propertyId);
    expect(units).toHaveLength(3);
    expect(units.every((row: { tenantId: string; occupancy: string }) => row.tenantId === company && row.occupancy === 'vacant')).toBe(true);
    expect(state.collections.estateRegistrationReceipts.filter((row: { result: { id: string } }) => row.result.id === propertyId)).toHaveLength(1);
    expect(state.collections.estateCreatorAssignments.filter((row: { siteId: string }) => row.siteId === propertyId)).toHaveLength(1);
    expect(state.collections.estateRegistrationAudit.filter((row: { entityId: string }) => row.entityId === propertyId)).toHaveLength(1);
    for (const key of ['constructionProjects', 'shortletBookings', 'workOrders', 'invoices', 'residents']) expect(state.collections[key]).toEqual(before.payload.collections[key]);
    expect(await snapshot(otherCompany)).toEqual(otherBefore);
    expect((await getNativeOwnerSetup(scope(company))).activatedProperty).toEqual(a.activatedProperty);
    const complete = await snapshot(company);
    await expect(saveNativeOwnerSetup(scope(company), draft(), a.version)).rejects.toThrow();
    expect((await completeNativeOwnerSetup(scope(company), draft('A repeated submit'), 0)).activatedProperty).toEqual(a.activatedProperty);
    expect((await snapshot(company)).payload).toEqual(complete.payload);
  });

  it('rolls back property inventory and completion together when PostgreSQL rejects the commit', async () => {
    await select(owner, rollbackCompany);
    const saved = await saveNativeOwnerSetup(scope(rollbackCompany), draft('Rollback property'), 0);
    const before = await snapshot(rollbackCompany);
    const identifier = `onboarding_reject_${runId}`;
    await admin.query(`create function ${identifier}() returns trigger language plpgsql as $$ begin if new.tenant_id='${rollbackCompany}'::uuid and new.payload #>> '{auxiliary,ownerOnboarding,record,completedAt}' is not null then raise exception 'Synthetic onboarding commit rejection'; end if; return new; end $$`);
    await admin.query(`create trigger ${identifier} before update on workspace_records for each row execute function ${identifier}()`);
    try {
      await expect(completeNativeOwnerSetup(scope(rollbackCompany), draft('Rollback property'), saved.version)).rejects.toThrow('Synthetic onboarding commit rejection');
      expect(await snapshot(rollbackCompany)).toEqual(before);
    } finally {
      await admin.query(`drop trigger ${identifier} on workspace_records`);
      await admin.query(`drop function ${identifier}()`);
    }
    const result = await completeNativeOwnerSetup(scope(rollbackCompany), draft('Rollback property'), saved.version);
    expect(result.activatedProperty?.name).toBe('Rollback property');
    await select(owner, company);
  });

  it('rejects unauthenticated, malformed and oversized activation requests without a partial save', async () => {
    await select(owner, secondCompany);
    const before = await snapshot(secondCompany);
    request.headers = new Headers({ origin });
    await expect(getNativeOwnerSetup(scope(secondCompany))).rejects.toThrow();
    await expect(completeNativeOwnerSetup(scope(secondCompany), draft(), 1)).rejects.toThrow();
    requestAs(owner);
    await expect(completeNativeOwnerSetup(scope(secondCompany), structuredClone(EMPTY_OWNER_SETUP), 1)).rejects.toThrow();
    await expect(completeNativeOwnerSetup(scope(secondCompany), { ...draft(), tenantId: otherCompany } as OwnerSetupDraft, 1)).rejects.toThrow();
    const oversized = draft(); oversized.firstProperty.units = 10_001;
    await expect(completeNativeOwnerSetup(scope(secondCompany), oversized, 1)).rejects.toThrow();
    expect(await snapshot(secondCompany)).toEqual(before);
    await select(owner, company);
  });

  it('rejects an authenticated private demo session from company owner setup', async () => {
    const account = DEMO_ACCOUNTS[2];
    vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '1'); vi.stubEnv('PROPBREW_DEMO_PASSWORD', password);
    await admin.query('insert into auth_users(id,name,email,"createdAt","updatedAt") values($1,$2,$3,now(),now())', [account.userId, account.name, account.email]);
    await admin.query('insert into auth_accounts("accountId","providerId","userId",password,"createdAt","updatedAt") values($1::text,$2,$1::uuid,$3,now(),now())', [account.userId, 'credential', await hashPassword(password)]);
    const demo = { cookies: new Map<string, string>() };
    const login = await http(demo, '/sign-in/email', { email: account.email, password });
    expect(login.response.status).toBe(200);
    const identity = (await http(demo, '/get-session')).data as NativeIdentity;
    const principal = await companyPrincipalFor(identity);
    expect(principal?.sandbox).toBeDefined();
    const before = await snapshot(principal!.company.id);
    requestAs(demo);
    await expect(getNativeOwnerSetup(scope(principal!.company.id))).rejects.toThrow();
    await expect(saveNativeOwnerSetup(scope(principal!.company.id), draft(), 0)).rejects.toThrow();
    await expect(completeNativeOwnerSetup(scope(principal!.company.id), draft(), 0)).rejects.toThrow();
    expect(await snapshot(principal!.company.id)).toEqual(before);
  });
});
