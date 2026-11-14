import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const committeeApprovalResultSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
  approvalDecisionId: { type: Schema.Types.ObjectId, ref: 'ApprovalDecision', required: true, immutable: true },
  proposalVersionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true, immutable: true },
  totalCommitteeMembers: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  participatingMembers: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  approveCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  rejectCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  quorumRequired: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
  quorumMet: { type: Boolean, required: true, immutable: true },
  outcome: { type: String, enum: ['APPROVED', 'REJECTED'], required: true, immutable: true },
  ruleSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  finalizedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  finalizedAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, collection: 'committeeApprovalResults', strict: 'throw' });
const immutable = () => new Error('Committee approval results are immutable historical records.');
committeeApprovalResultSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
committeeApprovalResultSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) committeeApprovalResultSchema.pre(operation, function (next) { next(immutable()); });
committeeApprovalResultSchema.index({ approvalDecisionId: 1 }, { unique: true });
committeeApprovalResultSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });
committeeApprovalResultSchema.index({ societyId: 1, projectId: 1, finalizedAt: -1 });
export type CommitteeApprovalResultRecord = InferSchemaType<typeof committeeApprovalResultSchema>;
export const CommitteeApprovalResult = models.CommitteeApprovalResult ?? model('CommitteeApprovalResult', committeeApprovalResultSchema);
