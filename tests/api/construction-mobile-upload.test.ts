import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityByKey } from '@/server/identities';

const boundary = vi.hoisted(() => ({ session: vi.fn(), state: { mobileUploads: [] as Record<string, unknown>[] }, project: vi.fn(), task: vi.fn(), store: vi.fn() }));
vi.mock('@/server/session', () => ({ getSession: boundary.session }));
vi.mock('@/server/construction-control', () => ({ constructionControl: () => boundary.state }));
vi.mock('@/server/data', () => ({ scopedConstructionProjectGet: boundary.project, scopedConstructionTaskGet: boundary.task }));
vi.mock('@/server/data/durable-records', () => ({ withDurableMutation: (fn: () => Promise<unknown>) => fn() }));
vi.mock('@/server/construction/field-photos', () => ({ storeFieldPhoto: boundary.store }));
import { POST } from '@/app/api/mobile/v1/construction/upload/route';

const actor = identityByKey('estate_manager').actor;
const captureId = '1f5233b0-202e-4c6d-8239-26377cd99441';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
function request(bytes = jpeg, opId = captureId) {
  const form = new FormData();
  form.set('opId', opId); form.set('projectId', 'project-1'); form.set('taskId', 'task-1'); form.set('index', '0');
  form.set('file', new File([bytes], 'site.jpg', { type: 'image/jpeg' }));
  return new Request('https://usepropbrew.com/api/mobile/v1/construction/upload', { method: 'POST', body: form });
}
beforeEach(() => {
  vi.clearAllMocks(); boundary.state.mobileUploads.length = 0;
  boundary.session.mockResolvedValue({ actor });
  boundary.project.mockReturnValue({ id: 'project-1' });
  boundary.task.mockReturnValue({ id: 'task-1', projectId: 'project-1' });
  boundary.store.mockResolvedValue({ ok: true, url: 'https://app.usepropbrew.com/api/construction/field-photos/00000000-0000-4000-8000-000000000000', duplicate: false });
});

describe('native Construction photo custody', () => {
  it('requires a session and an assigned task in the project', async () => {
    boundary.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    boundary.session.mockResolvedValue({ actor });
    boundary.task.mockReturnValue({ id: 'task-1', projectId: 'other-project' });
    expect((await POST(request())).status).toBe(422);
    expect(boundary.store).not.toHaveBeenCalled();
  });
  it('stores one private photo and returns the same receipt for an exact retry', async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(boundary.store).toHaveBeenCalledTimes(1);
    expect(boundary.store.mock.calls[0]?.[1]).toMatchObject({ contentType: 'image/jpeg', projectId: 'project-1', taskId: 'task-1' });
    expect(boundary.state.mobileUploads).toHaveLength(1);
    expect((await POST(request(new Uint8Array([0xff, 0xd8, 0xff, 0x00])))).status).toBe(422);
    expect(boundary.store).toHaveBeenCalledTimes(1);
  });
});
