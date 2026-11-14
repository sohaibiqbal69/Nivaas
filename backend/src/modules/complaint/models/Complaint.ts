import { model, models, Schema } from 'mongoose';

export const COMPLAINT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
const schema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160, immutable: true },
  description: { type: String, maxlength: 10000, immutable: true },
  category: { type: String, maxlength: 80, immutable: true },
  priority: { type: String, maxlength: 40, immutable: true },
  status: { type: String, required: true, enum: COMPLAINT_STATUSES },
  resolvedAt: Date,
}, { timestamps: true, collection: 'complaints', strict: 'throw' });
schema.index({ societyId: 1, createdBy: 1, createdAt: -1 });
schema.index({ societyId: 1, status: 1, createdAt: -1 });
export const Complaint = models.Complaint ?? model('Complaint', schema);
