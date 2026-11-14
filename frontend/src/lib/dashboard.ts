export type DashboardRole = 'SYSTEM_ADMIN' | 'SOCIETY_MANAGER' | 'COMMITTEE_MEMBER' | 'OWNER_MEMBER' | 'RESIDENT' | string;

export const ACTIVE_PROJECT_REVIEW_STATES = new Set([
  'APPROVAL_REQUIRED', 'COMMITTEE_APPROVAL', 'SGM_REQUIRED', 'RE_APPROVAL',
]);

export const DASHBOARD_RESOURCE_KEYS = {
  SYSTEM_ADMIN: ['societies', 'users'],
  SOCIETY_MANAGER: ['projects', 'budgets', 'complaints', 'notices', 'meetings', 'resolutions'],
  COMMITTEE_MEMBER: ['projects', 'committeeApprovals', 'notices', 'resolutions'],
  OWNER_MEMBER: ['projects', 'budgets', 'complaints', 'notices', 'resolutions'],
  RESIDENT: ['projects', 'complaints', 'notices', 'resolutions'],
} as const;

export function dashboardResourceKeys(role: DashboardRole | undefined): readonly string[] {
  if (!role || !Object.hasOwn(DASHBOARD_RESOURCE_KEYS, role)) return [];
  return DASHBOARD_RESOURCE_KEYS[role as keyof typeof DASHBOARD_RESOURCE_KEYS];
}

export type DashboardVoteResult = { state: 'eligible'; vote: { vote: 'YES' | 'NO' | 'ABSTAIN'; castAt: string } | null } | { state: 'ineligible' | 'error' };

export function getPendingVoteResolutions<T extends { _id: string; status: string }>(resolutions: readonly T[], votes: Readonly<Record<string, DashboardVoteResult>>): T[] {
  return resolutions.filter((resolution) => {
    const result = votes[resolution._id];
    return resolution.status === 'OPEN' && result?.state === 'eligible' && result.vote === null;
  });
}

export function getCommitteeReviewProjects<T extends { status: string; approvalType?: string }>(projects: readonly T[]): T[] {
  return projects.filter((project) => ACTIVE_PROJECT_REVIEW_STATES.has(project.status) && project.approvalType === 'COMMITTEE_APPROVAL');
}

export function getLatestApprovedBudget<T extends { status: string }>(budgets: readonly T[]): T | null {
  return budgets.find((budget) => budget.status === 'APPROVED') ?? null;
}

export function getUpcomingMeetings<T extends { status: string; scheduledAt: string }>(meetings: readonly T[], now = Date.now()): T[] {
  return meetings.filter((meeting) => meeting.status === 'PUBLISHED' && Date.parse(meeting.scheduledAt) >= now)
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
}

