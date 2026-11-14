import { apiRequest } from './api';

export type SocietyRecord = {
  _id: string;
  name: string;
  registrationNumber?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  financialYearStart?: string;
  financialYearEnd?: string;
  status: 'ACTIVE' | 'DISABLED' | string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSocietyInput = {
  name: string;
  registrationNumber?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  financialYearStart?: string;
  financialYearEnd?: string;
};

export type AdminUserRecord = {
  _id: string;
  societyId: string | null;
  name: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSocietyManagerInput = {
  societyId: string;
  name: string;
  email: string;
  phone?: string;
};

export type CreatedAdminUser = AdminUserRecord & {
  setupCredential?: string;
  setupCredentialExpiresAt?: string;
};

export function listSocieties(token: string) {
  return apiRequest<SocietyRecord[]>('/societies', { token });
}

export function createSociety(input: CreateSocietyInput, token: string) {
  return apiRequest<SocietyRecord>('/societies', { method: 'POST', token, body: JSON.stringify(input) });
}

export function listAdminUsers(token: string) {
  return apiRequest<AdminUserRecord[]>('/users', { token });
}

export function createSocietyManager(input: CreateSocietyManagerInput, token: string) {
  return apiRequest<CreatedAdminUser>('/users', {
    method: 'POST',
    token,
    body: JSON.stringify({ ...input, role: 'SOCIETY_MANAGER' }),
  });
}

export function reissueSetupCredential(userId: string, token: string) {
  return apiRequest<CreatedAdminUser>(`/users/${encodeURIComponent(userId)}/setup-credential`, {
    method: 'POST',
    token,
  });
}
