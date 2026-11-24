import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/lib/authz';
import type { Site, WorkOrder } from '@/domain/entities';

const boundary = vi.hoisted(() => ({ sites: vi.fn(), orders: vi.fn(), get: vi.fn() }));
vi.mock('@/server/data', () => ({ repos: { sites: { all: boundary.sites }, workOrders: { list: boundary.orders, getByRef: boundary.get } } }));

import { authorisedPropertySites, selectedProperty, atProperty } from '@/server/reads/property-management-scope';
import { getPropertyWorkOrder, listPropertyWorkOrders } from '@/server/reads/property-work-orders';

const actor: Actor = { userId: 'manager-a', tenantId: 'tenant-a', roles: ['estate_manager'], estateIds: ['estate-a', 'facility-a'], allEstates: false, unitIds: [], vendorOrgId: null, investorProjectIds: [] };
const sites = [
  { id: 'estate-a', tenantId: 'tenant-a', kind: 'estate', name: 'Estate A' },
  { id: 'facility-a', tenantId: 'tenant-a', kind: 'facility', name: 'Facility A' },
  { id: 'estate-unassigned', tenantId: 'tenant-a', kind: 'estate', name: 'Other site' },
  { id: 'estate-a', tenantId: 'tenant-b', kind: 'estate', name: 'Foreign company' },
] as Site[];
const orders = [
  { id: 'job-a', ref: 'WO-A', tenantId: 'tenant-a', siteId: 'estate-a' },
  { id: 'job-b', ref: 'WO-B', tenantId: 'tenant-a', siteId: 'facility-a' },
  { id: 'job-unassigned', ref: 'WO-OTHER', tenantId: 'tenant-a', siteId: 'estate-unassigned' },
  { id: 'job-foreign', ref: 'WO-FOREIGN', tenantId: 'tenant-b', siteId: 'estate-a' },
] as WorkOrder[];

beforeEach(() => {
  vi.clearAllMocks();
  boundary.sites.mockReturnValue(sites);
  boundary.orders.mockReturnValue({ items: orders, total: orders.length, cursor: null });
  boundary.get.mockImplementation((_actor, ref) => orders.find((row) => row.ref === ref) ?? null);
});

describe('one Property Management record boundary', () => {
  it('combines Estate and Facility jobs without admitting another site or company', () => {
    expect(authorisedPropertySites(actor).map((site) => site.id)).toEqual(['estate-a', 'facility-a']);
    expect(listPropertyWorkOrders(actor).map((row) => row.ref)).toEqual(['WO-A', 'WO-B']);
    expect(getPropertyWorkOrder(actor, 'WO-B')).toBe(orders[1]);
    expect(getPropertyWorkOrder(actor, 'WO-OTHER')).toBeNull();
    expect(getPropertyWorkOrder(actor, 'WO-FOREIGN')).toBeNull();
  });

  it('treats the requested site as a narrowing filter and rejects unassigned IDs', () => {
    const selected = selectedProperty(actor, { siteId: 'facility-a' });
    expect(selected?.id).toBe('facility-a');
    expect(atProperty(listPropertyWorkOrders(actor), selected).map((row) => row.ref)).toEqual(['WO-B']);
    expect(() => selectedProperty(actor, { propertyId: 'estate-unassigned' })).toThrow();
    expect(() => selectedProperty(actor, { siteId: 'estate-a', propertyId: 'facility-a' })).toThrow();
  });

  it('reads later authorised pages before applying the property filter', () => {
    boundary.orders.mockImplementation((_actor, query) => query.cursor
      ? { items: [orders[1], orders[3]], total: 4, cursor: null }
      : { items: [orders[0], orders[2]], total: 4, cursor: 'next' });
    expect(atProperty(listPropertyWorkOrders(actor), selectedProperty(actor, { siteId: 'facility-a' })).map((row) => row.ref)).toEqual(['WO-B']);
    expect(boundary.orders).toHaveBeenCalledTimes(2);
  });
});
