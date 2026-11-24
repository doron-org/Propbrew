import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/lib/authz';
import type { CopilotContext, CopilotEvent, CopilotModule } from '@/lib/ai/copilot-protocol';
import { identityByKey } from '@/server/identities';

const boundary = vi.hoisted(() => ({
  session: vi.fn(), reviewMode: vi.fn(), reviewOrigin: vi.fn(), reviewActor: vi.fn(), ledgerTenant: vi.fn(),
  rate: vi.fn(), model: vi.fn(), record: vi.fn(), control: vi.fn(), reserve: vi.fn(), finish: vi.fn(),
  resolve: vi.fn(), stream: vi.fn(), guard: vi.fn(), list: vi.fn(), usage: vi.fn(), workspace: vi.fn<(props: unknown) => null>(() => null),
}));
vi.mock('@/server/session', () => ({ getSession: boundary.session }));
vi.mock('@/server/review-auth', () => ({
  ReviewConfigurationError: class ReviewConfigurationError extends Error {},
  reviewModeEnabled: boundary.reviewMode, reviewOriginAllowed: boundary.reviewOrigin, isReviewActor: boundary.reviewActor, reviewLedgerTenantId: boundary.ledgerTenant,
}));
vi.mock('@/server/copilot/metering', () => ({ checkRate: boundary.rate, getTenantModel: boundary.model, dailyCapMinorNgn: () => 500000, recordUsage: boundary.record }));
vi.mock('@/server/ai/durable', () => ({ featureControl: boundary.control }));
vi.mock('@/server/ai/copilot-ledger', () => ({ reserveCopilotBudget: boundary.reserve, finishCopilotBudget: boundary.finish, readCopilotLedgerUsage: boundary.usage }));
vi.mock('@/server/ai/copilot-provider', async (original) => ({ ...await original<typeof import('@/server/ai/copilot-provider')>(), resolveCopilotProvider: boundary.resolve, streamCopilotAnswer: boundary.stream }));
vi.mock('@/server/guard', () => ({ requireCapability: boundary.guard }));
vi.mock('@/server/data', () => ({ seed: { users: [] }, repos: {
  buildingSystems: { list: boundary.list }, facilityAlarms: { list: boundary.list }, facilityGenerators: { list: boundary.list }, facilityParts: { list: boundary.list },
  facilityContracts: { list: boundary.list }, facilityPermits: { list: boundary.list }, facilityIncidents: { list: boundary.list }, facilitySensors: { list: boundary.list },
} }));
vi.mock('@/components/facility/copilot-workspace', () => ({ CopilotWorkspace: boundary.workspace }));

import { ReviewConfigurationError } from '@/server/review-auth';
import { handleCopilot } from '@/server/ai/copilot';
import CopilotPage from '@/app/(ops)/(facility)/copilot/page';

const ledgerTenantId = '37b176f9-f106-49e4-904d-0821c8fa744e';
const customerTenantId = 'f5bcebbd-449c-4ad4-932e-d212b60fb7b0';
const reviewActor = (): Actor => ({ ...structuredClone(identityByKey('estate_manager').actor), userId: 'propbrew-private-review-estate-manager' });
const context = (module: CopilotModule): CopilotContext => ({ module, scopeLabel: 'Assigned review records', snapshotISO: '2026-07-26T12:00:00.000Z', facts: { tenantId: 't-lekki' }, sources: [], notices: ['Demonstration data'], coverage: [] });
const request = (body: unknown = { question: 'What needs attention?' }) => new Request('https://review.propbrew.example/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const streamed = async (response: Response): Promise<CopilotEvent[]> => (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'unit-test-review-database');
  const actor = reviewActor();
  boundary.session.mockResolvedValue({ key: 'private-review', actor });
  boundary.guard.mockResolvedValue({ actor });
  boundary.reviewMode.mockReturnValue(true);
  boundary.reviewOrigin.mockReturnValue(true);
  boundary.reviewActor.mockImplementation((current: Actor) => current.userId === 'propbrew-private-review-estate-manager' && current.tenantId === 't-lekki');
  boundary.ledgerTenant.mockReturnValue(ledgerTenantId);
  boundary.rate.mockReturnValue({ allowed: true, retryAfterS: 0 });
  boundary.model.mockReturnValue('gpt-6.1-sol');
  boundary.control.mockResolvedValue({ enabled: true, dailyCapMinorNgn: 100000 });
  boundary.reserve.mockResolvedValue({ allowed: true });
  boundary.finish.mockResolvedValue({ recorded: true });
  boundary.resolve.mockReturnValue({ model: { id: 'unit-test-model' }, modelName: 'gpt-6.1-sol', provider: 'openai' });
  boundary.stream.mockImplementation(() => ({ fullStream: (async function* () {
    yield { type: 'text-delta', text: 'Review the assigned records.' };
    yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 100, outputTokens: 20 } };
  })() }));
  boundary.list.mockReturnValue({ items: [] });
  boundary.usage.mockResolvedValue({ requests: 4, inputTokens: 400, outputTokens: 80, costMinorNgn: 120 });
});
afterEach(() => vi.unstubAllEnvs());

