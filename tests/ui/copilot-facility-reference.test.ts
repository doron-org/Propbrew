import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotWorkspace } from '@/components/facility/copilot-workspace';
import { asId, type TenantId } from '@/domain/ids';
import type { CopilotWorld } from '@/domain/facility';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ dispatchWoFromAlarm: vi.fn(), acknowledgeAlarm: vi.fn(), receiveStock: vi.fn(), logRefuel: vi.fn(), setCopilotModel: vi.fn(), recordCopilotUsage: vi.fn() }));
vi.mock('@/server/actions/facility', () => actions);

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = () => read('src/components/facility/copilot-workspace.tsx');
const tenantId = asId<TenantId>('facility-reference-tenant');
const world: CopilotWorld = {
  systems: [],
  alarms: [{ tenantId, id: 'alarm-1', siteId: 'lagos', system: 'East generator', message: 'Recorded high temperature', severity: 'critical', atISO: '2026-10-24T09:00:00Z', acknowledged: false }],
  generators: [{ tenantId, id: 'generator-1', siteId: 'lagos', name: 'East generator', capacityKva: 200, status: 'running', fuelPct: 5, tankLitres: 1000, litresPerHour: 30, baselineLph: 30, runtimeHoursToday: 1, runtimeHoursMonth: 10, lastRefuelISO: '2026-10-20T09:00:00Z' }],
  parts: [{ tenantId, id: 'part-1', name: 'Generator filter with the complete recorded specification', category: 'Consumables', sku: 'FILTER-01', location: 'Store A', stock: 1, reorderPoint: 5, usedPerMonth: 8, unitCost: { minor: 12345, currency: 'NGN' } }],
  contracts: [], permits: [], incidents: [], sensors: [], nowMs: Date.parse('2026-10-24T09:00:00Z'),
};
const render = (overrides: Partial<Parameters<typeof CopilotWorkspace>[0]> = {}) => renderToStaticMarkup(createElement(CopilotWorkspace, { world, userName: 'Bola Adeyemi', model: 'claude-sonnet-5', usage: { requests: 2, inputTokens: 1234, outputTokens: 5678, costMinorNgn: 12345 }, canConfigure: false, ...overrides }));

