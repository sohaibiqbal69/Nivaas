import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const committeeMemberSchema = new Schema(
  {
    committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    position: { type: String, required: true },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'committeeMembers' },
);

committeeMemberSchema.index({ committeeId: 1 });
committeeMemberSchema.index({ userId: 1 });

export type CommitteeMemberRecord = InferSchemaType<typeof committeeMemberSchema>;
export const CommitteeMember = models.CommitteeMember
  ?? model('CommitteeMember', committeeMemberSchema);
