import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { SocietyRuleVersion } from '../src/modules/society/models/SocietyRuleVersion.js';
import { GovernanceEligibilitySnapshot, governanceEligibilitySnapshotSchema } from '../src/modules/governance/models/GovernanceEligibilitySnapshot.js';
import { GovernanceResolution, governanceResolutionSchema } from '../src/modules/governance/models/GovernanceResolution.js';
import { GovernanceVote, governanceVoteSchema } from '../src/modules/governance/models/GovernanceVote.js';
import { Meeting, meetingSchema } from '../src/modules/governance/models/Meeting.js';
import {
  assertGovernanceReferencesShareSociety,
  assertResolutionCanFinalize,
  assertResolutionCanOpen,
  countRecordedVotes,
  calculateGeneralBodyOutcome,
  deriveEligibleMemberIds,
  makeVoteFromAuthenticatedUser,
  type GovernanceEligibilityEvidence,
  type GovernanceResolutionPrerequisites,
} from '../src/modules/governance/governance-foundation.js';

const societyId = new Types.ObjectId();
const meetingId = new Types.ObjectId();
const resolutionId = new Types.ObjectId();
const ruleVersionId = new Types.ObjectId();
const memberA = new Types.ObjectId();
const memberB = new Types.ObjectId();

function pendingPolicy() {
  return { schemaVersion: 1, confirmationState: 'PENDING_CONFIRMATION' as const };
}

// Synthetic shape fixture only; never a Nivaas policy or runtime rule.
function syntheticConfirmedPolicyFixture() {
  return {
    schemaVersion: 1 as const,
    confirmationState: 'CONFIRMED' as const,
    confirmedDocumentReference: 'test-fixture-only',
    confirmedAt: new Date('2000-01-01T00:00:00.000Z'),
    confirmedBy: new Types.ObjectId(),
    decisionPolicies: [{
      resolutionType: 'PROJECT_APPROVAL' as const,
      decisionBody: 'GENERAL_BODY' as const,
      eligibility: {
        membershipTypes: ['PRIMARY' as const],
        membershipStatuses: ['ACTIVE' as const],
        requiredEvidence: [],
      },
      quorum: { population: 'ELIGIBLE_MEMBERS' as const, numerator: 2, denominator: 3, maximum: 20, rounding: 'CEILING' as const },
      majority: {
        numerator: 1,
        denominator: 2,
        denominatorBasis: 'YES_NO' as const,
        comparison: 'STRICTLY_GREATER' as const,
        abstentionTreatment: 'EXCLUDED' as const,
        tieOutcome: 'NO_DECISION' as const,
      },
      voting: {
        methods: ['SHOW_OF_HANDS' as const],
        oneMemberOneVote: true,
        voteChangePolicy: 'IMMUTABLE_AFTER_CAST' as const,
        ballotPrivacy: 'RECORDED' as const,
      },
    }],
  };
}

function decisionPolicySnapshot() {
  return syntheticConfirmedPolicyFixture().decisionPolicies[0];
}

function resolution(status = 'DRAFT'): GovernanceResolutionPrerequisites {
  return {
    _id: resolutionId,
    societyId,
    ruleVersionId,
    resolutionType: 'PROJECT_APPROVAL',
    decisionBody: 'GENERAL_BODY',
    status,
  };
}

function ruleVersion(governancePolicy = pendingPolicy()) {
  return { _id: ruleVersionId, societyId, governancePolicy };
}

function evidence(overrides: Partial<GovernanceEligibilityEvidence> = {}): GovernanceEligibilityEvidence {
  return {
    _id: new Types.ObjectId(),
    societyId,
    resolutionId,
    ruleVersionId,
    eligibleMemberIds: [memberA, memberB],
    eligibleCount: 2,
    ...overrides,
  };
}

