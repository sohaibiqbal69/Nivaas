import { describe, expect, it } from 'vitest';
import { hashApprovalPolicyCommitment, validateApprovalThresholdInput } from '../src/modules/society/approval-policy.js';

describe('versioned project approval threshold', () => {
  it('accepts an exact decimal and requires a reason or supporting reference', () => {
    expect(validateApprovalThresholdInput({ threshold: '100000.25', reason: 'Approved in society meeting' })).toEqual({
      threshold: '100000.25', reason: 'Approved in society meeting',
    });
    expect(() => validateApprovalThresholdInput({ threshold: '100000' })).toThrow('A change reason or supporting document reference is required.');
  });

  it('rejects malformed numbers and unsupported configuration fields', () => {
    for (const threshold of ['', '-1', '1e5', '01', '₹100']) {
      expect(() => validateApprovalThresholdInput({ threshold, reason: 'recorded' })).toThrow();
    }
    expect(() => validateApprovalThresholdInput({ threshold: '100000', reason: 'recorded', arbitraryRule: true })).toThrow('unsupported approval policy fields');
  });

  it('domain-separates commitments by society, version, and threshold', () => {
    const base = { societyId: '68a123456789012345678901', versionNumber: 2, threshold: '100000' };
    const hash = hashApprovalPolicyCommitment(base);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashApprovalPolicyCommitment(base)).toBe(hash);
    expect(hashApprovalPolicyCommitment({ ...base, societyId: '68a123456789012345678902' })).not.toBe(hash);
    expect(hashApprovalPolicyCommitment({ ...base, versionNumber: 3 })).not.toBe(hash);
    expect(hashApprovalPolicyCommitment({ ...base, threshold: '100001' })).not.toBe(hash);
  });

  it('validates and commits configurable committee quorum and majority settings', () => {
    const committeeApproval = {
      quorumNumerator: 3, quorumDenominator: 4, quorumMaximum: 7,
      majorityNumerator: 2, majorityDenominator: 3, majorityComparison: 'AT_LEAST' as const,
    };
    expect(validateApprovalThresholdInput({ threshold: '100000', reason: 'policy update', committeeApproval })).toMatchObject({ committeeApproval });
    expect(() => validateApprovalThresholdInput({ threshold: '100000', reason: 'policy update', committeeApproval: { quorumNumerator: 4, quorumDenominator: 3, majorityNumerator: 1, majorityDenominator: 2, majorityComparison: 'STRICTLY_GREATER' } })).toThrow();
    const base = { societyId: '68a123456789012345678901', versionNumber: 2, threshold: '100000' };
    expect(hashApprovalPolicyCommitment({ ...base, committeeApproval })).not.toBe(hashApprovalPolicyCommitment(base));
  });
});
