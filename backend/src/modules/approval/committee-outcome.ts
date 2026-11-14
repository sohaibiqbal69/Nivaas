export type CommitteeDecision = 'APPROVE' | 'REJECT';

export type CommitteeApprovalPolicy = {
  quorumNumerator: number;
  quorumDenominator: number;
  quorumMaximum?: number | null;
  majorityNumerator: number;
  majorityDenominator: number;
  majorityComparison: 'STRICTLY_GREATER' | 'AT_LEAST';
};

export type CommitteeOutcome = 'APPROVED' | 'REJECTED' | 'PENDING' | 'NO_DECISION';

export function calculateCommitteeOutcome(
  eligibleCount: number,
  decisions: readonly CommitteeDecision[],
  policy: CommitteeApprovalPolicy,
) {
  const quorumRequired = Math.min(
    Math.ceil(eligibleCount * policy.quorumNumerator / policy.quorumDenominator),
    policy.quorumMaximum ?? Number.MAX_SAFE_INTEGER,
  );
  const approveCount = decisions.filter((decision) => decision === 'APPROVE').length;
  const rejectCount = decisions.filter((decision) => decision === 'REJECT').length;
  const participatingMembers = approveCount + rejectCount;
  const quorumMet = eligibleCount > 0 && participatingMembers >= quorumRequired;
  const majorityRatio = participatingMembers * policy.majorityNumerator / policy.majorityDenominator;
  const majorityNeeded = policy.majorityComparison === 'STRICTLY_GREATER'
    ? Math.floor(majorityRatio) + 1
    : Math.ceil(majorityRatio);
  const approveMeets = approveCount >= majorityNeeded;
  const rejectMeets = rejectCount >= majorityNeeded;
  const outcome: CommitteeOutcome = !quorumMet
    ? 'NO_DECISION'
    : approveMeets && rejectMeets
      ? 'PENDING'
      : approveMeets
        ? 'APPROVED'
        : rejectMeets
          ? 'REJECTED'
          : 'PENDING';

  return {
    totalCommitteeMembers: eligibleCount,
    participatingMembers,
    approveCount,
    rejectCount,
    quorumRequired,
    quorumMet,
    requiredApprovalMajority: majorityNeeded,
    outcome,
  };
}
