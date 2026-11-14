import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Blocks, History, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { createProject, evaluateProjectApproval, finalizeCommitteeApproval, getCommitteeApproval, getProjectApprovalHistory, listProjects, recordCommitteeDecision, submitProjectForReview, updateProject, type ApprovalEvaluation, type CommitteeApprovalSummary, type ProjectRecord } from '@/lib/projects';
import { apiRequest } from '@/lib/api';
import { completeProject, createProjectExpense, createProjectUpdate, downloadProjectEvidence, listProjectExpenses, listProjectUpdates, startProject, uploadProjectEvidence, type ProjectExpense, type ProjectSpendSummary, type ProjectUpdateRecord } from '@/lib/project-lifecycle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

const PROJECT_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER']);

type FormValues = {
  societyId: string;
  title: string;
  description: string;
  category: string;
  estimatedCost: string;
  budgetId: string;
};

export function ProjectsPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canAccess = Boolean(user && PROJECT_ROLES.has(user.role));
  const canCreate = user?.role === 'SOCIETY_MANAGER' || user?.role === 'COMMITTEE_MEMBER';
  const canManageWorkflow = user?.role === 'SOCIETY_MANAGER';
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormValues>({ societyId: user?.societyId ?? '', title: '', description: '', category: '', estimatedCost: '', budgetId: '' });
  const [approvedBudgets, setApprovedBudgets] = useState<Array<{ _id: string; title: string; financialYear: string; status: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<Record<string, ApprovalEvaluation[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [committeeApprovals, setCommitteeApprovals] = useState<Record<string, CommitteeApprovalSummary>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const requestSequence = useRef(0);

  const refreshProjects = useCallback(async () => {
    if (!token || !canAccess) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const records = await listProjects(token);
      const committeeRecords = await Promise.all(records.filter(project => ['COMMITTEE_APPROVAL', 'RE_APPROVAL'].includes(project.status) && project.approvalType === 'COMMITTEE_APPROVAL').map(async project => {
        try { return [project._id, await getCommitteeApproval(project._id, token)] as const; } catch { return null; }
      }));
      setCommitteeApprovals(Object.fromEntries(committeeRecords.filter((item): item is NonNullable<typeof item> => item !== null)));
      if (sequence === requestSequence.current) setProjects(records);
    } catch (error) {
      if (sequence === requestSequence.current) setLoadError(messageFor(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [canAccess, token]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => {
    if (!token || user?.role !== 'SOCIETY_MANAGER') return;
    void apiRequest<Array<{ _id: string; title: string; financialYear: string; status: string }>>('/budgets', { token }).then(items => setApprovedBudgets(items.filter(item => item.status === 'APPROVED'))).catch(() => setApprovedBudgets([]));
  }, [token, user?.role]);

  if (!canAccess) {
    return <div ref={pageRef} className="page-projects space-y-6"><PageHeader eyebrow="Society workspace" title="Projects" description="Project proposals and their governed workflow." /><PermissionDeniedState /></div>;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !user) return;
    const societyId = user.societyId ?? '';
    if (!societyId) {
      setNotice({ kind: 'error', message: 'A society must be linked to this account before creating a project.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const created = await createProject({
        societyId,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        estimatedCost: form.estimatedCost.trim(),
        ...(form.budgetId ? { budgetId: form.budgetId } : {}),
      }, token);
      setProjects((current) => [created, ...(current ?? []).filter((project) => project._id !== created._id)].slice(0, 25));
      setForm({ societyId: user.societyId ?? '', title: '', description: '', category: '', estimatedCost: '', budgetId: '' });
      setNotice({ kind: 'success', message: 'Project proposal saved as DRAFT. It has not been submitted or approved.' });
      setFormOpen(false);
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkBudget(project: ProjectRecord, budgetId: string) {
    if (!token || !budgetId) return;
    setBusyProjectId(project._id); setNotice(null);
    try {
      const updated = await updateProject(project._id, { budgetId }, token);
      setProjects(current => current?.map(item => item._id === updated._id ? updated : item) ?? []);
      setNotice({ kind: 'success', message: 'Approved budget linked to this draft project. This does not approve the project.' });
    } catch (error) { setNotice({ kind: 'error', message: messageFor(error) }); }
    finally { setBusyProjectId(null); }
  }

  async function handleSubmitForReview(project: ProjectRecord) {
    if (!token) return;
    setBusyProjectId(project._id);
    setNotice(null);
    try {
      const submitted = await submitProjectForReview(project._id, token);
      setProjects((current) => current?.map((item) => item._id === submitted._id ? submitted : item) ?? []);
      setNotice({ kind: 'success', message: 'Project submitted for review. This transition does not approve the project.' });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleEvaluateApproval(project: ProjectRecord) {
    if (!token) return;
    setBusyProjectId(project._id);
    setNotice(null);
    try {
      const evaluation = await evaluateProjectApproval(project._id, token);
      await refreshProjects();
      setNotice({
        kind: 'success',
        message: `Approval requirement recorded: ${evaluation.approvalType.replaceAll('_', ' ')} for ₹${evaluation.evaluatedAmount}, using the society's active rule. This is an evaluation, not an approval decision.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleCommitteeDecision(project: ProjectRecord, decision: 'APPROVE' | 'REJECT') {
    if (!token) return;
    setBusyProjectId(project._id);
    setNotice(null);
    try {
      const updated = await recordCommitteeDecision(project._id, decision, rationales[project._id] ?? '', token);
      setCommitteeApprovals(current => ({ ...current, [project._id]: updated }));
      setNotice({ kind: 'success', message: `Your ${decision.toLowerCase()} decision was recorded for this proposal version.` });
    } catch (error) { setNotice({ kind: 'error', message: messageFor(error) }); }
    finally { setBusyProjectId(null); }
  }

  async function handleFinalizeCommittee(project: ProjectRecord) {
    if (!token) return;
    setBusyProjectId(project._id);
    setNotice(null);
    try {
      const result = await finalizeCommitteeApproval(project._id, token);
      setNotice({ kind: 'success', message: `Committee result recorded: ${result.outcome}.` });
      await refreshProjects();
    } catch (error) { setNotice({ kind: 'error', message: messageFor(error) }); }
    finally { setBusyProjectId(null); }
  }

  async function loadApprovalHistory(projectId: string) {
    if (!token) return;
    setHistoryLoadingId(projectId);
    setHistoryErrors((current) => ({ ...current, [projectId]: '' }));
    try {
      const history = await getProjectApprovalHistory(projectId, token);
      setApprovalHistory((current) => ({ ...current, [projectId]: history }));
    } catch (error) {
      setHistoryErrors((current) => ({ ...current, [projectId]: messageFor(error) }));
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function handleToggleApprovalHistory(project: ProjectRecord) {
    if (expandedHistoryId === project._id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(project._id);
    if (!(project._id in approvalHistory)) await loadApprovalHistory(project._id);
  }

  return (
    <div ref={pageRef} className="page-projects space-y-7">
      <PageHeader
        eyebrow="Society / governed work"
        title="Society projects"
        description="Follow proposals through review, approval and completion."
        actions={(
          <>
            <Button variant="outline" onClick={() => void refreshProjects()} disabled={loading}>
              <RefreshCw aria-hidden="true" size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh
            </Button>
            {canCreate ? <Button onClick={() => { setFormOpen((open) => !open); setNotice(null); }}>
              <Plus aria-hidden="true" size={16} />{formOpen ? 'Close form' : 'New proposal'}
            </Button> : null}
          </>
        )}
      />

      {notice ? (
        <div className={`motion-item rounded-md border px-4 py-3 text-sm leading-6 ${notice.kind === 'success' ? 'border-success/30 bg-success/5 text-foreground' : 'border-danger/40 bg-danger/5 text-foreground'}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
          {notice.message}
        </div>
      ) : null}

      {formOpen ? (
        <Card className="task-form motion-item">
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>The backend creates this in DRAFT and records the action in the audit trail.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleCreate}>
              <label className="grid gap-2 text-sm font-semibold">
                Project title
                <input className="min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Category
                <input className="min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required />
              </label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Description
                <textarea className="min-h-24 rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
              </label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Approved society budget (optional)<select className="min-h-11 rounded-md border border-border bg-background px-3 text-sm" value={form.budgetId} onChange={event => setForm({ ...form, budgetId: event.target.value })}><option value="">Link later</option>{approvedBudgets.map(budget => <option key={budget._id} value={budget._id}>{budget.title} · {budget.financialYear}</option>)}</select><span className="font-normal text-muted-foreground">A budget link does not constitute project or expense approval.</span></label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Estimated cost (₹)
                <input className="min-h-11 rounded-md border border-border bg-background px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" type="number" min="0" step="0.01" inputMode="decimal" value={form.estimatedCost} onChange={(event) => setForm({ ...form, estimatedCost: event.target.value })} required />
                <span className="font-normal text-muted-foreground">The backend evaluates approval requirements using the applicable society rule.</span>
              </label>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <Button type="submit" disabled={saving}>{saving ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <Plus aria-hidden="true" size={16} />}{saving ? 'Saving…' : 'Save draft'}</Button>
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="project-list-heading" className="space-y-4">
        <div className="motion-item flex flex-wrap items-end justify-between gap-3 pb-1">
          <div>
            <h3 id="project-list-heading" className="mt-1 font-headline text-xl font-bold">Project proposals</h3>
          </div>
          <span className="text-xs text-muted-foreground">Showing up to 25 records</span>
        </div>
        {loading && projects === null ? <LoadingState label="Loading projects from the Nivaas service" /> : null}
        {!loading && loadError && projects === null ? <ErrorState title="Projects could not be loaded" description={loadError} onRetry={() => void refreshProjects()} /> : null}
        {loadError && projects !== null ? <ErrorState title="Refresh failed" description={loadError} onRetry={() => void refreshProjects()} /> : null}
        {!loading && projects?.length === 0 ? <EmptyState title="No project proposals yet" description="Create the first proposal for this society. Nivaas will keep it in draft until an authorized user submits it for review." /> : null}
        {projects && projects.length > 0 ? (
          <div className="grid gap-0">
            {projects.map((project) => (
              <Card key={project._id} className="project-record motion-item flex flex-col">
                <CardHeader className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{project.category}</p>
                      <CardTitle className="mt-1 break-words">{project.title}</CardTitle>
                    </div>
                    <Badge variant={statusVariant(project.status)}>{project.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <CardDescription className="pt-2">{project.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/50 py-3 text-sm">
                    <span className="text-muted-foreground">Estimated cost</span>
                    <span className="font-mono font-semibold">₹{project.estimatedCost}</span>
                  </div>
                  {project.approvalType ? <p className="text-xs leading-5 text-muted-foreground">Required route: {project.approvalType.replaceAll('_', ' ')}{project.approvalStatus ? ` · ${project.approvalStatus}` : ''}</p> : null}
                  {canManageWorkflow && ['DRAFT', 'REJECTED'].includes(project.status) && !project.budgetId && approvedBudgets.length ? <label className="block space-y-1 text-xs font-semibold">Link an approved budget<select className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal" defaultValue="" onChange={event => void handleLinkBudget(project, event.target.value)} disabled={busyProjectId === project._id}><option value="">Select budget</option>{approvedBudgets.map(budget => <option key={budget._id} value={budget._id}>{budget.title} · {budget.financialYear}</option>)}</select></label> : null}
                  {['COMMITTEE_APPROVAL', 'RE_APPROVAL'].includes(project.status) && project.approvalType === 'COMMITTEE_APPROVAL' ? (
                    <section className="space-y-3 rounded-md border border-secondary/25 bg-secondary/5 p-4" aria-label={`Committee decision for ${project.title}`}>
                      <div><h4 className="font-headline text-sm font-bold">Committee decision</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Quorum and approval majority are calculated separately from the immutable committee electorate snapshot.</p></div>
                      {committeeApprovals[project._id] ? <p className="text-sm">{committeeApprovals[project._id].participatingMembers} of {committeeApprovals[project._id].totalCommitteeMembers} members · {committeeApprovals[project._id].approveCount} approve · {committeeApprovals[project._id].rejectCount} reject · quorum {committeeApprovals[project._id].quorumMet ? 'met' : `not met (${committeeApprovals[project._id].quorumRequired} required)`}</p> : <p className="text-sm text-muted-foreground">No committee decision has been recorded yet.</p>}
                      {user?.role === 'COMMITTEE_MEMBER' ? <>
                        <label className="block text-xs font-semibold" htmlFor={`committee-rationale-${project._id}`}>Rationale (optional)
                          <textarea id={`committee-rationale-${project._id}`} maxLength={2000} value={rationales[project._id] ?? ''} onChange={event => setRationales(current => ({ ...current, [project._id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" />
                        </label>
                        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void handleCommitteeDecision(project, 'APPROVE')} disabled={busyProjectId === project._id}>Record approve</Button><Button variant="outline" onClick={() => void handleCommitteeDecision(project, 'REJECT')} disabled={busyProjectId === project._id}>Record reject</Button></div>
                      </> : null}
                      {canManageWorkflow ? <Button size="default" variant="outline" onClick={() => void handleFinalizeCommittee(project)} disabled={busyProjectId === project._id || !committeeApprovals[project._id]?.quorumMet}>Finalize committee outcome</Button> : null}
                    </section>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Created {formatDate(project.createdAt)}</p>
                  <ProjectLifecyclePanel project={project} role={user?.role ?? ''} token={token} onProjectChanged={() => void refreshProjects()} />
                  <div className="flex flex-wrap gap-2">
                    <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" to={`/quotations?projectId=${encodeURIComponent(project._id)}`}>View quotations</Link>
                    {canManageWorkflow && project.status === 'DRAFT' ? (
                      <Button size="default" onClick={() => void handleSubmitForReview(project)} disabled={busyProjectId === project._id}>
                        {busyProjectId === project._id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <ArrowUpRight aria-hidden="true" size={16} />}
                        Send for review
                      </Button>
                    ) : null}
                    {canManageWorkflow && project.status === 'SUBMITTED' ? (
                      <Button size="default" variant="outline" onClick={() => void handleEvaluateApproval(project)} disabled={busyProjectId === project._id}>
                        {busyProjectId === project._id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <Blocks aria-hidden="true" size={16} />}
                        Evaluate approval route
                      </Button>
                    ) : null}
                    <Button size="default" variant="ghost" aria-expanded={expandedHistoryId === project._id} aria-controls={`approval-history-${project._id}`} onClick={() => void handleToggleApprovalHistory(project)}>
                      <History aria-hidden="true" size={16} />{expandedHistoryId === project._id ? 'Hide approval history' : 'Approval history'}
                    </Button>
                  </div>
                  {expandedHistoryId === project._id ? (
                    <section id={`approval-history-${project._id}`} aria-label={`Approval evaluation history for ${project.title}`} className="space-y-3 rounded-md border border-border/60 bg-background/60 p-4">
                      <div><h4 className="font-headline text-sm font-bold">Approval route evaluations</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">An evaluation records the required route and rule snapshot. It does not represent a governance resolution, vote, or project approval.</p></div>
                      <p className="text-xs text-muted-foreground">Meeting and resolution drafts are available in <Link className="font-semibold text-secondary underline underline-offset-2" to="/voting">Voting</Link>. Nivaas does not link a draft to this approval decision until the decision-body mapping is confirmed.</p>
                      {historyLoadingId === project._id ? <p className="text-sm text-muted-foreground" role="status">Loading approval history…</p> : null}
                      {historyErrors[project._id] ? <div className="space-y-2" role="alert"><p className="text-sm text-danger">{historyErrors[project._id]}</p><Button variant="outline" size="default" onClick={() => void loadApprovalHistory(project._id)}>Try again</Button></div> : null}
                      {approvalHistory[project._id]?.length === 0 ? <p className="text-sm text-muted-foreground">No approval route evaluations have been recorded for this project.</p> : null}
                      {approvalHistory[project._id]?.length ? <ol className="space-y-3 border-l border-secondary/25 pl-4">{approvalHistory[project._id].map((evaluation) => (
                        <li key={evaluation._id} className="relative space-y-2 text-sm"><span aria-hidden="true" className="absolute -left-[1.32rem] top-1.5 size-2.5 rounded-full bg-secondary" /><div className="flex flex-wrap items-center justify-between gap-2"><strong>{evaluation.approvalType.replaceAll('_', ' ')}</strong><span className="font-mono text-[0.65rem] text-muted-foreground">{evaluation.status.replaceAll('_', ' ')}</span></div><p className="text-muted-foreground">Required decision body: {evaluation.requiredDecisionBody.replaceAll('_', ' ')}</p><p className="font-mono text-xs">Evaluated ₹{evaluation.evaluatedAmount} · configured threshold ₹{evaluation.threshold}</p><p className="text-xs text-muted-foreground">Rule version {evaluation.ruleVersionId} · {formatDate(evaluation.evaluatedAt ?? '')}</p>
                        </li>
                      ))}</ol> : null}
                    </section>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The project request could not be completed.';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function statusVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  if (['APPROVED', 'COMPLETED', 'CLOSED'].includes(status)) return 'success';
  if (['REJECTED', 'CANCELLED'].includes(status)) return 'warning';
  if (['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(status)) return 'info';
  return 'neutral';
}

export function ProjectLifecyclePanel({ project, role, token, onProjectChanged }: { project: ProjectRecord; role: string; token: string | null; onProjectChanged: () => void }) {
  const canRead = ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'].includes(role);
  const canManage = role === 'SOCIETY_MANAGER';
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [updates, setUpdates] = useState<ProjectUpdateRecord[]>([]); const [expenses, setExpenses] = useState<ProjectExpense[]>([]); const [summary, setSummary] = useState<ProjectSpendSummary | null>(null);
  const [categories, setCategories] = useState<Array<{ _id: string; name: string; allocatedAmount: string; remainingAmount: string }>>([]);
  const [budgetApproved, setBudgetApproved] = useState(false);
  const [kind, setKind] = useState<'PROGRESS' | 'COMPLETION'>('PROGRESS'); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [invoiceReference, setInvoiceReference] = useState(''); const [photo, setPhoto] = useState<File | null>(null); const [finalCost, setFinalCost] = useState('');
  const [expenseTitle, setExpenseTitle] = useState(''); const [expenseAmount, setExpenseAmount] = useState(''); const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10)); const [expenseCategory, setExpenseCategory] = useState(''); const [expenseInvoice, setExpenseInvoice] = useState(''); const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const [updateRows, expenseData] = await Promise.all([listProjectUpdates(project._id, token), listProjectExpenses(project._id, token)]);
      setUpdates(updateRows); setExpenses(expenseData.items); setSummary(expenseData.projects.find(item => item.projectId === project._id) ?? null);
      if (canManage && project.budgetId) {
        const budget = await apiRequest<{ status: string }>(`/budgets/${encodeURIComponent(project.budgetId)}`, { token });
        setBudgetApproved(budget.status === 'APPROVED');
        if (budget.status !== 'APPROVED') { setCategories([]); return; }
        const rows = await apiRequest<Array<{ _id: string; name: string; allocatedAmount: string; remainingAmount: string }>>(`/budgets/${encodeURIComponent(project.budgetId)}/categories`, { token });
        setCategories(rows);
      } else { setBudgetApproved(false); setCategories([]); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Project progress or financial records could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) void refresh(); }, [open, project._id, project.budgetId, token, canManage]);

  async function beginProject() {
    if (!token) return;
    setBusy(true); setError(''); setMessage('');
    try { await startProject(project._id, token); setMessage('Project execution started.'); onProjectChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Project could not be started.'); }
    finally { setBusy(false); }
  }
  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const update = await createProjectUpdate(project._id, { kind, title: title.trim(), description: description.trim(), ...(kind === 'COMPLETION' ? { invoiceReference: invoiceReference.trim() } : {}) }, token);
      if (photo) await uploadProjectEvidence(update._id, photo, kind === 'COMPLETION' ? 'AFTER_PHOTO' : 'PROGRESS_PHOTO', token);
      setTitle(''); setDescription(''); setInvoiceReference(''); setPhoto(null); setMessage(kind === 'COMPLETION' ? 'Completion record and evidence saved. Confirm completion below when the final cost is reconciled.' : 'Progress update saved.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The progress record could not be completed. Refresh to check whether the record or photo was saved.'); await refresh(); }
    finally { setBusy(false); }
  }
  async function addPhoto(update: ProjectUpdateRecord, file: File | null) {
    if (!token || !file) return;
    setBusy(true); setError('');
    try { await uploadProjectEvidence(update._id, file, update.kind === 'COMPLETION' ? 'AFTER_PHOTO' : 'PROGRESS_PHOTO', token); setMessage('Private project photo saved with an integrity hash.'); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Project photo could not be saved.'); }
    finally { setBusy(false); }
  }
  async function submitCompletion(event: FormEvent<HTMLFormElement>, update: ProjectUpdateRecord) {
    event.preventDefault(); if (!token) return;
    setBusy(true); setError(''); setMessage('');
    try { await completeProject(project._id, { completionUpdateId: update._id, finalCost }, token); setMessage('Project completion recorded with the final cost.'); await refresh(); onProjectChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Project completion was not recorded.'); }
    finally { setBusy(false); }
  }
  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token || !expenseCategory) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await createProjectExpense({ projectId: project._id, budgetCategoryId: expenseCategory, title: expenseTitle.trim(), amount: expenseAmount, expenseDate, ...(expenseInvoice.trim() ? { invoiceReference: expenseInvoice.trim() } : {}), ...(project.vendorId ? { vendorId: project.vendorId } : {}) }, token);
      setExpenseTitle(''); setExpenseAmount(''); setExpenseInvoice(''); setMessage('Expense recorded. Project and budget totals were recalculated by the backend.'); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Expense was not recorded.'); }
    finally { setBusy(false); }
  }
  async function downloadPhoto(evidenceId: string, fileName: string) {
    if (!token) return;
    try { const blob = await downloadProjectEvidence(evidenceId, token); const href = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = href; anchor.download = fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Private project evidence could not be downloaded.'); }
  }

  if (!canRead) return null;
  return <section className="space-y-3 rounded-md border border-border/70 p-4" aria-label={`Project lifecycle for ${project.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-headline text-sm font-bold">Progress, completion and financials</h4><p className="text-xs text-muted-foreground">Progress history and verified photo access follow project permissions. Expense writes require an approved project amount and approved budget.</p></div><Button variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'Hide lifecycle' : 'Open lifecycle'}</Button></div>
    {project.approvedCost ? <p className="text-sm">Approved project amount: <strong>₹{project.approvedCost}</strong>{project.finalCost ? ` · final cost ₹${project.finalCost}` : ''}</p> : <p className="text-xs text-muted-foreground">No approved project amount is available yet; project expenses are unavailable.</p>}
    {project.status === 'APPROVED' && canManage ? <Button variant="outline" disabled={busy} onClick={() => void beginProject()}>{busy ? 'Starting…' : 'Start project execution'}</Button> : null}
    {open ? <>
      {loading ? <p className="text-sm" role="status">Loading project history and expenses…</p> : null}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}{message ? <p className="text-sm" role="status">{message}</p> : null}
      {summary ? <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted p-3 text-sm"><div><dt className="text-xs text-muted-foreground">Authorized amount</dt><dd className="font-semibold">{summary.approvedCost === null ? 'Unavailable' : `₹${summary.approvedCost}`}</dd></div><div><dt className="text-xs text-muted-foreground">Expenses recorded</dt><dd className="font-semibold">₹{summary.totalSpent}</dd></div><div><dt className="text-xs text-muted-foreground">Remaining</dt><dd className={`font-semibold ${summary.overrun ? 'text-danger' : ''}`}>{summary.remainingBudget === null ? 'Unavailable' : `₹${summary.remainingBudget}`}{summary.overrun ? ' · overrun' : ''}</dd></div></dl> : null}
      <ol className="project-lifecycle-timeline" aria-label="Project updates in chronological order">{updates.map(update => <li key={update._id} className="project-lifecycle-entry"><div className="flex flex-wrap justify-between gap-2"><strong>{update.title} · {update.kind === 'COMPLETION' ? 'Completion' : 'Progress'}</strong><time className="text-xs text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</time></div><p className="mt-1 whitespace-pre-wrap text-sm">{update.description}</p>{update.invoiceReference ? <p className="mt-1 text-xs">Final invoice reference: {update.invoiceReference}</p> : null}{update.createdBy ? <p className="mt-1 text-xs text-muted-foreground">Recorded by {update.createdBy}</p> : null}<ul className="mt-2 space-y-1">{update.evidence.map(file => <li key={file._id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{file.category.replaceAll('_', ' ')} · SHA-256 {file.fileHash}</span><Button size="default" variant="ghost" onClick={() => void downloadPhoto(file._id, file.fileName)}>Download private photo</Button></li>)}</ul>{canManage && project.status === 'IN_PROGRESS' && !update.evidence.some(file => file.category === (update.kind === 'COMPLETION' ? 'AFTER_PHOTO' : 'PROGRESS_PHOTO')) ? <label className="mt-2 block text-xs font-semibold">Attach {update.kind === 'COMPLETION' ? 'after-condition' : 'progress'} photo<input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => void addPhoto(update, event.target.files?.[0] ?? null)} /></label> : null}{canManage && update.kind === 'COMPLETION' && project.status === 'IN_PROGRESS' && update.evidence.some(file => file.category === 'AFTER_PHOTO') ? <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={event => void submitCompletion(event, update)}><label className="text-xs font-semibold">Final cost (₹)<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm" type="number" min="0" max={project.approvedCost} step="0.01" value={finalCost} onChange={event => setFinalCost(event.target.value)} required /></label><Button type="submit" disabled={busy || !finalCost}>{busy ? 'Recording…' : 'Confirm project completion'}</Button></form> : null}</li>)}</ol>
      {updates.length === 0 ? <p className="text-sm text-muted-foreground">No progress entries have been recorded.</p> : null}
      {canManage && project.status === 'IN_PROGRESS' ? <form className="grid gap-3 rounded-md border border-border/60 p-3" onSubmit={event => void submitUpdate(event)}><h5 className="text-sm font-semibold">Add immutable project update</h5><label className="text-xs font-semibold">Record type<select className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="PROGRESS">Progress update</option><option value="COMPLETION">Completion evidence</option></select></label><label className="text-xs font-semibold">Milestone title<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} required /></label><label className="text-xs font-semibold">Description<textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} required /></label>{kind === 'COMPLETION' ? <label className="text-xs font-semibold">Final invoice reference<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" maxLength={240} value={invoiceReference} onChange={event => setInvoiceReference(event.target.value)} required /></label> : null}<label className="text-xs font-semibold">Photo evidence (private JPEG/PNG, max 5 MiB)<input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label><Button type="submit" disabled={busy || kind === 'COMPLETION' && !photo}>{busy ? 'Saving…' : kind === 'COMPLETION' ? 'Save completion record and after photo' : 'Save progress update'}</Button></form> : null}
      {canManage && ['APPROVED', 'IN_PROGRESS'].includes(project.status) ? <section className="space-y-3 rounded-md border border-secondary/25 bg-secondary/5 p-3"><h5 className="text-sm font-semibold">Record project expense</h5>{!project.budgetId ? <p className="text-sm text-muted-foreground">Link an approved budget while this proposal is editable. No expense can be recorded without a budget link.</p> : null}{project.budgetId && !budgetApproved ? <p className="text-sm text-muted-foreground">The linked budget is not APPROVED. Expenses remain unavailable until the budget receives its configured approval.</p> : null}{project.budgetId && budgetApproved && categories.length === 0 ? <p className="text-sm text-muted-foreground">No budget categories are available. Assign and approve a budget category before recording an expense.</p> : null}<form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void submitExpense(event)}><label className="text-xs font-semibold">Expense title<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={expenseTitle} onChange={event => setExpenseTitle(event.target.value)} required /></label><label className="text-xs font-semibold">Amount (₹)<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm" type="number" min="0.01" step="0.01" value={expenseAmount} onChange={event => setExpenseAmount(event.target.value)} required /></label><label className="text-xs font-semibold">Budget category<select className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={expenseCategory} onChange={event => setExpenseCategory(event.target.value)} required><option value="">Choose category</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name} · remaining ₹{category.remainingAmount}</option>)}</select></label><label className="text-xs font-semibold">Expense date<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" type="date" max={new Date().toISOString().slice(0, 10)} value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required /></label><label className="text-xs font-semibold sm:col-span-2">Invoice / voucher reference (optional)<input className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" maxLength={240} value={expenseInvoice} onChange={event => setExpenseInvoice(event.target.value)} /></label><Button className="sm:col-span-2" type="submit" disabled={busy || !budgetApproved || categories.length === 0}>{busy ? 'Recording…' : 'Record expense'}</Button></form><p className="text-xs leading-5 text-muted-foreground">Project approval and category allocation are hard limits. If an expense exceeds either, it is rejected. The overrun approval route has not been configured by the product requirements.</p></section> : null}
      {expenses.length ? <section className="space-y-2"><h5 className="text-sm font-semibold">Project expenses</h5>{expenses.map(expense => <div key={expense._id} className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-2 text-sm"><span>{expense.title}{expense.invoiceReference ? ` · ${expense.invoiceReference}` : ''}</span><span className="font-mono">₹{expense.amount}</span></div>)}</section> : null}
    </> : null}
  </section>;
}
