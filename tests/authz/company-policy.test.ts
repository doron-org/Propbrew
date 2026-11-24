import { describe, expect, it } from 'vitest';
import { availableWorkspaces, canEnterWorkspace, type WorkspaceId } from '@/config/workspaces';
import {
  actorForCompanyMember, canManageCompanyMembers, canUseCompanyModule,
  type CompanyMembershipRecord, type CompanyModuleGrants,
} from '@/lib/auth/company-policy';
import { ACTIONS, CAPABILITIES, can, effectiveLevel, type Actor } from '@/lib/authz';
import { applyScope } from '@/lib/authz/scope';

const MODULES: readonly WorkspaceId[] = ['estate', 'facility', 'shortlet', 'construction'];
const MUTATIONS = ACTIONS.filter((action) => action !== 'read' && action !== 'export');

function membership(overrides: Partial<CompanyMembershipRecord> = {}): CompanyMembershipRecord {
  return {
    membershipId: 'member-lagos', userId: 'account-ade', companyId: 'company-lagos',
    companyRole: 'member', status: 'active', companyStatus: 'active',
    modules: { estate: 'manage' }, estateIds: ['estate-ikeja'], allEstates: false,
    ...overrides,
  };
}

function member(modules: CompanyModuleGrants | undefined, overrides: Partial<CompanyMembershipRecord> = {}): Actor {
  const actor = actorForCompanyMember(membership({ modules, ...overrides }), 'account-ade');
  expect(actor).not.toBeNull();
  return actor!;
}

