import 'server-only';

import type { Actor } from '@/lib/authz';
import { repos } from '@/server/data';
import { constructionControl } from '@/server/construction-control';

export function mobileConstructionBootstrap(actor: Actor, displayName: string) {
  const projects = repos.constructionProjects.list(actor, { limit: 500 }).items;
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = repos.constructionTasks.list(actor, { limit: 1000 }).items
    .filter((task) => projectIds.has(task.projectId))
    .map((task) => ({ id: task.id, projectId: task.projectId, name: task.name, status: task.status, percentComplete: task.percentComplete, plannedFinishISO: task.plannedFinishISO, priority: task.priority }));
  const checkIns = constructionControl(actor.tenantId!).fieldCheckIns
    .filter((row) => row.actorId === actor.userId && projectIds.has(row.projectId))
    .map((row) => ({ id: row.id, projectId: row.projectId, dateISO: row.dateISO, capturedAtISO: row.capturedAtISO, siteLocationId: row.siteLocationId, accuracyMeters: row.accuracyMeters, distanceMeters: row.distanceMeters, method: row.method }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: { userId: actor.userId, companyId: actor.tenantId, displayName, owner: JSON.stringify([actor.tenantId, actor.userId]), role: actor.companyAccess?.operationalProfileId ?? 'construction-member' },
    projects: projects.map((project) => ({ id: project.id, name: project.name, code: project.code, status: project.status,
      sites: (project.mobilisation?.locations ?? []).filter((site) => site.kind === 'site' && site.latitude !== undefined && site.longitude !== undefined)
        .map((site) => ({ id: site.id, name: site.name })),
    })),
    tasks,
    checkIns,
  };
}
