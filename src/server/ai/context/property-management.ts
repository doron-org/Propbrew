import 'server-only';

import type { Actor } from '@/lib/authz';
import type { Site } from '@/domain/entities';
import type { CopilotContext, CopilotModule } from '@/lib/ai/copilot-protocol';
import { canEnterWorkspace } from '@/config/workspaces';
import { buildEstateContext } from './estate';
import { buildFacilityContext } from './facility';

const MAX_ROWS_PER_COLLECTION = 25;

function scopedFacts(facts: Record<string, unknown>, site: Site | null) {
  const selected: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(facts)) {
    if (!Array.isArray(value)) continue;
    const rows = site ? value.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const record = row as Record<string, unknown>;
      return record.siteId === site.id || record.estateId === site.id
        || (name === 'sites' || name === 'properties') && record.id === site.id;
    }) : value;
    if (rows.length) selected[name] = rows.slice(0, MAX_ROWS_PER_COLLECTION);
  }
  return selected;
}

function coverageFor(facts: Record<string, unknown>, prefix: string) {
  return Object.entries(facts).filter(([, value]) => Array.isArray(value)).map(([name, value]) => ({
    collection: `${prefix} ${name}`, loaded: (value as unknown[]).length, total: null, complete: false,
  }));
}

/** Combine independently authorised contexts; selected-property answers never receive tenant-wide objects or unscoped rows. */
export async function buildPropertyManagementContext(actor: Actor, module: Extract<CopilotModule, 'estate' | 'facility'>, site: Site | null): Promise<CopilotContext> {
  const estate = module === 'estate' ? await buildEstateContext(actor) : null;
  const facility = canEnterWorkspace(actor, 'facility') ? await buildFacilityContext(actor) : null;
  const first = estate ?? facility!;
  const estateFacts = estate ? scopedFacts(estate.facts, site) : {};
  const facilityFacts = facility ? scopedFacts(facility.facts, site) : {};
  const facts = { ...(estate ? { estate: estateFacts } : {}), ...(facility ? { building: facilityFacts } : {}) };
  const href = site ? `?siteId=${encodeURIComponent(String(site.id))}` : '';
  const sourceSite = site ? site.kind === 'estate' && estate ? `/properties/${encodeURIComponent(String(site.id))}` : `/facility/sites/${encodeURIComponent(String(site.id))}` : '/property-management';
  return {
    module,
    scopeLabel: site ? `${site.name} · selected authorised property` : 'Authorised Property Management portfolio',
    snapshotISO: first.snapshotISO,
    facts,
    coverage: [...coverageFor(estateFacts, 'Estate'), ...coverageFor(facilityFacts, 'Building')],
    sources: [
      { id: 'property-scope', label: 'Authorised property register', href: sourceSite },
      { id: 'property-work-orders', label: 'Shared property work-order register', href: `/property-management/work-orders${href}` },
      { id: 'property-reports', label: 'Property performance and exports', href: `/property-management/reports${href}` },
    ],
    notices: [
      'Each section is read only when the current company role and module grant allow it. Missing sections mean unavailable evidence, not zero activity.',
      'Only the selected property’s site-linked rows are supplied when a property is selected. Company-wide records without a site assignment are excluded.',
      `Collections are bounded to ${MAX_ROWS_PER_COLLECTION} displayed rows each and do not establish complete totals. Verify linked registers before deciding.`,
      'Resident, finance and building records retain their original dates and currencies. No live sensor feed, bank confirmation or automated action is implied.',
    ],
  };
}
