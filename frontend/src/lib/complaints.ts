import { apiBlobRequest, apiRequest } from './api';

export type ComplaintInput = { title: string; description: string; category: string; priority: string };
export type ComplaintRecord = ComplaintInput & { _id: string; societyId: string; createdBy: string; status: string; createdAt: string; resolvedAt?: string };
export type ComplaintEvidence = { _id: string; fileName: string; fileType: string; fileSize: number; fileHash: string; category: string; uploadedBy: string; createdAt: string };
export type ComplaintDetail = ComplaintRecord & { updates: { _id: string; status: string; description: string; createdBy: string; createdAt: string; evidenceIds?: string[] }[]; evidence?: ComplaintEvidence[] };
export type ComplaintPage = { items: ComplaintRecord[]; page: number; total: number; limit: number };
export function listComplaints(token: string, page = 1, status = '') {
  const query = new URLSearchParams({ page: String(page), ...(status ? { status } : {}) });
  return apiRequest<ComplaintPage>(`/complaints?${query}`, { token });
}
export function getComplaint(token: string, id: string) { return apiRequest<ComplaintDetail>(`/complaints/${encodeURIComponent(id)}`, { token }); }
export function createComplaint(token: string, input: ComplaintInput) { return apiRequest<ComplaintRecord>('/complaints', { token, method: 'POST', body: JSON.stringify(input) }); }
export function updateComplaint(token: string, id: string, action: 'acknowledge' | 'update' | 'resolve', description: string) {
  return apiRequest<ComplaintRecord>(`/complaints/${encodeURIComponent(id)}/${action}`, { token, method: 'POST', body: JSON.stringify({ description }) });
}
export function uploadComplaintEvidence(token: string, id: string, category: string, file: File) {
  const query = new URLSearchParams({ complaintId: id, category });
  return apiRequest<ComplaintEvidence>(`/evidence/upload?${query}`, { token, method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
}
export function downloadComplaintEvidence(token: string, id: string) { return apiBlobRequest(`/evidence/${encodeURIComponent(id)}`, { token }); }
