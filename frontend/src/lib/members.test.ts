import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api';
import { createSocietyBuilding, createSocietyFlat, createSocietyMembership, createSocietyUser, listSocietyFlats, listSocietyUsers, listSocietyBuildings } from './members';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, apiRequest: vi.fn() };
});

describe('society onboarding API helpers', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses a manager-scoped user search and society-filtered flat query', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await listSocietyUsers('manager-token', 'Ravi + 101');
    await listSocietyFlats('manager-token', 'society-1');
    await listSocietyBuildings('manager-token', 'society-1');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/users/society?search=Ravi%20%2B%20101', { token: 'manager-token' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/flats?societyId=society-1', { token: 'manager-token' });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/buildings?societyId=society-1', { token: 'manager-token' });
  });

  it('sends membership fields through the existing authenticated API', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ _id: 'membership-1' });
    await createSocietyMembership({ societyId: 'society-1', userId: 'user-1', unitId: 'flat-1', membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' }, 'manager-token');
    expect(apiRequest).toHaveBeenCalledWith('/memberships', expect.objectContaining({
      method: 'POST', token: 'manager-token',
      body: JSON.stringify({ societyId: 'society-1', userId: 'user-1', unitId: 'flat-1', membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' }),
    }));
  });

  it('creates a flat using the persisted building ID and preserves a leading-zero flat number as text', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ _id: 'flat-1', flatNumber: '002' });
    await createSocietyFlat({ buildingId: 'building-1', flatNumber: '002', status: 'ACTIVE' }, 'manager-token');
    expect(apiRequest).toHaveBeenCalledWith('/flats', expect.objectContaining({
      method: 'POST', token: 'manager-token', body: JSON.stringify({ buildingId: 'building-1', flatNumber: '002', status: 'ACTIVE' }),
    }));
  });

  it('creates a System Admin building without sending a blank optional code', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ _id: 'building-1', societyId: 'society-1', name: 'North Wing' });
    await createSocietyBuilding({ societyId: 'society-1', name: 'North Wing' }, 'admin-token');
    expect(apiRequest).toHaveBeenCalledWith('/buildings', {
      method: 'POST', token: 'admin-token',
      body: JSON.stringify({ societyId: 'society-1', name: 'North Wing', status: 'ACTIVE' }),
    });
  });

  it('creates a restricted society account without accepting caller-selected society or password fields', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ _id: 'user-1', role: 'RESIDENT', status: 'PENDING_SETUP', setupCredential: 'one-time' });
    await createSocietyUser({ name: 'Resident', email: 'resident@example.test', role: 'RESIDENT' }, 'manager-token');
    expect(apiRequest).toHaveBeenCalledWith('/users/society', expect.objectContaining({
      method: 'POST', token: 'manager-token',
      body: JSON.stringify({ name: 'Resident', email: 'resident@example.test', role: 'RESIDENT' }),
    }));
  });
});
