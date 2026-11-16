import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { BlockchainPage, blockchainNetworkName, proofDisplayState, transactionExplorerUrl } from './BlockchainPage';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), listAuditLogs: vi.fn(), getAuditLogById: vi.fn(), getAuditLogProofStatus: vi.fn(),
  verifyAuditLogProof: vi.fn(), submitAuditLogProof: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/blockchain', () => ({
  listAuditLogs: mocks.listAuditLogs, getAuditLogById: mocks.getAuditLogById,
  getAuditLogProofStatus: mocks.getAuditLogProofStatus, verifyAuditLogProof: mocks.verifyAuditLogProof,
  submitAuditLogProof: mocks.submitAuditLogProof,
}));

describe('blockchain proof display', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.useAuth.mockReset(); });

  it('names supported networks and links Sepolia transactions to Etherscan', () => {
    const hash = `0x${'a'.repeat(64)}`;
    expect(blockchainNetworkName('11155111')).toBe('Sepolia');
    expect(blockchainNetworkName('31337')).toBe('Localhost');
    expect(transactionExplorerUrl('11155111', hash)).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
    expect(transactionExplorerUrl('31337', hash)).toBeUndefined();
    expect(transactionExplorerUrl('11155111', 'bad-hash')).toBeUndefined();
  });

  it('requires registry verification before displaying a proof as confirmed', () => {
    expect(proofDisplayState({ status: 'CONFIRMED' }, { auditLogId: 'a', proofStatus: 'PENDING', verified: false })).toBe('PENDING');
    expect(proofDisplayState({ status: 'CONFIRMED' }, { auditLogId: 'a', proofStatus: 'CONFIRMED', verified: true })).toBe('CONFIRMED');
    expect(proofDisplayState({ status: 'CONFIRMED' }, { auditLogId: 'a', proofStatus: 'UNKNOWN', verified: false })).toBe('UNVERIFIABLE');
    expect(proofDisplayState(null, { auditLogId: 'a', proofStatus: 'UNVERIFIABLE', verified: false })).toBe('UNVERIFIABLE');
    expect(proofDisplayState({ status: 'PENDING' }, { auditLogId: 'a', proofStatus: 'UNVERIFIABLE', verified: false })).toBe('PENDING');
    expect(proofDisplayState({ status: 'FAILED' }, { auditLogId: 'a', proofStatus: 'UNVERIFIABLE', verified: false })).toBe('FAILED');
    expect(proofDisplayState(null, { auditLogId: 'a', proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true })).toBe('NO_PROOF');
    expect(proofDisplayState({ status: 'FAILED' }, { auditLogId: 'a', proofStatus: 'UNKNOWN', verified: false })).toBe('FAILED');
    expect(proofDisplayState({ status: 'STALE_DEPLOYMENT' }, { auditLogId: 'a', proofStatus: 'UNKNOWN', verified: false })).toBe('PREVIOUS_DEPLOYMENT');
    expect(proofDisplayState({ status: 'STALE_DEPLOYMENT' }, { auditLogId: 'a', proofStatus: 'CONFIRMED', verified: true })).toBe('CONFIRMED');
    expect(proofDisplayState(null, { auditLogId: 'a', proofStatus: 'CONFLICT', verified: false })).toBe('CONFLICT');
    expect(proofDisplayState(null, { auditLogId: 'a', proofStatus: 'NOT_VERIFIED', verified: false, recordIntegrity: false })).toBe('INTEGRITY_ERROR');
  });

  it('loads a linked historical event directly and refreshes status after proof submission', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { role: 'SOCIETY_MANAGER', societyId: 'society-1' }, token: 'token' });
    const recent = { _id: 'recent-id', societyId: 'society-1', action: 'RECENT_EVENT', recordHash: '0x1', createdAt: '2026-10-20T00:00:00.000Z' };
    const historical = { _id: 'historical-id', societyId: 'society-1', action: 'OLD_EVENT', recordHash: '0x2', createdAt: '2023-04-05T06:07:08.000Z' };
    mocks.listAuditLogs.mockResolvedValue([recent]);
    mocks.getAuditLogById.mockResolvedValue(historical);
    mocks.getAuditLogProofStatus.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'CONFIRMED' });
    mocks.verifyAuditLogProof.mockResolvedValueOnce({ auditLogId: historical._id, proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true })
      .mockResolvedValueOnce({ auditLogId: historical._id, proofStatus: 'CONFIRMED', verified: true, recordIntegrity: true, transactionHash: '0xtx', receiptStatus: 1 });
    mocks.submitAuditLogProof.mockResolvedValue({ status: 'CONFIRMED' });
    const container = document.createElement('div'); document.body.append(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={['/blockchain?auditLogId=historical-id']}><BlockchainPage /></MemoryRouter>));
      expect(mocks.getAuditLogById).toHaveBeenCalledWith('historical-id', 'token');
      expect((container.querySelector('select') as HTMLSelectElement).value).toBe('historical-id');
      expect(container.textContent).toContain('Proof status: NO PROOF');
      const submit = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Submit proof'));
      expect(submit).toBeDefined();
      await act(async () => submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(mocks.submitAuditLogProof).toHaveBeenCalledWith('historical-id', 'token');
      expect(container.textContent).toContain('Proof status: CONFIRMED');
    } finally {
      await act(async () => root.unmount()); container.remove();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    }
  });

  it('shows a failed submission error and permits a later retry to refresh as confirmed', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { role: 'SOCIETY_MANAGER', societyId: 'society-1' }, token: 'token' });
    const record = { _id: 'audit-id', societyId: 'society-1', action: 'PROJECT_SUBMITTED', recordHash: '0x1', createdAt: '2026-10-20T00:00:00.000Z' };
    mocks.listAuditLogs.mockResolvedValue([record]);
    mocks.getAuditLogProofStatus.mockResolvedValueOnce({ status: 'FAILED', lastErrorCode: 'BLOCKCHAIN_REVERTED' })
      .mockResolvedValueOnce({ status: 'CONFIRMED' });
    mocks.verifyAuditLogProof.mockResolvedValueOnce({ auditLogId: record._id, proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true })
      .mockResolvedValueOnce({ auditLogId: record._id, proofStatus: 'CONFIRMED', verified: true, recordIntegrity: true });
    mocks.submitAuditLogProof.mockRejectedValueOnce(new ApiError({ status: 503, code: 'BLOCKCHAIN_OUTCOME_AMBIGUOUS', message: 'RPC request timed out.' }))
      .mockResolvedValueOnce({ status: 'CONFIRMED' });
    const container = document.createElement('div'); document.body.append(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => root.render(<MemoryRouter><BlockchainPage /></MemoryRouter>));
      expect(container.textContent).toContain('BLOCKCHAIN_REVERTED');
      const retry = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Reconcile / retry proof'));
      await act(async () => retry()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(container.textContent).toContain('RPC request timed out.');
      await act(async () => retry()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(mocks.submitAuditLogProof).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('Proof status: CONFIRMED');
    } finally {
      await act(async () => root.unmount()); container.remove();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    }
  });

  it('keeps audit proof verification behind existing audit roles', () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'SYSTEM_ADMIN' }, token: 'admin-token' });
    expect(renderToStaticMarkup(<MemoryRouter><BlockchainPage /></MemoryRouter>)).toContain('Choose an audit record');
    mocks.useAuth.mockReturnValue({ user: { role: 'RESIDENT' }, token: 'resident-token' });
    expect(renderToStaticMarkup(<MemoryRouter><BlockchainPage /></MemoryRouter>)).toContain('Permission required');
    mocks.useAuth.mockReturnValue({ user: { role: 'OWNER_MEMBER', societyId: 'society-1' }, token: 'owner-token' });
    expect(renderToStaticMarkup(<MemoryRouter><BlockchainPage /></MemoryRouter>)).toContain('Choose an audit record');
    expect(renderToStaticMarkup(<MemoryRouter><BlockchainPage /></MemoryRouter>)).not.toContain('Submit proof to current deployment');
  });
});
