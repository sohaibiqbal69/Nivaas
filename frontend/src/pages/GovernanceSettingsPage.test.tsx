import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { GovernanceSettingsPage } from './GovernanceSettingsPage';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), getActiveGovernanceRule: vi.fn(), listSocietyRuleHistory: vi.fn(),
  updateApprovalThreshold: vi.fn(), getAuditLogProofStatus: vi.fn(), verifyAuditLogProof: vi.fn(),
  submitAuditLogProof: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/usePageMotion', () => ({ usePageMotion: () => ({ current: null }) }));
vi.mock('@/lib/governance', () => ({
  getActiveGovernanceRule: mocks.getActiveGovernanceRule,
  listSocietyRuleHistory: mocks.listSocietyRuleHistory,
  updateApprovalThreshold: mocks.updateApprovalThreshold,
}));
vi.mock('@/lib/blockchain', () => ({
  getAuditLogProofStatus: mocks.getAuditLogProofStatus,
  verifyAuditLogProof: mocks.verifyAuditLogProof,
  submitAuditLogProof: mocks.submitAuditLogProof,
}));
vi.mock('@/pages/BlockchainPage', () => ({ proofDisplayState: vi.fn() }));

describe('GovernanceSettingsPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.useAuth.mockReturnValue({ user: { role: 'SOCIETY_MANAGER', societyId: 'society-1' }, token: 'manager-token' });
    mocks.getActiveGovernanceRule.mockResolvedValue({ _id: 'rule-2', societyId: 'society-1', versionNumber: 2, status: 'ACTIVE', effectiveFrom: '2026-10-01T00:00:00Z', createdBy: 'manager-1', approvalPolicy: { threshold: '125000' } });
    mocks.listSocietyRuleHistory.mockResolvedValue([]);
    mocks.getAuditLogProofStatus.mockResolvedValue(null);
    mocks.verifyAuditLogProof.mockResolvedValue({ auditLogId: 'audit-1', proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); vi.clearAllMocks();
  });

  it('displays the active threshold from the server and the policy applicability caveat', async () => {
    await act(async () => root.render(<MemoryRouter><GovernanceSettingsPage /></MemoryRouter>));
    expect(container.textContent).toContain('Rule version 2');
    expect(container.textContent).toContain('₹125000');
    expect(container.textContent).toContain('not a claim of universal legal compliance');
    expect(container.textContent).toContain('Not anchored');
  });

  it('does not expose the settings form to a resident', async () => {
    mocks.useAuth.mockReturnValue({ user: { role: 'RESIDENT', societyId: 'society-1' }, token: 'resident-token' });
    await act(async () => root.render(<MemoryRouter><GovernanceSettingsPage /></MemoryRouter>));
    expect(container.textContent).toContain('Permission required');
    expect(container.textContent).not.toContain('Activate new threshold version');
    expect(mocks.getActiveGovernanceRule).not.toHaveBeenCalled();
  });
});
