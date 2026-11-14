import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const committeeApprovalVoteSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
  approvalDecisionId: { type: Schema.Types.ObjectId, ref: 'ApprovalDecision', required: true, immutable: true },
  proposalVersionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true, immutable: true },
  voterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  decision: { type: String, enum: ['APPROVE', 'REJECT'], required: true, immutable: true },
  rationale: { type: String, trim: true, maxlength: 2000, immutable: true },
  decidedAt: { type: Date, required: true, immutable: true, default: Date.now },
}, { timestamps: true, collection: 'committeeApprovalVotes', strict: 'throw' });

const immutable = () => new Error('Committee approval decisions are immutable historical records.');
committeeApprovalVoteSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
committeeApprovalVoteSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  committeeApprovalVoteSchema.pre(operation, function (next) { next(immutable()); });
}
committeeApprovalVoteSchema.index({ approvalDecisionId: 1, voterId: 1 }, { unique: true });
committeeApprovalVoteSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });
committeeApprovalVoteSchema.index({ societyId: 1, projectId: 1, proposalVersionId: 1 });

export type CommitteeApprovalVoteRecord = InferSchemaType<typeof committeeApprovalVoteSchema>;
export const CommitteeApprovalVote = models.CommitteeApprovalVote ?? model('CommitteeApprovalVote', committeeApprovalVoteSchema);
