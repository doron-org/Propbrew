import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(process.cwd(), 'src/app');
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const page = (file: string) => read('src/app/' + file);
const groupPages = (prefix: string, routes: readonly string[]) => routes.map((route) => prefix + (route ? '/' + route : '') + '/page.tsx');

/** Explicit review manifest. New, moved or removed pages must be reviewed here;
 * discovery is compared with this list, never used to silently enlarge it. */
const reviewed = {
  estate: groupPages('(ops)/(estate)', [
    'announcements', 'billing', 'board', 'bookings', 'collections', 'community', 'documents',
    'estate', 'events', 'finance', 'governance', 'investors', 'marketplace', 'parcels', 'people',
    'portfolio', 'properties', 'properties/[propertyId]', 'properties/[propertyId]/[section]', 'reports', 'rewards', 'security', 'settings', 'tenancy',
    'estate/work-orders', 'estate/work-orders/[ref]', 'estate/inspections', 'estate/copilot',
  ]),
  facility: groupPages('(ops)/(facility)', [
    'access', 'assets', 'contracts', 'control-center', 'copilot', 'energy', 'facility', 'field',
    'inspections', 'inventory', 'ppm', 'safety', 'spaces', 'sustainability', 'vendors',
    'facility/sites/[siteId]', 'facility/sites/[siteId]/[section]',
    'work-orders', 'work-orders/[ref]',
  ]),
  construction: groupPages('(ops)/construction', [
    '', 'approvals', 'audit', 'boq', 'build-watch', 'changes', 'copilot', 'digest', 'documents', 'evm',
    'field', 'fx', 'league', 'materials', 'operations', 'portal/[kind]', 'procurement', 'projects', 'projects/[projectId]', 'projects/[projectId]/[section]', 'projects/[projectId]/setup', 'quality', 'risk', 'safety',
    'schedule', 'simulator', 'site', 'stock', 'timesheets', 'twin', 'workforce',
  ]),
  shortlet: groupPages('(ops)/shortlet', [
    '', 'agents', 'analytics', 'booking-page', 'bookings', 'calendar', 'channels', 'expenses',
    'guests', 'inspections', 'maintenance', 'operations', 'plan', 'pricing', 'properties', 'properties/[propertyId]', 'properties/[propertyId]/[section]', 'reviews', 'team', 'whatsapp', 'copilot',
  ]),
  portal: groupPages('(portal)/portal', [
    '', 'announcements', 'bills', 'bookings', 'community', 'electricity', 'jobs', 'listings',
    'marketplace', 'orders', 'profile', 'projects', 'requests', 'returns', 'security', 'updates',
  ]),
  admin: groupPages('(admin)/admin', ['ai', 'audit', 'investors', 'overview', 'reports', 'requirements', 'tenants', 'users']),
  entryShared: [
    '(ops)/dashboard/page.tsx', '(ops)/workspaces/page.tsx', 'login/page.tsx',
    'onboarding/page.tsx', 'onboarding/complete/page.tsx', 'auth/continue/page.tsx',
    'sign-up/[[...sign-up]]/page.tsx',
    'review/login/page.tsx',
    'companies/page.tsx', 'company/team/page.tsx', 'invite/[token]/page.tsx',
    'account/security/page.tsx', 'login/two-factor/page.tsx', 'mobile/page.tsx',
    'construction/transmittals/acknowledge/page.tsx',
    'construction/digest/acknowledge/page.tsx',
  ],
  // Reviewed public entry: preserve its independent Propbrew marketing identity.
  publicMarketing: ['(marketing)/page.tsx'],
} as const;

