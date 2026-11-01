import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const identifier = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:-]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const lines = z.array(text).max(100).default([]);
const mediaRefs = z.array(z.url().refine((s) => s.startsWith('https://'))).max(20).default([]);
const common = { projectId: identifier, mediaRefs };
const envelope = { id: identifier, owner: z.string().min(1).max(500), capturedISO: z.iso.datetime({ offset: true }) };
export const syncInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...envelope, kind: z.literal('daily_report'), payload: z.strictObject({
    ...common, dateISO: date, weather: z.string().trim().max(200).default(''), shift: z.enum(['day', 'night']).default('day'),
    workforceCount: count, completed: lines, ongoing: lines, delayed: lines, plannedNext: lines, deliveries: lines, incidents: lines, constraints: lines,
    photos: count.max(20).default(0),
  }).refine((p) => p.photos === p.mediaRefs.length, { message: 'Every photo needs a successful upload before the report can sync.' }) }),
  z.strictObject({ ...envelope, kind: z.literal('site_issue'), payload: z.strictObject({
    ...common, title: text, severity: z.enum(['low', 'medium', 'high', 'critical']), category: text.default('Site'), correctiveAction: z.string().trim().max(2000).default(''),
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('attendance'), payload: z.strictObject({
    ...common, workerId: identifier, dateISO: date, status: z.enum(['present', 'absent', 'pending']), clockIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('field_check_in'), payload: z.strictObject({
    projectId: identifier, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().positive().max(1000), locationAtISO: z.iso.datetime({ offset: true }),
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('material_request'), payload: z.strictObject({
    ...common, item: text, qty: z.number().positive().max(Number.MAX_SAFE_INTEGER), unit: text, costCode: identifier,
    estimateNaira: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).refine((n) => Number.isSafeInteger(Math.round(n * 100))), requiredISO: date, justification: text,
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('task_progress'), payload: z.strictObject({
    ...common, taskId: identifier, percentComplete: z.number().min(0).max(100),
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('safety_event'), payload: z.strictObject({
    ...common, eventKind: z.enum(['near_miss', 'first_aid', 'lost_time', 'observation']), title: text, zoneId: identifier.optional(), lostDays: count, action: z.string().trim().max(2000).optional(),
  }) }),
  z.strictObject({ ...envelope, kind: z.literal('evidence_pack'), payload: z.strictObject({
    ...common, subject: z.enum(['daily_report', 'task', 'quality_gate', 'delivery', 'variation', 'claim']),
    subjectRef: text, title: text,
  }).refine((p) => p.mediaRefs.length > 0, { message: 'An evidence pack needs at least one successfully uploaded file.' }) }),
]);

/** Sort every object key so a retry with reordered JSON has the same receipt. */
export function syncFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
