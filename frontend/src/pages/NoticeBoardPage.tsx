import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, Pencil, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { archiveNotice, createNotice, listNotices, NOTICE_CATEGORIES, publishNotice, updateNoticeDraft, type NoticeCategory, type NoticeInput, type NoticeRecord } from '@/lib/notices';
import { listGovernanceMeetings, type GovernanceMeeting } from '@/lib/governance';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { useSearchParams } from 'react-router-dom';
import { NoticeAttachments } from '@/components/NoticeAttachments';
import { GovernancePage } from './GovernancePage';

const NOTICE_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT']);

export function NoticeBoardPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const [searchParams] = useSearchParams();
  const [societyId, setSocietyId] = useState(searchParams.get('societyId') ?? '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [notices, setNotices] = useState<NoticeRecord[] | null>(null);
  const [meetings, setMeetings] = useState<GovernanceMeeting[] | null>(null);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<NoticeCategory>('GENERAL');
  const [priority, setPriority] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const canRead = Boolean(user && NOTICE_ROLES.has(user.role));
  const canManage = user?.role === 'SOCIETY_MANAGER';

  const refresh = useCallback(async () => {
    if (!token || !canRead || user?.role === 'SYSTEM_ADMIN' && !societyId.trim()) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const filters = { ...(user?.role === 'SYSTEM_ADMIN' ? { societyId: societyId.trim() } : {}), ...(categoryFilter ? { category: categoryFilter } : {}) };
      const statuses = canManage ? ['DRAFT', 'PUBLISHED', 'ARCHIVED'] : [undefined];
      const [pages] = await Promise.all([
        Promise.all(statuses.map((status) => listNotices(token, { ...filters, ...(status ? { status } : {}) }))),
        listGovernanceMeetings(token, user?.role === 'SYSTEM_ADMIN' ? societyId.trim() : undefined)
          .then((records) => { setMeetings(records); setMeetingError(null); })
          .catch((cause) => { setMeetings(null); setMeetingError(cause instanceof ApiError ? cause.message : 'Published meeting notices could not be loaded.'); }),
      ]);
      setNotices(pages.flatMap((page) => page.items));
    } catch (cause) {
      setNotices(null);
      setError(cause instanceof ApiError ? cause.message : 'Notices could not be loaded.');
    } finally { setLoading(false); }
  }, [canManage, canRead, categoryFilter, societyId, token, user?.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  function editDraft(record: NoticeRecord) {
    setEditingId(record._id); setTitle(record.title); setDescription(record.description);
    setCategory(record.category); setPriority(record.priority);
    setExpiresAt(record.expiresAt ? record.expiresAt.slice(0, 16) : ''); setMessage(null);
  }

  function resetForm() {
    setEditingId(null); setTitle(''); setDescription(''); setCategory('GENERAL'); setPriority(''); setExpiresAt('');
  }

  async function saveNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true); setMessage(null);
    const input: NoticeInput = { title, description, category, priority, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : editingId ? { expiresAt: null } : {}) };
    try {
      if (editingId) await updateNoticeDraft(token, editingId, input);
      else await createNotice(token, input);
      setMessage({ type: 'success', text: editingId ? 'Draft notice updated.' : 'Notice draft saved. Publish it when it is ready for residents.' });
      resetForm();
      await refresh();
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof ApiError ? cause.message : 'The notice could not be saved.' });
    } finally { setSaving(false); }
  }

  async function transition(record: NoticeRecord, action: 'publish' | 'archive') {
    if (!token || busyId) return;
    setBusyId(record._id); setMessage(null);
    try {
      if (action === 'publish') await publishNotice(token, record._id);
      else await archiveNotice(token, record._id);
      setMessage({ type: 'success', text: action === 'publish' ? 'Notice published to this society’s Notice Board.' : 'Notice archived.' });
      await refresh();
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof ApiError ? cause.message : 'The notice state could not be changed.' });
    } finally { setBusyId(null); }
  }

  if (!canRead) return <div ref={pageRef} className="page-notices space-y-6"><PageHeader eyebrow="Society records" title="Notice Board" description="Read official society notices." /><PermissionDeniedState /></div>;

  return <div ref={pageRef} className="page-notices space-y-6">
    <PageHeader eyebrow="Society records" title="Notice Board" description="Announcements and formal meeting notices for the society." />
    {user?.role === 'SYSTEM_ADMIN' ? <form className="flex max-w-xl gap-3" onSubmit={(event) => { event.preventDefault(); void refresh(); }}><label className="flex-1 space-y-1 text-sm font-medium">Society ID<input required value={societyId} onChange={(event) => setSocietyId(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3 font-mono" /></label><Button className="self-end" type="submit">Load society</Button></form> : null}
    <div className="grid max-w-2xl gap-3 sm:grid-cols-[minmax(13rem,20rem)_auto] sm:items-end"><label className="grid gap-2 text-sm font-medium">Filter by category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">All categories</option>{NOTICE_CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>{!loading && !error ? <p className="pb-3 text-xs text-muted-foreground">{notices?.length ?? 0} records shown</p> : null}</div>
    {message ? <p className={`rounded-md border px-4 py-3 text-sm ${message.type === 'error' ? 'border-danger/40 bg-danger/5' : 'border-success/30 bg-success/5'}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    {error ? <ErrorState title="Notices unavailable" description={error} onRetry={() => void refresh()} /> : null}
    {loading ? <LoadingState label="Loading society notices" /> : null}

    {canManage ? <Card className="task-form">
      <CardHeader><CardTitle>{editingId ? 'Edit notice draft' : 'Create a notice'}</CardTitle><CardDescription>Save a draft first, then publish it to the residents of this society. Priority labels are society-defined.</CardDescription></CardHeader>
      <CardContent><form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void saveNotice(event)}>
        <label className="space-y-1.5 text-sm font-medium">Title<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <label className="space-y-1.5 text-sm font-medium">Category<select required value={category} onChange={(event) => setCategory(event.target.value as NoticeCategory)} className="min-h-11 w-full rounded-md border border-border bg-background px-3">{NOTICE_CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
        <label className="space-y-1.5 text-sm font-medium">Priority label<input required maxLength={40} value={priority} onChange={(event) => setPriority(event.target.value)} placeholder="Society-defined priority" className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <label className="space-y-1.5 text-sm font-medium">Expires at (optional)<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <label className="space-y-1.5 text-sm font-medium md:col-span-2">Description<textarea required maxLength={10000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" /></label>
        <p className="text-xs leading-5 text-muted-foreground md:col-span-2">1. Save a draft. 2. Attach optional document scans on its card below. 3. Publish when ready. Only published, unexpired notices are visible to eligible society readers. Scheduled publishing is not available.</p>
        <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save draft changes' : 'Save notice draft'}</Button>{editingId ? <Button type="button" variant="outline" onClick={resetForm}>Cancel edit</Button> : null}</div>
      </form></CardContent>
    </Card> : null}

    {canManage ? <details className="rounded-lg border border-border bg-card p-4"><summary className="min-h-11 cursor-pointer py-2 font-headline text-lg font-bold">Schedule an AGM/SGM and prepare its governance record</summary><p className="pb-4 text-sm text-muted-foreground">Use this formal meeting workflow to record agenda, notice reference and clear-day policy. Publishing an ordinary notice below does not publish a governance meeting or complete a governance decision.</p><GovernancePage view="meetings" embedded /></details> : null}

    {!loading && !error && notices?.length === 0 ? <EmptyState title="No notices to show" description={canManage ? 'Create an everyday announcement or review another category.' : 'No published society notices match this category yet.'} /> : null}
    <section aria-labelledby="meeting-notices-title" className="space-y-3">
      <h2 id="meeting-notices-title" className="font-headline text-xl font-bold">Published meeting notices</h2>
      {meetingError ? <ErrorState title="Meeting notices unavailable" description={meetingError} onRetry={() => void refresh()} /> : null}
      {!loading && !meetingError && meetings?.filter((meeting) => meeting.status === 'PUBLISHED').length === 0 ? <p className="text-sm text-muted-foreground">No published AGM or SGM notices have been recorded.</p> : null}
      <div className="space-y-3">{meetings?.filter((meeting) => meeting.status === 'PUBLISHED').map((meeting) => <Card key={meeting._id} className="notice-record"><CardHeader><CardTitle>{meeting.title}</CardTitle><CardDescription>{meeting.type} · meeting {new Date(meeting.scheduledAt).toLocaleString()}</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><p>Notice reference: {meeting.noticeReference ?? 'Unavailable'} · issued {meeting.noticeIssuedAt ? new Date(meeting.noticeIssuedAt).toLocaleString() : 'date unavailable'}</p><p className="text-xs text-muted-foreground">Configured clear-notice period: {meeting.noticePeriodDays ?? 'not available'} days. Nivaas records the society-supplied reference; it does not verify notice delivery or legal sufficiency.</p>{meeting.agenda?.length ? <ul className="list-disc space-y-1 pl-5">{meeting.agenda.map((item, index) => <li key={`${meeting._id}-${index}`}>{item}</li>)}</ul> : null}</CardContent></Card>)}</div>
    </section>
    <div className="space-y-3">{notices?.map((notice) => <Card key={notice._id} className="notice-record">
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{notice.title}</CardTitle><CardDescription>{notice.category.replaceAll('_', ' ')} · {notice.priority}</CardDescription></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold">{notice.status}</span></div></CardHeader>
      <CardContent className="space-y-3"><p className="whitespace-pre-wrap text-sm leading-6">{notice.description}</p><p className="text-xs text-muted-foreground">{notice.publishedAt ? `Published ${new Date(notice.publishedAt).toLocaleString()}` : `Draft updated ${new Date(notice.updatedAt).toLocaleString()}`}{notice.expiresAt ? ` · Expires ${new Date(notice.expiresAt).toLocaleString()}` : ''}{notice.meetingId ? ' · Linked meeting' : ''}{notice.projectId ? ' · Linked project' : ''}</p>
        {token ? <NoticeAttachments noticeId={notice._id} attachmentIds={notice.attachmentIds} canUpload={canManage && notice.status === 'DRAFT'} token={token} onUploaded={refresh} /> : null}
        {canManage && notice.status === 'DRAFT' ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => editDraft(notice)}><Pencil size={15} aria-hidden="true" />Edit draft</Button><Button type="button" disabled={busyId === notice._id} onClick={() => void transition(notice, 'publish')}><Send size={15} aria-hidden="true" />{busyId === notice._id ? 'Publishing…' : 'Publish notice'}</Button></div> : null}
        {canManage && notice.status === 'PUBLISHED' ? <Button type="button" variant="outline" disabled={busyId === notice._id} onClick={() => void transition(notice, 'archive')}><Archive size={15} aria-hidden="true" />Archive notice</Button> : null}
      </CardContent>
    </Card>)}</div>
  </div>;
}
