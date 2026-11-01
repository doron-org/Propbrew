import 'server-only';

import { emptyConstructionControlState, type ConstructionControlState } from '@/domain/construction/control';
import { getRecordAuxiliary } from '@/server/data/record-context';

/** Commercial and field-control sidecars persisted in the locked company workspace document. */
export function constructionControl(tenantId: string): ConstructionControlState {
  const states = getRecordAuxiliary<Record<string, ConstructionControlState>>('construction:control:v1', () => ({}));
  const state = states[tenantId] ??= emptyConstructionControlState();
  state.handoverPacks ??= [];
  state.bankDebits ??= [];
  state.retentionReleases ??= [];
  return state;
}

/** Approved operational onboarding records must be assignable through Team & access.
 * The seeded construction register remains a separate source for legacy projects. */
export function approvedConstructionSubcontractorAssignments(tenantId: string) {
  return constructionControl(tenantId).subcontractors
    .filter((row) => row.tenantId === tenantId && row.status === 'approved')
    .map((row) => ({ id: row.id, projectIds: row.projectIds, name: row.name, trade: row.trade }));
}
