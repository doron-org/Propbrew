import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityByKey } from '@/server/identities';

const boundary = vi.hoisted(() => ({ session: vi.fn(), control: vi.fn(), project: vi.fn(), blob: vi.fn() }));
vi.mock('@/server/session', () => ({ getSession: boundary.session }));
vi.mock('@/server/construction-control', () => ({ constructionControl: boundary.control }));
vi.mock('@/server/data', () => ({ scopedConstructionProjectGet: boundary.project }));
vi.mock('@/server/data/durable-records', () => ({ withDurableRead: (fn: () => Promise<unknown>) => fn() }));
vi.mock('@vercel/blob', () => ({ get: boundary.blob }));
import { GET } from '@/app/api/construction/evidence/[id]/[index]/route';

const actor = identityByKey('estate_manager').actor;
const url = 'https://store.public.blob.vercel-storage.com/private-site-photo.jpg';
const request = () => new Request('https://usepropbrew.com/api/construction/evidence/pack-1/0');
const params = { params: Promise.resolve({ id: 'pack-1', index: '0' }) };

beforeEach(() => {
  vi.clearAllMocks();
  boundary.session.mockResolvedValue({ actor });
  boundary.project.mockReturnValue({ id: 'project-1' });
  boundary.control.mockReturnValue({
    evidencePacks: [{ id: 'pack-1', tenantId: actor.tenantId, projectId: 'project-1', subject: 'task', subjectRef: 'task-1', capturedBy: actor.userId, mediaRefs: [url] }],
    mobileUploads: [{ tenantId: actor.tenantId, actorId: actor.userId, projectId: 'project-1', taskId: 'task-1', url }],
  });
  boundary.blob.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff])); controller.close(); } }), blob: { contentType: 'image/jpeg', size: 3 } });
});

describe('private construction evidence delivery', () => {
  it('requires a signed-in construction user', async () => {
    boundary.session.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(401);
    expect(boundary.blob).not.toHaveBeenCalled();
  });
  it('hides another project and a photo without a matching owned upload receipt', async () => {
    boundary.project.mockReturnValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    boundary.project.mockReturnValue({ id: 'project-1' });
    boundary.control.mockReturnValue({ evidencePacks: [{ id: 'pack-1', tenantId: actor.tenantId, projectId: 'project-1', subject: 'task', subjectRef: 'task-1', capturedBy: actor.userId, mediaRefs: [url] }], mobileUploads: [] });
    expect((await GET(request(), params)).status).toBe(404);
    expect(boundary.blob).not.toHaveBeenCalled();
  });
  it('streams a scoped private photo without publishing its Blob URL', async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(boundary.blob).toHaveBeenCalledWith(url, { access: 'private' });
  });
});
