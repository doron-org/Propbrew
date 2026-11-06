import { randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withWorkspaceState } from '@/server/data/workspace-postgres';
import { withTenantTransaction } from '@/server/db';
import { initialWorkspaceRecordState } from '@/server/data/store';
import type { Actor } from '@/lib/authz';
import { runMigrations } from '../../scripts/migrate.mjs';

const application = vi.hoisted(() => ({ cookies: new Map<string, string>(), actor: null as Actor | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (key: string) => application.cookies.has(key) ? { value: application.cookies.get(key)! } : undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const auth = await import('@/server/review-auth');
  return {
    getActor: async () => application.actor ?? auth.reviewActorIdentity().actor,
    getSession: async () => auth.reviewActorIdentity(),
    devIdentityEnabled: () => false,
  };
});

const testUrl = process.env.PROPBREW_TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) throw new Error('Workspace integration tests require a disposable loopback database.');
const role = 'propbrew_review_app';
type Envelope = { schemaVersion: 1; collections: Record<string, unknown>; history: Record<string, unknown[]>; auxiliary: Record<string, unknown>; sequences: Record<string, number> };
const seed = (): Envelope => ({ schemaVersion: 1, collections: { count: 0, rows: [{ id: 'seed-row', label: 'Original seed' }] }, history: {}, auxiliary: {}, sequences: {} });
const cast = (payload: unknown) => payload as Envelope;
let admin: Client;
let tenant: string;
const logical = 't-review-workspace';
const runtime = globalThis as typeof globalThis & { __propbrewPgPool?: { url: string; pool: Pool } };
async function closePool() { await runtime.__propbrewPgPool?.pool.end(); delete runtime.__propbrewPgPool; }
async function createTenant() { const id = randomUUID(); await admin.query('insert into tenants(id, name) values ($1, $2)', [id, 'Disposable workspace test']); return id; }
const read = (id = tenant) => withWorkspaceState(id, logical, 'read', seed, async (payload) => ({ value: cast(payload) }));

