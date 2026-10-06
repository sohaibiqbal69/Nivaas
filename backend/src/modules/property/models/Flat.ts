import { model, models, Schema, type InferSchemaType } from 'mongoose';
import { PROPERTY_STATUSES } from './Building.js';

export const flatSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    buildingId: { type: Schema.Types.ObjectId, ref: 'Building', required: true },
    flatNumber: { type: String, required: true },
    floor: { type: Number },
    type: { type: String },
    status: { type: String, enum: PROPERTY_STATUSES, required: true },
  },
  { timestamps: true, collection: 'flats' },
);

flatSchema.index({ societyId: 1 });
flatSchema.index({ buildingId: 1 });
flatSchema.index({ buildingId: 1, flatNumber: 1 }, { unique: true });

export type FlatRecord = InferSchemaType<typeof flatSchema>;
export const Flat = models.Flat ?? model('Flat', flatSchema);
