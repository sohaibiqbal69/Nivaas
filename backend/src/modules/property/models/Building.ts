import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const PROPERTY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export const buildingSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    buildingCode: { type: String },
    address: { type: String },
    numberOfFloors: { type: Number },
    status: { type: String, enum: PROPERTY_STATUSES, required: true },
  },
  { timestamps: true, collection: 'buildings' },
);

buildingSchema.index({ societyId: 1 });
buildingSchema.index({ societyId: 1, buildingCode: 1 }, { unique: true, sparse: true });

export type BuildingRecord = InferSchemaType<typeof buildingSchema>;
export const Building = models.Building ?? model('Building', buildingSchema);
