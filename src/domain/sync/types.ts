/**
 * Offline-first sync — domain types (no framework, no browser APIs).
 *
 * The field app must keep working with no signal (PRD §7 "Mobile and offline",
 * §17 acceptance: "no entered record or attachment is lost during
 * synchronization"). Every mutation captured offline becomes an OutboxOp with a
 * client-generated idempotency key; the server dedupes on that key, so a retry
 * after an ambiguous failure can never double-apply.
 */

/** The mutations the field app can capture without a connection. */
export type OpKind =
  | 'daily_report'
  | 'site_issue'
  | 'attendance'
  | 'field_check_in'
  | 'material_request'
  | 'task_progress'
  | 'safety_event'
  | 'evidence_pack';

/** Server-computed ownership namespace; an old account's queue must never drain as a new user. */
export const outboxOwnerKey = (tenantId: string | null, userId: string): string | undefined => tenantId ? JSON.stringify([tenantId, userId]) : undefined;

export type OpStatus =
  /** sitting in the local outbox, not yet attempted */
  | 'queued'
  /** in flight right now */
  | 'sending'
  /** the server accepted it (or recognised the key as already applied) */
  | 'synced'
  /** rejected because server state moved on — needs a human decision */
  | 'conflict'
  /** transient failure; will retry with backoff */
  | 'failed';

export type OutboxOp = {
  /** client-generated, stable across retries — THE idempotency key. */
  id: string;
  kind: OpKind;
  /** human label for the queue UI, e.g. "Daily report · Marina Heights · 26 Jul". */
  label: string;
  /** the mutation payload, opaque to the queue machinery. */
  payload: Record<string, unknown>;
  /** when the field user captured it (may be long before it syncs). */
  capturedISO: string;
  /** how many photos/files ride with it — surfaced so nothing looks "lost". */
  attachments: number;
  status: OpStatus;
  attempts: number;
  /** last failure/conflict explanation, shown verbatim to the user. */
  error?: string;
  /** set when the server applied it (or confirmed a prior apply). */
  syncedISO?: string;
  /** server's version of the record when a conflict was detected. */
  serverState?: string;
};

/** What the server returns for one submitted op. */
export type SyncOutcome =
  | { ok: true; id: string; duplicate: boolean; ref?: string }
  | { ok: false; id: string; conflict: true; error: string; serverState: string }
  | { ok: false; id: string; conflict: false; error: string };
