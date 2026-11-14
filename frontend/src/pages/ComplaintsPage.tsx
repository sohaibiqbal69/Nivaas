import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { createComplaint, getComplaint, listComplaints, updateComplaint, uploadComplaintEvidence, downloadComplaintEvidence, type ComplaintDetail, type ComplaintPage, type ComplaintEvidence } from '@/lib/complaints';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

const fieldClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 font-normal';
const failure = (cause: unknown) => cause instanceof ApiError ? cause.message : 'The request could not be completed. Please try again.';
const label = (value: string) => ({ OPEN: 'Submitted', ACKNOWLEDGED: 'Acknowledged by manager', IN_PROGRESS: 'Work in progress', RESOLVED: 'Resolved by manager', COMPLAINT_PHOTO: 'Initial photo', PROGRESS_PHOTO: 'Repair progress', AFTER_PHOTO: 'Resolution evidence' }[value] ?? value);

export function ComplaintsPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const allowed = Boolean(user?.societyId && ['SOCIETY_MANAGER', 'OWNER_MEMBER', 'RESIDENT'].includes(user.role));
  const manager = user?.role === 'SOCIETY_MANAGER';
  const [records, setRecords] = useState<ComplaintPage | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const [note, setNote] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceCategories = !detail ? [] : manager
    ? [...(['ACKNOWLEDGED', 'IN_PROGRESS'].includes(detail.status) ? ['PROGRESS_PHOTO'] : []), ...(['IN_PROGRESS', 'RESOLVED'].includes(detail.status) ? ['AFTER_PHOTO'] : [])]
    : detail.status === 'OPEN' ? ['COMPLAINT_PHOTO'] : [];
  const refresh = useCallback(async () => {
    if (!token || !allowed) return;
    const sequence = ++listRequest.current;
    setLoading(true); setError(null);
    try { const result = await listComplaints(token, page, status); if (sequence === listRequest.current) setRecords(result); }
    catch (cause) { if (sequence === listRequest.current) { setRecords(null); setError(failure(cause)); } }
    finally { if (sequence === listRequest.current) setLoading(false); }
  }, [token, allowed, page, status]);
  useEffect(() => { void refresh(); return () => { listRequest.current++; }; }, [refresh]);
  async function open(id: string) {
    if (!token) return;
    const sequence = ++detailRequest.current;
    setDetail(null); setDetailLoading(true); setError(null); setNote('');
    try { const record = await getComplaint(token, id); if (sequence === detailRequest.current) setDetail(record); }
    catch (cause) { if (sequence === detailRequest.current) setError(failure(cause)); }
    finally { if (sequence === detailRequest.current) setDetailLoading(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token || saving) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true); setMessage(null); setError(null);
    try {
      const created = await createComplaint(token, { title: String(data.get('title')), description: String(data.get('description')), category: String(data.get('category')), priority: String(data.get('priority')) });
      form.reset(); setMessage('Complaint submitted. Your society manager can now acknowledge it.');
      await refresh(); await open(created._id);
    } catch (cause) { setError(failure(cause)); }
    finally { setSaving(false); }
  }
  async function transition(action: 'acknowledge' | 'update' | 'resolve') {
    if (!token || !detail || saving) return;
    const id = detail._id;
    setSaving(true); setMessage(null); setError(null);
    try {
      await updateComplaint(token, id, action, note);
      setMessage(action === 'resolve' ? 'Marked resolved by the manager. This is not resident confirmation or closure.' : 'Complaint timeline updated.');
      await refresh(); await open(id);
    } catch (cause) { setError(failure(cause)); }
    finally { setSaving(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token || !detail || evidenceBusy) return;
    const form = event.currentTarget;
    const data = new FormData(form); const file = data.get('photo');
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) { setError('Select one JPEG or PNG photo no larger than 5 MiB.'); return; }
    const id = detail._id;
    setEvidenceBusy(true); setError(null); setMessage(null);
    try {
      await uploadComplaintEvidence(token, id, String(data.get('category')), file);
      setMessage('Photo evidence saved and recorded in the complaint timeline.');
      form.reset(); await open(id);
    } catch (cause) { setError(failure(cause)); }
    finally { setEvidenceBusy(false); }
  }
  async function download(evidence: ComplaintEvidence) {
    if (!token || evidenceBusy) return;
    setEvidenceBusy(true); setError(null);
    try {
      const blob = await downloadComplaintEvidence(token, evidence._id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = evidence.fileName; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(failure(cause)); }
    finally { setEvidenceBusy(false); }
  }
  if (!allowed) return <div ref={pageRef}><PageHeader eyebrow="Society services" title="Complaints" description="Raise and track society issues." /><PermissionDeniedState /></div>;
  return <div ref={pageRef} className="page-complaints space-y-6">
    <PageHeader eyebrow="Society services" title="Complaints" description={manager ? 'Review reports, record work and explain the resolution.' : 'Report an issue and follow the manager’s response.'} />
    <p className="text-sm text-muted-foreground">Complaints and photos are visible to their creator and the society manager. Submit the complaint first, then attach initial photos while it is OPEN. Staff assignment and resident confirmation/reopening are not available in this release.</p>
    {message ? <p role="status" className="rounded-lg border border-secondary/40 bg-card p-4 text-sm">{message}</p> : null}
    {error ? <div role="alert"><ErrorState description={error} onRetry={() => void refresh()} /></div> : null}
    {!manager ? <Card className="task-form motion-item"><CardHeader><CardTitle>Raise a complaint</CardTitle></CardHeader><CardContent>
      <form aria-label="Raise a complaint" onSubmit={event => void submit(event)} className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold md:col-span-2">Title<input name="title" required placeholder="For example: Water leaking near the staircase" maxLength={160} className={fieldClass} /></label>
        <details className="md:col-span-2"><summary className="cursor-pointer py-2 text-sm font-semibold">Add optional details</summary><div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold">Category<input name="category" placeholder="For example: Plumbing" maxLength={80} className={fieldClass} /></label>
        <label className="space-y-1 text-sm font-semibold">Priority<input name="priority" placeholder="Optional: explain urgency" maxLength={40} className={fieldClass} /></label>
        <label className="space-y-1 text-sm font-semibold md:col-span-2">Description<textarea name="description" placeholder="Where is the issue? When did it start?" maxLength={10000} rows={3} className={fieldClass} /></label>
        </div></details>
        <p className="text-sm text-muted-foreground md:col-span-2">Only a short title is required. After submitting, you can attach optional photos below the timeline.</p>
        <div><Button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit complaint'}</Button></div>
      </form>
    </CardContent></Card> : null}
    <label className="block max-w-xs space-y-1 text-sm font-semibold">Filter by status<select className={fieldClass} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    {loading ? <LoadingState label="Loading complaints" /> : records?.items.length === 0 ? <EmptyState title="No matching complaints" description={manager ? 'No complaints match this view in your society.' : 'Your submitted complaints will appear here.'} /> : records ? <div className="grid gap-x-10 md:grid-cols-2">{records.items.map(record => <Card key={record._id} className="complaint-record"><CardContent className="space-y-2"><p className="record-status">{[label(record.status), record.category, record.priority].filter(Boolean).join(' · ')}</p><h2 className="font-headline text-lg font-bold">{record.title}</h2><p className="text-sm text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</p><Button variant="ghost" className="-ml-4" disabled={saving} onClick={() => void open(record._id)}>View complaint: {record.title}</Button></CardContent></Card>)}</div> : null}
    {records && records.total > records.limit ? <div className="flex items-center gap-3"><Button variant="outline" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={loading || page * records.limit >= records.total} onClick={() => setPage(page + 1)}>Next</Button></div> : null}
    {detailLoading ? <LoadingState label="Loading complaint timeline" /> : null}
    {detail ? <Card><CardHeader><CardTitle>{detail.title}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="whitespace-pre-wrap text-sm">{detail.description || 'No additional details provided.'}</p><p className="text-sm font-semibold">{label(detail.status)}</p>
      {detail.status === 'RESOLVED' ? <p className="text-sm text-muted-foreground">The manager has recorded a resolution. Resident confirmation and reopening remain unavailable pending the applicable policy; this complaint is not marked CLOSED.</p> : null}
      <ol aria-label="Complaint timeline" className="space-y-3">{detail.updates.map(update => <li key={update._id} className="border-l-2 border-secondary/40 pl-4"><p className="font-mono text-xs">{label(update.status)} · {new Date(update.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap text-sm">{update.description}</p></li>)}</ol>
      <section aria-label="Complaint evidence" className="space-y-3"><h3 className="font-headline text-lg font-bold">Photo evidence</h3>
        {(detail.evidence ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No photo evidence has been attached.</p> : <ul className="space-y-3">{detail.evidence!.map(evidence => <li key={evidence._id} className="rounded-md border border-border p-3"><p className="text-sm">{label(evidence.category)} · {Math.ceil(evidence.fileSize / 1024)} KiB · {new Date(evidence.createdAt).toLocaleString()}</p><p className="break-all font-mono text-xs">Uploader: {evidence.uploadedBy}</p><Button variant="outline" disabled={evidenceBusy} onClick={() => void download(evidence)}>Download {evidence.fileName}</Button></li>)}</ul>}
        {evidenceCategories.length ? <form key={`${detail._id}-${detail.status}`} aria-label="Upload complaint evidence" onSubmit={event => void upload(event)} className="space-y-3">
          <label className="block text-sm font-semibold">Evidence category<select name="category" className={fieldClass}>{evidenceCategories.map(category => <option key={category} value={category}>{label(category)}</option>)}</select></label>
          <label className="block text-sm font-semibold">Photo (JPEG or PNG, up to 5 MiB)<input name="photo" type="file" accept="image/jpeg,image/png" required className={fieldClass} /></label>
          <Button type="submit" disabled={evidenceBusy || saving}>{evidenceBusy ? 'Uploading…' : 'Upload photo'}</Button>
        </form> : null}
        {evidenceBusy ? <p role="status" className="text-sm">Transferring protected evidence…</p> : null}
      </section>
      {manager && ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(detail.status) ? <div className="space-y-3"><label className="block space-y-1 text-sm font-semibold">Progress or resolution note<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={10000} rows={3} className={fieldClass} /></label><div className="flex flex-wrap gap-3">
        {detail.status === 'OPEN' ? <Button disabled={saving || !note.trim()} onClick={() => void transition('acknowledge')}>Acknowledge</Button> : <Button disabled={saving || !note.trim()} onClick={() => void transition('update')}>Record progress</Button>}
        {detail.status === 'IN_PROGRESS' ? <Button variant="outline" disabled={saving || !note.trim()} onClick={() => void transition('resolve')}>Mark resolved</Button> : null}
      </div></div> : null}
    </CardContent></Card> : null}
  </div>;
}
