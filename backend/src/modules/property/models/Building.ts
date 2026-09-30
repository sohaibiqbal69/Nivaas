import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const buildingSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    buildingCode: { type: String },
    address: { type: String },
    numberOfFloors: { type: Number },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'buildings' },
);

buildingSchema.index({ societyId: 1 });

export type BuildingRecord = InferSchemaType<typeof buildingSchema>;
export const Building = models.Building ?? model('Building', buildingSchema);
