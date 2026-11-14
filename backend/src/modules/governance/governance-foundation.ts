import { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import type { CurrentUserContext } from '../../middleware/load-current-user.js';
import {
  GOVERNANCE_POLICY_SCHEMA_VERSION,
  type GovernancePolicyConfiguration,
} from './models/GovernancePolicyConfiguration.js';
import type { GovernanceVoteRecord } from './models/GovernanceVote.js';

// Runtime is enabled only for a complete, confirmed GENERAL_BODY policy. Policy
// shape and body restrictions below keep committee/special decision paths closed.
export const GOVERNANCE_DECISION_RUNTIME_ENABLED = true;

export type SocietyScopedReference = {
  kind: string;
  _id: string | { toString(): string };
  societyId: string | { toString(): string };
};

export function assertGovernanceReferencesShareSociety(
  expectedSocietyId: string,
  references: SocietyScopedReference[],
): void {
  const expected = normalizeId(expectedSocietyId);
  if (!expected) throw new ApiError(400, 'VALIDATION_ERROR', 'A valid societyId is required.');
  for (const reference of references) {
    if (normalizeId(reference.societyId) !== expected) {
      throw new ApiError(404, 'NOT_FOUND', `The ${reference.kind} was not found in this society.`);
    }
  }
}

export type GovernanceResolutionPrerequisites = {
  _id: string | { toString(): string };
  societyId: string | { toString(): string };
  ruleVersionId: string | { toString(): string };
  resolutionType: string;
  decisionBody: string;
  status: string;
};

export type GovernanceRuleVersionEvidence = {
  _id: string | { toString(): string };
  societyId: string | { toString(): string };
  governancePolicy?: GovernancePolicyConfiguration;
};

export type GovernanceEligibilityEvidence = {
  _id: string | { toString(): string };
  societyId: string | { toString(): string };
  resolutionId: string | { toString(): string };
  ruleVersionId: string | { toString(): string };
  eligibleMemberIds: Array<string | { toString(): string }>;
  eligibleCount: number;
};

export function assertGovernancePolicyConfigured(
  resolution: GovernanceResolutionPrerequisites,
  ruleVersion: GovernanceRuleVersionEvidence | undefined,
): void {
  if (!ruleVersion
    || normalizeId(ruleVersion._id) !== normalizeId(resolution.ruleVersionId)
    || normalizeId(ruleVersion.societyId) !== normalizeId(resolution.societyId)) {
    throw policyRequired('The referenced society rule version was not found for this resolution.');
  }
  const configuration = ruleVersion.governancePolicy;
  if (!configuration || configuration.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_VERSION
    || configuration.confirmationState !== 'CONFIRMED'
    || !configuration.confirmedDocumentReference?.trim() || !configuration.confirmedAt || !configuration.confirmedBy) {
    throw policyRequired('A confirmed, versioned governance policy is required.');
  }
  const decisionPolicy = configuration.decisionPolicies?.find((item) =>
    item.resolutionType === resolution.resolutionType && item.decisionBody === resolution.decisionBody);
  if (!decisionPolicy || !hasCompleteDecisionPolicy(decisionPolicy)) {
    throw policyRequired('The rule version has no complete policy for this resolution type and decision body.');
  }
  if (resolution.decisionBody !== 'GENERAL_BODY'
    || resolution.resolutionType !== 'OTHER' && resolution.resolutionType !== 'PROJECT_APPROVAL') {
    throw policyRequired('Only ordinary general-body resolutions are enabled; committee and special decision types remain disabled.');
  }
  if (decisionPolicy.voting?.ballotPrivacy !== 'RECORDED'
    || decisionPolicy.voting?.oneMemberOneVote !== true
    || decisionPolicy.voting?.voteChangePolicy !== 'IMMUTABLE_AFTER_CAST'
    || decisionPolicy.majority?.denominatorBasis !== 'YES_NO'
    || decisionPolicy.majority?.abstentionTreatment !== 'EXCLUDED'
    || decisionPolicy.majority?.tieOutcome !== 'NO_DECISION'
    || decisionPolicy.quorum?.population !== 'ELIGIBLE_MEMBERS') {
    throw policyRequired('The ordinary general-body policy does not match the supported recorded-vote, electorate, quorum, majority, and tie semantics.');
  }
  if (decisionPolicy.eligibility?.membershipTypes?.some((type) => type !== 'PRIMARY')
    || decisionPolicy.eligibility?.membershipStatuses?.some((status) => status !== 'ACTIVE')) {
    throw policyRequired('The supported voter snapshot is limited to verified active primary memberships; other categories require additional evidence.');
  }
  if (decisionPolicy.majority?.numerator !== 1 || decisionPolicy.majority?.denominator !== 2
    || decisionPolicy.majority?.comparison !== 'STRICTLY_GREATER') {
    throw policyRequired('The enabled ordinary general-body workflow requires the configured simple-majority rule: YES greater than NO.');
  }
}

export function assertEligibilityEvidenceMatches(
  resolution: GovernanceResolutionPrerequisites,
  evidence: GovernanceEligibilityEvidence | undefined,
): asserts evidence is GovernanceEligibilityEvidence {
  if (evidence) {
    assertGovernanceReferencesShareSociety(normalizeId(resolution.societyId), [
      { kind: 'eligibility snapshot', _id: evidence._id, societyId: evidence.societyId },
    ]);
  }
  if (!evidence
    || normalizeId(evidence.resolutionId) !== normalizeId(resolution._id)
    || normalizeId(evidence.ruleVersionId) !== normalizeId(resolution.ruleVersionId)
    || !Number.isInteger(evidence.eligibleCount)
    || evidence.eligibleCount < 0
    || evidence.eligibleCount !== evidence.eligibleMemberIds.length
    || new Set(evidence.eligibleMemberIds.map(normalizeId)).size !== evidence.eligibleMemberIds.length) {
    throw new ApiError(409, 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED', 'A matching, internally consistent eligibility snapshot is required.');
  }
}

export type MembershipEvidenceForSnapshot = {
  societyId: string | { toString(): string };
  userId: string | { toString(): string };
  membershipType: string;
  membershipStatus: string;
  validFrom?: Date;
  validTo?: Date;
};

/** Derives a deterministic electorate only from a confirmed policy and society-scoped membership records. */
export function deriveEligibleMemberIds(input: {
  societyId: string;
  eligibility: NonNullable<NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number]['eligibility']>;
  memberships: MembershipEvidenceForSnapshot[];
  activeUserIds: Array<string | { toString(): string }>;
  asOf?: Date;
}): string[] {
  if (input.eligibility.requiredEvidence?.length) {
    throw policyRequired(`Required eligibility evidence is not represented by a verified source: ${input.eligibility.requiredEvidence.join(', ')}.`);
  }
  if (!input.eligibility.membershipTypes?.length || !input.eligibility.membershipStatuses?.length) {
    throw policyRequired('An explicit membership type and status selection is required to derive eligibility.');
  }
  const societyId = normalizeId(input.societyId);
  const activeUsers = new Set(input.activeUserIds.map(normalizeId));
  const asOf = input.asOf ?? new Date();
  const eligible = new Set<string>();
  for (const membership of input.memberships) {
    const userId = normalizeId(membership.userId);
    if (normalizeId(membership.societyId) !== societyId
      || !input.eligibility.membershipTypes.includes(membership.membershipType as never)
      || !input.eligibility.membershipStatuses.includes(membership.membershipStatus as never)
      || !activeUsers.has(userId)
      || (membership.validFrom && membership.validFrom > asOf)
      || (membership.validTo && membership.validTo <= asOf)) continue;
    eligible.add(userId);
  }
  return [...eligible].sort();
}

export function assertResolutionCanOpen(
  resolution: GovernanceResolutionPrerequisites,
  ruleVersion: GovernanceRuleVersionEvidence | undefined,
  evidence: GovernanceEligibilityEvidence | undefined,
): asserts evidence is GovernanceEligibilityEvidence {
  if (resolution.status !== 'DRAFT') {
    throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'Only a draft resolution can be opened.');
  }
  assertGovernancePolicyConfigured(resolution, ruleVersion);
  assertEligibilityEvidenceMatches(resolution, evidence);
  if (evidence.eligibleCount === 0) throw policyRequired('An empty eligibility snapshot cannot open a resolution for voting.');
  assertDecisionRuntimeEnabled();
}

