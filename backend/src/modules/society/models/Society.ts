import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const societySchema = new Schema(
  {
    name: { type: String, required: true },
    registrationNumber: { type: String },
    address: { type: String },
    contactEmail: { type: String },
    contactPhone: { type: String },
    configurationVersion: { type: Number },
    activeRuleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion' },
    financialYearStart: { type: Date },
    financialYearEnd: { type: Date },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'societies' },
);

export type SocietyRecord = InferSchemaType<typeof societySchema>;
export const Society = models.Society ?? model('Society', societySchema);
