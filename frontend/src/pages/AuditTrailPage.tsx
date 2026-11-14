import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { listAuditLogs, type AuditLogSummary } from '@/lib/blockchain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

const AUDIT_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER']);
const PAGE_SIZE = 25;
type AuditFilters = { search?: string; from?: string; to?: string };

export function AuditTrailPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canRead = Boolean(user && AUDIT_ROLES.has(user.role));
  const [records, setRecords] = useState<AuditLogSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [filters, setFilters] = useState<AuditFilters>({});

  const refresh = useCallback(async () => {
    if (!token || !canRead) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await listAuditLogs(token, { page, pageSize: PAGE_SIZE, ...filters });
      setRecords(result);
      setHasNext(result.length === PAGE_SIZE);
    } catch (cause) { setRecords(null); setError(cause instanceof ApiError ? cause.message : 'Audit records could not be loaded.'); }
    finally { setLoading(false); }
  }, [canRead, filters, page, token]);
  useEffect(() => { void refresh(); }, [refresh]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const localDate = (value: string, end: boolean) => value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined;
    setPage(1);
    setFilters({
      ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      ...(fromInput ? { from: localDate(fromInput, false) } : {}),
      ...(toInput ? { to: localDate(toInput, true) } : {}),
    });
  }

  function clearFilters() {
    setSearchInput(''); setFromInput(''); setToInput(''); setFilters({}); setPage(1);
  }

  if (!canRead) return <div ref={pageRef} className="page-audit space-y-6"><PageHeader eyebrow="Historical records" title="Audit Trail" description="Review application events authorized for your account." /><PermissionDeniedState /></div>;
  return <div ref={pageRef} className="page-audit space-y-6">
    <PageHeader eyebrow="Historical records" title="Audit Trail" description="Search society activity and inspect record integrity or its separate blockchain proof." />
    <Card className="task-form"><CardHeader><CardTitle>Search activity</CardTitle><CardDescription>Search event names and related project, quotation or vendor text. Date and society access filters are applied by the service.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={applyFilters}>
        <label className="space-y-1 text-sm font-medium sm:col-span-2 lg:col-span-1">Search events and related records<input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="e.g. CCTV or quotation/vendor name" className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <label className="space-y-1 text-sm font-medium">From<input type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <label className="space-y-1 text-sm font-medium">To<input type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3" /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={loading}>Apply filters</Button><Button type="button" variant="outline" disabled={loading} onClick={clearFilters}>Clear</Button></div>
      </form>
    </CardContent></Card>
    {loading ? <LoadingState label="Loading authorized audit events" /> : null}
    {error ? <ErrorState title="Audit events unavailable" description={error} onRetry={() => void refresh()} /> : null}
    {!loading && !error && records?.length === 0 ? <EmptyState title="No audit events" description={Object.keys(filters).length ? 'No events match these filters.' : 'No events were returned for the authenticated society scope.'} /> : null}
    <div className="space-y-0">{records?.map((record) => <Card key={record._id} className="audit-record"><CardHeader className="pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{record.eventTitle ?? record.action.replaceAll('_', ' ')}</CardTitle><CardDescription>{record.relatedTitle ? `${record.relatedTitle} · ` : ''}{record.entityType ?? 'Application event'} · {new Date(record.createdAt).toLocaleString()}</CardDescription></div><span className="record-status">Record integrity: {record.integrity?.status ?? 'not available'}</span></div></CardHeader><CardContent className="space-y-2 text-sm"><p className="break-all font-mono text-xs text-muted-foreground">Event {record._id} · canonical record hash {record.recordHash}</p><Link className="inline-flex min-h-11 items-center font-semibold text-info" to={`/blockchain?auditLogId=${encodeURIComponent(record._id)}`}>Inspect blockchain proof</Link></CardContent></Card>)}</div>
    {!loading && !error ? <div className="flex items-center justify-between"><Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} · {records?.length ?? 0} records</span><Button type="button" variant="outline" disabled={!hasNext} onClick={() => setPage((current) => current + 1)}>Next</Button></div> : null}
  </div>;
}