export function assertResolutionCanFinalize(
  resolution: GovernanceResolutionPrerequisites,
  ruleVersion: GovernanceRuleVersionEvidence | undefined,
  evidence: GovernanceEligibilityEvidence | undefined,
): asserts evidence is GovernanceEligibilityEvidence {
  if (resolution.status !== 'CLOSED') {
    throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'Only a closed resolution can be finalized.');
  }
  assertGovernancePolicyConfigured(resolution, ruleVersion);
  assertEligibilityEvidenceMatches(resolution, evidence);
  assertDecisionRuntimeEnabled();
}

export function makeVoteFromAuthenticatedUser(input: {
  resolution: GovernanceResolutionPrerequisites & { societyId: string; votingStart: Date; votingEnd: Date };
  evidence: GovernanceEligibilityEvidence;
  authenticatedUser: CurrentUserContext;
  vote: GovernanceVoteRecord['vote'];
  castAt?: Date;
}): Pick<GovernanceVoteRecord, 'societyId' | 'resolutionId' | 'voterId' | 'vote' | 'castAt'> {
  const actorSocietyId = input.authenticatedUser.societyId;
  const voterId = normalizeId(input.authenticatedUser.userId);
  const castAt = input.castAt ?? new Date();
  if (!actorSocietyId || normalizeId(actorSocietyId) !== normalizeId(input.resolution.societyId)) {
    throw new ApiError(404, 'NOT_FOUND', 'The resolution was not found in this society.');
  }
  assertEligibilityEvidenceMatches(input.resolution, input.evidence);
  if (!input.evidence.eligibleMemberIds.some((id) => normalizeId(id) === voterId)) {
    throw new ApiError(403, 'INELIGIBLE_VOTER', 'The authenticated user is not in this resolution eligibility snapshot.');
  }
  if (input.resolution.status !== 'OPEN' || castAt < input.resolution.votingStart || castAt >= input.resolution.votingEnd) {
    throw new ApiError(409, 'RESOLUTION_NOT_OPEN', 'The resolution is not accepting votes at this time.');
  }
  assertDecisionRuntimeEnabled();
  return {
    societyId: new Types.ObjectId(input.resolution.societyId),
    resolutionId: new Types.ObjectId(normalizeId(input.resolution._id)),
    voterId: new Types.ObjectId(voterId),
    vote: input.vote,
    castAt,
  };
}

