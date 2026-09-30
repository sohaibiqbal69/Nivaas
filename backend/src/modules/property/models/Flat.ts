import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const flatSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    buildingId: { type: Schema.Types.ObjectId, ref: 'Building', required: true },
    flatNumber: { type: String, required: true },
    floor: { type: Number },
    type: { type: String },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'flats' },
);

flatSchema.index({ societyId: 1 });
flatSchema.index({ buildingId: 1 });

export type FlatRecord = InferSchemaType<typeof flatSchema>;
export const Flat = models.Flat ?? model('Flat', flatSchema);
