import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const PROJECT_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTATION_ADDED', 'APPROVAL_REQUIRED',
  'COMMITTEE_APPROVAL', 'SGM_REQUIRED', 'APPROVED', 'VENDOR_SELECTED',
  'IN_PROGRESS', 'CHANGE_REQUESTED', 'RE_APPROVAL', 'COMPLETED', 'FINAL_INVOICE',
  'CLOSED', 'CANCELLED', 'REJECTED',
] as const;

export const projectSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    estimatedCost: { type: Schema.Types.Decimal128, required: true },
    approvedCost: { type: Schema.Types.Decimal128 },
    finalCost: { type: Schema.Types.Decimal128 },
    status: { type: String, enum: PROJECT_STATUSES, required: true, default: 'DRAFT' },
    proposedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    approvalType: { type: String },
    approvalStatus: { type: String },
    meetingId: { type: Schema.Types.ObjectId },
    vendorId: { type: Schema.Types.ObjectId },
    budgetId: { type: Schema.Types.ObjectId, ref: 'Budget' },
    currentQuotationId: { type: Schema.Types.ObjectId },
    governanceResolutionId: { type: Schema.Types.ObjectId },
    activeRuleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion' },
  },
  { timestamps: true, collection: 'projects' },
);

projectSchema.index({ societyId: 1, status: 1, createdAt: -1 });
projectSchema.index({ societyId: 1, budgetId: 1 });

export type ProjectRecord = InferSchemaType<typeof projectSchema>;
export const Project = models.Project ?? model('Project', projectSchema);
