import { Schema, Types } from 'mongoose';
import {
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_TYPES,
} from '../../membership/models/Membership.js';

export const GOVERNANCE_POLICY_SCHEMA_VERSION = 1;
export const GOVERNANCE_POLICY_CONFIRMATION_STATES = ['PENDING_CONFIRMATION', 'CONFIRMED'] as const;
export const GOVERNANCE_RESOLUTION_TYPES = [
  'PROJECT_APPROVAL', 'BUDGET_APPROVAL', 'VENDOR_APPROVAL', 'QUOTATION_APPROVAL', 'OTHER',
] as const;
export const GOVERNANCE_DECISION_BODIES = ['COMMITTEE', 'GENERAL_BODY'] as const;
export const GOVERNANCE_VOTING_METHODS = ['SHOW_OF_HANDS', 'BALLOT', 'POLL'] as const;

/** Configurable product starter, not a claim that every society's registered rules are identical. */
export function createGeneralBodyStarterPolicy(input: {
  confirmationState?: 'PENDING_CONFIRMATION' | 'CONFIRMED';
  confirmedDocumentReference?: string;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
} = {}): GovernancePolicyConfiguration {
  const confirmed = input.confirmationState === 'CONFIRMED';
  return {
    schemaVersion: GOVERNANCE_POLICY_SCHEMA_VERSION,
    confirmationState: confirmed ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
    ...(confirmed ? {
      confirmedDocumentReference: input.confirmedDocumentReference,
      confirmedAt: input.confirmedAt,
      confirmedBy: input.confirmedBy,
    } : {}),
    decisionPolicies: (['OTHER', 'PROJECT_APPROVAL'] as const).map((resolutionType) => ({
      resolutionType,
      decisionBody: 'GENERAL_BODY',
      eligibility: { membershipTypes: ['PRIMARY'], membershipStatuses: ['ACTIVE'] },
      quorum: { population: 'ELIGIBLE_MEMBERS', numerator: 2, denominator: 3, maximum: 20, rounding: 'CEILING' },
      majority: { numerator: 1, denominator: 2, denominatorBasis: 'YES_NO', comparison: 'STRICTLY_GREATER', abstentionTreatment: 'EXCLUDED', tieOutcome: 'NO_DECISION' },
      voting: { methods: ['SHOW_OF_HANDS'], oneMemberOneVote: true, voteChangePolicy: 'IMMUTABLE_AFTER_CAST', ballotPrivacy: 'RECORDED' },
    })),
  };
}

export const governanceEligibilityRuleSchema = new Schema({
  membershipTypes: [{ type: String, enum: MEMBERSHIP_TYPES }],
  membershipStatuses: [{ type: String, enum: MEMBERSHIP_STATUSES }],
  requiredEvidence: [{
    type: String,
    enum: [
      'JOINT_MEMBER_ORDER_AND_ATTENDANCE',
      'ASSOCIATE_WRITTEN_CONSENT',
      'PROVISIONAL_MEMBERSHIP_BASIS',
      'CURRENT_COMMITTEE_MEMBERSHIP',
      'CONFLICT_OF_INTEREST_REVIEW',
    ],
  }],
}, { _id: false, strict: 'throw' });

const quorumRuleSchema = new Schema({
  population: { type: String, enum: ['TOTAL_MEMBERS', 'ACTIVE_MEMBERS', 'ELIGIBLE_MEMBERS'] },
  numerator: { type: Number, min: 1, validate: Number.isInteger },
  denominator: { type: Number, min: 1, validate: Number.isInteger },
  maximum: { type: Number, min: 1, validate: Number.isInteger },
  rounding: { type: String, enum: ['CEILING', 'FLOOR', 'EXACT'] },
}, { _id: false, strict: 'throw' });

quorumRuleSchema.pre('validate', function () {
  if ((this.numerator === undefined) !== (this.denominator === undefined)) {
    this.invalidate('numerator', 'A quorum ratio requires both numerator and denominator.');
  }
  if (typeof this.numerator === 'number' && typeof this.denominator === 'number' && this.numerator > this.denominator) {
    this.invalidate('numerator', 'A quorum ratio numerator cannot exceed its denominator.');
  }
});

