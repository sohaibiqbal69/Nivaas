import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChangeRequest, createQuotation, createVendor, listChangeRequests, listQuotations, listVendors, selectQuotation, submitChangeRequest } from './quotations';

describe('quotation API integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads project-scoped quotation versions and change-request history with the session token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    await expect(listQuotations('project/one', 'session-token')).resolves.toEqual([]);
    await expect(listChangeRequests('project-1', 'session-token')).resolves.toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/projects/project%2Fone/quotations', '/api/projects/project-1/change-requests',
    ]);
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('uses the existing create, select, and submit workflow endpoints and request bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { _id: 'record-1' } }), { status: 201 }));
    const quotationInput = { vendorId: '507f1f77bcf86cd799439011', amount: '2500', description: 'Lift repair' };
    const changeInput = { additionalAmount: '250', reason: 'Additional parts required' };
    await expect(createQuotation('project-1', quotationInput, 'token')).resolves.toMatchObject({ _id: 'record-1' });
    await selectQuotation('quotation-1', 'token');
    await createChangeRequest('quotation-1', changeInput, 'token');
    await submitChangeRequest('change-request-1', 'token');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/projects/project-1/quotations', '/api/quotations/quotation-1/select',
      '/api/quotations/quotation-1/change-requests', '/api/change-requests/change-request-1/submit',
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(quotationInput);
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual(changeInput);
  });

  it('loads persisted vendors by society and creates a vendor through the documented endpoint', async () => {
    const persistedVendor = { _id: '507f1f77bcf86cd799439011', societyId: '507f191e810c19729de860ea', name: 'Lift Services', status: 'ACTIVE' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const response = init?.method === 'POST' ? persistedVendor : [persistedVendor];
      return new Response(JSON.stringify({ success: true, data: response }), { status: init?.method === 'POST' ? 201 : 200 });
    });
    await expect(listVendors(persistedVendor.societyId, 'token')).resolves.toEqual([persistedVendor]);
    await expect(createVendor(persistedVendor.societyId, persistedVendor.name, 'token')).resolves.toEqual(persistedVendor);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/vendors?societyId=${persistedVendor.societyId}`, '/api/vendors',
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      societyId: persistedVendor.societyId, name: persistedVendor.name,
    });
  });
});
