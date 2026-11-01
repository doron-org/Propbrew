import { COPILOT_MAX_HISTORY, COPILOT_MAX_HISTORY_CHARS, validCopilotSource, type CopilotActivity, type CopilotEvent, type CopilotModule, type CopilotTurn } from './copilot-protocol';

export type CopilotExchangeStatus = 'submitted' | 'streaming' | 'complete' | 'stopped' | 'error';
export type CopilotMeta = Extract<CopilotEvent, { type: 'meta' }>;
export type CopilotFailure = { code: string; message: string; retryable: boolean; retryAfterS?: number };
export type CopilotExchange = {
  id: string; question: string; text: string; status: CopilotExchangeStatus;
  activities: CopilotActivity[]; startedAt: number; completedAt?: number;
  requestId?: string; meta?: CopilotMeta; interactionId?: string;
  usage?: Extract<CopilotEvent, { type: 'complete' }>['usage']; error?: CopilotFailure; retryOf?: string;
  grounding?: Extract<CopilotEvent, { type: 'grounding' }>;
};

export class CopilotClientError extends Error {
  constructor(public readonly failure: CopilotFailure) { super(failure.message); this.name = 'CopilotClientError'; }
}
const invalid = () => new CopilotClientError({ code: 'invalid_stream', message: 'The answer stream could not be verified. Any partial answer is incomplete; please retry.', retryable: true });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 16000): value is string => typeof value === 'string' && value.length <= max;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Validate and project public fields only. No provider reasoning or arbitrary HTML becomes a UI part. */
export function parseCopilotEvent(value: unknown, module: CopilotModule): CopilotEvent {
  if (!object(value) || value.v !== 1 || !text(value.type, 40)) throw invalid();
  if (value.type === 'start' && text(value.requestId, 200) && value.requestId) return { v: 1, type: 'start', requestId: value.requestId };
  if (value.type === 'activity' && object(value.activity)) {
    const activity = value.activity;
    if (text(activity.id, 200) && activity.id && text(activity.label, 1000) && activity.label.trim() && ['active', 'complete', 'error'].includes(String(activity.status))) return { v: 1, type: 'activity', activity: { id: activity.id, label: activity.label, status: activity.status as CopilotActivity['status'] } };
  }
  if (value.type === 'meta' && value.source === 'llm' && text(value.model, 200) && value.model && text(value.scopeLabel, 2000) && text(value.snapshotISO, 100) && Number.isFinite(Date.parse(value.snapshotISO)) && Array.isArray(value.coverage) && value.coverage.length <= 1000 && Array.isArray(value.sources) && value.sources.length <= 1000 && Array.isArray(value.notices) && value.notices.length <= 100 && value.notices.every((notice) => text(notice, 16000))) {
    const coverage = value.coverage.map((entry) => {
      if (!object(entry) || !text(entry.collection, 1000) || !number(entry.loaded) || !(entry.total === null || number(entry.total)) || typeof entry.complete !== 'boolean') throw invalid();
      return { collection: entry.collection, loaded: entry.loaded, total: entry.total, complete: entry.complete };
    });
    const sources = value.sources.map((source) => {
      if (!validCopilotSource(module, source)) throw invalid();
      return { id: source.id, label: source.label, href: source.href };
    });
    return { v: 1, type: 'meta', source: 'llm', model: value.model, scopeLabel: value.scopeLabel, snapshotISO: value.snapshotISO, coverage, sources, notices: value.notices as string[] };
  }
  if (value.type === 'delta' && text(value.text, 1000000)) return { v: 1, type: 'delta', text: value.text };
  if (value.type === 'grounding' && ['supported', 'needs_review', 'unavailable'].includes(String(value.status)) && number(value.supported) && number(value.checked) && value.supported <= value.checked && text(value.message, 1000)) return { v: 1, type: 'grounding', status: value.status as 'supported' | 'needs_review' | 'unavailable', supported: value.supported, checked: value.checked, message: value.message };
  if (value.type === 'complete' && text(value.interactionId, 200) && value.interactionId && object(value.usage) && number(value.usage.inputTokens) && number(value.usage.outputTokens) && number(value.usage.estimatedCostMinorNgn) && typeof value.usage.recorded === 'boolean') return { v: 1, type: 'complete', interactionId: value.interactionId, usage: { inputTokens: value.usage.inputTokens, outputTokens: value.usage.outputTokens, estimatedCostMinorNgn: value.usage.estimatedCostMinorNgn, recorded: value.usage.recorded } };
  if (value.type === 'error' && text(value.code, 200) && text(value.message, 4000) && value.message && typeof value.retryable === 'boolean' && (value.retryAfterS === undefined || number(value.retryAfterS))) return { v: 1, type: 'error', code: value.code, message: value.message, retryable: value.retryable, ...(value.retryAfterS === undefined ? {} : { retryAfterS: value.retryAfterS }) };
  throw invalid();
}

