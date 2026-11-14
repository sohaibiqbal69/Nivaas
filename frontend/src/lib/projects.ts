import { apiRequest } from './api';

export type ProjectRecord = {
  _id: string;
  societyId: string;
  title: string;
  description: string;
  category: string;
  estimatedCost: string;
  status: string;
  proposedBy: string;
  approvalType?: string;
  approvalStatus?: string;
  approvedCost?: string;
  finalCost?: string;
  budgetId?: string;
  vendorId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDiscoveryRecord = {
  _id: string;
  title: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  societyId: string;
  title: string;
  description: string;
  category: string;
  estimatedCost: string;
  budgetId?: string;
};

export type ApprovalEvaluation = {
  _id: string;
  projectId: string;
  approvalType: string;
  requiredDecisionBody: string;
  evaluatedAmount: string;
  threshold: string;
  ruleVersionId: string;
  status: string;
  reason?: string;
  evaluatedAt?: string;
  evaluatedBy?: string;
  ruleSnapshot?: Record<string, unknown>;
  createdAt?: string;
};

export type CommitteeApprovalSummary = {
  approvalDecisionId: string;
  proposalVersionId: string;
  totalCommitteeMembers: number;
  participatingMembers: number;
  approveCount: number;
  rejectCount: number;
  quorumRequired: number;
  quorumMet: boolean;
  requiredApprovalMajority: number;
  outcome: 'APPROVED' | 'REJECTED' | 'NO_DECISION' | 'PENDING';
  policySnapshot: Record<string, unknown>;
};

export type PendingCommitteeApproval = {
  projectId: string;
  approvalDecisionId: string;
  title: string;
  status: string;
  updatedAt: string;
};

export function listProjects(token: string) {
  return apiRequest<ProjectRecord[]>('/projects?page=1&pageSize=25', { token });
}

export function updateProject(projectId: string, input: Partial<Pick<CreateProjectInput, 'budgetId'>>, token: string) {
  return apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', token, body: JSON.stringify(input) });
}

export function listProjectDiscovery(token: string) {
  return apiRequest<ProjectDiscoveryRecord[]>('/projects?page=1&pageSize=25', { token });
}

export function createProject(input: CreateProjectInput, token: string) {
  return apiRequest<ProjectRecord>('/projects', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export function submitProjectForReview(projectId: string, token: string) {
  return apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(projectId)}/submit`, {
    method: 'POST',
    token,
  });
}

export function evaluateProjectApproval(projectId: string, token: string) {
  return apiRequest<ApprovalEvaluation>(`/projects/${encodeURIComponent(projectId)}/submit-for-approval`, {
    method: 'POST',
    token,
  });
}

export function getProjectApprovalHistory(projectId: string, token: string) {
  return apiRequest<ApprovalEvaluation[]>(`/projects/${encodeURIComponent(projectId)}/approval-history`, { token });
}

export function getCommitteeApproval(projectId: string, token: string) {
  return apiRequest<CommitteeApprovalSummary>(`/projects/${encodeURIComponent(projectId)}/committee-approval`, { token });
}

export function listMyPendingCommitteeApprovals(token: string) {
  return apiRequest<PendingCommitteeApproval[]>('/committee-approvals/pending-for-me', { token });
}

export function recordCommitteeDecision(projectId: string, decision: 'APPROVE' | 'REJECT', rationale: string, token: string) {
  return apiRequest<CommitteeApprovalSummary & { decisionId: string }>(`/projects/${encodeURIComponent(projectId)}/committee-approval/decisions`, {
    method: 'POST', token, body: JSON.stringify({ decision, ...(rationale.trim() ? { rationale: rationale.trim() } : {}) }),
  });
}

export function finalizeCommitteeApproval(projectId: string, token: string) {
  return apiRequest<CommitteeApprovalSummary & { status: string }>(`/projects/${encodeURIComponent(projectId)}/committee-approval/finalize`, { method: 'POST', token });
}
