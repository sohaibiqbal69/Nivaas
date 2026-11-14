import { model, models, Schema, Types, type InferSchemaType } from 'mongoose';
import {
  GOVERNANCE_DECISION_BODIES,
  GOVERNANCE_RESOLUTION_TYPES,
  GOVERNANCE_VOTING_METHODS,
  governanceDecisionPolicySchema,
} from './GovernancePolicyConfiguration.js';

export const GOVERNANCE_RESOLUTION_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'APPROVED', 'REJECTED', 'NO_DECISION', 'CANCELLED'] as const;

export const governanceResultCountsSchema = new Schema({
  totalEligible: { type: Number, required: true, min: 0, validate: Number.isInteger },
  totalVotes: { type: Number, required: true, min: 0, validate: Number.isInteger },
  attendanceCount: { type: Number, min: 0, validate: Number.isInteger },
  yesCount: { type: Number, required: true, min: 0, validate: Number.isInteger },
  noCount: { type: Number, required: true, min: 0, validate: Number.isInteger },
  abstainCount: { type: Number, required: true, min: 0, validate: Number.isInteger },
  quorumMet: { type: Boolean, required: true },
  quorumRequired: { type: Number, required: true, min: 0, validate: Number.isInteger },
  outcome: { type: String, enum: ['APPROVED', 'REJECTED', 'NO_DECISION'], required: true },
  calculatedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });

export const governanceResolutionSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, immutable: true },
  proposalId: { type: Schema.Types.ObjectId, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', immutable: true },
  approvalDecisionId: { type: Schema.Types.ObjectId, ref: 'ApprovalDecision', immutable: true },
  quotationVersionId: { type: Schema.Types.ObjectId, ref: 'Quotation', immutable: true },
  resolutionType: { type: String, enum: GOVERNANCE_RESOLUTION_TYPES, required: true, immutable: true },
  decisionBody: { type: String, enum: GOVERNANCE_DECISION_BODIES, required: true, immutable: true },
  title: { type: String, required: true, trim: true, immutable: true },
  description: { type: String, trim: true, immutable: true },
  amount: { type: Schema.Types.Decimal128, immutable: true },
  votingMethod: { type: String, enum: GOVERNANCE_VOTING_METHODS, required: true, immutable: true },
  votingStart: { type: Date, required: true, immutable: true },
  votingEnd: { type: Date, required: true, immutable: true },
  eligibilityRule: { type: Schema.Types.Mixed, required: true, immutable: true },
  majorityRule: { type: Schema.Types.Mixed, required: true, immutable: true },
  quorumRequired: { type: Schema.Types.Mixed, required: true, immutable: true },
  ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', required: true, immutable: true },
  governancePolicySnapshot: { type: governanceDecisionPolicySchema, immutable: true },
  ruleSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  eligibilitySnapshotId: { type: Schema.Types.ObjectId, ref: 'GovernanceEligibilitySnapshot' },
  eligibleVoterCount: { type: Number, min: 0, validate: Number.isInteger },
  acceptedVoteCount: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  status: { type: String, enum: GOVERNANCE_RESOLUTION_STATUSES, required: true, default: 'DRAFT' },
  result: { type: governanceResultCountsSchema },
  approvedAt: { type: Date },
  finalizedAt: { type: Date, immutable: function (this: { finalizedAt?: Date }) { return Boolean(this.finalizedAt); } },
  finalizationAuditLogId: { type: Schema.Types.ObjectId, ref: 'AuditLog', immutable: function (this: { finalizationAuditLogId?: Types.ObjectId }) { return Boolean(this.finalizationAuditLogId); } },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'governanceResolutions', strict: 'throw' });

governanceResolutionSchema.pre('validate', function () {
  if (this.votingEnd <= this.votingStart) {
    this.invalidate('votingEnd', 'Voting end must be later than voting start.');
  }
});

governanceResolutionSchema.post('init', function (document) {
  document.$locals.persistedResult = document.result ? JSON.stringify(document.result) : null;
});
governanceResolutionSchema.pre('save', function () {
  const persisted = this.$locals.persistedResult as string | null | undefined;
  if (persisted !== undefined && persisted !== null && JSON.stringify(this.result) !== persisted) {
    throw new Error('A calculated governance result is immutable after voting closes.');
  }
});

const resultMutationError = () => new Error('Calculated governance results are immutable historical evidence.');
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
  governanceResolutionSchema.pre(operation, function (next) {
    const update = this.getUpdate() as Record<string, unknown> | null;
    const paths = Object.keys(update ?? {}).flatMap((key) => key.startsWith('$') && update?.[key] && typeof update[key] === 'object'
      ? Object.keys(update[key] as Record<string, unknown>) : [key]);
    if (paths.some((path) => path === 'result' || path.startsWith('result.'))) return next(resultMutationError());
    next();
  });
}

governanceResolutionSchema.index({ societyId: 1, createdAt: -1 });
governanceResolutionSchema.index({ societyId: 1, meetingId: 1, status: 1 });
governanceResolutionSchema.index({ societyId: 1, projectId: 1, createdAt: -1 });
governanceResolutionSchema.index({ approvalDecisionId: 1 }, { sparse: true });

export type GovernanceResolutionRecord = InferSchemaType<typeof governanceResolutionSchema>;
export const GovernanceResolution = models.GovernanceResolution
  ?? model('GovernanceResolution', governanceResolutionSchema);
