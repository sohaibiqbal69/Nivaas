import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const expenseSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
  budgetId: { type: Schema.Types.ObjectId, ref: 'Budget', required: true, immutable: true },
  budgetCategoryId: { type: Schema.Types.ObjectId, ref: 'BudgetCategory', required: true, immutable: true },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', immutable: true },
  title: { type: String, required: true, maxlength: 160, immutable: true },
  description: { type: String, maxlength: 2000, immutable: true },
  amount: { type: Schema.Types.Decimal128, required: true, immutable: true },
  invoiceReference: { type: String, maxlength: 240, immutable: true },
  status: { type: String, required: true, enum: ['RECORDED'], default: 'RECORDED', immutable: true },
  expenseDate: { type: Date, required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'expenses', strict: 'throw', versionKey: false });

expenseSchema.index({ societyId: 1, projectId: 1, createdAt: -1 });
expenseSchema.index({ societyId: 1, budgetId: 1, budgetCategoryId: 1 });
const immutable = () => new Error('Expense records are immutable.');
expenseSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) expenseSchema.pre(operation, function (next) { next(immutable()); });
expenseSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
expenseSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });

export type ExpenseRecord = InferSchemaType<typeof expenseSchema>;
export const Expense = models.Expense ?? model('Expense', expenseSchema);
