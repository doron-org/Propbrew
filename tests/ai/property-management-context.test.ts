import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/lib/authz';
import type { Site } from '@/domain/entities';
import type { CopilotContext } from '@/lib/ai/copilot-protocol';

const contexts = vi.hoisted(() => ({ estate: vi.fn(), facility: vi.fn() }));
vi.mock('@/server/ai/context/estate', () => ({ buildEstateContext: contexts.estate }));
vi.mock('@/server/ai/context/facility', () => ({ buildFacilityContext: contexts.facility }));

import { buildPropertyManagementContext } from '@/server/ai/context/property-management';

const actor: Actor = { userId: 'manager-a', tenantId: 'tenant-a', roles: ['estate_manager'], estateIds: ['estate-a', 'estate-b'], allEstates: false, unitIds: [], vendorOrgId: null, investorProjectIds: [] };
const site = { id: 'estate-a', tenantId: 'tenant-a', kind: 'estate', name: 'Estate A' } as Site;
const base = (module: 'estate' | 'facility', facts: Record<string, unknown>): CopilotContext => ({ module, facts, scopeLabel: 'Portfolio', snapshotISO: '2026-11-24T10:00:00.000Z', coverage: [], sources: [], notices: [] });

describe('combined property AI retrieval', () => {
  it('keeps only selected site-linked Estate and building records', async () => {
    contexts.estate.mockResolvedValue(base('estate', { workOrders: [{ siteId: 'estate-a', title: 'SITE_A_JOB' }, { siteId: 'estate-b', title: 'OTHER_SITE_SECRET' }], companyFinance: { note: 'TENANT_SECRET' } }));
    contexts.facility.mockResolvedValue(base('facility', { assets: [{ siteId: 'estate-a', name: 'SITE_A_ASSET' }, { siteId: 'estate-b', name: 'OTHER_ASSET_SECRET' }], monthlyUtilities: [{ month: 'November', value: 'UNSCOPED_SECRET' }] }));
    const context = await buildPropertyManagementContext(actor, 'estate', site);
    const serialized = JSON.stringify(context);
    expect(serialized).toContain('SITE_A_JOB');
    expect(serialized).toContain('SITE_A_ASSET');
    expect(serialized).not.toContain('OTHER_SITE_SECRET');
    expect(serialized).not.toContain('OTHER_ASSET_SECRET');
    expect(serialized).not.toContain('TENANT_SECRET');
    expect(serialized).not.toContain('UNSCOPED_SECRET');
    expect(context.sources.every((source) => source.href.startsWith('/property-management') || source.href === '/properties/estate-a')).toBe(true);
  });
});
