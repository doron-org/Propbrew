/**
 * Offline sync engine — pure reducers over the outbox. No browser APIs, no
 * network: the persistence layer and the transport call into these, so the
 * queue's behaviour (ordering, backoff, dedupe, conflict handling) is testable
 * without a browser and identical wherever it runs.
 */

import type { Tone } from '@/lib/status-tones';
import type { OutboxOp, OpStatus, OpKind, SyncOutcome } from './types';

/** Exponential backoff with a ceiling — a phone in a basement must not spin. */
export const BACKOFF_MS = [0, 5_000, 15_000, 60_000, 300_000] as const;
export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

/** Ops the transport should attempt now: queued or previously failed, in
 *  capture order, once their backoff has elapsed. Conflicts are NEVER retried
 *  automatically — they need a human decision. */
export function dueOps(ops: readonly OutboxOp[], nowMs: number, lastAttemptMs: Record<string, number> = {}): OutboxOp[] {
  return ops
    .filter((o) => o.status === 'queued' || o.status === 'failed')
    .filter((o) => {
      const last = lastAttemptMs[o.id];
      return last === undefined || nowMs - last >= backoffMs(o.attempts);
    })
    .sort((a, b) => Date.parse(a.capturedISO) - Date.parse(b.capturedISO));
}

/** Fold a server outcome back into the op. Duplicates count as success — that
 *  is the whole point of the idempotency key. */
export function applyOutcome(op: OutboxOp, outcome: SyncOutcome, nowISO: string): OutboxOp {
  if (outcome.ok) {
    return { ...op, status: 'synced', syncedISO: nowISO, error: undefined, serverState: undefined };
  }
  if (outcome.conflict) {
    return { ...op, status: 'conflict', error: outcome.error, serverState: outcome.serverState, attempts: op.attempts + 1 };
  }
  return { ...op, status: 'failed', error: outcome.error, attempts: op.attempts + 1 };
}

export type QueueStats = {
  total: number; pending: number; sending: number; synced: number; conflicts: number; failed: number;
  attachments: number; oldestISO: string | null;
};

/** What the sync chip renders. `pending` is what the user would lose if the
 *  phone died right now — so it is the number we surface most loudly. */
export function queueStats(ops: readonly OutboxOp[]): QueueStats {
  const by = (s: OpStatus) => ops.filter((o) => o.status === s);
  const unsent = ops.filter((o) => o.status !== 'synced');
  const oldest = unsent.map((o) => o.capturedISO).sort()[0] ?? null;
  return {
    total: ops.length,
    pending: by('queued').length + by('failed').length,
    sending: by('sending').length,
    synced: by('synced').length,
    conflicts: by('conflict').length,
    failed: by('failed').length,
    attachments: unsent.reduce((n, o) => n + o.attachments, 0),
    oldestISO: oldest,
  };
}

export type SyncPosture = { label: string; tone: Tone; detail: string };

/** One honest sentence about where the user's data actually is. */
export function syncPosture(stats: QueueStats, online: boolean): SyncPosture {
  if (stats.conflicts > 0) {
    return { label: 'Needs review', tone: 'danger', detail: `${stats.conflicts} record${stats.conflicts === 1 ? '' : 's'} clashed with a newer server version — decide before they can sync.` };
  }
  if (!online) {
    return stats.pending > 0
      ? { label: 'Offline', tone: 'warn', detail: `${stats.pending} record${stats.pending === 1 ? '' : 's'} saved on this device. They will send themselves when signal returns.` }
      : { label: 'Offline', tone: 'muted', detail: 'No signal, and nothing waiting to send.' };
  }
  if (stats.sending > 0) return { label: 'Syncing', tone: 'progress', detail: `Sending ${stats.sending} record${stats.sending === 1 ? '' : 's'}…` };
  if (stats.pending > 0) return { label: 'Pending', tone: 'warn', detail: `${stats.pending} record${stats.pending === 1 ? '' : 's'} waiting to send.` };
  return { label: 'Synced', tone: 'success', detail: 'Everything captured on this device is on the server.' };
}

export const OP_LABEL: Record<OpKind, string> = {
  daily_report: 'Daily report',
  site_issue: 'Site issue',
  attendance: 'Attendance',
  field_check_in: 'Site check-in',
  material_request: 'Material request',
  task_progress: 'Task progress',
  safety_event: 'Safety event',
  evidence_pack: 'Evidence pack',
};

export const STATUS_TONE: Record<OpStatus, Tone> = {
  queued: 'warn', sending: 'progress', synced: 'success', conflict: 'danger', failed: 'danger',
};

/** Ops safe to drop from local storage: synced, and old enough that the user has
 *  had a chance to see them land. Never prunes anything unsent. */
export function prunable(ops: readonly OutboxOp[], nowMs: number, keepMs = 24 * 3600 * 1000): string[] {
  return ops
    .filter((o) => o.status === 'synced' && o.syncedISO && nowMs - Date.parse(o.syncedISO) > keepMs)
    .map((o) => o.id);
}

/** Merge a freshly captured op into the queue, replacing an identical-id entry
 *  (an edit before it ever sent) rather than duplicating it. */
export function enqueue(ops: readonly OutboxOp[], op: OutboxOp): OutboxOp[] {
  const i = ops.findIndex((o) => o.id === op.id);
  if (i < 0) return [...ops, op];
  // Never overwrite something already accepted by the server.
  if (ops[i].status === 'synced') return [...ops];
  const next = [...ops];
  next[i] = { ...op, attempts: ops[i].attempts };
  return next;
}
