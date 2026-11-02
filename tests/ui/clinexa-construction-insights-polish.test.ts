import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RiskRadar } from '@/components/construction/risk-radar';
import { BuildWatch } from '@/components/construction/build-watch';
import { LeagueWorkspace } from '@/components/construction/league-workspace';
import { SimulatorWorkspace } from '@/components/construction/simulator-workspace';
import { DigestWorkspace } from '@/components/construction/digest-workspace';
import { DocumentsWorkspace } from '@/components/construction/documents-workspace';
import { AuditWorkspace } from '@/components/construction/audit-workspace';
import { constructionNaira } from '@/components/construction/construction-ui';
import { projectEVM, recoveryPlan, simulate, forecastFinishISO, type Task, type Project } from '@/domain/construction';
import type { TenantId } from '@/domain/ids';
import * as actions from '@/server/actions/construction';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/actions/construction', () => ({ acknowledgeSignal: vi.fn(), snoozeSignal: vi.fn(), dismissSignal: vi.fn(), escalateSignalToIssue: vi.fn(), publishDigest: vi.fn(), issueRevision: vi.fn(), approveRevision: vi.fn(), sendTransmittal: vi.fn(), answerRfi: vi.fn(), closeRfi: vi.fn() }));
const source = (file: string) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const component = (name: string) => source('src/components/construction/' + name + '.tsx');
const files = ['risk-radar', 'build-watch', 'league-workspace', 'simulator-workspace', 'digest-workspace', 'documents-workspace', 'audit-workspace'];
const sections = [
  ['risk-radar', ['signals', 'overview', 'methodology']],
  ['build-watch', ['progress', 'verification']],
  ['league-workspace', ['scorecards', 'overview', 'methodology']],
  ['simulator-workspace', ['assumptions', 'impact']],
  ['digest-workspace', ['exports', 'overview', 'draft']],
  ['documents-workspace', ['register', 'rfis', 'overview']],
  ['audit-workspace', ['trail', 'overview', 'reasons']],
] as const;
const project: Project = { tenantId: 'tenant-build' as TenantId, id: 'project', projectId: 'project', code: 'LAG-1', name: 'Lagos project', location: 'Ikoyi', clientName: 'Client', pmName: 'Manager', status: 'active', contractValue: { minor: 12000025, currency: 'NGN' }, approvedBudget: { minor: 10000025, currency: 'NGN' }, startISO: '2026-01-01', plannedFinishISO: '2027-06-01', plannedPercent: 50, percentComplete: 40 };
const task = (id: string, name: string, cost: number): Task => ({ tenantId: project.tenantId, id, projectId: project.id, phaseId: 'structure', name, owner: 'Site supervisor', plannedStartISO: '2026-10-24', plannedFinishISO: '2026-10-30', percentComplete: 0, status: 'not_started', priority: 'high', dependsOn: [], budget: { minor: 100000, currency: 'NGN' }, crash: { crashableDays: 3, crashCostPerDay: { minor: cost, currency: 'NGN' } } });
const tasks = [task('expensive', 'Expensive critical task with a complete descriptive name', 100025), task('cheap', 'Cheaper critical task with a complete descriptive name', 50025), task('noncritical', 'Noncritical task must not be shortened', 25)];
const evm = projectEVM(project, 4500015);
const baseline = forecastFinishISO(project, evm.spi);
const simulator: ComponentProps<typeof SimulatorWorkspace> = { project: { ...project, approvedBudget: { ...project.approvedBudget, currency: 'NGN' } }, evm, tasks, criticalIds: ['expensive', 'cheap'], baselineFinishISO: baseline.iso, baselineSlipDays: baseline.slipDays, dieselExposureMinor: 12345 };
const risk: ComponentProps<typeof RiskRadar> = { canMutate: false, canCreate: false, signals: [{ id: 'risk', kind: 'schedule_slip', projectId: 'project', projectName: 'Lagos project', severity: 'danger', confidence: .75, title: 'Critical programme slip with the full recorded evidence available', evidence: 'A complete evidence narrative that must not be clipped in the risk register.', recommendation: 'Review the critical chain and agree the responsible owner before escalation.', nairaAtRiskMinor: 100001, href: '/construction/schedule', state: 'active' }, { id: 'additional-tone', kind: 'missing_report', projectId: 'project', projectName: 'Lagos project', severity: 'muted', confidence: 0, title: 'Additional neutral-severity record remains visible', evidence: 'An incomplete record.', recommendation: 'Check the source.', nairaAtRiskMinor: 0, href: '/construction/site' }] };
const watch: ComponentProps<typeof BuildWatch> = { showCommercials: false, projects: [{ id: 'project', name: 'Lagos tower with a complete untruncated project name', code: 'LAG-1', location: 'Ikoyi', percentComplete: 0, plannedPercent: 25, confidence: { score: 64, band: 'warn', label: 'Watch', drivers: [{ label: 'Reporting coverage', value: '5 / 7 approved reports', tone: 'warn' }] }, handoverISO: '2027-06-01', forecastFinishISO: '2027-06-15', slipDays: 14, levels: [{ level: 4, label: 'Complete floor label outside the progress track', progress: 0, band: 'muted' }], milestones: [{ name: 'Structural handover review', dueISO: '2027-03-01', status: 'at_risk', band: 'warn' }], updates: Array.from({ length: 5 }, (_, index) => ({ dateISO: '2026-10-' + (20 + index), text: 'Full approved site narrative number ' + index, photos: index })), unitsSold: 2, unitsTotal: 10, investorHref: '/investors' }] };
const league: ComponentProps<typeof LeagueWorkspace> = { rows: [{ id: 'firm', name: 'Full subcontractor trading name without truncation', trade: 'Structural works', rank: 1, score: 90, band: 'success', deliveryPct: 80, qualityScore: 95, safetyScore: 100, tasksCompleted: 10, tasksOnTime: 8, defects: 1, reworkMinor: 25, safetyIncidents: 0, crewSize: 12, valueMinor: 100001, projects: ['Lagos project', 'Abuja project'] }], kpis: { subs: 1, avgScore: 90, totalValueMinor: 100001, reworkMinor: 25 } };
const digest: ComponentProps<typeof DigestWorkspace> = { canMutate: false, views: [{ projectId: 'project', projectName: 'Lagos project', code: 'LAG-1', weekOfISO: '2026-10-24', sourceSha256: 'a'.repeat(64), publications: [], sections: [{ title: 'Recorded progress', text: 'Complete source-linked narrative that is readable at the standard body size.', confidence: .8, sources: [{ label: 'Open the complete approved report record', href: '/construction/site' }] }, { title: 'Missing source example', text: 'A narrative without a supplied source must be qualified.', confidence: 0, sources: [] }], coverageGaps: ['2026-10-21'], deltas: [{ label: 'Recorded progress', value: '40%', tone: 'warn' }] }] };
const documents: ComponentProps<typeof DocumentsWorkspace> = { canMutate: false, canCreate: false, register: [{ number: 'LAG/A', title: 'Complete controlled drawing title', discipline: 'Structural', folder: 'Approved drawings', currentRevision: 'B', currentId: 'revision', inReview: 0, revisions: [{ id: 'revision', revision: 'B', status: 'approved', effectiveISO: '2026-10-24', uploadedBy: 'Recorded uploader', approvedBy: 'Responsible approver', approvedISO: '2026-10-24T10:00:00Z', changeNote: 'The complete change note remains readable.', transmittals: [{ id: 'tr-one', toParty: 'Recipient with a complete organisation name', sentISO: '2026-10-24T10:05:00Z', purpose: 'for_construction', acknowledgedISO: '2026-10-24T11:00:00Z' }] }] }, { number: 'LAG-A', title: 'Distinct drawing with a formerly colliding sanitised number', discipline: 'MEP', folder: 'Review', currentRevision: null, currentId: null, inReview: 0, revisions: [] }], rfis: [{ id: 'rfi', ref: 'RFI-1', question: 'Confirm the complete technical reinforcement and isolation detail before proceeding.', discipline: 'Structural', drawingRef: 'LAG/A', raisedBy: 'Originator', assignedTo: 'Responsible designer', raisedISO: '2026-10-20', dueISO: '2026-10-22', status: 'open', daysOpen: 4, overdueDays: 2, band: 'danger' }], kpis: { documents: 2, approved: 1, inReview: 0, openRfis: 1, overdueRfis: 1 } };
const audit: ComponentProps<typeof AuditWorkspace> = { entries: [{ id: 'event', seq: 42, atISO: '2026-10-24T10:00:00Z', actorName: 'Recorded decision maker', actorRole: 'estate_manager', action: 'override', entity: 'budget', entityRef: 'LAG-STR', summary: 'A full recorded override summary', amountMinor: 0, before: 'The full previous scope and assumptions.', after: '', reasonLabel: 'A full coded reason that must stay visible', note: 'Complete contextual note explaining the decision.', sensitive: true }], pareto: { delay: [{ code: 'D-01', label: 'A complete delay reason label that must not be clipped', category: 'Supplier', count: 3, sharePct: 75, cumulativePct: 75, impactMinor: 25, impactDays: 4, vital: true }] }, domains: ['delay'], summary: { total: 1, sensitive: 1, overrides: 1, valueMovedMinor: 25, actors: 1 } };