type Family = keyof typeof reviewed;
const manifest = Object.entries(reviewed).flatMap(([family, files]) => files.map((file) => ({ family: family as Family, file })));
const headerDelegates = {
  '(ops)/(estate)/documents/page.tsx': { component: 'DocumentsWorkspace', source: 'src/components/documents/documents-workspace.tsx', heading: /<PageHeader\b/ },
  '(ops)/(estate)/estate/page.tsx': { component: 'EstateHome', source: 'src/components/workspaces/estate-home.tsx', heading: /<h2\b[^>]*>Welcome back,/ },
  '(ops)/(estate)/properties/page.tsx': { component: 'EstatePropertiesWorkspace', source: 'src/components/workspaces/estate-properties-workspace.tsx', heading: /<h2\b[^>]*>Properties<\/h2>/ },
  '(ops)/(estate)/properties/[propertyId]/page.tsx': { component: 'PropertyOperatingHub', source: 'src/components/workspaces/property-operating-hub.tsx', heading: /<h1>\{property\.name\}<\/h1>/ },
  '(ops)/(estate)/properties/[propertyId]/[section]/page.tsx': { component: 'PropertyOperatingHub', source: 'src/components/workspaces/property-operating-hub.tsx', heading: /<h1>\{property\.name\}<\/h1>/ },
  '(ops)/(estate)/estate/copilot/page.tsx': { component: 'AskData', source: 'src/components/reports/ask-data.tsx', heading: /<CopilotSummary\b[^>]*title="Ask about your estate"/ },
  '(ops)/(estate)/finance/page.tsx': { component: 'FinanceCommandCenter', source: 'src/components/finance/finance-command-center.tsx', heading: /<PageHeader\b[^>]*title="Finance Command Centre"/ },
  '(ops)/(facility)/copilot/page.tsx': { component: 'CopilotWorkspace', source: 'src/components/facility/copilot-workspace.tsx', heading: /<CopilotSummary\b[^>]*title="Ask about your facility"/ },
  '(ops)/(facility)/facility/sites/[siteId]/page.tsx': { component: 'ScopedOperatingHub', source: 'src/components/workspaces/scoped-operating-hub.tsx', heading: /<h1>\{title\}<\/h1>/ },
  '(ops)/(facility)/facility/sites/[siteId]/[section]/page.tsx': { component: 'ScopedOperatingHub', source: 'src/components/workspaces/scoped-operating-hub.tsx', heading: /<h1>\{title\}<\/h1>/ },
} as const;

function discoverPages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? discoverPages(file) : entry.name === 'page.tsx' ? [relative(APP, file)] : [];
  });
}

describe('Exhaustive application design review manifest', () => {
  it('accounts for every one of the 140 page files with no ignored directory or dynamic route', () => {
    const files = manifest.map(({ file }) => file);
    expect(new Set(files).size).toBe(140);
    expect(files).toHaveLength(140);
    expect(files.slice().sort()).toEqual(discoverPages(APP).sort());
    expect(files).toContain('(ops)/(facility)/work-orders/[ref]/page.tsx');
    expect(files).toContain('sign-up/[[...sign-up]]/page.tsx');
    expect(manifest.filter(({ family }) => family !== 'publicMarketing')).toHaveLength(139);
  });

  it.each([
    ['estate', 28], ['facility', 19], ['construction', 31], ['shortlet', 21],
    ['portal', 16], ['admin', 8], ['entryShared', 16], ['publicMarketing', 1],
  ] as const)('explicitly reviews all %s pages (%i)', (family, count) => {
    expect(reviewed[family]).toHaveLength(count);
  });

  it.each(manifest)('reviews $family: $file', ({ family, file }) => {
    const source = page(file);
    expect(source).toMatch(/export\s+default\s/);
    if (family !== 'estate' && family !== 'facility') return;

    const delegate = headerDelegates[file as keyof typeof headerDelegates];
    if (delegate) {
      expect(source).toContain('<' + delegate.component);
      expect(read(delegate.source)).toMatch(delegate.heading);
      expect(source).toMatch(/await\s+(?:requireCapability|requireWorkspace)\(/);
      return;
    }
    if (file === '(ops)/(facility)/facility/page.tsx') {
      expect(source).toContain("import ControlCenterPage from '../control-center/page'");
      expect(source).toMatch(/await\s+requireWorkspace\('facility'\)/);
      expect(source).toContain('<ControlCenterPage');
      expect(page('(ops)/(facility)/control-center/page.tsx')).toMatch(/<PageHeader\b/);
      return;
    }
    if (file === '(ops)/(facility)/work-orders/[ref]/page.tsx' || file === '(ops)/(estate)/estate/work-orders/[ref]/page.tsx') {
      const view = read('src/components/work-orders/work-order-detail-view.tsx');
      expect(view).toMatch(/<h2\b[^>]*>\{wo\.title\}<\/h2>/);
      expect(view).toContain('TransitionActions');
      expect(view).toContain('canTransition');
      expect(source).toContain('<WorkOrderDetailView');
      expect(source).toMatch(/await\s+requireCapability\('work_orders',\s*'read',\s*'(?:facility|estate)'\)/);
      expect(source).toContain('notFound()');
      return;
    }
    expect(source).toMatch(/<PageHeader\b/);
    expect(source).toMatch(/className="pb-page"/);
    expect(source).toMatch(/await\s+requireCapability\(/);
  });
});

function stripComments(css: string): string { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function normalized(selector: string): string { return selector.replace(/\s+/g, ' ').trim(); }
function rules(css: string): Array<{ selector: string; declarations: Record<string, string> }> {
  const source = stripComments(css).replace(/@(?:import|charset|namespace)\b[^;]*;/g, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: normalized(match[1]),
    declarations: Object.fromEntries(match[2].split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
      const colon = item.indexOf(':');
      return [item.slice(0, colon).trim(), item.slice(colon + 1).trim()];
    })),
  }));
}
function declarations(css: string, selector: string): Record<string, string> {
  const found = rules(css).find((rule) => rule.selector === normalized(selector));
  expect(found, 'Missing CSS rule: ' + selector).toBeDefined();
  return found?.declarations ?? {};
}
function block(css: string, marker: string): string {
  const start = css.indexOf(marker);
  expect(start, 'Missing CSS block: ' + marker).toBeGreaterThanOrEqual(0);
  const opening = css.indexOf('{', start);
  let depth = 1;
  for (let index = opening + 1; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(opening + 1, index);
  }
  throw new Error('Unclosed CSS block: ' + marker);
}

