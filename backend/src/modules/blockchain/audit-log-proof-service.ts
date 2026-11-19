import { randomUUID } from 'node:crypto';
import { mongo, Types } from 'mongoose';
import { backendConfig } from '../../config/environment.js';
import { ApiError } from '../../lib/api-error.js';
import { hashAuditLog } from '../audit/audit-log-hashing.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { deriveAuditLogReference, AUDIT_LOG_PROOF_VERSION, AUDIT_LOG_REFERENCE_DERIVATION_VERSION } from './audit-log-reference.js';
import { BlockchainProofOperation, operationIdentity } from './models/BlockchainProofOperation.js';
import { EthersGovernanceProofRegistryClient, type GovernanceProofRegistryClient, type RegistryConfiguration, type RegistryEvent } from './governance-proof-registry.js';

type AuditRecord = {
  _id: Types.ObjectId;
  societyId: Types.ObjectId;
  hashVersion: number;
  recordHash: string;
  [key: string]: unknown;
};

type OperationLike = {
  _id: Types.ObjectId;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  attempts: Array<Record<string, unknown>>;
  recordReference: string;
  recordHash: string;
  chainId: string;
  contractAddress: string;
  deploymentTransactionHash: string;
  confirmedAt?: Date;
  blockNumber?: number;
  lastErrorCode?: string;
  toObject(): Record<string, unknown>;
};

export class AuditLogProofService {
  private readonly registry: GovernanceProofRegistryClient;
  private readonly config: RegistryConfiguration;

  constructor(registry?: GovernanceProofRegistryClient, config: RegistryConfiguration | undefined = backendConfig.blockchain) {
    if (!config) throw new ApiError(503, 'BLOCKCHAIN_NOT_CONFIGURED', 'Blockchain proof integration is not configured.');
    this.config = config;
    this.registry = registry ?? new EthersGovernanceProofRegistryClient(config);
  }