describe('governance foundation schemas', () => {
  it('preserves legacy rule versions and accepts an explicitly pending typed policy without defaults', async () => {
    const rule = new SocietyRuleVersion({
      societyId,
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date(),
      createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      majorityRules: {},
      quorumRules: {},
      votingRules: {},
    });
    await expect(rule.validate()).resolves.toBeUndefined();
    expect(rule.governancePolicy).toBeUndefined();
    expect(rule.majorityRules).toEqual({});

    rule.governancePolicy = pendingPolicy();
    await expect(rule.validate()).resolves.toBeUndefined();
  });

  it('rejects an incomplete confirmed policy and accepts a complete versioned shape', async () => {
    const rule = new SocietyRuleVersion({
      societyId, versionNumber: 2, status: 'DRAFT', effectiveFrom: new Date(), createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      governancePolicy: { schemaVersion: 1, confirmationState: 'CONFIRMED', confirmedDocumentReference: 'approved-spec', confirmedAt: new Date(), confirmedBy: new Types.ObjectId() },
    });
    await expect(rule.validate()).rejects.toMatchObject({ errors: { 'governancePolicy.decisionPolicies': expect.anything() } });

    rule.governancePolicy = syntheticConfirmedPolicyFixture();
    await expect(rule.validate()).resolves.toBeUndefined();

    const unsupportedVersion = new SocietyRuleVersion({
      societyId, versionNumber: 3, status: 'DRAFT', effectiveFrom: new Date(), createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      governancePolicy: { schemaVersion: 2, confirmationState: 'PENDING_CONFIRMATION' },
    });
    await expect(unsupportedVersion.validate()).rejects.toMatchObject({ errors: { 'governancePolicy.schemaVersion': expect.anything() } });

    const invalidRatio = new SocietyRuleVersion({
      societyId, versionNumber: 4, status: 'DRAFT', effectiveFrom: new Date(), createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      governancePolicy: {
        ...syntheticConfirmedPolicyFixture(),
        decisionPolicies: syntheticConfirmedPolicyFixture().decisionPolicies.map((policy) => ({
          ...policy,
          majority: { ...policy.majority, numerator: 4, denominator: 3 },
        })),
      },
    });
    await expect(invalidRatio.validate()).rejects.toMatchObject({ errors: { 'governancePolicy.decisionPolicies.0.majority.numerator': expect.anything() } });

    const unsupportedElectorate = new SocietyRuleVersion({
      societyId, versionNumber: 5, status: 'DRAFT', effectiveFrom: new Date(), createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      governancePolicy: {
        ...syntheticConfirmedPolicyFixture(),
        decisionPolicies: syntheticConfirmedPolicyFixture().decisionPolicies.map((policy) => ({
          ...policy,
          eligibility: { ...policy.eligibility, membershipTypes: ['PRIMARY', 'ASSOCIATE'] },
        })),
      },
    });
    await expect(unsupportedElectorate.validate()).rejects.toMatchObject({ errors: { 'governancePolicy.decisionPolicies.eligibility': expect.anything() } });

    const unsupportedTie = new SocietyRuleVersion({
      societyId, versionNumber: 6, status: 'DRAFT', effectiveFrom: new Date(), createdBy: new Types.ObjectId(),
      approvalPolicy: { threshold: '100000' },
      governancePolicy: {
        ...syntheticConfirmedPolicyFixture(),
        decisionPolicies: syntheticConfirmedPolicyFixture().decisionPolicies.map((policy) => ({
          ...policy,
          majority: { ...policy.majority, tieOutcome: 'CHAIR_CASTING_VOTE' },
        })),
      },
    });
    await expect(unsupportedTie.validate()).rejects.toMatchObject({ errors: { 'governancePolicy.decisionPolicies.majority': expect.anything() } });
  });

  it('models meeting and resolution references and the documented status and vote values', async () => {
    const meeting = new Meeting({ societyId, type: 'SGM', title: 'Meeting', scheduledAt: new Date(), status: 'DRAFT', createdBy: new Types.ObjectId() });
    await expect(meeting.validate()).resolves.toBeUndefined();
    const badMeeting = new Meeting({ societyId, type: 'ELECTION', title: 'Meeting', scheduledAt: new Date(), status: 'DRAFT', createdBy: new Types.ObjectId() });
    await expect(badMeeting.validate()).rejects.toMatchObject({ errors: { type: expect.anything() } });

    const validResolution = new GovernanceResolution({
      societyId, meetingId, resolutionType: 'PROJECT_APPROVAL', decisionBody: 'GENERAL_BODY',
      title: 'Project approval', votingMethod: 'SHOW_OF_HANDS', votingStart: new Date('2026-10-18T01:00:00Z'),
      votingEnd: new Date('2026-10-18T02:00:00Z'), eligibilityRule: {}, majorityRule: {}, quorumRequired: {},
      ruleVersionId, ruleSnapshot: {}, createdBy: new Types.ObjectId(),
    });
    await expect(validResolution.validate()).resolves.toBeUndefined();
    expect(validResolution.status).toBe('DRAFT');
    expect(governanceResolutionSchema.path('meetingId').options.ref).toBe('Meeting');
    expect(meetingSchema.path('societyId').options.immutable).toBe(true);
    expect(governanceResolutionSchema.path('projectId').options.ref).toBe('Project');
  });

  it('requires eligibility snapshot counts to match unique user IDs and declares one snapshot per resolution', async () => {
    const valid = new GovernanceEligibilitySnapshot({
      societyId, resolutionId, ruleVersionId, governancePolicySnapshot: decisionPolicySnapshot(),
      eligibilityRule: {}, eligibleMemberIds: [memberA, memberB],
      eligibleCount: 2, generatedAt: new Date(), generatedBy: new Types.ObjectId(),
    });
    await expect(valid.validate()).resolves.toBeUndefined();
    const duplicate = new GovernanceEligibilitySnapshot({
      societyId, resolutionId, ruleVersionId, governancePolicySnapshot: decisionPolicySnapshot(),
      eligibilityRule: {}, eligibleMemberIds: [memberA, memberA],
      eligibleCount: 2, generatedAt: new Date(), generatedBy: new Types.ObjectId(),
    });
    await expect(duplicate.validate()).rejects.toMatchObject({ errors: { eligibleMemberIds: expect.anything() } });
    expect(governanceEligibilitySnapshotSchema.indexes().some(([keys, options]) =>
      keys.resolutionId === 1 && options.unique === true)).toBe(true);

    valid.$isNew = false;
    await expect(valid.save()).rejects.toThrow('Governance eligibility snapshots are immutable historical records.');
  });

  it('requires immutable vote identity and enforces per-society voter uniqueness in the index', async () => {
    const vote = new GovernanceVote({ societyId, resolutionId, voterId: memberA, vote: 'YES', castAt: new Date() });
    await expect(vote.validate()).resolves.toBeUndefined();
    const invalid = new GovernanceVote({ societyId, resolutionId, voterId: memberA, vote: 'MAYBE', castAt: new Date() });
    await expect(invalid.validate()).rejects.toMatchObject({ errors: { vote: expect.anything() } });
    expect(governanceVoteSchema.path('voterId').options.immutable).toBe(true);
    expect(governanceVoteSchema.indexes().some(([keys, options]) =>
      keys.societyId === 1 && keys.resolutionId === 1 && keys.voterId === 1 && options.unique === true)).toBe(true);
    vote.$isNew = false;
    await expect(vote.save()).rejects.toThrow('Governance votes are immutable historical records.');
  });
});

