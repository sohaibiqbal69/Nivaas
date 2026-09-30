import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const residenceSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    flatId: { type: Schema.Types.ObjectId, ref: 'Flat', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    occupancyType: { type: String, required: true },
    status: { type: String, required: true },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true, collection: 'residences' },
);

residenceSchema.index({ flatId: 1 });
residenceSchema.index({ userId: 1 });

export type ResidenceRecord = InferSchemaType<typeof residenceSchema>;
export const Residence = models.Residence ?? model('Residence', residenceSchema);
