import { model, models, Schema } from 'mongoose';

export const projectUpdateSchema = new Schema({
  societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true, immutable: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
  kind: { type: String, enum: ['PROGRESS', 'COMPLETION'], required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160, immutable: true },
  description: { type: String, required: true, maxlength: 5000, immutable: true },
  invoiceReference: { type: String, maxlength: 240, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, required: true, immutable: true },
}, { collection: 'projectUpdates', strict: 'throw', versionKey: false });

projectUpdateSchema.index({ societyId: 1, projectId: 1, createdAt: 1 });
const immutable = () => new Error('Project progress records are append-only.');
projectUpdateSchema.pre('save', function (next) { next(this.isNew ? undefined : immutable()); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) projectUpdateSchema.pre(operation, function (next) { next(immutable()); });
projectUpdateSchema.pre('deleteOne', { document: true, query: false }, function (next) { next(immutable()); });
projectUpdateSchema.pre('bulkWrite', function (next, operations) { next(operations.some(operation => !('insertOne' in operation)) ? immutable() : undefined); });

export const ProjectUpdate = models.ProjectUpdate ?? model('ProjectUpdate', projectUpdateSchema);