describe('private review Copilot ledger scope', () => {
  it.each<CopilotModule>(['estate', 'facility', 'shortlet', 'construction'])('bills %s to the review ledger while keeping the context actor unchanged', async (module) => {
    const actor = reviewActor();
    boundary.session.mockResolvedValue({ key: 'private-review', actor });
    const builder = vi.fn<(actor: Actor) => Promise<CopilotContext>>(async () => context(module));
    const response = await handleCopilot(request(), module, builder);
    expect((await streamed(response)).at(-1)).toMatchObject({ type: 'complete', usage: { recorded: true } });
    expect(builder.mock.calls[0][0]).toBe(actor);
    expect(actor).toEqual(reviewActor());
    expect(boundary.control).toHaveBeenCalledWith(ledgerTenantId, `${module}_copilot`);
    expect(boundary.reserve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ledgerTenantId, actorId: actor.userId, feature: `${module}_copilot` }));
    expect(boundary.finish).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ledgerTenantId, status: 'complete' }));
    expect(boundary.rate).toHaveBeenCalledWith(ledgerTenantId, expect.any(Number));
    expect(boundary.model).toHaveBeenCalledWith('t-lekki');
    expect(boundary.record).toHaveBeenCalledWith('t-lekki', 100, 20, 'gpt-6.1-sol');
    expect(boundary.stream.mock.calls[0][0].instructions).toContain('"tenantId":"t-lekki"');
  });

  it('does not map an ordinary Clerk customer actor even when review mode is enabled', async () => {
    const actor = { ...reviewActor(), tenantId: customerTenantId, userId: 'user_customer' };
    boundary.session.mockResolvedValue({ key: 'clerk', actor });
    const builder = vi.fn<(actor: Actor) => Promise<CopilotContext>>(async () => context('facility'));
    await streamed(await handleCopilot(request(), 'facility', builder));
    expect(boundary.ledgerTenant).not.toHaveBeenCalled();
    expect(boundary.reserve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: customerTenantId }));
    expect(boundary.finish).toHaveBeenCalledWith(expect.objectContaining({ tenantId: customerTenantId }));
    expect(boundary.control).toHaveBeenCalledWith(customerTenantId, 'facility_copilot');
    expect(boundary.rate).toHaveBeenCalledWith(customerTenantId, expect.any(Number));
    expect(builder.mock.calls[0][0]).toBe(actor);
  });

  it('requires explicit review mode before using the review ledger mapping', async () => {
    boundary.reviewMode.mockReturnValue(false);
    await streamed(await handleCopilot(request(), 'estate', async () => context('estate')));
    expect(boundary.reviewActor).not.toHaveBeenCalled();
    expect(boundary.ledgerTenant).not.toHaveBeenCalled();
    expect(boundary.reserve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-lekki' }));
    expect(boundary.rate).toHaveBeenCalledWith('t-lekki', expect.any(Number));
  });

  it('rejects body-controlled tenant IDs before ledger access or provider execution', async () => {
    const builder = vi.fn();
    expect((await handleCopilot(request({ question: 'What needs attention?', tenantId: customerTenantId }), 'estate', builder)).status).toBe(400);
    expect(builder).not.toHaveBeenCalled();
    expect(boundary.ledgerTenant).not.toHaveBeenCalled();
    expect(boundary.reserve).not.toHaveBeenCalled();
    expect(boundary.resolve).not.toHaveBeenCalled();
    expect(boundary.stream).not.toHaveBeenCalled();
  });

  it.each(['session', 'ledger'] as const)('returns 503 for invalid review configuration at the %s boundary before contacting AI', async (where) => {
    if (where === 'session') boundary.session.mockRejectedValueOnce(new ReviewConfigurationError('unit-test-config'));
    else boundary.ledgerTenant.mockImplementationOnce(() => { throw new ReviewConfigurationError('unit-test-config'); });
    const builder = vi.fn();
    const response = await handleCopilot(request(), 'estate', builder);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'ai_review_unavailable' });
    expect(builder).not.toHaveBeenCalled();
    expect(boundary.control).not.toHaveBeenCalled();
    expect(boundary.reserve).not.toHaveBeenCalled();
    expect(boundary.resolve).not.toHaveBeenCalled();
    expect(boundary.stream).not.toHaveBeenCalled();
  });

  it('requires an authorised session before checking the review ledger configuration', async () => {
    boundary.session.mockResolvedValueOnce(null);
    expect((await handleCopilot(request(), 'estate', vi.fn())).status).toBe(401);
    boundary.session.mockResolvedValueOnce({ key: 'clerk', actor: identityByKey('resident').actor });
    expect((await handleCopilot(request(), 'estate', vi.fn())).status).toBe(403);
    expect(boundary.reviewActor).not.toHaveBeenCalled();
    expect(boundary.ledgerTenant).not.toHaveBeenCalled();
    expect(boundary.stream).not.toHaveBeenCalled();
  });

  it('reconciles interrupted provider attempts against the same canonical ledger tenant', async () => {
    boundary.stream.mockImplementationOnce(() => ({ fullStream: (async function* () { throw new Error('Provider failed'); })() }));
    const delivered = await streamed(await handleCopilot(request(), 'construction', async () => context('construction')));
    expect(delivered.at(-1)).toMatchObject({ type: 'error' });
    expect(boundary.finish).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ledgerTenantId, status: 'stopped' }));
    expect(boundary.record).not.toHaveBeenCalled();
  });
});

