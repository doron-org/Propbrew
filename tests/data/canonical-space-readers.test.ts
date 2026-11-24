import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assertCan, type Actor, type Capability, type Action } from '@/lib/authz';
import { identityByKey } from '@/server/identities';
import type { Building, Resident, Site, Unit, WorkOrder } from '@/domain/entities';
import { asId } from '@/domain/ids';
import { money } from '@/domain/primitives';

const boundary = vi.hoisted(() => ({
  getActor: vi.fn(), getSession: vi.fn(), requireCapability: vi.fn(),
  spaces: vi.fn<(props: unknown) => null>(() => null), people: vi.fn<(props: unknown) => null>(() => null), field: vi.fn<(props: unknown) => null>(() => null),
  creation: vi.fn<(props: unknown) => null>(() => null),
  revalidatePath: vi.fn(),
}));
vi.mock('@/server/session', () => ({ getActor: boundary.getActor, getSession: boundary.getSession, devIdentityEnabled: () => true }));
vi.mock('@/server/guard', () => ({ requireCapability: boundary.requireCapability }));
vi.mock('next/cache', () => ({ revalidatePath: boundary.revalidatePath }));
vi.mock('@/components/spaces/spaces-explorer', () => ({ SpacesExplorer: boundary.spaces }));
vi.mock('@/components/people/residents-explorer', () => ({ ResidentsExplorer: boundary.people }));
vi.mock('@/components/workspaces/estate-create-actions', () => ({ EstateCreateActions: boundary.creation }));
vi.mock('@/components/facility/technician-workspace', () => ({ TechnicianWorkspace: boundary.field }));

import SpacesPage from '@/app/(ops)/(facility)/spaces/page';
import PeoplePage from '@/app/(ops)/(estate)/people/page';
import FieldPage from '@/app/(ops)/(facility)/field/page';
import { raiseSos } from '@/server/actions/transitions';
import { repos } from '@/server/data';
import { db } from '@/server/data/store';

const original = {
  sites: [...db.sites], buildings: [...db.buildings], units: [...db.units],
  residents: [...db.residents], workOrders: [...db.workOrders], sosEvents: [...db.sosEvents],
};

function actAs(key: string, overrides: Partial<Actor> = {}) {
  const session = identityByKey(key);
  const actor = { ...session.actor, ...overrides };
  boundary.getActor.mockResolvedValue(actor);
  boundary.getSession.mockResolvedValue({ ...session, actor });
  boundary.requireCapability.mockImplementation(async (capability: Capability, action: Action = 'read') => ({ actor, scope: assertCan(actor, capability, action) }));
  return actor;
}

function newSite(overrides: Partial<Site> = {}): Site {
  return { tenantId: asId<Site['tenantId']>('t-lekki'), id: asId<Site['id']>('new-site'), kind: 'estate', name: 'New canonical property', address: 'Lagos', buildingCount: 1, unitCount: 1, ...overrides };
}
function newBuilding(overrides: Partial<Building> = {}): Building {
  return { tenantId: asId<Building['tenantId']>('t-lekki'), id: asId<Building['id']>('new-building'), siteId: asId<Site['id']>('new-site'), name: 'New canonical building', floors: 2, ...overrides };
}
function newUnit(overrides: Partial<Unit> = {}): Unit {
  return { tenantId: asId<Unit['tenantId']>('t-lekki'), id: asId<Unit['id']>('new-unit'), siteId: asId<Site['id']>('new-site'), buildingId: asId<Building['id']>('new-building'), label: 'New canonical unit', type: 'Apartment', occupancy: 'occupied', ...overrides };
}
function newResident(overrides: Partial<Resident> = {}): Resident {
  return { tenantId: asId<Resident['tenantId']>('t-lekki'), id: asId<Resident['id']>('new-resident'), userId: asId<Resident['userId']>('unlinked-resident-record'), name: 'New resident record', email: 'resident@example.test', unitId: asId<Unit['id']>('new-unit'), siteId: asId<Site['id']>('new-site'), status: 'active', household: 1, balance: money(45_000), moveInDate: '2026-10-23', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  actAs('estate_manager');
});
afterEach(() => {
  for (const key of ['sites', 'buildings', 'units', 'residents', 'workOrders', 'sosEvents'] as const) {
    const rows = db[key] as unknown[];
    rows.splice(0, rows.length, ...original[key]);
  }
  vi.restoreAllMocks();
});

