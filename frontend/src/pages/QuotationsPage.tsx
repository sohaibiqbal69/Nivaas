import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, FilePlus2, LoaderCircle, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { listProjectDiscovery, listProjects, type ProjectDiscoveryRecord, type ProjectRecord } from '@/lib/projects';
import {
  createChangeRequest, createQuotation, createVendor, listChangeRequests, listQuotations, listVendors, selectQuotation, submitChangeRequest,
  type ChangeRequestRecord, type QuotationRecord, type VendorRecord,
} from '@/lib/quotations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

const READ_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER']);
const WRITE_ROLES = new Set(['SOCIETY_MANAGER']);
const SELECTABLE_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW']);
const REVISION_REQUEST_STATUSES = new Set(['SUPERSEDED', 'REJECTED']);

type Notice = { kind: 'success' | 'error'; message: string };
type DraftForm = { vendorId: string; amount: string; description: string };
type RevisionForm = { additionalAmount: string; reason: string };

export function QuotationsPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const [searchParams] = useSearchParams();
  const { user, token } = useAuth();
  const canRead = Boolean(user && READ_ROLES.has(user.role));
  const canWrite = Boolean(user && WRITE_ROLES.has(user.role));
  const canManageVendors = user?.role === 'SOCIETY_MANAGER';
  const [projects, setProjects] = useState<Array<ProjectRecord | ProjectDiscoveryRecord> | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(() => searchParams.get('projectId') ?? '');
  const [quotations, setQuotations] = useState<QuotationRecord[] | null>(null);
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRecord[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<DraftForm>({ vendorId: '', amount: '', description: '' });
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorCreateOpen, setVendorCreateOpen] = useState(false);
  const [revisionFor, setRevisionFor] = useState<string | null>(null);
  const [revision, setRevision] = useState<RevisionForm>({ additionalAmount: '', reason: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadProjects = useCallback(async () => {
    if (!token || !canRead) return;
    setProjectsLoading(true);
    setProjectError(null);
    try {
      setProjects(canWrite ? await listProjects(token) : await listProjectDiscovery(token));
    } catch (error) {
      setProjectError(messageFor(error));
    } finally {
      setProjectsLoading(false);
    }
  }, [canRead, canWrite, token]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const loadRecords = useCallback(async (id: string) => {
    if (!token || !id.trim()) return;
    const sequence = ++requestSequence.current;
    setProjectId(id.trim());
    setRecordsLoading(true);
    setRecordsError(null);
    setAccessDenied(false);
    setNotice(null);
    try {
      const [quotes, requests] = await Promise.all([listQuotations(id.trim(), token), listChangeRequests(id.trim(), token)]);
      if (sequence === requestSequence.current) {
        setQuotations(quotes);
        setChangeRequests(requests);
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setQuotations(null);
        setChangeRequests(null);
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) setAccessDenied(true);
        else setRecordsError(messageFor(error));
      }
    } finally {
      if (sequence === requestSequence.current) setRecordsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canWrite && projectId) void loadRecords(projectId);
    // Project selection is the trigger; loadRecords is stable for a token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canWrite]);

  useEffect(() => {
    const selectedProject = projects?.find((item) => item._id === projectId);
    if (!canWrite || !token || !selectedProject || !('societyId' in selectedProject)) {
      setVendors([]);
      setVendorsError(null);
      return;
    }
    let active = true;
    setVendorsLoading(true);
    setVendorsError(null);
    void listVendors(selectedProject.societyId, token).then((records) => {
      if (active) setVendors(records);
    }).catch((error) => {
      if (active) setVendorsError(messageFor(error));
    }).finally(() => {
      if (active) setVendorsLoading(false);
    });
    return () => { active = false; };
  }, [canWrite, projectId, projects, token]);

  if (!canRead) {
    return <div ref={pageRef} className="page-quotations space-y-6"><PageHeader eyebrow="Society / procurement" title="Quotations" description="Quotation versions and change requests linked to project records." /><PermissionDeniedState /></div>;
  }

  async function handleCreateQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !projectId) return;
    if (!vendors.some((vendor) => vendor._id === draft.vendorId)) {
      setNotice({ kind: 'error', message: 'Select a vendor from this society’s saved vendor records before saving the quotation.' });
      return;
    }
    setBusyId('create');
    setNotice(null);
    try {
      const created = await createQuotation(projectId, {
        vendorId: draft.vendorId.trim(), amount: draft.amount.trim(), description: draft.description.trim(),
      }, token);
      setQuotations((current) => [...(current ?? []), created].sort((a, b) => a.versionNumber - b.versionNumber));
      setDraft({ vendorId: '', amount: '', description: '' });
      setCreateOpen(false);
      setNotice({ kind: 'success', message: `Quotation V${created.versionNumber} saved as ${created.status}. Saving a draft does not select or approve it.` });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateVendor() {
    if (!token || !project || !('societyId' in project)) return;
    if (!vendorName.trim()) {
      setNotice({ kind: 'error', message: 'Enter a vendor name before saving.' });
      return;
    }
    setBusyId('vendor');
    setNotice(null);
    try {
      const vendor = await createVendor(project.societyId, vendorName.trim(), token);
      setVendors((current) => [...current, vendor].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((current) => ({ ...current, vendorId: vendor._id }));
      setVendorName('');
      setVendorCreateOpen(false);
      setNotice({ kind: 'success', message: 'Vendor saved for this society and selected for the quotation.' });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally { setBusyId(null); }
  }

  async function handleSelect(quotation: QuotationRecord) {
    if (!token) return;
    setBusyId(quotation._id);
    setNotice(null);
    try {
      const selected = await selectQuotation(quotation._id, token);
      setQuotations((current) => current?.map((item) => item._id === selected._id
        ? selected
        : item.status === 'SELECTED' ? { ...item, status: 'SUPERSEDED' } : item) ?? []);
      setNotice({ kind: 'success', message: `Quotation V${selected.versionNumber} selected. Selection is not approval; if prior approval decisions exist, the backend re-evaluates the project under its active rule.` });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateChangeRequest(event: FormEvent<HTMLFormElement>, quotation: QuotationRecord) {
    event.preventDefault();
    if (!token) return;
    setBusyId(quotation._id);
    setNotice(null);
    try {
      const created = await createChangeRequest(quotation._id, {
        additionalAmount: revision.additionalAmount.trim(), reason: revision.reason.trim(),
      }, token);
      setChangeRequests((current) => [created, ...(current ?? [])]);
      setRevisionFor(null);
      setRevision({ additionalAmount: '', reason: '' });
      setNotice({ kind: 'success', message: `Change request saved as ${created.status}. Submit it only for the currently selected quotation to start the backend approval re-evaluation.` });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmitChangeRequest(record: ChangeRequestRecord) {
    if (!token) return;
    setBusyId(record._id);
    setNotice(null);
    try {
      const submitted = await submitChangeRequest(record._id, token);
      setChangeRequests((current) => current?.map((item) => item._id === submitted._id ? submitted : item) ?? []);
      setNotice({ kind: 'success', message: 'Change request submitted. The backend recorded the submission and re-evaluated the project approval requirement; the quotation revision is not yet approved.' });
    } catch (error) {
      setNotice({ kind: 'error', message: messageFor(error) });
    } finally {
      setBusyId(null);
    }
  }

  const project = projects?.find((item) => item._id === projectId);
  const handleProjectSelect = (id: string) => {
    setProjectId(id);
    setQuotations(null);
    setChangeRequests(null);
    setCreateOpen(false);
    setDraft({ vendorId: '', amount: '', description: '' });
    setVendorCreateOpen(false);
    setNotice(null);
  };

  return (
    <div ref={pageRef} className="page-quotations space-y-7">
      <PageHeader
        eyebrow="Society / procurement"
        title="Quotations"
        description="Compare vendor offers and follow each revision against its project."
        actions={projectId ? <Button variant="outline" onClick={() => void loadRecords(projectId)} disabled={recordsLoading}><RefreshCw aria-hidden="true" size={16} className={recordsLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh records</Button> : undefined}
      />

      {notice ? <div className={`motion-item rounded-md border px-4 py-3 text-sm leading-6 ${notice.kind === 'success' ? 'border-success/30 bg-success/5' : 'border-danger/40 bg-danger/5'}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.message}</div> : null}

      <Card className="motion-item">
        <CardHeader>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Project record</p>
          <CardTitle>Choose a project</CardTitle>
          <CardDescription>Quotation and change-request records are retrieved through the existing society-scoped project APIs.</CardDescription>
        </CardHeader>
        <CardContent>
          {canRead ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="grid gap-2 text-sm font-semibold" htmlFor="quotation-project">Project
                <select id="quotation-project" className={inputClass} value={projectId} onChange={(event) => handleProjectSelect(event.target.value)} disabled={projectsLoading}>
                  <option value="">{projectsLoading ? 'Loading projects…' : 'Select a project'}</option>
                  {(projects ?? []).map((item) => <option key={item._id} value={item._id}>{item.title} · {item.status.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
              <Button variant="outline" onClick={() => void loadProjects()} disabled={projectsLoading}><RefreshCw aria-hidden="true" size={16} className={projectsLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh projects</Button>
              {projectError ? <p className="text-sm text-danger sm:col-span-2" role="alert">{projectError}</p> : null}
              {!canWrite ? <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Only project names, categories, and statuses are used for discovery. Quotation records load separately after selection and remain society-scoped by the backend.</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!projectId ? <EmptyState title="Select a project to view its quotations" description={canWrite ? 'Choose a project above. Its saved quotation versions and change-request history will load from the backend.' : 'Enter a project ID you are authorized to view. Nivaas checks society membership on the server.'} /> : null}
      {recordsLoading ? <LoadingState label="Loading quotation versions and change requests" /> : null}
      {!recordsLoading && recordsError ? <ErrorState title="Quotation records could not be loaded" description={recordsError} onRetry={() => void loadRecords(projectId)} /> : null}
      {!recordsLoading && accessDenied ? <PermissionDeniedState /> : null}

      {!recordsLoading && !recordsError && !accessDenied && projectId && quotations !== null && changeRequests !== null ? (
        <>
          <section aria-labelledby="versions-heading" className="space-y-4">
            <div className="motion-item flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
              <div><p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">{project?.title ?? `Project ${shortId(projectId)}`}</p><h3 id="versions-heading" className="mt-1 font-headline text-xl font-bold">Quotation history</h3></div>
              {canWrite && quotations.length === 0 && project?.status !== 'CLOSED' && project?.status !== 'CANCELLED' ? <Button onClick={() => setCreateOpen((value) => !value)}><FilePlus2 aria-hidden="true" size={16} />{createOpen ? 'Close form' : 'New quotation'}</Button> : null}
              {canWrite && quotations.length > 0 ? <span className="text-xs text-muted-foreground">New versions begin through a change request.</span> : null}
            </div>

            {createOpen ? <Card className="motion-item border-secondary/35"><CardHeader><CardTitle>Initial quotation</CardTitle><CardDescription>This endpoint creates version 1 as DRAFT. Later versions must follow the change-request workflow.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={handleCreateQuotation}>
              <div className="grid content-start gap-2 text-sm font-semibold"><label htmlFor="quotation-vendor">Vendor</label><select id="quotation-vendor" className={inputClass} value={draft.vendorId} onChange={(event) => setDraft({ ...draft, vendorId: event.target.value })} required disabled={vendorsLoading || Boolean(vendorsError)}><option value="">{vendorsLoading ? 'Loading society vendors…' : 'Select a saved vendor'}</option>{vendors.map((vendor) => <option key={vendor._id} value={vendor._id}>{vendor.name}{vendor.companyName ? ` · ${vendor.companyName}` : ''}</option>)}</select><span className="font-normal text-muted-foreground">The selected value is the persisted vendor record ID for this society.</span>{vendorsError ? <p className="font-normal text-danger" role="alert">Vendor records could not be loaded: {vendorsError}</p> : null}{!vendorsLoading && !vendorsError && vendors.length === 0 ? <p className="font-normal text-muted-foreground">No saved vendors exist for this society yet.</p> : null}<Button type="button" variant="outline" className="w-fit" onClick={() => setVendorCreateOpen((open) => !open)} disabled={!canManageVendors || !project || !('societyId' in project) || Boolean(vendorsError)}>{vendorCreateOpen ? 'Close vendor form' : 'Add a vendor'}</Button>{vendorCreateOpen ? <div className="grid gap-2 rounded border border-border/60 p-3"><label htmlFor="new-vendor-name">Vendor name</label><input id="new-vendor-name" className={inputClass} value={vendorName} onChange={(event) => setVendorName(event.target.value)} required maxLength={160} /><Button type="button" onClick={() => void handleCreateVendor()} disabled={busyId === 'vendor' || !vendorName.trim()}>{busyId === 'vendor' ? 'Saving…' : 'Save vendor'}</Button></div> : null}</div>
              <label className="grid w-full content-start gap-2 text-sm font-semibold">Amount (₹)<input className={`${inputClass} h-11 w-full`} type="number" min="0" step="0.01" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} required /></label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Description<textarea className={`${inputClass} min-h-24 py-2`} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required /></label>
              <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={busyId === 'create'}>{busyId === 'create' ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <FilePlus2 aria-hidden="true" size={16} />}{busyId === 'create' ? 'Saving…' : 'Save quotation draft'}</Button><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={busyId === 'create'}>Cancel</Button></div>
            </form></CardContent></Card> : null}

            {quotations.length === 0 ? <EmptyState title="No quotations recorded for this project" description={canWrite ? 'An authorized society user can add the initial quotation. The backend will save it as a draft.' : 'No quotation versions are available for this project.'} /> : (
              <ol className="relative space-y-4 border-l border-secondary/25 pl-4 sm:pl-6" aria-label="Quotation versions in order">
                {quotations.map((quotation) => <li key={quotation._id} className="motion-item relative"><span aria-hidden="true" className={`absolute -left-[1.38rem] top-6 size-3 rounded-full border-2 border-background ${quotation.status === 'SELECTED' ? 'bg-secondary' : 'bg-muted-foreground/45'} sm:-left-[1.88rem]`} />
                  <Card className="quotation-record">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">Version {quotation.versionNumber}</p><CardTitle className="mt-1">₹{quotation.amount}</CardTitle></div><Badge variant={statusVariant(quotation.status)}>{quotation.status.replaceAll('_', ' ')}</Badge></div>
                      <CardDescription>{quotation.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <dl className="grid gap-3 border-y border-border/50 py-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Vendor record</dt><dd className="mt-1 break-all font-mono text-xs">{quotation.vendorId}</dd></div><div><dt className="text-muted-foreground">Recorded</dt><dd className="mt-1">{formatDate(quotation.createdAt)}</dd></div>{quotation.previousQuotationId ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Previous version</dt><dd className="mt-1 font-mono text-xs">{shortId(quotation.previousQuotationId)}</dd></div> : null}</dl>
                      {quotation.status === 'SELECTED' ? <p className="text-xs leading-5 text-muted-foreground">Selected for this project. Selection is not an approval decision.</p> : null}
                      {canWrite ? <div className="flex flex-wrap gap-2">{SELECTABLE_STATUSES.has(quotation.status) ? <Button variant="outline" onClick={() => void handleSelect(quotation)} disabled={busyId === quotation._id}>{busyId === quotation._id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" size={16} />}Select quotation</Button> : null}{!REVISION_REQUEST_STATUSES.has(quotation.status) ? <Button variant="ghost" onClick={() => { setRevisionFor(revisionFor === quotation._id ? null : quotation._id); setRevision({ additionalAmount: '', reason: '' }); }}>Request a change</Button> : null}</div> : null}
                      {revisionFor === quotation._id ? <form className="grid gap-4 rounded-md border border-border/60 bg-background/65 p-4 sm:grid-cols-2" onSubmit={(event) => void handleCreateChangeRequest(event, quotation)}><div className="sm:col-span-2"><p className="text-sm font-semibold">Change request for version {quotation.versionNumber}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The request records the proposed additional amount and reason. It creates a draft request, not a new quotation version or approval.</p></div><label className="grid gap-2 text-sm font-semibold">Additional amount (₹)<input className={inputClass} type="number" min="0.01" step="0.01" inputMode="decimal" value={revision.additionalAmount} onChange={(event) => setRevision({ ...revision, additionalAmount: event.target.value })} required /></label><label className="grid gap-2 text-sm font-semibold sm:col-span-2">Reason<textarea className={`${inputClass} min-h-20 py-2`} value={revision.reason} onChange={(event) => setRevision({ ...revision, reason: event.target.value })} required /></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={busyId === quotation._id}>{busyId === quotation._id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <FilePlus2 aria-hidden="true" size={16} />}Save change request</Button><Button type="button" variant="ghost" onClick={() => setRevisionFor(null)}>Cancel</Button></div></form> : null}
                    </CardContent>
                  </Card>
                </li>)}
              </ol>
            )}
          </section>

          <section aria-labelledby="change-requests-heading" className="space-y-4">
            <div className="motion-item pb-1"><h3 id="change-requests-heading" className="font-headline text-xl font-bold">Change requests</h3></div>
            {changeRequests.length === 0 ? <EmptyState title="No change requests yet" description="Requests created for this project will appear here with their recorded status and amount context." /> : <div className="grid gap-4 lg:grid-cols-2">{changeRequests.map((record) => {
              const source = quotations.find((item) => item._id === record.quotationId);
              const canSubmit = canWrite && record.status === 'DRAFT' && source?.status === 'SELECTED';
              return <Card key={record._id} className="quotation-record motion-item"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{source ? `Version ${source.versionNumber}` : `Quotation ${shortId(record.quotationId)}`}</p><CardTitle className="mt-1">₹{record.newAmount}</CardTitle></div><Badge variant={statusVariant(record.status)}>{record.status.replaceAll('_', ' ')}</Badge></div><CardDescription>{record.reason}</CardDescription></CardHeader><CardContent className="space-y-3"><dl className="grid grid-cols-2 gap-3 border-y border-border/50 py-3 text-sm"><div><dt className="text-muted-foreground">Original amount</dt><dd className="mt-1 font-mono">₹{record.originalAmount}</dd></div><div><dt className="text-muted-foreground">Additional amount</dt><dd className="mt-1 font-mono">₹{record.additionalAmount}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Requested</dt><dd className="mt-1">{formatDate(record.createdAt)}</dd></div></dl>{canSubmit ? <><p className="text-xs leading-5 text-muted-foreground">Submitting starts the backend re-evaluation workflow for the selected quotation. It does not itself approve the revision.</p><Button onClick={() => void handleSubmitChangeRequest(record)} disabled={busyId === record._id}>{busyId === record._id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden="true" size={16} />}Submit change request</Button></> : null}</CardContent></Card>;
            })}</div>}
          </section>
        </>
      ) : null}
    </div>
  );
}

const inputClass = 'min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function messageFor(error: unknown): string { return error instanceof Error ? error.message : 'The quotation request could not be completed.'; }
function statusVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'APPROVED') return 'success';
  if (status === 'SELECTED') return 'info';
  if (['REJECTED', 'SUPERSEDED', 'REQUIRES_SGM'].includes(status)) return 'warning';
  if (['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(status)) return 'info';
  return 'neutral';
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}
function shortId(value: string): string { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
