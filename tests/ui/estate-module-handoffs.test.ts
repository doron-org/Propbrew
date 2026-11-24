import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { Notification } from '@/server/data/inbox';
import type { WorkspaceId } from '@/config/workspaces';
import type { NavGroup } from '@/config/nav';
import { identityByKey } from '@/server/identities';

const boundary = vi.hoisted(() => ({
  getActor: vi.fn(), getSession: vi.fn(), requireOperatorSession: vi.fn(),
  getNotifications: vi.fn(),
  estateWorkOrders: vi.fn(() => []),
  workOrders: vi.fn(() => ({ items: [], total: 0, cursor: null })),
  invoices: vi.fn(() => ({ items: [], total: 0, cursor: null })),
  sosEvents: vi.fn(() => ({ items: [], total: 0, cursor: null })),
  vendors: vi.fn(() => ({ items: [], total: 0, cursor: null })),
  residents: vi.fn(() => ({ items: [], total: 0, cursor: null })),
  sites: vi.fn<() => Array<{ id: string; name: string; kind: string }>>(() => []),
}));

vi.mock('@/server/session', () => ({ getActor: boundary.getActor, getSession: boundary.getSession, devIdentityEnabled: () => false }));
vi.mock('@/server/workspaces', () => ({ requireOperatorSession: boundary.requireOperatorSession }));
vi.mock('@/server/reads/estate-work-orders', () => ({ listEstateWorkOrders: boundary.estateWorkOrders }));
vi.mock('@/server/onboarding/identity', () => ({ getOwnerIdentity: vi.fn() }));
vi.mock('@/components/app-shell', () => ({ AppShell: () => null }));
vi.mock('@/components/dev/role-switcher', () => ({ RoleSwitcher: () => null }));
vi.mock('@/config/nav', () => ({ visibleNav: () => [] }));
vi.mock('@/server/data/inbox', () => ({
  getNotifications: boundary.getNotifications, unreadNotificationCount: () => 2,
  getThreads: () => [], unreadThreadCount: () => 0,
}));
vi.mock('@/server/data', () => ({
  repos: {
    workOrders: { list: boundary.workOrders }, invoices: { list: boundary.invoices },
    sosEvents: { list: boundary.sosEvents }, vendors: { list: boundary.vendors },
    residents: { list: boundary.residents }, sites: { all: boundary.sites },
  },
  seed: { sites: [] },
}));

import { ShellFrame } from '@/components/shell-frame';
import { askData } from '@/server/actions/ask-data';

const notification = (href?: string): Notification => ({
  id: `notice-${href ?? 'plain'}`, title: 'Maintenance update', body: 'Review the request.',
  at: '2026-10-23T09:00:00Z', read: false, kind: 'info', href,
});

function actAs(key = 'estate_manager') {
  const session = identityByKey(key);
  boundary.getActor.mockResolvedValue(session.actor);
  boundary.getSession.mockResolvedValue(session);
  boundary.requireOperatorSession.mockResolvedValue(session);
  return session.actor;
}

async function frameNotifications(workspace: WorkspaceId) {
  const frame = await ShellFrame({ expected: 'ops', workspace, children: null });
  return (frame as ReactElement<{ notifications: Notification[]; unreadNotifications: number; groups: NavGroup[]; workspace: { home: string; name: string } }>).props;
}

beforeEach(() => {
  vi.clearAllMocks();
  actAs();
  boundary.getNotifications.mockReturnValue([]);
});

