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
// Only records with a string buildingCode participate in uniqueness. A sparse
// compound index still indexes documents that have societyId, which made an
// otherwise optional buildingCode effectively mandatory after the first row.
buildingSchema.index(
  { societyId: 1, buildingCode: 1 },
  {
    name: 'uniq_society_building_code_present',
    unique: true,
    partialFilterExpression: { buildingCode: { $type: 'string' } },
  },
);

export type BuildingRecord = InferSchemaType<typeof buildingSchema>;
export const Building = models.Building ?? model('Building', buildingSchema);
