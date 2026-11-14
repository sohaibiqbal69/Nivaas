import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const MEETING_TYPES = ['AGM', 'SGM', 'COMMITTEE'] as const;
export const MEETING_STATUSES = ['DRAFT', 'PUBLISHED', 'HELD', 'CLOSED', 'CANCELLED'] as const;
const meetingDocumentReferenceSchema = new Schema({
  kind: { type: String, enum: ['NOTICE', 'PROPOSAL', 'QUOTATION', 'MINUTES', 'SUPPORTING_EVIDENCE'], required: true },
  reference: { type: String, required: true, trim: true, maxlength: 240 },
}, { _id: false, strict: 'throw' });

export const meetingSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', immutable: true },
  type: { type: String, enum: MEETING_TYPES, required: true, immutable: true },
  title: { type: String, required: true, trim: true, immutable: true },
  description: { type: String, trim: true, immutable: true },
  scheduledAt: { type: Date, required: true, immutable: true },
  location: { type: String, trim: true, immutable: true },
  agenda: { type: [{ type: String, trim: true }], default: undefined, immutable: true },
  documentReferences: { type: [meetingDocumentReferenceSchema], default: undefined, immutable: function (this: { status?: string }) { return this.status !== 'DRAFT'; } },
  status: { type: String, enum: MEETING_STATUSES, required: true },
  noticeId: { type: Schema.Types.ObjectId, immutable: true },
  noticeReference: { type: String, trim: true, immutable: function (this: { status?: string }) { return this.status !== 'DRAFT'; } },
  noticeIssuedAt: { type: Date, immutable: function (this: { status?: string }) { return this.status !== 'DRAFT'; } },
  noticePeriodDays: { type: Number, min: 0, immutable: function (this: { status?: string }) { return this.status !== 'DRAFT'; } },
  requisitionId: { type: Schema.Types.ObjectId, immutable: true },
  quorumRuleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', immutable: function (this: { status?: string }) { return this.status !== 'DRAFT'; } },
  attendanceCount: { type: Number, min: 0 },
  quorumStatus: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true, collection: 'meetings', strict: 'throw' });

meetingSchema.index({ societyId: 1, scheduledAt: -1 });
meetingSchema.index({ societyId: 1, status: 1, scheduledAt: -1 });

export type MeetingRecord = InferSchemaType<typeof meetingSchema>;
export const Meeting = models.Meeting ?? model('Meeting', meetingSchema);
