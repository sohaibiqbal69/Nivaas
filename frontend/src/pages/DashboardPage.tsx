import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, Landmark, RefreshCw, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMotion } from '@/hooks/usePageMotion';
import { useAuth } from '@/contexts/AuthContext';
import { listAdminUsers, listSocieties, type AdminUserRecord, type SocietyRecord } from '@/lib/administration';
import { ApiError, apiRequest } from '@/lib/api';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { ProgressTrack } from '@/components/ui/ProgressTrack';
import { navigationItems } from '@/routes/navigation';
import { listMyPendingCommitteeApprovals, listProjects, listProjectDiscovery, type PendingCommitteeApproval, type ProjectDiscoveryRecord, type ProjectRecord } from '@/lib/projects';
import { listComplaints, type ComplaintPage } from '@/lib/complaints';
import { listNotices, type NoticeList } from '@/lib/notices';
import { getMyGovernanceVote, listGovernanceMeetings, listGovernanceResolutions, type GovernanceMeeting, type GovernanceResolution } from '@/lib/governance';
import { dashboardResourceKeys, getLatestApprovedBudget, getPendingVoteResolutions, getUpcomingMeetings, type DashboardVoteResult } from '@/lib/dashboard';
import type { BudgetRecord } from '@/lib/dashboard-types';

type DashboardData = {
  societies: SocietyRecord[];
  users: AdminUserRecord[];
  projects: Array<ProjectRecord | ProjectDiscoveryRecord>;
  committeeApprovals: PendingCommitteeApproval[];
  budgets: BudgetRecord[];
  complaints: ComplaintPage;
  notices: NoticeList;
  meetings: GovernanceMeeting[];
  resolutions: GovernanceResolution[];
};
type ResourceKey = keyof DashboardData;
type Resource<T> = { state: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; error: string | null };
type Resources = { [K in ResourceKey]: Resource<DashboardData[K]> };

const initialResources = (): Resources => ({
  societies: emptyResource(), users: emptyResource(), projects: emptyResource(), committeeApprovals: emptyResource(), budgets: emptyResource(),
  complaints: emptyResource(), notices: emptyResource(), meetings: emptyResource(), resolutions: emptyResource(),
});
function emptyResource<T>(): Resource<T> { return { state: 'idle', data: null, error: null }; }
function errorMessage(cause: unknown, fallback: string) { return cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : fallback; }
const MAX_DASHBOARD_VOTES = 8;