describe('Facility cross-module review usage', () => {
  it('reads canonical review totals without changing fixture records or model selection', async () => {
    const actor = reviewActor();
    boundary.guard.mockResolvedValue({ actor });
    renderToStaticMarkup(await CopilotPage({ searchParams: Promise.resolve({}) }));
    expect(boundary.usage).toHaveBeenCalledWith(ledgerTenantId);
    expect(boundary.list).toHaveBeenCalledTimes(8);
    for (const call of boundary.list.mock.calls) expect(call[0]).toBe(actor);
    expect(boundary.model).toHaveBeenCalledWith('t-lekki');
    expect(boundary.workspace.mock.calls[0][0]).toMatchObject({ usage: { requests: 4, inputTokens: 400, outputTokens: 80, costMinorNgn: 120 } });
  });

  it('keeps customer usage in its original tenant even if review mode is enabled', async () => {
    boundary.guard.mockResolvedValue({ actor: { ...reviewActor(), userId: 'user_customer', tenantId: customerTenantId } });
    renderToStaticMarkup(await CopilotPage({ searchParams: Promise.resolve({}) }));
    expect(boundary.usage).toHaveBeenCalledWith(customerTenantId);
    expect(boundary.ledgerTenant).not.toHaveBeenCalled();
  });

  it('shows unavailable usage if strict review configuration fails rather than reading seed or zero totals', async () => {
    boundary.ledgerTenant.mockImplementationOnce(() => { throw new ReviewConfigurationError('unit-test-config'); });
    renderToStaticMarkup(await CopilotPage({ searchParams: Promise.resolve({}) }));
    expect(boundary.usage).not.toHaveBeenCalled();
    expect(boundary.workspace.mock.calls[0][0]).toMatchObject({ usage: null });
  });
});
