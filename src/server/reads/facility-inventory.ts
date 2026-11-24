import 'server-only';
import { assertCan, matchesScope, type Actor } from '@/lib/authz';
import { currentRecordContext } from '@/server/data/record-context';
import { db } from '@/server/data/store';
import { facilityInventoryState, facilityPartSnapshot, type FacilityStockMovement, type FacilityPartMetadata } from '@/domain/facility/inventory-setup';
import type { Part } from '@/domain/facility';

export type FacilityPartView = Part & { metadata: FacilityPartMetadata | null; snapshot: string; siteName: string };
export function listFacilityInventory(actor: Actor, options: { before?: string; limit?: number; partId?: string; siteId?: string; includeArchived?: boolean } = {}) {
  const scope = assertCan(actor, 'assets_ppm', 'read'), context = currentRecordContext();
  const data = context ? facilityInventoryState(context.state, actor.tenantId!) : { parts: [], movements: [] };
  const all = db.facilityParts.filter((part) => part.tenantId === actor.tenantId && (part.siteId ? matchesScope(part, scope) : actor.allEstates) && (!options.siteId || part.siteId === options.siteId));
  const parts: FacilityPartView[] = all.flatMap((part) => {
    const metadata = data.parts.find((row) => row.tenantId === actor.tenantId && row.partId === part.id) ?? null;
    if (!options.includeArchived && metadata?.status === 'archived') return [];
    return [{ ...part, metadata: metadata ? { ...metadata } : null, snapshot: facilityPartSnapshot(part), siteName: part.siteId ? db.sites.find((row) => row.tenantId === actor.tenantId && row.id === part.siteId)?.name ?? 'Recorded site' : 'Site not recorded' }];
  });
  const ids = new Set(parts.map((row) => row.id));
  const allMovements = data.movements.filter((row) => row.tenantId === actor.tenantId && ids.has(row.partId) && matchesScope(row, scope) && (!options.partId || row.partId === options.partId));
  const rows = [...allMovements].sort((a, b) => `${b.at}|${b.id}`.localeCompare(`${a.at}|${a.id}`));
  const cursor = options.before && options.before.length <= 100 ? options.before : undefined;
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(options.limit!, 200)) : 50;
  const page = rows.filter((row) => !cursor || `${row.at}|${row.id}` < cursor).slice(0, limit + 1);
  const movements: FacilityStockMovement[] = page.slice(0, limit).map((row) => ({ ...row }));
  const last = movements.at(-1);
  return { parts, movements, totalMovements: allMovements.length, nextBefore: page.length > limit && last ? `${last.at}|${last.id}` : null };
}
