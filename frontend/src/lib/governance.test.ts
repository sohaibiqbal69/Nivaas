import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEligibilitySnapshot, createGovernanceMeeting, createGovernanceResolution, listGovernanceMeetings, listGovernanceResolutions, updateApprovalThreshold } from './governance';

describe('governance API helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses society-scoped reads and the authenticated session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    await listGovernanceMeetings('session', 'society/a');
    await listGovernanceResolutions('session');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/meetings?societyId=society%2Fa', '/api/resolutions',
    ]);
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer session');
  });

  it('submits meeting and resolution drafts using only the documented API paths', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { _id: 'draft-1' } }), { status: 201 }));
    const meeting = { type: 'AGM' as const, title: 'Annual meeting', scheduledAt: '2026-11-01T10:00:00.000Z' };
    const resolution = { meetingId: 'meeting-1', ruleVersionId: 'rule-1', resolutionType: 'PROJECT_APPROVAL', decisionBody: 'GENERAL_BODY', votingMethod: 'BALLOT', title: 'Repair proposal', votingStart: '2026-11-01T10:00:00.000Z', votingEnd: '2026-11-01T11:00:00.000Z' };
    await createGovernanceMeeting('session', meeting);
    await createGovernanceResolution('session', resolution);
    await createEligibilitySnapshot('session', 'resolution-1');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/meetings', '/api/resolutions', '/api/resolutions/resolution-1/eligibility-snapshot',
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(meeting);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(resolution);
  });

  it('saves threshold changes through the society-rule API without inventing a separate client-side value', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { versionNumber: 2, policyProof: { status: 'PENDING' } } }), { status: 201 }));
    await updateApprovalThreshold('manager-session', { threshold: '125000', supportingDocumentReference: 'minutes-2026-01' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/society/rules/approval-threshold');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((request.headers as Headers).get('Authorization')).toBe('Bearer manager-session');
    expect(JSON.parse(String(request.body))).toEqual({ threshold: '125000', supportingDocumentReference: 'minutes-2026-01' });
  });
});
