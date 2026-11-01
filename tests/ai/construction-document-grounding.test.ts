import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopilotContext } from '@/lib/ai/copilot-protocol';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), reserve: vi.fn(), finish: vi.fn(), record: vi.fn() }));
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateText: mocks.generate }));
vi.mock('@/server/ai/durable', () => ({ featureControl: async () => ({ enabled: true, dailyCapMinorNgn: 50000 }) }));
vi.mock('@/server/ai/copilot-ledger', () => ({ reserveCopilotBudget: mocks.reserve, finishCopilotBudget: mocks.finish }));
vi.mock('@/server/ai/copilot-provider', () => ({ resolveCopilotProvider: () => ({ model: {}, modelName: 'test-vision', provider: 'openai' }) }));
vi.mock('@/server/ai/operations', () => ({ recordEvaluation: mocks.record }));

import { evaluateConstructionDocumentAnswer } from '@/server/construction/document-answer-evaluation';
import { constructionOcr } from '@/server/construction/document-ocr';

const label = 'LAG-SPEC-104 · Waterproofing rev B · PDF page 3';
const context: CopilotContext = { module: 'construction', scopeLabel: 'Project Cedar', snapshotISO: '2026-11-01T10:00:00Z', coverage: [], notices: [],
  sources: [{ id: 'construction-document-11111111-1111-4111-8111-111111111111-3', label,
    href: '/api/construction/drawings/11111111-1111-4111-8111-111111111111?view=1#page=3' }],
  facts: { documentExcerpts: [{ fileId: '11111111-1111-4111-8111-111111111111', number: 'LAG-SPEC-104', revision: 'B', page: 3,
    text: 'Clause 7.12: use a 2 mm waterproofing membrane.' }] } };

describe('Construction PDF answer grounding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserve.mockResolvedValue({ allowed: true }); mocks.finish.mockResolvedValue({ recorded: true }); mocks.record.mockResolvedValue('evaluation-id');
    mocks.generate.mockResolvedValue({ output: { findings: [{ claim: 'The membrane is 2 mm', sourceId: context.sources[0].id, verdict: 'supported' }] },
      totalUsage: { inputTokens: 120, outputTokens: 60 } });
  });

  it('records a supported verdict linked to the copilot interaction and authorised page', async () => {
    const answer = `The membrane is 2 mm (${label}).`;
    const result = await evaluateConstructionDocumentAnswer('46a4660b-90d2-478b-89b3-d516779bded2', 'u1', 'interaction-1', context, answer);
    expect(result).toMatchObject({ status: 'supported', supported: 1, checked: 1 });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ score: 1, results: expect.objectContaining({ interactionId: 'interaction-1' }) }));
    expect(mocks.generate.mock.calls[0][0].prompt).toContain('Clause 7.12');
    expect(mocks.finish).toHaveBeenCalledOnce();
  });

  it('rejects a model-supported claim without the exact page citation', async () => {
    const result = await evaluateConstructionDocumentAnswer('46a4660b-90d2-478b-89b3-d516779bded2', 'u1', 'interaction-2', context, 'The membrane is 2 mm.');
    expect(result).toMatchObject({ status: 'needs_review', supported: 0, checked: 1 });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ score: 0, results: expect.objectContaining({ findings: [{ sourceId: context.sources[0].id, verdict: 'uncited' }] }) }));
  });

  it('sends one scanned page as an image file under the document AI budget', async () => {
    mocks.generate.mockResolvedValueOnce({ text: 'SPEC 07-12 WATERPROOFING', totalUsage: { inputTokens: 400, outputTokens: 50 } });
    const ocr = await constructionOcr('46a4660b-90d2-478b-89b3-d516779bded2', 'u1');
    expect(ocr).toBeDefined();
    expect(await ocr!(new Uint8Array([137, 80, 78, 71]), 3)).toBe('SPEC 07-12 WATERPROOFING');
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ feature: 'document_extraction' }));
    expect(mocks.generate.mock.calls[0][0].messages[0].content[1]).toMatchObject({ type: 'file', mediaType: 'image/png' });
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete', outputRedacted: '[page text withheld]' }));
  });
});
