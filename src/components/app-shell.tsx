'use client';

/**
 * Application shell — collapsible sidebar, sticky header, mobile drawer.
 *
 * A 248px sidebar that collapses to a 72px icon rail, a 72px header, and a fixed
 * off-canvas drawer below 880px. Nav and identity are computed on the server
 * (getActor → visibleNav) and passed in as serializable data; this component
 * only renders and handles interactivity.
 */

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, Menu, Moon, Search, Sun, Building2, X } from 'lucide-react';
import { brand } from '@/config/brand';
import { activeNavHref, PAGE_META, type NavGroup } from '@/config/nav';
import { useTheme } from '@/components/theme-provider';
import { Icon } from '@/components/icon';
import { Avatar, IconButton } from '@/components/ui';
import { PageTabsHeaderContext } from '@/components/ui/page-tabs-header';
import { NotificationsMenu } from '@/components/inbox/notifications-menu';
import { MessagesMenu } from '@/components/inbox/messages-menu';
import { SyncIndicator } from '@/components/sync/sync-indicator';
import { ProfileMenu } from '@/components/inbox/profile-menu';
import { signOut } from '@/server/actions/auth';
import type { Notification, Thread } from '@/server/data/inbox';
import type { Workspace } from '@/config/workspaces';
import type { DemoPersonaId } from '@/config/demo-personas';
import styles from './app-shell.module.css';

const SIDEBAR_WIDTH = 248;
const SIDEBAR_COLLAPSED = 72;
const DRAWER_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Return only the wrapping target; normal Tab movement stays browser-native. */
export function drawerBoundaryTarget<T>(controls: readonly T[], active: T | null, backwards: boolean): T | undefined {
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const outside = active === null || !controls.includes(active);
  if (backwards && (active === first || outside)) return last;
  if (!backwards && (active === last || outside)) return first;
  return undefined;
}

export type ShellIdentity = {
  name: string;
  roleSummary: string;
  tenantLabel: string;
  outboxOwner?: string;
  companyAccount?: boolean;
  canManageTeam?: boolean;
  demoAccount?: boolean;
  demoPersonaId?: DemoPersonaId;
};

