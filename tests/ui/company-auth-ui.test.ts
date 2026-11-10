import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountForm } from '@/components/auth/account-form';
import { CompanyChooser } from '@/components/auth/company-chooser';
import { CompanyTeam, type CompanyMember } from '@/components/auth/company-team';
import { TwoFactorForm } from '@/components/auth/two-factor-form';
import { DemoAccess } from '@/components/auth/demo-access';

const hooks = vi.hoisted(() => ({ active: false, cursor: 0, slots: [] as unknown[], pending: false }));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useState(initial: unknown) {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      if (!hooks.active) return actual.useRef(initial);
      const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index];
    },
    useId() { return hooks.active ? `auth-test-${hooks.cursor++}` : actual.useId(); },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) { if (!hooks.active) return actual.useEffect(effect, dependencies); },
    useActionState(action: (state: unknown, form: FormData) => Promise<unknown>, initial: unknown) {
      if (!hooks.active) return actual.useActionState(action, initial);
      const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], async (form: FormData) => { hooks.slots[index] = await action(hooks.slots[index], form); }, hooks.pending];
    },
  };
});
vi.mock('@/server/actions/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/server/actions/demo-auth', () => ({ enterDemoAccount: vi.fn(async () => ({})) }));
const action = vi.fn(async () => ({}));
const companyAction = vi.fn<(form: FormData) => Promise<Record<string, never>>>(async () => ({}));
const selectCompany = vi.fn<(id: string) => Promise<Record<string, never>>>(async () => ({}));
const members: CompanyMember[] = [
  { id: 'owner-member', userId: 'owner', name: 'Ada Okafor', email: 'ada@example.test', companyRole: 'owner', modules: { estate: 'manage', facility: 'manage', shortlet: 'manage', construction: 'manage' }, isCurrentUser: true },
  { id: 'staff-member', userId: 'staff', name: 'Emeka Obi', email: 'emeka@example.test', companyRole: 'member', modules: { estate: 'view', facility: 'manage' }, isCurrentUser: false },
];
const assignments = { vendors: [{ id: 'vendor-1', name: 'Vendor One' }], estates: [{ id: 'estate-1', name: 'Palm Court' }], buildings: [{ id: 'block-1', siteId: 'estate-1', name: 'Block A' }], units: [{ id: 'unit-1', siteId: 'estate-1', buildingId: 'block-1', name: 'A-01' }], constructionProjects: [], constructionPackages: [], constructionSubcontractors: [], constructionTasks: [] };
const team = (canManage: boolean, values = members) => renderToStaticMarkup(createElement(CompanyTeam, { companyName: 'Palm Court', members: values, assignments, canManage, createCompanyInvite: companyAction, updateCompanyMember: companyAction, removeCompanyMember: companyAction }));
type Props = { children?: ReactNode; name?: string; type?: string; disabled?: boolean; checked?: boolean; 'aria-label'?: string; onClick?: () => void; action?: (form: FormData) => Promise<void> };
function elements(root: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!isValidElement<Props>(root)) return [];
  return [root, ...elements(root.props.children)];
}
function tree(fn: () => ReactNode) { hooks.active = true; hooks.cursor = 0; try { return fn(); } finally { hooks.active = false; } }
beforeEach(() => { hooks.active = false; hooks.cursor = 0; hooks.slots = []; hooks.pending = false; vi.clearAllMocks(); });

