/**
 * Construction (ConstructionOS) — domain types for the new construction-operations
 * module: projects → phases → tasks → milestones/issues, daily site reports,
 * procurement (requests → RFQ → PO → delivery), inventory movements, cost codes +
 * variations (Earned-Value computed in the engine), workforce/attendance, and
 * documents/RFIs. No framework imports.
 *
 * Scoping: construction rows are TENANT-scoped only (no estateId/siteId) so they
 * pass the estate filter for a single-estate manager; `projectId` on the Project
 * equals its linked off-plan investor project id (the §7 investor `my_projects`
 * scope column) so an investor client view auto-narrows to their own build.
 */

import type { CurrencyCode, Money } from '@/domain/primitives';
import type { FxRate } from '@/domain/fx';
import type { TenantScoped } from '@/domain/tenancy';
import type { BcfComment, BcfViewpoint } from './bcf';

/* --- projects, phases, tasks --------------------------------------------- */

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'closing' | 'completed';
export type BaselineRevisionStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'superseded';
export type ProjectBaselineRevision = {
  id: string; revision: string; name: string; status: BaselineRevisionStatus;
  submittedBy: string; submittedById?: string; submittedISO: string; approvedBy?: string; approvedById?: string; approvedISO?: string;
  reason: string; plannedFinishISO: string; includedApprovedChangeDays?: number;
};
export type ProjectTeamMember = {
  id: string; name: string; organisation: string; role: string;
  responsibility: string; accountable: boolean; email?: string;
};
export type ProjectWorkPackage = {
  id: string; code: string; name: string; phaseId?: string; costCode?: string;
  contractor?: string; manager?: string; status: 'planned' | 'mobilising' | 'active' | 'complete' | 'suspended';
};
export type ProjectLocation = {
  id: string; name: string; kind: 'site' | 'block' | 'floor' | 'zone';
  parentId?: string; latitude?: number; longitude?: number;
};
export type ProjectParty = {
  id: string; name: string; kind: 'client' | 'consultant' | 'contractor' | 'authority';
  discipline: string; contractPackage?: string; permitReference?: string; permitExpiryISO?: string;
};
export type ProjectMobilisation = {
  calendar: { name: string; workingDays: number[]; hoursPerDay: number; timeZone: string; holidays: string[] };
  baselines: ProjectBaselineRevision[];
  team: ProjectTeamMember[];
  workPackages: ProjectWorkPackage[];
  locations: ProjectLocation[];
  parties: ProjectParty[];
  lifecycle: { atISO: string; by: string; action: 'activate' | 'suspend' | 'reopen' | 'start_closeout' | 'complete'; reason: string }[];
};
export type Project = TenantScoped & {
  id: string;
  /** scope column for the investor `my_projects` narrowing; = linked off-plan id when set. */
  projectId: string;
  investorProjectId?: string; // ties to the existing off-plan investorProjects (p-marina, p-cedar)
  code: string; name: string; location: string; clientName: string; pmName: string;
  /** Explicit, audited cohort labels for completed-project forecast evaluation. */
  projectType?: import('./forecast-evaluation').ConstructionProjectType;
  region?: string;
  status: ProjectStatus;
  contractValue: Money; approvedBudget: Money;
  startISO: string; plannedFinishISO: string; actualStartISO?: string;
  /** planned % is the schedule baseline to date; percentComplete is actual physical progress. */
  plannedPercent: number; percentComplete: number;
  /** Approved change-order days affect the outlook, never the programme baseline. */
  approvedChangeDays?: number;
  /** Change days already absorbed by the current approved programme baseline. */
  approvedChangeDaysInBaseline?: number;
  /** Minimum cost outlook supported by authorized change-order commitments. */
  approvedChangeForecastMinor?: number;
  /** Mobilisation configuration is embedded in the durable project record so
   * existing company workspaces can adopt it without a destructive schema reset. */
  mobilisation?: ProjectMobilisation;
};

export type Phase = TenantScoped & {
  id: string; projectId: string; name: string; order: number;
  startISO: string; finishISO: string;
  /** share of the whole project (weights sum to ~100 across a project's phases). */
  weight: number; percentComplete: number;
};