export function applyCopilotEvent(exchange: CopilotExchange, event: CopilotEvent, now = Date.now()): CopilotExchange {
  if (['complete', 'stopped', 'error'].includes(exchange.status)) return exchange;
  if (event.type === 'start') return { ...exchange, requestId: event.requestId };
  if (event.type === 'activity') {
    const found = exchange.activities.some((activity) => activity.id === event.activity.id);
    return { ...exchange, activities: found ? exchange.activities.map((activity) => activity.id === event.activity.id ? event.activity : activity) : [...exchange.activities, event.activity] };
  }
  if (event.type === 'meta') return { ...exchange, meta: event };
  if (event.type === 'delta') return { ...exchange, text: exchange.text + event.text, status: 'streaming' };
  if (event.type === 'grounding') return { ...exchange, grounding: event };
  if (event.type === 'complete') return { ...exchange, status: 'complete', completedAt: now, interactionId: event.interactionId, usage: event.usage };
  return { ...exchange, status: 'error', completedAt: now, error: { code: event.code, message: event.message, retryable: event.retryable, ...(event.retryAfterS === undefined ? {} : { retryAfterS: event.retryAfterS }) } };
}

/** Only complete answer pairs enter follow-up context. Sources and permission flags are never replayed. */
export function completedCopilotTurns(exchanges: readonly CopilotExchange[]): CopilotTurn[] {
  const pairs: CopilotTurn[][] = [];
  let chars = 0;
  for (const exchange of [...exchanges].reverse()) {
    if (exchange.status !== 'complete' || !exchange.text.trim()) continue;
    const length = exchange.question.length + exchange.text.length;
    if (pairs.length * 2 + 2 > COPILOT_MAX_HISTORY || chars + length > COPILOT_MAX_HISTORY_CHARS) break;
    pairs.unshift([{ role: 'user', content: exchange.question }, { role: 'assistant', content: exchange.text }]);
    chars += length;
  }
  return pairs.flat();
}

/** Fit whole completed pairs to the server's 32 KiB request boundary, including JSON escaping. */
export function serializeCopilotRequest(question: string, exchanges: readonly CopilotExchange[]): string {
  const maxBytes = 32_768;
  const encoder = new TextEncoder();
  let turns = completedCopilotTurns(exchanges);
  const serialize = () => JSON.stringify({ question, ...(turns.length ? { turns } : {}) });
  let body = serialize();
  // Character limits alone do not bound UTF-8 or escaped control-character bytes.
  // Questions already pass the 2,000-character guard; discard only older history.
  while (turns.length && encoder.encode(body).byteLength > maxBytes) {
    turns = turns.slice(2);
    body = serialize();
  }
  return body;
}

async function responseFailure(response: Response): Promise<CopilotClientError> {
  let message = response.status === 429 ? 'The request limit has been reached. Please wait before retrying.' : response.status === 403 || response.status === 401 ? 'Your current access does not permit this Copilot request.' : 'The AI service could not answer this request. Please try again.';
  let code = `http_${response.status}`;
  let retryable = response.status === 429 || response.status >= 500;
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    try {
      const body: unknown = await response.json();
      if (object(body)) {
        if (text(body.message, 4000) && body.message) message = body.message;
        else if (text(body.error, 4000) && body.error) message = body.error;
        if (text(body.code, 200)) code = body.code;
        if (typeof body.retryable === 'boolean') retryable = body.retryable;
      }
    } catch { /* Keep a safe status-based explanation for invalid or HTML responses. */ }
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new CopilotClientError({ code, message, retryable, ...(retryAfter > 0 && Number.isFinite(retryAfter) ? { retryAfterS: retryAfter } : {}) });
}

/** Native NDJSON reader supports arbitrary byte/frame boundaries, including split Unicode. */
export async function readCopilotStream(response: Response, module: CopilotModule, signal: AbortSignal, onEvent: (event: CopilotEvent) => void): Promise<void> {
  if (!response.ok) throw await responseFailure(response);
  if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-ndjson')) throw invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', started = false, hasMeta = false, terminal = false, answerLength = 0, hasAnswer = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  const line = (raw: string) => {
    if (!raw.trim()) return;
    if (raw.length > 1000000 || terminal) throw invalid();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw invalid(); }
    const event = parseCopilotEvent(parsed, module);
    if (event.type === 'start') { if (started) throw invalid(); started = true; }
    else if (event.type !== 'error' && !started) throw invalid();
    if (event.type === 'meta') { if (hasMeta) throw invalid(); hasMeta = true; }
    if (event.type === 'delta') { if (!hasMeta) throw invalid(); answerLength += event.text.length; hasAnswer ||= !!event.text.trim(); if (answerLength > 1000000) throw invalid(); }
    if (event.type === 'complete') { if (!hasMeta || !hasAnswer) throw invalid(); terminal = true; }
    if (event.type === 'error') terminal = true;
    if (!signal.aborted) onEvent(event);
  };
  try {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, boundary).replace(/\r$/, '')); buffer = buffer.slice(boundary + 1); }
      if (buffer.length > 1000000) throw invalid();
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer);
    if (!terminal) throw invalid();
  } catch (error) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    if (error instanceof CopilotClientError) throw error;
    throw invalid();
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