describe('trusted company membership projection', () => {
  it('binds the company and account to a verified active membership, ignoring supplied legacy roles', () => {
    const record = { ...membership(), roles: ['platform_admin'], tenantId: 'company-abroad' };
    const actor = actorForCompanyMember(record, 'account-ade')!;
    expect(actor.userId).toBe('account-ade');
    expect(actor.tenantId).toBe('company-lagos');
    expect(actor.roles).toEqual(['estate_manager']);
    expect(actor.unitIds).toEqual([]);
    expect(actor.vendorOrgId).toBeNull();
    expect(actor.investorProjectIds).toEqual([]);
    expect(actorForCompanyMember(record, 'account-tunde')).toBeNull();
  });

  it.each(['invited', 'suspended', 'revoked'] as const)('rejects %s memberships', (status) => {
    expect(actorForCompanyMember(membership({ status }), 'account-ade')).toBeNull();
  });

  it('rejects suspended companies, unknown roles/module values and malformed scope records', () => {
    const invalid: unknown[] = [
      membership({ companyStatus: 'suspended' }),
      { ...membership(), companyRole: 'platform_admin' },
      { ...membership(), modules: { estate: 'owner' } },
      { ...membership(), modules: { platform: 'manage' } },
      { ...membership(), estateIds: [''] },
      { ...membership(), allEstates: 'true' },
      { ...membership(), membershipId: '' },
      { ...membership(), companyId: ' company-lagos' },
      { ...membership(), companyId: '*' },
      { ...membership(), modules: Object.create({ construction: 'manage' }) },
    ];
    for (const record of invalid) {
      expect(actorForCompanyMember(record as CompanyMembershipRecord, 'account-ade')).toBeNull();
    }
  });

  it('copies and freezes grants so later DTO changes cannot widen an existing actor', () => {
    const modules: Partial<Record<WorkspaceId, 'manage' | 'view'>> = { estate: 'view' };
    const estateIds = ['estate-ikeja'];
    const actor = actorForCompanyMember(membership({ modules, estateIds }), 'account-ade')!;
    modules.construction = 'manage';
    estateIds.push('estate-abuja');
    expect(actor.companyAccess?.modules).toEqual({ estate: 'view' });
    expect(actor.estateIds).toEqual(['estate-ikeja']);
    expect(Object.isFrozen(actor.companyAccess?.modules)).toBe(true);
  });

  it.each(['owner', 'admin'] as const)('%s defaults to all four managed portals without platform authority', (companyRole) => {
    const actor = member(undefined, { companyRole, modules: undefined, allEstates: true });
    expect(availableWorkspaces(actor).map((workspace) => workspace.id)).toEqual(['estate', 'shortlet', 'construction']);
    expect(actor.roles).toEqual(['estate_manager', 'facility_manager']);
    expect(actor.roles).not.toContain('platform_admin');
    expect(canManageCompanyMembers(actor)).toBe(true);
    for (const capability of CAPABILITIES) {
      expect(can(actor, capability, 'configure').allowed).toBe(false);
      const decision = can(actor, capability, 'read');
      if (decision.allowed) expect(decision.scope.tenantId).toBe('company-lagos');
    }
  });

  it('an ordinary module manager cannot administer company memberships', () => {
    expect(canManageCompanyMembers(member({ estate: 'manage', facility: 'manage' }))).toBe(false);
  });

  it('projects Facility field duties to least-privilege operational roles', () => {
    const technician = member({ facility: 'manage' }, { facilityRole: 'technician' });
    expect(technician.roles).toEqual(['technician']);
    expect(technician.vendorOrgId).toBeNull();
    const vendor = member({ facility: 'manage' }, { facilityRole: 'vendor', vendorOrgId: 'vendor-lagos' });
    expect(vendor.roles).toEqual(['vendor']);
    expect(vendor.vendorOrgId).toBe('vendor-lagos');
    expect(actorForCompanyMember(membership({ modules: { facility: 'manage' }, facilityRole: 'vendor', vendorOrgId: null }), 'account-ade')).toBeNull();
    expect(actorForCompanyMember(membership({ modules: { facility: 'manage' }, facilityRole: 'technician', vendorOrgId: 'vendor-lagos' }), 'account-ade')).toBeNull();
  });

  it('projects a persisted operational profile and its property, block and resident-unit assignments', () => {
    const actor = member({ estate: 'manage' }, {
      operationalProfileId: 'resident',
      estateIds: ['estate-ikeja'], buildingIds: ['block-c'], unitIds: ['unit-c12b'], allEstates: false,
    });
    expect(actor.roles).toEqual(['resident']);
    expect(actor.companyAccess?.operationalProfileId).toBe('resident');
    expect(actor.estateIds).toEqual(['estate-ikeja']);
    expect(actor.buildingIds).toEqual(['block-c']);
    expect(actor.unitIds).toEqual(['unit-c12b']);
    expect(can(actor, 'bookings_amenities', 'create').allowed).toBe(true);
    expect(can(actor, 'reports_analytics', 'read').allowed).toBe(false);
  });

  it('compiles block and unit assignments into the server-side record scope', () => {
    const actor = member({ estate: 'manage' }, {
      operationalProfileId: 'property-manager', estateIds: ['estate-ikeja'],
      buildingIds: ['block-a'], unitIds: ['unit-a1', 'unit-a2'], allEstates: false,
    });
    const decision = can(actor, 'work_orders', 'read');
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('Expected a scoped block-manager grant');
    expect(decision.scope.buildingIds).toEqual(['block-a']);
    expect(decision.scope.unitIds).toEqual(['unit-a1', 'unit-a2']);
    expect(applyScope([
      { id: 'asset-a', tenantId: 'company-lagos', estateId: 'estate-ikeja', buildingId: 'block-a' },
      { id: 'asset-b', tenantId: 'company-lagos', estateId: 'estate-ikeja', buildingId: 'block-b' },
      { id: 'request-a1', tenantId: 'company-lagos', estateId: 'estate-ikeja', unitId: 'unit-a1' },
      { id: 'request-b1', tenantId: 'company-lagos', estateId: 'estate-ikeja', unitId: 'unit-b1' },
    ], decision.scope).map((row) => row.id)).toEqual(['asset-a', 'request-a1']);
  });

  it('rejects forged operational profile grants and vendor profiles without a vendor assignment', () => {
    expect(actorForCompanyMember(membership({
      operationalProfileId: 'resident', modules: { estate: 'view' }, unitIds: ['unit-c12b'],
    }), 'account-ade')).toBeNull();
    expect(actorForCompanyMember(membership({
      operationalProfileId: 'vendor-technician', modules: { facility: 'manage' }, facilityRole: 'vendor', vendorOrgId: null,
    }), 'account-ade')).toBeNull();
  });

  it('a member without module grants has no portal or capability access', () => {
    const actor = member({}, { modules: undefined });
    expect(availableWorkspaces(actor)).toEqual([]);
    for (const capability of CAPABILITIES) {
      for (const action of ACTIONS) expect(can(actor, capability, action).allowed).toBe(false);
      expect(effectiveLevel(actor, capability)).toBe('none');
    }
  });
});

