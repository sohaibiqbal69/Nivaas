import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const BUDGET_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'] as const;

export const budgetSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
    financialYear: { type: String, required: true, immutable: true },
    title: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: BUDGET_STATUSES, required: true, default: 'DRAFT' },
    totalAllocated: { type: Schema.Types.Decimal128, required: true, default: '0' },
    totalSpent: { type: Schema.Types.Decimal128, required: true, default: '0' },
    totalRemaining: { type: Schema.Types.Decimal128, required: true, default: '0' },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'budgets' },
);

budgetSchema.index({ societyId: 1, financialYear: 1 }, { unique: true });
budgetSchema.index({ societyId: 1, status: 1 });

export type BudgetRecord = InferSchemaType<typeof budgetSchema>;
export const Budget = models.Budget ?? model('Budget', budgetSchema);
