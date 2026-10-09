import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const CHANGE_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_SGM'] as const;

export const changeRequestSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', required: true, immutable: true },
    originalAmount: { type: Schema.Types.Decimal128, required: true, immutable: true },
    additionalAmount: { type: Schema.Types.Decimal128, required: true, immutable: true },
    newAmount: { type: Schema.Types.Decimal128, required: true, immutable: true },
    reason: { type: String, required: true, immutable: true },
    supportingEvidenceIds: { type: [Schema.Types.ObjectId], default: [], immutable: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    status: { type: String, enum: CHANGE_REQUEST_STATUSES, required: true, default: 'DRAFT' },
    requiredApprovalType: { type: String },
    approvalMeetingId: { type: Schema.Types.ObjectId },
    approvalDecisionId: { type: Schema.Types.ObjectId },
    resultingQuotationId: { type: Schema.Types.ObjectId, ref: 'Quotation' },
  },
  { timestamps: true, collection: 'changeRequests' },
);

changeRequestSchema.index({ projectId: 1, createdAt: -1 });
changeRequestSchema.index({ quotationId: 1, status: 1 });

export type ChangeRequestRecord = InferSchemaType<typeof changeRequestSchema>;
export const ChangeRequest = models.ChangeRequest
  ?? model('ChangeRequest', changeRequestSchema);
