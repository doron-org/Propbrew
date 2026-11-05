import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenant } from '@/server/db';
import { runMigrations } from '../../scripts/migrate.mjs';

// Opt in with a disposable local database; never use an application database.
const testUrl = process.env.PROPBREW_TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) throw new Error('Postgres integration tests require a disposable loopback database.');
const tenantA = randomUUID();
const tenantB = randomUUID();
const runtimeRole = `review_runtime_${randomUUID().replaceAll('-', '')}`;
let admin: Client;

describe.skipIf(!testUrl)('native Postgres migrations and tenant isolation', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: testUrl });
    await admin.connect();
    await runMigrations({ url: testUrl });
    await admin.query(`create role ${runtimeRole} login nosuperuser nocreatedb nocreaterole`);
    await admin.query(`grant usage on schema public to ${runtimeRole}`);
    await admin.query(`grant select, insert, update, delete on all tables in schema public to ${runtimeRole}`);
    await admin.query(`grant execute on function demo_sandbox_access(uuid,boolean) to ${runtimeRole}`);
    await admin.query('insert into tenants(id, name) values ($1, $2), ($3, $4)', [tenantA, 'Review A', tenantB, 'Review B']);
    const runtimeUrl = new URL(testUrl!);
    runtimeUrl.username = runtimeRole;
    vi.stubEnv('DATABASE_URL', runtimeUrl.toString());
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    const state = globalThis as { __propbrewPgPool?: { pool: { end(): Promise<void> } } };
    await state.__propbrewPgPool?.pool.end();
    delete state.__propbrewPgPool;
    await admin?.end();
  });

  it('applies all migrations and reruns without replaying them', async () => {
    await runMigrations({ url: testUrl });
    const migrations = await admin.query('select filename from schema_migrations order by filename');
    expect(migrations.rows).toHaveLength(21);
    expect(migrations.rows.at(-1)?.filename).toBe('022_construction_field_photos.sql');
    const functions = await admin.query("select proname from pg_proc where proname in ('reserve_copilot_budget', 'finish_copilot_budget')");
    expect(functions.rows).toHaveLength(2);
  });

  it('enforces RLS across tenants and clears context when a connection is reused', async () => {
    const hostile = "'; drop table domain_rows; --";
    await withTenant(tenantA, (query) => query`insert into domain_rows(tenant_id, entity, row_id, payload) values (${tenantA}::uuid, 'review', 'row-a', ${JSON.stringify({ label: hostile })}::jsonb)`);
    const own = await withTenant(tenantA, (query) => query`select payload from domain_rows where entity = 'review'`);
    expect(own).toEqual([{ payload: { label: hostile } }]);
    expect(await withTenant(tenantB, (query) => query`select payload from domain_rows where entity = 'review'`)).toEqual([]);
    const pool = (globalThis as { __propbrewPgPool?: { pool: Pool } }).__propbrewPgPool!.pool;
    const reused = await pool.connect();
    try {
      expect((await reused.query("select nullif(current_setting('app.tenant_id', true), '') as tenant")).rows).toEqual([{ tenant: null }]);
      expect((await reused.query("select payload from domain_rows where entity = 'review'")).rows).toEqual([]);
    } finally { reused.release(); }
  });

  it('keeps concurrent tenants isolated through the bounded connection pool', async () => {
    const tenants = Array.from({ length: 12 }, (_, index) => index % 2 ? tenantA : tenantB);
    const contexts = await Promise.all(tenants.map((tenant) => withTenant(tenant, (query) => query`select current_setting('app.tenant_id') as tenant`)));
    expect(contexts).toEqual(tenants.map((tenant) => [{ tenant }]));
  });

  it('runs the dollar-quoted budget functions with exact usage persisted', async () => {
    const requestId = randomUUID();
    const reserve = await withTenant(tenantA, (query) => query`select * from reserve_copilot_budget(${tenantA}::uuid, ${requestId}::uuid, 'reviewer', 'estate', 'test-model', 50::bigint, 100::bigint, 100::bigint)`);
    expect(reserve).toEqual([{ allowed: true, reason: null }]);
    const finish = await withTenant(tenantA, (query) => query`select finish_copilot_budget(${tenantA}::uuid, ${requestId}::uuid, 10::bigint, 5::bigint, 7::bigint, 'complete', 'redacted', 'answer', 'sample') as recorded`);
    expect(finish).toEqual([{ recorded: true }]);
    expect(await withTenant(tenantA, (query) => query`select status, cost_minor_ngn::text as cost from ai_copilot_usage where request_id = ${requestId}::uuid`)).toEqual([{ status: 'complete', cost: '7' }]);
    expect(await withTenant(tenantB, (query) => query`select * from ai_copilot_usage`)).toEqual([]);
  });

  it('rolls back a failed migration together with its migration marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'propbrew-migration-test-'));
    try {
      await writeFile(join(directory, '007_failed_review.sql'), 'create table review_migration_rollback (id integer); select * from table_that_does_not_exist;');
      await expect(runMigrations({ url: testUrl, directory })).rejects.toThrow();
      expect((await admin.query("select to_regclass('review_migration_rollback') as relation")).rows).toEqual([{ relation: null }]);
      expect((await admin.query("select filename from schema_migrations where filename = '007_failed_review.sql'")).rows).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