export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';
export type Task = TenantScoped & {
  id: string; projectId: string; phaseId: string; name: string; owner: string;
  plannedStartISO: string; plannedFinishISO: string; actualStartISO?: string; actualFinishISO?: string;
  percentComplete: number; status: TaskStatus; priority: 'low' | 'medium' | 'high';
  /** dependency task ids (finish-to-start) — drives the critical path. */
  dependsOn: string[];
  /** Explicit finish-to-start lag in project working days, keyed by predecessor id.
   * Legacy tasks without this map infer the gap from their approved dates. */
  dependencyLags?: Record<string, number>;
  /** Current, reversible live forecast impact. Approved baseline dates stay intact. */
  programmeDelay?: { workingDays: number; reasonCodeId: string; note?: string; recordedBy: string; recordedAtISO: string };
  budget: Money;
  /** optional crash economics (present on tasks that can be accelerated). */
  crash?: TaskCrash;
  /** the zone this task builds, for the site twin. */
  zoneId?: string;
};

/** Crash economics for the what-if simulator: how many days a task can be
 *  bought back, and what each day costs in extra crew/plant. */
export type TaskCrash = { crashableDays: number; crashCostPerDay: Money };

export type MilestoneStatus = 'pending' | 'at_risk' | 'accepted' | 'missed';
export type Milestone = TenantScoped & {
  id: string; projectId: string; name: string; dueISO: string; status: MilestoneStatus; evidence?: string;
};

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_progress' | 'resolved';
export type QualityChecklistResult = {
  itemId: string; result: 'pass' | 'fail' | 'not_applicable'; finding?: string; photoIds: string[];
};
export type QualityInspectionVisit = {
  id: string; kind: 'initial' | 'reinspection'; dateISO: string; timeWAT: string;
  inspector: string; scheduledBy: string; scheduledAtISO: string;
  recordedBy?: string; recordedAtISO?: string; notes?: string; results?: QualityChecklistResult[];
};
export type QualityInspection = {
  checklist: { id: string; label: string; punchIssueId?: string }[];
  visits: QualityInspectionVisit[];
  signOff?: { signer: string; role: string; reference: string; decision: string; recordedBy: string; recordedAtISO: string };
};
export type Issue = TenantScoped & {
  id: string; projectId: string; category: string; title: string; severity: IssueSeverity;
  owner: string; raisedISO: string; dueISO: string; status: IssueStatus; correctiveAction?: string;
  /** Construction quality and design-coordination metadata. Older issues omit these fields. */
  location?: string; sourceReference?: string; relatedReference?: string; authority?: string;
  evidenceReference?: string; closedISO?: string;
  workPackageId?: string; inspectionId?: string; checklistItemId?: string;
  photoIds?: string[];
  remediation?: { description: string; photoIds: string[]; submittedBy: string; submittedAtISO: string };
  inspection?: QualityInspection;
  clashDetection?: { runId: string; modelAId: string; modelBId: string; componentAId: string; componentBId: string;
    point: [number, number, number]; overlapMm: number; clearanceMm?: number; intersects?: boolean;
    method: 'component_envelope_v1' | 'triangle_surface_v1' };
  bcf?: { guid: string; importedAtISO?: string; source?: string; description?: string; externalStatus?: string; componentIds?: string[];
    createdAtISO?: string; createdAuthor?: string; modifiedAtISO?: string; modifiedAuthor?: string; topicType?: string;
    comments?: BcfComment[]; viewpoints?: BcfViewpoint[];
    exchangeHistory?: { atISO: string; actor: string; action: 'imported' | 'updated'; commentCount: number; viewpointCount: number; status: string; previousStatus?: string }[];
    commentRevisions?: { savedAtISO: string; previous: BcfComment }[] };
  clashReview?: { disposition: 'confirmed' | 'false_positive' | 'accepted_tolerance' | 'needs_redesign';
    rationale: string; evidenceReference: string; reviewerId: string; reviewerName: string; reviewedAtISO: string };
};

/* --- site operations ------------------------------------------------------ */

