import { describe, expect, it } from 'vitest';
import { MATRIX, ROLES, can, type Actor, type Role } from '@/lib/authz';
import { PAGE_META, visibleNav } from '@/config/nav';
import {
  WORKSPACES,
  availableWorkspaces,
  canEnterWorkspace,
  propertyManagementWorkspace,
  workspaceById,
  workspaceForPath,
  type WorkspaceId,
} from '@/config/workspaces';

function actor(roles: readonly Role[], overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'operator-1', tenantId: 'tenant-1', roles,
    estateIds: ['estate-1'], allEstates: false, unitIds: ['unit-1'],
    vendorOrgId: 'vendor-1', investorProjectIds: ['project-1'],
    ...overrides,
  };
}

const EXPECTED: Record<Role, WorkspaceId[]> = {
  platform_admin: [],
  executive: ['estate', 'facility', 'shortlet', 'construction'],
  estate_manager: ['estate', 'facility', 'shortlet', 'construction'],
  facility_manager: ['estate', 'facility', 'construction'],
  technician: ['facility'],
  resident: [],
  security: ['estate'],
  vendor: [],
  investor: [],
};
const PUBLIC_EXPECTED: Record<Role, WorkspaceId[]> = Object.fromEntries(
  Object.entries(EXPECTED).map(([role, grants]) => [role, grants.filter((id) => id !== 'facility' || !grants.includes('estate'))]),
) as Record<Role, WorkspaceId[]>;

