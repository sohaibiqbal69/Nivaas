import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSociety, createSocietyManager, listAdminUsers, listSocieties, reissueSetupCredential } from './administration';

describe('platform administration API helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the authenticated society list and creation endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { _id: 'society-id', name: 'Maple Court', status: 'ACTIVE', createdAt: '', updatedAt: '' } }), { status: 201 }));
    const input = { name: 'Maple Court', contactEmail: 'office@example.test' };
    await expect(createSociety(input, 'admin-token')).resolves.toMatchObject({ name: 'Maple Court', status: 'ACTIVE' });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/societies');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer admin-token');
    expect(JSON.parse(String(options.body))).toEqual(input);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    await expect(listSocieties('admin-token')).resolves.toEqual([]);
  });

  it('creates only a society manager and keeps the one-time setup credential in the immediate response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { _id: 'user-id', societyId: 'society-id', name: 'Manager', email: 'manager@example.test', role: 'SOCIETY_MANAGER', status: 'PENDING_SETUP', createdAt: '', updatedAt: '', setupCredential: 'one-time-test-value' },
    }), { status: 201 }));
    const created = await createSocietyManager({ societyId: 'society-id', name: 'Manager', email: 'manager@example.test' }, 'admin-token');
    expect(created).toHaveProperty('setupCredential', 'one-time-test-value');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ role: 'SOCIETY_MANAGER', societyId: 'society-id' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    await expect(listAdminUsers('admin-token')).resolves.toEqual([]);
  });

  it('reissues a setup credential through the authenticated pending-account endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { _id: 'user-id', societyId: 'society-id', name: 'Manager', email: 'manager@example.test', role: 'SOCIETY_MANAGER', status: 'PENDING_SETUP', createdAt: '', updatedAt: '', setupCredential: 'one-time-test-value', setupCredentialExpiresAt: '2026-10-18T12:00:00.000Z' },
    }), { status: 200 }));
    const result = await reissueSetupCredential('user-id', 'admin-token');
    expect(result).toHaveProperty('setupCredential', 'one-time-test-value');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users/user-id/setup-credential');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer admin-token');
  });
});
