import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const APPROVAL_TYPES = [
  'COMMITTEE_APPROVAL',
  'GENERAL_BODY_APPROVAL',
  'SGM_REQUIRED',
  'RE_APPROVAL_REQUIRED',
  'ADDITIONAL_APPROVAL_REQUIRED',
  'NOT_READY_FOR_APPROVAL',
] as const;

export const APPROVAL_DECISION_STATUSES = ['REQUIRED', 'RE_EVALUATED', 'COMPLETED', 'INVALIDATED'] as const;

export const approvalDecisionSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    quotationVersionId: { type: Schema.Types.ObjectId, ref: 'Quotation', immutable: true },
    changeRequestId: { type: Schema.Types.ObjectId, ref: 'ChangeRequest', immutable: true },
    ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', required: true, immutable: true },
    evaluatedAmount: { type: Schema.Types.Decimal128, required: true, immutable: true },
    requiredThreshold: { type: Schema.Types.Decimal128, required: true, immutable: true },
    approvalType: { type: String, enum: APPROVAL_TYPES, required: true, immutable: true },
    requiredDecisionBody: { type: String, required: true, immutable: true },
    status: { type: String, enum: APPROVAL_DECISION_STATUSES, required: true, default: 'REQUIRED' },
    reason: { type: String, required: true, immutable: true },
    meetingId: { type: Schema.Types.ObjectId, immutable: true },
    governanceResolutionId: { type: Schema.Types.ObjectId, immutable: true },
    evaluatedAt: { type: Date, required: true, immutable: true, default: Date.now },
    evaluatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    ruleSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  },
  { timestamps: true, collection: 'approvalDecisions' },
);

approvalDecisionSchema.index({ projectId: 1, createdAt: -1 });
approvalDecisionSchema.index({ societyId: 1, createdAt: -1 });

export type ApprovalDecisionRecord = InferSchemaType<typeof approvalDecisionSchema>;
export const ApprovalDecision = models.ApprovalDecision
  ?? model('ApprovalDecision', approvalDecisionSchema);
