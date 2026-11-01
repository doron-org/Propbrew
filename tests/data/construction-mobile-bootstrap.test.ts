import { describe, expect, it } from 'vitest';
import { actorForCompanyMember } from '@/lib/auth/company-policy';
import { identityByKey } from '@/server/identities';
import { db } from '@/server/data/store';
import { mobileConstructionBootstrap } from '@/server/mobile/construction-bootstrap';

describe('native Construction bootstrap scope', () => {
  it('returns only the permanently assigned project and task for a field worker', () => {
    const tenantId = identityByKey('estate_manager').actor.tenantId!;
    const project = db.constructionProjects.find((row) => row.tenantId === tenantId)!;
    const task = db.constructionTasks.find((row) => row.tenantId === tenantId && row.projectId === project.id)!;
    const actor = actorForCompanyMember({
      membershipId: 'field-mobile-test', userId: 'field-mobile-user', companyId: tenantId,
      companyRole: 'member', status: 'active', companyStatus: 'active',
      modules: { construction: 'manage' }, operationalProfileId: 'construction-field-worker',
      estateIds: [], allEstates: false, constructionProjectIds: [project.id], constructionTaskIds: [task.id], allConstructionProjects: false,
    }, 'field-mobile-user')!;
    const response = mobileConstructionBootstrap(actor, 'Field worker');
    expect(response.projects.map((row) => row.id)).toEqual([project.id]);
    expect(response.tasks.map((row) => row.id)).toEqual([task.id]);
    expect(response.profile.owner).toBe(JSON.stringify([tenantId, actor.userId]));
    expect(response.projects.every((row) => row.id !== db.constructionProjects.find((item) => item.tenantId === tenantId && item.id !== project.id)?.id)).toBe(true);
  });
});
