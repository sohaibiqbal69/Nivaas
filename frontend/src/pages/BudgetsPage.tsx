import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError, apiRequest } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProgressTrack } from '@/components/ui/ProgressTrack';

type BudgetSummary = { _id: string; financialYear: string; title: string; description?: string; status: string; totalAllocated: string; totalSpent: string; totalRemaining: string; updatedAt: string };

export function BudgetsPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canRead = user?.role === 'SOCIETY_MANAGER' || user?.role === 'SYSTEM_ADMIN' || user?.role === 'OWNER_MEMBER';
  const [budgets, setBudgets] = useState<BudgetSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!token || !canRead) return;
    setLoading(true); setError(null);
    try { setBudgets(await apiRequest<BudgetSummary[]>('/budgets', { token })); }
    catch (cause) { setBudgets(null); setError(cause instanceof ApiError ? cause.message : 'Budget records could not be loaded.'); }
    finally { setLoading(false); }
  }, [canRead, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!canRead) return <div ref={pageRef} className="page-budget space-y-6"><PageHeader eyebrow="Financial records" title="Budget" description="Review budget records available to your account." /><PermissionDeniedState /></div>;
  return <div ref={pageRef} className="page-budget space-y-7">
    <PageHeader eyebrow="Financial records" title="Budget" description={user?.role === 'OWNER_MEMBER' ? 'Approved budget totals and recorded spending for your society. Draft and unapproved financial records are not shown.' : 'Read-only view of budget records returned by the society API. The MVP does not provide a complete accounting or payment workflow.'} />
    {loading ? <LoadingState label="Loading budget records" /> : null}
    {error ? <ErrorState title="Budget records unavailable" description={error} onRetry={() => void refresh()} /> : null}
    {!loading && !error && budgets?.length === 0 ? <EmptyState title="No budget records" description="No budgets were returned for the authorized society scope. This is a real API result, not a placeholder count." /> : null}
    <div className="grid gap-x-10 lg:grid-cols-2">{budgets?.map((budget) => <Card key={budget._id} className="budget-record"><CardHeader><div className="flex flex-wrap items-baseline justify-between gap-3"><div><CardTitle>{budget.title}</CardTitle><CardDescription>Financial year {budget.financialYear}</CardDescription></div><span className="record-status text-muted-foreground">{budget.status}</span></div></CardHeader><CardContent className="space-y-3 text-sm"><p>{budget.description || 'No description recorded.'}</p><dl className="grid grid-cols-3 gap-3 pt-2"><div><dt className="text-xs text-muted-foreground">Allocated</dt><dd className="budget-total mt-1">₹{budget.totalAllocated}</dd></div><div><dt className="text-xs text-muted-foreground">Spent recorded</dt><dd className="budget-total mt-1">₹{budget.totalSpent}</dd></div><div><dt className="text-xs text-muted-foreground">Remaining</dt><dd className="budget-total mt-1">₹{budget.totalRemaining}</dd></div></dl><ProgressTrack value={Number(budget.totalSpent)} max={Number(budget.totalAllocated)} label={`Recorded spending relative to allocation for ${budget.financialYear}`} valueText={`₹${budget.totalSpent} spent of ₹${budget.totalAllocated} allocated`} /><p className="text-xs text-muted-foreground">Application records only. Nivaas does not initiate bank transfers or provide payment processing.</p></CardContent></Card>)}</div>
  </div>;
}
