import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { GovernancePage } from './GovernancePage';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listGovernanceMeetings: vi.fn(),
  listGovernanceResolutions: vi.fn(),
  getMyGovernanceVote: vi.fn(),
  getGovernanceResolutionProof: vi.fn(),
  getActiveGovernanceRule: vi.fn(),
  castGovernanceVote: vi.fn(),
  listProjects: vi.fn(),
  publishGovernanceMeeting: vi.fn(),
  getCommitteeApproval: vi.fn(),
  recordCommitteeDecision: vi.fn(),
  finalizeCommitteeApproval: vi.fn(),
  getProjectApprovalHistory: vi.fn(),
  getOfflineEligibleAttendees: vi.fn(),
  recordOfflineGovernanceDecision: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/governance', () => ({
  listGovernanceMeetings: mocks.listGovernanceMeetings,
  listGovernanceResolutions: mocks.listGovernanceResolutions,
  getMyGovernanceVote: mocks.getMyGovernanceVote,
  getGovernanceResolutionProof: mocks.getGovernanceResolutionProof,
  getActiveGovernanceRule: mocks.getActiveGovernanceRule,
  castGovernanceVote: mocks.castGovernanceVote,
  closeGovernanceResolution: vi.fn(),
  configureGeneralBodyStarterPolicy: vi.fn(),
  createEligibilitySnapshot: vi.fn(),
  createGovernanceMeeting: vi.fn(),
  createGovernanceResolution: vi.fn(),
  finalizeGovernanceResolution: vi.fn(),
  openGovernanceResolution: vi.fn(),
  publishGovernanceMeeting: mocks.publishGovernanceMeeting,
  retryGovernanceResolutionProof: vi.fn(),
  getOfflineEligibleAttendees: mocks.getOfflineEligibleAttendees,
  recordOfflineGovernanceDecision: mocks.recordOfflineGovernanceDecision,
}));
vi.mock('@/lib/projects', () => ({ listProjects: mocks.listProjects, getProjectApprovalHistory: mocks.getProjectApprovalHistory, getCommitteeApproval: mocks.getCommitteeApproval, recordCommitteeDecision: mocks.recordCommitteeDecision, finalizeCommitteeApproval: mocks.finalizeCommitteeApproval }));

