import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { getAuditLogById, getAuditLogProofStatus, listAuditLogs, submitAuditLogProof, verifyAuditLogProof, type AuditLogSummary, type ProofOperationStatus, type ProofVerification } from '@/lib/blockchain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProofVerificationRail } from '@/components/blockchain/ProofVerificationRail';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

const READ_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER']);
const WRITE_ROLES = new Set(['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER']);

export function proofDisplayState(operation: ProofOperationStatus | null, verification: ProofVerification): 'CONFIRMED' | 'PENDING' | 'FAILED' | 'CONFLICT' | 'NO_PROOF' | 'INTEGRITY_ERROR' | 'PREVIOUS_DEPLOYMENT' | 'UNVERIFIABLE' {
  if (verification.verified && verification.proofStatus === 'CONFIRMED') return 'CONFIRMED';
  if (verification.proofStatus === 'CONFLICT') return 'CONFLICT';
  if (verification.proofStatus === 'NOT_VERIFIED' || verification.recordIntegrity === false) return 'INTEGRITY_ERROR';
  if (verification.proofStatus === 'PENDING' || operation?.status === 'PENDING') return 'PENDING';
  if (operation?.status === 'FAILED' && ['UNKNOWN', 'UNVERIFIABLE'].includes(verification.proofStatus)) return 'FAILED';
  if (verification.proofStatus === 'UNVERIFIABLE' || (verification.proofStatus === 'UNKNOWN' && operation?.status === 'CONFIRMED')) return 'UNVERIFIABLE';
  if (operation?.status === 'STALE_DEPLOYMENT' && verification.proofStatus === 'UNKNOWN') return 'PREVIOUS_DEPLOYMENT';
  return 'NO_PROOF';
}