describe('Shared application foundations protect the visual system without changing domain meaning', () => {
  const css = read('src/components/ui/application-foundations.css');
  const global = read('src/app/globals.css');

  it('keeps application sections on the shared spacious operational rhythm', () => {
    expect(declarations(css, '.pb-app .pb-page')).toMatchObject({ width: '100%', 'min-width': '0', 'max-width': 'var(--dashboard-content-max)', gap: 'var(--layout-gap)' });
    expect(declarations(css, '.pb-app .pb-section')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: 'var(--layout-gap)' });
    expect(declarations(css, '.pb-app .pb-panel')).toMatchObject({ padding: 'var(--dashboard-panel-padding)', background: 'var(--surface)', 'border-radius': 'var(--radius-dashboard-panel)' });
  });

  it('sets tokenised 44px controls, with equally specific coarse-pointer safeguards', () => {
    expect(declarations(global, ':root')['--control-height']).toBe('44px');
    for (const name of ['pb-form-control', 'pb-action', 'pb-filter', 'pb-search']) expect(declarations(css, '.pb-app .' + name)['min-height']).toBe('var(--control-height)');
    const coarse = block(css, '@media (pointer: coarse)');
    const overrides = rules(coarse).filter((rule) => rule.declarations['min-height'] === '44px');
    for (const name of ['pb-form-control', 'pb-action', 'pb-filter', 'pb-search']) {
      const matching = overrides.find((rule) => rule.selector.includes('.' + name));
      expect(matching?.selector).toContain(':is(');
      expect(matching?.selector).not.toContain(':where(');
    }
    expect(declarations(coarse, '.pb-app .pb-icon-action')).toMatchObject({ width: '44px', height: '44px', 'min-height': '44px' });
  });

  it('keeps an airy register rhythm without recolouring financial cells', () => {
    expect(declarations(css, '.pb-app .pb-data-table thead th')).toMatchObject({ height: '44px', 'font-size': '10px', 'font-weight': '600', background: 'var(--surface-2)', 'text-transform': 'uppercase' });
    const records = declarations(css, '.pb-app .pb-data-table tbody :where(td, th)');
    expect(records).toMatchObject({ height: 'var(--dashboard-register-row-height)', 'font-size': '13px' });
    expect(records).not.toHaveProperty('color');
    expect(declarations(css, '.pb-app .pb-action')).not.toHaveProperty('color');
    expect(declarations(css, '.pb-app .pb-panel')).not.toHaveProperty('color');
    expect(css).not.toMatch(/(?:\.pb-app\s+(?:td|\.text-negative|\.text-warning|\.text-positive))\s*\{[^}]*color\s*:/);
  });

  it('uses the actual indigo/slate theme and preserves distinct light/dark action inks', () => {
    expect(declarations(global, ':root')).toMatchObject({ '--primary': '#4242ee', '--surface': '#ffffff', '--surface-2': '#f7f9fb', '--border': '#dde4e9' });
    const dark = declarations(global, "[data-theme='dark']");
    expect(dark['--primary']).not.toBe(declarations(global, ':root')['--primary']);
    expect(dark['--on-primary']).toBeDefined();
    expect(declarations(css, '.pb-app .bg-primary').color).toBe('var(--on-primary)');
    expect(css).not.toMatch(/#[a-f\d]{3,8}\b/i);
  });

  it('does not blanket-restyle checkboxes, radio buttons, sliders or file controls as text inputs', () => {
    const genericControls = rules(css).filter((rule) => rule.selector.includes('input:not('));
    expect(genericControls.length).toBeGreaterThan(0);
    for (const rule of genericControls) {
      for (const type of ['checkbox', 'radio', 'range', 'file', 'hidden']) expect(rule.selector).toContain("[type='" + type + "']");
    }
    expect(rules(css).some((rule) => /^\.pb-app\s+(?:input|select|textarea)\s*$/.test(rule.selector) && ('height' in rule.declarations || 'padding' in rule.declarations))).toBe(false);
  });
});

