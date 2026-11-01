import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import type { Bootstrap, FieldOp, SyncOutcome } from './types';

const origin = (process.env.EXPO_PUBLIC_API_URL ?? 'https://usepropbrew.com').replace(/\/$/, '');
const COOKIE_KEY = 'propbrew.construction.session.cookie';
const MFA_COOKIE_KEY = 'propbrew.construction.mfa.cookie';
const OWNER_KEY = 'propbrew.construction.last.owner';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function getLastOwner() { return SecureStore.getItemAsync(OWNER_KEY); }
export async function rememberOwner(owner: string) { await SecureStore.setItemAsync(OWNER_KEY, owner); }
export async function hasSession() { return Boolean(await SecureStore.getItemAsync(COOKIE_KEY)); }
export async function forgetSession() { await Promise.all([SecureStore.deleteItemAsync(COOKIE_KEY), SecureStore.deleteItemAsync(MFA_COOKIE_KEY), SecureStore.deleteItemAsync(OWNER_KEY)]); }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = await SecureStore.getItemAsync(COOKIE_KEY);
  const mfaCookie = await SecureStore.getItemAsync(MFA_COOKIE_KEY);
  const response = await fetch(`${origin}${path}`, { ...init, headers: { accept: 'application/json', ...(cookie || mfaCookie ? { cookie: [cookie, mfaCookie].filter(Boolean).join('; ') } : {}), ...init.headers } });
  const nextCookie = response.headers.get('set-cookie');
  const sessionCookie = nextCookie?.match(/(?:^|,\s*)((?:__Secure-)?propbrew\.session_token=[^;,\s]+)/)?.[1];
  const nextMfaCookie = nextCookie?.match(/(?:^|,\s*)((?:__Secure-)?propbrew\.two_factor=[^;,\s]+)/)?.[1];
  if (sessionCookie) { await SecureStore.setItemAsync(COOKIE_KEY, sessionCookie); await SecureStore.deleteItemAsync(MFA_COOKIE_KEY); }
  else if (nextMfaCookie) await SecureStore.setItemAsync(MFA_COOKIE_KEY, nextMfaCookie);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? body.message ?? 'The request could not be completed.', response.status);
  return body as T;
}

export async function signIn(email: string, password: string): Promise<'ready' | 'totp'> {
  await SecureStore.deleteItemAsync(COOKIE_KEY);
  const result = await request<{ twoFactorRedirect?: boolean; twoFactorMethods?: string[] }>('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
  if (result.twoFactorRedirect) return 'totp';
  if (!await hasSession()) throw new Error('A session was not created. Complete any required account verification on the web, then try again.');
  return 'ready';
}
export async function verifyTotp(code: string) {
  await request('/api/auth/two-factor/verify-totp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim(), trustDevice: false }) });
  if (!await hasSession()) throw new Error('The verification succeeded but no session was created. Please sign in again.');
}
export const bootstrap = () => request<Bootstrap>('/api/mobile/v1/construction/bootstrap');
export const submit = (op: FieldOp) => request<SyncOutcome>('/api/mobile/v1/construction/sync', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': op.id },
  body: JSON.stringify({ id: op.id, owner: op.owner, kind: op.kind, capturedISO: op.capturedISO, payload: op.payload }),
});

export async function uploadPhoto(op: FieldOp, index: number): Promise<string> {
  const photo = op.photos[index];
  if (!photo) throw new Error('The saved photo is missing from this capture.');
  const cookie = await SecureStore.getItemAsync(COOKIE_KEY);
  if (!cookie) throw new ApiError('Sign in to upload your queued photo.', 401);
  const response = await FileSystem.uploadAsync(`${origin}/api/mobile/v1/construction/upload`, photo.uri, {
    httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: 'file',
    mimeType: photo.mimeType, headers: { cookie, accept: 'application/json' },
    parameters: { opId: op.id, projectId: String(op.payload.projectId), taskId: String(op.payload.subjectRef), index: String(index) },
  });
  const body = JSON.parse(response.body || '{}');
  if (response.status < 200 || response.status >= 300 || !body.url) throw new ApiError(body.error ?? 'Photo upload failed.', response.status);
  return body.url as string;
}
