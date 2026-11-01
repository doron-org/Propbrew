export type Project = { id: string; name: string; code: string; status: string; sites: { id: string; name: string }[] };
export type Task = { id: string; projectId: string; name: string; status: string; percentComplete: number; plannedFinishISO?: string; priority?: string };
export type CheckIn = { id: string; projectId: string; dateISO: string; capturedAtISO: string; siteLocationId: string; accuracyMeters: number; distanceMeters: number; method: string };
export type Bootstrap = { version: number; generatedAt: string; profile: { userId: string; companyId: string; displayName: string; owner: string; role: string }; projects: Project[]; tasks: Task[]; checkIns: CheckIn[] };
export type QueuedPhoto = { uri: string; mimeType: string; uploadedUrl?: string };
export type FieldOp = {
  id: string;
  owner: string;
  kind: 'task_progress' | 'evidence_pack' | 'field_check_in';
  capturedISO: string;
  label: string;
  payload: Record<string, unknown>;
  photos: QueuedPhoto[];
  status: 'queued' | 'failed' | 'conflict' | 'synced';
  attempts: number;
  error?: string;
  ref?: string;
};
export type SyncOutcome = { ok: true; duplicate: boolean; ref?: string } | { ok: false; conflict: boolean; error: string; serverState?: string };
