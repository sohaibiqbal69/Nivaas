import { describe, expect, it } from 'vitest';
import { dashboardResourceKeys, getCommitteeReviewProjects, getLatestApprovedBudget, getPendingVoteResolutions, getUpcomingMeetings } from './dashboard';

describe('dashboard role summaries', () => {
  it('requests only platform summaries for system administrators', () => {
    expect(dashboardResourceKeys('SYSTEM_ADMIN')).toEqual(['societies', 'users']);
    expect(dashboardResourceKeys('UNRECOGNIZED_ROLE')).toEqual([]);
  });

  it('limits resident dashboard data to endpoints available to resident accounts', () => {
    expect(dashboardResourceKeys('RESIDENT')).toEqual(['projects', 'complaints', 'notices', 'resolutions']);
    expect(dashboardResourceKeys('RESIDENT')).not.toContain('budgets');
  });

  it('keeps budgets and complaint records out of the committee dashboard request plan', () => {
    expect(dashboardResourceKeys('COMMITTEE_MEMBER')).toEqual(['projects', 'committeeApprovals', 'notices', 'resolutions']);
  });

  it('selects only project records whose configured status is a committee approval route', () => {
    const projects = [
      { status: 'COMMITTEE_APPROVAL', approvalType: 'COMMITTEE_APPROVAL' },
      { status: 'IN_PROGRESS', approvalType: 'COMMITTEE_APPROVAL' },
      { status: 'RE_APPROVAL', approvalType: 'SGM_REQUIRED' },
    ];
    expect(getCommitteeReviewProjects(projects)).toEqual([projects[0]]);
  });

  it('uses an approved budget and excludes unapproved records', () => {
    const budgets = [{ title: 'Draft', status: 'DRAFT' }, { title: 'Current', status: 'APPROVED' }];
    expect(getLatestApprovedBudget(budgets)).toEqual(budgets[1]);
    expect(getLatestApprovedBudget([budgets[0]])).toBeNull();
  });

  it('marks only open resolutions with a backend-confirmed eligible empty vote as pending', () => {
    const resolutions = [{ _id: 'pending', status: 'OPEN' }, { _id: 'voted', status: 'OPEN' }, { _id: 'closed', status: 'CLOSED' }, { _id: 'unknown', status: 'OPEN' }];
    const votes = {
      pending: { state: 'eligible' as const, vote: null },
      voted: { state: 'eligible' as const, vote: { vote: 'YES' as const, castAt: '2026-10-24T00:00:00Z' } },
      closed: { state: 'eligible' as const, vote: null },
      unknown: { state: 'error' as const },
    };
    expect(getPendingVoteResolutions(resolutions, votes).map((resolution) => resolution._id)).toEqual(['pending']);
  });

  it('shows only future published meetings in chronological order', () => {
    const meetings = [
      { title: 'Later', status: 'PUBLISHED', scheduledAt: '2026-11-10T10:00:00Z' },
      { title: 'Draft', status: 'DRAFT', scheduledAt: '2026-11-02T10:00:00Z' },
      { title: 'Past', status: 'PUBLISHED', scheduledAt: '2026-10-20T10:00:00Z' },
      { title: 'Sooner', status: 'PUBLISHED', scheduledAt: '2026-11-01T10:00:00Z' },
    ];
    expect(getUpcomingMeetings(meetings, Date.parse('2026-10-24T00:00:00Z')).map((meeting) => meeting.title)).toEqual(['Sooner', 'Later']);
  });
});
