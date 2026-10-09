import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const budgetCategorySchema = new Schema(
  {
    budgetId: { type: Schema.Types.ObjectId, ref: 'Budget', required: true, immutable: true },
    name: { type: String, required: true },
    description: { type: String },
    allocatedAmount: { type: Schema.Types.Decimal128, required: true },
    spentAmount: { type: Schema.Types.Decimal128, required: true, default: '0' },
    remainingAmount: { type: Schema.Types.Decimal128, required: true, default: '0' },
  },
  { timestamps: true, collection: 'budgetCategories' },
);

budgetCategorySchema.index({ budgetId: 1 });

export type BudgetCategoryRecord = InferSchemaType<typeof budgetCategorySchema>;
export const BudgetCategory = models.BudgetCategory
  ?? model('BudgetCategory', budgetCategorySchema);