export function DashboardPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'SYSTEM_ADMIN';
  const [refreshKey, setRefreshKey] = useState(0);
  const [resources, setResources] = useState<Resources>(initialResources);
  const [voteResults, setVoteResults] = useState<Record<string, DashboardVoteResult>>({});
  const [votesLoading, setVotesLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setResources(initialResources());
    setVoteResults({});
    setVotesLoading(false);
    if (!token || !role) return () => { active = false; };

    async function load<K extends ResourceKey>(key: K, request: Promise<DashboardData[K]>): Promise<DashboardData[K] | null> {
      setResources((current) => ({ ...current, [key]: { state: 'loading', data: null, error: null } }));
      try {
        const data = await request;
        if (active) setResources((current) => ({ ...current, [key]: { state: 'ready', data, error: null } }));
        return data;
      } catch (cause) {
        if (active) setResources((current) => ({ ...current, [key]: { state: 'error', data: null, error: errorMessage(cause, 'This information could not be loaded.') } }));
        return null;
      }
    }

    const jobs: Array<Promise<unknown>> = [];
    const enabled = new Set(dashboardResourceKeys(role));
    if (isAdmin) {
      jobs.push(load('societies', listSocieties(token)));
      jobs.push(load('users', listAdminUsers(token)));
    } else {
      if (enabled.has('projects')) jobs.push(load('projects', role === 'RESIDENT' ? listProjectDiscovery(token) : listProjects(token)));
      if (enabled.has('committeeApprovals')) jobs.push(load('committeeApprovals', listMyPendingCommitteeApprovals(token)));
      if (enabled.has('budgets')) jobs.push(load('budgets', apiRequest<BudgetRecord[]>('/budgets', { token })));
      if (enabled.has('complaints')) jobs.push(load('complaints', listComplaints(token, 1, 'OPEN')));
      if (enabled.has('notices')) jobs.push(load('notices', listNotices(token, { status: 'PUBLISHED', limit: 3 })));
      if (enabled.has('meetings')) jobs.push(load('meetings', listGovernanceMeetings(token)));

      if (enabled.has('resolutions')) {
        jobs.push((async () => {
          const resolutions = await load('resolutions', listGovernanceResolutions(token));
          if (!active || !resolutions) return;
          const open = resolutions.filter((resolution) => resolution.status === 'OPEN').slice(0, MAX_DASHBOARD_VOTES);
          if (!open.length) return;
          setVotesLoading(true);
          const entries = await Promise.all(open.map(async (resolution): Promise<[string, DashboardVoteResult]> => {
            try {
              return [resolution._id, { state: 'eligible', vote: await getMyGovernanceVote(token, resolution._id) }];
            } catch (cause) {
              return [resolution._id, cause instanceof ApiError && cause.status === 403 ? { state: 'ineligible' } : { state: 'error' }];
            }
          }));
          if (active) setVoteResults(Object.fromEntries(entries));
          if (active) setVotesLoading(false);
        })());
      }
    }
    void Promise.all(jobs);
    return () => { active = false; };
  }, [isAdmin, refreshKey, role, token]);

  const pageTitle = isAdmin ? 'Platform overview' : role === 'SOCIETY_MANAGER' ? 'Society overview'
    : role === 'COMMITTEE_MEMBER' ? 'Governance overview' : role === 'RESIDENT' ? 'Community updates' : 'Society overview';
  const pageDescription = isAdmin ? 'A current view of societies and account setup across Nivaas.'
    : role === 'SOCIETY_MANAGER' ? 'Project work, resident reports and society decisions in one place.'
      : role === 'COMMITTEE_MEMBER' ? 'Project reviews and governance decisions available to your account.'
        : role === 'OWNER_MEMBER' ? 'Project progress, approved finances and society decisions.'
          : 'Published notices, project records and the decisions available to your account.';
  const projects = resources.projects.data ?? [];
  const approvedBudget = getLatestApprovedBudget(resources.budgets.data ?? []);
  const upcomingMeetings = getUpcomingMeetings(resources.meetings.data ?? []).slice(0, 3);
  const resolutions = resources.resolutions.data ?? [];
  const pendingVotes = getPendingVoteResolutions(resolutions, voteResults);
  const openResolutions = resolutions.filter((resolution) => resolution.status === 'OPEN');
  const checkedOpenResolutions = openResolutions.slice(0, MAX_DASHBOARD_VOTES);
  const eligibleOpenResolutions = checkedOpenResolutions.filter((resolution) => voteResults[resolution._id]?.state === 'eligible');
  const voteCheckFailed = checkedOpenResolutions.some((resolution) => voteResults[resolution._id]?.state === 'error');
  const recentOutcomes = resolutions.filter((resolution) => resolution.result).slice(0, 3);
  const quickLinks = navigationItems.filter((item) => item.path !== '/dashboard' && (!item.roles || item.roles.includes(role ?? ''))).slice(0, 6);

  return (
    <div ref={pageRef} className="page-dashboard space-y-8">
      <PageHeader
        eyebrow={isAdmin ? 'Platform' : 'Society'}
        title={pageTitle}
        description={pageDescription}
        actions={<Button variant="outline" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw aria-hidden="true" size={16} />Refresh</Button>}
      />

      {isAdmin ? (
        <section aria-label="Platform records" className="grid gap-8 border-y border-foreground/15 py-6 sm:grid-cols-2">
          <PlatformSummary icon={<Landmark aria-hidden="true" size={17} />} title="Societies" resource={resources.societies} loadingLabel="Loading societies" errorTitle="Society records unavailable">
            {(records) => <Metric value={records.length} note={`${records.filter((record) => record.status === 'ACTIVE').length} active`} href="/administration/societies" action="Review societies" />}
          </PlatformSummary>
          <PlatformSummary icon={<Users aria-hidden="true" size={17} />} title="User accounts" resource={resources.users} loadingLabel="Loading user accounts" errorTitle="User accounts unavailable">
            {(records) => <Metric value={records.length} note={`${records.filter((account) => account.status === 'ACTIVE').length} active · ${records.filter((account) => account.status === 'PENDING_SETUP').length} pending setup`} href="/administration/users" action="Review accounts" />}
          </PlatformSummary>
        </section>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,.75fr)] lg:gap-14">
          <div className="min-w-0 space-y-10">
            <section aria-labelledby="projects-heading" className="space-y-4">
              <SectionHeading id="projects-heading" title="Recent project records" href="/projects" action="All projects" />
              <ResourceFeedback resource={resources.projects} loadingLabel="Loading project records" errorTitle="Project records unavailable" />
              {resources.projects.state === 'ready' && projects.length === 0 ? <p className="text-sm text-muted-foreground">No project records are available for this account yet.</p> : null}
              {resources.projects.state === 'ready' && projects.length > 0 ? <ol className="divide-y divide-border/80">
                {projects.slice(0, 5).map((project) => <li key={project._id} className="dashboard-record">
                  <Link to="/projects" className="dashboard-record-title font-semibold hover:text-primary">{project.title}</Link>
                  <span className="dashboard-record-state font-mono text-xs text-muted-foreground">{project.status.replaceAll('_', ' ')}</span>
                </li>)}
              </ol> : null}
            </section>

            {role === 'COMMITTEE_MEMBER' ? <section aria-labelledby="committee-projects-heading" className="space-y-4">
              <SectionHeading id="committee-projects-heading" title="Project decisions awaiting your vote" href="/voting" action="Review decisions" />
              <ResourceFeedback resource={resources.committeeApprovals} loadingLabel="Checking committee decisions assigned to you" errorTitle="Committee decisions unavailable" />
              {resources.committeeApprovals.state === 'ready' && resources.committeeApprovals.data?.length === 0 ? <p className="text-sm text-muted-foreground">No current committee decision is awaiting your participation.</p> : null}
              {resources.committeeApprovals.state === 'ready' && resources.committeeApprovals.data && resources.committeeApprovals.data.length > 0 ? <ol className="divide-y divide-border/80">{resources.committeeApprovals.data.slice(0, 4).map((decision) => <li key={decision.approvalDecisionId} className="dashboard-record">
                <Link to="/voting" className="dashboard-record-title font-semibold hover:text-primary">{decision.title}</Link><span className="dashboard-record-state font-mono text-xs text-muted-foreground">{decision.status.replaceAll('_', ' ')}</span>
              </li>)}</ol> : null}
            </section> : null}

            <section aria-labelledby="governance-heading" className="space-y-4">
              <SectionHeading id="governance-heading" title="Governance" href="/voting" action="Voting and decisions" />
              <ResourceFeedback resource={resources.resolutions} loadingLabel="Loading governance decisions" errorTitle="Governance records unavailable" />
              {votesLoading ? <p className="text-sm text-muted-foreground">Checking which open resolutions are available for your vote…</p> : null}
              {resources.resolutions.state === 'ready' && pendingVotes.length > 0 ? <div className="divide-y divide-border/80">
                {pendingVotes.slice(0, 4).map((resolution) => <div key={resolution._id} className="dashboard-record">
                  <Link to="/voting" className="dashboard-record-title font-semibold hover:text-primary">{resolution.title}</Link><span className="dashboard-record-state text-xs text-primary">Your vote is open</span>
                </div>)}
              </div> : null}
              {resources.resolutions.state === 'ready' && !votesLoading && pendingVotes.length === 0 && recentOutcomes.length > 0 ? <div className="divide-y divide-border/80">
                {recentOutcomes.map((resolution) => <div key={resolution._id} className="dashboard-record">
                  <Link to="/voting" className="dashboard-record-title font-semibold hover:text-primary">{resolution.title}</Link><span className="dashboard-record-state font-mono text-xs text-muted-foreground">{resolution.result?.outcome.replaceAll('_', ' ')}</span>
                </div>)}
              </div> : null}
              {resources.resolutions.state === 'ready' && !votesLoading && pendingVotes.length === 0 && eligibleOpenResolutions.length > 0 ? <p className="text-sm text-muted-foreground">Your vote is recorded for the open decisions checked here.</p> : null}
              {resources.resolutions.state === 'ready' && !votesLoading && pendingVotes.length === 0 && recentOutcomes.length === 0 && openResolutions.length === 0 ? <p className="text-sm text-muted-foreground">No open or recently decided resolutions are recorded.</p> : null}
              {resources.resolutions.state === 'ready' && !votesLoading && pendingVotes.length === 0 && openResolutions.length > 0 && eligibleOpenResolutions.length === 0 ? <p className="text-sm text-muted-foreground">{voteCheckFailed || openResolutions.length > MAX_DASHBOARD_VOTES ? 'Open decisions remain. Check Voting for the complete list and current eligibility.' : 'No open decision checked here is available for your vote.'}</p> : null}
            </section>
          </div>

          <aside className="min-w-0 space-y-9">
            {(role === 'SOCIETY_MANAGER' || role === 'OWNER_MEMBER') ? <section aria-labelledby="budget-heading" className="space-y-3">
              <SectionHeading id="budget-heading" title="Approved budget" href="/budgets" action="View budgets" />
              <ResourceFeedback resource={resources.budgets} loadingLabel="Loading budget records" errorTitle="Budget records unavailable" />
              {resources.budgets.state === 'ready' && !approvedBudget ? <p className="text-sm text-muted-foreground">No approved budget is available to this account.</p> : null}
              {approvedBudget ? <dl className="grid grid-cols-3 gap-3 border-l-2 border-primary/80 pl-4">
                <div><dt className="text-xs text-muted-foreground">Allocated</dt><dd className="mt-1 font-mono text-sm font-semibold">₹{approvedBudget.totalAllocated}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Spent</dt><dd className="mt-1 font-mono text-sm font-semibold">₹{approvedBudget.totalSpent}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Remaining</dt><dd className="mt-1 font-mono text-sm font-semibold">₹{approvedBudget.totalRemaining}</dd></div>
                <p className="col-span-3 text-xs text-muted-foreground">{approvedBudget.title} · {approvedBudget.financialYear}</p>
              </dl> : null}
              {approvedBudget ? <ProgressTrack
                className="mt-4"
                value={Number(approvedBudget.totalSpent)}
                max={Number(approvedBudget.totalAllocated)}
                label="Recorded spending relative to approved allocation"
                valueText={`₹${approvedBudget.totalSpent} spent of ₹${approvedBudget.totalAllocated} allocated`}
              /> : null}
            </section> : null}

            {(role === 'SOCIETY_MANAGER' || role === 'OWNER_MEMBER' || role === 'RESIDENT') ? <section aria-labelledby="complaints-heading" className="space-y-3">
              <SectionHeading id="complaints-heading" title={role === 'SOCIETY_MANAGER' ? 'Open complaints' : 'Your open complaints'} href="/complaints" action="View complaints" />
              <ResourceFeedback resource={resources.complaints} loadingLabel="Loading open complaints" errorTitle="Complaint records unavailable" />
              {resources.complaints.state === 'ready' ? <Metric value={resources.complaints.data?.total ?? 0} note={role === 'SOCIETY_MANAGER' ? 'Awaiting society follow-up' : 'Submitted from your account'} href="/complaints" action="Open complaint list" compact /> : null}
            </section> : null}

            <section aria-labelledby="notices-heading" className="space-y-3">
              <SectionHeading id="notices-heading" title="Published notices" href="/notices" action="Notice Board" />
              <ResourceFeedback resource={resources.notices} loadingLabel="Loading published notices" errorTitle="Notice records unavailable" />
              {resources.notices.state === 'ready' && resources.notices.data?.items.length === 0 ? <p className="text-sm text-muted-foreground">No published notices are available.</p> : null}
              {resources.notices.state === 'ready' && resources.notices.data?.items.length ? <ol className="divide-y divide-border/80">
                {resources.notices.data.items.slice(0, 3).map((notice) => <li key={notice._id} className="dashboard-notice-record">
                  <Link className="dashboard-record-title font-semibold hover:text-primary" to="/notices">{notice.title}</Link>
                  <p className="dashboard-record-meta text-xs text-muted-foreground">{notice.category.replaceAll('_', ' ')} · {notice.publishedAt ? formatDate(notice.publishedAt) : 'publication date unavailable'}</p>
                </li>)}
              </ol> : null}
            </section>

            {role === 'SOCIETY_MANAGER' ? <section aria-labelledby="meetings-heading" className="space-y-3">
              <SectionHeading id="meetings-heading" title="Upcoming meetings" href="/notices" action="Meeting notices" />
              <ResourceFeedback resource={resources.meetings} loadingLabel="Loading meeting records" errorTitle="Meeting records unavailable" />
              {resources.meetings.state === 'ready' && upcomingMeetings.length === 0 ? <p className="text-sm text-muted-foreground">No future published meetings are recorded.</p> : null}
              {resources.meetings.state === 'ready' && upcomingMeetings.length > 0 ? <ol className="divide-y divide-border/80">{upcomingMeetings.map((meeting) => <li key={meeting._id} className="flex items-start gap-2 py-3"><CalendarDays aria-hidden="true" size={16} className="mt-0.5 text-secondary" /><span><Link to="/notices" className="font-semibold hover:text-primary">{meeting.title}</Link><span className="mt-1 block text-xs text-muted-foreground">{formatDate(meeting.scheduledAt)}</span></span></li>)}</ol> : null}
            </section> : null}

          </aside>
        </div>
      )}

      <nav aria-label="Quick links" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/80 pt-4 text-sm">
        <span className="font-semibold">Quick links</span>
        {quickLinks.map((item) => <Link key={item.path} to={item.path} className="text-muted-foreground hover:text-primary">{item.label}<ArrowUpRight aria-hidden="true" className="ml-1 inline" size={13} /></Link>)}
      </nav>
    </div>
  );
}
function PlatformSummary<T>({ icon, title, resource, loadingLabel, errorTitle, children }: {
  icon: ReactNode; title: string; resource: Resource<T[]>; loadingLabel: string; errorTitle: string; children: (records: T[]) => ReactNode;
}) {
  return <section className="min-w-0">
    <h2 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>
    <ResourceFeedback resource={resource} loadingLabel={loadingLabel} errorTitle={errorTitle} />
    {resource.state === 'ready' && resource.data ? <div className="mt-4">{children(resource.data)}</div> : null}
  </section>;
}

function ResourceFeedback<T>({ resource, loadingLabel, errorTitle }: { resource: Resource<T>; loadingLabel: string; errorTitle: string }) {
  if (resource.state === 'loading') return <LoadingState label={loadingLabel} />;
  if (resource.state === 'error') return <ErrorState title={errorTitle} description={resource.error ?? 'The service did not return this information.'} />;
  return null;
}

function SectionHeading({ id, title, href, action }: { id: string; title: string; href: string; action: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-3">
    <h2 id={id} className="font-headline text-lg font-bold">{title}</h2>
    <Link to={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-secondary hover:text-primary">{action}<ArrowUpRight aria-hidden="true" size={14} /></Link>
  </div>;
}

function Metric({ value, note, href, action, compact = false }: { value: number; note: string; href: string; action: string; compact?: boolean }) {
  return <div className="flex items-end justify-between gap-3">
    <div><p className={compact ? 'font-headline text-3xl font-bold leading-none' : 'dashboard-number'}>{value}</p><p className="mt-2 text-sm text-muted-foreground">{note}</p></div>
    <Link to={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-secondary hover:text-primary">{action}<ArrowUpRight aria-hidden="true" size={14} /></Link>
  </div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
