import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsWorkspace } from '@/components/construction/projects-workspace';
import { MaterialsWorkspace, type MaterialRow } from '@/components/construction/materials-workspace';
import { StockWorkspace } from '@/components/construction/stock-workspace';
import { ScheduleWorkspace } from '@/components/construction/schedule-workspace';
import { TwinWorkspace } from '@/components/construction/twin-workspace';
import { ApprovalsWorkspace, type ReqView } from '@/components/construction/approvals-workspace';
import { CopilotWorkspace } from '@/components/construction/copilot-workspace';
import { EvmCockpit } from '@/components/construction/evm-cockpit';
import { DigestWorkspace } from '@/components/construction/digest-workspace';
import { FieldCapture } from '@/components/construction/field-capture';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/actions/construction', () => ({}));
vi.mock('@/lib/offline/outbox', () => ({
  useOutbox: () => [], useOnline: () => true, isForcedOffline: () => false,
  capture: vi.fn(), removeOp: vi.fn(), clearSynced: vi.fn(), abandon: vi.fn(),
  requeue: vi.fn(), setForcedOffline: vi.fn(),
}));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const view = (file: string) => read('src/components/construction/' + file + '.tsx');
const coverage = [
  ['', 'command-center', ['overview', 'operations', 'attention', 'explore']],
  ['approvals', 'approvals-workspace', ['inbox', 'all', 'rules', 'overview']],
  ['audit', 'audit-workspace', ['trail', 'overview', 'reasons']],
  ['boq', 'boq-workspace', ['capture', 'preview']],
  ['build-watch', 'build-watch', ['progress', 'verification']],
  ['changes', 'change-orders-workspace', ['pipeline', 'posted', 'history']],
  ['copilot', 'copilot-workspace', ['assistant', 'safeguards']],
  ['digest', 'digest-workspace', ['draft', 'exports', 'overview', 'draft']],
  ['documents', 'documents-workspace', ['register', 'rfis', 'overview']],
  ['evm', 'evm-cockpit', ['overview', 'overview', 'curve', 'costs']],
  ['field', 'field-capture', ['report', 'issue', 'progress', 'evidence', 'attendance', 'queue']],
  ['operations', 'operations-workspace', ['subcontractors', 'field', 'handover', 'claims', 'closeout', 'payments', 'forecast']],
  ['portal', 'role-portal', ['overview', 'tools']],
  ['fx', 'fx-workspace', ['overview', 'rates', 'commitments']],
  ['league', 'league-workspace', ['scorecards', 'overview', 'methodology']],
  ['materials', 'materials-workspace', ['stock', 'overview', 'movements']],
  ['procurement', 'procurement-workspace', ['orders', 'rfqs', 'deliveries', 'overview']],
  ['projects', 'projects-workspace', ['register', 'overview']],
  ['quality', 'quality-workspace', ['inspections', 'punch', 'clashes']],
  ['risk', 'risk-radar', ['signals', 'overview', 'methodology']],
  ['safety', 'safety-workspace', ['permits', 'events', 'overview']],
  ['schedule', 'schedule-workspace', ['network', 'lookahead', 'milestones', 'overview']],
  ['simulator', 'simulator-workspace', ['assumptions', 'impact']],
  ['site', 'site-workspace', ['reports', 'issues', 'diary', 'overview']],
  ['stock', 'stock-workspace', ['stock', 'counts', 'ledger', 'overview']],
  ['timesheets', 'timesheets-workspace', ['sheets', 'costs', 'overview']],
  ['twin', 'twin-workspace', ['building', 'overview']],
  ['workforce', 'workforce-workspace', ['attendance', 'overview']],
] as const;