describe('Entry, onboarding and exceptional states are part of the review', () => {
  it('reviews the private password entry with shared foundations, labelled controls and an announced error', () => {
    expect(reviewed.entryShared).toContain('review/login/page.tsx');
    const entry = page('review/login/page.tsx');
    expect(entry).toMatch(/pb-app[^\"]*bg-app[^\"]*text-text/);
    for (const name of ['pb-form-label', 'pb-form-control', 'pb-action']) expect(entry).toContain(name);
    expect(entry).toContain('aria-labelledby="review-title"');
    expect(entry).toContain('htmlFor="review-password"');
    expect(entry).toContain('id="review-password"');
    expect(entry).toContain('type="password"');
    expect(entry).toContain('autoComplete="current-password"');
    expect(entry).toContain("aria-invalid={failed ? true : undefined}");
    expect(entry).toContain("aria-describedby={failed ? 'review-error' : undefined}");
    expect(entry).toContain('id="review-error" role="alert"');
    expect(entry).toContain('min-h-11');
    const reviewCss = read('src/app/review.css');
    expect(declarations(reviewCss, '.pb-app .pb-form-control.propbrew-review-password, .pb-app .pb-action.propbrew-review-submit')['min-height']).toBe('44px');
    expect(declarations(reviewCss, '.pb-app .pb-form-control.propbrew-review-password')['font-size']).toBe('16px');
    expect(entry).toContain('Do not enter customer information.');
    expect(entry).toContain('getReviewSession()');
    expect(entry).toContain('if (!reviewModeEnabled()) notFound()');
    expect(entry).not.toMatch(/(?:bg|text|border)-slate-\d+|#[a-f\d]{3,8}\b/i);
  });

  it('keeps signed-in handoffs and existing security checks intact', () => {
    expect(page('(ops)/dashboard/page.tsx')).toMatch(/await\s+requireOperatorSession\(\)/);
    expect(page('(ops)/dashboard/page.tsx')).toContain("redirect('/workspaces')");
    expect(page('auth/continue/page.tsx')).toContain('getOwnerIdentity()');
    expect(page('auth/continue/page.tsx')).toContain('getOwnerSetup(owner.subject)');
    expect(page('auth/continue/page.tsx')).toContain('homeRouteFor(session.actor)');
    expect(page('onboarding/page.tsx')).toContain('<OwnerSetupWizard');
    expect(page('sign-up/[[...sign-up]]/page.tsx')).toContain('forceRedirectUrl="/onboarding"');
    expect(page('login/page.tsx')).toContain('forceRedirectUrl="/auth/continue"');
  });

  it('uses theme-aware entry surfaces rather than hardcoded navy or slate error screens', () => {
    expect(page('login/page.tsx')).toMatch(/pb-app[^\"]*bg-app[^\"]*text-text/);
    const chooser = read('src/components/workspaces/workspace-chooser.module.css');
    expect(declarations(chooser, '.page')).toMatchObject({ background: 'var(--app)', color: 'var(--text)' });
    for (const file of ['src/app/error.tsx', 'src/app/not-found.tsx']) {
      const source = read(file);
      expect(source).toContain('pb-app pb-state');
      expect(source).toContain('pb-state-card');
      expect(source).toContain('pb-state-title');
      expect(source).not.toMatch(/(?:bg|text|border)-slate-\d+|#[a-f\d]{3,8}\b/i);
    }
    expect(read('src/app/error.tsx')).toContain('onClick={() => reset()}');
    expect(read('src/app/not-found.tsx')).toContain('href="/dashboard"');
  });

  it('brings owner setup into the same theme while keeping checked states and touch-sized controls', () => {
    const css = read('src/components/onboarding/owner-setup.module.css');
    expect(declarations(css, '.page')).toMatchObject({ '--setup-ink': 'var(--text)', '--setup-muted': 'var(--text-3)', '--setup-accent': 'var(--primary)', background: 'var(--app)' });
    expect(declarations(css, '.content')).toMatchObject({ background: 'var(--surface)', 'border-radius': '12px' });
    expect(declarations(css, '.choice:has(input:checked)')).toMatchObject({ background: 'var(--primary-weak)', 'border-color': 'var(--setup-accent)' });
    expect(declarations(css, '.paymentChoice:has(input:checked)')).toMatchObject({ background: 'var(--primary)', color: 'var(--on-primary)' });
    expect(declarations(css, '.input')['min-height']).toBe('44px');
    expect(declarations(css, '.back, .primary')['min-height']).toBe('44px');
    expect(css).not.toMatch(/#[a-f\d]{3,8}\b/i);
  });

  it('preserves onboarding progress, all payment choices, validation, save and completion callbacks', () => {
    const wizard = read('src/components/onboarding/owner-setup-wizard.tsx');
    const compact = wizard.replace(/\s+/g, '');
    expect(compact).toContain('<progressclassName={styles.progress}value={step+1}max={7}');
    expect(compact).toContain('onClick={()=>persist(index)}');
    expect(compact).toContain('validateOwnerStep(draft,step)');
    expect(compact).toContain('awaitcompleteOwnerSetupAction(next,version,scope)');
    expect(compact).toContain('awaitsaveOwnerSetupAction(next,version,scope)');
    expect(compact).toContain("router.replace('/onboarding/complete')");
    expect(compact).toContain('RENT_PAYMENT_METHODS.map((option)');
    expect(compact).toContain('checked={draft.rentPaymentMethods.includes(option.key)}');
    expect(compact).toContain('checked={draft[choice.field]===option.key}');
    expect(compact).toContain('disabled={pending||missingCurrentAnswer}');
    expect(compact).toContain('persist(Math.min(step+1,6),step===6)');
    expect(wizard).toContain('No payment is taken and no trial starts here.');
    expect(page('onboarding/complete/page.tsx')).toContain('Activation pending');
  });
});

describe('The reviewed public website keeps its deliberate, independent brand', () => {
  it('includes the marketing page in the manifest and keeps its public branded shell', () => {
    expect(reviewed.publicMarketing).toEqual(['(marketing)/page.tsx']);
    const layout = read('src/app/(marketing)/layout.tsx');
    expect(layout).toContain('pb-site');
    expect(layout).toContain('SiteHeader');
    expect(layout).toContain('SiteFooter');
    expect(layout).not.toMatch(/<(?:AppShell|ShellFrame)\b/);
    expect(page('(marketing)/page.tsx')).toContain('<ProductTour');
  });

  it('preserves public cobalt/citron typography without forcing dashboard styles onto it', () => {
    const css = read('src/app/(marketing)/marketing.css');
    expect(declarations(css, '.pb-site')).toMatchObject({ '--pb-cobalt': '#2346f0', '--pb-citron': '#d8f36a', 'font-family': 'var(--font-manrope), sans-serif' });
    expect(read('src/components/ui/application-foundations.css')).not.toContain('.pb-site');
    expect(read('src/components/ui/operational-surfaces.css')).not.toContain('.pb-site');
  });

  it('prevents public section spacing from leaking into the application after client navigation', () => {
    const marketing = read('src/app/(marketing)/marketing.css');
    const application = read('src/components/ui/application-foundations.css');
    const publicSection = rules(marketing).find((rule) => rule.selector === '.pb-section');
    const appSection = declarations(application, '.pb-app .pb-section');
    const marketingIsScoped = !publicSection || publicSection.declarations['padding-block'] === undefined;
    const appResetsPadding = appSection['padding-block'] === '0' || appSection.padding === '0';
    expect(marketingIsScoped || appResetsPadding).toBe(true);
  });
});
