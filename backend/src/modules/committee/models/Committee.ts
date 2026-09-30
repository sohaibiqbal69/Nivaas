import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const committeeSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    termStart: { type: Date },
    termEnd: { type: Date },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'committees' },
);

committeeSchema.index({ societyId: 1 });

export type CommitteeRecord = InferSchemaType<typeof committeeSchema>;
export const Committee = models.Committee ?? model('Committee', committeeSchema);
