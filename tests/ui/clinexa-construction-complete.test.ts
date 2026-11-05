import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandCenter } from '@/components/construction/command-center';
import { ProjectsWorkspace } from '@/components/construction/projects-workspace';
import { SiteWorkspace } from '@/components/construction/site-workspace';
import { WorkforceWorkspace } from '@/components/construction/workforce-workspace';
import { TimesheetsWorkspace } from '@/components/construction/timesheets-workspace';
import { FieldCapture } from '@/components/construction/field-capture';
import { BoqWorkspace } from '@/components/construction/boq-workspace';
import { ProcurementWorkspace } from '@/components/construction/procurement-workspace';
import { MaterialsWorkspace } from '@/components/construction/materials-workspace';
import { StockWorkspace } from '@/components/construction/stock-workspace';
import { ApprovalsWorkspace } from '@/components/construction/approvals-workspace';
import { DocumentsWorkspace } from '@/components/construction/documents-workspace';
import { ScheduleWorkspace } from '@/components/construction/schedule-workspace';
import { EvmCockpit } from '@/components/construction/evm-cockpit';
import { FxWorkspace } from '@/components/construction/fx-workspace';
import { RiskRadar } from '@/components/construction/risk-radar';
import { SafetyWorkspace } from '@/components/construction/safety-workspace';
import { AuditWorkspace } from '@/components/construction/audit-workspace';
import { BuildWatch } from '@/components/construction/build-watch';
import { TwinWorkspace } from '@/components/construction/twin-workspace';
import { SimulatorWorkspace } from '@/components/construction/simulator-workspace';
import { CopilotWorkspace } from '@/components/construction/copilot-workspace';
import { DigestWorkspace } from '@/components/construction/digest-workspace';
import { LeagueWorkspace } from '@/components/construction/league-workspace';
import { ConstructionOperationsWorkspace } from '@/components/construction/operations-workspace';
import { ConstructionRolePortal } from '@/components/construction/role-portal';
import { QualityWorkspace } from '@/components/construction/quality-workspace';
import { ChangeOrdersWorkspace } from '@/components/construction/change-orders-workspace';
import { constructionNaira } from '@/components/construction/construction-ui';
import { evaluateConstructionForecasts } from '@/domain/construction/forecast-evaluation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/actions/construction', () => ({}));
vi.mock('@/server/actions/construction-control', () => ({}));
vi.mock('@/server/actions/construction-change-orders', () => ({}));
vi.mock('@/lib/offline/outbox', () => ({ useOutbox: () => [], useOnline: () => true, isForcedOffline: () => false, capture: vi.fn(), removeOp: vi.fn(), clearSynced: vi.fn(), abandon: vi.fn(), requeue: vi.fn(), setForcedOffline: vi.fn() }));
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const component = (name: string) => read(`src/components/construction/${name}.tsx`);
const page = (route: string) => read(`src/app/(ops)/construction/${route === 'portal' ? 'portal/[kind]/' : route ? `${route}/` : ''}page.tsx`);
const view = <T extends object,>(element: React.FunctionComponent<T>, props: T) => renderToStaticMarkup(createElement(element, props));
const constructionFiles = ['command-center', 'projects-workspace', 'site-workspace', 'workforce-workspace', 'timesheets-workspace', 'field-capture', 'boq-workspace', 'procurement-workspace', 'materials-workspace', 'stock-workspace', 'approvals-workspace', 'documents-workspace', 'schedule-workspace', 'evm-cockpit', 'fx-workspace', 'risk-radar', 'safety-workspace', 'audit-workspace', 'build-watch', 'twin-workspace', 'simulator-workspace', 'copilot-workspace', 'digest-workspace', 'league-workspace', 'operations-workspace', 'role-portal', 'quality-workspace', 'change-orders-workspace'];
const evm = { bac: 10000025, pv: 5000012, ev: 4000010, ac: 4500015, cv: -500005, sv: -1000002, cpi: .89, spi: .8, eac: 11235983, etc: 6735968, vac: -1235958, tcpi: 1.1, costBand: 'warn' as const, scheduleBand: 'danger' as const };
const cases = [
  { route: '', component: 'command-center', tabs: 4, render: () => view(CommandCenter, { confidence: { score: 0, band: 'muted', label: 'No records', nairaAtRiskMinor: 0 }, projects: [], signals: [], deliveries: { late: [], today: [], upcoming: [] }, kpis: { activeProjects: 0, onSite: 0, plannedCrew: 0, openPoValueMinor: 0, criticalSignals: 0 }, canMutate: false }) },
  { route: 'projects', component: 'projects-workspace', tabs: 2, render: () => view(ProjectsWorkspace, { projects: [], kpis: { total: 0, contractMinor: 0, budgetMinor: 0, committedMinor: 0 }, canMutate: false }) },
  { route: 'site', component: 'site-workspace', tabs: 4, render: () => view(SiteWorkspace, { reports: [], gaps: [], kpis: { approved: 0, pending: 0, coverage: 0, incidents: 0 }, canMutate: false }) },
  { route: 'workforce', component: 'workforce-workspace', tabs: 2, render: () => view(WorkforceWorkspace, { workers: [], byTrade: [], kpis: { present: 0, planned: 0, shortfall: 0, dayCostMinor: 0, certAlerts: 0 }, projectName: 'Lagos site', projectId: 'project-1', canMutate: false }) },
  { route: 'timesheets', component: 'timesheets-workspace', tabs: 3, render: () => view(TimesheetsWorkspace, { sheets: [], byCode: [], posture: { postedMinor: 0, pendingMinor: 0, pendingSheets: 0, overtimeHours: 0 }, projectName: 'Lagos site', canMutate: false }) },
  { route: 'field', component: 'field-capture', tabs: 6, render: () => view(FieldCapture, { projects: [], tasks: [], workers: [], todayISO: '2026-07-26', canCapture: false }) },
  { route: 'operations', component: 'operations-workspace', tabs: 7, render: () => view(ConstructionOperationsWorkspace, { projects: [], subcontractors: [], evidence: [], fieldApprovals: [], handoverDocs: [], handoverPacks: [], variations: [], claims: [], retentionReleases: [], orders: [], payments: [], forecasts: [], forecastEvaluation: { snapshots: [], ...evaluateConstructionForecasts([], []), collection: { completedProjects: 0, missingCloseoutDate: 0, missingActualCost: 0, missingEligibleForecast: 0, missingClassification: 0, activeWithoutForecast: 0, gaps: [] } }, canCreate: false, canUpdate: false, canTransition: false }) },
  { route: 'portal', component: 'role-portal', tabs: 2, render: () => view(ConstructionRolePortal, { kind: 'client', projectCount: 0 }) },
  { route: 'quality', component: 'quality-workspace', tabs: 3, render: () => view(QualityWorkspace, { projects: [{ id: 'p-1', code: 'LAG-1', name: 'Lagos site' }], projectId: 'p-1', issues: [], taskNames: [], today: '2026-07-26', canCreate: false, canUpdate: false }) },
  { route: 'changes', component: 'change-orders-workspace', tabs: 3, render: () => view(ChangeOrdersWorkspace, { projects: [{ id: 'p-1', code: 'LAG-1', name: 'Lagos site' }], project: { id: 'p-1', code: 'LAG-1', name: 'Lagos site', approvedBudgetMinor: 0, contractMinor: 0, approvedChangeDays: 0 }, costCodes: [], rfis: [], issues: [], contractors: [], orders: [], canPropose: false, canRequest: false, canQuote: false, canAssess: false, canDecide: false, canPost: false, actorId: 'reviewer' }) },
  { route: 'boq', component: 'boq-workspace', tabs: 2, render: () => view(BoqWorkspace, { projects: [], canMutate: false }) },
  { route: 'procurement', component: 'procurement-workspace', tabs: 4, render: () => view(ProcurementWorkspace, { requests: [], rfqs: [], orders: [], kpis: { pending: 0, openPoMinor: 0, lateDeliveries: 0, exceptions: 0 }, canMutate: false }) },
  { route: 'materials', component: 'materials-workspace', tabs: 3, render: () => view(MaterialsWorkspace, { materials: [], trail: [], movements: [], projectName: 'Lagos site', projectId: 'project-1', kpis: { stockValueMinor: 0, belowReorder: 0, leakageValueMinor: 0, anomalies: 0 }, canMutate: false }) },
  { route: 'stock', component: 'stock-workspace', tabs: 4, render: () => view(StockWorkspace, { lines: [], warehouses: [], counts: [], ledger: [], adjustReasons: [], returnReasons: [], kpis: { valueMinor: 0, openCounts: 0, varianceQty: 0, movements: 0 }, canMutate: false }) },
  { route: 'approvals', component: 'approvals-workspace', tabs: 4, render: () => view(ApprovalsWorkspace, { requests: [], rules: [], reasons: [], kpis: { inbox: 0, inFlight: 0, overdue: 0, valueMinor: 0 }, canMutate: false }) },
  { route: 'documents', component: 'documents-workspace', tabs: 3, render: () => view(DocumentsWorkspace, { register: [], rfis: [], kpis: { documents: 0, approved: 0, inReview: 0, openRfis: 0, overdueRfis: 0 }, canMutate: false }) },
  { route: 'schedule', component: 'schedule-workspace', tabs: 4, render: () => view(ScheduleWorkspace, { projectName: 'Lagos site', tasks: [], milestones: [], kpis: { durationDays: 0, criticalCount: 0, blocked: 0, forecastFinishISO: '2027-06-01', plannedFinishISO: '2027-06-01', slipDays: 0 }, canMutate: false }) },
  { route: 'evm', component: 'evm-cockpit', tabs: 1, render: () => view(EvmCockpit, { views: [] }) },
  { route: 'fx', component: 'fx-workspace', tabs: 3, render: () => view(FxWorkspace, { rows: [], positions: [], rates: [], table: {}, unrealizedMinor: 0, spotExposureMinor: 0, canMutate: false }) },
  { route: 'risk', component: 'risk-radar', tabs: 3, render: () => view(RiskRadar, { signals: [], canMutate: false }) },
  { route: 'safety', component: 'safety-workspace', tabs: 3, render: () => view(SafetyWorkspace, { permits: [], events: [], talks: [], clashes: [], stats: { daysSinceLTI: null, lostTimeEvents: 0, nearMisses: 0, activePermits: 0, expiredPermits: 0, talksThisMonth: 0, score: 0, band: 'muted' }, projectName: 'Lagos site' }) },
  { route: 'audit', component: 'audit-workspace', tabs: 3, render: () => view(AuditWorkspace, { entries: [], pareto: {}, domains: ['delay'], summary: { total: 0, sensitive: 0, overrides: 0, valueMovedMinor: 0, actors: 0 } }) },
  { route: 'build-watch', component: 'build-watch', tabs: 2, render: () => view(BuildWatch, { projects: [], showCommercials: false }) },
  { route: 'twin', component: 'twin-workspace', tabs: 2, render: () => view(TwinWorkspace, { zones: [], projectName: 'Lagos site', kpis: { levels: 0, avgProgress: 0, topped: 0, activeLevel: 0, openIssues: 0 } }) },
  { route: 'simulator', component: 'simulator-workspace', tabs: 2, render: () => view(SimulatorWorkspace, { project: { id: 'p-1', name: 'Lagos site', code: 'LAG-1', plannedFinishISO: '2027-06-01', startISO: '2026-01-01', approvedBudget: { minor: 10000025, currency: 'NGN' }, plannedPercent: 50, percentComplete: 40 }, evm, tasks: [], criticalIds: [], baselineFinishISO: '2027-06-01', baselineSlipDays: 0, dieselExposureMinor: 0 }) },
  { route: 'copilot', component: 'copilot-workspace', tabs: 2, render: () => view(CopilotWorkspace, { suggestions: [], canSeeCommercials: false }) },
  { route: 'digest', component: 'digest-workspace', tabs: 1, render: () => view(DigestWorkspace, { views: [], canMutate: false }) },
  { route: 'league', component: 'league-workspace', tabs: 3, render: () => view(LeagueWorkspace, { rows: [], kpis: { subs: 0, avgScore: 0, totalValueMinor: 0, reworkMinor: 0 } }) },
];

