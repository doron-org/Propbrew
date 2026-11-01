import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: null as null | { close(): void },
  secure: new Map<string, string>(),
  files: new Set<string>(),
  cookie: 'session-company-a',
  sync: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../apps/mobile/node_modules/expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:' + 'sqlite');
  return { openDatabaseAsync: async () => {
    const db = state.db ?? new DatabaseSync(':memory:');
    state.db = db;
    return {
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...values: unknown[]) => db.prepare(sql).run(...values as []),
      getFirstAsync: async (sql: string, ...values: unknown[]) => db.prepare(sql).get(...values as []),
      getAllAsync: async (sql: string, ...values: unknown[]) => db.prepare(sql).all(...values as []),
    };
  } };
});
vi.mock('../../apps/mobile/node_modules/expo-secure-store', () => ({
  getItemAsync: async (key: string) => state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.secure.set(key, value); },
  deleteItemAsync: async (key: string) => { state.secure.delete(key); },
}));
vi.mock('../../apps/mobile/node_modules/expo-file-system', () => ({
  Paths: { document: '/private' },
  Directory: class { exists = true; create() {} },
  File: class {
    constructor(readonly uri: string) {}
    get exists() { return state.files.has(this.uri); }
    delete() { state.files.delete(this.uri); }
  },
}));
vi.mock('../../apps/mobile/src/api', () => ({
  ApiError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
  sessionCookie: async () => state.cookie,
  constructionSync: state.sync,
  uploadConstructionPhoto: state.upload,
}));

const capture = (id: string, owner: string, kind: 'task_progress' | 'evidence_pack' = 'task_progress') => ({
  id, owner, kind, capturedISO: '2026-11-01T10:00:00.000Z', status: 'queued' as const,
  payload: kind === 'task_progress'
    ? { projectId: 'project-1', taskId: 'task-1', percentComplete: 25, mediaRefs: [] }
    : { projectId: 'project-1', subject: 'task', subjectRef: 'task-1', title: 'Site evidence', mediaRefs: [] },
  ...(kind === 'evidence_pack' ? { photoUri: '/private/photo.jpg' } : {}),
});

describe('native construction outbox', () => {
  beforeEach(() => {
    state.db?.close(); state.db = null;
    state.secure.clear(); state.files.clear(); state.cookie = 'session-company-a';
    state.sync.mockReset(); state.upload.mockReset(); vi.resetModules();
  });

  it('replays one owner’s captures without showing or deleting another company’s work', async () => {
    const outbox = await import('../../apps/mobile/src/construction/outbox');
    await outbox.queueConstructionCapture(capture('capture-a', 'company-a'));
    await outbox.queueConstructionCapture(capture('capture-b', 'company-b'));
    state.sync.mockResolvedValue({ ok: true, id: 'capture-a' });
    expect(await outbox.flushConstructionCaptures('company-a')).toMatchObject({ synced: 1 });
    expect(await outbox.listConstructionCaptures('company-a')).toEqual([]);
    expect((await outbox.listConstructionCaptures('company-b')).map((row) => row.id)).toEqual(['capture-b']);
    expect(state.sync).toHaveBeenCalledTimes(1);
    expect(state.sync.mock.calls[0][0].owner).toBe('company-a');
  });

  it('keeps an uploaded photo through a failed sync, then reuses the URL and deletes it only after acknowledgement', async () => {
    const outbox = await import('../../apps/mobile/src/construction/outbox');
    state.files.add('/private/photo.jpg');
    await outbox.queueConstructionCapture(capture('photo-1', 'company-a', 'evidence_pack'));
    state.upload.mockResolvedValue({ ok: true, url: 'https://storage.example/photo-1.jpg', duplicate: false });
    state.sync.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce({ ok: true, id: 'photo-1' });
    expect(await outbox.flushConstructionCaptures('company-a')).toMatchObject({ offline: true, synced: 0 });
    expect(state.files.has('/private/photo.jpg')).toBe(true);
    expect((await outbox.listConstructionCaptures('company-a'))[0].uploadedUrl).toBe('https://storage.example/photo-1.jpg');
    expect(await outbox.flushConstructionCaptures('company-a')).toMatchObject({ offline: false, synced: 1 });
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.sync.mock.calls[1][0].payload.mediaRefs).toEqual(['https://storage.example/photo-1.jpg']);
    expect(state.files.has('/private/photo.jpg')).toBe(false);
  });

  it('will not open a cached workspace under a different local sign-in', async () => {
    const outbox = await import('../../apps/mobile/src/construction/outbox');
    const data = { version: 1, generatedAt: '2026-11-01T10:00:00.000Z',
      profile: { userId: 'user-a', companyId: 'company-a', owner: 'company-a', displayName: 'Ada', role: 'field-worker' },
      projects: [], tasks: [], checkIns: [] };
    await outbox.saveConstructionCache(data);
    expect(await outbox.lastCachedConstruction()).toEqual(data);
    state.cookie = 'session-company-b';
    expect(await outbox.lastCachedConstruction()).toBeNull();
  });
});
