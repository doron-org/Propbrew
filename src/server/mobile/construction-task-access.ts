import type { Actor } from '@/lib/authz';

/** Task records have no package column, so these scoped roles need an explicit task assignment. */
export function canCaptureConstructionTask(actor: Actor, taskId: string): boolean {
  const profile = actor.companyAccess?.operationalProfileId;
  return !['construction-field-worker', 'subcontractor', 'site-engineer'].includes(profile ?? '')
    || Boolean(actor.constructionTaskIds?.includes(taskId));
}
