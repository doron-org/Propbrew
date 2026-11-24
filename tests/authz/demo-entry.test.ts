import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACCOUNTS } from '@/server/auth/demo-config';
import { DEMO_PERSONAS, DEMO_PERSONA_COOKIE } from '@/config/demo-personas';

const boundary = vi.hoisted(() => ({
  getIdentity: vi.fn(), activateCompany: vi.fn(), signIn: vi.fn(),
  pool: vi.fn(), query: vi.fn(), consume: vi.fn(), headers: vi.fn(),
  auth: vi.fn(), redirect: vi.fn(), ensureSandbox: vi.fn(), resetSandbox: vi.fn(), revalidate: vi.fn(), cookies: vi.fn(), setCookie: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: boundary.headers, cookies: boundary.cookies }));
vi.mock('next/navigation', () => ({ redirect: boundary.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: boundary.revalidate }));
vi.mock('@/server/auth/demo-sandbox', () => ({ ensureDemoSandbox: boundary.ensureSandbox, resetDemoSandboxFor: boundary.resetSandbox }));
vi.mock('@/server/auth/auth', () => ({ getNativeAuth: boundary.auth }));
vi.mock('@/server/auth/database', () => ({ authDatabasePool: boundary.pool }));
vi.mock('@/server/auth/company', () => ({ getNativeIdentity: boundary.getIdentity, activateCompany: boundary.activateCompany }));
vi.mock('@/server/auth/rate-limit', () => ({ consumeAuthAttempt: boundary.consume }));

import { enterDemoAccount, resetDemoSandbox, switchDemoPersona } from '@/server/actions/demo-auth';

const PASSWORD = 'server-only-demo-fixture-credential-00001';
const SESSION_ID = 'cba55389-e0dc-4f0c-8a74-fbf5981f0824';
const SANDBOX_ID = '68449456-7aeb-4093-9c94-06c45638d133';
const TOKEN = 'synthetic-demo-session-token';
const headers = new Headers({ origin: 'https://propbrew.example.test' });
const userFor = (account: typeof DEMO_ACCOUNTS[number]) => ({ id: account.userId, name: account.name, email: account.email });
const formFor = (workspace: string) => { const form = new FormData(); form.set('module', workspace); return form; };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PROPBREW_AUTH_MODE', 'company');
  vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '1');
  vi.stubEnv('PROPBREW_DEMO_PASSWORD', PASSWORD);
  boundary.getIdentity.mockResolvedValue(null);
  boundary.headers.mockResolvedValue(headers);
  boundary.cookies.mockResolvedValue({ set: boundary.setCookie });
  boundary.consume.mockResolvedValue(undefined);
  boundary.activateCompany.mockResolvedValue(undefined);
  boundary.ensureSandbox.mockResolvedValue({ id: SANDBOX_ID, expiresAt: '2026-10-25T12:00:00.000Z' });
  boundary.resetSandbox.mockResolvedValue(undefined);
  boundary.auth.mockReturnValue({ api: { signInEmail: boundary.signIn } });
  boundary.pool.mockReturnValue({ query: boundary.query });
  boundary.query.mockResolvedValue({ rowCount: 1, rows: [{ id: SESSION_ID }] });
  boundary.signIn.mockResolvedValue({ token: TOKEN, user: userFor(DEMO_ACCOUNTS[0]) });
  boundary.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
});