const majorityRuleSchema = new Schema({
  numerator: { type: Number, min: 1, validate: Number.isInteger },
  denominator: { type: Number, min: 1, validate: Number.isInteger },
  denominatorBasis: { type: String, enum: ['YES_NO', 'PRESENT_AND_VOTING', 'ELIGIBLE_MEMBERS', 'TOTAL_MEMBERS'] },
  comparison: { type: String, enum: ['STRICTLY_GREATER', 'AT_LEAST'] },
  abstentionTreatment: { type: String, enum: ['EXCLUDED', 'COUNT_AS_NO', 'IN_DENOMINATOR'] },
  tieOutcome: { type: String, enum: ['NO_DECISION', 'REQUIRES_REVIEW', 'CHAIR_CASTING_VOTE'] },
}, { _id: false, strict: 'throw' });

majorityRuleSchema.pre('validate', function () {
  if ((this.numerator === undefined) !== (this.denominator === undefined)) {
    this.invalidate('numerator', 'A majority ratio requires both numerator and denominator.');
  }
  if (typeof this.numerator === 'number' && typeof this.denominator === 'number' && this.numerator > this.denominator) {
    this.invalidate('numerator', 'A majority ratio numerator cannot exceed its denominator.');
  }
});

const votingRuleSchema = new Schema({
  methods: [{ type: String, enum: GOVERNANCE_VOTING_METHODS }],
  oneMemberOneVote: { type: Boolean },
  voteChangePolicy: { type: String, enum: ['IMMUTABLE_AFTER_CAST', 'APPEND_ONLY_CORRECTION'] },
  ballotPrivacy: { type: String, enum: ['RECORDED', 'SECRET'] },
}, { _id: false, strict: 'throw' });

export const governanceDecisionPolicySchema = new Schema({
  resolutionType: { type: String, enum: GOVERNANCE_RESOLUTION_TYPES, required: true },
  decisionBody: { type: String, enum: GOVERNANCE_DECISION_BODIES, required: true },
  eligibility: { type: governanceEligibilityRuleSchema },
  quorum: { type: quorumRuleSchema },
  majority: { type: majorityRuleSchema },
  voting: { type: votingRuleSchema },
}, { _id: false, strict: 'throw' });

export const governancePolicyConfigurationSchema = new Schema({
  schemaVersion: { type: Number, required: true, enum: [GOVERNANCE_POLICY_SCHEMA_VERSION] },
  confirmationState: { type: String, required: true, enum: GOVERNANCE_POLICY_CONFIRMATION_STATES },
  confirmedDocumentReference: { type: String, trim: true },
  confirmedAt: { type: Date },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decisionPolicies: { type: [governanceDecisionPolicySchema], default: undefined },
}, { _id: false, strict: 'throw' });

