import { describe, expect, it } from 'vitest';
import { calculateCommitteeOutcome, type CommitteeApprovalPolicy } from '../src/modules/approval/committee-outcome.js';

const policy: CommitteeApprovalPolicy = {
  quorumNumerator: 2,
  quorumDenominator: 3,
  majorityNumerator: 1,
  majorityDenominator: 2,
  majorityComparison: 'STRICTLY_GREATER',
};

describe('committee approval outcome', () => {
  it('tracks quorum independently from the approval majority', () => {
    expect(calculateCommitteeOutcome(6, ['APPROVE', 'APPROVE'], policy)).toMatchObject({
      quorumRequired: 4,
      quorumMet: false,
      outcome: 'NO_DECISION',
    });
    expect(calculateCommitteeOutcome(6, ['APPROVE', 'APPROVE', 'REJECT', 'REJECT'], policy)).toMatchObject({
      quorumRequired: 4,
      quorumMet: true,
      outcome: 'PENDING',
    });
  });

  it('approves only a strict majority and records rejection symmetrically', () => {
    expect(calculateCommitteeOutcome(3, ['APPROVE', 'REJECT'], policy).outcome).toBe('PENDING');
    expect(calculateCommitteeOutcome(3, ['APPROVE', 'APPROVE', 'REJECT'], policy).outcome).toBe('APPROVED');
    expect(calculateCommitteeOutcome(3, ['REJECT', 'REJECT', 'APPROVE'], policy).outcome).toBe('REJECTED');
  });

  it('records a unanimous decision with the full participation counts', () => {
    expect(calculateCommitteeOutcome(3, ['APPROVE', 'APPROVE', 'APPROVE'], policy)).toMatchObject({
      participatingMembers: 3,
      approveCount: 3,
      rejectCount: 0,
      quorumMet: true,
      outcome: 'APPROVED',
    });
  });

  it('honors configurable AT_LEAST majority and quorum cap', () => {
    expect(calculateCommitteeOutcome(12, ['APPROVE', 'APPROVE', 'REJECT'], {
      ...policy,
      quorumMaximum: 5,
      majorityNumerator: 2,
      majorityDenominator: 3,
      majorityComparison: 'AT_LEAST',
    })).toMatchObject({ quorumRequired: 5, quorumMet: false, requiredApprovalMajority: 2, outcome: 'NO_DECISION' });
  });
});