beforeEach(() => vi.clearAllMocks());

describe('Deep Clinexa composition across the complete Construction module', () => {
  it('explicitly covers all 28 construction routes and all workspace files, excluding only the composed helper', () => {
    const routes = ['', ...readdirSync(resolve(process.cwd(), 'src/app/(ops)/construction'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)];
    expect(cases.map((item) => item.route).sort()).toEqual(routes.sort());
    expect(cases).toHaveLength(28);
    expect(constructionFiles.slice().sort()).toEqual(cases.map((item) => item.component).sort());
  });

  it('covers the nested project mobilisation workspace independently', () => {
    const source = component('project-setup-workspace');
    const route = read('src/app/(ops)/construction/projects/[projectId]/setup/page.tsx');
    expect(source).toContain('<ConstructionFrame>');
    expect(source).toContain('<PageTabs ');
    expect(route).toContain("requireCapability('reports_analytics', 'read', 'construction')");
    expect(route).toContain("from '@/components/construction/project-setup-workspace'");
  });

  it.each(cases)('keeps /construction/$route guarded, scoped and independently tabbed', ({ route, component: filename, render, tabs }) => {
    const source = component(filename), html = render();
    expect(page(route)).toContain("'read', 'construction'");
    expect(source).toContain('<ConstructionFrame>');
    expect(source).toContain('<PageTabs ');
    expect(source).not.toContain('pb-hero');
    expect(source).not.toContain('pb-stat');
    expect(source).not.toContain('fixed inset-0');
    expect(html.match(/role="tab"/g)).toHaveLength(tabs);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(tabs);
    expect(html).not.toContain('Recorded snapshot');
    expect(html).not.toContain('Company records');
    expect(html).not.toMatch(/NaN|Infinity/);
    if (tabs > 1) expect(html).toContain(' hidden=""');
  });

  it('uses actual shared components for every inner card, action, KPI and dialog, not a decorative page-level overlay', () => {
    const helper = component('construction-ui');
    for (const name of ['Card', 'CardHeader', 'KpiCard', 'Button', 'IconButton', 'EmptyState', 'PortalDialog']) expect(helper).toMatch(new RegExp(`<${name}(?:\\s|>)`));
    expect(helper).toContain('workspace-layout.module.css');
    for (const filename of constructionFiles.filter((file) => !['risk-radar', 'copilot-workspace'].includes(file))) expect(component(filename)).toContain('<ConstructionPanel');
    expect(helper).not.toContain('delta=');
  });

  it('provides a common compact/16px rhythm, quiet cards and 38px/44px controls', () => {
    const css = read('src/components/construction/construction-ui.module.css');
    for (const token of ['gap: var(--layout-gap)', 'gap: 16px', 'font-size: 14px', 'font-size: 12px', 'min-height: 38px', 'min-height: 44px', 'height: var(--table-row-height)', 'height: 36px', '@media (pointer: coarse)']) expect(css).toContain(token);
    for (const filename of constructionFiles) expect(component(filename)).not.toMatch(/text-\[(?:8|9|9\.5|10|10\.5|11|11\.5)px\]/);
  });

  it('provides named keyboard-scrollable registers and preserves semantic column headers', () => {
    for (const filename of ['boq-workspace', 'evm-cockpit', 'fx-workspace', 'materials-workspace', 'stock-workspace']) {
      const source = component(filename);
      for (const token of ['role="region"', 'tabIndex={0}', 'aria-label=', 'scope="col"', 'pb-data-table']) expect(source).toContain(token);
    }
  });

  it('matches the server’s create and update verbs without expanding read-only capabilities', () => {
    for (const route of ['projects', 'boq']) expect(page(route)).toContain("can(actor, 'reports_analytics', 'create').allowed");
    for (const route of ['', 'site', 'workforce', 'timesheets', 'procurement', 'materials', 'stock', 'approvals', 'documents', 'schedule', 'fx', 'risk', 'digest']) expect(page(route)).toContain("can(actor, 'reports_analytics', 'update').allowed");
    for (const route of ['stock', 'documents', 'schedule', 'risk']) expect(page(route)).toContain('canCreate={canCreate}');
    expect(page('field')).toContain("canCapture={can(actor, 'reports_analytics', 'create').allowed}");
    expect(component('field-capture')).toContain('disabled={!canCapture}');
    for (const token of ["scope.tenantId === '*' || count.tenantId === scope.tenantId", 'visibleMaterialIds.has(count.materialId)', 'visibleWarehouseIds.has(count.warehouseId)', 'scopedCounts.map']) expect(page('stock')).toContain(token);
  });

  it('requires native human review before consequential list actions and protects pending requests', () => {
    for (const file of ['command-center', 'workforce-workspace', 'site-workspace', 'timesheets-workspace', 'procurement-workspace', 'approvals-workspace', 'documents-workspace', 'schedule-workspace', 'risk-radar', 'boq-workspace', 'digest-workspace']) {
      expect(component(file)).toContain('useConstructionReview');
      expect(component(file)).toContain('{confirmation}');
    }
    const helper = component('construction-ui');
    for (const text of ['canClose={!pending}', 'dismissOnBackdrop={!pending}', 'submitting.current', 'role="alert"', 'catch', 'Confirm change']) expect(helper).toContain(text);
    expect(component('timesheets-workspace')).toContain('does not pay wages');
    expect(component('procurement-workspace')).toContain('This issues a purchase order and commits');
  });

  it('keeps every secondary dialog in the same accessible native system with local errors and duplicate protection', () => {
    for (const file of ['projects-workspace', 'site-workspace', 'timesheets-workspace', 'procurement-workspace', 'materials-workspace', 'stock-workspace', 'approvals-workspace', 'documents-workspace', 'schedule-workspace', 'fx-workspace']) {
      const source = component(file);
      for (const text of ['ConstructionDialog', 'useConstructionSave', 'role="alert"', 'pending={pending}', 'disabled={pending}']) expect(source).toContain(text);
      expect(source).not.toContain('fixed inset-0');
    }
    expect(component('projects-workspace')).toContain("plannedFinishISO: ''");
    expect(component('projects-workspace')).toContain('step="0.01"');
    expect(component('procurement-workspace')).toContain("const [qty, setQty] = useState('')");
  });

  it('preserves exact kobo instead of silently rounding financial cards or records', () => {
    expect(constructionNaira(25)).toBe('₦0.25');
    expect(constructionNaira(100000025)).toBe('₦1,000,000.25');
    expect(constructionNaira(-25)).toBe('₦-0.25');
    expect(component('fx-workspace')).toContain('minimumFractionDigits: 2');
    expect(component('fx-workspace')).toContain("convertMinor(ngnMinor, 'NGN', display, table)");
  });

  it('keeps illustrative curves and deterministic risk/digest scores distinct from verified evidence', () => {
    expect(component('evm-cockpit')).toContain('Illustrative interpolated curves');
    expect(component('command-center')).not.toContain('animate-ping');
    expect(component('digest-workspace')).toContain('not calibrated certainty');
    expect(component('digest-workspace')).toContain('Demo publications save without sending.');
    expect(component('documents-workspace')).toContain('The exact PDF revision will be attached to the email');
    expect(component('audit-workspace')).toContain('not a certified immutable');
  });

  it('retains zero-float task positions, working digital-twin layers and non-persistent scenario calculations', () => {
    const schedule = component('schedule-workspace');
    for (const token of ['(t.offsetDays / span) * 100', '(t.durationDays / span) * 100', 'cascade.has(t.id)', 'onFocus={() => setHover(t.id)}', 'Confirm create site issue']) expect(schedule).toContain(token);
    expect(schedule).not.toContain('Math.max(0.6');
    for (const token of ["key: 'structure'", "key: 'blockwork'", "key: 'mep'", "key: 'finishes'", 'aria-pressed={active}', 'styles.twinLevel']) expect(component('twin-workspace')).toContain(token);
    expect(read('src/components/construction/construction-delivery-polish.module.css')).toMatch(/\.twinLevel\s*\{[^}]*min-height: 44px/);
    expect(component('simulator-workspace')).toContain('Nothing is saved');
    expect(component('simulator-workspace')).toContain('recoveryPlan(tasks, critical, a.crashDays)');
    expect(component('materials-workspace')).not.toContain('Math.max(6');
  });
});

describe('Construction financial records and read-only access remain intact', () => {
  const stock: ComponentProps<typeof StockWorkspace> = { lines: [{ materialId: 'm-1', name: 'Cement', sku: 'CEM-42', unit: 'bags', warehouseId: 'w-1', warehouseName: 'Lekki store', onHand: 3, reserved: 1, unitCostMinor: 500025 }], warehouses: [{ id: 'w-1', name: 'Lekki store' }], counts: [], ledger: [], adjustReasons: [], returnReasons: [], kpis: { valueMinor: 1500075, openCounts: 0, varianceQty: 0, movements: 0 }, canMutate: false, canCreate: false };
  it('keeps stock values, availability and all four tabs while denying controls to read-only users', () => {
    const html = view(StockWorkspace, stock);
    for (const label of ['Cement', 'Lekki store', 'CEM-42', '₦15,000.75', 'Search stock and stores']) expect(html).toContain(label);
    expect(html).not.toContain('aria-label="Physical count of');
    expect(html).not.toContain('aria-label="Transfer Cement');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });
  it('grants count creation independently of stock transfer updates', () => {
    const html = view(StockWorkspace, { ...stock, canCreate: true });
    expect(html).toContain('aria-label="Physical count of Cement"');
    expect(html).not.toContain('aria-label="Transfer Cement');
  });
  it('shows construction safety incidents and permit clashes with explicit danger state, not a generic indigo override', () => {
    const source = component('safety-workspace');
    for (const label of ['Permit clash', 'tone="danger"', 'p.expired', 'p.clash', 'lost-time injury']) expect(source).toContain(label);
    expect(read('src/components/construction/construction-ui.module.css')).not.toMatch(/\.text-negative[^}]+color:\s*var\(--primary\)/);
  });

  it('keeps requests, advisory bid scores and partial deliveries visible without exposing finance writes to viewers', () => {
    const props: ComponentProps<typeof ProcurementWorkspace> = {
      requests: [{ id: 'pr-1', ref: 'PR-102', item: 'Cement restock', qty: 10, unit: 'bags', costCode: 'LAG-STR', estimateMinor: 1500025, requiredISO: '2026-08-01', requestedBy: 'Ada Okafor', status: 'pending', justification: 'Slab pour', exception: true, remainingMinor: 1000000 }],
      rfqs: [{ id: 'rfq-1', ref: 'RFQ-102', item: 'Cement restock', qty: 10, unit: 'bags', status: 'open', bids: [{ vendorId: 'v-1', vendorName: 'Lagos Materials', priceMinor: 1500025, leadDays: 2, warrantyMonths: 12, compliancePct: 100, score: 95, priceScore: 90, leadScore: 100, warrantyScore: 100, complianceScore: 100, recommended: true, vendorBand: 'success', suspended: false }] }],
      orders: [{ id: 'po-1', ref: 'PO-102', item: 'Steel reinforcement', vendorName: 'Lagos Materials', qty: 10, deliveredQty: 3, unit: 'tonnes', valueMinor: 1500025, status: 'part_delivered', expectedISO: '2026-07-20', late: true }], kpis: { pending: 1, openPoMinor: 1500025, lateDeliveries: 1, exceptions: 1 }, canMutate: false,
    };
    const html = view(ProcurementWorkspace, props);
    for (const text of ['PR-102', 'RFQ-102', 'PO-102', 'Cement restock', 'Lagos Materials', '₦15,000.25', '3/10', 'Weighted score', 'Advisory: a human awards', 'budget exception']) expect(html).toContain(text);
    expect(html).not.toContain('>Award</button>');
    expect(html).not.toContain('>Receive</button>');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });

  it('retains controlled revision history, RFI questions and formal state labels in read-only documents', () => {
    const props: ComponentProps<typeof DocumentsWorkspace> = {
      register: [{ number: 'LAG-S-102', title: 'Ground floor slab drawing', discipline: 'Structural', folder: 'Approved drawings', currentRevision: 'B', currentId: 'rev-1', inReview: 0, revisions: [{ id: 'rev-1', revision: 'B', status: 'approved', effectiveISO: '2026-07-20', changeNote: 'Reinforcement detail corrected', uploadedBy: 'Ada Okafor', approvedBy: 'Bola Ade', approvedISO: '2026-07-21', transmittals: [] }] }],
      rfis: [{ id: 'rfi-1', ref: 'RFI-102', question: 'Confirm beam reinforcement', discipline: 'Structural', drawingRef: 'LAG-S-102', raisedBy: 'Chidi Obi', assignedTo: 'Bola Ade', raisedISO: '2026-07-20', dueISO: '2026-07-24', status: 'open', daysOpen: 6, overdueDays: 2, band: 'danger' }], kpis: { documents: 1, approved: 1, inReview: 0, openRfis: 1, overdueRfis: 1 }, canMutate: false, canCreate: false,
    };
    const html = view(DocumentsWorkspace, props);
    for (const text of ['LAG-S-102', 'Ground floor slab drawing', 'Build to rev B', 'RFI-102', 'Confirm beam reinforcement', '2d overdue', 'aria-expanded="false"']) expect(html).toContain(text);
    expect(html).not.toContain('>Answer</button>');
    expect(html).not.toContain('>New revision</button>');
  });

  it('renders an EVM view with exact financials and a one-point curve without invalid SVG coordinates', () => {
    const props: ComponentProps<typeof EvmCockpit> = { views: [{ ...evm, projectId: 'p-1', name: 'Lekki building', code: 'LAG-1', curve: [{ label: 'Jul', pv: evm.pv, ev: evm.ev, ac: evm.ac, forecast: evm.eac }], nowFrac: .4, cashByMonth: [{ label: '2026-08', minor: 25 }], codes: [{ code: 'LAG-STR', name: 'Structure', budget: 10000025, committed: 5000025, actual: 2500025, earnedPercent: 40, plannedPercent: 50, variance: 5000000 }], forecastFinishISO: '2027-06-15', plannedFinishISO: '2027-06-01', slipDays: 14 }] };
    const html = view(EvmCockpit, props);
    for (const text of ['Lekki building', '₦100,000.25', '₦0.25', 'Structure', 'Illustrative interpolated curves', 'role="img"']) expect(html).toContain(text);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
  });

  it('preserves keyboard-readable zero-progress critical tasks without claiming work has started', () => {
    const props: ComponentProps<typeof ScheduleWorkspace> = { projectName: 'Lekki building', tasks: [{ id: 't-1', name: 'Roof slab', owner: 'Chidi Obi', phase: 'Structure', plannedStartISO: '2026-08-01', plannedFinishISO: '2026-08-10', percentComplete: 0, status: 'not_started', critical: true, slackDays: 0, offsetDays: 10, durationDays: 10, downstream: [] }], milestones: [], kpis: { durationDays: 20, criticalCount: 1, blocked: 0, forecastFinishISO: '2027-06-01', plannedFinishISO: '2027-06-01', slipDays: 0 }, canMutate: false };
    const html = view(ScheduleWorkspace, props);
    expect(html).toContain('aria-label="Roof slab: 0% complete, 10 days, critical path"');
    expect(html).toContain('width:0%');
    expect(html).toContain('zero float');
    expect(html).not.toContain('title="Update progress"');
  });

  it('retains all trade layers, floor identity and issue/RFI counters in the interactive building view', () => {
    const props: ComponentProps<typeof TwinWorkspace> = { zones: [{ id: 'z-1', level: 4, label: 'Level four', block: 'Atlantic block', layers: { structure: 100, blockwork: 50, mep: 25, finishes: 0 }, progress: 55, band: 'progress', openIssues: 2, openRfis: 1, tasks: [{ name: 'Masonry', percentComplete: 50, status: 'in_progress' }] }], projectName: 'Lekki building', kpis: { levels: 1, avgProgress: 55, topped: 1, activeLevel: 4, openIssues: 2 } };
    const html = view(TwinWorkspace, props);
    for (const text of ['Level four', 'L4', '55%', 'Structure', 'Blockwork', 'MEP', 'Finishes', 'aria-label="Level four, 55% complete, 2 open issues, 1 unanswered RFIs"']) expect(html).toContain(text);
    expect(html).toContain('twinLevel');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('displays audit timestamps explicitly in Nigerian time without overstating storage guarantees', () => {
    const props: ComponentProps<typeof AuditWorkspace> = { entries: [{ id: 'a-1', seq: 1, atISO: '2026-10-23T10:00:00Z', actorName: 'Ada Okafor', actorRole: 'estate_manager', action: 'override', entity: 'budget', entityRef: 'LAG-STR', summary: 'Budget override recorded', amountMinor: 25, before: '100', after: '125', reasonLabel: 'Revised scope', sensitive: true }], pareto: {}, domains: ['variance'], summary: { total: 1, sensitive: 1, overrides: 1, valueMovedMinor: 25, actors: 1 } };
    const html = view(AuditWorkspace, props);
    for (const text of ['Ada Okafor', 'Budget override recorded', 'LAG-STR', '₦0.25', '11:00', 'WAT', 'not a certified immutable']) expect(html).toContain(text);
  });
});