describe('Clinexa coverage of every Construction page', () => {
  it('has an explicit entry for all 28 routes and all 28 workspace components', () => {
    const root = resolve(process.cwd(), 'src/app/(ops)/construction');
    const routes = ['', ...readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)];
    expect(coverage.map(([route]) => route).sort()).toEqual(routes.sort());
    expect(coverage).toHaveLength(28);
    expect(coverage.map(([, file]) => file + '.tsx').sort()).toEqual(readdirSync(resolve(process.cwd(), 'src/components/construction')).filter((file) => file.endsWith('.tsx') && !['construction-ui.tsx', 'project-setup-workspace.tsx', 'drawing-controls.tsx', 'rfi-workspace.tsx', 'safety-operations.tsx', 'handover-claims-closeout.tsx'].includes(file)).sort());
    const composed = view('construction-ui');
    for (const primitive of ['Card', 'CardHeader', 'KpiCard', 'Button', 'IconButton', 'PortalDialog']) expect(composed).toMatch(new RegExp(`<${primitive}(?:\\s|>)`));
  });

  it('aligns the nested project setup workspace with the same composition system', () => {
    const page = read('src/app/(ops)/construction/projects/[projectId]/setup/page.tsx');
    const workspace = view('project-setup-workspace');
    expect(page).toContain('className="pb-page"');
    expect(page).toContain("requireCapability('reports_analytics', 'read', 'construction')");
    expect(workspace).toContain('<ConstructionFrame>');
    expect(workspace).toContain('<PageTabs ');
  });

  it.each(coverage)('aligns /construction/%s with the page edge and keeps its server guard', (route, component) => {
    const page = read('src/app/(ops)/construction/' + (route === 'portal' ? 'portal/[kind]/' : route ? route + '/' : '') + 'page.tsx');
    expect(page).toContain('className="pb-page"');
    expect(page).not.toMatch(/max-w-\[\d+px\] mx-auto/);
    expect(page).toMatch(/requireCapability\([^;]*'construction'\)/);
    expect(page).toContain("from '@/components/construction/" + component + "'");
  });

  it.each(coverage)('keeps /construction/%s section identities and mounted panel state', (_route, component, ids) => {
    const source = view(component);
    expect([...source.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1])).toEqual(ids);
    expect(source).toContain('<PageTabs ');
    expect(source).not.toMatch(/<PageTabs\s+key=/);
    expect(view('construction-ui')).toContain('shared.layout');
    expect(source).toContain('<ConstructionFrame>');
    expect(source).toMatch(/<PageHeader\b|<ConstructionSummary>|<CopilotSummary\b|<div className=\{styles\.heading\}>/);
    expect(source).not.toContain('pb-hero-title');
    expect(source).not.toMatch(/from ['"]@\/server\/(?:data|reads|guard)/);
  });

  it.each(['audit-workspace', 'documents-workspace', 'materials-workspace', 'procurement-workspace', 'projects-workspace', 'site-workspace', 'stock-workspace'])('%s uses one shared heading instead of a duplicate hero', (component) => {
    const source = view(component);
    expect(source.match(/<PageHeader\b/g)).toHaveLength(1);
    expect(source).not.toContain('pb-hero-title');
  });

  it.each(['boq-workspace', 'evm-cockpit', 'fx-workspace', 'materials-workspace', 'stock-workspace'])('%s opts its actual register into the shared table system', (component) => {
    const source = view(component);
    expect(source).toMatch(/<table\b[^>]*aria-label="[^"]+"[^>]*className=[^>]*pb-data-table/);
    expect(source).toContain('pb-table-frame');
    expect(source).toContain('<th scope="col"');
    expect(source).toContain('role="region"');
    expect(source).toContain('tabIndex={0}');
    expect(source).toContain('styles.scroll');
  });

  it.each(coverage)('replaces tiny primary record text in /construction/%s without changing chart geometry', (_route, component) => {
    expect(view(component)).not.toMatch(/text-\[(?:9|9\.5|10|10\.5|11|11\.5)px\]/);
  });

  it.each(['approvals-workspace', 'documents-workspace', 'field-capture', 'fx-workspace', 'materials-workspace', 'procurement-workspace', 'projects-workspace', 'site-workspace', 'stock-workspace', 'timesheets-workspace'])('%s applies shared sizing to secondary forms and dialogs too', (component) => {
    const source = view(component);
    expect(source).toMatch(/pb-form-control|styles\.(?:control|field)/);
    expect(source).toMatch(/pb-form-label|styles\.field/);
    expect(source).toContain('<label');
    expect(source).toContain('<Button');
    expect(source).toContain("from '@/components/ui'");
    if (component !== 'field-capture') {
      expect(source).toContain('ConstructionDialog');
      expect(source).toContain('pending={pending}');
      expect(source).toContain('useConstructionSave');
      expect(source).toContain('role="alert"');
    }
    const composed = view('construction-ui');
    expect(composed).toContain('shared.dialogTitle');
    expect(composed).toContain('canClose={!pending}');
    expect(composed).toContain('<IconButton');
  });

  it('removes superseded global style blocks and old form class hooks rather than leaking them between pages', () => {
    for (const [, component] of coverage) {
      const source = view(component);
      expect(source).not.toContain('<style>');
      expect(source).not.toMatch(/className="[^\"]*\b(?:lbl|inp)[a-z]+\b/);
    }
  });
});

const material: MaterialRow = {
  id: 'material-a', sku: 'CEM-42', name: 'Portland cement', category: 'Structure', unit: 'bags',
  onHand: 15, reserved: 3, inTransit: 10, reorderLevel: 20, unitCostMinor: 500_000,
  belowReorder: true, daysCover: 6, band: 'warn', receivedQty: 25, issuedQty: 10,
  leakageQty: 0, leakagePct: 0, anomalous: false, leakageValueMinor: 0,
};
const materials = (canMutate: boolean) => renderToStaticMarkup(createElement(MaterialsWorkspace, {
  materials: [material], trail: [], movements: [], projectName: 'Atlantic Court', projectId: 'project-a',
  kpis: { stockValueMinor: 7_500_000, belowReorder: 1, leakageValueMinor: 0, anomalies: 0 }, canMutate,
}));

describe('Construction records, permissions and specialised views survive the visual alignment', () => {
  it('keeps material figures, search and issue permissions in the redesigned table', () => {
    const html = materials(true);
    expect(html).toContain('aria-label="Construction materials register"');
    expect(html).toContain('Portland cement');
    expect(html).toContain('CEM-42');
    expect(html).toContain('aria-label="Search materials"');
    expect(html).toContain('12 bags');
    expect(html).toContain('> Issue</button>');
    expect(materials(false)).not.toContain('> Issue</button>');
    expect(html).toContain('role="tabpanel"');
  });

  it('retains the globally available New project action only for authorised viewers', () => {
    const props = { projects: [], kpis: { total: 0, contractMinor: 0, budgetMinor: 0, committedMinor: 0 } };
    const manager = renderToStaticMarkup(createElement(ProjectsWorkspace, { ...props, canMutate: true }));
    const viewer = renderToStaticMarkup(createElement(ProjectsWorkspace, { ...props, canMutate: false }));
    expect(manager.indexOf('New project')).toBeLessThan(manager.indexOf('role="tablist"'));
    expect(viewer).not.toContain('New project');
    expect(manager).toContain('data-page-header="true"');
  });

  it('keeps stock movements, reconciliation and value visibility without granting write controls', () => {
    const html = renderToStaticMarkup(createElement(StockWorkspace, {
      lines: [{ materialId: 'material-a', name: 'Portland cement', sku: 'CEM-42', unit: 'bags', warehouseId: 'store-a', warehouseName: 'Lekki site store', onHand: 15, reserved: 3, unitCostMinor: 500_000 }],
      warehouses: [], counts: [], ledger: [], adjustReasons: [], returnReasons: [],
      kpis: { valueMinor: 7_500_000, openCounts: 0, varianceQty: 0, movements: 0 }, canMutate: false,
    }));
    expect(html).toContain('aria-label="Construction stock by store"');
    expect(html).toContain('Lekki site store');
    expect(html).toContain('Portland cement');
    expect(html).not.toContain('title="Transfer to another store"');
    expect(html).not.toContain('title="Physical count"');
    expect(html).toContain('No stock counts are awaiting reconciliation.');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });

  it('keeps segregation-of-duty explanations and hides approval decisions from read-only users', () => {
    const request: ReqView = {
      id: 'request-a', ref: 'APR-42', subject: 'purchase_request', subjectRef: 'PR-42', title: 'Cement restock', amountMinor: 7_500_000,
      raisedBy: 'Ada Okafor', raisedISO: '2026-07-26', status: 'in_flight', ruleName: 'QS approval', steps: [], progressPct: 0,
      mine: false, blockedReason: 'Requester cannot approve their own transaction', overdue: false,
    };
    const props = { requests: [request], rules: [], reasons: [], kpis: { inbox: 0, inFlight: 1, overdue: 0, valueMinor: 7_500_000 } };
    const manager = renderToStaticMarkup(createElement(ApprovalsWorkspace, { ...props, canMutate: true }));
    const viewer = renderToStaticMarkup(createElement(ApprovalsWorkspace, { ...props, canMutate: false }));
    expect(manager).toContain('Requester cannot approve their own transaction');
    expect(manager).not.toContain('> Approve</button>');
    expect(viewer).not.toContain('> Reject</button>');
    expect(view('approvals-workspace')).toContain("canMutate && request.status === 'in_flight'");
  });

  it('preserves CPM bar positions, widths, float and downstream cascade calculations', () => {
    const source = view('schedule-workspace');
    expect(source).toContain('styles.ganttIdentity');
    expect(source).toContain('styles.ganttControls');
    expect(readFileSync(resolve(process.cwd(), 'src/components/construction/construction-delivery-polish.module.css'), 'utf8')).toContain('.ganttRow');
    expect(source).toContain('(t.offsetDays / span) * 100');
    expect(source).toContain('Math.max(1.5, (t.durationDays / span) * 100)');
    expect(source).toContain('Math.max(0, (t.durationDays / span) * 100 * (t.percentComplete / 100))');
    expect(source).toContain('onFocus={() => setHover(t.id)}');
    expect(source).toContain('cascade.has(t.id)');
    const html = renderToStaticMarkup(createElement(ScheduleWorkspace, {
      projectName: 'Atlantic Court', tasks: [{ id: 'task-a', name: 'Ground floor slab', owner: 'Chidi Obi', phase: 'Structure', plannedStartISO: '2026-07-01', plannedFinishISO: '2026-07-11', percentComplete: 50, status: 'in_progress', critical: true, slackDays: 0, offsetDays: 0, durationDays: 10, downstream: [] }],
      milestones: [], kpis: { durationDays: 10, criticalCount: 1, blocked: 0, forecastFinishISO: '2026-07-11', slipDays: 0, plannedFinishISO: '2026-07-11' }, canMutate: false,
    }));
    expect(html).toContain('Ground floor slab');
    expect(html).toContain('zero float');
    expect(html).toContain('width:50%');
    expect(html).not.toContain('title="Update progress"');
  });

  it('keeps the digital twin trade geometry and accessible floor selection', () => {
    const source = view('twin-workspace');
    const css = readFileSync(resolve(process.cwd(), 'src/components/construction/construction-delivery-polish.module.css'), 'utf8');
    expect(css).toMatch(/\.slabTrade\s*\{[^}]*width: 25%/);
    expect(source).toContain('z.layers[l.key]');
    expect(css).toMatch(/\.slab\s*\{[^}]*height: 44px/);
    expect(css).toMatch(/\.twinLevel\s*\{[^}]*min-height: 44px/);
    expect(source).toContain('<Button variant="ghost" aria-pressed={active}');
    const html = renderToStaticMarkup(createElement(TwinWorkspace, {
      zones: [{ id: 'zone-a', level: 1, label: 'First floor', block: 'Block A', layers: { structure: 100, blockwork: 50, mep: 0, finishes: 0 }, progress: 37, band: 'warn', openIssues: 1, openRfis: 1, tasks: [] }],
      projectName: 'Atlantic Court', kpis: { levels: 1, avgProgress: 37, topped: 1, activeLevel: 1, openIssues: 1 },
    }));
    expect(html).toContain('aria-label="First floor, 37% complete, 1 open issues, 1 unanswered RFIs"');
    expect(html).toContain('aria-pressed="false"');
    expect(html.match(/class="[^"]*slabTrade[^"]*"/g)).toHaveLength(4);
    expect(html).toContain('width:50%');
  });

  it('keeps chart geometry, verified AI source metadata, citations and human publishing guards', () => {
    expect(view('evm-cockpit')).toContain('const w = 640, h = 180, pad = 4');
    expect(view('risk-radar')).toContain('const size = 150, c = size / 2, rMax = c - 12');
    expect(view('copilot-workspace')).toContain("endpoint: '/api/construction/copilot', module: 'construction'");
    expect(read('src/lib/ai/copilot-client.ts')).toContain('validCopilotSource(module, source)');
    expect(read('src/components/ai/copilot-stream-reply.tsx')).toContain('exchange.meta.sources.map');
    expect(view('digest-workspace')).toContain('(view.coverageGaps.length > 0 && !confirmed)');
    expect(view('digest-workspace')).toContain('section.sources.map');
    expect(view('simulator-workspace')).toContain('Nothing is saved.');
    const html = renderToStaticMarkup(createElement(CopilotWorkspace, { suggestions: [], canSeeCommercials: false }));
    expect(html).toContain('commercial figures hidden for your access level');
    expect(html).toContain('type="submit"');
    expect(html).toContain('The copilot never transacts');
  });

  it('keeps offline forms, outbox and capture semantics mounted with labelled controls', () => {
    const html = renderToStaticMarkup(createElement(FieldCapture, { projects: [{ id: 'project-a', name: 'Atlantic Court', code: 'ATC' }], tasks: [], workers: [], todayISO: '2026-07-26' }));
    expect(html.match(/role="tab"/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Completed today"');
    expect(html).toContain('aria-label="Add to completed today"');
    expect(html).toContain('Device outbox');
    expect(view('field-capture')).toContain('}, photos);');
    expect(view('field-capture')).toContain("capture(owner, 'daily_report'");
    expect(view('field-capture')).toContain("capture(owner, 'task_progress'");
    expect(view('field-capture')).toContain("capture(owner, 'site_issue'");
    expect(view('field-capture')).toContain('client-generated id');
  });

  it('keeps the shared heading and a useful empty panel when no EVM or digest project exists', () => {
    const evm = renderToStaticMarkup(createElement(EvmCockpit, { views: [] }));
    const digest = renderToStaticMarkup(createElement(DigestWorkspace, { views: [], canMutate: false }));
    for (const html of [evm, digest]) { expect(html).toContain('data-page-header="true"'); expect(html).toContain('role="tabpanel"'); }
    expect(evm).toContain('No earned-value projects');
    expect(digest).toContain('No projects to report on.');
  });
});