describe('demo user type switch', () => {
  it('refuses real company accounts and unknown personas without setting a cookie', async () => {
    boundary.getIdentity.mockResolvedValue({ user: { id: '9d91d49f-f40d-4a4d-935b-04635d510e7c' }, session: { id: SESSION_ID } });
    await expect(switchDemoPersona('company-owner')).rejects.toThrow(/demo account/i);
    boundary.getIdentity.mockResolvedValue({ user: userFor(DEMO_ACCOUNTS[0]), session: { id: SESSION_ID } });
    await expect(switchDemoPersona('platform-admin')).rejects.toThrow(/available demo user type/i);
    expect(boundary.setCookie).not.toHaveBeenCalled();
  });

  it.each(DEMO_PERSONAS)('sets only the allowlisted $label persona and redirects to its safe home', async (persona) => {
    boundary.getIdentity.mockResolvedValue({ user: userFor(DEMO_ACCOUNTS[0]), session: { id: SESSION_ID } });
    await expect(switchDemoPersona(persona.id)).rejects.toThrow(`REDIRECT:${persona.home}`);
    expect(boundary.consume).toHaveBeenCalledExactlyOnceWith('demo-persona-switch', SESSION_ID, 120, 3600);
    expect(boundary.setCookie).toHaveBeenCalledExactlyOnceWith(DEMO_PERSONA_COOKIE, persona.id, expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }));
    expect(boundary.redirect).toHaveBeenCalledExactlyOnceWith(persona.home);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('demo entry server action', () => {
  it('refuses disabled demo access before resolving identity, authenticating or reading storage', async () => {
    vi.stubEnv('PROPBREW_DEMO_ACCOUNTS', '0');
    await expect(enterDemoAccount({}, formFor('estate'))).resolves.toEqual({ error: expect.stringContaining('not available') });
    for (const call of [boundary.getIdentity, boundary.headers, boundary.consume, boundary.auth, boundary.pool, boundary.activateCompany, boundary.redirect]) expect(call).not.toHaveBeenCalled();
  });

  it.each(['', 'admin', 'constructor', '__proto__', 'estate/../companies', 'shortlet?access=manage'])('refuses the unrecognised workspace %s before authenticating', async (workspace) => {
    await expect(enterDemoAccount({}, formFor(workspace))).resolves.toEqual({ error: 'Choose an available demo workspace.' });
    expect(boundary.getIdentity).not.toHaveBeenCalled(); expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.auth).not.toHaveBeenCalled(); expect(boundary.pool).not.toHaveBeenCalled();
  });

  it('does not replace an existing real company login with a shared demo identity', async () => {
    boundary.getIdentity.mockResolvedValue({ user: { id: '9d91d49f-f40d-4a4d-935b-04635d510e7c' }, session: { id: SESSION_ID } });
    await expect(enterDemoAccount({}, formFor('estate'))).resolves.toEqual({ error: expect.stringContaining('Sign out') });
    expect(boundary.consume).not.toHaveBeenCalled(); expect(boundary.auth).not.toHaveBeenCalled();
    expect(boundary.pool).not.toHaveBeenCalled(); expect(boundary.activateCompany).not.toHaveBeenCalled();
  });

  it.each(DEMO_ACCOUNTS)('opens the configured $module account inside a server-allocated private sandbox', async (account) => {
    const user = userFor(account);
    boundary.signIn.mockResolvedValue({ token: TOKEN, user });
    const form = formFor(account.module);
    form.set('email', 'attacker@example.invalid'); form.set('password', 'attacker-supplied-credential');
    form.set('userId', 'caller-controlled-user'); form.set('tenantId', 'caller-controlled-company');
    form.set('redirect', 'https://attacker.example.invalid'); form.set('role', 'owner');
    const destination = account.module === 'estate' || account.module === 'facility' ? '/property-management' : `/${account.module}`;
    await expect(enterDemoAccount({}, form)).rejects.toThrow(`REDIRECT:${destination}`);
    expect(boundary.consume).toHaveBeenCalledExactlyOnceWith('demo-entry-global', 'public-demo', 60, 3600);
    expect(boundary.signIn).toHaveBeenCalledExactlyOnceWith({ headers, body: { email: account.email, password: PASSWORD, rememberMe: true } });
    expect(boundary.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('auth_sessions'), [TOKEN, account.userId]);
    expect(boundary.ensureSandbox).toHaveBeenCalledExactlyOnceWith({ user, session: { id: SESSION_ID } });
    expect(boundary.activateCompany).toHaveBeenCalledExactlyOnceWith({ user, session: { id: SESSION_ID } }, SANDBOX_ID);
    expect(boundary.redirect).toHaveBeenCalledExactlyOnceWith(destination);
  });

  it('does not open the archived Construction demo', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_CONSTRUCTION', 'false');
    await expect(enterDemoAccount({}, formFor('construction'))).resolves.toEqual({ error: 'Construction is archived for now.' });
    expect(boundary.getIdentity).not.toHaveBeenCalled();
    expect(boundary.signIn).not.toHaveBeenCalled();
  });

  it('allows an already signed-in demo visitor to choose another demo workspace', async () => {
    boundary.getIdentity.mockResolvedValue({ user: userFor(DEMO_ACCOUNTS[0]), session: { id: SESSION_ID } });
    const account = DEMO_ACCOUNTS[3];
    boundary.signIn.mockResolvedValue({ token: TOKEN, user: userFor(account) });
    await expect(enterDemoAccount({}, formFor(account.module))).rejects.toThrow('REDIRECT:/construction');
    expect(boundary.signIn).not.toHaveBeenCalled();
    expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.activateCompany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user: userFor(DEMO_ACCOUNTS[0]), session: { id: SESSION_ID } }), SANDBOX_ID);
  });

  it('fails closed when authentication returns a different account', async () => {
    boundary.signIn.mockResolvedValue({ token: TOKEN, user: userFor(DEMO_ACCOUNTS[1]) });
    const response = await enterDemoAccount({}, formFor('estate'));
    expect(response.error).toMatch(/busy|unavailable/);
    expect(boundary.pool).not.toHaveBeenCalled(); expect(boundary.activateCompany).not.toHaveBeenCalled();
    expect(boundary.redirect).not.toHaveBeenCalled(); expect(JSON.stringify(response)).not.toContain(TOKEN);
  });

  it.each([
    { user: userFor(DEMO_ACCOUNTS[0]) },
    { token: '', user: userFor(DEMO_ACCOUNTS[0]) },
    { twoFactorRedirect: true },
  ])('does not treat a missing session token or MFA challenge as demo authentication', async (response) => {
    boundary.signIn.mockResolvedValue(response);
    await expect(enterDemoAccount({}, formFor('estate'))).resolves.toEqual({ error: expect.stringMatching(/busy|unavailable/) });
    expect(boundary.pool).not.toHaveBeenCalled(); expect(boundary.activateCompany).not.toHaveBeenCalled();
    expect(boundary.redirect).not.toHaveBeenCalled();
  });

  it.each([0, 2, null])('requires exactly one durable session row rather than row count %s', async (rowCount) => {
    boundary.query.mockResolvedValue({ rowCount, rows: rowCount ? [{ id: SESSION_ID }] : [] });
    await expect(enterDemoAccount({}, formFor('estate'))).resolves.toEqual({ error: expect.stringMatching(/busy|unavailable/) });
    expect(boundary.activateCompany).not.toHaveBeenCalled(); expect(boundary.redirect).not.toHaveBeenCalled();
  });

  it('returns a safe busy message when the shared demo rate limit is reached', async () => {
    boundary.consume.mockRejectedValue(new Error('private database limit detail'));
    const response = await enterDemoAccount({}, formFor('estate'));
    expect(response.error).toMatch(/busy|unavailable/); expect(response.error).not.toContain('private database');
    expect(boundary.auth).not.toHaveBeenCalled(); expect(boundary.pool).not.toHaveBeenCalled();
    expect(boundary.activateCompany).not.toHaveBeenCalled(); expect(boundary.redirect).not.toHaveBeenCalled();
  });

  it('does not redirect when membership activation rejects the reserved demo company', async () => {
    boundary.activateCompany.mockRejectedValue(new Error('membership unavailable'));
    await expect(enterDemoAccount({}, formFor('estate'))).resolves.toEqual({ error: expect.stringMatching(/busy|unavailable/) });
    expect(boundary.redirect).not.toHaveBeenCalled();
  });
});

