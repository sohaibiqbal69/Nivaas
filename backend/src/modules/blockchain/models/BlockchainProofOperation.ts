import { model, models, Schema, Types, type InferSchemaType } from 'mongoose';

const hashPattern = /^0x[0-9a-f]{64}$/;
const addressPattern = /^0x[0-9a-f]{40}$/i;

const attemptSchema = new Schema({
  sequence: { type: Number, required: true, min: 1 },
  transactionHash: { type: String, match: hashPattern },
  sender: { type: String, match: addressPattern },
  startedAt: { type: Date, required: true },
  broadcastAt: Date,
  receiptAt: Date,
  blockNumber: { type: Number, min: 0 },
  status: { type: String, enum: ['PREPARED', 'BROADCAST', 'CONFIRMED', 'REVERTED', 'AMBIGUOUS'], required: true },
  errorCode: { type: String, maxlength: 80 },
}, { _id: false, versionKey: false, strict: 'throw' });

export const blockchainProofOperationSchema = new Schema({
  recordType: { type: String, enum: ['AUDIT_LOG'], required: true, immutable: true },
  recordId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  societyId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  referenceDerivationVersion: { type: Number, required: true, immutable: true, min: 1 },
  proofVersion: { type: Number, required: true, immutable: true, min: 1 },
  auditLogHashVersion: { type: Number, required: true, immutable: true, min: 1 },
  recordReference: { type: String, required: true, immutable: true, match: hashPattern },
  recordHash: { type: String, required: true, immutable: true, match: hashPattern },
  chainId: { type: String, required: true, immutable: true, match: /^\d+$/ },
  contractAddress: { type: String, required: true, immutable: true, match: addressPattern, lowercase: true },
  deploymentTransactionHash: { type: String, required: true, immutable: true, match: hashPattern, lowercase: true },
  deploymentBlock: { type: Number, required: true, immutable: true, min: 0 },
  status: { type: String, enum: ['PENDING', 'CONFIRMED', 'FAILED'], required: true, default: 'PENDING' },
  attempts: { type: [attemptSchema], default: [] },
  confirmedAt: Date,
  blockNumber: { type: Number, min: 0 },
  lastErrorCode: { type: String, maxlength: 80 },
  leaseToken: { type: String, select: false },
  leaseExpiresAt: { type: Date, select: false },
}, {
  collection: 'blockchainProofOperations', timestamps: true, versionKey: false, strict: 'throw',
});

blockchainProofOperationSchema.index({
  recordType: 1, recordId: 1, proofVersion: 1, chainId: 1, contractAddress: 1, deploymentTransactionHash: 1,
}, { unique: true, name: 'audit_log_proof_deployment_unique' });
blockchainProofOperationSchema.index({ societyId: 1, createdAt: -1 });

export type BlockchainProofOperationRecord = InferSchemaType<typeof blockchainProofOperationSchema>;
export const BlockchainProofOperation = models.BlockchainProofOperation
  ?? model('BlockchainProofOperation', blockchainProofOperationSchema);

export function operationIdentity(recordId: Types.ObjectId, chainId: string, contractAddress: string, deploymentTransactionHash: string) {
  return {
    recordType: 'AUDIT_LOG', recordId, proofVersion: 1, chainId,
    contractAddress: contractAddress.toLowerCase(),
    deploymentTransactionHash: deploymentTransactionHash.toLowerCase(),
  } as const;
}