describe('Construction insight and assurance Clinexa polish', () => {
  it.each(files)('%s composes shared inner headers and statuses with explicit local layout', (file) => {
    const text = component(file);
    expect(text).toContain("from './construction-insights-polish.module.css'");
    expect(text).toContain('<CardHeader');
    expect(text).toContain('<StatusPill');
    expect(text).toContain('<ConstructionPanel');
    expect(text).not.toContain('truncate');
    expect(text).not.toMatch(/text-\[(?:8|9|10|11)px\]/);
    expect(text).not.toContain('aria-label="Close dialog"');
  });

  it.each(sections)('preserves %s mounted section IDs and ordering', (file, ids) => {
    const text = component(file);
    const navigation = text.slice(text.lastIndexOf('<PageTabs '));
    expect([...navigation.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])).toEqual(ids);
  });

  it('keeps reference spacing, readable labels, local scroll and fixed chart geometry responsive', () => {
    const css = source('src/components/construction/construction-insights-polish.module.css');
    for (const value of ['gap: 24px', 'gap: 16px', 'font-size: 14px', 'font-size: 12px', 'font-size: 16px; font-weight: 500', 'border-radius: var(--radius-card) var(--radius-card) 0 0', 'overflow-x: auto', 'flex: 0 0 150px', 'flex: 0 0 60px', 'flex-direction: column-reverse', 'min-height: 40px', 'min-height: 44px', '@media (max-width: 640px)']) expect(css).toContain(value);
    expect(component('risk-radar')).toContain('const size = 150');
    expect(component('build-watch')).toContain('width={60} height={60}');
  });

  it('retains all severity groups, evidence, exposure and rule strength without granting actions to viewers', () => {
    const html = renderToStaticMarkup(createElement(RiskRadar, risk));
    expect(html).toContain('Additional neutral-severity record remains visible');
    expect(html).toContain('A complete evidence narrative that must not be clipped in the risk register.');
    expect(html).toContain(constructionNaira(100001));
    expect(html).toContain('75% · rule-match score');
    expect(html).toContain('not a failure probability');
    expect(html).not.toContain('Acknowledge</button>');
    expect(html).not.toContain('Escalate to issue</button>');
    expect(html).toContain('Open source');
  });

  it('keeps escalation creation separate from updates and behind native review', () => {
    const html = renderToStaticMarkup(createElement(RiskRadar, { ...risk, canCreate: true }));
    expect(html).toContain('Escalate to issue</button>');
    expect(html).not.toContain('Acknowledge</button>');
    const text = component('risk-radar');
    for (const call of ['acknowledgeSignal(signal.id)', 'snoozeSignal(signal.id)', 'dismissSignal(signal.id)', 'escalateSignalToIssue(signal.id, signal.projectId, signal.title)', 'useConstructionReview', '{confirmation}']) expect(text).toContain(call);
  });

  it('shows the prior escalation receipt while preserving advisory actions and preventing a duplicate escalation affordance', () => {
    const html = renderToStaticMarkup(createElement(RiskRadar, { canMutate: true, canCreate: true, signals: [{ ...risk.signals[0], state: 'escalated', escalatedIssueId: 'is-esc-recorded' }] }));
    expect(html).toContain('Recorded site issue:'); expect(html).toContain('is-esc-recorded');
    expect(html).toContain('Acknowledge</button>'); expect(html).toContain('Snooze</button>'); expect(html).toContain('Dismiss</button>');
    expect(html).not.toContain('Escalate to issue</button>');
  });

  it('retains full floor identity, full-year programme dates, forecast finish and every supplied update', () => {
    const html = renderToStaticMarkup(createElement(BuildWatch, watch));
    for (const text of ['Complete floor label outside the progress track', '1 Jun 2027', '15 Jun 2027', '24 Oct 2026', 'Full approved site narrative number 4', 'Structural handover review', 'at risk', '5 / 7 approved reports', '2 / 10 units recorded sold']) expect(html).toContain(text);
    expect(html).toContain('width:0%');
    expect(html).toContain('not a calibrated probability');
    expect(html).toContain('Vendor pricing, bid detail and labour rates withheld');
    expect(html).not.toContain('undefined');
  });

  it('shows no supplied site update or milestone as an explicit data gap', () => {
    const html = renderToStaticMarkup(createElement(BuildWatch, { ...watch, projects: [{ ...watch.projects[0], updates: [], milestones: [], levels: [], unitsSold: undefined, unitsTotal: undefined, investorHref: undefined }] }));
    expect(html).toContain('No approved site update was supplied');
    expect(html).toContain('No milestones were supplied');
    expect(html).toContain('No floor progress records were supplied');
    expect(html).not.toContain('Recorded sales context');
  });

  it('preserves complete subcontractor facts and exact rework kobo without claiming a clean safety history', () => {
    const html = renderToStaticMarkup(createElement(LeagueWorkspace, league));
    for (const text of ['Full subcontractor trading name without truncation', '8 / 10 completed tasks on time', 'Lagos project · Abuja project', constructionNaira(25), constructionNaira(100001), '0 recorded incident(s)', 'delivery 45% + quality 30% + safety 25%']) expect(html).toContain(text);
    expect(html).not.toContain('clean record');
    expect(html).toContain('not proof of verified competency');
  });

  it('leaves the exact recovery and simulation engines intact, including cheap-first and zero-float constraints', () => {
    const critical = new Set(simulator.criticalIds);
    const recovery = recoveryPlan(tasks, critical, 4);
    expect(recovery.crashes.map((crash) => crash.taskId)).toEqual(['cheap', 'expensive']);
    expect(recovery.daysRecovered).toBe(4);
    expect(recovery.extraCostMinor).toBe(250100);
    const baselinePlan = recoveryPlan(tasks, critical, 0);
    const calculated = simulate(project, evm, baselinePlan, { productivityPct: 100, dieselShockPct: 0, extraRainDays: 0, crashDays: 0 }, simulator.dieselExposureMinor);
    expect(calculated.eac).toBe(evm.eac);
    expect(calculated.finishISO).toBe(baseline.iso);
    const html = renderToStaticMarkup(createElement(SimulatorWorkspace, simulator));
    expect(html).toContain(constructionNaira(calculated.eac));
    expect(html).toContain(constructionNaira(12345));
    expect(html).toContain('Nothing is saved.');
    expect(component('simulator-workspace')).toContain('recoveryPlan(tasks, critical, a.crashDays)');
  });

  it('associates all four scenario sliders with hints and never offers fake task recovery from an empty network', () => {
    const html = renderToStaticMarkup(createElement(SimulatorWorkspace, { ...simulator, tasks: [], criticalIds: [] }));
    expect(html.match(/type="range"/g)).toHaveLength(4);
    expect(html.match(/aria-describedby="[^"]+-hint"/g)).toHaveLength(4);
    expect(html).toContain('No task network was supplied.');
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-label="Days to claw back"/);
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('keeps complete digest narratives and sources, qualifies missing links and does not publish for viewers', () => {
    const html = renderToStaticMarkup(createElement(DigestWorkspace, digest));
    for (const text of ['Complete source-linked narrative that is readable at the standard body size.', 'Open the complete approved report record', '21 Oct 2026', 'No source link was supplied', 'not calibrated certainty', 'No digest has been approved']) expect(html).toContain(text);
    expect(html).not.toContain('Review and publish digest</button>');
    const editable = renderToStaticMarkup(createElement(DigestWorkspace, { ...digest, canMutate: true }));
    expect(editable).toMatch(/<button[^>]*disabled=""[^>]*>Review and publish digest<\/button>/);
    expect(component('digest-workspace')).toContain('JSON.stringify([view.projectId, view.weekOfISO, view.coverageGaps])');
    expect(component('digest-workspace')).toContain('publishDigest({ projectId: view.projectId');
  });

  it('exposes complete controlled revision and transmittal records behind a labelled disclosure', () => {
    const html = renderToStaticMarkup(createElement(DocumentsWorkspace, documents));
    for (const text of ['Complete controlled drawing title', 'The complete change note remains readable.', 'Recorded uploader', 'Responsible approver', 'Recipient with a complete organisation name', 'for construction', 'Acknowledged', '24 Oct 2026', '11:05', 'Build to rev B', '2d overdue', 'Confirm the complete technical reinforcement and isolation detail before proceeding.']) expect(html).toContain(text);
    expect(html).toContain('aria-label="LAG/A revision B transmittals"');
    const controls = [...html.matchAll(/aria-expanded="false" aria-controls="([^"]+)"/g)].map((match) => match[1]);
    expect(controls).toHaveLength(2);
    expect(new Set(controls).size).toBe(2);
    expect(html).not.toContain('>Approve</button>');
    expect(html).not.toContain('>New revision</button>');
    expect(html).not.toContain('>Answer</button>');
  });

  it('keeps document creation and updating as separate grants and preserves required change notes/local errors', () => {
    const createOnly = renderToStaticMarkup(createElement(DocumentsWorkspace, { ...documents, canCreate: true }));
    expect(createOnly).not.toContain('>New revision</button>');
    const editor = renderToStaticMarkup(createElement(DocumentsWorkspace, { ...documents, canCreate: true, canMutate: true }));
    expect(editor).toContain('>New revision</button>');
    const text = component('documents-workspace');
    for (const value of ['canCreate && canMutate', 'required={overApproved}', 'useConstructionSave(setError)', 'role="alert"', 'disabled={pending}', "fetch('/api/construction/transmittals'", 'issueRevision(head.id, note)', 'The exact PDF revision will be attached to the email']) expect(text).toContain(value);
    const rfiText = component('rfi-workspace');
    for (const value of ['createRfi(input', 'answerRfi(row.id, answer', 'reviewRfiAnswer(row.id', 'distributeRfi(row.id', 'closeRfi(rfi.id)']) expect(rfiText).toContain(value);
    expect(text.match(/<ConstructionDialog /g)).toHaveLength(2);
    expect(text.match(/<form /g)).toHaveLength(2);
  });

  it('shows audit zero amounts, complete before/after/reasons and full-year WAT without claiming immutable storage', () => {
    const html = renderToStaticMarkup(createElement(AuditWorkspace, audit));
    for (const text of ['Recorded decision maker', '24 Oct 2026', '11:00', 'WAT', constructionNaira(0), constructionNaira(25), 'The full previous scope and assumptions.', '(empty value)', 'A full coded reason that must stay visible', 'Complete contextual note explaining the decision.', 'A complete delay reason label that must not be clipped', '75% / 75%', '4 days', 'not a certified immutable']) expect(html).toContain(text);
    expect(html).toContain('aria-label="Construction audit records"');
    expect(html).toContain('aria-label="Filter by audit action"');
    expect(html).toContain('aria-label="Reason analysis domain"');
  });

  it('preserves truthful sparse states without invalid values or invented evidence', () => {
    expect(renderToStaticMarkup(createElement(RiskRadar, { signals: [], canMutate: false }))).toContain('No active risk signals in this snapshot');
    expect(renderToStaticMarkup(createElement(BuildWatch, { projects: [], showCommercials: false }))).toContain('No project progress records');
    expect(renderToStaticMarkup(createElement(LeagueWorkspace, { rows: [], kpis: { subs: 0, avgScore: 0, totalValueMinor: 0, reworkMinor: 0 } }))).toContain('No subcontractor scorecards');
    expect(renderToStaticMarkup(createElement(DigestWorkspace, { views: [], canMutate: false }))).toContain('No projects to report on.');
    expect(renderToStaticMarkup(createElement(DocumentsWorkspace, { register: [], rfis: [], kpis: { documents: 0, approved: 0, inReview: 0, openRfis: 0, overdueRfis: 0 }, canMutate: false }))).toContain('No controlled document records');
    const html = renderToStaticMarkup(createElement(AuditWorkspace, { entries: [], pareto: {}, domains: [], summary: { total: 0, sensitive: 0, overrides: 0, valueMovedMinor: 0, actors: 0 } }));
    expect(html).toContain('No reason domains supplied');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('does not execute records, approvals, sends or provider operations by rendering any workspace', () => {
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });
});
