import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operatingClock, operatingDateISO, operatingNowISO } from '@/server/operating-clock';
import { NOW, NOW_MS } from '@/domain/ppm';
import { blankCompanyWorkspaceState, db } from '@/server/data/store';
import { runWithRecordContext } from '@/server/data/record-context';
import { actorForCompanyMember } from '@/lib/auth/company-policy';
import { createProject } from '@/server/actions/construction';

const boundary = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock('@/server/session', () => ({ getActor: boundary.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T23:30:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('native company operating time', () => {
  it('preserves the exact historical demo clock regardless of the machine date', () => {
    vi.stubEnv('PROPBREW_AUTH_MODE', '');
    expect(operatingClock()).toEqual({ iso: NOW, nowMs: NOW_MS, dateISO: NOW, native: false });
  });
  it('evaluates the current instant per request and uses the WAT day across UTC midnight boundaries', () => {
    vi.stubEnv('PROPBREW_AUTH_MODE', 'company');
    expect(operatingClock()).toEqual({ iso: '2026-10-24T23:30:00.000Z', nowMs: Date.parse('2026-10-24T23:30:00Z'), dateISO: '2026-10-25', native: true });
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    expect(operatingDateISO()).toBe('2026-10-26'); expect(operatingNowISO()).toBe('2026-10-26T10:00:00.000Z');
  });
  it('creates a native project on the current WAT date without borrowing a sample client name', async () => {
    vi.stubEnv('PROPBREW_AUTH_MODE', 'company');
    const tenant = '12345678-1234-4234-8234-123456789abc';
    const actor = actorForCompanyMember({ membershipId: 'member-own', userId: 'owner-own', companyId: tenant, status: 'active', companyStatus: 'active', companyRole: 'owner', estateIds: [], allEstates: true }, 'owner-own')!;
    boundary.actor.mockResolvedValue(actor);
    const state = blankCompanyWorkspaceState();
    await runWithRecordContext({ state, domainTenantId: tenant, mode: 'write' }, async () => {
      expect((await createProject({ name: 'Own company project', location: 'Abuja', clientName: '', contractNaira: 100, budgetNaira: 90, plannedFinishISO: '2027-01-01', projectType: 'commercial', region: 'FCT, Nigeria' })).ok).toBe(true);
      expect(db.constructionProjects[0]).toMatchObject({ tenantId: tenant, startISO: '2026-10-25', clientName: 'Not recorded' });
      expect(JSON.stringify(db.constructionProjects[0])).not.toContain('7 Fifteen');
    });
  });
});
