import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const QUOTATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SELECTED', 'SUPERSEDED', 'REJECTED'] as const;

export const quotationSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, immutable: true },
    versionNumber: { type: Number, required: true, immutable: true, min: 1 },
    amount: { type: Schema.Types.Decimal128, required: true },
    description: { type: String, required: true },
    documentEvidenceId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: QUOTATION_STATUSES, required: true, default: 'DRAFT' },
    previousQuotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', immutable: true },
    supersededAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
  },
  { timestamps: true, collection: 'quotations' },
);

quotationSchema.index({ projectId: 1, versionNumber: 1 }, { unique: true });
quotationSchema.index({ projectId: 1, status: 1 });

export type QuotationRecord = InferSchemaType<typeof quotationSchema>;
export const Quotation = models.Quotation ?? model('Quotation', quotationSchema);