  async submit(auditLogId: string): Promise<Record<string, unknown>> {
    const record = await this.loadAndVerifyRecord(auditLogId);
    const identity = operationIdentity(record._id, this.config.chainId, this.config.contractAddress, this.config.deploymentTransactionHash);
    const recordReference = deriveAuditLogReference(record.societyId, record._id);
    let operation: OperationLike;
    try {
      operation = await BlockchainProofOperation.findOneAndUpdate(identity, {
        $setOnInsert: {
          ...identity,
          societyId: record.societyId,
          referenceDerivationVersion: AUDIT_LOG_REFERENCE_DERIVATION_VERSION,
          auditLogHashVersion: normalizedHashVersion(record.hashVersion),
          recordReference,
          recordHash: record.recordHash,
          deploymentBlock: this.config.deploymentBlock,
          status: 'PENDING',
          attempts: [],
        },
      }, { upsert: true, new: true, setDefaultsOnInsert: true }).select('+leaseToken') as unknown as OperationLike;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      operation = await BlockchainProofOperation.findOne(identity).select('+leaseToken') as unknown as OperationLike;
    }
    if (!operation) throw new ApiError(500, 'BLOCKCHAIN_OPERATION_ERROR', 'Proof operation could not be persisted.');
    if (operation.recordReference !== recordReference || operation.recordHash !== record.recordHash || Number((operation as any).auditLogHashVersion) !== normalizedHashVersion(record.hashVersion)) {
      throw new ApiError(409, 'BLOCKCHAIN_PROOF_CONFLICT', 'An operation already exists with different immutable proof content.');
    }
    // A local chain reset can recreate the same deterministic deployment
    // transaction hash/address. A persisted CONFIRMED operation is therefore
    // not sufficient evidence that this proof still exists on the active
    // chain. Reconcile it before treating the request as idempotently done.
    if (operation.status === 'CONFIRMED') {
      await this.ensureDeploymentValid();
      if (await this.reconcile(recordReference, record.recordHash, transactionHashes(operation))) return serializeOperation(operation);
    }

    const leaseToken = randomUUID();
    const claimed = await BlockchainProofOperation.findOneAndUpdate({
      _id: operation._id,
      $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: null }, { leaseExpiresAt: { $lte: new Date() } }],
    }, { $set: { leaseToken, leaseExpiresAt: new Date(Date.now() + 5 * 60_000), status: 'PENDING' } }, { new: true }).select('+leaseToken') as unknown as OperationLike | null;
    if (!claimed) {
      const current = await BlockchainProofOperation.findById(operation._id) as unknown as OperationLike;
      return serializeOperation(current);
    }

    const attemptSequence = claimed.attempts.length + 1;
    let broadcastHash: string | undefined;
    const submittedAt = new Date();
    const prepared = await BlockchainProofOperation.updateOne({ _id: claimed._id, leaseToken }, {
      $push: { attempts: { sequence: attemptSequence, startedAt: submittedAt, status: 'PREPARED' } },
      $unset: { lastErrorCode: 1 },
    });
    if (prepared.matchedCount !== 1) throw new ApiError(503, 'BLOCKCHAIN_OPERATION_ERROR', 'The proof attempt could not be persisted before broadcast.');
    try {
      await this.ensureDeploymentValid();
      const recovered = await this.reconcile(recordReference, record.recordHash, transactionHashes(claimed));
      if (recovered) {
        await this.confirm(claimed._id, leaseToken, attemptSequence, recovered.transactionHash, recovered.blockNumber, recovered.sender);
        return this.getSerialized(claimed._id);
      }

      const transaction = await this.registry.registerProof(recordReference, AUDIT_LOG_PROOF_VERSION, record.recordHash);
      broadcastHash = transaction.hash;
      const broadcastRecorded = await BlockchainProofOperation.updateOne({ _id: claimed._id, leaseToken, 'attempts.sequence': attemptSequence }, {
        $set: { 'attempts.$.transactionHash': transaction.hash, 'attempts.$.sender': transaction.sender, 'attempts.$.broadcastAt': new Date(), 'attempts.$.status': 'BROADCAST' },
      });
      if (broadcastRecorded.matchedCount !== 1) throw new Error('BLOCKCHAIN_ATTEMPT_PERSISTENCE_FAILED');
      const receipt = await transaction.wait();
      if (!receipt) {
        await this.markAmbiguous(claimed._id, leaseToken, attemptSequence, 'BLOCKCHAIN_RECEIPT_UNKNOWN');
        throw new ApiError(503, 'BLOCKCHAIN_PENDING', 'The transaction outcome is not yet known; retry to reconcile it safely.');
      }
      if (receipt.status !== 1) {
        await BlockchainProofOperation.updateOne({ _id: claimed._id, leaseToken, 'attempts.sequence': attemptSequence }, {
          $set: {
            status: 'FAILED', lastErrorCode: 'BLOCKCHAIN_REVERTED', leaseExpiresAt: new Date(0),
            'attempts.$.status': 'REVERTED', 'attempts.$.receiptAt': new Date(), 'attempts.$.blockNumber': receipt.blockNumber,
            'attempts.$.errorCode': 'BLOCKCHAIN_REVERTED',
          }, $unset: { leaseToken: 1 },
        });
        return this.getSerialized(claimed._id);
      }
      const proof = await this.registry.getProof(recordReference, AUDIT_LOG_PROOF_VERSION);
      if (!proof || proof.recordReference.toLowerCase() !== recordReference || proof.version !== BigInt(AUDIT_LOG_PROOF_VERSION) || proof.recordHash.toLowerCase() !== record.recordHash) {
        await this.markAmbiguous(claimed._id, leaseToken, attemptSequence, 'BLOCKCHAIN_READBACK_MISMATCH');
        throw new ApiError(409, 'BLOCKCHAIN_PROOF_CONFLICT', 'The registered proof does not match the immutable AuditLog record.');
      }
      if (!await this.registry.verifyProof(recordReference, AUDIT_LOG_PROOF_VERSION, record.recordHash)) {
        await this.markAmbiguous(claimed._id, leaseToken, attemptSequence, 'BLOCKCHAIN_VERIFICATION_MISMATCH');
        throw new ApiError(409, 'BLOCKCHAIN_PROOF_CONFLICT', 'Registry verification did not match the immutable AuditLog record.');
      }
      await this.confirm(claimed._id, leaseToken, attemptSequence, receipt.transactionHash, receipt.blockNumber, transaction.sender);
      return this.getSerialized(claimed._id);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'BLOCKCHAIN_PROOF_CONFLICT') {
          await this.markRejected(claimed._id, leaseToken, attemptSequence, error.code).catch(() => undefined);
        } else {
          await this.markAmbiguous(claimed._id, leaseToken, attemptSequence, error.code).catch(() => undefined);
        }
        throw error;
      }
      if (isKnownRevert(error)) {
        await this.markFailed(claimed._id, leaseToken, attemptSequence, broadcastHash, 'BLOCKCHAIN_REVERTED').catch(() => undefined);
        return this.getSerialized(claimed._id);
      }
      const errorCode = classifyFailure(error);
      await this.markAmbiguous(claimed._id, leaseToken, attemptSequence, errorCode).catch(() => undefined);
      throw new ApiError(503, errorCode, 'Blockchain proof submission could not be confirmed. Retry to reconcile the on-chain state.');
    }
  }

  async status(auditLogId: string): Promise<Record<string, unknown> | null> {
    const record = await this.loadRecord(auditLogId);
    const identity = operationIdentity(record._id, this.config.chainId, this.config.contractAddress, this.config.deploymentTransactionHash);
    const operation = await BlockchainProofOperation.findOne(identity) as unknown as OperationLike | null;
    if (operation) return serializeOperation(operation);
    const priorDeployment = await BlockchainProofOperation.findOne({
      recordType: 'AUDIT_LOG', recordId: record._id, proofVersion: AUDIT_LOG_PROOF_VERSION,
    }).sort({ updatedAt: -1 }) as unknown as OperationLike | null;
    return priorDeployment ? {
      ...serializeOperation(priorDeployment),
      status: 'STALE_DEPLOYMENT',
      activeDeployment: {
        chainId: this.config.chainId,
        contractAddress: this.config.contractAddress,
        deploymentTransactionHash: this.config.deploymentTransactionHash,
      },
    } : null;
  }

  async verify(auditLogId: string): Promise<Record<string, unknown>> {
    const record = await this.loadRecord(auditLogId);
    let computedHash: string;
    try { computedHash = hashAuditLog(record as unknown as Record<string, unknown>); }
    catch { return { auditLogId, recordIntegrity: false, proofStatus: 'NOT_VERIFIED', verified: false }; }
    if (computedHash !== record.recordHash) return { auditLogId, recordIntegrity: false, storedRecordHash: record.recordHash, computedRecordHash: computedHash, proofStatus: 'NOT_VERIFIED', verified: false };
    const recordReference = deriveAuditLogReference(record.societyId, record._id);
    await this.ensureDeploymentValid();
    const proof = await this.registry.getProof(recordReference, AUDIT_LOG_PROOF_VERSION);
    if (!proof) {
      const historicalConfirmation = await BlockchainProofOperation.exists({
        recordType: 'AUDIT_LOG', recordId: record._id, proofVersion: AUDIT_LOG_PROOF_VERSION,
        $or: [{ status: 'CONFIRMED' }, { 'attempts.status': 'CONFIRMED' }],
      });
      return { auditLogId, societyId: record.societyId.toString(), recordIntegrity: true, recordReference,
        proofVersion: AUDIT_LOG_PROOF_VERSION, chainId: this.config.chainId,
        contractAddress: this.config.contractAddress, deploymentTransactionHash: this.config.deploymentTransactionHash,
        proofStatus: historicalConfirmation ? 'UNVERIFIABLE' : 'UNKNOWN', verified: false };
    }
    const proofMatches = proof.recordReference.toLowerCase() === recordReference
      && proof.version === BigInt(AUDIT_LOG_PROOF_VERSION)
      && proof.recordHash.toLowerCase() === computedHash;
    if (!proofMatches) {
      return {
        auditLogId,
        societyId: record.societyId.toString(),
        recordIntegrity: true,
        storedRecordHash: record.recordHash,
        computedRecordHash: computedHash,
        recordReference,
        proofVersion: AUDIT_LOG_PROOF_VERSION,
        chainId: this.config.chainId,
        contractAddress: this.config.contractAddress,
        deploymentTransactionHash: this.config.deploymentTransactionHash,
        onChainRecordHash: proof.recordHash,
        proofStatus: 'CONFLICT',
        verified: false,
      };
    }
    const identity = operationIdentity(record._id, this.config.chainId, this.config.contractAddress, this.config.deploymentTransactionHash);
    const operation = await BlockchainProofOperation.findOne(identity) as unknown as OperationLike | null;
    const event = (await this.registry.findProofEvents(recordReference, AUDIT_LOG_PROOF_VERSION, transactionHashes(operation)))
      .find((candidate) => candidate.recordHash.toLowerCase() === computedHash);
    if (!event) return { auditLogId, recordIntegrity: true, recordReference, proofVersion: AUDIT_LOG_PROOF_VERSION, proofStatus: 'PENDING', verified: false };
    const receipt = await this.registry.getTransactionReceipt(event.transactionHash);
    if (!receipt || receipt.status === null) {
      return { auditLogId, recordIntegrity: true, recordReference, transactionHash: event.transactionHash, proofVersion: AUDIT_LOG_PROOF_VERSION, proofStatus: 'PENDING', verified: false };
    }
    if (receipt.status !== 1 || receipt.blockNumber !== event.blockNumber) {
      return { auditLogId, recordIntegrity: true, recordReference, transactionHash: event.transactionHash, proofVersion: AUDIT_LOG_PROOF_VERSION, proofStatus: 'CONFLICT', verified: false };
    }
    const match = await this.registry.verifyProof(recordReference, AUDIT_LOG_PROOF_VERSION, computedHash);
    return {
      auditLogId,
      societyId: record.societyId.toString(),
      recordIntegrity: true,
      storedRecordHash: record.recordHash,
      computedRecordHash: computedHash,
      recordReference,
      proofVersion: AUDIT_LOG_PROOF_VERSION,
      chainId: this.config.chainId,
      contractAddress: this.config.contractAddress,
      deploymentTransactionHash: this.config.deploymentTransactionHash,
      onChainRecordHash: proof.recordHash,
      transactionHash: event.transactionHash,
      blockNumber: receipt.blockNumber,
      receiptStatus: receipt.status,
      proofStatus: match ? 'CONFIRMED' : 'CONFLICT',
      verified: match,
    };
  }

  private async loadRecord(auditLogId: string): Promise<AuditRecord> {
    if (!Types.ObjectId.isValid(auditLogId)) throw new ApiError(400, 'VALIDATION_ERROR', 'auditLogId must be a valid ObjectId.');
    const record = await AuditLog.findById(new Types.ObjectId(auditLogId)).exec() as unknown as AuditRecord | null;
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
    if (!(record.societyId instanceof Types.ObjectId)) throw new ApiError(409, 'BLOCKCHAIN_RECORD_INVALID', 'Only society-scoped AuditLog events can be proved.');
    return record;
  }

  private async ensureDeploymentValid(): Promise<void> {
    try { await this.registry.validateDeployment(); }
    catch (error) {
      const code = classifyFailure(error);
      throw new ApiError(503, code, 'The configured blockchain network or registry deployment could not be verified.');
    }
  }

  private async loadAndVerifyRecord(auditLogId: string): Promise<AuditRecord> {
    const record = await this.loadRecord(auditLogId);
    let computedHash: string;
    try { computedHash = hashAuditLog(record as unknown as Record<string, unknown>); }
    catch { throw new ApiError(409, 'AUDIT_LOG_INTEGRITY_ERROR', 'The persisted AuditLog content cannot be verified against its stored hash.'); }
    if (computedHash !== record.recordHash) throw new ApiError(409, 'AUDIT_LOG_INTEGRITY_ERROR', 'The persisted AuditLog content does not match its stored canonical hash.');
    return record;
  }

  private async reconcile(reference: string, recordHash: string, hashes: string[] = []): Promise<RegistryEvent | null> {
    const proof = await this.registry.getProof(reference, AUDIT_LOG_PROOF_VERSION);
    if (!proof) return null;
    if (proof.recordHash.toLowerCase() !== recordHash) throw new ApiError(409, 'BLOCKCHAIN_PROOF_CONFLICT', 'A different proof is already registered for this AuditLog reference and version.');
    const events = await this.registry.findProofEvents(reference, AUDIT_LOG_PROOF_VERSION, hashes);
    const event = events.find((candidate) => candidate.recordHash.toLowerCase() === recordHash);
    if (!event) throw new ApiError(503, 'BLOCKCHAIN_RECONCILIATION_REQUIRED', 'The existing proof could not be reconciled to its registration transaction.');
    const receipt = await this.registry.getTransactionReceipt(event.transactionHash);
    if (!receipt || receipt.status !== 1 || receipt.blockNumber !== event.blockNumber) throw new ApiError(503, 'BLOCKCHAIN_RECONCILIATION_REQUIRED', 'The existing proof transaction receipt is not successfully confirmed yet.');
    if (!await this.registry.verifyProof(reference, AUDIT_LOG_PROOF_VERSION, recordHash)) {
      throw new ApiError(409, 'BLOCKCHAIN_PROOF_CONFLICT', 'Registry verification did not match the immutable AuditLog record.');
    }
    return { ...event, blockNumber: receipt.blockNumber };
  }

  private async confirm(id: Types.ObjectId, leaseToken: string, sequence: number, transactionHash: string, blockNumber: number, sender?: string): Promise<void> {
    const result = await BlockchainProofOperation.updateOne({ _id: id, leaseToken, 'attempts.sequence': sequence }, {
      $set: {
        status: 'CONFIRMED', confirmedAt: new Date(), blockNumber,
        leaseExpiresAt: new Date(0), 'attempts.$.transactionHash': transactionHash,
        'attempts.$.receiptAt': new Date(), 'attempts.$.blockNumber': blockNumber, 'attempts.$.status': 'CONFIRMED',
        ...(sender ? { 'attempts.$.sender': sender } : {}),
      }, $unset: { leaseToken: 1, lastErrorCode: 1 },
    });
    if (result.matchedCount !== 1) throw new Error('BLOCKCHAIN_OPERATION_PERSISTENCE_FAILED');
  }

  private async markAmbiguous(id: Types.ObjectId, leaseToken: string, sequence: number, errorCode: string): Promise<void> {
    await BlockchainProofOperation.updateOne({ _id: id, leaseToken, 'attempts.sequence': sequence }, {
      $set: {
        status: 'PENDING', lastErrorCode: errorCode, leaseExpiresAt: new Date(0),
        'attempts.$.status': 'AMBIGUOUS', 'attempts.$.errorCode': errorCode,
      }, $unset: { leaseToken: 1 },
    });
  }

  private async markFailed(id: Types.ObjectId, leaseToken: string, sequence: number, transactionHash: string | undefined, errorCode: string): Promise<void> {
    await BlockchainProofOperation.updateOne({ _id: id, leaseToken, 'attempts.sequence': sequence }, {
      $set: {
        status: 'FAILED', lastErrorCode: errorCode, leaseExpiresAt: new Date(0),
        'attempts.$.status': 'REVERTED', 'attempts.$.receiptAt': new Date(), 'attempts.$.errorCode': errorCode,
        ...(transactionHash ? { 'attempts.$.transactionHash': transactionHash } : {}),
      }, $unset: { leaseToken: 1 },
    });
  }

  private async markRejected(id: Types.ObjectId, leaseToken: string, sequence: number, errorCode: string): Promise<void> {
    await BlockchainProofOperation.updateOne({ _id: id, leaseToken, 'attempts.sequence': sequence }, {
      $set: {
        status: 'FAILED', lastErrorCode: errorCode, leaseExpiresAt: new Date(0),
        'attempts.$.status': 'AMBIGUOUS', 'attempts.$.errorCode': errorCode,
      }, $unset: { leaseToken: 1 },
    });
  }

  private async getSerialized(id: Types.ObjectId): Promise<Record<string, unknown>> {
    const operation = await BlockchainProofOperation.findById(id) as unknown as OperationLike | null;
    if (!operation) throw new ApiError(500, 'BLOCKCHAIN_OPERATION_ERROR', 'Proof operation could not be retrieved.');
    return serializeOperation(operation);
  }
}

function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('CHAIN_MISMATCH') || message.includes('CONTRACT_MISSING') || message.includes('DEPLOYMENT_MISMATCH') || message.includes('SIGNER_UNAUTHORIZED')) return message;
  if (message.includes('insufficient funds')) return 'BLOCKCHAIN_INSUFFICIENT_FUNDS';
  return 'BLOCKCHAIN_OUTCOME_AMBIGUOUS';
}

function transactionHashes(operation: OperationLike | null): string[] {
  return (operation?.attempts ?? [])
    .map((attempt) => attempt.transactionHash)
    .filter((hash): hash is string => typeof hash === 'string');
}

function isKnownRevert(error: unknown): boolean {
  const value = error as { code?: string; receipt?: { status?: number } };
  return value?.receipt?.status === 0 || value?.code === 'CALL_EXCEPTION';
}

function normalizedHashVersion(value: unknown): number {
  return value instanceof mongo.BSON.Int32 ? value.value : Number(value);
}

function serializeOperation(operation: OperationLike): Record<string, unknown> {
  const raw = operation.toObject();
  delete raw.leaseToken;
  delete raw.leaseExpiresAt;
  delete raw.__v;
  return raw;
}
