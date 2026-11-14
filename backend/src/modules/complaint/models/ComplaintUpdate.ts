import { model, models, Schema } from 'mongoose';
import { COMPLAINT_STATUSES } from './Complaint.js';

const schema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, immutable: true },
  status: { type: String, required: true, enum: COMPLAINT_STATUSES, immutable: true },
  description: { type: String, required: true, maxlength: 10000, immutable: true },
  evidenceIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }], default: [], immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, required: true, immutable: true },
}, { collection: 'complaintUpdates', strict: 'throw', versionKey: false });
schema.index({ complaintId: 1, createdAt: 1 });
const immutableError = () => new Error('Complaint timeline records are append-only.');
schema.pre('save', function (next) { next(this.isNew ? undefined : immutableError()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  schema.pre(operation, function (next) { next(immutableError()); });
}
schema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutableError()); });
schema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutableError() : undefined); });
export const ComplaintUpdate = models.ComplaintUpdate ?? model('ComplaintUpdate', schema);
