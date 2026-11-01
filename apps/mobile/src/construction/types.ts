export type ConstructionTask = {
  id: string;
  projectId: string;
  name: string;
  status: 'not_started' | 'in_progress' | 'blocked' | 'done';
  percentComplete: number;
  plannedFinishISO: string;
  priority: 'low' | 'medium' | 'high';
};

export type ConstructionBootstrap = {
  version: number;
  generatedAt: string;
  profile: { userId: string; companyId: string; displayName: string; owner: string; role: string };
  projects: { id: string; name: string; code: string; status: string; sites: { id: string; name: string }[] }[];
  tasks: ConstructionTask[];
  checkIns: { id: string; projectId: string; dateISO: string; capturedAtISO: string; siteLocationId: string; accuracyMeters: number; distanceMeters: number; method: string }[];
};

export type ConstructionCapture = {
  id: string;
  owner: string;
  kind: 'task_progress' | 'field_check_in' | 'evidence_pack';
  capturedISO: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'needs_attention';
  error?: string;
  photoUri?: string;
  uploadedUrl?: string;
};

export type ConstructionSyncReceipt = {
  ok: boolean;
  id: string;
  conflict?: boolean;
  error?: string;
  serverState?: string;
  duplicate?: boolean;
  ref?: string;
};