describe('private demo reset', () => {
  it('requires confirmation before reading a session or changing records', async () => {
    await expect(resetDemoSandbox({}, new FormData())).resolves.toHaveProperty('error');
    expect(boundary.getIdentity).not.toHaveBeenCalled(); expect(boundary.resetSandbox).not.toHaveBeenCalled();
  });
  it('refuses real-company accounts even with a forged sandbox ID', async () => {
    boundary.getIdentity.mockResolvedValue({ user: { id: '9d91d49f-f40d-4a4d-935b-04635d510e7c' }, session: { id: SESSION_ID } });
    const form = new FormData(); form.set('confirm', 'reset-own-demo'); form.set('tenantId', SANDBOX_ID);
    await expect(resetDemoSandbox({}, form)).resolves.toHaveProperty('error');
    expect(boundary.resetSandbox).not.toHaveBeenCalled();
  });
  it('resets only the verified session mapping and never trusts a submitted company', async () => {
    const identity = { user: userFor(DEMO_ACCOUNTS[0]), session: { id: SESSION_ID } };
    boundary.getIdentity.mockResolvedValue(identity);
    const form = new FormData(); form.set('confirm', 'reset-own-demo'); form.set('tenantId', 'forged-other-company');
    await expect(resetDemoSandbox({}, form)).resolves.toHaveProperty('message');
    expect(boundary.consume).toHaveBeenCalledExactlyOnceWith('demo-reset', SESSION_ID, 5, 3600);
    expect(boundary.resetSandbox).toHaveBeenCalledExactlyOnceWith(identity);
    expect(boundary.revalidate).toHaveBeenCalledWith('/', 'layout');
  });
});
