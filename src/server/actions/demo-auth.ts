'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getNativeAuth } from '@/server/auth/auth';
import { activateCompany, getNativeIdentity } from '@/server/auth/company';
import { authDatabasePool } from '@/server/auth/database';
import { consumeAuthAttempt } from '@/server/auth/rate-limit';
import { DEMO_ACCOUNTS, demoAccountsEnabled, isDemoAccount } from '@/server/auth/demo-config';
import { ensureDemoSandbox, resetDemoSandboxFor } from '@/server/auth/demo-sandbox';
import { DEMO_PERSONAS, DEMO_PERSONA_COOKIE } from '@/config/demo-personas';

type DemoState = { error?: string; message?: string };

export async function enterDemoAccount(_state: DemoState, form: FormData): Promise<DemoState> {
  if (!demoAccountsEnabled()) return { error: 'Demo access is not available right now. You can still create your own company account.' };
  const account = DEMO_ACCOUNTS.find((entry) => entry.module === form.get('module'));
  if (!account) return { error: 'Choose an available demo workspace.' };
  try {
    const existing = await getNativeIdentity();
    if (existing && !isDemoAccount(existing.user.id)) return { error: 'Sign out of your company account before exploring a demo.' };
    let identity = existing;
    if (!identity) {
      await consumeAuthAttempt('demo-entry-global', 'public-demo', 60, 3600);
      const response = await getNativeAuth().api.signInEmail({
        headers: await headers(),
        body: { email: account.email, password: process.env.PROPBREW_DEMO_PASSWORD!, rememberMe: true },
      });
      if (!('token' in response) || !response.token || response.user.id !== account.userId) throw new Error('Demo identity unavailable.');
      const result = await authDatabasePool().query<{ id: string }>(
        'select id from auth_sessions where token=$1 and "userId"=$2::uuid and "expiresAt">now()', [response.token, account.userId],
      );
      if (result.rowCount !== 1) throw new Error('Demo session unavailable.');
      identity = { user: response.user, session: { id: result.rows[0].id } };
    }
    const sandbox = await ensureDemoSandbox(identity);
    await activateCompany(identity, sandbox.id);
  } catch {
    return { error: 'The demo is busy or temporarily unavailable. Please try again later, or create your own company account.' };
  }
  redirect(`/${account.module}`);
}

export async function resetDemoSandbox(_state: DemoState, form: FormData): Promise<DemoState> {
  if (!demoAccountsEnabled() || form.get('confirm') !== 'reset-own-demo') return { error: 'Confirm that you want to reset your own demo sandbox.' };
  try {
    const identity = await getNativeIdentity();
    if (!identity || !isDemoAccount(identity.user.id)) return { error: 'Open your own demo sandbox before resetting sample data.' };
    await consumeAuthAttempt('demo-reset', identity.session.id, 5, 3600);
    await resetDemoSandboxFor(identity);
  } catch { return { error: 'Your sandbox could not be reset. Please refresh and try again.' }; }
  revalidatePath('/', 'layout');
  return { message: 'Your sandbox has been reset to fresh sample data across all three workspaces.' };
}

export async function switchDemoPersona(id: string): Promise<void> {
  if (!demoAccountsEnabled()) throw new Error('Demo user types are unavailable.');
  const identity = await getNativeIdentity();
  if (!identity || !isDemoAccount(identity.user.id)) throw new Error('A signed-in demo account is required.');
  const persona = DEMO_PERSONAS.find((entry) => entry.id === id);
  if (!persona) throw new Error('Choose an available demo user type.');
  await consumeAuthAttempt('demo-persona-switch', identity.session.id, 120, 3600);
  const store = await cookies();
  store.set(DEMO_PERSONA_COOKIE, persona.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(persona.home);
}
