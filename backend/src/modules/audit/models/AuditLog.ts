import { model, models, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AUDIT_LOG_HASH_VERSION, hashAuditLog } from '../audit-log-hashing.js';

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function isOptionalBsonDocument(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const auditLogSchema = new Schema(
  {
    societyId: {
      type: Schema.Types.ObjectId,
      ref: 'Society',
      required: function (this: { get(path: string): unknown }) {
        return this.get('societyId') === undefined;
      },
      immutable: true,
    },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
    action: { type: String, required: true, immutable: true },
    entityType: { type: String, immutable: true },
    entityId: { type: Schema.Types.ObjectId, immutable: true },
    correctsAuditLogId: { type: Schema.Types.ObjectId, ref: 'AuditLog', immutable: true },
    previousState: {
      type: Schema.Types.Mixed,
      validate: { validator: isOptionalBsonDocument, message: 'previousState must be a BSON document or null.' },
      immutable: true,
    },
    newState: {
      type: Schema.Types.Mixed,
      validate: { validator: isOptionalBsonDocument, message: 'newState must be a BSON document or null.' },
      immutable: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      validate: { validator: isOptionalBsonDocument, message: 'metadata must be a BSON document or null.' },
      immutable: true,
    },
    ruleVersionId: { type: Schema.Types.ObjectId, ref: 'SocietyRuleVersion', immutable: true },
    hashVersion: {
      type: Schema.Types.Int32,
      required: true,
      default: AUDIT_LOG_HASH_VERSION,
      enum: [AUDIT_LOG_HASH_VERSION],
      immutable: true,
    },
    recordHash: {
      type: String,
      required: true,
      match: HASH_PATTERN,
      immutable: true,
    },
    blockchainTransactionHash: { type: String, immutable: true },
    createdAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  {
    collection: 'auditLogs',
    timestamps: false,
    versionKey: false,
    minimize: false,
    strict: 'throw',
  },
);

auditLogSchema.index({ societyId: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

auditLogSchema.pre('validate', function () {
  if (!this.isNew) return;

  // Caller-provided timestamps are not authoritative for immutable events.
  // Keep the generated value stable across repeated validation/save cycles.
  if (this.$locals.auditLogCreatedAtGenerated !== true) {
    this.createdAt = new Date();
    this.$locals.auditLogCreatedAtGenerated = true;
  }

  if (Number(this.hashVersion) !== AUDIT_LOG_HASH_VERSION) {
    this.invalidate('hashVersion', `Only AuditLog hash version ${AUDIT_LOG_HASH_VERSION} is supported.`);
    return;
  }

  let expectedHash: string;
  try {
    expectedHash = hashAuditLog(this as unknown as Record<string, unknown>);
  } catch (error) {
    this.invalidate('recordHash', error instanceof Error ? error.message : 'AuditLog hashing failed.');
    return;
  }

  if (this.recordHash === undefined) {
    this.recordHash = expectedHash;
  } else if (this.recordHash !== expectedHash) {
    this.invalidate('recordHash', 'recordHash must match the immutable AuditLog event content.');
  }
});

const immutableError = () => new Error('AuditLog records are append-only and cannot be updated or deleted.');

auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(immutableError());
  next();
});

auditLogSchema.pre('deleteOne', { document: true, query: false }, function (next) {
  next(immutableError());
});

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(operation, function (next) {
    next(immutableError());
  });
}

// MongoDB promotes BSON numeric values to JavaScript numbers by default. That
// loses subtype information needed to independently reproduce recordHash.
// Keep BSON wrappers intact on AuditLog reads so persisted values are the
// authoritative input to the canonical hash.
for (const operation of ['find', 'findOne'] as const) {
  auditLogSchema.pre(operation, function () {
    this.setOptions({ promoteValues: false, promoteLongs: false });
  });
}

auditLogSchema.pre('bulkWrite', function (next, operations) {
  if (operations.some((operation) => !('insertOne' in operation))) {
    return next(immutableError());
  }
  next();
});

export type AuditLogRecord = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLogRecord>;
export const AuditLog = models.AuditLog ?? model('AuditLog', auditLogSchema);
