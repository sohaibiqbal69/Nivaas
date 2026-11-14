import { model, models, Schema } from 'mongoose';
const schema = new Schema({
  societyId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  fileName: { type: String, required: true, immutable: true },
  fileType: { type: String, required: true, enum: ['image/jpeg', 'image/png'], immutable: true },
  fileSize: { type: Number, required: true, immutable: true },
  storageProvider: { type: String, enum: ['local', 's3', 'cloudinary'], required: true, immutable: true, select: false },
  storagePath: { type: String, required: true, immutable: true, select: false },
  storageAssetId: { type: String, immutable: true, select: false },
  storageResourceType: { type: String, enum: ['image'], immutable: true, select: false },
  storageDeliveryType: { type: String, enum: ['authenticated'], immutable: true, select: false },
  storageFormat: { type: String, enum: ['jpg', 'png'], immutable: true, select: false },
  storageVersion: { type: Number, immutable: true, select: false },
  fileHash: { type: String, required: true, immutable: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  relatedEntityType: { type: String, enum: ['Complaint', 'Notice', 'ProjectUpdate'], required: true, immutable: true },
  relatedEntityId: { type: Schema.Types.ObjectId, refPath: 'relatedEntityType', required: true, immutable: true },
  category: { type: String, enum: ['COMPLAINT_PHOTO', 'PROGRESS_PHOTO', 'AFTER_PHOTO', 'NOTICE_ATTACHMENT'], required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { collection: 'evidence', strict: 'throw', versionKey: false });
schema.index({ societyId: 1, relatedEntityType: 1, relatedEntityId: 1 });
const immutable = () => new Error('Evidence metadata is immutable.');
schema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) schema.pre(operation, function (next) { next(immutable()); });
schema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
schema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });
export const Evidence = models.Evidence ?? model('Evidence', schema);
