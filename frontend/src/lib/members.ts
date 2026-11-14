import { apiRequest } from './api';

export type SocietyBuilding = { _id: string; societyId: string; name: string; buildingCode?: string };
export function listSocietyBuildings(token: string, societyId: string) {
  return apiRequest<SocietyBuilding[]>(`/buildings?societyId=${encodeURIComponent(societyId)}`, { token });
}
export function createSocietyBuilding(input: { societyId: string; name: string; buildingCode?: string }, token: string) {
  return apiRequest<SocietyBuilding>('/buildings', {
    method: 'POST', token,
    body: JSON.stringify({ ...input, status: 'ACTIVE' }),
  });
}
export function createSocietyFlat(input: { buildingId: string; flatNumber: string; status: 'ACTIVE' | 'INACTIVE' }, token: string) {
  return apiRequest<SocietyFlat>('/flats', { token, method: 'POST', body: JSON.stringify(input) });
}

export type SocietyUser = {
  _id: string;
  societyId: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
};

export type CreatedSocietyUser = SocietyUser & {
  setupCredential?: string;
  setupCredentialExpiresAt?: string;
};

export type CreateSocietyUserInput = {
  name: string;
  email: string;
  phone?: string;
  role: 'OWNER_MEMBER' | 'RESIDENT' | 'COMMITTEE_MEMBER';
};

export type SocietyMembership = {
  _id: string;
  societyId: string;
  userId: string;
  unitId: string;
  membershipType: 'PRIMARY' | 'JOINT' | 'ASSOCIATE' | 'PROVISIONAL';
  membershipStatus: 'ACTIVE' | 'INACTIVE';
  membershipNumber?: string;
  validFrom?: string;
  validTo?: string;
};

export type SocietyFlat = {
  _id: string;
  societyId: string;
  buildingId: string;
  flatNumber: string;
  floor?: number;
  type?: string;
  status: string;
};

export type FlatRelationship = {
  _id: string;
  societyId: string;
  flatId: string;
  userId: string;
  status: string;
  startDate?: string;
  endDate?: string;
  ownershipType?: string;
  ownershipOrder?: number;
  occupancyType?: string;
};

export function listSocietyUsers(token: string, search = '') {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiRequest<SocietyUser[]>(`/users/society${query}`, { token });
}

export function createSocietyUser(input: CreateSocietyUserInput, token: string) {
  return apiRequest<CreatedSocietyUser>('/users/society', { method: 'POST', token, body: JSON.stringify(input) });
}

export function listSocietyMemberships(token: string, societyId: string) {
  return apiRequest<SocietyMembership[]>(`/memberships?societyId=${encodeURIComponent(societyId)}`, { token });
}

export function listSocietyFlats(token: string, societyId: string) {
  return apiRequest<SocietyFlat[]>(`/flats?societyId=${encodeURIComponent(societyId)}`, { token });
}

export function createSocietyMembership(input: {
  societyId: string;
  userId: string;
  unitId: string;
  membershipType: SocietyMembership['membershipType'];
  membershipStatus: SocietyMembership['membershipStatus'];
}, token: string) {
  return apiRequest<SocietyMembership>('/memberships', { method: 'POST', token, body: JSON.stringify(input) });
}

export function listFlatOwnerships(flatId: string, token: string) {
  return apiRequest<FlatRelationship[]>(`/flats/${encodeURIComponent(flatId)}/ownerships`, { token });
}

export function listFlatResidents(flatId: string, token: string) {
  return apiRequest<FlatRelationship[]>(`/flats/${encodeURIComponent(flatId)}/residents`, { token });
}

export function createOwnership(flatId: string, input: {
  userId: string; ownershipType: string; ownershipOrder?: number; status: string; startDate?: string; endDate?: string;
}, token: string) {
  return apiRequest<FlatRelationship>(`/flats/${encodeURIComponent(flatId)}/ownerships`, { method: 'POST', token, body: JSON.stringify(input) });
}

export function createResidence(flatId: string, input: {
  userId: string; occupancyType: string; status: string; startDate?: string; endDate?: string;
}, token: string) {
  return apiRequest<FlatRelationship>(`/flats/${encodeURIComponent(flatId)}/residents`, { method: 'POST', token, body: JSON.stringify(input) });
}