export function BlockchainPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const [searchParams] = useSearchParams();
  const requestedAuditLogId = searchParams.get('auditLogId');
  const { user, token } = useAuth();
  const canRead = Boolean(user && READ_ROLES.has(user.role));
  const canWrite = Boolean(user && WRITE_ROLES.has(user.role));
  const [records, setRecords] = useState<AuditLogSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [operation, setOperation] = useState<ProofOperationStatus | null>(null);
  const [verification, setVerification] = useState<ProofVerification | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [loadingMoreRecords, setLoadingMoreRecords] = useState(false);
  const [recordPage, setRecordPage] = useState(1);
  const [hasMoreRecords, setHasMoreRecords] = useState(false);
  const [loadingProof, setLoadingProof] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configurationState, setConfigurationState] = useState<'UNKNOWN' | 'UNCONFIGURED' | 'UNAVAILABLE'>('UNKNOWN');

  const loadRecords = useCallback(async () => {
    if (!token || !canRead) return;
    setLoadingRecords(true); setError(null);
    try {
      const result = await listAuditLogs(token, { page: 1, pageSize: 50 });
      let visibleRecords = result;
      if (requestedAuditLogId && !result.some((record) => record._id === requestedAuditLogId)) {
        try {
          const linkedRecord = await getAuditLogById(requestedAuditLogId, token);
          visibleRecords = [linkedRecord, ...result];
        } catch (cause) {
          setError(cause instanceof ApiError ? cause.message : 'The linked audit event could not be loaded.');
        }
      }
      setRecords(visibleRecords);
      setRecordPage(1);
      setHasMoreRecords(result.length === 50);
      setSelectedId((current) => requestedAuditLogId
        ? visibleRecords.some((record) => record._id === requestedAuditLogId) ? requestedAuditLogId : ''
        : current && visibleRecords.some((record) => record._id === current) ? current : visibleRecords[0]?._id ?? '');
    } catch (cause) {
      setRecords(null);
      setError(cause instanceof ApiError ? cause.message : 'Audit records could not be loaded.');
    } finally { setLoadingRecords(false); }
  }, [canRead, requestedAuditLogId, token]);

  async function loadMoreRecords() {
    if (!token || loadingMoreRecords || !hasMoreRecords) return;
    setLoadingMoreRecords(true); setError(null);
    try {
      const nextPage = recordPage + 1;
      const result = await listAuditLogs(token, { page: nextPage, pageSize: 50 });
      const combined = [...new Map([...(records ?? []), ...result].map((record) => [record._id, record])).values()];
      setRecords(combined);
      if (requestedAuditLogId && combined.some((record) => record._id === requestedAuditLogId)) setSelectedId(requestedAuditLogId);
      setRecordPage(nextPage);
      setHasMoreRecords(result.length === 50);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'More audit records could not be loaded.');
    } finally { setLoadingMoreRecords(false); }
  }

  const loadProof = useCallback(async (auditLogId: string) => {
    if (!token || !auditLogId) return;
    setLoadingProof(true); setError(null); setConfigurationState('UNKNOWN'); setOperation(null); setVerification(null);
    try {
        const [savedOperation, onChainVerification] = await Promise.allSettled([
        getAuditLogProofStatus(auditLogId, token),
        verifyAuditLogProof(auditLogId, token),
      ]);
        if (savedOperation.status === 'fulfilled') setOperation(savedOperation.value);
        if (onChainVerification.status === 'rejected') throw onChainVerification.reason;
        if (savedOperation.status === 'rejected') throw savedOperation.reason;
        setVerification(onChainVerification.value);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'BLOCKCHAIN_NOT_CONFIGURED') setConfigurationState('UNCONFIGURED');
      else if (cause instanceof ApiError && (cause.status === 0 || cause.status === 503 || cause.code.startsWith('BLOCKCHAIN_'))) setConfigurationState('UNAVAILABLE');
      setError(cause instanceof ApiError ? cause.message : 'Proof verification could not be completed.');
    } finally { setLoadingProof(false); }
  }, [token]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => { if (selectedId) void loadProof(selectedId); }, [loadProof, selectedId]);

  async function reconcileOrSubmit() {
    if (!token || !selectedId) return;
    setSubmitting(true); setError(null);
    try {
      await submitAuditLogProof(selectedId, token);
      await loadProof(selectedId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'BLOCKCHAIN_NOT_CONFIGURED') setConfigurationState('UNCONFIGURED');
      else if (cause instanceof ApiError && (cause.status === 0 || cause.status === 503 || cause.code.startsWith('BLOCKCHAIN_'))) setConfigurationState('UNAVAILABLE');
      setError(cause instanceof ApiError ? cause.message : 'Proof submission could not be confirmed.');
    } finally { setSubmitting(false); }
  }

  if (!canRead) return <div ref={pageRef} className="page-blockchain space-y-6"><PageHeader eyebrow="Integrity and verification" title="Blockchain proofs" description="Verify the integrity proof for a society audit record." /><PermissionDeniedState /></div>;
  const currentRecord = records?.find((record) => record._id === selectedId);
  const status = verification ? proofDisplayState(operation, verification) : null;

  return (
    <div ref={pageRef} className="page-blockchain space-y-6">
      <PageHeader eyebrow="Integrity and verification" title="Blockchain proofs" description="Choose an audit record to check its proof against the configured registry. A proof confirms record integrity, not the truth or legal validity of the event." />
      <Card className="task-form"><CardHeader><CardTitle>Choose an audit record</CardTitle><CardDescription>The list comes from the authenticated audit API and follows its society access scope. Records are loaded 50 at a time; the backend does not provide aggregate proof counts.</CardDescription></CardHeader><CardContent className="space-y-3">
        {loadingRecords ? <LoadingState label="Loading authorized audit records" /> : null}
        {!loadingRecords && error && !records ? <ErrorState title="Audit records unavailable" description={error} onRetry={() => void loadRecords()} /> : null}
        {!loadingRecords && records?.length === 0 ? <EmptyState title="No audit records yet" description="Once authorized society activity creates audit records, choose one here to inspect its proof status." /> : null}
        {records && records.length > 0 ? <label className="block w-full space-y-2 text-sm font-semibold">Audit record
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring">{records.map((record) => <option key={record._id} value={record._id}>{record.action.replaceAll('_', ' ')} · {record.entityType ?? 'record'} · {new Date(record.createdAt).toLocaleString()} · {record._id}</option>)}</select>
        </label> : null}
        {requestedAuditLogId && records && !records.some((record) => record._id === requestedAuditLogId) ? <p className="text-sm text-muted-foreground" role="status">The linked audit event is older than the loaded records. Load more records to find it.</p> : null}
        {hasMoreRecords ? <Button type="button" variant="outline" disabled={loadingMoreRecords} onClick={() => void loadMoreRecords()}>{loadingMoreRecords ? 'Loading more…' : 'Load more audit records'}</Button> : null}
      </CardContent></Card>

      {error && records ? <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
      {currentRecord && loadingProof ? <LoadingState label="Reading proof operation and verifying against the registry" /> : null}
      {currentRecord && configurationState === 'UNCONFIGURED' ? <Card className="border-warning/40"><CardHeader><CardTitle>Blockchain is not configured</CardTitle><CardDescription>The backend has no usable local registry configuration. No proof state is being inferred.</CardDescription></CardHeader></Card> : null}
      {currentRecord && configurationState === 'UNAVAILABLE' ? <Card className="border-danger/40"><CardHeader><CardTitle>Blockchain registry unavailable</CardTitle><CardDescription>{error ?? 'The backend could not reach or validate the configured local registry.'}</CardDescription></CardHeader></Card> : null}
      {currentRecord && operation && !loadingProof && (status === 'UNVERIFIABLE' || !verification) ? <p className="rounded-md border border-border p-3 text-sm">Saved operation (not currently verified): chain {operation.chainId ?? 'unknown'}, contract <span className="break-all font-mono">{operation.contractAddress ?? 'unknown'}</span>. Deployment <span className="break-all font-mono">{operation.deploymentTransactionHash ?? 'unknown'}</span>. Last saved transaction <span className="break-all font-mono">{operation.attempts?.at(-1)?.transactionHash ?? 'not recorded'}</span>.</p> : null}
      {currentRecord && status && !loadingProof ? <Card className="verification-panel">
        <CardHeader><CardTitle>Proof status: {status.replaceAll('_', ' ')}</CardTitle><CardDescription>{currentRecord.action.replaceAll('_', ' ')} · {new Date(currentRecord.createdAt).toLocaleString()}</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ProofVerificationRail recordIntegrity={verification?.recordIntegrity} status={status} verified={verification?.verified ?? false} receiptStatus={verification?.receiptStatus} />
          {status === 'CONFIRMED' ? <p role="status">The record hash matched the registry read-back and a successful transaction receipt was verified.</p> : null}
          {status === 'NO_PROOF' ? <p role="status">This AuditLog currently has no registered on-chain proof. Its stored record integrity is {verification?.recordIntegrity ? 'valid' : 'not verified'}.</p> : null}
          {status === 'UNVERIFIABLE' ? <p role="status">A proof was previously confirmed, but cannot be verified on the active chain. Restarting Hardhat erases local chain state, even if the address and deployment hash are reused. Historical transaction metadata is retained; it is not current confirmation. You may register a new proof on the current deployment.</p> : null}
          {status === 'PENDING' ? <p role="status">A proof transaction or registry registration is pending. It is not confirmed.</p> : null}
          {status === 'FAILED' ? <p role="status">The last proof operation failed. Retry will reconcile registry state before another attempt.</p> : null}
          {status === 'PREVIOUS_DEPLOYMENT' ? <p role="status">A proof operation exists for a different contract deployment. It cannot be confirmed against the current deployment. Submit to the current deployment only if that is the intended active chain.</p> : null}
          {status === 'CONFLICT' ? <p role="alert">The chain record conflicts with this AuditLog. Do not overwrite or retry as a replacement proof.</p> : null}
          {status === 'INTEGRITY_ERROR' ? <p role="alert">The persisted AuditLog does not match its canonical hash. Blockchain proof cannot verify this record.</p> : null}
          <p className="break-all font-mono text-xs text-muted-foreground">AuditLog ID: {currentRecord._id}</p>
          {verification?.chainId ? <p>Chain ID {verification.chainId} · contract <span className="break-all font-mono text-xs">{verification.contractAddress}</span></p> : null}
          {status === 'PREVIOUS_DEPLOYMENT' && operation ? <div className="rounded border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground"><p>Previous operation: chain {operation.chainId ?? 'unknown'} · contract <span className="break-all font-mono">{operation.contractAddress ?? 'unknown'}</span></p><p className="mt-1 break-all font-mono">Deployment {operation.deploymentTransactionHash ?? 'unknown'}{operation.attempts?.at(-1)?.transactionHash ? ` · transaction ${operation.attempts.at(-1)?.transactionHash}` : ''}</p></div> : null}
          {verification?.transactionHash ? <p>Transaction <span className="break-all font-mono text-xs">{verification.transactionHash}</span></p> : null}
          {verification?.blockNumber !== undefined ? <p>Block {verification.blockNumber} · receipt status {verification.receiptStatus}</p> : null}
          {verification?.recordReference ? <p className="break-all font-mono text-xs text-muted-foreground">Reference: {verification.recordReference}</p> : null}
          {operation?.lastErrorCode ? <p className="text-danger" role="status">Last submission diagnostic: <span className="font-mono">{operation.lastErrorCode}</span></p> : null}
          {canWrite && ['NO_PROOF', 'FAILED', 'PENDING', 'PREVIOUS_DEPLOYMENT', 'UNVERIFIABLE'].includes(status) ? <Button type="button" variant="outline" disabled={submitting || loadingProof} onClick={() => void reconcileOrSubmit()}>{submitting ? 'Reconciling proof…' : ['NO_PROOF', 'PREVIOUS_DEPLOYMENT', 'UNVERIFIABLE'].includes(status) ? 'Submit proof to current deployment' : 'Reconcile / retry proof'}</Button> : null}
        </CardContent>
      </Card> : null}
    </div>
  );
}
