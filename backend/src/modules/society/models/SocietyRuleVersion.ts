import { model, models, Schema, type InferSchemaType } from 'mongoose';
import { governancePolicyConfigurationSchema } from '../../governance/models/GovernancePolicyConfiguration.js';

const RULE_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
const ruleConfiguration = { type: Schema.Types.Mixed, immutable: true };
export const DEFAULT_APPROVAL_THRESHOLD = '100000';

export const societyRuleVersionSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    versionNumber: { type: Number, required: true, min: 1, immutable: true },
    status: { type: String, required: true, enum: RULE_VERSION_STATUSES },
    effectiveFrom: { type: Date, required: true, immutable: true },
    // Closed once when a newer immutable version is activated.
    effectiveTo: { type: Date },
    changeReason: { type: String, trim: true, maxlength: 500, immutable: true },
    supportingDocumentReference: { type: String, trim: true, maxlength: 240, immutable: true },
    policyChangeAuditLogId: { type: Schema.Types.ObjectId, ref: 'AuditLog', immutable: true },
    approvalPolicy: { ...ruleConfiguration, default: () => ({ threshold: DEFAULT_APPROVAL_THRESHOLD, committeeApproval: { quorumNumerator: 2, quorumDenominator: 3, majorityNumerator: 1, majorityDenominator: 2, majorityComparison: 'STRICTLY_GREATER' } }) },
    majorityRules: ruleConfiguration,
    quorumRules: ruleConfiguration,
    noticeRules: ruleConfiguration,
    votingRules: ruleConfiguration,
    // New typed policy envelope. Legacy Mixed fields remain readable for old rule versions.
    governancePolicy: { type: governancePolicyConfigurationSchema, immutable: true },
    procurementRules: ruleConfiguration,
    financialVisibilityRules: ruleConfiguration,
    complaintRules: ruleConfiguration,
    completionRules: ruleConfiguration,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  },
  { timestamps: true, collection: 'societyRuleVersions' },
);

societyRuleVersionSchema.index({ societyId: 1, versionNumber: 1 }, { unique: true });
societyRuleVersionSchema.index(
  { societyId: 1, status: 1 },
  { partialFilterExpression: { status: 'ACTIVE' }, unique: true },
);

societyRuleVersionSchema.pre('validate', function () {
  if (this.effectiveTo && this.effectiveTo <= this.effectiveFrom) {
    this.invalidate('effectiveTo', 'effectiveTo must be later than effectiveFrom.');
  }
  const policy = this.approvalPolicy as Record<string, unknown> | undefined;
  if (!policy || typeof policy.threshold !== 'string'
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(policy.threshold)
    || policy.threshold.replace('.', '').replace(/^0+/, '').length > 34) {
    this.invalidate('approvalPolicy', 'approvalPolicy.threshold must be a valid exact decimal string.');
  }
});

export type SocietyRuleVersionRecord = InferSchemaType<typeof societyRuleVersionSchema>;
export { RULE_VERSION_STATUSES };
export const SocietyRuleVersion = models.SocietyRuleVersion
  ?? model('SocietyRuleVersion', societyRuleVersionSchema);