export type ReportStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'returned';
export type DailyReport = TenantScoped & {
  id: string; projectId: string; dateISO: string; weather: string; shift: string; officer: string;
  workforceCount: number; completed: string[]; ongoing: string[]; delayed: string[]; plannedNext: string[];
  deliveries: string[]; incidents: string[]; constraints: string[]; photos: number; mediaRefs?: readonly string[]; status: ReportStatus;
};

/* --- procurement ---------------------------------------------------------- */

export type Vendor = TenantScoped & {
  id: string; name: string; category: string; rating: number; onTimePct: number;
  qualityIncidents: number; complianceExpiryISO?: string; suspended?: boolean;
};

export type PRStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'rfq' | 'ordered';
export type PurchaseRequest = TenantScoped & {
  id: string; ref: string; projectId: string; item: string; qty: number; unit: string; costCode: string;
  estimate: Money; requiredISO: string; requestedBy: string; status: PRStatus; justification: string;
};

export type Quote = { vendorId: string; vendorName: string; price: Money; leadDays: number; warrantyMonths: number; compliancePct: number };
export type RFQStatus = 'open' | 'comparing' | 'awarded';
export type RFQ = TenantScoped & {
  id: string; ref: string; requestRef: string; projectId: string; item: string; qty: number; unit: string;
  status: RFQStatus; quotes: Quote[]; awardedVendorId?: string;
};

export type POStatus = 'draft' | 'approved' | 'issued' | 'acknowledged' | 'part_delivered' | 'delivered' | 'closed' | 'cancelled';

/**
 * FX tag on a foreign-denominated commitment. The PO's `value` remains the NGN
 * amount POSTED to the books at `bookedRate` (so every base-currency rollup is
 * unaffected); this records the foreign side so the outstanding balance can be
 * revalued as the rate moves. `bookedRate` is NGN per 1 foreign unit at award.
 */
export type FxTag = { currency: CurrencyCode; foreignMinor: number; bookedRate: number };

export type PurchaseOrder = TenantScoped & {
  id: string; ref: string; projectId: string; vendorId: string; vendorName: string; item: string;
  qty: number; unit: string; costCode: string; value: Money; status: POStatus;
  issuedISO: string; expectedISO: string; deliveredQty: number;
  /** present only when the order was placed in a currency other than NGN. */
  fx?: FxTag;
};

/** A stored, tenant-scoped exchange rate row (the pure {@link FxRate} plus scope). */
export type FxRateRow = TenantScoped & FxRate;

/* --- inventory & materials ------------------------------------------------ */

export type Material = TenantScoped & {
  id: string; sku: string; name: string; category: string; unit: string; reorderLevel: number; unitCost: Money;
};

export type Warehouse = TenantScoped & { id: string; name: string; kind: 'central' | 'site_store'; projectId?: string };

/** Per-material, per-warehouse stock position. available = onHand − reserved. */
export type StockItem = TenantScoped & {
  id: string; materialId: string; warehouseId: string; onHand: number; reserved: number; inTransit: number;
};

export type StockKind = 'receipt' | 'issue' | 'transfer' | 'return' | 'adjust';
export type StockMovement = TenantScoped & {
  id: string; materialId: string; kind: StockKind; qty: number; atISO: string;
  projectId?: string; costCode?: string; ref?: string; by: string;
};

/* --- cost control (EVM computed in engine) -------------------------------- */

export type CostCode = TenantScoped & {
  id: string; projectId: string; code: string; name: string; category: string;
  budget: Money; committed: Money; actual: Money;
  /** planned value share of the project baseline to date, for earned-value. */
  plannedPercent: number; earnedPercent: number;
};

