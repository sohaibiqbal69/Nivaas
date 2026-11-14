import { apiRequest } from './api';

export type GovernanceMeeting = {
  _id: string;
  societyId: string;
  type: 'AGM' | 'SGM' | 'COMMITTEE';
  title: string;
  description?: string;
  scheduledAt: string;
  status: string;
  projectId?: string;
  agenda?: string[];
  documentReferences?: Array<{ kind: 'NOTICE' | 'PROPOSAL' | 'QUOTATION' | 'MINUTES' | 'SUPPORTING_EVIDENCE'; reference: string }>;
  noticeReference?: string;
  noticeIssuedAt?: string;
  noticePeriodDays?: number;
  createdAt: string;
};

export type GovernanceResolution = {
  _id: string;
  societyId: string;
  meetingId: string;
  resolutionType: string;
  decisionBody: string;
  title: string;
  status: string;
  votingStart: string;
  votingEnd: string;
  ruleVersionId: string;
  eligibilitySnapshotId?: string;
  eligibleVoterCount?: number;
  projectId?: string;
  approvalDecisionId?: string;
  result?: { totalEligible: number; totalVotes: number; yesCount: number; noCount: number; abstainCount: number; quorumMet: boolean; quorumRequired: number; outcome: 'APPROVED' | 'REJECTED' | 'NO_DECISION' };
  finalizedAt?: string;
  finalizationAuditLogId?: string;
  votingMethod?: string;
};

export type CreateMeetingInput = {
  societyId?: string;
  type: GovernanceMeeting['type'];
  title: string;
  scheduledAt: string;
  description?: string;
  agenda?: string[];
  documentReferences?: Array<{ kind: 'NOTICE' | 'PROPOSAL' | 'QUOTATION' | 'MINUTES' | 'SUPPORTING_EVIDENCE'; reference: string }>;
  projectId?: string;
};

export type OfflineAttendee = { memberId: string; displayName: string };

export type CreateResolutionInput = {
  societyId?: string;
  meetingId: string;
  ruleVersionId: string;
  resolutionType: string;
  decisionBody: string;
  votingMethod: string;
  title: string;
  description?: string;
  votingStart: string;
  votingEnd: string;
};

export type SocietyGovernanceRule = {
  _id: string;
  societyId: string;
  versionNumber: number;
  status: string;
  effectiveFrom?: string;
  createdBy?: string;
  changeReason?: string;
  supportingDocumentReference?: string;
  policyChangeAuditLogId?: string;
  approvalPolicy?: { threshold: string };
  governancePolicy?: {
    schemaVersion: number;
    confirmationState: 'PENDING_CONFIRMATION' | 'CONFIRMED';
    decisionPolicies?: Array<{
      resolutionType: string;
      decisionBody: string;
      eligibility?: { membershipTypes?: string[]; membershipStatuses?: string[]; requiredEvidence?: string[] };
      quorum?: { population?: string; numerator?: number; denominator?: number; maximum?: number; rounding?: string };
      majority?: { numerator?: number; denominator?: number; denominatorBasis?: string; comparison?: string; abstentionTreatment?: string; tieOutcome?: string };
      voting?: { methods?: string[] };
    }>;
  };
};

function scopedPath(path: string, societyId?: string) {
  return societyId ? `${path}?societyId=${encodeURIComponent(societyId)}` : path;
}

export function listGovernanceMeetings(token: string, societyId?: string) {
  return apiRequest<GovernanceMeeting[]>(scopedPath('/meetings', societyId), { token });
}

export function createGovernanceMeeting(token: string, input: CreateMeetingInput) {
  return apiRequest<GovernanceMeeting>('/meetings', { token, method: 'POST', body: JSON.stringify(input) });
}

export function listGovernanceResolutions(token: string, societyId?: string) {
  return apiRequest<GovernanceResolution[]>(scopedPath('/resolutions', societyId), { token });
}

export function getActiveGovernanceRule(token: string, societyId?: string) {
  return apiRequest<SocietyGovernanceRule>(scopedPath('/society/rules', societyId), { token });
}

export function listSocietyRuleHistory(token: string) {
  return apiRequest<SocietyGovernanceRule[]>('/society/rules/history', { token });
}

