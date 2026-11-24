import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { NavGroup } from '@/config/nav';
import { WORKSPACES, type Workspace } from '@/config/workspaces';

const navigation = vi.hoisted(() => ({ pathname: '/estate', push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: navigation.push }) }));
vi.mock('@/components/theme-provider', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/server/actions/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/components/inbox/notifications-menu', () => ({ NotificationsMenu: () => createElement('button', { 'aria-label': 'Notifications' }) }));
vi.mock('@/components/inbox/messages-menu', () => ({ MessagesMenu: () => createElement('button', { 'aria-label': 'Messages' }) }));
vi.mock('@/components/inbox/profile-menu', () => ({
  ProfileMenu: ({ workspace }: { workspace?: Pick<Workspace, 'id' | 'name' | 'icon'> }) => createElement('div', { 'data-account-menu': 'true' },
    createElement('button', { 'aria-label': 'Account menu' }),
    workspace && createElement('a', { href: `/workspaces?from=${workspace.id}`, 'aria-label': `Switch workspace, current ${workspace.name}` }, `${workspace.name} workspace`),
  ),
}));
vi.mock('@/components/sync/sync-indicator', () => ({ SyncIndicator: ({ workspace }: { workspace?: string }) => createElement('span', { 'data-sync-workspace': workspace }, 'Sync status') }));

import { AppShell, drawerBoundaryTarget } from '@/components/app-shell';

const groups: NavGroup[] = [{ label: 'Overview', items: [
  { id: 'estate', label: 'Estate overview', href: '/estate', icon: 'building', capability: 'announcements' },
  { id: 'people', label: 'Residents', href: '/people', icon: 'users', capability: 'users_roles' },
  { id: 'properties', label: 'Properties', href: '/properties', icon: 'building', capability: 'assets_ppm' },
] }];

function render(workspace = WORKSPACES[0], children: ReactNode = 'Scoped page content') {
  const props = {
    groups,
    workspace,
    identity: { name: 'Ada Okafor', roleSummary: 'Estate manager', tenantLabel: 'Lagos portfolio' },
    notifications: [], unreadNotifications: 0, threads: [], unreadMessages: 0,
    children,
  };
  return renderToStaticMarkup(createElement(AppShell, props));
}

beforeEach(() => { navigation.pathname = '/estate'; navigation.push.mockReset(); });

describe('Clinexa-adapted Propbrew application shell', () => {
  it('scopes the application design without changing the server-provided page content', () => {
    const html = render(undefined, createElement('section', { 'data-owned-page': 'true' }, 'Portfolio content'));
    expect(html).toContain('pb-app');
    expect(html).toContain('data-app-shell="true"');
    expect(html).toContain('data-workspace="estate"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
    expect(html).toContain('<section data-owned-page="true">Portfolio content</section>');
    expect(html).toContain('href="#main-content"');
  });

  it.each(WORKSPACES)('uses the $name accent only as secondary workspace context', (workspace) => {
    const html = render(workspace);
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? '';
    const aside = html.match(/<aside\b[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? '';
    expect(html).toContain(`--workspace-accent:${workspace.accent}`);
    expect(html).not.toContain('style="--primary:');
    expect(header).toContain('data-account-menu="true"');
    expect(header).toContain(`Switch workspace, current ${workspace.name}`);
    expect(header).toContain(`href="/workspaces?from=${workspace.id}"`);
    expect(aside).not.toContain('/workspaces?from=');
    expect(html).toContain(`data-sync-workspace="${workspace.id}"`);
  });

  it('preserves the exact authorised navigation order without adding other module destinations', () => {
    const html = render();
    expect(html.indexOf('title="Estate overview"')).toBeLessThan(html.indexOf('title="Residents"'));
    expect(html.indexOf('title="Residents"')).toBeLessThan(html.indexOf('title="Properties"'));
    expect(html).toContain('aria-label="Estate navigation"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="/construction"');
    expect(html).not.toContain('href="/shortlet"');
  });

  it('retains account, theme, inbox, sync and mobile navigation affordances', () => {
    const html = render();
    for (const name of ['Sign out', 'Toggle theme', 'Notifications', 'Messages', 'Account menu', 'Open menu', 'Collapse sidebar']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toContain('aria-controls="application-sidebar"');
    expect(html).toContain('Ada Okafor');
    expect(html).toContain('Estate manager');
  });

  it('places the full Propbrew identity in the shared header before tabs and outside sidebar collapse', () => {
    const html = render();
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? '';
    expect(html).toContain('data-unified-header="true"');
    expect(header).toContain('Propbrew');
    expect(header).toMatch(/<a\b[^>]*href="\/estate"[^>]*>[\s\S]*?Propbrew[\s\S]*?<\/a>/);
    expect(header.indexOf('Propbrew')).toBeLessThan(header.indexOf('data-page-tabs-outlet="true"'));
    expect(header).not.toMatch(/<h1\b/);
    const source = readFileSync(new URL('../../src/components/app-shell.tsx', import.meta.url), 'utf8');
    const brandLink = source.match(/<Link\b[^>]*className=\{styles\.headerBrand\}[^>]*>([\s\S]*?)<\/Link>/)?.[1] ?? '';
    expect(brandLink).toContain('brand.name');
    expect(brandLink).not.toContain('styles.collapsible');
    expect(source).toContain('styles.sidebarToggleRow');
  });

  it('makes the relocated header inert with the main content while the navigation dialog is open', () => {
    const source = readFileSync(new URL('../../src/components/app-shell.tsx', import.meta.url), 'utf8');
    const headerOpening = source.match(/<header\b[\s\S]*?>/)?.[0] ?? '';
    expect(headerOpening).toContain('inert={mobileNav}');
    expect(source).toMatch(/<div\b[^>]*className=\{styles\.mainColumn\}[^>]*inert=\{mobileNav\}/);
    expect(source).toContain("aria-modal={mobileNav || undefined}");
    expect(source).toContain("requestAnimationFrame(() => menuTrigger.current?.focus())");
  });

  it('keeps accessible page search present for desktop and the mobile search trigger', () => {
    const html = render();
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? '';
    expect(header).toContain('id="global-search"');
    expect(header).toContain('role="combobox"');
    expect(header).toContain('aria-autocomplete="list"');
    expect(header).toContain('aria-label="Open page search"');
    expect(header).toContain('aria-controls="global-search-container"');
    const source = readFileSync(new URL('../../src/components/app-shell.tsx', import.meta.url), 'utf8');
    expect(source).toContain("(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'");
  });

  it('keeps the sidebar focused on navigation without the relocated workspace card or duplicate search', () => {
    const html = render();
    const aside = html.match(/<aside\b[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? '';
    expect(aside).toContain('aria-label="Estate navigation"');
    expect(aside).toContain('title="Residents"');
    expect(aside).not.toContain('Switch workspace');
    expect(aside).not.toContain('Find a page');
    expect(aside).not.toContain('aria-label="Search pages"');
    expect(aside).not.toContain('global-search');
    expect(html.match(/id="global-search"/g)).toHaveLength(1);
  });

  it('removes the closed off-screen mobile drawer from keyboard navigation before hydration', () => {
    const css = readFileSync(new URL('../../src/components/app-shell.module.css', import.meta.url), 'utf8');
    const mobileRules = css.slice(css.indexOf('@media (max-width: 879px)'));
    expect(mobileRules).toMatch(/\.sidebar \{[^}]*visibility: hidden/);
    expect(mobileRules).toMatch(/\.sidebarOpen \{[^}]*visibility: visible/);
  });

  it('keeps the unified header brand theme-aware without replacing the shared action colour', () => {
    const css = readFileSync(new URL('../../src/components/app-shell.module.css', import.meta.url), 'utf8');
    const brandRule = css.match(/\.brandMark\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(brandRule).toMatch(/color:\s*var\(--on-primary(?:,\s*#fff)?\)/);
    expect(brandRule).toMatch(/background:\s*var\(--primary\)/);
    expect(css).not.toMatch(/--primary\s*:/);
  });

  it('uses neutral black dark surfaces without the previous navy cast', () => {
    const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
    const dark = css.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(dark).toContain('--app: #000000');
    expect(dark).toContain('--surface: #0b0b0c');
    expect(dark).toContain('--surface-2: #131315');
    expect(dark).toContain('--surface-3: #1c1c1f');
    for (const navy of ['#0b1120', '#111827', '#172033', '#202b40']) expect(dark).not.toContain(navy);
  });

  it('places the demo-only user type control in the account menu', () => {
    const shell = readFileSync(new URL('../../src/components/app-shell.tsx', import.meta.url), 'utf8');
    const profile = readFileSync(new URL('../../src/components/inbox/profile-menu.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('demoPersonaId={identity.demoPersonaId}');
    expect(profile).toContain('aria-label="Switch demo user type"');
    for (const workspace of ['Property Management', 'Shortlet', 'Construction']) {
      expect(profile).toContain(`label="${workspace} user types"`);
    }
    expect(profile).toContain("...workspacePersonas('estate')");
    expect(profile).toContain("...workspacePersonas('facility')");
    expect(profile).toContain("workspacePersonas('shortlet').map");
    expect(profile).toContain("workspacePersonas('construction').map");
  });
});

describe('mobile navigation keyboard boundary', () => {
  const controls = ['first', 'middle', 'last'];

  it('wraps Tab from the last visible drawer control to the first', () => {
    expect(drawerBoundaryTarget(controls, 'last', false)).toBe('first');
  });

  it('wraps Shift+Tab from the first visible drawer control to the last', () => {
    expect(drawerBoundaryTarget(controls, 'first', true)).toBe('last');
  });

  it('leaves normal movement inside the drawer to the browser', () => {
    expect(drawerBoundaryTarget(controls, 'middle', false)).toBeUndefined();
    expect(drawerBoundaryTarget(controls, 'middle', true)).toBeUndefined();
    expect(drawerBoundaryTarget(controls, 'first', false)).toBeUndefined();
    expect(drawerBoundaryTarget(controls, 'last', true)).toBeUndefined();
  });

  it('recovers focus that is outside the visible drawer in either direction', () => {
    expect(drawerBoundaryTarget(controls, 'outside', false)).toBe('first');
    expect(drawerBoundaryTarget(controls, 'outside', true)).toBe('last');
    expect(drawerBoundaryTarget(controls, null, false)).toBe('first');
  });

  it('handles a single focusable control and an empty list safely', () => {
    expect(drawerBoundaryTarget(['only'], 'only', false)).toBe('only');
    expect(drawerBoundaryTarget(['only'], 'only', true)).toBe('only');
    expect(drawerBoundaryTarget([], null, false)).toBeUndefined();
  });
});
