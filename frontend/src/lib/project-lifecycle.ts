import { apiBlobRequest, apiRequest } from './api';

export type ProjectEvidence = { _id: string; fileName: string; fileType: string; fileSize: number; fileHash: string; category: 'PROGRESS_PHOTO' | 'AFTER_PHOTO'; createdAt: string };
export type ProjectUpdateRecord = { _id: string; projectId: string; kind: 'PROGRESS' | 'COMPLETION'; title: string; description: string; invoiceReference?: string; createdBy: string; createdAt: string; evidence: ProjectEvidence[] };
export type ProjectExpense = { _id: string; projectId: string; budgetId: string; budgetCategoryId: string; vendorId?: string; title: string; amount: string; description?: string; invoiceReference?: string; expenseDate: string; createdAt: string };
export type ProjectSpendSummary = { projectId: string; approvedCost: string | null; totalSpent: string; remainingBudget: string | null; overrun: boolean };
export type ExpenseCollection = { items: ProjectExpense[]; projects: ProjectSpendSummary[] };

export function listProjectUpdates(projectId: string, token: string) {
  return apiRequest<ProjectUpdateRecord[]>(`/projects/${encodeURIComponent(projectId)}/updates`, { token });
}
export function createProjectUpdate(projectId: string, input: { kind: 'PROGRESS' | 'COMPLETION'; title: string; description: string; invoiceReference?: string }, token: string) {
  return apiRequest<Omit<ProjectUpdateRecord, 'evidence'>>(`/projects/${encodeURIComponent(projectId)}/updates`, { method: 'POST', token, body: JSON.stringify(input) });
}
export function uploadProjectEvidence(updateId: string, file: File, category: 'PROGRESS_PHOTO' | 'AFTER_PHOTO', token: string) {
  return apiRequest<ProjectEvidence>(`/evidence/upload?projectUpdateId=${encodeURIComponent(updateId)}&category=${category}`, { method: 'POST', token, headers: { 'Content-Type': 'application/octet-stream' }, body: file });
}
export function downloadProjectEvidence(evidenceId: string, token: string) {
  return apiBlobRequest(`/evidence/${encodeURIComponent(evidenceId)}`, { token });
}
export function startProject(projectId: string, token: string) {
  return apiRequest<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/start`, { method: 'POST', token });
}
export function completeProject(projectId: string, input: { completionUpdateId: string; finalCost: string }, token: string) {
  return apiRequest<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/complete`, { method: 'POST', token, body: JSON.stringify(input) });
}
export function listProjectExpenses(projectId: string, token: string) {
  return apiRequest<ExpenseCollection>(`/expenses?projectId=${encodeURIComponent(projectId)}`, { token });
}
export function createProjectExpense(input: { projectId: string; budgetCategoryId: string; title: string; amount: string; expenseDate: string; invoiceReference?: string; vendorId?: string }, token: string) {
  return apiRequest<ProjectExpense>('/expenses', { method: 'POST', token, body: JSON.stringify(input) });
}
