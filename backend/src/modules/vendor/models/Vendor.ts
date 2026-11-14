import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const VENDOR_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export const vendorSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
    name: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    registrationDetails: { type: String, trim: true },
    status: { type: String, enum: VENDOR_STATUSES, required: true, default: 'ACTIVE' },
  },
  { timestamps: true, collection: 'vendors', strict: 'throw' },
);

vendorSchema.index({ societyId: 1, status: 1, name: 1 });

export type VendorRecord = InferSchemaType<typeof vendorSchema>;
export const Vendor = models.Vendor ?? model('Vendor', vendorSchema);