governancePolicyConfigurationSchema.pre('validate', function () {
  if (this.confirmationState === 'PENDING_CONFIRMATION') {
    if (this.confirmedDocumentReference || this.confirmedAt || this.confirmedBy) {
      this.invalidate('confirmationState', 'Pending policy configuration cannot contain confirmation evidence.');
    }
    return;
  }

  if (!this.confirmedDocumentReference?.trim() || !this.confirmedAt || !this.confirmedBy) {
    this.invalidate('confirmedDocumentReference', 'Confirmed governance policy requires a document reference, timestamp, and confirming user.');
  }
  if (!this.decisionPolicies?.length) {
    this.invalidate('decisionPolicies', 'Confirmed governance policy requires at least one decision policy.');
    return;
  }

  const seen = new Set<string>();
  for (const policy of this.decisionPolicies) {
    const key = `${policy.resolutionType}:${policy.decisionBody}`;
    if (seen.has(key)) this.invalidate('decisionPolicies', `Duplicate decision policy: ${key}.`);
    seen.add(key);

    for (const path of ['eligibility', 'quorum', 'majority', 'voting'] as const) {
      if (!policy.get(path)) this.invalidate(`decisionPolicies.${path}`, `Confirmed policy ${key} requires ${path} configuration.`);
    }

    const eligibility = policy.get('eligibility') as { membershipTypes?: string[]; membershipStatuses?: string[] } | undefined;
    const quorum = policy.get('quorum') as { population?: string; numerator?: number; denominator?: number; rounding?: string } | undefined;
    const majority = policy.get('majority') as { numerator?: number; denominator?: number; denominatorBasis?: string; comparison?: string; abstentionTreatment?: string; tieOutcome?: string } | undefined;
    const voting = policy.get('voting') as { methods?: string[]; oneMemberOneVote?: boolean; voteChangePolicy?: string; ballotPrivacy?: string } | undefined;

    // This runtime supports ordinary, recorded general-body resolutions only.
    // Other membership categories require evidence the current Membership
    // model does not establish (joint-member order/attendance, associate
    // consent, or provisional-member basis), and must not be activated here.
    if ((policy.resolutionType === 'OTHER' || policy.resolutionType === 'PROJECT_APPROVAL')
      && policy.decisionBody === 'GENERAL_BODY') {
      if (eligibility?.membershipTypes?.some((type) => type !== 'PRIMARY')
        || eligibility?.membershipStatuses?.some((status) => status !== 'ACTIVE')) {
        this.invalidate('decisionPolicies.eligibility', `The supported general-body workflow requires only PRIMARY/ACTIVE membership evidence; unsupported membership categories fail closed.`);
      }
      if (quorum?.population !== 'ELIGIBLE_MEMBERS') {
        this.invalidate('decisionPolicies.quorum.population', 'The supported workflow calculates quorum from the snapshotted eligible-member population.');
      }
      if (majority?.numerator !== 1 || majority.denominator !== 2 || majority.denominatorBasis !== 'YES_NO'
        || majority.comparison !== 'STRICTLY_GREATER' || majority.abstentionTreatment !== 'EXCLUDED'
        || majority.tieOutcome !== 'NO_DECISION') {
        this.invalidate('decisionPolicies.majority', 'The supported workflow requires YES > NO, excludes abstentions from that comparison, and resolves ties as NO_DECISION.');
      }
      if (voting?.oneMemberOneVote !== true || voting.voteChangePolicy !== 'IMMUTABLE_AFTER_CAST' || voting.ballotPrivacy !== 'RECORDED') {
        this.invalidate('decisionPolicies.voting', 'The supported workflow requires one immutable, recorded vote per eligible member.');
      }
    }

    if (!eligibility?.membershipTypes?.length || !eligibility.membershipStatuses?.length) {
      this.invalidate('decisionPolicies.eligibility', `Confirmed policy ${key} requires explicit membership types and statuses.`);
    }
    if (!quorum?.population || quorum.numerator === undefined || quorum.denominator === undefined || !quorum.rounding) {
      this.invalidate('decisionPolicies.quorum', `Confirmed policy ${key} requires an explicit population, ratio, and rounding rule.`);
    }
    if (majority?.numerator === undefined || majority.denominator === undefined || !majority.denominatorBasis
      || !majority.comparison || !majority.abstentionTreatment || !majority.tieOutcome) {
      this.invalidate('decisionPolicies.majority', `Confirmed policy ${key} requires an explicit ratio, denominator, comparison, abstention, and tie rule.`);
    }
    if (!voting?.methods?.length || voting.oneMemberOneVote === undefined || !voting.voteChangePolicy || !voting.ballotPrivacy) {
      this.invalidate('decisionPolicies.voting', `Confirmed policy ${key} requires explicit method, vote-count, change, and privacy settings.`);
    }
  }
});

export type GovernancePolicyConfiguration = {
  schemaVersion: typeof GOVERNANCE_POLICY_SCHEMA_VERSION;
  confirmationState: typeof GOVERNANCE_POLICY_CONFIRMATION_STATES[number];
  confirmedDocumentReference?: string;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
  decisionPolicies?: Array<{
    resolutionType: typeof GOVERNANCE_RESOLUTION_TYPES[number];
    decisionBody: typeof GOVERNANCE_DECISION_BODIES[number];
    eligibility?: {
      membershipTypes?: typeof MEMBERSHIP_TYPES[number][];
      membershipStatuses?: typeof MEMBERSHIP_STATUSES[number][];
      requiredEvidence?: string[];
    };
    quorum?: {
      population?: 'TOTAL_MEMBERS' | 'ACTIVE_MEMBERS' | 'ELIGIBLE_MEMBERS';
      numerator?: number;
      denominator?: number;
      maximum?: number;
      rounding?: 'CEILING' | 'FLOOR' | 'EXACT';
    };
    majority?: {
      numerator?: number;
      denominator?: number;
      denominatorBasis?: 'YES_NO' | 'PRESENT_AND_VOTING' | 'ELIGIBLE_MEMBERS' | 'TOTAL_MEMBERS';
      comparison?: 'STRICTLY_GREATER' | 'AT_LEAST';
      abstentionTreatment?: 'EXCLUDED' | 'COUNT_AS_NO' | 'IN_DENOMINATOR';
      tieOutcome?: 'NO_DECISION' | 'REQUIRES_REVIEW' | 'CHAIR_CASTING_VOTE';
    };
    voting?: {
      methods?: typeof GOVERNANCE_VOTING_METHODS[number][];
      oneMemberOneVote?: boolean;
      voteChangePolicy?: 'IMMUTABLE_AFTER_CAST' | 'APPEND_ONLY_CORRECTION';
      ballotPrivacy?: 'RECORDED' | 'SECRET';
    };
  }>;
};