describe('governance foundation guards', () => {
  it('derives a deterministic electorate only from scoped, current memberships and active authenticated accounts', () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const userOtherSociety = new Types.ObjectId();
    const now = new Date('2026-10-18T12:00:00Z');
    const eligible = deriveEligibleMemberIds({
      societyId: societyId.toString(),
      eligibility: decisionPolicySnapshot().eligibility!,
      activeUserIds: [userA, userB],
      asOf: now,
      memberships: [
        { societyId, userId: userA, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
        { societyId, userId: userA, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
        { societyId, userId: userB, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE', validTo: new Date('2026-01-01') },
        { societyId: new Types.ObjectId(), userId: userOtherSociety, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
        { societyId, userId: new Types.ObjectId(), membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
        { societyId, userId: new Types.ObjectId(), membershipType: 'ASSOCIATE', membershipStatus: 'ACTIVE' },
      ],
    });
    expect(eligible).toEqual([userA.toString()]);
  });

  it('fails closed when the configured electorate depends on evidence without a verified source', () => {
    const eligibility = { ...decisionPolicySnapshot().eligibility!, requiredEvidence: ['ASSOCIATE_WRITTEN_CONSENT'] };
    expect(() => deriveEligibleMemberIds({ societyId: societyId.toString(), eligibility, memberships: [], activeUserIds: [] }))
      .toThrowError(expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }));
  });

  it('rejects opening and finalization while policy confirmation is unresolved', () => {
    expect(() => assertResolutionCanOpen(resolution(), ruleVersion(), evidence())).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }),
    );
    expect(() => assertResolutionCanFinalize(resolution('CLOSED'), ruleVersion(), evidence())).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }),
    );
  });

  it('rejects opening and finalization without a matching eligibility snapshot', () => {
    const invalidEvidence = evidence({ ruleVersionId: new Types.ObjectId() });
    expect(() => assertResolutionCanOpen(resolution(), ruleVersion(syntheticConfirmedPolicyFixture()), invalidEvidence)).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED' }),
    );
    expect(() => assertResolutionCanFinalize(resolution('CLOSED'), ruleVersion(syntheticConfirmedPolicyFixture()), undefined)).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED' }),
    );
  });

  it('allows only a complete, supported general-body policy to open and finalize', () => {
    expect(() => assertResolutionCanOpen(resolution(), ruleVersion(syntheticConfirmedPolicyFixture()), evidence())).not.toThrow();
    expect(() => assertResolutionCanFinalize(resolution('CLOSED'), ruleVersion(syntheticConfirmedPolicyFixture()), evidence())).not.toThrow();
    expect(() => assertResolutionCanOpen({ ...resolution(), decisionBody: 'COMMITTEE' }, ruleVersion(syntheticConfirmedPolicyFixture()), evidence())).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }),
    );
    expect(() => assertResolutionCanOpen(resolution(), ruleVersion(syntheticConfirmedPolicyFixture()), evidence({ eligibleMemberIds: [], eligibleCount: 0 }))).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }),
    );
    const associatePolicy = syntheticConfirmedPolicyFixture();
    associatePolicy.decisionPolicies[0].eligibility!.membershipTypes = ['ASSOCIATE'];
    expect(() => assertResolutionCanOpen(resolution(), ruleVersion(associatePolicy), evidence())).toThrowError(
      expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }),
    );
  });

  it('checks society-scoped references and hides cross-society records as not found', () => {
    expect(() => assertGovernanceReferencesShareSociety(societyId.toString(), [
      { kind: 'meeting', _id: meetingId, societyId },
      { kind: 'project', _id: new Types.ObjectId(), societyId: new Types.ObjectId() },
    ])).toThrowError(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
  });

  it('rejects a policy version belonging to another society or version identity', () => {
    expect(() => assertResolutionCanOpen(resolution(), {
      ...ruleVersion(syntheticConfirmedPolicyFixture()), societyId: new Types.ObjectId(),
    }, evidence())).toThrowError(expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }));
  });

  it('uses the authenticated identity, requires snapshot membership, and does not accept client voter IDs', () => {
    const voteInput = {
      resolution: { ...resolution('OPEN'), societyId: societyId.toString(), votingStart: new Date('2026-10-18T01:00:00Z'), votingEnd: new Date('2026-10-18T03:00:00Z') },
      evidence: evidence(),
      authenticatedUser: { userId: memberB.toString(), societyId: societyId.toString(), role: 'RESIDENT' as const },
      vote: 'YES' as const,
      castAt: new Date('2026-10-18T02:00:00Z'),
    };
    expect(makeVoteFromAuthenticatedUser(voteInput)).toMatchObject({ societyId, voterId: memberB, vote: 'YES' });
    expect(() => makeVoteFromAuthenticatedUser({
      ...voteInput,
      authenticatedUser: { ...voteInput.authenticatedUser, userId: new Types.ObjectId().toString() },
    })).toThrowError(expect.objectContaining({ code: 'INELIGIBLE_VOTER' }));
  });

  it('calculates vote counts only, rejects duplicate or cross-society vote rows, and never returns an outcome', () => {
    const counts = countRecordedVotes(societyId.toString(), evidence(), [
      { societyId, voterId: memberA, vote: 'YES' },
      { societyId, voterId: memberB, vote: 'ABSTAIN' },
    ]);
    expect(counts).toEqual({ totalEligible: 2, totalVotes: 2, yesCount: 1, noCount: 0, abstainCount: 1 });
    expect(counts).not.toHaveProperty('passed');
    expect(() => countRecordedVotes(societyId.toString(), evidence(), [
      { societyId, voterId: memberA, vote: 'YES' },
      { societyId, voterId: memberA, vote: 'NO' },
    ])).toThrowError(expect.objectContaining({ code: 'GOVERNANCE_DUPLICATE_VOTE' }));
    expect(() => countRecordedVotes(societyId.toString(), evidence(), [
      { societyId: new Types.ObjectId(), voterId: memberA, vote: 'YES' },
    ])).toThrowError(expect.objectContaining({ code: 'GOVERNANCE_VOTE_INTEGRITY_ERROR' }));
  });

  it('calculates the configured general-body quorum, counts abstentions toward turnout, and handles ties explicitly', () => {
    const policy = decisionPolicySnapshot();
    const count = (totalVotes: number, yesCount: number, noCount: number, abstainCount: number) => ({ totalEligible: 3, totalVotes, yesCount, noCount, abstainCount });
    expect(calculateGeneralBodyOutcome({ counts: count(2, 1, 0, 1), quorum: policy.quorum!, majority: policy.majority! }))
      .toEqual({ quorumRequired: 2, quorumMet: true, outcome: 'APPROVED' });
    expect(calculateGeneralBodyOutcome({ counts: count(1, 1, 0, 0), quorum: policy.quorum!, majority: policy.majority! }))
      .toEqual({ quorumRequired: 2, quorumMet: false, outcome: 'NO_DECISION' });
    expect(calculateGeneralBodyOutcome({ counts: count(2, 1, 1, 0), quorum: policy.quorum!, majority: policy.majority! }).outcome).toBe('NO_DECISION');
    expect(calculateGeneralBodyOutcome({ counts: count(2, 0, 2, 0), quorum: policy.quorum!, majority: policy.majority! }).outcome).toBe('REJECTED');
    expect(calculateGeneralBodyOutcome({ counts: count(1, 1, 0, 0), attendanceCount: 2, quorum: policy.quorum!, majority: policy.majority! }))
      .toMatchObject({ quorumRequired: 2, quorumMet: true, outcome: 'APPROVED' });
  });

  it('fails closed when a tie procedure other than the implemented no-decision rule is configured', () => {
    const policy = decisionPolicySnapshot();
    expect(() => calculateGeneralBodyOutcome({
      counts: { totalEligible: 3, totalVotes: 2, yesCount: 1, noCount: 1, abstainCount: 0 },
      quorum: policy.quorum!,
      majority: { ...policy.majority!, tieOutcome: 'CHAIR_CASTING_VOTE' },
    })).toThrowError(expect.objectContaining({ code: 'GOVERNANCE_POLICY_UNRESOLVED' }));
  });
});