describe('Estate notification navigation context', () => {
  it('places estate properties and facility sites in the same Property Management rail', async () => {
    boundary.sites.mockReturnValue([
      { id: 'estate-1', name: 'Lagos Gardens', kind: 'estate' },
      { id: 'facility-1', name: 'Tower Plant', kind: 'facility' },
    ]);
    const { groups, workspace } = await frameNotifications('estate');
    expect(workspace).toMatchObject({ home: '/property-management', name: 'Property Management' });
    expect(groups.map((group) => group.label)).toEqual(['Property management', 'Lagos Gardens', 'Tower Plant · Facilities']);
    expect(groups[1].items.map((item) => item.label)).toContain('Asset care');
    const propertyItems = groups[1].items;
    expect(propertyItems.find((item) => item.label === 'Asset care')?.href).toBe('/properties/estate-1/asset-care');
    expect(propertyItems.find((item) => item.label === 'Building services')?.children?.map((item) => item.label)).toEqual(expect.arrayContaining(['Spaces', 'Sustainability']));
    expect(propertyItems.find((item) => item.label === 'Operations')?.children?.map((item) => item.label)).toEqual(expect.arrayContaining(['Field jobs', 'Vendors & contractors']));
    expect(propertyItems.find((item) => item.label === 'Intelligence')?.children?.map((item) => item.label)).toContain('Ask building Copilot');
    expect(groups[2].items.map((item) => item.label)).toContain('Building services');
  });

  it.each([
    ['/work-orders', '/estate/work-orders'],
    ['/work-orders/WO-24817', '/estate/work-orders/WO-24817'],
    ['/work-orders?status=resolved', '/estate/work-orders?status=resolved'],
    ['/work-orders/WO-24817#history', '/estate/work-orders/WO-24817#history'],
  ])('keeps %s inside Estate without mutating the stored notification', async (href, expected) => {
    const original = notification(href);
    boundary.getNotifications.mockReturnValue([original]);
    const props = await frameNotifications('estate');
    expect(props.notifications[0]).toEqual({ ...original, href: expected });
    expect(original.href).toBe(href);
    expect(props.notifications[0]).not.toBe(original);
    expect(props.unreadNotifications).toBe(2);
  });

  it.each(['facility', 'shortlet', 'construction'] as const)('preserves the original destination in %s', async (workspace) => {
    const original = notification('/work-orders/WO-24817');
    boundary.getNotifications.mockReturnValue([original]);
    expect((await frameNotifications(workspace)).notifications).toEqual([original]);
  });

  it.each(['/billing', '/portal/requests', '/work-orders-archive', 'https://example.test/work-orders', undefined])('does not rewrite unrelated destination %s', async (href) => {
    const original = notification(href);
    boundary.getNotifications.mockReturnValue([original]);
    expect((await frameNotifications('estate')).notifications[0]).toBe(original);
  });

  it('does not offer a work-order link to an Estate actor without the read grant', async () => {
    actAs('security');
    const original = notification('/work-orders/WO-24817');
    boundary.getNotifications.mockReturnValue([original]);
    const { notifications } = await frameNotifications('estate');
    expect(notifications[0]).toEqual({ ...original, href: undefined });
    expect(original.href).toBe('/work-orders/WO-24817');
  });
});

describe('Estate report answer destinations', () => {
  it.each(['overdue maintenance', 'open work orders', 'preventive maintenance'])('keeps %s evidence links inside Estate', async (question) => {
    const actor = actAs();
    const answer = await askData(question);
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].href).toBe('/estate/work-orders');
    expect(boundary.estateWorkOrders).toHaveBeenCalledWith(actor);
    expect(boundary.workOrders).not.toHaveBeenCalled();
  });

  it('uses Estate properties rather than Facility spaces for occupancy evidence', async () => {
    const answer = await askData('resident occupancy');
    expect(answer.sources).toEqual([{ label: 'Residents', href: '/people' }, { label: 'Properties', href: '/properties' }]);
  });

  it('retains a scoped vendor answer without an implicit Facility handoff', async () => {
    const actor = actAs();
    const answer = await askData('vendors');
    expect(answer.matched).toBe(true);
    expect(answer.sources).toEqual([]);
    expect(boundary.vendors).toHaveBeenCalledWith(actor);
  });

  it('preserves finance denial instead of offering a link to an unavailable page', async () => {
    actAs('facility_manager');
    const answer = await askData('collection rate');
    expect(answer.answer).toContain('doesn’t have access to billing data');
    expect(answer.sources).toEqual([]);
    expect(boundary.invoices).not.toHaveBeenCalled();
  });
});
