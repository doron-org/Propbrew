import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('property-first Estate information architecture', () => {
  it('keeps property onboarding discoverable for every portfolio viewer', () => {
    const actions = read('src/components/workspaces/estate-create-actions.tsx');
    expect(actions).toContain('aria-label="Add property"');
    expect(actions).toContain('Property creation is restricted for this profile.');
    expect(actions).toContain('only an authorised Estate Manager can add a company property');
    expect(actions).not.toContain('if (!canAddProperty && !canAddTenant) return null');
  });

  it('opens every property as an operating hub', () => {
    const register = read('src/components/workspaces/estate-properties-workspace.tsx');
    expect(register).toContain('`/properties/${encodeURIComponent(property.id)}`');
    expect(register).toContain('Open property');
    const page = read('src/app/(ops)/(estate)/properties/[propertyId]/page.tsx');
    expect(page).toContain("requireCapability('assets_ppm', 'read', 'estate')");
    expect(page).toContain('readEstatePropertyOperating(actor, propertyId)');
    const readModel = read('src/server/reads/estate-property-operating.ts');
    expect(readModel).toContain('buildEstateProperties(sites, units)');
    expect(readModel).toContain('candidate.id === propertyId');
  });

  it('groups operations, community, governance, finance and AI under the property', () => {
    const hub = read('src/components/workspaces/property-operating-hub.tsx');
    expect(hub).toContain("id: 'residents', label: 'Residents'");
    expect(hub).toContain("id: 'tenancy', label: 'Tenancy'");
    expect(hub).toContain("defaultSection === 'operations'");
    expect(hub).toContain('Choose a workflow from Operations');
    expect(hub).not.toContain("{ id: 'operations', label: 'Operations'");
    expect(hub).not.toContain("{ id: 'community', label: 'Community & governance'");
    expect(hub).not.toContain("{ id: 'finance', label: 'Finance & commerce'");
    expect(hub).not.toContain("{ id: 'intelligence', label: 'Intelligence'");
    for (const route of ['/property-management/work-orders', '/announcements', '/governance', '/billing', '/collections', '/property-management/copilot']) {
      expect(hub).toContain(`href: '${route}'`);
    }
    expect(hub).toContain('propertyId: property.id');
  });

  it('renders each property as a collapsible rail with direct section routes', () => {
    const shell = read('src/components/shell-frame.tsx');
    expect(shell).toContain('collapsible: true');
    expect(shell).toContain("label: 'Dashboard'");
    expect(shell).toContain('children: operationItems(site.id)');
    expect(shell).toContain('children: communityItems(site.id)');
    expect(shell).toContain('children: financeItems(site.id)');
    expect(shell).toContain('children: intelligenceItems(site.id)');
    expect(shell).toContain("label: 'Work orders'");
    expect(shell).toContain("label: 'Parcels & lockers'");
    for (const child of ['Announcements', 'Board & committee', 'Billing', 'Marketplace', 'Finance centre', 'Ask Property Copilot']) {
      expect(shell).toContain(`label: '${child}'`);
    }
    for (const section of ['operations', 'community-governance', 'finance-commerce', 'intelligence']) {
      expect(shell).toContain(`/${section}`);
    }
    const appShell = read('src/components/app-shell.tsx');
    expect(appShell).toContain('aria-expanded={effectiveOpenNavGroups.has(group.label)}');
    expect(appShell).toContain('aria-expanded={effectiveOpenNavItems.has(item.id)}');
  });
});
