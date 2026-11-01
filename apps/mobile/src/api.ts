import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { ConstructionBootstrap, ConstructionSyncReceipt } from './construction/types';

const origin = (process.env.EXPO_PUBLIC_API_URL ?? 'https://app.usepropbrew.com').replace(/\/$/, '');
const COOKIE_KEY = 'propbrew.session.cookie';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function hasSessionCookie() { return Boolean(await SecureStore.getItemAsync(COOKIE_KEY)); }
export async function sessionCookie() { return SecureStore.getItemAsync(COOKIE_KEY); }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = await SecureStore.getItemAsync(COOKIE_KEY);
  const response = await fetch(`${origin}${path}`, { ...init, headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } });
  const nextCookie = response.headers.get('set-cookie');
  const sessionCookie = nextCookie?.split(';')[0];
  if (sessionCookie) await SecureStore.setItemAsync(COOKIE_KEY, sessionCookie);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? 'Propbrew could not complete this request.', response.status);
  return body as T;
}

export async function signIn(email: string, password: string) {
  return request<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
}
export async function verifySecondFactor(code: string, backup = false) {
  return request<unknown>(backup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, trustDevice: false }),
  });
}
export async function signOut() {
  try { await request<unknown>('/api/auth/sign-out', { method: 'POST' }); }
  finally { await SecureStore.deleteItemAsync(COOKIE_KEY); }
}
export const bootstrap = <T>() => request<T>('/api/mobile/v1/bootstrap');
export const constructionBootstrap = () => request<ConstructionBootstrap>('/api/mobile/v1/construction/bootstrap');
export const mutate = <T>(body: Record<string, unknown>, key = randomUUID()) => request<T>('/api/mobile/v1/actions', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
export const constructionSync = (capture: { id: string; owner: string; kind: string; capturedISO: string; payload: Record<string, unknown> }) =>
  request<ConstructionSyncReceipt>('/api/mobile/v1/construction/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': capture.id }, body: JSON.stringify(capture) });
export function uploadConstructionPhoto(capture: { id: string; payload: Record<string, unknown>; photoUri: string }) {
  const form = new FormData();
  form.append('opId', capture.id);
  form.append('projectId', String(capture.payload.projectId));
  form.append('taskId', String(capture.payload.subjectRef));
  form.append('index', '0');
  form.append('file', { uri: capture.photoUri, type: 'image/jpeg', name: `${capture.id}.jpg` } as unknown as Blob);
  return request<{ ok: boolean; url: string; duplicate: boolean }>('/api/mobile/v1/construction/upload', { method: 'POST', body: form });
}
