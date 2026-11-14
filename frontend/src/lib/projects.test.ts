import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, evaluateProjectApproval, getProjectApprovalHistory, listMyPendingCommitteeApprovals, listProjectDiscovery, listProjects, submitProjectForReview } from './projects';

describe('project API integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads the society-scoped project collection with the authenticated token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    );

    await expect(listProjects('session-token')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects?page=1&pageSize=25', expect.objectContaining({
      headers: expect.any(Headers),
    }));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('uses the existing create, submit, and approval-evaluation workflow endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      const data = path.endsWith('/submit-for-approval')
        ? { approvalType: 'COMMITTEE_APPROVAL', requiredDecisionBody: 'COMMITTEE', evaluatedAmount: '2500', threshold: '100000', ruleVersionId: 'rule-v1', status: 'REQUIRED' }
        : { _id: 'project-1', societyId: 'society-1', title: 'Lift repair', description: 'Repair', category: 'Maintenance', estimatedCost: '2500', status: path.endsWith('/submit') ? 'SUBMITTED' : 'DRAFT', proposedBy: 'manager-1', createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    });
    const input = { societyId: 'society-1', title: 'Lift repair', description: 'Repair', category: 'Maintenance', estimatedCost: '2500' };

    await expect(createProject(input, 'token')).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(submitProjectForReview('project/1', 'token')).resolves.toMatchObject({ status: 'SUBMITTED' });
    await expect(evaluateProjectApproval('project-1', 'token')).resolves.toMatchObject({ approvalType: 'COMMITTEE_APPROVAL' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/projects',
      '/api/projects/project%2F1/submit',
      '/api/projects/project-1/submit-for-approval',
    ]);
  });

  it('uses the society-scoped project list endpoint for the read-only discovery summary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      success: true,
      data: [{ _id: 'project-1', title: 'Lift repair', category: 'Maintenance', status: 'SUBMITTED', createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' }],
    }), { status: 200 }));
    await expect(listProjectDiscovery('owner-token')).resolves.toMatchObject([{ _id: 'project-1', title: 'Lift repair', status: 'SUBMITTED' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects?page=1&pageSize=25', expect.objectContaining({ headers: expect.any(Headers) }));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer owner-token');
  });

  it('loads only committee decisions that the authenticated committee member may still record', async () => {
    const records = [{ projectId: 'project-1', approvalDecisionId: 'decision-1', title: 'Lift repair', status: 'COMMITTEE_APPROVAL', updatedAt: '2026-10-18T00:00:00.000Z' }];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: records }), { status: 200 }));
    await expect(listMyPendingCommitteeApprovals('committee-token')).resolves.toEqual(records);
    expect(fetchMock).toHaveBeenCalledWith('/api/committee-approvals/pending-for-me', expect.objectContaining({ headers: expect.any(Headers) }));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer committee-token');
  });

  it('loads the existing project approval-evaluation history without inventing a decision endpoint', async () => {
    const history = [{
      _id: 'evaluation-1', projectId: 'project-1', approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM',
      evaluatedAmount: '125000', threshold: '100000', ruleVersionId: 'rule-v2', status: 'REQUIRED',
      evaluatedAt: '2026-10-18T00:00:00.000Z',
    }];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: history }), { status: 200 }));
    await expect(getProjectApprovalHistory('project/1', 'manager-token')).resolves.toEqual(history);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project%2F1/approval-history', expect.objectContaining({ headers: expect.any(Headers) }));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer manager-token');
  });
});
