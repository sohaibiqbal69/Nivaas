import { apiRequest } from './api';

export type QuotationRecord = {
  _id: string;
  projectId: string;
  vendorId: string;
  versionNumber: number;
  amount: string;
  description: string;
  documentEvidenceId?: string;
  status: string;
  previousQuotationId?: string;
  supersededAt?: string;
  submittedBy?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequestRecord = {
  _id: string;
  projectId: string;
  quotationId: string;
  originalAmount: string;
  additionalAmount: string;
  newAmount: string;
  reason: string;
  supportingEvidenceIds: string[];
  requestedBy: string;
  status: string;
  resultingQuotationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateQuotationInput = {
  vendorId: string;
  amount: string;
  description: string;
  documentEvidenceId?: string;
};

export type VendorRecord = { _id: string; societyId: string; name: string; companyName?: string; status: string };

export type CreateChangeRequestInput = {
  additionalAmount: string;
  reason: string;
  supportingEvidenceIds?: string[];
};

export function listVendors(societyId: string, token: string) {
  return apiRequest<VendorRecord[]>(`/vendors?societyId=${encodeURIComponent(societyId)}`, { token });
}

export function createVendor(societyId: string, name: string, token: string) {
  return apiRequest<VendorRecord>('/vendors', {
    method: 'POST', token, body: JSON.stringify({ societyId, name }),
  });
}

export function listQuotations(projectId: string, token: string) {
  return apiRequest<QuotationRecord[]>(`/projects/${encodeURIComponent(projectId)}/quotations`, { token });
}

export function listChangeRequests(projectId: string, token: string) {
  return apiRequest<ChangeRequestRecord[]>(`/projects/${encodeURIComponent(projectId)}/change-requests`, { token });
}

export function createQuotation(projectId: string, input: CreateQuotationInput, token: string) {
  return apiRequest<QuotationRecord>(`/projects/${encodeURIComponent(projectId)}/quotations`, {
    method: 'POST', token, body: JSON.stringify(input),
  });
}

export function selectQuotation(quotationId: string, token: string) {
  return apiRequest<QuotationRecord>(`/quotations/${encodeURIComponent(quotationId)}/select`, { method: 'POST', token });
}

export function createChangeRequest(quotationId: string, input: CreateChangeRequestInput, token: string) {
  return apiRequest<ChangeRequestRecord>(`/quotations/${encodeURIComponent(quotationId)}/change-requests`, {
    method: 'POST', token, body: JSON.stringify(input),
  });
}

export function submitChangeRequest(changeRequestId: string, token: string) {
  return apiRequest<ChangeRequestRecord>(`/change-requests/${encodeURIComponent(changeRequestId)}/submit`, { method: 'POST', token });
}