describe.skipIf(!testUrl)('durable transactional workspace records', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: testUrl }); await admin.connect();
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname = '${role}') then create role ${role} login nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$`);
    await admin.query(`grant usage on schema public to ${role}`);
    await runMigrations({ url: testUrl });
    // Another integration worker may have migrated before this test role was
    // created; production provisions the role before applying migration 008.
    await admin.query(`grant select, insert, update on workspace_records to ${role}`);
    await admin.query(`grant execute on function demo_sandbox_access(uuid,boolean) to ${role}`);
    const url = new URL(testUrl!); url.username = role;
    vi.stubEnv('DATABASE_URL', url.toString());
  });
  beforeEach(async () => { tenant = await createTenant(); });
  afterAll(async () => { await closePool(); vi.unstubAllEnvs(); await admin?.end(); });

  it('seeds once, persists deletes and auxiliary/history/sequence state, and restores after a fresh pool/module graph', async () => {
    const initialize = vi.fn(seed);
    await withWorkspaceState(tenant, logical, 'write', initialize, async (payload) => {
      const state = cast(payload); state.collections.rows = [];
      state.history['shortlet-booking:record-one'] = [{ event: 'CREATE', seq: 0 }];
      state.auxiliary.shortletSettings = { planKey: 'growth' }; state.sequences.booking = 5201;
      return { value: 'saved' };
    });
    expect(initialize).toHaveBeenCalledOnce();
    await closePool(); vi.resetModules();
    const reloaded = await import('@/server/data/workspace-postgres');
    const state = await reloaded.withWorkspaceState(tenant, logical, 'read', () => { throw new Error('Existing state must not be seeded again.'); }, async (payload) => ({ value: cast(payload) }));
    expect(state.collections.rows).toEqual([]);
    expect(state.history['shortlet-booking:record-one']).toEqual([{ event: 'CREATE', seq: 0 }]);
    expect(state.auxiliary.shortletSettings).toEqual({ planKey: 'growth' }); expect(state.sequences.booking).toBe(5201);
  });

  it('round-trips the complete application state and real four-module actions through a reopened database working set', async () => {
    const values = {
      NODE_ENV: 'production', DATA_SOURCE: 'postgres', PROPBREW_REVIEW_MODE: '1', PROPBREW_WEBSITE_ONLY: '0',
      PROPBREW_REVIEW_PASSWORD_HASH: `scrypt$16384$8$1$${Buffer.alloc(16, 7).toString('base64url')}$${Buffer.alloc(64, 8).toString('base64url')}`,
      PROPBREW_REVIEW_SESSION_SECRET: Buffer.alloc(32, 9).toString('base64url'), PROPBREW_REVIEW_TENANT_UUID: tenant,
      NEXT_PUBLIC_SITE_URL: 'https://private-review.example', REEVE_AI_DAILY_CAP_MINOR_NGN: '500000',
      REEVE_ALLOW_DEMO_IDENTITIES: '', REEVE_ALLOW_IN_MEMORY_DATA: '', NEXT_PUBLIC_DEV_IDENTITY: '',
      CLERK_SECRET_KEY: '', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '', PAYSTACK_SECRET_KEY: '', FLUTTERWAVE_SECRET_KEY: '',
      FLUTTERWAVE_WEBHOOK_SECRET: '', TERMII_API_KEY: '', RESEND_API_KEY: '', WHATSAPP_ACCESS_TOKEN: '', BLOB_READ_WRITE_TOKEN: '', ANTHROPIC_API_KEY: '',
    };
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    application.actor = null; application.cookies.clear();
    try {
      const auth = await import('@/server/review-auth');
      application.cookies.set(auth.REVIEW_SESSION_COOKIE, auth.issueReviewSession());
      const identities = await import('@/server/identities');
      const domainTenant = identities.SEED.tenantA;
      const original = initialWorkspaceRecordState(domainTenant);
      expect(Object.keys(original.collections)).toHaveLength(106);
      const records = await import('@/server/data/durable-records');
      const store = await import('@/server/data/store');
      const registration = await import('@/server/actions/estate-registration');
      const facility = await import('@/server/actions/facility');
      const shortlet = await import('@/server/actions/shortlet');
      const sync = await import('@/server/actions/sync');
      const inbox = await import('@/server/data/inbox');
      const context = await import('@/server/data/record-context');
      const syncDomain = await import('@/domain/sync');

      const propertyInput = { name: 'Persistent four-module estate', address: '14 Sample Road, Abuja, Nigeria', unitCount: 2, unitType: 'Apartment', idempotencyKey: randomUUID() };
      const property = await registration.addEstateProperty(propertyInput);
      expect(property.ok).toBe(true); if (!property.ok) throw new Error(property.error);

      application.actor = structuredClone(identities.identityByKey('facility_manager').actor);
      const alarmId = await records.withDurableRead(async () => store.db.facilityAlarms.find((alarm) => !alarm.woRef && application.actor!.estateIds.includes(alarm.siteId))!.id);
      const facilityResult = await facility.dispatchWoFromAlarm(alarmId);
      expect(facilityResult.ok).toBe(true); if (!facilityResult.ok) throw new Error(facilityResult.error);
      const workOrderId = await records.withDurableRead(async () => store.db.workOrders.find((order) => order.ref === facilityResult.ref)!.id);

      application.actor = null;
      const apartmentId = await records.withDurableRead(async () => store.db.shortletApartments.find((apartment) => apartment.status === 'active' && apartment.nightlyRate.currency === 'NGN')!.id);
      const bookingInput = { apartmentId, guestName: 'Persistent integration guest', guestPhone: '', checkIn: '2030-01-01', checkOut: '2030-01-03', source: 'direct' as const, status: 'confirmed', cautionNaira: 10000, paidNaira: 1000.01 };
      const booking = await shortlet.createBooking(bookingInput);
      expect(booking.ok).toBe(true); if (!booking.ok) throw new Error(booking.error);
      const bookingId = await records.withDurableRead(async () => store.db.shortletBookings.find((row) => row.ref === booking.ref)!.id);

      const capture = await records.withDurableRead(async () => {
        const actor = auth.reviewActorIdentity().actor;
        const task = store.db.constructionTasks.find((row) => row.status === 'done')!;
        const owner = syncDomain.outboxOwnerKey(actor.tenantId, actor.userId)!;
        return {
          issue: { id: 'complete-state-site-issue', owner, kind: 'site_issue' as const, capturedISO: '2026-10-24T12:00:00Z', payload: { projectId: task.projectId, title: 'Persistent captured construction issue', severity: 'high', correctiveAction: 'Inspect the isolated work area.' } },
          pending: { id: 'complete-state-pending-progress', owner, kind: 'task_progress' as const, capturedISO: '2026-10-24T12:00:00Z', payload: { projectId: task.projectId, taskId: task.id, percentComplete: 0 } },
          taskId: task.id,
        };
      });
      expect(await sync.syncOperation(capture.issue)).toMatchObject({ ok: true, duplicate: false });
      expect(await sync.syncOperation(capture.pending)).toMatchObject({ ok: false, conflict: true });
      const firstSequence = await records.withDurableMutation(async () => {
        expect(context.currentRecordContext()?.mode).toBe('write');
        inbox.pushNotification(auth.reviewActorIdentity().actor.userId, ['estate_manager'], { title: 'Persistent integration notification', body: 'Saved with the full working set.', kind: 'info' });
        return context.nextRecordSequence('integration:roundtrip', 9000);
      });
      const saved = await records.withDurableRead(async () => ({
        keys: Object.keys(context.currentRecordContext()!.state.collections),
        counts: { sites: store.db.sites.length, workOrders: store.db.workOrders.length, bookings: store.db.shortletBookings.length, issues: store.db.constructionIssues.length },
        receipts: structuredClone(store.db.syncLedger),
      }));
      expect(saved.receipts.find((receipt) => receipt.opId === capture.pending.id)?.status).toBe('pending');

      await closePool(); vi.resetModules();
      const reloadedRepository = await import('@/server/data/workspace-postgres');
      const reloadedContext = await import('@/server/data/record-context');
      const reloadedStore = await import('@/server/data/store');
      const reloadedInbox = await import('@/server/data/inbox');
      const reloadedAuth = await import('@/server/review-auth');
      const noSeed = vi.fn(() => { throw new Error('The complete working set must not be seeded again.'); });
      await reloadedRepository.withWorkspaceState(tenant, domainTenant, 'read', noSeed, async (payload) => {
        const state = reloadedStore.validateWorkspaceRecordState(payload, domainTenant);
        const value = await reloadedContext.runWithRecordContext({ state, domainTenantId: domainTenant, mode: 'read' }, async () => {
          expect(Object.keys(state.collections).sort()).toEqual(saved.keys.sort());
          expect({ sites: reloadedStore.db.sites.length, workOrders: reloadedStore.db.workOrders.length, bookings: reloadedStore.db.shortletBookings.length, issues: reloadedStore.db.constructionIssues.length }).toEqual(saved.counts);
          expect(reloadedStore.db.sites.find((row) => row.id === property.id)?.name).toBe(propertyInput.name);
          expect(reloadedStore.db.estateRegistrationReceipts.find((row) => row.key === propertyInput.idempotencyKey)?.result.id).toBe(property.id);
          expect(reloadedAuth.reviewActorIdentity().actor.estateIds).toContain(property.id);
          expect(reloadedStore.db.workOrders.find((row) => row.id === workOrderId)?.ref).toBe(facilityResult.ref);
          expect(reloadedStore.db.shortletBookings.find((row) => row.id === bookingId)?.paid.minor).toBe(100001);
          expect(reloadedStore.db.constructionIssues.some((row) => row.title === capture.issue.payload.title)).toBe(true);
          expect(reloadedStore.db.syncLedger.find((row) => row.opId === capture.pending.id)?.status).toBe('pending');
          expect(reloadedStore.db.constructionTasks.find((row) => row.id === capture.taskId)?.status).toBe('done');
          expect(reloadedStore.getHistory('work-order', workOrderId)).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'CREATE' })]));
          expect(reloadedStore.getHistory('shortlet-booking', bookingId)).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'CREATE' })]));
          expect(reloadedInbox.getNotifications(reloadedAuth.reviewActorIdentity().actor.userId, ['estate_manager'])).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Persistent integration notification' })]));
          expect(state.sequences['integration:roundtrip']).toBe(firstSequence + 1);
        });
        return { value };
      });
      expect(noSeed).not.toHaveBeenCalled();
      const reloadedRecords = await import('@/server/data/durable-records');
      const reloadedShortlet = await import('@/server/actions/shortlet');
      const nextBooking = await reloadedShortlet.createBooking({ ...bookingInput, checkIn: '2030-01-03', checkOut: '2030-01-05' });
      expect(nextBooking.ok).toBe(true); if (!nextBooking.ok) throw new Error(nextBooking.error);
      expect(nextBooking.ref).not.toBe(booking.ref);
      expect(await reloadedRecords.withDurableMutation(async () => reloadedContext.nextRecordSequence('integration:roundtrip', 9000))).toBe(firstSequence + 1);
      const reloadedSync = await import('@/server/actions/sync');
      expect(await reloadedSync.syncOperation(capture.issue)).toMatchObject({ ok: true, duplicate: true });
      expect(await reloadedSync.abandonOperation(capture.pending)).toEqual({ ok: true });
      expect(await reloadedSync.syncOperation(capture.pending)).toMatchObject({ ok: false, conflict: true, serverState: 'Discarded by its author' });
      expect(await reloadedRecords.withDurableRead(async () => reloadedStore.db.syncLedger.find((row) => row.opId === capture.pending.id)?.status)).toBe('abandoned');
    } finally {
      application.actor = null; application.cookies.clear();
      for (const [key, value] of Object.entries(previous)) vi.stubEnv(key, value);
    }
  });

  it('serializes simultaneous first initialization and read-modify-write mutations without losing updates', async () => {
    const initialize = vi.fn(seed);
    await Promise.all(Array.from({ length: 12 }, () => withWorkspaceState(tenant, logical, 'write', initialize, async (payload) => {
      const state = cast(payload); const current = Number(state.collections.count);
      await new Promise((resolve) => setTimeout(resolve, 2)); state.collections.count = current + 1;
      return { value: undefined };
    })));
    expect(initialize).toHaveBeenCalledOnce(); expect((await read()).collections.count).toBe(12);
    expect((await admin.query('select version::text as version from workspace_records where tenant_id = $1', [tenant])).rows).toEqual([{ version: '13' }]);
  });

  it('rolls back thrown callbacks, declined changes and declined first initialization', async () => {
    await read();
    await expect(withWorkspaceState(tenant, logical, 'write', seed, async (payload) => { cast(payload).collections.count = 99; throw new Error('Rejected test mutation'); })).rejects.toThrow('Rejected test mutation');
    expect(await withWorkspaceState(tenant, logical, 'write', seed, async (payload) => { cast(payload).collections.count = 88; return { value: 'declined', commit: false }; })).toBe('declined');
    expect((await read()).collections.count).toBe(0);
    const untouched = await createTenant();
    await withWorkspaceState(untouched, logical, 'write', seed, async () => ({ value: false, commit: false }));
    expect((await admin.query('select count(*)::int as count from workspace_records where tenant_id = $1', [untouched])).rows[0].count).toBe(0);
  });

  it('returns detached fresh reads and releases read transactions before provider-like callbacks', async () => {
    const first = await read(); first.collections.count = 400;
    expect((await read()).collections.count).toBe(0);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = withWorkspaceState(tenant, logical, 'read', seed, async (payload) => { entered(); await gate; cast(payload).collections.count = -1; return { value: Number(cast(payload).collections.count) }; });
    await started;
    try {
      await withWorkspaceState(tenant, logical, 'write', seed, async (payload) => { cast(payload).collections.count = 7; return { value: true }; });
      expect((await read()).collections.count).toBe(7);
    } finally { release(); }
    expect(await waiting).toBe(-1); expect((await read()).collections.count).toBe(7);
  });

  it('isolates in-flight write state from readers and rolls it back on a failed database write', async () => {
    await read();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const writing = withWorkspaceState(tenant, logical, 'write', seed, async (payload) => { cast(payload).collections.count = 50; entered(); await gate; return { value: true }; });
    await started;
    try { expect((await read()).collections.count).toBe(0); } finally { release(); }
    await writing; expect((await read()).collections.count).toBe(50);
    await admin.query("create function workspace_test_reject_commit() returns trigger language plpgsql as $$ begin if new.payload->'collections'->>'count' = '51' then raise exception 'Deferred test commit failure'; end if; return new; end $$");
    await admin.query('create constraint trigger workspace_test_commit_failure after update on workspace_records deferrable initially deferred for each row execute function workspace_test_reject_commit()');
    try {
      await expect(withWorkspaceState(tenant, logical, 'write', seed, async (payload) => { cast(payload).collections.count = 51; return { value: 'must not acknowledge' }; })).rejects.toThrow();
      expect((await read()).collections.count).toBe(50);
    } finally { await admin.query('drop trigger workspace_test_commit_failure on workspace_records'); await admin.query('drop function workspace_test_reject_commit()'); }
  });

  it('never acknowledges a transaction PostgreSQL rolled back after a swallowed SQL error', async () => {
    await expect(withTenantTransaction(tenant, async (client) => {
      await client.query('select * from workspace_table_that_does_not_exist').catch(() => {});
      return 'must not acknowledge';
    })).rejects.toThrow('did not commit');
  });

  it('enforces tenant RLS, disallows forged namespaces and clears context on pooled connection reuse', async () => {
    await read(); const other = await createTenant(); await read(other);
    expect(await withTenantTransaction(other, async (client) => (await client.query('select tenant_id::text as tenant from workspace_records where tenant_id = $1', [tenant])).rows)).toEqual([]);
    await expect(withTenantTransaction(other, async (client) => client.query('insert into workspace_records(tenant_id, domain_tenant_id, payload) values ($1, $2, $3)', [randomUUID(), logical, seed()]))).rejects.toThrow();
    await expect(withWorkspaceState(tenant, 'forged-domain', 'write', seed, async () => ({ value: true }))).rejects.toThrow('namespace');
    await expect(withTenantTransaction(tenant, async (client) => client.query('update workspace_records set domain_tenant_id = $1 where tenant_id = $2', ['forged-domain', tenant]))).rejects.toThrow('immutable');
    const client = await runtime.__propbrewPgPool!.pool.connect();
    try {
      expect((await client.query("select nullif(current_setting('app.tenant_id', true), '') as tenant")).rows).toEqual([{ tenant: null }]);
      expect((await client.query('select * from workspace_records')).rows).toEqual([]);
    } finally { client.release(); }
    const protection = await admin.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'workspace_records'::regclass");
    expect(protection.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('fails closed on bad envelopes, nonfinite values and database errors without caching a successful result', async () => {
    await read();
    for (const bad of [null, { ...seed(), schemaVersion: 2 }, { ...seed(), history: { invalid: {} } }, { ...seed(), sequences: { invalid: NaN } }, { ...seed(), collections: { invalid: Infinity } }]) {
      await expect(withWorkspaceState(tenant, logical, 'write', seed, async () => ({ value: true, payload: bad }))).rejects.toThrow();
    }
    expect((await read()).collections.count).toBe(0);
    await closePool(); const configured = process.env.DATABASE_URL;
    vi.stubEnv('DATABASE_URL', 'postgresql://propbrew_review_app@127.0.0.1:1/missing');
    try { await expect(read()).rejects.toThrow(); } finally { vi.stubEnv('DATABASE_URL', configured); await closePool(); }
    expect((await read()).collections.count).toBe(0);
  });
});
