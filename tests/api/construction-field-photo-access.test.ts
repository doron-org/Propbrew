import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityByKey } from '@/server/identities';

const boundary = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn() }));
vi.mock('@/server/session', () => ({ getSession: boundary.session }));
vi.mock('@/server/data/durable-records', () => ({ withDurableRead: (fn: () => Promise<unknown>) => fn() }));
vi.mock('@/server/construction/field-photos', () => ({ readFieldPhoto: boundary.read }));
import { GET } from '@/app/api/construction/field-photos/[id]/route';

const actor = identityByKey('estate_manager').actor;
const id = '00000000-0000-4000-8000-000000000000';
const params = { params: Promise.resolve({ id }) };

beforeEach(() => { vi.clearAllMocks(); boundary.session.mockResolvedValue({ actor }); boundary.read.mockResolvedValue(null); });

describe('construction field photo delivery', () => {
  it('requires a session and returns no data for a missing or unscoped photo', async () => {
    boundary.session.mockResolvedValue(null);
    expect((await GET(new Request('https://app.usepropbrew.com/api/construction/field-photos/' + id), params)).status).toBe(401);
    expect(boundary.read).not.toHaveBeenCalled();
    boundary.session.mockResolvedValue({ actor });
    expect((await GET(new Request('https://app.usepropbrew.com/api/construction/field-photos/' + id), params)).status).toBe(404);
  });
  it('streams an authorized photo privately', async () => {
    boundary.read.mockResolvedValue({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), size: 3, contentType: 'image/jpeg' });
    const result = await GET(new Request('https://app.usepropbrew.com/api/construction/field-photos/' + id), params);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });
});