export function countRecordedVotes(
  societyId: string,
  evidence: GovernanceEligibilityEvidence,
  votes: Array<Pick<GovernanceVoteRecord, 'societyId' | 'voterId' | 'vote'>>,
): { totalEligible: number; totalVotes: number; yesCount: number; noCount: number; abstainCount: number } {
  if (normalizeId(evidence.societyId) !== normalizeId(societyId)
    || !Number.isInteger(evidence.eligibleCount)
    || evidence.eligibleCount !== evidence.eligibleMemberIds.length
    || new Set(evidence.eligibleMemberIds.map(normalizeId)).size !== evidence.eligibleMemberIds.length) {
    throw new ApiError(409, 'GOVERNANCE_VOTE_INTEGRITY_ERROR', 'The eligibility snapshot does not match the requested society or contains inconsistent membership data.');
  }
  const eligible = new Set(evidence.eligibleMemberIds.map(normalizeId));
  const seen = new Set<string>();
  const counts = { totalEligible: evidence.eligibleCount, totalVotes: 0, yesCount: 0, noCount: 0, abstainCount: 0 };
  for (const vote of votes) {
    const voter = normalizeId(vote.voterId);
    if (normalizeId(vote.societyId) !== normalizeId(societyId) || !eligible.has(voter)) {
      throw new ApiError(409, 'GOVERNANCE_VOTE_INTEGRITY_ERROR', 'A vote does not match the resolution society and eligibility snapshot.');
    }
    if (seen.has(voter)) throw new ApiError(409, 'GOVERNANCE_DUPLICATE_VOTE', 'The vote set contains more than one vote from an eligible member.');
    seen.add(voter);
    counts.totalVotes += 1;
    if (vote.vote === 'YES') counts.yesCount += 1;
    else if (vote.vote === 'NO') counts.noCount += 1;
    else if (vote.vote === 'ABSTAIN') counts.abstainCount += 1;
    else throw new ApiError(400, 'VALIDATION_ERROR', 'The vote value is invalid.');
  }
  return counts;
}

