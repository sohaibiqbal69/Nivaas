import { model, models, Schema, type InferSchemaType } from 'mongoose';

const ruleConfiguration = { type: Schema.Types.Mixed };

export const societyRuleVersionSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    versionNumber: { type: Number, required: true },
    status: { type: String, required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    approvalPolicy: ruleConfiguration,
    majorityRules: ruleConfiguration,
    quorumRules: ruleConfiguration,
    noticeRules: ruleConfiguration,
    votingRules: ruleConfiguration,
    procurementRules: ruleConfiguration,
    financialVisibilityRules: ruleConfiguration,
    complaintRules: ruleConfiguration,
    completionRules: ruleConfiguration,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'societyRuleVersions' },
);

societyRuleVersionSchema.index({ societyId: 1, versionNumber: 1 }, { unique: true });
societyRuleVersionSchema.index({ societyId: 1, status: 1 });

export type SocietyRuleVersionRecord = InferSchemaType<typeof societyRuleVersionSchema>;
export const SocietyRuleVersion = models.SocietyRuleVersion
  ?? model('SocietyRuleVersion', societyRuleVersionSchema);
