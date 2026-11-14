import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, ClipboardList, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { VoteOutcomeTrack } from '@/components/governance/VoteOutcomeTrack';
import { castGovernanceVote, closeGovernanceResolution, configureGeneralBodyStarterPolicy, createEligibilitySnapshot, createGovernanceMeeting, createGovernanceResolution, finalizeGovernanceResolution, getActiveGovernanceRule, getGovernanceResolutionProof, getMyGovernanceVote, getOfflineEligibleAttendees, listGovernanceMeetings, listGovernanceResolutions, openGovernanceResolution, publishGovernanceMeeting, recordOfflineGovernanceDecision, retryGovernanceResolutionProof, type GovernanceMeeting, type GovernanceResolution, type SocietyGovernanceRule } from '@/lib/governance';
import { finalizeCommitteeApproval, getCommitteeApproval, getProjectApprovalHistory, listProjects, recordCommitteeDecision, type ApprovalEvaluation, type CommitteeApprovalSummary, type ProjectRecord } from '@/lib/projects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ApiError } from '@/lib/api';

const READ_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT']);
const WRITE_ROLES = new Set(['SOCIETY_MANAGER', 'COMMITTEE_MEMBER']);

export function GovernancePage({ view = 'meetings', embedded = false }: { view?: 'meetings' | 'voting'; embedded?: boolean }) {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canRead = Boolean(user && READ_ROLES.has(user.role));
  const canWrite = Boolean(user && WRITE_ROLES.has(user.role));
  const [meetings, setMeetings] = useState<GovernanceMeeting[] | null>(null);
  const [resolutions, setResolutions] = useState<GovernanceResolution[] | null>(null);
  const [rule, setRule] = useState<SocietyGovernanceRule | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectApprovals, setProjectApprovals] = useState<ApprovalEvaluation[]>([]);
  const [committeeApprovals, setCommitteeApprovals] = useState<Record<string, CommitteeApprovalSummary>>({});
  const [committeeRationales, setCommitteeRationales] = useState<Record<string, string>>({});
  const [resolutionProjectId, setResolutionProjectId] = useState('');
  const [meetingProjectId, setMeetingProjectId] = useState('');
  const [meetingAgenda, setMeetingAgenda] = useState('');
  const [meetingDocumentReferences, setMeetingDocumentReferences] = useState('');
  const [policyDocumentReference, setPolicyDocumentReference] = useState('');
  const [policyBusy, setPolicyBusy] = useState(false);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [noticeReference, setNoticeReference] = useState('');
  const [noticeIssuedAt, setNoticeIssuedAt] = useState('');
  const [ownVotes, setOwnVotes] = useState<Record<string, { eligible: boolean; vote?: 'YES' | 'NO' | 'ABSTAIN'; castAt?: string; eligibilityMessage?: string }>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [proofStatuses, setProofStatuses] = useState<Record<string, string>>({});
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [meetingType, setMeetingType] = useState<GovernanceMeeting['type']>('AGM');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [resolutionTitle, setResolutionTitle] = useState('');
  const [resolutionMeetingId, setResolutionMeetingId] = useState('');
  const [resolutionPolicyKey, setResolutionPolicyKey] = useState('');
  const [resolutionMethod, setResolutionMethod] = useState('');
  const [votingStart, setVotingStart] = useState('');
  const [votingEnd, setVotingEnd] = useState('');
  const [adminSocietyId, setAdminSocietyId] = useState('');

  const refresh = useCallback(async () => {
    if (!token || !canRead || (user?.role === 'SYSTEM_ADMIN' && !user.societyId && !adminSocietyId.trim())) return;
    setLoading(true);
    setError(null);
    try {
      const [meetingRecords, resolutionRecords] = await Promise.all([
        listGovernanceMeetings(token, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined),
        listGovernanceResolutions(token, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined),
      ]);
      setMeetings(meetingRecords);
      setResolutions(resolutionRecords);
      if (canWrite) {
        const records = await listProjects(token);
        setProjects(records);
        const committeeRecords = await Promise.all(records.filter(project => ['COMMITTEE_APPROVAL', 'RE_APPROVAL'].includes(project.status) && project.approvalType === 'COMMITTEE_APPROVAL').map(async project => {
          try { return [project._id, await getCommitteeApproval(project._id, token)] as const; } catch { return null; }
        }));
        setCommitteeApprovals(Object.fromEntries(committeeRecords.filter((item): item is NonNullable<typeof item> => item !== null)));
        const histories = await Promise.all(records.filter((project) => ['SGM_REQUIRED', 'RE_APPROVAL'].includes(project.status)).map(async (project) => {
          try { return await getProjectApprovalHistory(project._id, token); } catch { return []; }
        }));
        setProjectApprovals(histories.flat().filter((decision) => ['REQUIRED', 'RE_EVALUATED'].includes(decision.status) && decision.approvalType === 'SGM_REQUIRED'));
      }
      const voteStates = await Promise.all(resolutionRecords.filter((resolution) => resolution.status === 'OPEN').map(async (resolution) => {
        try { return [resolution._id, { eligible: true, ...(await getMyGovernanceVote(token, resolution._id, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined) ?? {}) }] as const; }
        catch (caught) { return [resolution._id, { eligible: false, eligibilityMessage: caught instanceof ApiError && caught.status === 403 ? caught.message : `Eligibility could not be verified: ${caught instanceof Error ? caught.message : 'the service did not respond'}` }] as const; }
      }));
      setOwnVotes(Object.fromEntries(voteStates));
      const proofStates = await Promise.all(resolutionRecords.filter((resolution) => ['APPROVED', 'REJECTED', 'NO_DECISION'].includes(resolution.status)).map(async (resolution) => {
        try { const proof = await getGovernanceResolutionProof(token, resolution._id, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined); return [resolution._id, proof?.status ?? 'NOT_SUBMITTED'] as const; }
        catch { return [resolution._id, 'UNAVAILABLE'] as const; }
      }));
      setProofStatuses(Object.fromEntries(proofStates));
      try {
        const activeRule = await getActiveGovernanceRule(token, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined);
        setRule(activeRule);
        setRuleError(null);
      } catch (caught) {
        setRule(null);
        setRuleError(caught instanceof Error ? caught.message : 'A society governance rule is unavailable.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Governance records could not be loaded.');
    } finally { setLoading(false); }
  }, [adminSocietyId, canRead, canWrite, token, user?.role, user?.societyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submitMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !user || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await createGovernanceMeeting(token, {
        type: meetingType,
        title: meetingTitle,
        scheduledAt: new Date(meetingDate).toISOString(),
        ...(meetingAgenda.trim() ? { agenda: meetingAgenda.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : {}),
        ...(meetingDocumentReferences.trim() ? { documentReferences: meetingDocumentReferences.split(/\r?\n/).map(item => item.trim()).filter(Boolean).map(item => { const separator = item.indexOf(':'); return { kind: item.slice(0, separator).trim().toUpperCase() as 'NOTICE' | 'PROPOSAL' | 'QUOTATION' | 'MINUTES' | 'SUPPORTING_EVIDENCE', reference: item.slice(separator + 1).trim() }; }) } : {}),
        ...(meetingProjectId ? { projectId: meetingProjectId } : {}),
        ...(user.role === 'SYSTEM_ADMIN' ? { societyId: adminSocietyId } : {}),
      });
      setMeetingTitle('');
      setMeetingDate('');
      setMeetingAgenda('');
      setMeetingDocumentReferences('');
      setMeetingProjectId('');
      setNotice('Meeting draft saved by Nivaas. It has not been issued as an official notice.');
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'The meeting draft was not saved.');
    } finally { setSaving(false); }
  }

  async function snapshot(resolutionId: string) {
    if (!token) return;
    setSnapshotBusy(resolutionId);
    setNotice(null);
    try {
      const result = await createEligibilitySnapshot(token, resolutionId, user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined);
      setNotice(`Eligibility snapshot recorded for ${result.eligibleCount} configured membership accounts. The voter list remains private to the backend.`);
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Eligibility evidence could not be recorded.');
    } finally { setSnapshotBusy(null); }
  }

  const configuredPolicies = rule?.governancePolicy?.confirmationState === 'CONFIRMED'
    ? rule.governancePolicy.decisionPolicies ?? [] : [];
  const draftablePolicies = configuredPolicies.filter((policy) => ['OTHER', 'PROJECT_APPROVAL'].includes(policy.resolutionType) && policy.decisionBody === 'GENERAL_BODY');
  const selectedPolicy = draftablePolicies.find((policy) => `${policy.resolutionType}:${policy.decisionBody}` === resolutionPolicyKey);
  const selectedApproval = projectApprovals.find((decision) => decision.projectId === resolutionProjectId);

  async function submitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !user || !rule || !selectedPolicy || saving || selectedPolicy.resolutionType === 'PROJECT_APPROVAL' && (!resolutionProjectId || !selectedApproval)) return;
    setSaving(true);
    setNotice(null);
    try {
      await createGovernanceResolution(token, {
        meetingId: resolutionMeetingId,
        ruleVersionId: rule._id,
        resolutionType: selectedPolicy.resolutionType,
        decisionBody: selectedPolicy.decisionBody,
        ...(selectedPolicy.resolutionType === 'PROJECT_APPROVAL' ? {
          projectId: resolutionProjectId,
          approvalDecisionId: selectedApproval?._id,
        } : {}),
        votingMethod: resolutionMethod,
        title: resolutionTitle,
        votingStart: new Date(votingStart).toISOString(),
        votingEnd: new Date(votingEnd).toISOString(),
        ...(user.role === 'SYSTEM_ADMIN' ? { societyId: adminSocietyId } : {}),
      });
      setResolutionTitle('');
      setNotice('Resolution draft saved using the displayed society rule version. This does not open voting or approve a project.');
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'The resolution draft was not saved.');
    } finally { setSaving(false); }
  }

  async function activateStarterPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !policyDocumentReference.trim() || policyBusy) return;
    setPolicyBusy(true); setNotice(null);
    try {
      await configureGeneralBodyStarterPolicy(token, { confirmedDocumentReference: policyDocumentReference.trim(), ...(user?.role === 'SYSTEM_ADMIN' ? { societyId: adminSocietyId } : {}) });
      setNotice('A new immutable general-body rule version is active. The document reference is society-supplied evidence; Nivaas does not certify legal applicability.');
      setPolicyDocumentReference('');
      await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The policy version was not activated.'); }
    finally { setPolicyBusy(false); }
  }

  async function recordCommitteeVote(project: ProjectRecord, decision: 'APPROVE' | 'REJECT') {
    if (!token) return;
    setActionBusy(project._id); setNotice(null);
    try {
      const result = await recordCommitteeDecision(project._id, decision, committeeRationales[project._id] ?? '', token);
      setCommitteeApprovals(current => ({ ...current, [project._id]: result }));
      setNotice(`Your ${decision.toLowerCase()} decision was recorded for proposal version ${result.proposalVersionId}.`);
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Committee decision could not be recorded.'); }
    finally { setActionBusy(null); }
  }

  async function finalizeCommittee(project: ProjectRecord) {
    if (!token) return;
    setActionBusy(project._id); setNotice(null);
    try {
      const result = await finalizeCommitteeApproval(project._id, token);
      setCommitteeApprovals(current => ({ ...current, [project._id]: result }));
      setNotice(`Committee outcome recorded by the backend: ${result.outcome}.`);
      await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Committee outcome could not be finalized.'); }
    finally { setActionBusy(null); }
  }

  async function publishMeeting(meeting: GovernanceMeeting) {
    if (!token || !noticeReference.trim() || !noticeIssuedAt) return;
    setPublishId(meeting._id); setNotice(null);
    try {
      await publishGovernanceMeeting(token, meeting._id, { noticeReference: noticeReference.trim(), noticeIssuedAt: new Date(noticeIssuedAt).toISOString(), ...(user?.role === 'SYSTEM_ADMIN' ? { societyId: adminSocietyId } : {}) });
      setNotice('Meeting published using the stored notice reference and configured clear-day rule.');
      setNoticeReference(''); setNoticeIssuedAt('');
      await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The meeting was not published.'); }
    finally { setPublishId(null); }
  }

  async function runResolutionAction(resolution: GovernanceResolution, action: 'open' | 'close' | 'finalize' | 'proof' | 'vote', vote?: 'YES' | 'NO' | 'ABSTAIN') {
    if (!token || actionBusy) return;
    setActionBusy(`${resolution._id}:${action}`); setNotice(null);
    const societyId = user?.role === 'SYSTEM_ADMIN' ? adminSocietyId : undefined;
    try {
      if (action === 'open') await openGovernanceResolution(token, resolution._id, societyId);
      if (action === 'close') await closeGovernanceResolution(token, resolution._id, societyId);
      if (action === 'finalize') {
        const result = await finalizeGovernanceResolution(token, resolution._id, societyId);
        setNotice(`Resolution finalized as ${result.status}. Blockchain proof status: ${result.proof.status}.`);
      }
      if (action === 'proof') {
        const proof = await retryGovernanceResolutionProof(token, resolution._id, societyId);
        setNotice(`Blockchain proof status: ${proof.status}${proof.errorCode ? ` (${proof.errorCode})` : ''}.`);
      }
      if (action === 'vote' && vote) {
        await castGovernanceVote(token, resolution._id, vote, societyId);
        setNotice('Your vote was recorded by the backend and is immutable under this rule version.');
      }
      if (action === 'close') setNotice('Voting closed. The server calculated the recorded outcome.');
      if (action === 'open') setNotice('Voting opened. Eligible members may now cast one recorded vote.');
      await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The governance action failed.'); }
    finally { setActionBusy(null); }
  }

  const currentTime = Date.now();
  const visibleResolutions = view === 'voting'
    ? resolutions?.filter((resolution) => ['OPEN', 'CLOSED', 'APPROVED', 'REJECTED', 'NO_DECISION'].includes(resolution.status) || (resolution.status === 'DRAFT' && user?.role === 'SOCIETY_MANAGER' && Boolean(resolution.eligibilitySnapshotId)))
    : resolutions;

  if (!canRead) return <div ref={pageRef} className="page-governance space-y-6"><PageHeader eyebrow="Society governance" title={view === 'meetings' ? 'Meetings' : 'Voting'} description="Governance records for this society." /><PermissionDeniedState /></div>;

  return (
    <div ref={pageRef} className="page-governance space-y-6">
      {!embedded ? <PageHeader eyebrow="Society governance" title={view === 'meetings' ? 'Meetings' : 'Voting'} description={view === 'meetings' ? 'Schedule and publish meetings, then prepare and open resolutions under the active society rules.' : 'Review open and finalized resolutions, cast an eligible vote, or close and finalize recorded outcomes when authorized.'} /> : null}
      <Card className="border-secondary/20 bg-secondary/5">
        <CardContent className="flex gap-3 py-4 text-sm leading-6">
          <ShieldCheck className="mt-0.5 shrink-0 text-secondary" size={19} aria-hidden="true" />
          <p>Committee project decisions, ordinary general-body resolutions, and manager-recorded offline meeting results are separate workflows. Eligibility, quorum, outcomes, and society scope are enforced by the backend. Elections and live electronic secret ballots are not available here. Configured defaults are product assumptions, not legal guarantees.</p>
        </CardContent>
      </Card>
      {notice ? <p className="rounded-md border border-border bg-card px-4 py-3 text-sm" role="status">{notice}</p> : null}
      {error ? <ErrorState title="Governance records could not be loaded" description={error} onRetry={() => void refresh()} /> : null}
      {loading && meetings === null ? <LoadingState label="Loading meetings and resolutions" /> : null}
      {loading && meetings !== null ? <p className="text-sm text-muted-foreground" role="status">Refreshing governance records…</p> : null}
      {user?.role === 'SYSTEM_ADMIN' && !user.societyId ? <label className="block max-w-lg space-y-1.5 text-sm font-medium">Society ID scope<input value={adminSocietyId} onChange={(event) => setAdminSocietyId(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3 font-mono" aria-describedby="admin-society-scope-help" /><span id="admin-society-scope-help" className="block text-xs font-normal text-muted-foreground">A valid society ID is required; platform-wide governance access is not available.</span></label> : null}

      {view === 'meetings' && canWrite && user?.role === 'SOCIETY_MANAGER' ? <Card className="task-form">
        <CardHeader><CardTitle>General-body starter policy</CardTitle><CardDescription>Creates a new immutable society rule version. The supplied reference is recorded as society-provided evidence; the system does not verify legal adoption.</CardDescription></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">Default general-body policy: active primary members; quorum is ceiling of two-thirds of that eligible population, capped at 20; simple majority means YES &gt; NO; abstentions count toward quorum; ties are no decision. Committee project approvals use a separate committee appointment and decision workflow.</p>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void activateStarterPolicy(event)}>
            <label className="flex-1 space-y-1.5 text-sm font-medium">Applicable registered society rule / document reference<input required maxLength={240} value={policyDocumentReference} onChange={(event) => setPolicyDocumentReference(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
            <Button type="submit" disabled={policyBusy || !policyDocumentReference.trim()}>{policyBusy ? 'Activating…' : 'Create policy version'}</Button>
          </form>
        </CardContent>
      </Card> : null}

      {view === 'meetings' ? <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        {canWrite && (user?.role !== 'SYSTEM_ADMIN' || adminSocietyId.trim()) ? <Card className="task-form">
          <CardHeader><CardTitle>Create a meeting draft</CardTitle><CardDescription>Saving a draft does not publish a notice or establish that notice requirements are met.</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void submitMeeting(event)}>
              <label className="block space-y-1.5 text-sm font-medium">Meeting title<input required maxLength={160} value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Meeting body<select value={meetingType} onChange={(event) => setMeetingType(event.target.value as GovernanceMeeting['type'])} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="AGM">AGM</option><option value="SGM">SGM</option><option value="COMMITTEE" disabled>Committee (not enabled)</option></select></label>
              <label className="block space-y-1.5 text-sm font-medium">Scheduled date and time<input required type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Agenda items (one per line)<textarea required value={meetingAgenda} onChange={(event) => setMeetingAgenda(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Document references (one per line: NOTICE, PROPOSAL, QUOTATION, or SUPPORTING_EVIDENCE: reference)<textarea value={meetingDocumentReferences} onChange={(event) => setMeetingDocumentReferences(event.target.value)} className="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2" /><span className="text-xs font-normal text-muted-foreground">Nivaas records references supplied by the society. Existing private uploads remain limited to supported JPEG/PNG notice scans.</span></label>
              <label className="block space-y-1.5 text-sm font-medium">Linked project (for SGM approval, if applicable)<select value={meetingProjectId} onChange={(event) => setMeetingProjectId(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">No linked project</option>{projects.filter((project) => ['SGM_REQUIRED', 'RE_APPROVAL'].includes(project.status)).map((project) => <option key={project._id} value={project._id}>{project.title} · {project.status}</option>)}</select></label>
              <Button type="submit" disabled={saving || !meetingTitle.trim() || !meetingDate || !meetingAgenda.trim()}>{saving ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" />Saving draft…</> : 'Save meeting draft'}</Button>
            </form>
          </CardContent>
        </Card> : null}

        {canWrite && (user?.role !== 'SYSTEM_ADMIN' || adminSocietyId.trim()) ? <Card className="task-form">
          <CardHeader><CardTitle>Prepare a resolution draft</CardTitle><CardDescription>Only decision types explicitly configured in a confirmed society rule version can be prepared. Drafts do not start voting.</CardDescription></CardHeader>
          <CardContent>
            {ruleError ? <p className="mb-4 text-sm text-warning" role="status">Rule configuration unavailable: {ruleError}</p> : null}
            {!ruleError && configuredPolicies.length === 0 ? <p className="mb-4 text-sm text-muted-foreground">No confirmed, decision-specific governance policy is available. Resolution creation is disabled until the society rule version is confirmed.</p> : null}
            {draftablePolicies.length > 0 ? <form className="space-y-4" onSubmit={(event) => void submitResolution(event)}>
              <label className="block space-y-1.5 text-sm font-medium">Resolution title<input required maxLength={160} value={resolutionTitle} onChange={(event) => setResolutionTitle(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Meeting<select required value={resolutionMeetingId} onChange={(event) => setResolutionMeetingId(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">Select a published meeting</option>{meetings?.filter((meeting) => meeting.status === 'PUBLISHED' && meeting.type !== 'COMMITTEE' && (selectedPolicy?.resolutionType !== 'PROJECT_APPROVAL' || meeting.projectId === resolutionProjectId)).map((meeting) => <option key={meeting._id} value={meeting._id}>{meeting.title} · {meeting.type}</option>)}</select></label>
              <label className="block space-y-1.5 text-sm font-medium">Configured decision type<select required value={resolutionPolicyKey} onChange={(event) => { setResolutionPolicyKey(event.target.value); setResolutionMethod(''); }} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">Select a confirmed policy</option>{draftablePolicies.map((policy) => <option key={`${policy.resolutionType}:${policy.decisionBody}`} value={`${policy.resolutionType}:${policy.decisionBody}`}>{policy.resolutionType.replaceAll('_', ' ')} · {policy.decisionBody.replaceAll('_', ' ')}</option>)}</select></label>
              {selectedPolicy?.resolutionType === 'PROJECT_APPROVAL' ? <>
                <label className="block space-y-1.5 text-sm font-medium">Project awaiting SGM approval<select required value={resolutionProjectId} onChange={(event) => { setResolutionProjectId(event.target.value); setResolutionMeetingId(''); }} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">Select project</option>{projects.filter((project) => projectApprovals.some((decision) => decision.projectId === project._id)).map((project) => <option key={project._id} value={project._id}>{project.title}</option>)}</select></label>
                {selectedApproval ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Current approval decision {selectedApproval._id} · {selectedApproval.approvalType} · ₹{selectedApproval.evaluatedAmount}</p> : <p className="text-xs text-muted-foreground">A current, non-invalidated SGM-required ApprovalDecision is required.</p>}
              </> : null}
              <label className="block space-y-1.5 text-sm font-medium">Configured voting method<select required value={resolutionMethod} onChange={(event) => setResolutionMethod(event.target.value)} disabled={!selectedPolicy} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">Select a method</option>{selectedPolicy?.voting?.methods?.map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select></label>
              <label className="block space-y-1.5 text-sm font-medium">Voting starts<input required type="datetime-local" value={votingStart} onChange={(event) => setVotingStart(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
              <label className="block space-y-1.5 text-sm font-medium">Voting ends<input required type="datetime-local" value={votingEnd} onChange={(event) => setVotingEnd(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
              <p className="text-xs text-muted-foreground">Rule version {rule?.versionNumber}. The backend checks that it applies to the selected meeting date.</p>
              <Button type="submit" disabled={saving || !resolutionTitle.trim() || !resolutionMeetingId || !selectedPolicy || !resolutionMethod || !votingStart || !votingEnd || selectedPolicy.resolutionType === 'PROJECT_APPROVAL' && !selectedApproval}>{saving ? 'Saving draft…' : 'Save resolution draft'}</Button>
            </form> : null}
          </CardContent>
        </Card> : null}

        <div className="space-y-5">
          <section aria-labelledby="meeting-list-title" className="space-y-3">
            <h2 id="meeting-list-title" className="flex items-center gap-2 font-headline text-xl font-bold"><CalendarDays size={19} aria-hidden="true" />Meetings</h2>
            {!loading && !error && meetings?.length === 0 ? <EmptyState title="No meeting records" description="Meeting records created for this society will appear here." /> : null}
            <div className="space-y-3">{meetings?.map((meeting) => <Card key={meeting._id} className="governance-record"><CardContent className="space-y-3 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{meeting.title}</h3><p className="mt-1 text-sm text-muted-foreground">{meeting.type} · {new Date(meeting.scheduledAt).toLocaleString()}{meeting.projectId ? ' · Project linked' : ''}</p>{meeting.noticeReference ? <p className="mt-1 text-xs text-muted-foreground">Notice reference: {meeting.noticeReference} · {meeting.noticePeriodDays} configured clear days</p> : null}{meeting.documentReferences?.length ? <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{meeting.documentReferences.map((document, index) => <li key={`${document.kind}-${index}`}>{document.kind}: {document.reference}</li>)}</ul> : null}</div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold">{meeting.status}</span></div>{meeting.status === 'DRAFT' && canWrite && meeting.type !== 'COMMITTEE' ? <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="space-y-1 text-xs font-medium">Official notice reference<input value={publishId === meeting._id ? noticeReference : noticeReference} onChange={(event) => setNoticeReference(event.target.value)} className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label><label className="space-y-1 text-xs font-medium">Notice issued at<input type="datetime-local" value={noticeIssuedAt} onChange={(event) => setNoticeIssuedAt(event.target.value)} className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label><Button type="button" className="self-end" disabled={publishId === meeting._id || !noticeReference.trim() || !noticeIssuedAt} onClick={() => void publishMeeting(meeting)}>{publishId === meeting._id ? 'Publishing…' : 'Publish meeting'}</Button></div> : null}</CardContent></Card>)}</div>
          </section>

          <section aria-labelledby="resolution-list-title" className="space-y-3">
            <h2 id="resolution-list-title" className="flex items-center gap-2 font-headline text-xl font-bold"><ClipboardList size={19} aria-hidden="true" />Resolutions</h2>
            {!loading && !error && resolutions?.length === 0 ? <EmptyState title="No resolutions yet" description="Resolution drafts appear when they are created against a meeting and a confirmed society rule version." /> : null}
            <div className="space-y-3">{resolutions?.map((resolution) => <GovernanceResolutionCard key={resolution._id} resolution={resolution} view="meetings" canWrite={canWrite} canConfirmOffline={user?.role === 'SOCIETY_MANAGER'} token={token} currentTime={currentTime} ownVote={ownVotes[resolution._id]} proofStatus={proofStatuses[resolution._id]} actionBusy={actionBusy} snapshotBusy={snapshotBusy} onAction={runResolutionAction} onSnapshot={snapshot} onOfflineRecorded={refresh} />)}</div>
          </section>
        </div>
      </div> : null}

      {view === 'voting' && canWrite ? <section aria-labelledby="committee-approvals-title" className="space-y-3">
        <h2 id="committee-approvals-title" className="font-headline text-xl font-bold">Committee project decisions</h2>
        <p className="text-sm leading-6 text-muted-foreground">Only projects currently routed to committee approval appear here. Committee member authentication and active same-society appointment are checked by the backend. Quorum is evaluated separately from the approval majority.</p>
        {projects.filter(project => ['COMMITTEE_APPROVAL', 'RE_APPROVAL'].includes(project.status) && project.approvalType === 'COMMITTEE_APPROVAL').length === 0 ? <EmptyState title="No committee decisions pending" description="Projects appear here only while their current approval route requires a committee decision." /> : null}
        <div className="space-y-3">{projects.filter(project => ['COMMITTEE_APPROVAL', 'RE_APPROVAL'].includes(project.status) && project.approvalType === 'COMMITTEE_APPROVAL').map(project => {
          const approval = committeeApprovals[project._id];
          const locked = approval?.outcome !== undefined && approval.outcome !== 'PENDING';
          return <Card key={project._id} className="governance-record"><CardContent className="space-y-3 py-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{project.title}</h3><p className="text-sm text-muted-foreground">{project.category} · ₹{project.estimatedCost} · {project.status}</p></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold">Committee approval</span></div>
            {approval ? <div className="rounded-md bg-muted px-3 py-2 text-sm"><p>Proposal version {approval.proposalVersionId}</p><p>{approval.participatingMembers}/{approval.totalCommitteeMembers} participated · quorum {approval.quorumMet ? 'met' : `not met (${approval.quorumRequired} required)`}</p><p>{approval.approveCount} approve · {approval.rejectCount} reject · required approval majority {approval.requiredApprovalMajority} · outcome {approval.outcome}</p></div> : <p className="text-sm text-muted-foreground">Committee electorate and decision status are unavailable. The committee API did not return a decision summary.</p>}
            {user?.role === 'COMMITTEE_MEMBER' ? <><label className="block text-xs font-semibold" htmlFor={`voting-committee-rationale-${project._id}`}>Rationale (optional)<textarea id={`voting-committee-rationale-${project._id}`} maxLength={2000} value={committeeRationales[project._id] ?? ''} onChange={event => setCommitteeRationales(current => ({ ...current, [project._id]: event.target.value }))} disabled={locked} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" /></label><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked || !approval || actionBusy === project._id} onClick={() => void recordCommitteeVote(project, 'APPROVE')}>Record approve</Button><Button variant="outline" disabled={locked || !approval || actionBusy === project._id} onClick={() => void recordCommitteeVote(project, 'REJECT')}>Record reject</Button></div>{locked ? <p className="text-xs text-muted-foreground">This proposal version already has a recorded outcome; decisions are immutable.</p> : null}</> : null}
            {user?.role === 'SOCIETY_MANAGER' ? <Button variant="outline" disabled={!approval?.quorumMet || locked || actionBusy === project._id} onClick={() => void finalizeCommittee(project)}>{approval?.quorumMet ? 'Finalize committee outcome' : 'Cannot finalize: quorum not met'}</Button> : null}
          </CardContent></Card>;
        })}</div>
      </section> : null}

      {view === 'voting' ? <section aria-labelledby="voting-resolutions-title" className="space-y-3">
        <h2 id="voting-resolutions-title" className="flex items-center gap-2 font-headline text-xl font-bold"><ClipboardList size={19} aria-hidden="true" />Eligible and finalized resolutions</h2>
        {!loading && !error && visibleResolutions?.length === 0 ? <EmptyState title="No resolutions ready for voting" description="Drafts appear here only after the backend has opened voting with a valid policy and eligibility snapshot. Finalized outcomes remain available for review." /> : null}
        <div className="space-y-3">{visibleResolutions?.map((resolution) => <GovernanceResolutionCard key={resolution._id} resolution={resolution} meeting={meetings?.find(meeting => meeting._id === resolution.meetingId)} view={view} canWrite={canWrite} canConfirmOffline={user?.role === 'SOCIETY_MANAGER'} token={token} currentTime={currentTime} ownVote={ownVotes[resolution._id]} proofStatus={proofStatuses[resolution._id]} actionBusy={actionBusy} snapshotBusy={snapshotBusy} onAction={runResolutionAction} onSnapshot={snapshot} onOfflineRecorded={refresh} />)}</div>
      </section> : null}
    </div>
  );
}

type ResolutionAction = (resolution: GovernanceResolution, action: 'open' | 'close' | 'finalize' | 'proof' | 'vote', vote?: 'YES' | 'NO' | 'ABSTAIN') => Promise<void>;

function GovernanceResolutionCard({
  resolution, meeting, view, canWrite, canConfirmOffline, token, currentTime, ownVote, proofStatus, actionBusy, snapshotBusy, onAction, onSnapshot, onOfflineRecorded,
}: {
  resolution: GovernanceResolution;
  meeting?: GovernanceMeeting;
  view: 'meetings' | 'voting';
  canWrite: boolean;
  canConfirmOffline: boolean;
  token: string | null;
  currentTime: number;
  ownVote?: { eligible: boolean; vote?: 'YES' | 'NO' | 'ABSTAIN'; eligibilityMessage?: string };
  proofStatus?: string;
  actionBusy: string | null;
  snapshotBusy: string | null;
  onAction: ResolutionAction;
  onSnapshot: (id: string) => Promise<void>;
  onOfflineRecorded: () => Promise<void>;
}) {
  return <Card className="governance-record"><CardContent className="space-y-3 py-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{resolution.title}</h3><p className="mt-1 text-sm text-muted-foreground">{resolution.resolutionType.replaceAll('_', ' ')} · {resolution.decisionBody.replaceAll('_', ' ')}</p></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold">{resolution.status}</span></div>
    <p className="text-xs text-muted-foreground">Voting window: {new Date(resolution.votingStart).toLocaleString()} – {new Date(resolution.votingEnd).toLocaleString()}</p>
    {meeting ? <div className="rounded-md bg-muted px-3 py-2 text-xs"><p className="font-semibold">{meeting.title} · {meeting.type} · {meeting.status}</p>{meeting.noticeReference ? <p>Notice: {meeting.noticeReference}{meeting.noticePeriodDays !== undefined ? ` · ${meeting.noticePeriodDays} configured clear days` : ''}</p> : null}{meeting.agenda?.length ? <p>Agenda: {meeting.agenda.join(' · ')}</p> : null}{meeting.documentReferences?.length ? <ul className="mt-1">{meeting.documentReferences.map((document, index) => <li key={`${document.kind}-${index}`}>{document.kind}: {document.reference}</li>)}</ul> : null}</div> : null}
    {resolution.eligibleVoterCount !== undefined ? <p className="text-xs text-muted-foreground">Eligibility snapshot: {resolution.eligibleVoterCount} eligible members.</p> : null}
    {view === 'meetings' && resolution.status === 'DRAFT' && !resolution.eligibilitySnapshotId && canWrite ? <Button type="button" variant="outline" disabled={snapshotBusy === resolution._id} onClick={() => void onSnapshot(resolution._id)}>{snapshotBusy === resolution._id ? 'Recording snapshot…' : 'Record configured eligibility snapshot'}</Button> : null}
    {['meetings', 'voting'].includes(view) && resolution.status === 'DRAFT' && resolution.eligibilitySnapshotId && canConfirmOffline && token ? <OfflineDecisionForm resolution={resolution} token={token} onRecorded={onOfflineRecorded} /> : null}
    {view === 'voting' && resolution.status === 'OPEN' && ownVote?.eligible ? ownVote.vote
      ? <p className="text-sm" role="status">Your recorded vote: <strong>{ownVote.vote}</strong></p>
      : currentTime < new Date(resolution.votingStart).getTime()
        ? <p className="text-sm text-muted-foreground" role="status">Voting opens at {new Date(resolution.votingStart).toLocaleString()}.</p>
        : currentTime >= new Date(resolution.votingEnd).getTime()
          ? <p className="text-sm text-muted-foreground" role="status">Voting has ended; the recorded result is waiting for an authorized close.</p>
          : <div className="flex flex-wrap gap-2" aria-label="Cast your vote">{(['YES', 'NO', 'ABSTAIN'] as const).map((vote) => <Button key={vote} type="button" variant={vote === 'YES' ? 'primary' : 'outline'} disabled={actionBusy !== null} onClick={() => void onAction(resolution, 'vote', vote)}>Vote {vote}</Button>)}</div> : null}
    {view === 'voting' && resolution.status === 'OPEN' && ownVote && !ownVote.eligible ? <p className="text-sm text-muted-foreground" role="status">{ownVote.eligibilityMessage ?? 'Eligibility was not confirmed by the backend.'} No vote action is available.</p> : null}
    {view === 'voting' && resolution.status === 'OPEN' && canWrite && currentTime >= new Date(resolution.votingEnd).getTime() ? <Button type="button" variant="outline" disabled={actionBusy !== null} onClick={() => void onAction(resolution, 'close')}>Close voting and calculate result</Button> : null}
    {view === 'voting' && resolution.status === 'CLOSED' && canWrite ? <Button type="button" disabled={actionBusy !== null} onClick={() => void onAction(resolution, 'finalize')}>Finalize recorded outcome</Button> : null}
    {view === 'voting' && resolution.result ? <div className="rounded-md bg-muted px-3 py-2 text-sm"><p>Result: {resolution.result.outcome} · quorum {resolution.result.quorumMet ? 'met' : 'not met'} ({resolution.result.totalVotes}/{resolution.result.quorumRequired})</p><p className="text-xs text-muted-foreground">YES {resolution.result.yesCount} · NO {resolution.result.noCount} · ABSTAIN {resolution.result.abstainCount}</p><VoteOutcomeTrack yes={resolution.result.yesCount} no={resolution.result.noCount} abstain={resolution.result.abstainCount} /><p className="mt-1 text-xs text-muted-foreground">Blockchain proof: {proofStatus ?? 'status unavailable'}</p></div> : null}
    {view === 'voting' && ['APPROVED', 'REJECTED', 'NO_DECISION'].includes(resolution.status) && canWrite && proofStatus !== 'CONFIRMED' ? <Button type="button" variant="outline" disabled={actionBusy !== null} onClick={() => void onAction(resolution, 'proof')}>Retry blockchain proof</Button> : null}
  </CardContent></Card>;
}

function OfflineDecisionForm({ resolution, token, onRecorded }: { resolution: GovernanceResolution; token: string; onRecorded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [attendees, setAttendees] = useState<Array<{ memberId: string; displayName: string }>>([]);
  const [attendance, setAttendance] = useState<string[]>([]);
  const [method, setMethod] = useState<'SHOW_OF_HANDS' | 'POLL'>('SHOW_OF_HANDS');
  const [yes, setYes] = useState(''); const [no, setNo] = useState(''); const [abstain, setAbstain] = useState('');
  const [minutes, setMinutes] = useState(''); const [evidence, setEvidence] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [recordedResult, setRecordedResult] = useState<Awaited<ReturnType<typeof recordOfflineGovernanceDecision>> | null>(null);
  useEffect(() => { if (open && attendees.length === 0) void getOfflineEligibleAttendees(token, resolution._id).then(setAttendees).catch(caught => setError(caught instanceof Error ? caught.message : 'Attendance could not be loaded.')); }, [attendees.length, open, resolution._id, token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await recordOfflineGovernanceDecision(token, resolution._id, { attendanceMemberIds: attendance, method, yesCount: Number(yes), noCount: Number(no), abstainCount: Number(abstain), minutesReference: minutes.trim(), supportingEvidenceReferences: evidence.split(/\r?\n/).map(value => value.trim()).filter(Boolean), confirm: confirmed });
      setRecordedResult(result);
      await onRecorded();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Offline decision could not be recorded.'); }
    finally { setBusy(false); }
  }
  return <div className="rounded-md border border-border p-3"><Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close offline record' : 'Record an offline meeting decision'}</Button>
    {recordedResult ? <p className="mt-2 text-sm" role="status">Offline result recorded by the backend: {recordedResult.result?.outcome ?? recordedResult.status}; {recordedResult.result?.yesCount ?? 0} yes, {recordedResult.result?.noCount ?? 0} no, {recordedResult.result?.abstainCount ?? 0} abstain; quorum {recordedResult.result?.quorumMet ? 'met' : 'not met'}.</p> : null}
    {open ? <form className="mt-4 space-y-3" onSubmit={submit}>
      <p className="text-xs leading-5 text-muted-foreground">Select eligible attendees from the private snapshot. Nivaas stores aggregate counts, not each person’s ballot.</p>
      <fieldset className="max-h-40 space-y-2 overflow-auto rounded border border-border p-3"><legend className="px-1 text-xs font-semibold">Attendance ({attendance.length})</legend>{attendees.map(member => <label key={member.memberId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attendance.includes(member.memberId)} onChange={event => setAttendance(current => event.target.checked ? [...current, member.memberId] : current.filter(id => id !== member.memberId))} />{member.displayName}</label>)}</fieldset>
      <label className="block text-xs font-medium">Voting method<select value={method} onChange={event => setMethod(event.target.value as typeof method)} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="SHOW_OF_HANDS">Show of hands</option><option value="POLL">Non-secret poll</option></select></label>
      <div className="grid grid-cols-3 gap-2">{([[yes, setYes, 'YES'], [no, setNo, 'NO'], [abstain, setAbstain, 'ABSTAIN']] as const).map(([value, setter, label]) => <label key={label} className="text-xs font-medium">{label}<input type="number" min="0" step="1" required value={value} onChange={event => setter(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm" /></label>)}</div>
      <label className="block text-xs font-medium">Minutes reference<input required maxLength={240} value={minutes} onChange={event => setMinutes(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>
      <label className="block text-xs font-medium">Supporting evidence references (one per line)<textarea required value={evidence} onChange={event => setEvidence(event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
      <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm that I am authorized to enter this result and that the attendance and counts match the meeting record.</label>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}<Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Confirm offline result'}</Button>
    </form> : null}
  </div>;
}