describe('module isolation and reader ceilings', () => {
  for (const workspace of MODULES) {
    it(`${workspace} manager enters only its granted portal and cannot grant platform configuration`, () => {
      const actor = member({ [workspace]: 'manage' });
      expect(availableWorkspaces(actor).map((entry) => entry.id)).toEqual([workspace]);
      for (const other of MODULES) {
        expect(canEnterWorkspace(actor, other)).toBe(other === workspace);
        expect(canUseCompanyModule(actor, other, 'update')).toBe(other === workspace);
      }
      expect(canUseCompanyModule(actor, workspace, 'configure')).toBe(false);
    });

    it(`${workspace} viewer is read-only across all capabilities, even with injected manager roles`, () => {
      const mapped = member({ [workspace]: 'view' });
      const actor: Actor = { ...mapped, roles: ['estate_manager', 'facility_manager', 'executive'] };
      expect(availableWorkspaces(actor).map((entry) => entry.id)).toEqual([workspace]);
      expect(canUseCompanyModule(actor, workspace, 'read')).toBe(true);
      expect(canUseCompanyModule(actor, workspace, 'export')).toBe(true);
      for (const action of MUTATIONS) {
        expect(canUseCompanyModule(actor, workspace, action)).toBe(false);
        for (const capability of CAPABILITIES) expect(can(actor, capability, action).allowed).toBe(false);
      }
      for (const capability of CAPABILITIES) expect(['none', 'V']).toContain(effectiveLevel(actor, capability));
    });
  }

  it('retains estate assignment filters for executive-derived viewers', () => {
    const actor = member({ estate: 'view' });
    const decision = can(actor, 'work_orders', 'read');
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('Expected a scoped viewer grant');
    expect(decision.scope.estateIds).toEqual(['estate-ikeja']);
    const rows = [
      { id: 'own', tenantId: 'company-lagos', estateId: 'estate-ikeja' },
      { id: 'other-estate', tenantId: 'company-lagos', estateId: 'estate-abuja' },
      { id: 'other-company', tenantId: 'company-abuja', estateId: 'estate-ikeja' },
    ];
    expect(applyScope(rows, decision.scope).map((row) => row.id)).toEqual(['own']);
  });

  it('empty assigned estates stays an empty filter for a scoped company viewer', () => {
    const actor = member({ construction: 'view' }, { estateIds: [] });
    const decision = can(actor, 'reports_analytics', 'read');
    expect(decision.allowed && decision.scope.estateIds).toEqual([]);
  });

  it('requires the module action guard when one shared capability has mixed manager/viewer grants', () => {
    const actor = member({ estate: 'view', facility: 'manage' });
    // The facility matrix permits maintaining work orders. That grant does not
    // permit writing an Estate work order through its separate server action.
    expect(can(actor, 'work_orders', 'transition').allowed).toBe(true);
    expect(canUseCompanyModule(actor, 'facility', 'transition')).toBe(true);
    expect(canUseCompanyModule(actor, 'estate', 'transition')).toBe(false);
    expect(canUseCompanyModule(actor, 'construction', 'create')).toBe(false);
    expect(can(actor, 'charges_invoicing', 'update').allowed).toBe(false);
    expect(effectiveLevel(actor, 'charges_invoicing')).toBe('V');
  });

  it('denies malformed company grants and platform-role injection without falling back to legacy access', () => {
    const mapped = member({ estate: 'manage' });
    for (const actor of [
      { ...mapped, companyAccess: null } as unknown as Actor,
      { ...mapped, companyAccess: { ...mapped.companyAccess!, modules: { estate: 'full' } } } as unknown as Actor,
      { ...mapped, roles: ['platform_admin'] } as Actor,
      { ...mapped, tenantId: '*' },
      { ...mapped, companyAccess: { ...mapped.companyAccess!, modules: Object.create({ estate: 'manage' }) } } as Actor,
    ]) {
      expect(canUseCompanyModule(actor, 'estate', 'read')).toBe(false);
      expect(can(actor, 'reports_analytics', 'read').allowed).toBe(false);
      expect(effectiveLevel(actor, 'reports_analytics')).toBe('none');
      expect(canManageCompanyMembers(actor)).toBe(false);
    }
  });

  it('preserves legacy role decisions while rejecting unknown module/verb values', () => {
    const { companyAccess: _companyAccess, ...actor } = member({ estate: 'manage' });
    void _companyAccess;
    expect(availableWorkspaces(actor).map((workspace) => workspace.id)).toEqual(['estate', 'shortlet', 'construction']);
    expect(can(actor, 'charges_invoicing', 'update').allowed).toBe(true);
    expect(canUseCompanyModule(actor, 'not-a-module', 'read')).toBe(false);
    expect(canUseCompanyModule(actor, 'estate', 'delete' as never)).toBe(false);
    expect(canManageCompanyMembers(actor)).toBe(false);
  });
});
