import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import { ApiError, constructionSync, sessionCookie, uploadConstructionPhoto } from '../api';
import type { ConstructionBootstrap, ConstructionCapture } from './types';

const LAST_OWNER_KEY = 'propbrew.construction.last-owner';
const LAST_SESSION_KEY = 'propbrew.construction.last-session';
const photos = new Directory(Paths.document, 'construction-evidence');
const database = openDatabaseAsync('propbrew-construction.sqlite').then(async (db) => {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS construction_cache (owner TEXT PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS construction_captures (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, captured_iso TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL, error TEXT, photo_uri TEXT, uploaded_url TEXT
    );
    CREATE INDEX IF NOT EXISTS construction_captures_owner ON construction_captures(owner, captured_iso);`);
  return db;
});

type StoredCapture = {
  id: string; owner: string; kind: ConstructionCapture['kind']; captured_iso: string;
  payload_json: string; status: ConstructionCapture['status']; error: string | null;
  photo_uri: string | null; uploaded_url: string | null;
};

function fromStored(row: StoredCapture): ConstructionCapture {
  return { id: row.id, owner: row.owner, kind: row.kind, capturedISO: row.captured_iso,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>, status: row.status,
    error: row.error ?? undefined, photoUri: row.photo_uri ?? undefined, uploadedUrl: row.uploaded_url ?? undefined };
}

export async function saveConstructionCache(data: ConstructionBootstrap) {
  const db = await database;
  await db.runAsync('INSERT INTO construction_cache(owner,data_json) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data_json=excluded.data_json',
    data.profile.owner, JSON.stringify(data));
  await SecureStore.setItemAsync(LAST_OWNER_KEY, data.profile.owner);
  const cookie = await sessionCookie();
  if (cookie) await SecureStore.setItemAsync(LAST_SESSION_KEY, cookie);
}

export async function lastCachedConstruction(): Promise<ConstructionBootstrap | null> {
  const owner = await SecureStore.getItemAsync(LAST_OWNER_KEY);
  const cookie = await sessionCookie();
  if (!owner || !cookie || cookie !== await SecureStore.getItemAsync(LAST_SESSION_KEY)) return null;
  const row = await (await database).getFirstAsync<{ data_json: string }>('SELECT data_json FROM construction_cache WHERE owner=?', owner);
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json) as ConstructionBootstrap;
    return data.profile.owner === owner ? data : null;
  } catch { return null; }
}

export async function listConstructionCaptures(owner: string): Promise<ConstructionCapture[]> {
  const rows = await (await database).getAllAsync<StoredCapture>(
    'SELECT * FROM construction_captures WHERE owner=? ORDER BY captured_iso, id', owner);
  return rows.map(fromStored);
}

export async function queueConstructionCapture(capture: ConstructionCapture) {
  if (!capture.owner || !capture.id || capture.status !== 'queued') throw new Error('Check the construction capture before saving.');
  await (await database).runAsync(
    'INSERT INTO construction_captures(id,owner,kind,captured_iso,payload_json,status,error,photo_uri,uploaded_url) VALUES(?,?,?,?,?,?,?,?,?)',
    capture.id, capture.owner, capture.kind, capture.capturedISO, JSON.stringify(capture.payload),
    capture.status, null, capture.photoUri ?? null, capture.uploadedUrl ?? null);
}

/** Keep a private copy: camera and picker URIs can disappear before connectivity returns. */
export function stageConstructionPhoto(sourceUri: string, captureId: string): string {
  if (!photos.exists) photos.create({ idempotent: true });
  const destination = new File(photos, `${captureId}.jpg`);
  new File(sourceUri).copy(destination);
  if (!destination.exists || destination.size === 0 || destination.size > 10 * 1024 * 1024) {
    if (destination.exists) destination.delete();
    throw new Error('Use a JPEG photo under 10 MB.');
  }
  return destination.uri;
}

export async function retryConstructionCapture(owner: string, id: string) {
  await (await database).runAsync(
    "UPDATE construction_captures SET status='queued', error=NULL WHERE owner=? AND id=?", owner, id);
}

export async function discardConstructionCapture(owner: string, id: string) {
  const db = await database;
  const row = await db.getFirstAsync<StoredCapture>('SELECT * FROM construction_captures WHERE owner=? AND id=?', owner, id);
  if (!row) return;
  await db.runAsync('DELETE FROM construction_captures WHERE owner=? AND id=?', owner, id);
  if (row.photo_uri) {
    const file = new File(row.photo_uri);
    if (file.exists) file.delete();
  }
}

export async function clearConstructionLocal(owner: string) {
  for (const row of await listConstructionCaptures(owner)) await discardConstructionCapture(owner, row.id);
  await (await database).runAsync('DELETE FROM construction_cache WHERE owner=?', owner);
  if (await SecureStore.getItemAsync(LAST_OWNER_KEY) === owner) {
    await SecureStore.deleteItemAsync(LAST_OWNER_KEY);
    await SecureStore.deleteItemAsync(LAST_SESSION_KEY);
  }
}

export async function countAllConstructionCaptures() {
  const row = await (await database).getFirstAsync<{ count: number }>('SELECT COUNT(*) count FROM construction_captures');
  return row?.count ?? 0;
}

export async function clearAllConstructionLocal() {
  const db = await database;
  const owners = await db.getAllAsync<{ owner: string }>('SELECT owner FROM construction_cache UNION SELECT owner FROM construction_captures');
  for (const row of owners) await clearConstructionLocal(row.owner);
}

export type FlushResult = { synced: number; needsAttention: number; offline: boolean; sessionExpired: boolean };
let activeFlush: { owner: string; promise: Promise<FlushResult> } | null = null;

export function flushConstructionCaptures(owner: string): Promise<FlushResult> {
  if (activeFlush) return activeFlush.promise.then(() => flushConstructionCaptures(owner));
  const promise = flush(owner).finally(() => { activeFlush = null; });
  activeFlush = { owner, promise };
  return promise;
}

async function flush(owner: string): Promise<FlushResult> {
  const db = await database;
  const result: FlushResult = { synced: 0, needsAttention: 0, offline: false, sessionExpired: false };
  for (const capture of (await listConstructionCaptures(owner)).filter((row) => row.status === 'queued')) {
    try {
      let payload = capture.payload;
      if (capture.kind === 'evidence_pack') {
        if (!capture.photoUri) throw new Error('The local photo is missing. Review this capture.');
        let url = capture.uploadedUrl;
        if (!url) {
          const uploaded = await uploadConstructionPhoto({ id: capture.id, payload, photoUri: capture.photoUri });
          url = uploaded.url;
          await db.runAsync('UPDATE construction_captures SET uploaded_url=? WHERE owner=? AND id=?', url, owner, capture.id);
        }
        payload = { ...payload, mediaRefs: [url] };
      }
      const receipt = await constructionSync({ id: capture.id, owner, kind: capture.kind, capturedISO: capture.capturedISO, payload });
      if (!receipt.ok) throw new ApiError(receipt.error ?? 'The server did not accept this capture.', receipt.conflict ? 409 : 422);
      await discardConstructionCapture(owner, capture.id);
      result.synced += 1;
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) { result.sessionExpired = true; break; }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await db.runAsync("UPDATE construction_captures SET status='needs_attention', error=? WHERE owner=? AND id=?",
          error.message.slice(0, 500), owner, capture.id);
        result.needsAttention += 1;
        continue;
      }
      if (!(error instanceof ApiError) && error instanceof Error && error.message.includes('local photo')) {
        await db.runAsync("UPDATE construction_captures SET status='needs_attention', error=? WHERE owner=? AND id=?",
          error.message, owner, capture.id);
        result.needsAttention += 1;
        continue;
      }
      result.offline = true;
      break;
    }
  }
  return result;
}
