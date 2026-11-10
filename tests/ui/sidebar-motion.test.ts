import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('original static sidebar rail', () => {
  it('mounts one quiet guide in the shared AppShell', () => {
    const shell = read('src/components/app-shell.tsx');
    expect(shell.match(/data-sidebar-guide="true"/g)).toHaveLength(1);
    expect(shell).toContain('className={styles.railLine}');
    expect(shell).not.toContain('SidebarMotionRail');
    expect(shell).not.toContain('SidebarSubmenuStrands');
    expect(shell).not.toContain('data-sidebar-motion');
    expect(shell).not.toContain('data-sidebar-strands');
    expect(shell).not.toContain('data-sidebar-active-dash');
  });

  it('uses the original straight neutral line and rounded active-row treatment', () => {
    const css = read('src/components/app-shell.module.css');
    const globals = read('src/app/globals.css');
    expect(css).toMatch(/\.railLine\s*\{[^}]*width:\s*1px[^}]*background:\s*var\(--border\)/);
    expect(css).toMatch(/\.navActive,\s*\.navActive:hover\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--workspace-accent\) 90%, var\(--text\)\)[^}]*background:\s*var\(--workspace-accent-weak\)/);
    expect(css).toMatch(/\.navLink\s*\{[^}]*border-radius:\s*8px/);
    expect(css).not.toContain('sidebar-strand');
    expect(css).not.toContain('sidebar-items-reveal');
    expect(globals).not.toContain('--motion-sidebar');
  });

  it('retains the current information architecture without drawing extra branch rails', () => {
    const shell = read('src/components/app-shell.tsx');
    expect(shell).toContain('groups.map((group)');
    expect(shell).toContain('group.items.map((item)');
    expect(shell).toContain('item.children.map((child)');
    expect(shell.match(/className=\{styles\.railLine\}/g)).toHaveLength(1);
  });

  it('keeps navigation and collapse controls at least 44px tall', () => {
    const css = read('src/components/app-shell.module.css');
    expect(css).toMatch(/\.collapseButton\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(css).toMatch(/\.groupToggle\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.navLink\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.nestedLink\s*\{[^}]*min-height:\s*44px\s*!important/);
    expect(css).toMatch(/\.mobileClose\s*\{[^}]*width:\s*44px\s*!important[^}]*height:\s*44px\s*!important/);
  });
});
