import { apiRequest } from './api';

export type AuditLogSummary = {
  _id: string;
  societyId: string | null;
  action: string;
  eventTitle?: string;
  relatedTitle?: string;
  entityType?: string;
  entityId?: string | null;
  recordHash: string;
  integrity?: { status: 'valid' | 'invalid' | 'unsupported' | string };
  createdAt: string;
};

export type ProofVerification = {
  auditLogId: string;
  societyId?: string;
  recordIntegrity?: boolean;
  recordReference?: string;
  proofStatus: 'UNKNOWN' | 'PENDING' | 'CONFIRMED' | 'CONFLICT' | 'NOT_VERIFIED' | string;
  verified: boolean;
  chainId?: string;
  contractAddress?: string;
  transactionHash?: string;
  blockNumber?: number;
  receiptStatus?: number;
};

export type ProofOperationStatus = {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | string;
  transactionHash?: string;
  lastErrorCode?: string;
  chainId?: string;
  contractAddress?: string;
  deploymentTransactionHash?: string;
  activeDeployment?: { chainId: string; contractAddress: string; deploymentTransactionHash: string };
  attempts?: Array<{ transactionHash?: string; status?: string }>;
};

export function listAuditLogs(token: string, filters: { page?: number; pageSize?: number; search?: string; from?: string; to?: string } = {}) {
  const query = new URLSearchParams();
  query.set('page', String(filters.page ?? 1));
  query.set('pageSize', String(filters.pageSize ?? 50));
  for (const key of ['search', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  return apiRequest<AuditLogSummary[]>(`/audit?${query.toString()}`, { token });
}

export function getAuditLogById(auditLogId: string, token: string) {
  return apiRequest<AuditLogSummary>(`/audit/events/${encodeURIComponent(auditLogId)}`, { token });
}

export function getAuditLogProofStatus(auditLogId: string, token: string) {
  return apiRequest<ProofOperationStatus | null>(`/blockchain/audit-logs/${encodeURIComponent(auditLogId)}/proof`, { token });
}

export function verifyAuditLogProof(auditLogId: string, token: string) {
  return apiRequest<ProofVerification>(`/blockchain/verify/audit-logs/${encodeURIComponent(auditLogId)}`, { token });
}

export function submitAuditLogProof(auditLogId: string, token: string) {
  return apiRequest<ProofOperationStatus>(`/blockchain/audit-logs/${encodeURIComponent(auditLogId)}/proof`, { method: 'POST', token });
}