export type VariationStatus = 'draft' | 'submitted' | 'pricing_requested' | 'priced' | 'client_review' | 'ready_to_post' | 'approved' | 'rejected';
export type ChangeOrderControl = {
  sourceKind: 'rfi' | 'site_issue'; sourceId: string; sourceRef: string; workPackageId?: string;
  costCode: string; subcontractorId: string; subcontractorName: string;
  proposedBy: string; proposedAtISO: string;
  pricingRequestedBy?: string; pricingRequestedAtISO?: string;
  quote?: { amountMinor: number; reference: string; scope: string; submittedBy: string; submittedAtISO: string; recordedOnBehalf: boolean };
  assessment?: { budgetDeltaMinor: number; scheduleDays: number; note: string; assessedBy: string; assessedAtISO: string };
  clientDecision?: { reference: string; note: string; decidedBy: string; decidedAtISO: string; decision: 'approved' | 'rejected' };
  posting?: { authorizationReference: string; budgetBeforeMinor: number; budgetAfterMinor: number; commitmentBeforeMinor: number; commitmentAfterMinor: number;
    costForecastBeforeMinor: number; costForecastAfterMinor: number; forecastBeforeISO: string; forecastAfterISO: string; postedBy: string; postedAtISO: string };
};
export type Variation = TenantScoped & {
  id: string; ref: string; projectId: string; title: string; reason: string;
  costImpact: Money; scheduleImpactDays: number; status: VariationStatus; raisedISO: string;
  workPackageId?: string; subcontractorId?: string;
  changeOrder?: ChangeOrderControl;
};

/* --- workforce ------------------------------------------------------------ */

export type WorkerKind = 'employee' | 'subcontractor' | 'temp';
export type Worker = TenantScoped & {
  id: string; name: string; trade: string; kind: WorkerKind; projectId?: string; crew?: string; company?: string;
  dayRate: Money; certName?: string; certExpiryISO?: string;
};

/** A week of labour booked against a cost code. Approving it POSTS the cost to
 *  that code's actual, which is what makes labour show up in earned value. */
export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type Timesheet = TenantScoped & {
  id: string; ref: string; projectId: string; workerId: string; workerName: string;
  weekEndingISO: string; costCode: string; taskId?: string;
  normalHours: number; overtimeHours: number;
  status: TimesheetStatus; submittedBy: string; approvedBy?: string; approvedISO?: string;
  /** set when approval posted the cost — prevents double-posting. */
  postedMinor?: number;
};

export type AttendanceMethod = 'gps' | 'qr' | 'manual' | 'offline';
export type Attendance = TenantScoped & {
  id: string; workerId: string; projectId: string; dateISO: string; clockIn?: string; clockOut?: string;
  hours: number; overtime: number; method: AttendanceMethod; withinGeofence: boolean; status: 'present' | 'absent' | 'pending';
};

/* --- documents & RFIs ----------------------------------------------------- */

export type DocStatus = 'draft' | 'review' | 'approved' | 'superseded' | 'rejected';
/** One REVISION of a controlled document. The `number` is the document's stable
 *  identity; rows sharing a number form its revision chain, and at most one is
 *  `approved` (the current issue). An approved revision is never edited — it is
 *  superseded by a new one, which is what makes the register auditable. */
export type ConstructionDoc = TenantScoped & {
  id: string; projectId: string; number: string; title: string; discipline: string; revision: string;
  status: DocStatus; effectiveISO: string; folder: string;
  /** why this revision exists — required when issuing over an approved one. */
  changeNote?: string;
  uploadedBy?: string; approvedBy?: string; approvedISO?: string;
  /** the revision this one replaced, and the one that replaced it. */
  supersedesId?: string; supersededById?: string;
  fileSizeKb?: number;
  /** Private, immutable PDF bound to this exact revision. Legacy fixture rows omit it. */
  fileId?: string; fileName?: string; fileSizeBytes?: number; fileSha256?: string;
  /** A metadata-only draft cannot be approved until its PDF is attached. */
  requiresFile?: boolean;
  locationIds?: string[]; workPackageIds?: string[];
};

/** Controlled distribution: who was formally issued which revision, and when. */
export type Transmittal = TenantScoped & {
  id: string; projectId?: string; docId: string; docNumber: string; revision: string;
  toParty: string; sentISO: string; purpose: 'for_construction' | 'for_review' | 'for_information';
  acknowledgedISO?: string;
  /** External distribution is separate from legacy manually recorded issues. */
  recipientEmail?: string; requestKey?: string; createdByUserId?: string; issuedFileSha256?: string;
  deliveryStatus?: 'pending' | 'sending' | 'accepted' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'simulated';
  deliveryAttempts?: number; lastAttemptISO?: string; providerEmailId?: string;
  providerAcceptedISO?: string; deliveredISO?: string; deliveryError?: string;
  acknowledgementExpiresISO?: string; acknowledgedBy?: string; acknowledgedOrganisation?: string;
  deliveryEventIds?: string[];
};

