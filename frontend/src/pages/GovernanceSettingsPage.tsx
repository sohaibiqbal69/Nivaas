import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { getActiveGovernanceRule, listSocietyRuleHistory, updateApprovalThreshold, type SocietyGovernanceRule } from '@/lib/governance';
import { getAuditLogProofStatus, submitAuditLogProof, verifyAuditLogProof } from '@/lib/blockchain';
import { proofDisplayState } from '@/pages/BlockchainPage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

type Anchor = { label: string; detail: string; retryable: boolean };

export function GovernanceSettingsPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canManage = user?.role === 'SOCIETY_MANAGER' && Boolean(user.societyId);
  const [active, setActive] = useState<SocietyGovernanceRule | null>(null);
  const [history, setHistory] = useState<SocietyGovernanceRule[] | null>(null);
  const [threshold, setThreshold] = useState('');
  const [reason, setReason] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const loadAnchor = useCallback(async (auditLogId: string | undefined) => {
    if (!auditLogId || !token) {
      setAnchor({ label: 'Not anchored', detail: 'No policy-change audit record is linked to this version.', retryable: false });
      return;
    }
    try {
      const [operation, verification] = await Promise.all([
        getAuditLogProofStatus(auditLogId, token), verifyAuditLogProof(auditLogId, token),
      ]);
      const state = proofDisplayState(operation, verification);
      const labels: Record<string, string> = {
        CONFIRMED: 'Verified on chain', PENDING: 'Pending reconciliation', FAILED: 'Submission failed',
        CONFLICT: 'Conflicting on-chain record', INTEGRITY_ERROR: 'Audit integrity error', NO_PROOF: 'Not anchored',
        PREVIOUS_DEPLOYMENT: 'Proof belongs to a previous deployment',
      };
      setAnchor({
        label: labels[state] ?? state,
        detail: state === 'CONFIRMED'
          ? 'Successful receipt and matching registry read-back verified.'
          : state === 'PREVIOUS_DEPLOYMENT' ? 'This proof operation belongs to a different deployment and cannot be confirmed against the active registry.'
          : state === 'PENDING' ? 'The registry outcome is not confirmed. Retry will reconcile before broadcasting again.'
            : state === 'CONFLICT' ? 'A different record is registered for this reference. It must not be overwritten.'
              : state === 'FAILED' ? 'The last attempt failed. Retry is safe and reconciles existing chain state first.'
                : state === 'INTEGRITY_ERROR' ? 'The persisted audit record does not match its canonical hash.'
                  : 'This version has no confirmed registry proof.',
        retryable: ['PENDING', 'FAILED', 'NO_PROOF', 'PREVIOUS_DEPLOYMENT'].includes(state),
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'BLOCKCHAIN_NOT_CONFIGURED') {
        setAnchor({ label: 'Unconfigured', detail: 'The backend blockchain registry is not configured; the policy remains active in MongoDB.', retryable: false });
      } else if (cause instanceof ApiError && cause.code === 'BLOCKCHAIN_PROOF_CONFLICT') {
        setAnchor({ label: 'Conflicting', detail: 'Registry verification found a conflicting proof. Do not retry as a replacement.', retryable: false });
      } else {
        setAnchor({ label: 'Status unavailable', detail: 'The policy is active, but blockchain status could not be verified.', retryable: true });
      }
    }
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !canManage) return;
    setLoading(true); setError(null);
    try {
      const [current, versions] = await Promise.all([getActiveGovernanceRule(token), listSocietyRuleHistory(token)]);
      setActive(current); setHistory(versions);
      setThreshold(current.approvalPolicy?.threshold ?? '');
      await loadAnchor(current.policyChangeAuditLogId);
    } catch (cause) {
      setActive(null); setHistory(null);
      setError(cause instanceof ApiError ? cause.message : 'Governance settings could not be loaded.');
    } finally { setLoading(false); }
  }, [canManage, loadAnchor, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || saving) return;
    setSaving(true); setNotice(null); setError(null);
    try {
      const result = await updateApprovalThreshold(token, {
        threshold,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(documentReference.trim() ? { supportingDocumentReference: documentReference.trim() } : {}),
      });
      setNotice(`Rule version ${result.versionNumber} is active. Anchor status: ${result.policyProof.status}.`);
      setReason(''); setDocumentReference('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The approval threshold was not changed.');
    } finally { setSaving(false); }
  }

  async function retryAnchor() {
    if (!token || !active?.policyChangeAuditLogId || retrying) return;
    setRetrying(true); setError(null);
    try {
      await submitAuditLogProof(active.policyChangeAuditLogId, token);
      await loadAnchor(active.policyChangeAuditLogId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Policy proof reconciliation could not complete.');
      await loadAnchor(active.policyChangeAuditLogId);
    } finally { setRetrying(false); }
  }

  if (!canManage) return <div ref={pageRef} className="page-settings space-y-6"><PageHeader eyebrow="Society configuration" title="Governance settings" description="View and configure the active society approval policy." /><PermissionDeniedState /></div>;

  return <div ref={pageRef} className="page-settings space-y-7">
    <PageHeader eyebrow="Society configuration" title="Governance settings" description="Review the active rule version and configure the project-spending approval threshold for this society." />
    {notice ? <p role="status" className="rounded-md border border-border bg-card px-4 py-3 text-sm">{notice}</p> : null}
    {error ? <ErrorState title="Governance settings need attention" description={error} onRetry={() => void refresh()} /> : null}
    {loading ? <LoadingState label="Loading active governance policy and version history" /> : null}
    {!loading && !active && !error ? <EmptyState title="No active rule version" description="A valid society rule version is required before its approval threshold can be changed." /> : null}
    {active ? <>
      <Card className="policy-summary">
        <CardHeader><CardTitle>Active project approval policy</CardTitle><CardDescription>Rule version {active.versionNumber} · effective {active.effectiveFrom ? new Date(active.effectiveFrom).toLocaleString() : 'time unavailable'}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <p className="font-headline text-3xl font-bold">{active.approvalPolicy?.threshold ? `₹${active.approvalPolicy.threshold}` : 'Threshold unavailable'}</p>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">This is a configurable Nivaas product setting, not a claim of universal legal compliance. The society must follow its applicable registered bye-laws and current law. Amounts at or below the active threshold follow the configured committee route; amounts above it follow the configured General Body/SGM route. Existing decisions retain their original rule-version snapshot.</p>
          <div className="rounded-md border border-border bg-muted/40 p-4" aria-live="polite">
            <p className="text-sm font-semibold">Policy anchor: {anchor?.label ?? 'Checking status…'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{anchor?.detail ?? 'Reading the saved operation and verifying the registry.'}</p>
            {active.policyChangeAuditLogId ? <p className="mt-2 break-all font-mono text-xs text-muted-foreground">AuditLog {active.policyChangeAuditLogId} · <Link className="underline underline-offset-2" to={`/blockchain?auditLogId=${encodeURIComponent(active.policyChangeAuditLogId)}`}>Open proof verification</Link></p> : null}
            {active.policyChangeAuditLogId && anchor?.retryable ? <Button className="mt-3" type="button" variant="outline" disabled={retrying} onClick={() => void retryAnchor()}>{retrying ? 'Reconciling…' : 'Reconcile / retry policy anchor'}</Button> : null}
          </div>
        </CardContent>
      </Card>
      <Card className="task-form">
        <CardHeader><CardTitle>Change threshold</CardTitle><CardDescription>Changes create a new immutable rule version and an audit event. Blockchain anchoring is attempted afterward and does not block activation.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void save(event)}>
            <label className="space-y-1.5 text-sm font-medium">Threshold in rupees<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3" aria-describedby="threshold-help" /><span id="threshold-help" className="block text-xs font-normal text-muted-foreground">Enter an exact non-negative decimal amount without a currency symbol.</span></label>
            <label className="space-y-1.5 text-sm font-medium">Reason (optional if reference supplied)<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3" /></label>
            <label className="space-y-1.5 text-sm font-medium md:col-span-2">Applicable registered rule / supporting document reference<input maxLength={240} value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3" /></label>
            <p className="text-xs leading-5 text-muted-foreground md:col-span-2">Provide a reason or document reference. Nivaas stores the society’s assertion; it does not verify legal adoption.</p>
            <div className="md:col-span-2"><Button type="submit" disabled={saving || !threshold.trim() || threshold === active.approvalPolicy?.threshold || (!reason.trim() && !documentReference.trim())}>{saving ? 'Saving new version…' : 'Activate new threshold version'}</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card className="policy-history">
        <CardHeader><CardTitle>Rule version history</CardTitle><CardDescription>Historical thresholds and decision context remain unchanged.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {!history?.length ? <EmptyState title="No rule history" description="No version history was returned by the service." /> : history.map((version) => <div key={version._id} className="flex flex-col gap-2 border-t border-border pt-3 text-sm sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold">Version {version.versionNumber} · {version.status} · {version.approvalPolicy?.threshold ? `₹${version.approvalPolicy.threshold}` : 'threshold unavailable'}</p><p className="text-xs text-muted-foreground">Effective {version.effectiveFrom ? new Date(version.effectiveFrom).toLocaleString() : 'time unavailable'} · actor {version.createdBy ?? 'unavailable'}</p>{version.changeReason ? <p className="text-xs text-muted-foreground">Reason: {version.changeReason}</p> : null}{version.supportingDocumentReference ? <p className="text-xs text-muted-foreground">Reference: {version.supportingDocumentReference}</p> : null}</div>{version.policyChangeAuditLogId ? <Link className="min-h-11 text-info underline underline-offset-4" to={`/blockchain?auditLogId=${encodeURIComponent(version.policyChangeAuditLogId)}`}>View anchor</Link> : <span className="text-xs text-muted-foreground">No policy-change anchor recorded</span>}</div>)}
        </CardContent>
      </Card>
    </> : null}
  </div>;
}
