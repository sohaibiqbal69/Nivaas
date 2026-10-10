import { model, models, Schema, type InferSchemaType } from 'mongoose';

const RULE_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
const ruleConfiguration = { type: Schema.Types.Mixed, immutable: true };
export const DEFAULT_APPROVAL_THRESHOLD = '100000';

export const societyRuleVersionSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    versionNumber: { type: Number, required: true, min: 1, immutable: true },
    status: { type: String, required: true, enum: RULE_VERSION_STATUSES },
    effectiveFrom: { type: Date, required: true, immutable: true },
    effectiveTo: { type: Date, immutable: true },
    approvalPolicy: { ...ruleConfiguration, default: () => ({ threshold: DEFAULT_APPROVAL_THRESHOLD }) },
    majorityRules: ruleConfiguration,
    quorumRules: ruleConfiguration,
    noticeRules: ruleConfiguration,
    votingRules: ruleConfiguration,
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