export type RFIStatus = 'draft' | 'submitted' | 'open' | 'answered' | 'reviewed' | 'distributed' | 'closed';
export type RFIActivity = { atISO: string; byUserId: string; by: string; action: 'created' | 'updated' | 'submitted' | 'assigned' | 'answered' | 'returned' | 'reviewed' | 'distributed' | 'closed'; note?: string };
export type RFI = TenantScoped & {
  id: string; ref: string; projectId: string; question: string; discipline: string; drawingRef?: string;
  raisedBy: string; assignedTo: string; raisedISO: string; dueISO: string; status: RFIStatus;
  answer?: string; answeredISO?: string;
  /** New RFIs bind responsibility and drawings to immutable identities. Legacy
   * sample rows may contain only names and drawingRef. */
  title?: string; creatorUserId?: string; responderUserId?: string; answerByUserId?: string;
  drawingDocId?: string; drawingFileId?: string; responseDrawingDocId?: string; responseDrawingFileId?: string;
  workPackageId?: string; submittedISO?: string; reviewedISO?: string; reviewedByUserId?: string; reviewNote?: string;
  distributedISO?: string; distributionUserIds?: string[]; distributionNote?: string; closedISO?: string;
  responses?: { atISO: string; byUserId: string; text: string; drawingDocId?: string; drawingFileId?: string }[];
  activity?: RFIActivity[];
};

/* --- site twin (digital-twin-lite: the building, floor by floor) ---------- */

/** Per-trade completion for one physical slice of the building. The four layers
 *  are the real construction sequence, so a floor reads like a site walk. */
export type ZoneLayers = { structure: number; blockwork: number; mep: number; finishes: number };
export type Zone = TenantScoped & {
  id: string; projectId: string; level: number; label: string; block: string;
  layers: ZoneLayers;
  /** open snags/observations pinned to this zone. */
  openIssues: number; openRfis: number;
};

/* --- subcontractor league ------------------------------------------------- */

export type Subcontractor = TenantScoped & {
  id: string; name: string; trade: string; projectIds: string[];
  /** delivery: tasks finished on/before planned finish vs total finished. */
  tasksCompleted: number; tasksOnTime: number;
  /** quality + safety counts feed the composite score. */
  defects: number; reworkCost: Money; safetyIncidents: number;
  crewSize: number; contractValue: Money;
};

/* --- safety (site HSE) ---------------------------------------------------- */

export type SafetyPermitType = 'hot_work' | 'height' | 'excavation' | 'confined_space' | 'lifting' | 'electrical';
export type SafetyPermitStatus = 'requested' | 'approved' | 'active' | 'closed' | 'rejected' | 'expired';
export type SafetyPermit = TenantScoped & {
  id: string; ref: string; projectId: string; type: SafetyPermitType; zoneId?: string; location: string;
  requestedBy: string; supervisor: string; status: SafetyPermitStatus;
  validFromISO: string; validToISO: string; controls: string[];
  requestedById?: string; requestedAtISO?: string;
  reviewedById?: string; reviewedAtISO?: string; reviewNote?: string;
  activatedById?: string; activatedAtISO?: string; activationNote?: string;
  closedById?: string; closedAtISO?: string; closureNote?: string;
};

export type SafetyEventKind = 'near_miss' | 'first_aid' | 'lost_time' | 'observation';
export type SafetyCorrectiveAction = {
  ownerUserId: string; ownerName: string; dueISO: string; description: string;
  status: 'assigned' | 'in_progress' | 'awaiting_review' | 'returned' | 'verified';
  assignedById: string; assignedAtISO: string; startedAtISO?: string;
  evidenceReference?: string; completionNote?: string; submittedById?: string; submittedAtISO?: string;
  reviewedById?: string; reviewedAtISO?: string; reviewNote?: string;
  escalatedById?: string; escalatedAtISO?: string; escalationNote?: string;
};
export type SafetyEvent = TenantScoped & {
  id: string; projectId: string; kind: SafetyEventKind; title: string; zoneId?: string;
  atISO: string; reportedBy: string; lostDays: number; closed: boolean; action?: string;
  corrective?: SafetyCorrectiveAction;
};

