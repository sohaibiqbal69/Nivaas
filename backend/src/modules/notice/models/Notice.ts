import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const NOTICE_CATEGORIES = ['AGM', 'SGM', 'MAINTENANCE', 'EMERGENCY', 'WATER', 'SECURITY', 'REPAIRS', 'GENERAL', 'OTHER'] as const;
export const NOTICE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export const noticeSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 10000 },
  category: { type: String, enum: NOTICE_CATEGORIES, required: true },
  // The specification requires a priority label but does not define a fixed vocabulary.
  priority: { type: String, required: true, trim: true, maxlength: 40 },
  status: { type: String, enum: NOTICE_STATUSES, required: true, default: 'DRAFT' },
  publishedAt: { type: Date },
  expiresAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  attachmentIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }], default: [] },
  meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
}, { timestamps: true, collection: 'notices', strict: 'throw' });

noticeSchema.index({ societyId: 1, status: 1, publishedAt: -1, createdAt: -1 });
noticeSchema.index({ societyId: 1, category: 1, status: 1 });

export type NoticeRecord = InferSchemaType<typeof noticeSchema>;
export const Notice = models.Notice ?? model('Notice', noticeSchema);