export function updateApprovalThreshold(token: string, input: { threshold: string; reason?: string; supportingDocumentReference?: string }) {
  return apiRequest<SocietyGovernanceRule & { policyProof: { status: string; errorCode?: string; retryAvailable?: boolean } }>(
    '/society/rules/approval-threshold', { token, method: 'POST', body: JSON.stringify(input) },
  );
}

export function createGovernanceResolution(token: string, input: CreateResolutionInput) {
  return apiRequest<GovernanceResolution>('/resolutions', { token, method: 'POST', body: JSON.stringify(input) });
}

export function createEligibilitySnapshot(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ _id: string; eligibleCount: number; generatedAt: string }>(
    `/resolutions/${encodeURIComponent(resolutionId)}/eligibility-snapshot`, { token, method: 'POST', body: JSON.stringify(societyId ? { societyId } : {}) },
  );
}

export function getOfflineEligibleAttendees(token: string, resolutionId: string) {
  return apiRequest<OfflineAttendee[]>(`/resolutions/${encodeURIComponent(resolutionId)}/eligible-attendees`, { token });
}

export function recordOfflineGovernanceDecision(token: string, resolutionId: string, input: {
  attendanceMemberIds: string[]; method: 'SHOW_OF_HANDS' | 'POLL'; yesCount: number; noCount: number; abstainCount: number;
  minutesReference: string; supportingEvidenceReferences: string[]; confirm: boolean;
}) {
  return apiRequest<{ status: string; result: GovernanceResolution['result']; confirmedAt: string }>(`/resolutions/${encodeURIComponent(resolutionId)}/record-offline`, { token, method: 'POST', body: JSON.stringify(input) });
}

export function openGovernanceResolution(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ _id: string; status: string }>(
    `/resolutions/${encodeURIComponent(resolutionId)}/open`, { token, method: 'POST', body: JSON.stringify(societyId ? { societyId } : {}) },
  );
}

export function publishGovernanceMeeting(token: string, meetingId: string, input: { noticeReference: string; noticeIssuedAt: string; societyId?: string }) {
  return apiRequest<GovernanceMeeting>(`/meetings/${encodeURIComponent(meetingId)}/publish`, { token, method: 'POST', body: JSON.stringify(input) });
}

export function configureGeneralBodyStarterPolicy(token: string, input: { societyId?: string; confirmedDocumentReference: string }) {
  return apiRequest<SocietyGovernanceRule>('/society/rules/governance', { token, method: 'POST', body: JSON.stringify({ ...input, starterPolicy: true }) });
}

export function getMyGovernanceVote(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ vote: 'YES' | 'NO' | 'ABSTAIN'; castAt: string } | null>(scopedPath(`/resolutions/${encodeURIComponent(resolutionId)}/my-vote`, societyId), { token });
}

export function castGovernanceVote(token: string, resolutionId: string, vote: 'YES' | 'NO' | 'ABSTAIN', societyId?: string) {
  return apiRequest<{ _id: string; resolutionId: string; castAt: string }>(`/resolutions/${encodeURIComponent(resolutionId)}/votes`, { token, method: 'POST', body: JSON.stringify({ vote, ...(societyId ? { societyId } : {}) }) });
}

export function closeGovernanceResolution(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ _id: string; status: string; result: GovernanceResolution['result'] }>(`/resolutions/${encodeURIComponent(resolutionId)}/close`, { token, method: 'POST', body: JSON.stringify(societyId ? { societyId } : {}) });
}

export function finalizeGovernanceResolution(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ resolutionId: string; status: string; result: GovernanceResolution['result']; proof: { status: string; errorCode?: string; retryAvailable?: boolean } }>(`/resolutions/${encodeURIComponent(resolutionId)}/finalize`, { token, method: 'POST', body: JSON.stringify(societyId ? { societyId } : {}) });
}

export function retryGovernanceResolutionProof(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ status: string; errorCode?: string; retryAvailable?: boolean }>(`/resolutions/${encodeURIComponent(resolutionId)}/proof`, { token, method: 'POST', body: JSON.stringify(societyId ? { societyId } : {}) });
}

export function getGovernanceResolutionProof(token: string, resolutionId: string, societyId?: string) {
  return apiRequest<{ status: string; errorCode?: string; transactionHash?: string; blockNumber?: number } | null>(scopedPath(`/resolutions/${encodeURIComponent(resolutionId)}/proof`, societyId), { token });
}
