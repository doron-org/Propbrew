import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WORKSPACES, type Workspace } from '@/config/workspaces';

type PopoverFixtureProps = {
  trigger: (controls: { open: boolean; toggle: () => void; close: () => void }) => ReactNode;
  children: (controls: { close: () => void }) => ReactNode;
};

// Render an open panel so these contracts exercise the real account content,
// independently from Popover's already-shared interaction behaviour.
vi.mock('@/components/inbox/popover', () => ({
  Popover: ({ trigger, children }: PopoverFixtureProps) => {
    const close = () => {};
    return createElement('div', null,
      trigger({ open: true, toggle: () => {}, close }),
      createElement('div', { 'data-open-account-panel': 'true' }, children({ close })),
    );
  },
}));
vi.mock('@/server/actions/auth', () => ({ signOut: vi.fn() }));

import { ProfileMenu } from '@/components/inbox/profile-menu';

const identity = { name: 'Ada Okafor', roleSummary: 'Estate manager', tenantLabel: 'Lagos portfolio' };
const render = (workspace?: Workspace) => renderToStaticMarkup(createElement(ProfileMenu, { ...identity, workspace }));

describe('workspace controls relocated into the account menu', () => {
  it.each(WORKSPACES)('shows the current $name workspace and contextual switch destination', (workspace) => {
    const html = render(workspace);
    expect(html).toContain(`${workspace.name} workspace`);
    expect(html).toContain(`href="/workspaces?from=${workspace.id}"`);
    expect(html).toContain(`aria-label="Switch workspace, current ${workspace.name}"`);
    expect(html.match(/href="\/workspaces\?from=/g)).toHaveLength(1);
    expect(html).not.toContain('Find a page');
  });

  it('does not invent an operator workspace switcher when no workspace is supplied', () => {
    const html = render();
    expect(html).not.toContain('Switch workspace');
    expect(html).not.toContain('href="/workspaces');
    expect(html).not.toContain('Estate workspace');
  });

  it('associates the expanded account trigger with its unique workspace panel', () => {
    const html = render(WORKSPACES[0]);
    const panelId = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(panelId).toBeTruthy();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`<div id="${panelId}">`);
  });

  it('retains account identity and sign out with or without a workspace', () => {
    for (const workspace of [undefined, WORKSPACES[0]]) {
      const html = render(workspace);
      expect(html).toContain('aria-label="Account menu — Ada"');
      expect(html).toContain(identity.name);
      expect(html).toContain(identity.roleSummary);
      expect(html).toContain(identity.tenantLabel);
      expect(html).toContain('Sign out');
      expect(html).not.toContain('Signing out…');
      expect(html).not.toMatch(/<button\b[^>]*\sdisabled(?:[=\s>])/);
    }
  });
});