describe('operator workspace registry', () => {
  it('keeps white workspace button labels at accessible contrast', () => {
    for (const { accent } of WORKSPACES) {
      const channels = [1, 3, 5].map((start) => {
        const value = parseInt(accent.slice(start, start + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('defines exactly four distinct portals, each with a real home and four highlights', () => {
    expect(WORKSPACES.map((workspace) => workspace.id)).toEqual(['estate', 'facility', 'shortlet', 'construction']);
    expect(new Set(WORKSPACES.map((workspace) => workspace.home)).size).toBe(4);
    for (const workspace of WORKSPACES) {
      expect(workspaceById(workspace.id)).toBe(workspace);
      expect(workspace.highlights).toHaveLength(4);
      expect(workspace.features).toHaveLength(3);
      expect(workspaceForPath(workspace.home)).toBe(workspace.id);
      expect(workspace.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(workspace.description.length).toBeGreaterThan(10);
      expect(workspace.audience.length).toBeGreaterThan(10);
      expect(PAGE_META[workspace.home]).toBeDefined();
    }
  });

  it.each(ROLES)('limits %s to existing operator grants', (role) => {
    const person = actor([role]);
    expect(availableWorkspaces(person).map((workspace) => workspace.id)).toEqual(PUBLIC_EXPECTED[role]);
    for (const workspace of WORKSPACES) {
      expect(canEnterWorkspace(person, workspace.id)).toBe(EXPECTED[role].includes(workspace.id));
    }
  });

  it.each([null, '', '   '])('fails closed without an explicit tenant (%s)', (tenantId) => {
    const person = actor(['estate_manager', 'executive'], { tenantId });
    expect(availableWorkspaces(person)).toEqual([]);
    for (const workspace of WORKSPACES) expect(canEnterWorkspace(person, workspace.id)).toBe(false);
  });

  it('never turns a platform administrator into a tenant operator, including mixed roles', () => {
    for (const role of ROLES) {
      expect(availableWorkspaces(actor(['platform_admin', role]))).toEqual([]);
    }
  });

  it('supports mixed operator roles without granting own-record roles their own operator portal', () => {
    expect(availableWorkspaces(actor(['security', 'technician'])).map((workspace) => workspace.id))
      .toEqual(['estate']);
    expect(availableWorkspaces(actor(['resident', 'vendor', 'investor']))).toEqual([]);
    expect(availableWorkspaces(actor(['resident', 'estate_manager'])).map((workspace) => workspace.id))
      .toEqual(PUBLIC_EXPECTED.estate_manager);
    expect(availableWorkspaces(actor(['invented-role' as Role]))).toEqual([]);
  });

  it.each([undefined, null, '', 'admin', 'ESTATE', 'estate/../facility', {}, [], 0, '__proto__', 'constructor'])
    ('rejects an unknown workspace identifier (%s)', (id) => {
      expect(workspaceById(id)).toBeUndefined();
      expect(canEnterWorkspace(actor(['executive']), id)).toBe(false);
    });

  it('does not mutate an actor, tenant, ownership scope or the authorization matrix', () => {
    const person = actor(['technician']);
    Object.freeze(person.roles);
    Object.freeze(person.estateIds);
    Object.freeze(person.unitIds);
    Object.freeze(person.investorProjectIds);
    Object.freeze(person);
    const originalActor = JSON.stringify(person);
    const originalMatrix = JSON.stringify(MATRIX);
    const originalDecision = can(person, 'work_orders', 'read');
    for (const workspace of WORKSPACES) {
      canEnterWorkspace(person, workspace.id);
      visibleNav('ops', person, workspace.id);
    }
    availableWorkspaces(person);
    expect(JSON.stringify(person)).toBe(originalActor);
    expect(JSON.stringify(MATRIX)).toBe(originalMatrix);
    expect(can(person, 'work_orders', 'read')).toEqual(originalDecision);
    if (originalDecision.allowed) {
      expect(originalDecision.scope.tenantId).toBe('tenant-1');
      expect(originalDecision.scope.estateIds).toEqual(['estate-1']);
      expect(originalDecision.scope.ownership).not.toBeNull();
    }
  });

  it('shows one property workspace without widening the Estate or Facility grants', () => {
    const technician = actor(['technician']);
    const property = propertyManagementWorkspace(technician);
    expect(property).toMatchObject({ id: 'facility', name: 'Property Management', home: '/property-management' });
    expect(canEnterWorkspace(technician, 'estate')).toBe(false);
    expect(canEnterWorkspace(technician, 'facility')).toBe(true);
    expect(availableWorkspaces(technician)).toHaveLength(1);
  });
});

describe('safe workspace route classification', () => {
  const legacy: Record<WorkspaceId, string[]> = {
    estate: ['/estate', '/community', '/billing', '/collections', '/people', '/properties', '/tenancy', '/announcements', '/governance', '/board', '/rewards', '/bookings', '/events', '/security', '/parcels', '/marketplace', '/documents', '/portfolio', '/reports', '/investors', '/settings'],
    facility: ['/facility', '/field', '/control-center', '/copilot', '/work-orders', '/assets', '/ppm', '/inspections', '/energy', '/inventory', '/contracts', '/safety', '/access', '/sustainability', '/spaces', '/vendors'],
    shortlet: ['/shortlet'],
    construction: ['/construction'],
  };

  for (const [id, paths] of Object.entries(legacy)) {
    it.each(paths)(`keeps ${id} route %s and its detail pages inside that module`, (path) => {
      expect(workspaceForPath(path)).toBe(id);
      expect(workspaceForPath(`${path}/`)).toBe(id);
      expect(workspaceForPath(`${path}/record-1/details`)).toBe(id);
      expect(workspaceForPath(`${path}?status=open#records`)).toBe(id);
      expect(workspaceForPath(`${path}-other`)).toBeNull();
    });
  }

  it.each([
    '/', '/dashboard', '/dashboard/details', '/workspaces', '/portal', '/portal/requests',
    '/admin', '/admin/tenants', '/api', '/api/work-orders', '/unknown',
    '/shortlets', '/constructionist', '/facility-manager', '/estate-other',
    'https://example.com/estate', 'javascript:/estate', '//example.com/estate',
    'estate', ' /estate', '/estate\\other', '/estate//details', '/estate/../facility',
    '/estate/./details', '/estate/%2e%2e/facility', '/estate/%252e%252e/facility',
    '/estate%2ffacility', '/estate/%5csecurity', '/estate/%00', '/estate/%0a',
    '/estate/%ZZ', '/estate/%', '/estate/%3fhidden', '/estate\n',
  ])('does not infer a workspace from an unrelated or malformed path (%s)', (path) => {
    expect(workspaceForPath(path)).toBeNull();
  });
});

describe('workspace-scoped operator navigation', () => {
  it('sections every operator rail by business purpose', () => {
    const person = actor(['executive']);
    const expected: Record<WorkspaceId, string[]> = {
      estate: ['Overview', 'Property portfolio', 'Estate insights'],
      facility: ['Overview', 'Facility operations', 'Asset care', 'Building services', 'Facility commercial'],
      shortlet: ['Shortlet overview', 'Reservations', 'Guest operations', 'Revenue & growth', 'Workspace'],
      construction: ['Construction overview', 'Planning & controls', 'Commercial & procurement', 'Site delivery', 'Collaboration & intelligence'],
    };

    for (const workspace of WORKSPACES) {
      expect(visibleNav('ops', person, workspace.id).map((group) => group.label)).toEqual(expected[workspace.id]);
    }
  });

  it.each(['executive', 'estate_manager', 'facility_manager'] as const)
    ('puts estate overview, properties and portfolio intelligence first for %s without duplicates', (role) => {
      const items = visibleNav('ops', actor([role]), 'estate').flatMap((group) => group.items);
      expect(items.slice(0, 3).map(({ label, href }) => ({ label, href }))).toEqual([
        { label: 'Estate overview', href: '/estate' },
        { label: 'Properties', href: '/properties' },
        { label: 'Portfolio', href: '/portfolio' },
      ]);
      expect(items.filter((item) => item.id === 'properties')).toHaveLength(1);
      expect(items.some((item) => item.href === '/people' || item.href === '/tenancy')).toBe(false);
      expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
      expect(items.find((item) => item.id === 'properties')).toMatchObject({ capability: 'assets_ppm' });
      expect(PAGE_META['/properties']).toMatchObject({ title: 'Properties' });
    });

  it('preserves the estate order for a mixed manager/resident without duplicate navigation', () => {
    const items = visibleNav('ops', actor(['estate_manager', 'resident']), 'estate').flatMap((group) => group.items);
    expect(items.slice(0, 3).map((item) => item.href)).toEqual(['/estate', '/properties', '/portfolio']);
    expect(items.filter((item) => item.href === '/people')).toHaveLength(0);
    expect(items.filter((item) => item.href === '/properties')).toHaveLength(1);
  });

  it('does not expose estate properties or residents to a security-only actor', () => {
    const person = actor(['security']);
    const items = visibleNav('ops', person, 'estate').flatMap((group) => group.items);
    expect(items[0]?.href).toBe('/estate');
    expect(can(person, 'assets_ppm', 'read').allowed).toBe(false);
    expect(can(person, 'users_roles', 'read').allowed).toBe(false);
    expect(items.some((item) => item.href === '/properties' || item.href === '/people')).toBe(false);
  });

  it('keeps the estate property register out of every other operator module', () => {
    for (const id of ['facility', 'shortlet', 'construction'] as const) {
      const items = visibleNav('ops', actor(['executive']), id).flatMap((group) => group.items);
      expect(items.some((item) => item.href === '/properties' || item.href === '/people')).toBe(false);
      expect(items[0]?.href).toBe(`/${id}`);
    }
  });

  it.each(ROLES)('requires explicit workspace context for %s', (role) => {
    expect(visibleNav('ops', actor([role]))).toEqual([]);
  });

  it.each(ROLES)('never mixes module links or bypasses capabilities for %s', (role) => {
    const person = actor([role]);
    for (const workspace of WORKSPACES) {
      const nav = visibleNav('ops', person, workspace.id);
      if (!canEnterWorkspace(person, workspace.id)) {
        expect(nav).toEqual([]);
        continue;
      }
      const items = nav.flatMap((group) => group.items);
      expect(items.some((item) => item.href === workspace.home)).toBe(true);
      expect(items.some((item) => item.href === '/dashboard')).toBe(false);
      for (const item of items) {
        expect(workspaceForPath(item.href)).toBe(workspace.id);
        expect(can(person, item.capability, 'read').allowed).toBe(true);
        if (item.roles) expect(item.roles.some((allowed) => person.roles.includes(allowed))).toBe(true);
      }
    }
  });

  it('uses a security-readable estate home, not the reports capability', () => {
    const nav = visibleNav('ops', actor(['security']), 'estate');
    const home = nav.flatMap((group) => group.items).find((item) => item.href === '/estate');
    expect(home).toMatchObject({ id: 'estate-home', capability: 'announcements' });
    expect(nav.flatMap((group) => group.items).some((item) => item.href === '/billing')).toBe(false);
  });

  it('fails closed for unknown workspaces, missing tenants and mixed platform-administrator roles', () => {
    expect(visibleNav('ops', actor(['executive']), 'unknown' as WorkspaceId)).toEqual([]);
    expect(visibleNav('ops', actor(['executive'], { tenantId: null }), 'estate')).toEqual([]);
    expect(visibleNav('ops', actor(['executive', 'platform_admin']), 'estate')).toEqual([]);
  });

  it('leaves own-record and platform navigation independent of operator workspace selection', () => {
    const resident = actor(['resident']);
    const vendor = actor(['vendor']);
    const investor = actor(['investor']);
    const admin = actor(['platform_admin'], { tenantId: null });
    for (const person of [resident, vendor, investor]) {
      const nav = visibleNav('portal', person);
      expect(nav.length).toBeGreaterThan(0);
      expect(visibleNav('portal', person, 'estate')).toEqual(nav);
      for (const item of nav.flatMap((group) => group.items)) expect(item.href.startsWith('/portal')).toBe(true);
    }
    const adminNav = visibleNav('admin', admin);
    expect(adminNav.length).toBeGreaterThan(0);
    expect(visibleNav('admin', admin, 'facility')).toEqual(adminNav);
    expect(adminNav.flatMap((group) => group.items).every((item) => item.href.startsWith('/admin/'))).toBe(true);
  });
});
