import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const committeeApprovalElectorateSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
  approvalDecisionId: { type: Schema.Types.ObjectId, ref: 'ApprovalDecision', required: true, immutable: true },
  proposalVersionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true, immutable: true },
  eligibleMemberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], required: true, immutable: true },
  eligibleCount: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
  ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', required: true, immutable: true },
  generatedAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, collection: 'committeeApprovalElectorates', strict: 'throw' });
committeeApprovalElectorateSchema.pre('validate', function () {
  if (this.eligibleCount !== this.eligibleMemberIds.length || !this.eligibleMemberIds.length || new Set(this.eligibleMemberIds.map(id => id.toString())).size !== this.eligibleMemberIds.length) this.invalidate('eligibleMemberIds', 'Committee electorate must contain unique active appointees and match eligibleCount.');
});
const immutable = () => new Error('Committee approval electorates are immutable historical snapshots.');
committeeApprovalElectorateSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
committeeApprovalElectorateSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) committeeApprovalElectorateSchema.pre(operation, function (next) { next(immutable()); });
committeeApprovalElectorateSchema.index({ approvalDecisionId: 1 }, { unique: true });
committeeApprovalElectorateSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });
export type CommitteeApprovalElectorateRecord = InferSchemaType<typeof committeeApprovalElectorateSchema>;
export const CommitteeApprovalElectorate = models.CommitteeApprovalElectorate ?? model('CommitteeApprovalElectorate', committeeApprovalElectorateSchema);
