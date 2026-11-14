import { model, models, Schema, type InferSchemaType } from 'mongoose';
import { governanceDecisionPolicySchema } from './GovernancePolicyConfiguration.js';

export const governanceEligibilitySnapshotSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  resolutionId: { type: Schema.Types.ObjectId, ref: 'GovernanceResolution', required: true, immutable: true },
  ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', required: true, immutable: true },
  governancePolicySnapshot: { type: governanceDecisionPolicySchema, required: true, immutable: true },
  eligibilityRule: { type: Schema.Types.Mixed, required: true, immutable: true },
  eligibleMemberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], required: true, immutable: true },
  eligibleCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  generatedAt: { type: Date, required: true, immutable: true },
  generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'governanceEligibilitySnapshots', strict: 'throw' });

governanceEligibilitySnapshotSchema.pre('validate', function () {
  if (this.eligibleCount !== this.eligibleMemberIds.length) {
    this.invalidate('eligibleCount', 'eligibleCount must match eligibleMemberIds.');
  }
  if (new Set(this.eligibleMemberIds.map((id) => id.toString())).size !== this.eligibleMemberIds.length) {
    this.invalidate('eligibleMemberIds', 'Eligibility snapshot cannot contain duplicate users.');
  }
});

const immutableError = () => new Error('Governance eligibility snapshots are immutable historical records.');
governanceEligibilitySnapshotSchema.pre('save', function (next) {
  next(this.isNew ? undefined : immutableError());
});
governanceEligibilitySnapshotSchema.pre('deleteOne', { document: true, query: false }, function (next) {
  next(immutableError());
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  governanceEligibilitySnapshotSchema.pre(operation, function (next) { next(immutableError()); });
}
governanceEligibilitySnapshotSchema.pre('bulkWrite', function (next, operations) {
  next(operations.some((operation) => !('insertOne' in operation)) ? immutableError() : undefined);
});

governanceEligibilitySnapshotSchema.index({ resolutionId: 1 }, { unique: true });
governanceEligibilitySnapshotSchema.index({ societyId: 1, ruleVersionId: 1 });

export type GovernanceEligibilitySnapshotRecord = InferSchemaType<typeof governanceEligibilitySnapshotSchema>;
export const GovernanceEligibilitySnapshot = models.GovernanceEligibilitySnapshot
  ?? model('GovernanceEligibilitySnapshot', governanceEligibilitySnapshotSchema);
