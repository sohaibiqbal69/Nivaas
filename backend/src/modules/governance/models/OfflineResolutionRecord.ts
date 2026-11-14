import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const offlineResolutionRecordSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, immutable: true },
  resolutionId: { type: Schema.Types.ObjectId, ref: 'GovernanceResolution', required: true, immutable: true },
  ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', required: true, immutable: true },
  method: { type: String, enum: ['SHOW_OF_HANDS', 'POLL'], required: true, immutable: true },
  attendanceMemberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], required: true, immutable: true },
  attendanceCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  yesCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  noCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  abstainCount: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  quorumRequired: { type: Number, required: true, min: 0, validate: Number.isInteger, immutable: true },
  quorumMet: { type: Boolean, required: true, immutable: true },
  outcome: { type: String, enum: ['APPROVED', 'REJECTED', 'NO_DECISION'], required: true, immutable: true },
  minutesReference: { type: String, required: true, trim: true, maxlength: 240, immutable: true },
  supportingEvidenceReferences: { type: [String], required: true, immutable: true },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  confirmedAt: { type: Date, required: true, immutable: true },
  policySnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
}, { timestamps: true, collection: 'offlineResolutionRecords', strict: 'throw' });

offlineResolutionRecordSchema.pre('validate', function () {
  if (this.attendanceCount !== this.attendanceMemberIds.length) this.invalidate('attendanceCount', 'attendanceCount must match attendanceMemberIds.');
  if (new Set(this.attendanceMemberIds.map(id => id.toString())).size !== this.attendanceMemberIds.length) this.invalidate('attendanceMemberIds', 'Attendance cannot contain duplicate members.');
  if (this.yesCount + this.noCount + this.abstainCount > this.attendanceCount) this.invalidate('attendanceCount', 'Vote counts cannot exceed attendance count.');
});
const immutable = () => new Error('Offline resolution records are immutable historical evidence.');
offlineResolutionRecordSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
offlineResolutionRecordSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) offlineResolutionRecordSchema.pre(operation, function (next) { next(immutable()); });
offlineResolutionRecordSchema.index({ resolutionId: 1 }, { unique: true });
offlineResolutionRecordSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });
offlineResolutionRecordSchema.index({ societyId: 1, meetingId: 1, confirmedAt: -1 });
export type OfflineResolutionRecord = InferSchemaType<typeof offlineResolutionRecordSchema>;
export const OfflineResolutionRecordModel = models.OfflineResolutionRecord ?? model('OfflineResolutionRecord', offlineResolutionRecordSchema);