describe('GovernancePage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let ownVote: string | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ownVote = null;
    mocks.useAuth.mockReturnValue({ user: { _id: 'member-1', societyId: 'society-1', role: 'OWNER_MEMBER' }, token: 'member-token' });
    mocks.listGovernanceMeetings.mockResolvedValue([{
      _id: 'meeting-1', societyId: 'society-1', type: 'SGM', title: 'Lift repair SGM', scheduledAt: '2026-12-01T10:00:00.000Z', status: 'PUBLISHED',
    }]);
    mocks.listGovernanceResolutions.mockResolvedValue([{
      _id: 'resolution-1', societyId: 'society-1', meetingId: 'meeting-1', resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY',
      title: 'Lift repair proposal', votingMethod: 'SHOW_OF_HANDS', votingStart: '2026-10-18T10:00:00.000Z',
      votingEnd: '2026-10-20T10:00:00.000Z', ruleVersionId: 'rule-1', eligibleVoterCount: 3, status: 'OPEN',
    }, {
      _id: 'resolution-draft', societyId: 'society-1', meetingId: 'meeting-1', resolutionType: 'OTHER', decisionBody: 'GENERAL_BODY',
      title: 'Draft resolution not opened', votingMethod: 'SHOW_OF_HANDS', votingStart: '2026-10-18T10:00:00.000Z',
      votingEnd: '2026-10-20T10:00:00.000Z', ruleVersionId: 'rule-1', status: 'DRAFT',
    }]);
    mocks.getMyGovernanceVote.mockImplementation(async () => ownVote ? { vote: ownVote, castAt: '2026-10-18T11:00:00.000Z' } : null);
    mocks.getGovernanceResolutionProof.mockResolvedValue({ status: 'UNAVAILABLE' });
    mocks.getActiveGovernanceRule.mockResolvedValue(null);
    mocks.listProjects.mockResolvedValue([]);
    mocks.getProjectApprovalHistory.mockResolvedValue([]);
    mocks.getOfflineEligibleAttendees.mockResolvedValue([{ memberId: 'member-1', displayName: 'Member One' }]);
    mocks.recordOfflineGovernanceDecision.mockResolvedValue({ status: 'APPROVED', confirmedAt: '2026-10-19T10:00:00.000Z', result: { outcome: 'APPROVED', yesCount: 1, noCount: 0, abstainCount: 0, quorumMet: true, totalVotes: 1, quorumRequired: 1 } });
    mocks.getCommitteeApproval.mockResolvedValue({ proposalVersionId: 'approval-1', participatingMembers: 0, totalCommitteeMembers: 3, approveCount: 0, rejectCount: 0, quorumRequired: 2, quorumMet: false, requiredApprovalMajority: 2, outcome: 'PENDING' });
    mocks.recordCommitteeDecision.mockResolvedValue({ proposalVersionId: 'approval-1', participatingMembers: 1, totalCommitteeMembers: 3, approveCount: 1, rejectCount: 0, quorumRequired: 2, quorumMet: false, requiredApprovalMajority: 2, outcome: 'PENDING' });
    mocks.castGovernanceVote.mockImplementation(async (_token: string, _resolutionId: string, vote: string) => { ownVote = vote; });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('keeps Meetings focused on meeting publication and associated resolution setup', async () => {
    await act(async () => root.render(<MemoryRouter><GovernancePage /></MemoryRouter>));
    expect(container.textContent).toContain('Lift repair SGM');
    expect(container.textContent).toContain('PUBLISHED');
    expect(container.textContent).toContain('Eligibility snapshot: 3 eligible members.');
    expect(container.textContent).toContain('Meetings');
    expect([...container.querySelectorAll('button')].map((button) => button.textContent).join(' ')).not.toContain('Vote');
  });

  it('shows the actionable server notice-period conflict instead of silently returning to draft state', async () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    mocks.listGovernanceMeetings.mockResolvedValue([{
      _id: 'meeting-1', societyId: 'society-1', type: 'SGM', title: 'Notice-period conflict', scheduledAt: '2026-12-01T10:00:00.000Z', status: 'DRAFT',
    }]);
    mocks.publishGovernanceMeeting.mockRejectedValue(new Error('This meeting has 2 clear notice days, but the active society rule requires 5. Issue the notice earlier or choose a later meeting date, then retry. The configured rule cannot be bypassed.'));
    await act(async () => root.render(<MemoryRouter><GovernancePage embedded /></MemoryRouter>));
    const fields = [...container.querySelectorAll('label')];
    const setInput = (labelText: string, value: string) => {
      const input = fields.find(label => label.textContent?.includes(labelText))?.querySelector('input');
      expect(input).toBeTruthy();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      return input!;
    };
    await act(async () => {
      setInput('Official notice reference', 'SGM-001');
      setInput('Notice issued at', '2026-11-28T10:00');
    });
    const publish = [...container.querySelectorAll('button')].find(button => button.textContent === 'Publish meeting');
    await act(async () => {
      publish?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.publishGovernanceMeeting).toHaveBeenCalledWith('manager-token', 'meeting-1', expect.objectContaining({ noticeReference: 'SGM-001' }));
    expect(container.textContent).toContain('Issue the notice earlier or choose a later meeting date');
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Publish meeting')).toBe(true);
  });

  it('shows only opened resolutions in Voting and records the authenticated member vote state', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T12:00:00.000Z'));
    await act(async () => root.render(<MemoryRouter><GovernancePage view="voting" /></MemoryRouter>));
    expect(container.textContent).toContain('Lift repair proposal');
    expect(container.textContent).not.toContain('Draft resolution not opened');
    expect(container.textContent).toContain('Eligibility snapshot: 3 eligible members.');
    const yesButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Vote YES');
    expect(yesButton).toBeDefined();
    await act(async () => yesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mocks.castGovernanceVote).toHaveBeenCalledWith('member-token', 'resolution-1', 'YES', undefined);
    expect(container.textContent).toContain('Your recorded vote: YES');
    expect(container.textContent).toContain('Lift repair SGM · SGM · PUBLISHED');
  });

  it('renders separate committee quorum and majority status for committee members', async () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'committee-1', societyId: 'society-1', role: 'COMMITTEE_MEMBER' }, token: 'committee-token' });
    mocks.listProjects.mockResolvedValue([{ _id: 'project-1', societyId: 'society-1', title: 'Lift repair', category: 'Maintenance', estimatedCost: '50000', status: 'COMMITTEE_APPROVAL', approvalType: 'COMMITTEE_APPROVAL', description: '', proposedBy: 'owner-1', createdAt: '', updatedAt: '' }]);
    mocks.getCommitteeApproval.mockResolvedValue({ proposalVersionId: 'approval-1', participatingMembers: 1, totalCommitteeMembers: 3, approveCount: 1, rejectCount: 0, quorumRequired: 2, quorumMet: false, requiredApprovalMajority: 2, outcome: 'PENDING' });
    await act(async () => root.render(<MemoryRouter><GovernancePage view="voting" /></MemoryRouter>));
    expect(container.textContent).toContain('Committee project decisions');
    expect(container.textContent).toContain('quorum not met (2 required)');
    expect(container.textContent).toContain('required approval majority 2');
    expect(container.textContent).toContain('Proposal version approval-1');
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Record approve')).toBe(true);
  });

  it('explains when the backend reports that the authenticated member is ineligible', async () => {
    mocks.getMyGovernanceVote.mockRejectedValue(new ApiError({ code: 'INELIGIBLE_VOTER', message: 'Membership is not eligible under this resolution snapshot.', status: 403 }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T12:00:00.000Z'));
    await act(async () => root.render(<MemoryRouter><GovernancePage view="voting" /></MemoryRouter>));
    expect(container.textContent).toContain('Membership is not eligible under this resolution snapshot.');
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Vote YES')).toBe(false);
  });

  it('offers manager-confirmed offline recording for a snapshotted SGM and displays the backend result', async () => {
    mocks.useAuth.mockReturnValue({ user: { _id: 'manager-1', societyId: 'society-1', role: 'SOCIETY_MANAGER' }, token: 'manager-token' });
    mocks.listGovernanceResolutions.mockResolvedValue([{
      _id: 'offline-1', societyId: 'society-1', meetingId: 'meeting-1', resolutionType: 'PROJECT_APPROVAL', decisionBody: 'GENERAL_BODY', title: 'Offline lift vote', votingMethod: 'SHOW_OF_HANDS', votingStart: '2026-10-18T10:00:00.000Z', votingEnd: '2026-10-20T10:00:00.000Z', ruleVersionId: 'rule-1', eligibilitySnapshotId: 'snapshot-1', status: 'DRAFT',
    }]);
    await act(async () => root.render(<MemoryRouter><GovernancePage view="voting" /></MemoryRouter>));
    expect(container.textContent).toContain('Offline lift vote');
    const open = [...container.querySelectorAll('button')].find(button => button.textContent === 'Record an offline meeting decision');
    expect(open).toBeDefined();
    await act(async () => open?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('Select eligible attendees from the private snapshot');
    expect(container.textContent).toContain('Member One');
  });
});
