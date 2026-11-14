import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const GOVERNANCE_VOTE_VALUES = ['YES', 'NO', 'ABSTAIN'] as const;

export const governanceVoteSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  resolutionId: { type: Schema.Types.ObjectId, ref: 'GovernanceResolution', required: true, immutable: true },
  voterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  vote: { type: String, enum: GOVERNANCE_VOTE_VALUES, required: true, immutable: true },
  castAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, collection: 'governanceVotes', strict: 'throw' });

const immutableError = () => new Error('Governance votes are immutable historical records.');
governanceVoteSchema.pre('save', function (next) {
  next(this.isNew ? undefined : immutableError());
});
governanceVoteSchema.pre('deleteOne', { document: true, query: false }, function (next) {
  next(immutableError());
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  governanceVoteSchema.pre(operation, function (next) { next(immutableError()); });
}
governanceVoteSchema.pre('bulkWrite', function (next, operations) {
  next(operations.some((operation) => !('insertOne' in operation)) ? immutableError() : undefined);
});

governanceVoteSchema.index({ societyId: 1, resolutionId: 1, voterId: 1 }, { unique: true });
governanceVoteSchema.index({ societyId: 1, resolutionId: 1, castAt: 1 });

export type GovernanceVoteRecord = InferSchemaType<typeof governanceVoteSchema>;
export const GovernanceVote = models.GovernanceVote ?? model('GovernanceVote', governanceVoteSchema);