export function AppShell({
  groups,
  workspace,
  identity,
  notifications,
  unreadNotifications,
  threads,
  unreadMessages,
  devSwitcher,
  children,
}: {
  groups: NavGroup[];
  workspace?: Workspace;
  identity: ShellIdentity;
  notifications: Notification[];
  unreadNotifications: number;
  threads: Thread[];
  unreadMessages: number;
  devSwitcher?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const hrefIsActive = useCallback((href: string) => {
    const active = activeNavHref([{ label: 'Current', items: [{ id: 'current', label: 'Current', href, icon: 'gauge', capability: 'reports_analytics' }] }], pathname, currentQuery);
    return active === href;
  }, [pathname, currentQuery]);
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [openNavGroups, setOpenNavGroups] = useState<Set<string>>(() => new Set(
    groups.filter((group) => group.defaultOpen || group.items.some((item) => hrefIsActive(item.href) || item.children?.some((child) => hrefIsActive(child.href)))).map((group) => group.label),
  ));
  const [openNavItems, setOpenNavItems] = useState<Set<string>>(() => new Set(
    groups.flatMap((group) => group.items).filter((item) => item.children?.length && (hrefIsActive(item.href) || item.children.some((child) => hrefIsActive(child.href)))).map((item) => item.id),
  ));
  const [headerTabTarget, setHeaderTabTarget] = useState<HTMLDivElement | null>(null);
  // Page search. The header input used to be a decorative control with no value
  // and no handler on every page in the product; it now searches the nav the
  // actor can actually see and jumps to the page.
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const matches = query.trim()
    ? groups
        .flatMap((g) => g.items.flatMap((i) => [{ ...i, group: g.label }, ...(i.children ?? []).map((child) => ({ ...child, group: `${g.label} · ${i.label}` }))]))
        .filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 7)
    : [];
  const goTo = (href: string) => { setQuery(''); setSearchOpen(false); router.push(href); };
  const [signingOut, startSignOut] = useTransition();

  // Legacy Estate and Facility overview URLs remain available, but both now
  // live under the single Property Management entry in the rail.
  const activeHref = activeNavHref(groups, pathname, currentQuery)
    ?? ((pathname === '/estate' || pathname === '/facility') && workspace?.home === '/property-management'
      ? '/property-management'
      : null);
  const activeGroupLabel = groups.find((group) => group.items.some((item) => item.href === activeHref || item.children?.some((child) => child.href === activeHref)))?.label;
  const effectiveOpenNavGroups = activeGroupLabel && !openNavGroups.has(activeGroupLabel)
    ? new Set([...openNavGroups, activeGroupLabel])
    : openNavGroups;
  const activeNavItemId = groups.flatMap((group) => group.items).find((item) => item.children?.some((child) => child.href === activeHref))?.id;
  const effectiveOpenNavItems = activeNavItemId && !openNavItems.has(activeNavItemId)
    ? new Set([...openNavItems, activeNavItemId])
    : openNavItems;
  const meta = PAGE_META[pathname] ?? PAGE_META[activeHref ?? ''] ?? { title: workspace ? `${workspace.name} portal` : brand.name, subtitle: '' };
  const workspaceStyle = workspace ? {
    '--workspace-accent': workspace.accent,
    '--workspace-accent-weak': `color-mix(in srgb, ${workspace.accent} 9%, var(--surface))`,
  } as CSSProperties : undefined;

  const closeNavigation = useCallback((restoreFocus = true) => {
    setMobileNav(false);
    if (restoreFocus) requestAnimationFrame(() => menuTrigger.current?.focus());
  }, []);

  const closeSearch = useCallback((restoreFocus = true) => {
    setQuery('');
    setSearchOpen(false);
    if (restoreFocus) requestAnimationFrame(() => searchReturnFocus.current?.focus());
  }, []);

  const openSearch = useCallback((returnFocus?: HTMLElement | null) => {
    searchReturnFocus.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSearchOpen(true);
    searchInput.current?.focus();
  }, []);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (mobileNav) closeNavigation(false);
      openSearch(mobileNav ? menuTrigger.current : undefined);
    }
    if (e.key === 'Escape') {
      if (mobileNav) closeNavigation();
      else if (searchOpen) closeSearch();
    }
  }, [mobileNav, searchOpen, closeNavigation, closeSearch, openSearch]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (mobileNav) sidebar.current?.querySelector<HTMLButtonElement>('[aria-label="Close navigation menu"]')?.focus();
  }, [mobileNav]);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 879px)');
    const handleViewport = (event: MediaQueryListEvent) => { if (!event.matches) closeNavigation(false); };
    mobileViewport.addEventListener('change', handleViewport);
    return () => mobileViewport.removeEventListener('change', handleViewport);
  }, [closeNavigation]);

  return (
    <PageTabsHeaderContext.Provider value={headerTabTarget}>
    <div className={`pb-app ${styles.shell}`} data-app-shell="true" data-workspace={workspace?.id} data-collapsed={collapsed} style={{ ...workspaceStyle, '--sidebar-width': `${collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH}px` } as CSSProperties}>
      <a href="#main-content" className="skip-link" tabIndex={mobileNav ? -1 : undefined}>Skip to content</a>
      <header className={styles.header} inert={mobileNav} data-unified-header="true">
        <IconButton
          onClick={(event) => { menuTrigger.current = event.currentTarget; closeSearch(false); setMobileNav(true); }}
          title="Menu"
          aria-label="Open menu"
          aria-controls="application-sidebar"
          aria-expanded={mobileNav}
          className={styles.menuButton}
        >
          <Menu size={18} />
        </IconButton>

        <Link href={workspace?.home ?? groups[0]?.items[0]?.href ?? pathname} aria-label={`${brand.name} home`} className={styles.headerBrand}>
          <span className={styles.brandMark} aria-hidden="true"><Building2 size={22} strokeWidth={1.8} /></span>
          <span className={styles.brandName}>{brand.name}</span>
        </Link>

        <div ref={setHeaderTabTarget} className={styles.headerTabs} data-page-tabs-outlet="true" />

        <div className={styles.headerControls}>
        <IconButton title="Search pages" aria-label="Open page search" aria-expanded={searchOpen} aria-controls="global-search-container" onClick={(event) => searchOpen ? closeSearch() : openSearch(event.currentTarget)} className={styles.searchTrigger}><Search size={18} /></IconButton>
        <div id="global-search-container" className={`${styles.searchBox} ${searchOpen ? styles.searchOpen : ''}`}>
          <label htmlFor="global-search" className="sr-only">Search</label>
          <Search size={16} aria-hidden="true" className={styles.inputSearchIcon} />
          <input
            ref={searchInput}
            id="global-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setSearchIndex((index) => (index + 1) % matches.length); }
              if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setSearchIndex((index) => (index - 1 + matches.length) % matches.length); }
              if (e.key === 'Enter' && matches[searchIndex]) goTo(matches[searchIndex].href);
              if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
            }}
            placeholder="Search pages…"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={matches[searchIndex] ? `global-search-option-${matches[searchIndex].id}` : undefined}
            className={styles.searchInput}
          />
          <kbd className={styles.inputShortcut}>⌘ K</kbd>
          {searchOpen && <button type="button" onClick={() => closeSearch()} aria-label="Close page search" className={styles.searchClose}><X size={15} /></button>}
          {matches.length > 0 && (
            <ul
              id="global-search-results"
              role="listbox"
              aria-label="Pages"
              className={styles.searchResults}
            >
              {matches.map((m, index) => (
                <li key={m.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    id={`global-search-option-${m.id}`}
                    aria-selected={index === searchIndex}
                    tabIndex={-1}
                    onClick={() => goTo(m.href)}
                    className={styles.searchResult}
                  >
                    <Icon name={m.icon} aria-hidden="true" />
                    <span><span className={styles.resultLabel}>{m.label}</span><span className={styles.resultGroup}>{m.group}</span></span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.headerActions}>
          <SyncIndicator workspace={workspace?.id} owner={identity.outboxOwner} />
          <IconButton onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme" className={styles.themeButton}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <div className={styles.messages}>
            <MessagesMenu threads={threads} unread={unreadMessages} readOnly={identity.demoAccount} />
          </div>
          <NotificationsMenu notifications={notifications} unread={unreadNotifications} readOnly={identity.demoAccount} />
          <span className={styles.headerDivider} aria-hidden="true" />
          <ProfileMenu name={identity.name} roleSummary={identity.roleSummary} tenantLabel={identity.tenantLabel}
            companyAccount={identity.companyAccount} canManageTeam={identity.canManageTeam}
            demoPersonaId={identity.demoPersonaId}
            workspace={workspace ? { id: workspace.id, name: workspace.name, icon: workspace.icon } : undefined} />
        </div>
        </div>
      </header>

      {mobileNav && (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => closeNavigation()}
          className={styles.backdrop}
        />
      )}

      <aside
        ref={sidebar}
        id="application-sidebar"
        role={mobileNav ? 'dialog' : undefined}
        aria-modal={mobileNav || undefined}
        aria-label={mobileNav ? `${workspace?.name ?? brand.name} navigation menu` : undefined}
        onKeyDown={(event) => {
          if (!mobileNav || event.key !== 'Tab') return;
          const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE) ?? []).filter((control) => control.getClientRects().length > 0);
          const target = drawerBoundaryTarget(controls, document.activeElement instanceof HTMLElement ? document.activeElement : null, event.shiftKey);
          if (target) { event.preventDefault(); target.focus(); }
        }}
        style={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH }}
        className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ''}`}
      >
        {/* The desktop logo lives in the full-width header; this copy is drawer-only. */}
        <div className={styles.drawerBrandRow}>
          <span className={styles.brandMark} aria-hidden="true"><Building2 size={22} strokeWidth={1.8} /></span>
          <span className={styles.brandName}>{brand.name}</span>
          <IconButton bordered={false} onClick={() => closeNavigation()} title="Close menu" aria-label="Close navigation menu" className={styles.mobileClose}><X size={18} /></IconButton>
        </div>
        <div className={styles.sidebarToggleRow}>
          <IconButton bordered={false} onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={styles.collapseButton}>
            <ChevronLeft size={15} className={collapsed ? styles.rotated : undefined} />
          </IconButton>
        </div>

        {/* Nav */}
        <nav aria-label={workspace ? `${workspace.name} navigation` : 'Main navigation'} className={styles.navigation}>
          <div className={styles.navigationInner}>
            <span className={styles.railLine} data-sidebar-guide="true" aria-hidden="true" />
            {groups.map((group) => (
              <div key={group.label} className={styles.navGroup}>
              {group.collapsible ? <button type="button" className={styles.groupToggle} aria-expanded={effectiveOpenNavGroups.has(group.label)} onClick={() => setOpenNavGroups((current) => {
                if (current.has(group.label)) {
                  const next = new Set(current);
                  next.delete(group.label);
                  return next;
                }
                // Property groups behave as an accordion: opening the next
                // property closes the previous one and keeps a large portfolio tidy.
                return new Set([group.label]);
              })}><Building2 size={15} aria-hidden="true" /><span className={styles.collapsible}>{group.label}</span><ChevronRight size={14} aria-hidden="true" className={`${styles.collapsible} ${effectiveOpenNavGroups.has(group.label) ? styles.groupChevronOpen : ''}`} /></button>
                : <div className={`${styles.groupLabel} ${styles.collapsible}`}>{group.label}</div>}
              <div className={styles.groupItems} hidden={group.collapsible && !effectiveOpenNavGroups.has(group.label)}>
                {group.items.map((item) => {
                const active = activeHref === item.href;
                const childActive = item.children?.some((child) => child.href === activeHref) ?? false;
                if (item.children?.length) return <div key={item.id} className={styles.nestedNav}>
                  <button
                    type="button"
                    className={`${styles.navLink} ${styles.nestedToggle} ${active ? styles.navActive : ''} ${childActive ? styles.nestedParentActive : ''}`}
                    aria-expanded={effectiveOpenNavItems.has(item.id)}
                    onClick={() => setOpenNavItems((current) => {
                      if (current.has(item.id)) return new Set();
                      // Keep only one property subsection open so the rail stays compact.
                      return new Set([item.id]);
                    })}
                  >
                    <Icon name={item.icon} className={styles.navIcon} />
                    <span className={`${styles.navLabel} ${styles.collapsible}`}>{item.label}</span>
                    <ChevronRight size={13} aria-hidden="true" className={`${styles.collapsible} ${effectiveOpenNavItems.has(item.id) ? styles.groupChevronOpen : ''}`} />
                  </button>
                  <div className={styles.nestedItems} hidden={!effectiveOpenNavItems.has(item.id)}>
                    {item.children.map((child) => {
                    const nestedActive = activeHref === child.href;
                    return <Link key={child.id} href={child.href} title={child.label} aria-current={nestedActive ? 'page' : undefined} onClick={() => closeNavigation(false)} className={`${styles.navLink} ${styles.nestedLink} ${nestedActive ? styles.navActive : ''}`}>
                      <Icon name={child.icon} className={styles.navIcon} />
                      <span className={`${styles.navLabel} ${styles.collapsible}`}>{child.label}</span>
                    </Link>;
                    })}
                  </div>
                </div>;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => closeNavigation(false)}
                    className={`${styles.navLink} ${active ? styles.navActive : ''}`}
                  >
                    <Icon name={item.icon} className={styles.navIcon} />
                    <span className={`${styles.navLabel} ${styles.collapsible}`}>{item.label}</span>
                  </Link>
                );
                })}
              </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Identity footer */}
        <div className={styles.sidebarFooter}>
          <div className={styles.collapsible}>{devSwitcher}</div>
          <div className={styles.identity}>
            <Avatar name={identity.name} />
            <div className={`${styles.identityCopy} ${styles.collapsible}`}><span className={styles.identityName}>{identity.name}</span><span className={styles.identityRole}>{identity.roleSummary}</span></div>
            <IconButton bordered={false} title="Sign out" aria-label="Sign out" disabled={signingOut} onClick={() => startSignOut(async () => { await signOut(); })} className={`${styles.signOut} ${styles.collapsible}`}><LogOut size={16} /></IconButton>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className={styles.mainColumn} inert={mobileNav}>
        <main id="main-content" tabIndex={-1} className={styles.content} aria-labelledby="application-page-title">
          <h1 id="application-page-title" className="sr-only">{meta.title}</h1>
          {children}
        </main>
      </div>
    </div>
    </PageTabsHeaderContext.Provider>
  );
}