export function calculateGeneralBodyOutcome(input: {
  counts: ReturnType<typeof countRecordedVotes>;
  attendanceCount?: number;
  quorum: NonNullable<NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number]['quorum']>;
  majority: NonNullable<NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number]['majority']>;
}): { quorumRequired: number; quorumMet: boolean; outcome: 'APPROVED' | 'REJECTED' | 'NO_DECISION' } {
  const { counts, quorum, majority } = input;
  if (quorum.population !== 'ELIGIBLE_MEMBERS' || !quorum.numerator || !quorum.denominator || !quorum.rounding
    || !majority.denominatorBasis || !majority.comparison || !majority.abstentionTreatment || !majority.tieOutcome
    || majority.denominatorBasis !== 'YES_NO' || majority.abstentionTreatment !== 'EXCLUDED' || majority.tieOutcome !== 'NO_DECISION'
    || quorum.rounding !== 'CEILING' && quorum.rounding !== 'FLOOR' && quorum.rounding !== 'EXACT'
    || majority.numerator !== 1 || majority.denominator !== 2 || majority.comparison !== 'STRICTLY_GREATER') {
    throw policyRequired('The general-body quorum or majority policy is incomplete or unsupported.');
  }
  const raw = counts.totalEligible * quorum.numerator / quorum.denominator;
  const rounded = quorum.rounding === 'CEILING' ? Math.ceil(raw)
    : quorum.rounding === 'FLOOR' ? Math.floor(raw) : Number.isInteger(raw) ? raw : Number.NaN;
  if (!Number.isInteger(rounded)) throw policyRequired('The configured quorum rounding does not produce an integer threshold.');
  const quorumRequired = Math.min(rounded, quorum.maximum ?? Number.MAX_SAFE_INTEGER);
  const quorumMet = (input.attendanceCount ?? counts.totalVotes) >= quorumRequired;
  if (!quorumMet) return { quorumRequired, quorumMet, outcome: 'NO_DECISION' };
  if (counts.yesCount === counts.noCount) return { quorumRequired, quorumMet, outcome: 'NO_DECISION' };
  const passed = majority.comparison === 'STRICTLY_GREATER'
    ? counts.yesCount > counts.noCount
    : counts.yesCount >= counts.noCount;
  return { quorumRequired, quorumMet, outcome: passed ? 'APPROVED' : 'REJECTED' };
}

function hasCompleteDecisionPolicy(policy: NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number]): boolean {
  const eligibility = policy.eligibility;
  const quorum = policy.quorum;
  const majority = policy.majority;
  const voting = policy.voting;
  return Boolean(
    eligibility?.membershipTypes?.length && eligibility.membershipStatuses?.length
    && quorum?.population && Number.isInteger(quorum.numerator) && Number(quorum.numerator) > 0
    && Number.isInteger(quorum.denominator) && Number(quorum.denominator) > 0 && quorum.rounding
    && Number.isInteger(majority?.numerator) && Number(majority?.numerator) > 0
    && Number.isInteger(majority?.denominator) && Number(majority?.denominator) > 0
    && majority?.denominatorBasis && majority.comparison && majority.abstentionTreatment && majority.tieOutcome
    && voting?.methods?.length && voting.oneMemberOneVote !== undefined && voting.voteChangePolicy && voting.ballotPrivacy,
  );
}

function assertDecisionRuntimeEnabled(): void {
  if (!GOVERNANCE_DECISION_RUNTIME_ENABLED) {
    throw policyRequired('Governance operations are disabled until policy decisions are approved and documented.');
  }
}

function normalizeId(value: string | { toString(): string }): string {
  return value.toString().toLowerCase();
}

function policyRequired(message: string): ApiError {
  return new ApiError(409, 'GOVERNANCE_POLICY_UNRESOLVED', message);
}
