import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeNavHref, PAGE_META, visibleNav } from '@/config/nav';
import { workspaceForPath } from '@/config/workspaces';
import { identityByKey } from '@/server/identities';

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('Independent Estate work-order route ownership', () => {
  it('keeps list and detail in Estate while retaining the independent Facility routes', () => {
    expect(workspaceForPath('/estate/work-orders')).toBe('estate');
    expect(workspaceForPath('/estate/work-orders/WO-24817')).toBe('estate');
    expect(workspaceForPath('/work-orders/WO-24817')).toBe('facility');
    for (const route of ['page.tsx', '[ref]/page.tsx']) {
      const source = read('src/app/(ops)/(estate)/estate/work-orders/' + route);
      expect(source).toContain("requireCapability('work_orders', 'read', 'estate')");
      expect(source).not.toContain("'read', 'facility'");
    }
    expect(read('src/app/(ops)/(estate)/estate/work-orders/[ref]/page.tsx')).toContain('getEstateWorkOrder(actor, ref)');
    expect(read('src/app/(ops)/(facility)/work-orders/[ref]/page.tsx')).toContain('basePath="/work-orders"');
  });

  it('keeps Estate work orders property-contextual instead of duplicating them in the portfolio rail', () => {
    const manager = identityByKey('estate_manager').actor;
    const nav = visibleNav('ops', manager, 'estate');
    const items = nav.flatMap((group) => group.items);
    expect(items.slice(0, 3).map((item) => item.href)).toEqual(['/estate', '/properties', '/portfolio']);
    expect(items.find((item) => item.href === '/estate/work-orders')).toBeUndefined();
    expect(items.some((item) => item.href === '/work-orders')).toBe(false);
    expect(PAGE_META['/estate/work-orders']).toBeDefined();
    expect(activeNavHref(nav, '/estate/work-orders/WO-24817')).toBe('/estate');
    expect(activeNavHref(nav, '/estate/work-orders-other')).toBe('/estate');
    expect(read('src/components/workspaces/property-operating-hub.tsx')).toContain("href: '/property-management/work-orders'");
    const security = visibleNav('ops', identityByKey('security').actor, 'estate').flatMap((group) => group.items);
    expect(security.some((item) => item.href === '/estate/work-orders')).toBe(false);
  });

  it('refreshes both workspace projections after a transition, without changing grants', () => {
    const source = read('src/server/actions/work-orders.ts');
    expect(source).toContain("assertCan(actor, 'work_orders', 'transition')");
    expect(source).toContain('repos.workOrders.getByRef(actor, ref)');
    expect(source).toContain("revalidatePath('/estate/work-orders')");
    expect(source).toContain('revalidatePath(`/estate/work-orders/${ref}`)');
    expect(source).toContain("revalidatePath('/work-orders')");
  });

  it('does not mark new requests with no deadline as SLA breaches', () => {
    const view = read('src/components/work-orders/work-order-detail-view.tsx');
    expect(view).toContain('wo.respondDueAt !== null && wo.respondDueAt < NOW');
    expect(view).toContain('href={returnHref ?? basePath}');
  });
});