describe('canonical property and tenant page readers', () => {
  it('shows a newly created scoped property, building, unit and resident in Spaces', async () => {
    const actor = actAs('facility_manager', { estateIds: ['new-site'] });
    db.sites.push(newSite()); db.buildings.push(newBuilding()); db.units.push(newUnit()); db.residents.push(newResident());
    renderToStaticMarkup(await SpacesPage({ searchParams: Promise.resolve({}) }));
    const props = boundary.spaces.mock.calls[0][0] as unknown as { sites: Site[]; buildings: Building[]; units: (Unit & { residentName?: string })[] };
    expect(props.sites.map((site) => site.name)).toEqual(['New canonical property']);
    expect(props.buildings.map((building) => building.name)).toEqual(['New canonical building']);
    expect(props.units).toMatchObject([{ id: 'new-unit', label: 'New canonical unit', residentName: 'New resident record' }]);
    expect(actor.estateIds).toEqual(['new-site']);
  });

  it('does not leak newly created same-tenant unassigned or foreign property metadata', async () => {
    db.sites.push(newSite()); db.buildings.push(newBuilding()); db.units.push(newUnit()); db.residents.push(newResident());
    db.sites.push(newSite({ tenantId: asId<Site['tenantId']>('foreign-tenant'), id: asId<Site['id']>('foreign-site'), name: 'FOREIGN_SECRET' }));
    renderToStaticMarkup(await SpacesPage({ searchParams: Promise.resolve({}) }));
    const props = boundary.spaces.mock.calls[0][0];
    const payload = JSON.stringify(props);
    expect(payload).not.toContain('New canonical');
    expect(payload).not.toContain('FOREIGN_SECRET');
  });

  it('preserves resident contact and unit details in People without a synthetic auth user', async () => {
    actAs('estate_manager', { estateIds: ['new-site'] });
    db.sites.push(newSite()); db.buildings.push(newBuilding()); db.units.push(newUnit()); db.residents.push(newResident());
    expect(db.users.some((user) => user.id === 'unlinked-resident-record')).toBe(false);
    renderToStaticMarkup(await PeoplePage());
    const props = boundary.people.mock.calls[0][0] as unknown as { residents: { name: string; email: string; unitLabel: string; unitType: string }[] };
    expect(props.residents).toMatchObject([{ name: 'New resident record', email: 'resident@example.test', unitLabel: 'New canonical unit', unitType: 'Apartment' }]);
  });

  it('keeps finance hidden for a facility manager, including the resident summary balance', async () => {
    actAs('facility_manager', { estateIds: ['new-site'] });
    db.sites.push(newSite()); db.units.push(newUnit()); db.residents.push(newResident());
    const invoices = vi.spyOn(repos.invoices, 'list').mockImplementation(() => { throw new Error('Unauthorised finance read'); });
    renderToStaticMarkup(await PeoplePage());
    const props = boundary.people.mock.calls[0][0] as unknown as { seesBills: boolean; bills: unknown[]; residents: { balanceLabel: string; balanceOwed: boolean }[] };
    expect(invoices).not.toHaveBeenCalled();
    expect(props.seesBills).toBe(false);
    expect(props.bills).toEqual([]);
    expect(props.residents[0]).toMatchObject({ balanceLabel: '—', balanceOwed: false });
    expect(JSON.stringify(props)).not.toContain('45,000');
  });

  it('never reads property metadata when the directory actor has no asset grant', async () => {
    actAs('resident');
    const sites = vi.spyOn(repos.sites, 'list').mockImplementation(() => { throw new Error('Forbidden sites read'); });
    const units = vi.spyOn(repos.units, 'list').mockImplementation(() => { throw new Error('Forbidden units read'); });
    renderToStaticMarkup(await PeoplePage());
    expect(sites).not.toHaveBeenCalled();
    expect(units).not.toHaveBeenCalled();
    const props = boundary.people.mock.calls[0][0] as unknown as { residents: { unitLabel: string; unitType: string }[] };
    expect(props.residents.length).toBeGreaterThan(0);
    expect(props.residents.every((resident) => resident.unitType === '' && resident.unitLabel.startsWith('u-'))).toBe(true);
    expect(boundary.creation).not.toHaveBeenCalled();
  });

  it('reuses tenant registration with only scoped, vacant estate units in the page header', async () => {
    actAs('estate_manager', { estateIds: ['new-site'] });
    db.sites.push(newSite());
    db.units.push(newUnit({ occupancy: 'vacant' }));
    db.units.push(newUnit({ id: asId<Unit['id']>('foreign-unit'), tenantId: asId<Unit['tenantId']>('foreign-tenant'), occupancy: 'vacant' }));
    db.units.push(newUnit({ id: asId<Unit['id']>('occupied-unit'), occupancy: 'occupied' }));
    db.units.push(newUnit({ id: asId<Unit['id']>('reserved-unit'), occupancy: 'vacant' }));
    db.residents.push(newResident({ unitId: asId<Unit['id']>('reserved-unit'), status: 'invited' }));
    renderToStaticMarkup(await PeoplePage());
    const props = boundary.creation.mock.calls[0][0] as unknown as { canAddProperty: boolean; canAddTenant: boolean; units: { id: string; label: string; propertyName: string }[] };
    expect(props.canAddProperty).toBe(false);
    expect(props.canAddTenant).toBe(true);
    expect(props.units).toEqual([{ id: 'new-unit', label: 'New canonical unit', propertyName: 'New canonical property' }]);
  });

  it('reads complete property, unit, resident and building pagination beyond 200 records', async () => {
    actAs('executive');
    for (let index = 0; index < 205; index++) {
      const id = `new-${index}`;
      db.sites.push(newSite({ id: asId<Site['id']>(id), name: `Property ${index}` }));
      db.buildings.push(newBuilding({ id: asId<Building['id']>(id), siteId: asId<Site['id']>(id) }));
      db.units.push(newUnit({ id: asId<Unit['id']>(id), siteId: asId<Site['id']>(id), buildingId: asId<Building['id']>(id), label: `Unit ${index}` }));
      db.residents.push(newResident({ id: asId<Resident['id']>(id), userId: asId<Resident['userId']>(id), siteId: asId<Site['id']>(id), unitId: asId<Unit['id']>(id), name: `Resident ${index}` }));
    }
    renderToStaticMarkup(await SpacesPage({ searchParams: Promise.resolve({}) }));
    renderToStaticMarkup(await PeoplePage());
    const spaces = boundary.spaces.mock.calls[0][0] as unknown as { sites: Site[]; buildings: Building[]; units: Unit[] };
    const people = boundary.people.mock.calls[0][0] as unknown as { residents: { name: string; unitLabel: string }[] };
    expect(spaces.sites.some((site) => site.name === 'Property 204')).toBe(true);
    expect(spaces.buildings.some((building) => building.id === 'new-204')).toBe(true);
    expect(spaces.units.some((unit) => unit.label === 'Unit 204')).toBe(true);
    expect(people.residents.some((resident) => resident.name === 'Resident 204' && resident.unitLabel === 'Unit 204')).toBe(true);
  });

  it('resolves field-job locations from newly created scoped units', async () => {
    const actor = actAs('technician', { estateIds: ['new-site'] });
    db.sites.push(newSite()); db.units.push(newUnit());
    const existing = db.workOrders[0];
    db.workOrders.push({ ...existing, id: asId<WorkOrder['id']>('new-job'), ref: 'WO-NEW', tenantId: asId<WorkOrder['tenantId']>('t-lekki'), siteId: asId<Site['id']>('new-site'), estateId: asId<Site['id']>('new-site'), unitId: asId<Unit['id']>('new-unit'), assigneeUserId: asId<WorkOrder['assigneeUserId'] & string>(actor.userId) });
    renderToStaticMarkup(await FieldPage({ searchParams: Promise.resolve({}) }));
    const props = boundary.field.mock.calls[0][0] as unknown as { jobs: { ref: string; location: string }[]; techName: string };
    expect(props.jobs).toMatchObject([{ ref: 'WO-NEW', location: 'New canonical unit' }]);
    expect(props.techName).toBe('Emeka');
  });

  it('does not read units, sites or assets in field view for an actor without asset access', async () => {
    actAs('vendor');
    const spies = [vi.spyOn(repos.sites, 'list'), vi.spyOn(repos.units, 'list'), vi.spyOn(repos.assets, 'list')];
    for (const spy of spies) spy.mockImplementation(() => { throw new Error('Forbidden asset read'); });
    renderToStaticMarkup(await FieldPage({ searchParams: Promise.resolve({}) }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('SOS canonical linked-unit resolution', () => {
  it('allows a resident to raise SOS for a newly created linked unit without asset-catalog access', async () => {
    const actor = actAs('resident', { unitIds: ['new-unit'] });
    db.units.push(newUnit());
    const units = vi.spyOn(repos.units, 'list').mockImplementation(() => { throw new Error('Residents cannot read the asset catalogue'); });
    expect(await raiseSos()).toEqual({ ok: true, to: 'raised' });
    expect(units).not.toHaveBeenCalled();
    expect(db.sosEvents.at(-1)).toMatchObject({ tenantId: actor.tenantId, estateId: 'new-site', unitId: 'new-unit', ownerUserId: actor.userId, status: 'raised' });
  });

  it('rejects a foreign-tenant unit even when its ID appears in the actor unit list', async () => {
    actAs('resident', { unitIds: ['new-unit'] });
    db.units.push(newUnit({ tenantId: asId<Unit['tenantId']>('foreign-tenant') }));
    expect(await raiseSos()).toEqual({ ok: false, error: 'No unit is linked to your account.' });
    expect(db.sosEvents).toHaveLength(original.sosEvents.length);
  });

  it('does not silently fall back to immutable fixture units after a canonical unit is removed', async () => {
    const actor = actAs('resident');
    const index = db.units.findIndex((unit) => unit.id === actor.unitIds[0]);
    expect(index).toBeGreaterThanOrEqual(0);
    db.units.splice(index, 1);
    expect(await raiseSos()).toEqual({ ok: false, error: 'No unit is linked to your account.' });
    expect(db.sosEvents).toHaveLength(original.sosEvents.length);
  });
});
