import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuditLogById, getAuditLogProofStatus, listAuditLogs, submitAuditLogProof, verifyAuditLogProof } from './blockchain';

describe('AuditLog proof API helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads authorized AuditLog records and verifies a selected record with the bearer session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [{ _id: 'audit-id', societyId: 'society-id', action: 'PROJECT_SUBMITTED', recordHash: '0xabc', createdAt: '2026-10-18T00:00:00.000Z' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { auditLogId: 'audit-id', proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true } }), { status: 200 }));

    await expect(listAuditLogs('session-token')).resolves.toHaveLength(1);
    await expect(verifyAuditLogProof('audit-id', 'session-token')).resolves.toMatchObject({ proofStatus: 'UNKNOWN', verified: false });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/audit?page=1&pageSize=50', '/api/blockchain/verify/audit-logs/audit-id']);
    expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('uses the existing proof status and submission endpoints without treating a pending result as confirmed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { status: 'PENDING' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { status: 'PENDING' } }), { status: 202 }));

    await expect(getAuditLogProofStatus('audit-id', 'token')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(submitAuditLogProof('audit-id', 'token')).resolves.toMatchObject({ status: 'PENDING' });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('supports the backend audit filters and pagination contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    await listAuditLogs('token', { page: 2, pageSize: 25, search: 'cctv', from: '2026-10-01T00:00:00.000Z' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/audit?page=2&pageSize=25&search=cctv&from=2026-10-01T00%3A00%3A00.000Z');
  });

  it('retrieves a directly linked historical AuditLog without relying on the current page', async () => {
    const historical = { _id: 'older-event', societyId: 'society-id', action: 'PROJECT_SUBMITTED', recordHash: '0xabc', createdAt: '2023-04-05T06:07:08.000Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: historical }), { status: 200 }));
    await expect(getAuditLogById('older/event', 'session-token')).resolves.toMatchObject({ _id: 'older-event', createdAt: historical.createdAt });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/audit/events/older%2Fevent');
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get('Authorization')).toBe('Bearer session-token');
  });
});
