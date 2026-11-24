import 'server-only';

import { notFound } from 'next/navigation';
import type { Actor } from '@/lib/authz';
import type { Site } from '@/domain/entities';
import type { Page } from '@/domain/primitives';
import { canEnterWorkspace } from '@/config/workspaces';
import { repos } from '@/server/data';

export type PropertyQuery = { siteId?: string | string[]; propertyId?: string | string[] };

/** Read the entire authorised register before narrowing to one property. */
export function allPropertyRows<T>(read: (cursor: string | null) => Page<T>): T[] {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const page = read(cursor);
    rows.push(...page.items);
    cursor = page.cursor ?? null;
  } while (cursor !== null);
  return rows;
}

/** A URL filter can narrow a repository result, never add a site to the actor's scope. */
export function authorisedPropertySites(actor: Actor): Site[] {
  const estate = canEnterWorkspace(actor, 'estate');
  const facility = canEnterWorkspace(actor, 'facility');
  if (!estate && !facility) return [];
  return repos.sites.all(actor).filter((site) => site.tenantId === actor.tenantId
    && (actor.allEstates || actor.estateIds.includes(String(site.id)))
    && (site.kind === 'estate' ? estate || facility : site.kind === 'facility' && facility));
}

export function selectedProperty(actor: Actor, query: PropertyQuery): Site | null {
  if (query.siteId !== undefined && query.propertyId !== undefined && query.siteId !== query.propertyId) notFound();
  const raw = query.siteId ?? query.propertyId;
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !raw || raw.length > 128) notFound();
  const site = authorisedPropertySites(actor).find((candidate) => String(candidate.id) === raw);
  if (!site) notFound();
  return site;
}

export function atProperty<T extends { tenantId: string; siteId: string }>(rows: readonly T[], site: Site | null): T[] {
  return site ? rows.filter((row) => row.tenantId === site.tenantId && String(row.siteId) === String(site.id)) : [...rows];
}