describe('Facility uses the Construction Ask Copilot reference', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the shared conversation presentation while keeping priority and usage panels mounted', () => {
    const html = render();
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Ask Copilot/);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(4);
    expect(html.match(/hidden=""/g)).toHaveLength(3);
    expect(html.indexOf('Ask about your facility')).toBeLessThan(html.indexOf('role="tablist"'));
    const navigation = source().slice(source().indexOf('<PageTabs '));
    expect([...navigation.matchAll(/id: '([^']+)'/g)].map((match) => match[1])).toEqual(['conversation', 'priorities', 'usage', 'safeguards']);
  });

  it('places the named, keyboard reachable conversation above its associated composer', () => {
    const html = render();
    expect(html).toMatch(/role="log"[^>]*tabindex="0"[^>]*aria-label="Facility copilot conversation"[^>]*aria-live="polite"[^>]*aria-busy="false"/);
    expect(html.indexOf('role="log"')).toBeLessThan(html.indexOf('<textarea'));
    const inputId = html.match(/<textarea[^>]*id="([^"]+)"/)?.[1];
    expect(inputId).toBeTruthy();
    expect(html).toContain('for="' + inputId + '">Ask the facility copilot</label>');
    expect(html).toContain('maxLength="2000"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain('Start with a question');
  });

  it('uses the same shared layout and drafts-only suggestions as Construction', () => {
    const text = source();
    for (const component of ['CopilotFrame', 'CopilotSummary', 'CopilotLayout', 'CopilotPanel', 'CopilotConversation', 'CopilotMessage', 'CopilotComposer', 'CopilotSuggestions', 'CopilotSafeguards']) expect(text).toContain('<' + component);
    expect(text).toContain("from '@/components/ai/copilot-reference'");
    expect(text).toContain('onSelect={(suggestion) => { setQ(suggestion); composer.current?.focus(); }}');
    expect(text).not.toContain('onSelect={ask}');
    expect(render()).toContain('Selecting a suggestion prepares a question—it does not send it.');
    expect(render()).toContain('Copilot suggestions and context');
  });

  it('retains all eight scoped context counts and a dated WAT snapshot without live sensor claims', () => {
    const html = render();
    for (const label of ['Building systems', 'Alarms', 'Generators', 'Parts', 'Contracts', 'Permits', 'Incidents', 'Sensors']) expect(html).toContain('<dt>' + label + '</dt>');
    expect(html).toContain('24 Oct 2026');
    expect(html).toContain('WAT. Not a connected live sensor feed.');
    expect(html).toContain('Good day, Bola.');
    expect(html).toContain('Context &amp; controls');
  });

  it('preserves the full priority register, named filters and exact native NGN usage estimates', () => {
    const html = render();
    for (const text of ['East generator: Recorded high temperature', 'Generator filter with the complete recorded specification', 'Search copilot priorities', 'Priority severity', 'Facility copilot priority register', '₦123.45', '1,234', '5,678', 'Tenant-level application meter, not a provider invoice']) expect(html).toContain(text);
    expect(html.match(/<th scope="col">/g)).toHaveLength(4);
    expect(html.match(/class="[^"]*kpiValue_[^"]*"/g)).toHaveLength(8);
    expect(read('src/components/facility/copilot-workspace.module.css')).toContain('min-width: 820px');
  });

  it('keeps create and update action permissions separate', () => {
    expect(render()).not.toContain('Review action for');
    const createOnly = render({ canCreate: true });
    expect(createOnly).toContain('Review action for East generator: Recorded high temperature');
    expect(createOnly).not.toContain('Review action for Generator filter with the complete recorded specification');
    const updateOnly = render({ canUpdate: true });
    expect(updateOnly).not.toContain('Review action for East generator: Recorded high temperature');
    expect(updateOnly).toContain('Review action for Generator filter with the complete recorded specification');
  });

  it('keeps model selection view-only unless the existing configuration permission is granted', () => {
    const viewer = render();
    expect(viewer).toContain('View only');
    expect(viewer).not.toContain('aria-label="Copilot model"');
    expect(viewer).not.toContain('Review model change</button>');
    const manager = render({ canConfigure: true });
    expect(manager).toContain('aria-label="Copilot model"');
    expect(manager).toContain('Review model change</button>');
    expect(manager).toContain('not proof of the provider used for an answer');
  });

  it('uses shared verified streaming, duplicate protection and server-owned usage recording', () => {
    const text = source();
    for (const value of ["endpoint = '/api/copilot', module = 'facility'", 'useCopilotStream', 'if (!query || asking || pending) return', 'if (exchange.usage?.recorded) router.refresh()', 'thread.map((message)', 'onStop={stop}', '<CopilotStreamReply']) expect(text).toContain(value);
    expect(text).not.toContain('recordCopilotUsage(');
    expect(text).not.toContain('askCopilot(');
    const client = read('src/lib/ai/copilot-client.ts');
    expect(client).toContain('decoder.decode(value, { stream: true })');
    expect(read('src/components/ai/use-copilot-stream.ts')).toContain('question.length > COPILOT_MAX_QUESTION || active.current');
    expect(read('src/components/ai/copilot-stream-reply.tsx')).toContain('usage record was not confirmed');
  });

  it('keeps AI source metadata separate from priority rule context and never fabricates citations', () => {
    const text = source();
    expect(text).toContain('CopilotStreamReply');
    const reply = read('src/components/ai/copilot-stream-reply.tsx');
    expect(reply).toContain("exchange.status === 'complete' ? 'AI answer'");
    expect(reply).toContain('Source records · verify before acting');
    expect(read('src/lib/ai/copilot-client.ts')).toContain('validCopilotSource(module, source)');
    expect(text).not.toContain('X-Copilot-Grounded');
    expect(text).not.toContain('dangerouslySetInnerHTML');
    expect(text).not.toContain('Built-in rules');
    expect(render()).toContain('Rule context labels are not independent citations.');
  });

  it('keeps operational and model changes behind existing native reviews and pending guards', () => {
    const text = source();
    for (const value of ['Review copilot recommendation', 'Review tenant model selection', 'if (pending || actionRef.current || !canReview(insight)) return', 'if (!canConfigure || inFlight.current) return', 'Confirm recorded action', 'it does not place a supplier order', 'No field-team notification or attendance is confirmed.', 'dispatchWoFromAlarm(refId)', 'acknowledgeAlarm(refId)', 'receiveStock(refId, Math.max(part.reorderPoint * 2 - part.stock, part.usedPerMonth))', 'logRefuel(refId, Math.round(generator.tankLitres * (100 - generator.fuelPct) / 100))']) expect(text).toContain(value);
    expect(text).not.toContain("insight.action.kind === 'advance_permit'");
    expect(render()).toContain('Questions and suggested drafts do not execute actions.');
  });

  it('adopts shared responsive conversation styling while keeping Facility context and table locally contained', () => {
    const css = read('src/components/facility/copilot-workspace.module.css');
    for (const value of ['padding: 24px', 'padding: 16px', 'min-width: 0', '@media (max-width: 1100px)', '@media (max-width: 640px)', 'overflow-wrap: anywhere']) expect(css).toContain(value);
    expect(css).not.toContain('.question {');
    expect(css).not.toContain('.answer {');
    expect(render()).toContain('aria-label="Facility copilot priority register"');
  });

  it('does not call providers, mutate operational records or meter usage while rendering', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      render({ canCreate: true, canUpdate: true, canConfigure: true });
      expect(fetch).not.toHaveBeenCalled();
      for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
