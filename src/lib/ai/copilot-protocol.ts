/** Public transport contains application activity and answer text, never private model reasoning. */
export type CopilotModule = 'estate' | 'facility' | 'shortlet' | 'construction';
export type CopilotTurn = { role: 'user' | 'assistant'; content: string };
export type CopilotRequest = { question: string; turns?: CopilotTurn[] };
export type CopilotSource = { id: string; label: string; href: string };
export type CopilotCoverage = { collection: string; loaded: number; total: number | null; complete: boolean };
export type CopilotContext = {
  module: CopilotModule;
  scopeLabel: string;
  snapshotISO: string;
  coverage: CopilotCoverage[];
  facts: Record<string, unknown>;
  sources: CopilotSource[];
  notices: string[];
};
export type CopilotActivity = { id: string; label: string; status: 'active' | 'complete' | 'error' };
export type CopilotUsage = { inputTokens: number; outputTokens: number; estimatedCostMinorNgn: number; recorded: boolean };
export type CopilotEvent =
  | { v: 1; type: 'start'; requestId: string }
  | { v: 1; type: 'activity'; activity: CopilotActivity }
  | { v: 1; type: 'meta'; source: 'llm'; model: string; scopeLabel: string; snapshotISO: string; coverage: CopilotCoverage[]; sources: CopilotSource[]; notices: string[] }
  | { v: 1; type: 'delta'; text: string }
  | { v: 1; type: 'grounding'; status: 'supported' | 'needs_review' | 'unavailable'; supported: number; checked: number; message: string }
  | { v: 1; type: 'complete'; interactionId: string; usage: CopilotUsage }
  | { v: 1; type: 'error'; code: string; message: string; retryable: boolean; retryAfterS?: number };

export const COPILOT_STREAM_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';
export const COPILOT_MAX_QUESTION = 2000;
export const COPILOT_MAX_HISTORY = 12;
export const COPILOT_MAX_HISTORY_CHARS = 16000;

const MODULE_PATHS: Record<CopilotModule, readonly string[]> = {
  estate: ['/estate', '/people', '/properties', '/collections', '/billing', '/finance', '/tenancy', '/security', '/announcements', '/documents', '/bookings', '/events', '/reports'],
  facility: ['/facility', '/control-center', '/assets', '/work-orders', '/ppm', '/energy', '/inventory', '/contracts', '/safety', '/sustainability', '/inspections'],
  shortlet: ['/shortlet'], construction: ['/construction'],
};
export function validCopilotSource(module: CopilotModule, source: unknown): source is CopilotSource {
  if (!source || typeof source !== 'object') return false;
  const value = source as Partial<CopilotSource>;
  if (typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' || !value.label.trim() || typeof value.href !== 'string' || /[\\\s%]/.test(value.href) || !value.href.startsWith('/') || value.href.startsWith('//')) return false;
  const url = new URL(value.href, 'https://propbrew.invalid');
  const path = url.pathname;
  if (module === 'construction' && /^\/api\/construction\/drawings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)) {
    return url.search === '?view=1' && /^#page=[1-9][0-9]{0,2}$/.test(url.hash);
  }
  return MODULE_PATHS[module].some((base) => path === base || path.startsWith(base + '/'));
}