export type ToolboxTalk = TenantScoped & {
  id: string; projectId: string; topic: string; atISO: string; attendees: number; deliveredBy: string;
  location?: string; recordedById?: string; recordedAtISO?: string;
};

/* --- structured reason codes ---------------------------------------------- */

/**
 * A controlled vocabulary for WHY something was rejected, delayed, varied or
 * adjusted (PRD §20: "Capture structured reasons … to support future
 * intelligence"). Free text can't be counted; a code can — which is what turns a
 * pile of rejections into a Pareto of what actually goes wrong on site.
 */
export type ReasonDomain = 'rejection' | 'delay' | 'variance' | 'stock_adjust' | 'stock_return';
export type ReasonCode = TenantScoped & {
  id: string; domain: ReasonDomain; code: string; label: string; category: string;
  /** true when the code alone isn't enough and a note must be typed. */
  requiresNote: boolean;
  /** false retires a code without breaking historic records that cite it. */
  active: boolean;
};

/** One use of a reason code, kept so the analytics are real rather than guessed. */
export type ReasonEvent = TenantScoped & {
  id: string; domain: ReasonDomain; codeId: string; subjectKind: string; subjectRef: string;
  projectId?: string; note?: string; atISO: string; by: string;
  /** money or days at stake, when the domain has one — powers a weighted Pareto. */
  impactMinor?: number; impactDays?: number;
};

/* --- stock counts (physical reconciliation) -------------------------------- */

export type StockCountStatus = 'open' | 'reconciled';
export type StockCount = TenantScoped & {
  id: string; ref: string; warehouseId: string; materialId: string;
  systemQty: number; countedQty: number; countedBy: string; countedISO: string;
  status: StockCountStatus; reasonCodeId?: string; note?: string; approvedBy?: string;
};

/* --- approval workflow engine ---------------------------------------------- */

/** A configurable route: which subject, above what value, through which steps.
 *  Rules are evaluated most-specific-first (highest threshold wins). */
export type ApprovalSubject = 'purchase_request' | 'variation' | 'timesheet' | 'stock_adjust' | 'budget_override';
export type ApprovalStepDef = {
  order: number; role: string; label: string;
  /** steps sharing an order run in PARALLEL — all must approve to advance. */
  slaHours: number;
};
export type ApprovalRule = TenantScoped & {
  id: string; name: string; subject: ApprovalSubject;
  /** inclusive lower bound in minor units; 0 = the base route. */
  thresholdMinor: number;
  category?: string;
  steps: ApprovalStepDef[];
  active: boolean;
};

export type StepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
export type ApprovalStepState = {
  order: number; role: string; label: string; slaHours: number;
  status: StepStatus; actedBy?: string; actedISO?: string; comment?: string;
  /** who this step is currently delegated to, if anyone. */
  delegatedTo?: string;
};
export type ApprovalStatus = 'in_flight' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalRequest = TenantScoped & {
  id: string; ref: string; subject: ApprovalSubject; subjectRef: string; title: string;
  projectId: string; amountMinor: number; raisedBy: string; raisedISO: string;
  ruleId: string; steps: ApprovalStepState[]; status: ApprovalStatus;
  reasonCodeId?: string; note?: string;
};

/* --- audit trail ----------------------------------------------------------- */

/** An append-only record of a sensitive action (PRD §18.3 "Immutable audit logs
 *  for sensitive actions", SC-10). Written by the actions, never edited. */
export type AuditAction =
  | 'approve' | 'reject' | 'issue' | 'supersede' | 'post_cost' | 'import'
  | 'stock_move' | 'stock_count' | 'override' | 'delegate' | 'cancel' | 'fx_revalue'
  | 'record' | 'resolve';
export type AuditEntry = TenantScoped & {
  id: string; seq: number; atISO: string;
  actorId: string; actorName: string; actorRole: string;
  action: AuditAction; entity: string; entityRef: string; projectId?: string;
  summary: string;
  /** the money the action moved, where it moved any. */
  amountMinor?: number;
  before?: string; after?: string; reasonCodeId?: string; note?: string;
};