describe('company account and access presentation', () => {
  it('renders a real signup form with account/company details and no public permission controls', () => {
    const html = renderToStaticMarkup(createElement(AccountForm, { mode: 'signup', action }));
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(['companyName', 'email', 'name', 'password']);
    expect(html).toContain('autoComplete="new-password"'); expect(html).toContain('minLength="12"');
    expect(html).toContain('type="password"'); expect(html).toContain('Show password');
    expect(html).not.toContain('name="tenantId"'); expect(html).not.toContain('name="roles"');
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('Google'); expect(html).not.toContain('Clerk');
    for (const label of ['Estate', 'Facility', 'Shortlet', 'Construction']) expect(html).toContain(label);
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps login credentials appropriate for password managers and provides no unconfigured recovery links', () => {
    const html = renderToStaticMarkup(createElement(AccountForm, { mode: 'login', action }));
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(['email', 'password']);
    expect(html).toContain('autoComplete="current-password"'); expect(html).not.toContain('minLength="12"');
    expect(html).toContain('href="/sign-up"'); expect(html).not.toContain('Forgot password');
  });

  it('offers four clearly labelled demo workspaces without exposing or prefilling credentials', () => {
    for (const mode of ['signup', 'login'] as const) {
      const html = renderToStaticMarkup(createElement(AccountForm, { mode, action, demoEnabled: true }));
      expect(html).toContain('Explore a demo'); expect(html).toContain('Private sandbox');
      expect(html).toContain('sample data'); expect(html).toContain('No sign-up required');
      expect(html).toContain('Add, edit and try workflows'); expect(html).toContain('Your changes stay in your own sandbox');
      for (const [workspace, detail] of [['Estate', 'People & properties'], ['Facility', 'Assets & maintenance'], ['Shortlet', 'Guests & stays'], ['Construction', 'Projects & delivery']]) {
        expect(html).toContain(`<strong>${workspace}</strong><span>${detail.replace('&', '&amp;')}</span>`);
      }
      const demoButtons = [...html.matchAll(/<button[^>]+>/g)].map(([tag]) => tag).filter((tag) => tag.includes('name="module"'));
      expect(demoButtons.every((tag) => !tag.includes('aria-label'))).toBe(true);
      expect(html.match(/>Explore demo: </g)).toHaveLength(4);
      expect(demoButtons.map((tag) => /value="([^"]+)"/.exec(tag)?.[1])).toEqual(['estate', 'facility', 'shortlet', 'construction']);
      expect(html).not.toContain('@example.invalid'); expect(html).not.toContain('value="demo');
    }
    expect(renderToStaticMarkup(createElement(AccountForm, { mode: 'login', action }))).not.toContain('Explore a demo');
    expect(renderToStaticMarkup(createElement(AccountForm, { mode: 'signup', action, demoEnabled: true, invitationToken: 'a'.repeat(43) }))).not.toContain('Explore a demo');
  });

  it('disables demo choices while authentication is pending and announces errors', () => {
    const blocked = tree(() => DemoAccess({ disabled: true }));
    expect(elements(blocked).find((element) => element.type === 'fieldset')?.props.disabled).toBe(true);
    hooks.slots = []; hooks.pending = true;
    const pending = tree(() => DemoAccess({}));
    expect(elements(pending).find((element) => element.type === 'fieldset')?.props.disabled).toBe(true);
    hooks.slots = []; hooks.pending = false;
    tree(() => DemoAccess({}));
    hooks.slots[1] = { error: 'Demo access is temporarily unavailable.' };
    const failed = tree(() => DemoAccess({}));
    const html = renderToStaticMarkup(createElement('div', null, failed));
    expect(html).toContain('role="alert"'); expect(html).toContain('Demo access is temporarily unavailable.');
  });

  it('toggles password visibility through a labelled button and disables form controls during submission', () => {
    let view = tree(() => AccountForm({ mode: 'signup', action }));
    const toggle = elements(view).find((element) => element.type === 'button' && element.props['aria-label'] === 'Show password')!;
    expect(elements(view).find((element) => element.props.name === 'password')?.props.type).toBe('password');
    toggle.props.onClick!();
    view = tree(() => AccountForm({ mode: 'signup', action }));
    expect(elements(view).find((element) => element.props.name === 'password')?.props.type).toBe('text');
    expect(elements(view).some((element) => element.props['aria-label'] === 'Hide password')).toBe(true);
    hooks.pending = true; view = tree(() => AccountForm({ mode: 'signup', action }));
    expect(elements(view).find((element) => element.type === 'fieldset')?.props.disabled).toBe(true);
  });

  it('shows a clean company empty state and selects only the company ID attached to the chosen card', async () => {
    const empty = renderToStaticMarkup(createElement(CompanyChooser, { companies: [], createCompany: companyAction, selectCompany }));
    expect(empty).toContain('No company yet'); expect(empty).toContain('empty portfolio');
    expect(empty).not.toContain('7 Fifteen'); expect(empty).not.toContain('Sample portfolio');
    const view = tree(() => CompanyChooser({ companies: [{ id: 'company-own', name: 'Palm Court', role: 'owner', modules: ['Estate', 'Facility'] }], currentCompanyId: 'company-own', createCompany: companyAction, selectCompany }));
    const form = elements(view).find((element) => element.type === 'form' && elements(element.props.children).some((child) => child.props.name === 'companyId'))!;
    const input = new FormData(); input.set('companyId', 'company-own'); await form.props.action!(input);
    expect(selectCompany).toHaveBeenCalledWith('company-own'); expect(companyAction).not.toHaveBeenCalled();
  });

  it('renders all module grants clearly and hides membership actions from viewers', () => {
    const html = team(false);
    for (const value of ['Palm Court', 'Ada Okafor', 'Emeka Obi', 'Estate', 'Facility', 'Shortlet', 'Construction', 'No access', 'Manage', 'View']) expect(html).toContain(value);
    expect(html).not.toContain('Invite teammate</button>'); expect(html).not.toContain('Edit access</button>'); expect(html).not.toContain('Remove access</button>');
    expect(html).toContain('Owner access is protected.'); expect(html).toContain('AI assistance');
  });

  it('protects owner/current-user access controls and gives a truthful empty team state', () => {
    const owner = team(true, [members[0]]);
    expect(owner).toContain('Invite teammate</button>'); expect(owner).not.toContain('Edit access</button>'); expect(owner).not.toContain('Remove access</button>');
    const self = team(true, [{ ...members[1], isCurrentUser: true }]);
    expect(self).not.toContain('Edit access</button>'); expect(self).not.toContain('Remove access</button>');
    expect(team(false, [])).toContain('No company members to show');
  });

  it('carries a valid invitation through signup, login and second-factor verification without creating another company', () => {
    const token = 'a'.repeat(43);
    const signup = renderToStaticMarkup(createElement(AccountForm, { mode: 'signup', action, invitationToken: token }));
    expect(signup).toContain('name="invitationToken"'); expect(signup).toContain(`href="/login?invite=${token}"`);
    expect(signup).toContain('Join your company'); expect(signup).not.toContain('name="companyName"');
    const login = renderToStaticMarkup(createElement(AccountForm, { mode: 'login', action, invitationToken: token }));
    expect(login).toContain(`href="/sign-up?invite=${token}"`); expect(login).toContain('name="invitationToken"');
    const verification = renderToStaticMarkup(createElement(TwoFactorForm, { action, invitationToken: token }));
    expect(verification).toContain('name="invitationToken"');
    expect(renderToStaticMarkup(createElement(AccountForm, { mode: 'signup', action, invitationToken: 'invalid' }))).toContain('name="companyName"');
  });

  it('exposes account security/sign-out and shows team access only to the current company manager', () => {
    const props = { companies: [{ id: 'company-one', name: 'Palm Court', role: 'member', modules: ['Estate'] }], currentCompanyId: 'company-one', createCompany: companyAction, selectCompany };
    const viewer = renderToStaticMarkup(createElement(CompanyChooser, props));
    expect(viewer).toContain('href="/account/security"'); expect(viewer).toContain('Sign out'); expect(viewer).not.toContain('href="/company/team"');
    const owner = renderToStaticMarkup(createElement(CompanyChooser, { ...props, companies: [{ ...props.companies[0], role: 'owner' }] }));
    expect(owner).toContain('href="/company/team"');
  });

  it('uses an authenticator code initially and submits a recovery code only after an explicit mode change', () => {
    let view = tree(() => TwoFactorForm({ action }));
    expect(elements(view).filter((element) => element.type === 'input').map((element) => element.props.name)).toEqual(['code']);
    elements(view).find((element) => element.type === 'button' && element.props.children === 'Use a recovery code')!.props.onClick!();
    view = tree(() => TwoFactorForm({ action }));
    expect(elements(view).filter((element) => element.type === 'input').map((element) => element.props.name)).toEqual(['backupCode']);
    expect(action).not.toHaveBeenCalled();
  });
});
