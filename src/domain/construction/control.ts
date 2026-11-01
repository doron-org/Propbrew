export type OnboardingStatus = 'pending_review' | 'approved' | 'rejected' | 'suspended';
export type SubcontractorOnboarding = {
  tenantId: string; id: string; name: string; trade: string; contactName: string; phoneE164: string;
  cacNumber: string; insuranceExpiryISO?: string; hseInducted: boolean;
  projectIds: string[]; status: OnboardingStatus; submittedBy: string; submittedAtISO: string;
  reviewedBy?: string; reviewedAtISO?: string; reviewNote?: string;
};

export type EvidenceSubject = 'daily_report' | 'task' | 'quality_gate' | 'delivery' | 'variation' | 'claim';
export type ConstructionEvidencePack = {
  tenantId: string; id: string; projectId: string; subject: EvidenceSubject; subjectRef: string;
  title: string; mediaRefs: string[]; sha256: string; capturedBy: string; capturedAtISO: string;
  status: 'pending_review' | 'approved' | 'rejected'; reviewedBy?: string; reviewedAtISO?: string; reviewNote?: string;
};

export type FieldApprovalKind = 'progress' | 'quality_gate' | 'delivery' | 'handover';
export type ConstructionFieldApproval = {
  tenantId: string; id: string; projectId: string; kind: FieldApprovalKind; subjectRef: string;
  title: string; summary: string; evidencePackIds: string[]; status: 'pending' | 'approved' | 'rejected';
  requestedBy: string; requestedAtISO: string; decidedBy?: string; decidedAtISO?: string; decisionNote?: string;
};

export type ConstructionClaim = {
  tenantId: string; id: string; ref: string; projectId: string; subcontractorId: string; variationId?: string;
  periodEndISO: string; description: string; claimedMinor: number; assessedMinor?: number; retentionMinor: number;
  retentionPct: number; whtMinor: number; whtPct: number; certifiedMinor?: number; status: 'submitted' | 'assessed' | 'approved' | 'rejected' | 'paid';
  submittedBy: string; submittedAtISO: string; reviewedBy?: string; reviewedAtISO?: string; reviewNote?: string;
  bankLineId?: string; paymentReference?: string; paidAtISO?: string; paidBy?: string;
};

export const HANDOVER_REQUIREMENTS = [
  { key: 'as_built', label: 'Approved as-built drawings' },
  { key: 'testing', label: 'Testing and commissioning records' },
  { key: 'authorities', label: 'Authority permits and sign-offs' },
  { key: 'manuals', label: 'Operation manuals and warranties' },
  { key: 'defects', label: 'Defects and punch-list closeout' },
] as const;
export type HandoverRequirement = typeof HANDOVER_REQUIREMENTS[number]['key'];
export type ConstructionHandoverPack = {
  tenantId: string; id: string; projectId: string; ref: string; title: string;
  items: { requirement: HandoverRequirement; docId: string; number: string; revision: string; fileSha256: string }[];
  approvalId: string; status: 'draft' | 'submitted' | 'approved'; createdBy: string; createdAtISO: string;
  submittedBy?: string; submittedAtISO?: string; approvedBy?: string; approvedAtISO?: string;
};
export type ConstructionBankDebit = {
  tenantId: string; id: string; date: string; reference: string; amountMinor: number; narration: string;
  importedBy: string; importedAtISO: string; status: 'pending_review' | 'approved' | 'rejected';
  reviewedBy?: string; reviewedAtISO?: string;
};
export type ConstructionRetentionRelease = {
  tenantId: string; id: string; claimId: string; projectId: string; ref: string; amountMinor: number;
  reason: string; status: 'requested' | 'approved' | 'rejected' | 'paid'; requestedBy: string; requestedAtISO: string;
  reviewedBy?: string; reviewedAtISO?: string; bankLineId?: string; paymentReference?: string; paidAtISO?: string;
};

export type ProcurementPayment = {
  tenantId: string; id: string; ref: string; projectId: string; poId: string; invoiceRef: string;
  invoiceMinor: number; eligibleDeliveredMinor: number; retentionMinor: number; whtMinor: number; payableMinor: number;
  threeWayMatched: boolean; status: 'pending_match' | 'pending_approval' | 'approved' | 'paid' | 'rejected';
  requestedBy: string; requestedAtISO: string; reviewedBy?: string; reviewedAtISO?: string;
  paymentReference?: string; paidAtISO?: string; note?: string;
};

export type ConstructionControlState = {
  subcontractors: SubcontractorOnboarding[];
  evidencePacks: ConstructionEvidencePack[];
  fieldApprovals: ConstructionFieldApproval[];
  claims: ConstructionClaim[];
  payments: ProcurementPayment[];
  handoverPacks: ConstructionHandoverPack[];
  bankDebits: ConstructionBankDebit[];
  retentionReleases: ConstructionRetentionRelease[];
};

export function emptyConstructionControlState(): ConstructionControlState {
  return { subcontractors: [], evidencePacks: [], fieldApprovals: [], claims: [], payments: [], handoverPacks: [], bankDebits: [], retentionReleases: [] };
}

export function handoverOmissions(pack: ConstructionHandoverPack, docs: readonly { id: string; projectId: string; number: string; revision: string; status: string; fileId?: string; fileSha256?: string }[]) {
  return HANDOVER_REQUIREMENTS.flatMap(({ key, label }) => {
    const item = pack.items.find((row) => row.requirement === key);
    if (!item) return [`${label}: document missing`];
    const doc = docs.find((row) => row.id === item.docId && row.projectId === pack.projectId);
    if (!doc || doc.status !== 'approved' || !doc.fileId || !doc.fileSha256 || doc.number !== item.number || doc.revision !== item.revision || doc.fileSha256 !== item.fileSha256) return [`${label}: approved file revision unavailable or superseded`];
    return [];
  });
}

export function claimPayableMinor(claimedMinor: number, retentionPct: number, whtPct: number) {
  const retentionMinor = Math.round(claimedMinor * retentionPct / 100);
  const whtMinor = Math.round((claimedMinor - retentionMinor) * whtPct / 100);
  return { retentionMinor, whtMinor, payableMinor: claimedMinor - retentionMinor - whtMinor };
}
