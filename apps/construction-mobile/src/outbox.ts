import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { ApiError, getLastOwner, submit, uploadPhoto } from './api';
import type { Bootstrap, FieldOp, QueuedPhoto } from './types';

const root = `${FileSystem.documentDirectory}construction-field/`;
let writeChain = Promise.resolve();
let drainPromise: Promise<FieldOp[]> | null = null;
let drainOwner: string | null = null;
const id = () => Crypto.randomUUID();
const pathFor = (owner: string) => `${root}${encodeURIComponent(owner)}/`;
const queuePath = (owner: string) => `${pathFor(owner)}outbox.json`;
const cachePath = (owner: string) => `${pathFor(owner)}bootstrap.json`;

async function exists(path: string) { return (await FileSystem.getInfoAsync(path)).exists; }
async function ensureOwner(owner: string) { await FileSystem.makeDirectoryAsync(pathFor(owner), { intermediates: true }); }

async function readJson<T>(path: string, fallback: T): Promise<T> {
  for (const candidate of [path, `${path}.backup`]) {
    if (!await exists(candidate)) continue;
    try { return JSON.parse(await FileSystem.readAsStringAsync(candidate)) as T; }
    catch { /* Preserve both copies and surface corruption below. */ }
  }
  if (await exists(path) || await exists(`${path}.backup`)) throw new Error('Saved field records need recovery. No local data was erased.');
  return fallback;
}

async function writeJson(path: string, value: unknown) {
  const tmp = `${path}.new`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(value));
  if (await exists(path)) {
    if (await exists(`${path}.backup`)) await FileSystem.deleteAsync(`${path}.backup`);
    await FileSystem.copyAsync({ from: path, to: `${path}.backup` });
    await FileSystem.deleteAsync(path);
  }
  await FileSystem.moveAsync({ from: tmp, to: path });
}

export async function readOutbox(owner: string) { return readJson<FieldOp[]>(queuePath(owner), []); }
async function updateOutbox(owner: string, edit: (records: FieldOp[]) => FieldOp[]) {
  const operation = writeChain.then(async () => {
    await ensureOwner(owner);
    const next = edit(await readOutbox(owner));
    await writeJson(queuePath(owner), next);
    return next;
  });
  writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}
async function patch(owner: string, opId: string, edit: (record: FieldOp) => FieldOp) {
  return updateOutbox(owner, (rows) => rows.map((row) => row.id === opId ? edit(row) : row));
}
export async function retryCapture(owner: string, opId: string) {
  return patch(owner, opId, (record) => record.status === 'synced' ? record : { ...record, status: 'queued', error: undefined });
}

export async function cacheBootstrap(data: Bootstrap) {
  await ensureOwner(data.profile.owner);
  await writeJson(cachePath(data.profile.owner), data);
}
export async function readCachedBootstrap(owner: string) { return readJson<Bootstrap | null>(cachePath(owner), null); }

export async function queueTaskProgress(data: Bootstrap, taskId: string, percentComplete: number) {
  const task = data.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error('This task is no longer assigned to your account.');
  const op: FieldOp = { id: id(), owner: data.profile.owner, kind: 'task_progress', capturedISO: new Date().toISOString(),
    label: `${task.name} · ${percentComplete}%`, payload: { projectId: task.projectId, taskId, percentComplete, mediaRefs: [] },
    photos: [], status: 'queued', attempts: 0 };
  await updateOutbox(op.owner, (rows) => [op, ...rows]);
  return op;
}

export async function queueCheckIn(data: Bootstrap, projectId: string, fix: { latitude: number; longitude: number; accuracyMeters: number; locationAtISO: string }) {
  const project = data.projects.find((row) => row.id === projectId);
  if (!project) throw new Error('Select an assigned project.');
  const op: FieldOp = { id: id(), owner: data.profile.owner, kind: 'field_check_in', capturedISO: new Date().toISOString(),
    label: `Site check-in · ${project.name}`, payload: { projectId, ...fix }, photos: [], status: 'queued', attempts: 0 };
  await updateOutbox(op.owner, (rows) => [op, ...rows]);
  return op;
}

export async function queueEvidence(data: Bootstrap, taskId: string, sourceUri: string, mimeType: string, title: string) {
  const task = data.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error('This task is no longer assigned to your account.');
  if (!title.trim()) throw new Error('Add a short caption for the photo.');
  const opId = id(), owner = data.profile.owner;
  await ensureOwner(owner);
  const uri = `${pathFor(owner)}${opId}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  const photo: QueuedPhoto = { uri, mimeType };
  const op: FieldOp = { id: opId, owner, kind: 'evidence_pack', capturedISO: new Date().toISOString(),
    label: `${task.name} · ${title.trim()}`, payload: { projectId: task.projectId, subject: 'task', subjectRef: task.id, title: title.trim(), mediaRefs: [] },
    photos: [photo], status: 'queued', attempts: 0 };
  try { await updateOutbox(owner, (rows) => [op, ...rows]); }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }); throw error; }
  return op;
}

/** A single drain per device. Stable capture IDs and uploaded URLs survive retries and restarts. */
export function drainOutbox(owner: string, onChange?: (rows: FieldOp[]) => void): Promise<FieldOp[]> {
  if (drainPromise) return drainOwner === owner ? drainPromise : drainPromise.then(() => drainOutbox(owner, onChange));
  drainOwner = owner;
  const work = (async () => {
    let records = await readOutbox(owner);
    for (const row of records.filter((item) => item.status === 'queued' || item.status === 'failed').sort((a, b) => a.capturedISO.localeCompare(b.capturedISO))) {
      if (await getLastOwner() !== owner) break;
      try {
        if (row.kind === 'evidence_pack') {
          for (let index = 0; index < row.photos.length; index++) {
            if (await getLastOwner() !== owner) return records;
            if (row.photos[index]?.uploadedUrl) continue;
            const url = await uploadPhoto(row, index);
            records = await patch(owner, row.id, (current) => ({ ...current, photos: current.photos.map((photo, at) => at === index ? { ...photo, uploadedUrl: url } : photo) }));
            onChange?.(records);
            const photo = row.photos[index];
            if (photo) photo.uploadedUrl = url;
          }
          row.payload.mediaRefs = row.photos.map((photo) => photo.uploadedUrl);
          records = await patch(owner, row.id, (current) => ({ ...current, payload: { ...current.payload, mediaRefs: row.payload.mediaRefs } }));
          onChange?.(records);
        }
        if (await getLastOwner() !== owner) return records;
        const result = await submit(row);
        if (!result.ok) {
          records = await patch(owner, row.id, (current) => ({ ...current, status: result.conflict ? 'conflict' : 'failed', error: result.error, attempts: current.attempts + 1 }));
        } else {
          records = await patch(owner, row.id, (current) => ({ ...current, status: 'synced', ref: result.ref, error: undefined, attempts: current.attempts + 1 }));
          for (const photo of row.photos) await FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Connection failed. This capture remains on your device.';
        records = await patch(owner, row.id, (current) => ({ ...current, status: error instanceof ApiError && [409, 422].includes(error.status) ? 'conflict' : 'failed', error: message, attempts: current.attempts + 1 }));
        onChange?.(records);
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) break;
      }
      onChange?.(records);
    }
    return records;
  })();
  drainPromise = work.finally(() => { drainPromise = null; drainOwner = null; });
  return drainPromise;
}
