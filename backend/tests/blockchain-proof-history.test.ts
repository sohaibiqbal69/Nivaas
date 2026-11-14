import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mongo, Types } from 'mongoose';
import { hashAuditLog } from '../src/modules/audit/audit-log-hashing.js';
import { ApiError } from '../src/lib/api-error.js';
import { AuditLog } from '../src/modules/audit/models/AuditLog.js';
import { deriveAuditLogReference } from '../src/modules/blockchain/audit-log-reference.js';
import { AuditLogProofService } from '../src/modules/blockchain/audit-log-proof-service.js';
import { BlockchainProofOperation } from '../src/modules/blockchain/models/BlockchainProofOperation.js';
import type { GovernanceProofRegistryClient, RegistryEvent, RegistryProof, ProofReceipt } from '../src/modules/blockchain/governance-proof-registry.js';

const config = {
  rpcUrl: 'http://127.0.0.1:8545', chainId: '31337',
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  deploymentTransactionHash: `0x${'a'.repeat(64)}`, deploymentBlock: 1, signerPrivateKey: `0x${'b'.repeat(64)}`,
};

function historicalRecord() {
  const record: Record<string, unknown> = {
    _id: new Types.ObjectId('63a123456789012345678901'),
    societyId: new Types.ObjectId('63a123456789012345678902'),
    actorId: new Types.ObjectId('63a123456789012345678903'),
    action: 'PROJECT_SUBMITTED_FOR_APPROVAL', entityType: 'Project',
    entityId: new Types.ObjectId('63a123456789012345678904'),
    hashVersion: new mongo.BSON.Int32(1), createdAt: new Date('2023-04-05T06:07:08.000Z'),
  };
  record.recordHash = hashAuditLog(record);
  return record;
}

function registryFor(record: Record<string, any>, hasProof: boolean): GovernanceProofRegistryClient {
  const reference = deriveAuditLogReference(record.societyId, record._id);
  const transactionHash = `0x${'c'.repeat(64)}`;
  return {
    async validateDeployment() {},
    async getProof() {
      return hasProof ? { recordReference: reference, version: 1n, recordHash: record.recordHash, registeredBy: '0x0000000000000000000000000000000000000001', registeredAt: 1n } : null;
    },
    async findProofEvents() { return hasProof ? [{ transactionHash, blockNumber: 2, recordHash: record.recordHash }] : []; },
    async getTransactionReceipt() { return hasProof ? { status: 1, blockNumber: 2, transactionHash } : null; },
    async registerProof() { throw new Error('Not used in verification test.'); },
    async verifyProof() { return hasProof; },
  };
}

function savedOperation(record: Record<string, any>, status: 'PENDING' | 'CONFIRMED', attempts: Array<Record<string, unknown>> = []) {
  const reference = deriveAuditLogReference(record.societyId, record._id);
  return {
    _id: new Types.ObjectId(), recordType: 'AUDIT_LOG', recordId: record._id, societyId: record.societyId,
    referenceDerivationVersion: 1, proofVersion: 1, auditLogHashVersion: 1,
    recordReference: reference, recordHash: record.recordHash, chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(), deploymentTransactionHash: config.deploymentTransactionHash,
    deploymentBlock: config.deploymentBlock, status, attempts,
    toObject() { return { ...this, attempts: this.attempts.map((attempt: Record<string, unknown>) => ({ ...attempt })) }; },
  } as any;
}

function mockOperationPersistence(operation: ReturnType<typeof savedOperation>) {
  vi.spyOn(BlockchainProofOperation, 'findOneAndUpdate').mockImplementation((_filter: any, update: any) => ({
    select: async () => {
      if (update.$set?.leaseToken) operation.status = 'PENDING';
      return operation;
    },
  }) as any);
  vi.spyOn(BlockchainProofOperation, 'updateOne').mockImplementation(async (_filter: any, update: any) => {
    if (update.$push?.attempts) operation.attempts.push(update.$push.attempts);
    const sequence = update.$set?.['attempts.$.sequence']
      ?? operation.attempts.at(-1)?.sequence;
    const attempt = operation.attempts.find((entry: Record<string, unknown>) => entry.sequence === sequence);
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      if (path.startsWith('attempts.$.') && attempt) attempt[path.slice('attempts.$.'.length)] = value;
      else operation[path] = value;
    }
    if (update.$unset?.leaseToken) delete operation.leaseToken;
    return { matchedCount: 1 } as any;
  });
  vi.spyOn(BlockchainProofOperation, 'findById').mockResolvedValue(operation as any);
}

beforeEach(() => { vi.spyOn(BlockchainProofOperation, 'exists').mockResolvedValue(null); });
afterEach(() => vi.restoreAllMocks());

describe('historical AuditLog proof lookup', () => {
  it('reports a lost historical confirmation as unverifiable after a local-chain reset', async () => {
    const record = historicalRecord();
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    vi.mocked(BlockchainProofOperation.exists).mockResolvedValue({ _id: new Types.ObjectId() });
    const registry = registryFor(record, false);
    const submit = vi.spyOn(registry, 'registerProof');
    const result = await new AuditLogProofService(registry, config).verify(String(record._id));
    expect(result).toMatchObject({ proofStatus: 'UNVERIFIABLE', verified: false, recordIntegrity: true });
    expect(submit).not.toHaveBeenCalled();
  });
  it('verifies an existing proof for an old immutable event using the stored reference and hash', async () => {
    const record = historicalRecord();
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    const result = await new AuditLogProofService(registryFor(record, true), config).verify(String(record._id));
    expect(result).toMatchObject({ proofStatus: 'CONFIRMED', verified: true, recordIntegrity: true, blockNumber: 2 });
  });

  it('returns no-proof for an intact historical event when the active registry has no proof', async () => {
    const record = historicalRecord();
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    const result = await new AuditLogProofService(registryFor(record, false), config).verify(String(record._id));
    expect(result).toMatchObject({ proofStatus: 'UNKNOWN', verified: false, recordIntegrity: true });
  });

  it('rejects a historical event whose persisted content no longer matches its stored hash', async () => {
    const record = historicalRecord();
    record.action = 'ALTERED_EVENT';
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    const operationWrite = vi.spyOn(BlockchainProofOperation, 'findOneAndUpdate');
    await expect(new AuditLogProofService(registryFor(record, false), config).submit(String(record._id)))
      .rejects.toMatchObject({ code: 'AUDIT_LOG_INTEGRITY_ERROR' } satisfies Partial<ApiError>);
    expect(operationWrite).not.toHaveBeenCalled();
  });

  it('submits and confirms an intact historical event without using its creation date as a cutoff', async () => {
    const record = historicalRecord();
    const reference = deriveAuditLogReference(record.societyId as Types.ObjectId, record._id as Types.ObjectId);
    const txHash = `0x${'e'.repeat(64)}`;
    const receipt: ProofReceipt = { status: 1, blockNumber: 9, transactionHash: txHash };
    let proof: RegistryProof | null = null;
    let events: RegistryEvent[] = [];
    const registry: GovernanceProofRegistryClient = {
      async validateDeployment() {},
      async getProof() { return proof; },
      async findProofEvents() { return events; },
      async getTransactionReceipt() { return receipt; },
      async verifyProof(_reference, _version, hash) { return proof?.recordHash === hash; },
      async registerProof(recordReference, version, recordHash) {
        proof = { recordReference, version: BigInt(version), recordHash, registeredBy: '0x0000000000000000000000000000000000000001', registeredAt: 1n };
        events = [{ transactionHash: txHash, blockNumber: 9, recordHash }];
        return { hash: txHash, sender: proof.registeredBy, wait: async () => receipt };
      },
    };
    const operation: any = {
      _id: new Types.ObjectId(), recordType: 'AUDIT_LOG', recordId: record._id, societyId: record.societyId,
      referenceDerivationVersion: 1, proofVersion: 1, auditLogHashVersion: 1,
      recordReference: reference, recordHash: record.recordHash, chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(), deploymentTransactionHash: config.deploymentTransactionHash,
      deploymentBlock: config.deploymentBlock, status: 'PENDING', attempts: [],
      toObject() { return { ...this, attempts: this.attempts.map((attempt: Record<string, unknown>) => ({ ...attempt })) }; },
    };
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    vi.spyOn(BlockchainProofOperation, 'findOneAndUpdate').mockImplementation(() => ({ select: async () => operation }) as any);
    vi.spyOn(BlockchainProofOperation, 'updateOne').mockImplementation(async (_filter: any, update: any) => {
      if (update.$push?.attempts) operation.attempts.push(update.$push.attempts);
      for (const [path, value] of Object.entries(update.$set ?? {})) {
        if (path.startsWith('attempts.$.')) Object.assign(operation.attempts[0], { [path.slice('attempts.$.'.length)]: value });
        else operation[path] = value;
      }
      if (update.$unset?.leaseToken) delete operation.leaseToken;
      return { matchedCount: 1 } as any;
    });
    vi.spyOn(BlockchainProofOperation, 'findById').mockResolvedValue(operation as any);

    const result = await new AuditLogProofService(registry, config).submit(String(record._id));
    expect(record.createdAt).toEqual(new Date('2023-04-05T06:07:08.000Z'));
    expect(result).toMatchObject({ status: 'CONFIRMED', blockNumber: 9 });
    expect((result.attempts as Array<Record<string, unknown>>)).toHaveLength(1);
    expect((await new AuditLogProofService(registry, config).verify(String(record._id))).verified).toBe(true);
  });

  it('reconciles a persisted CONFIRMED operation and resubmits when the active chain has lost its proof', async () => {
    const record = historicalRecord();
    const txHash = `0x${'f'.repeat(64)}`;
    let proof: RegistryProof | null = null;
    let events: RegistryEvent[] = [];
    let registrations = 0;
    const receipt: ProofReceipt = { status: 1, blockNumber: 12, transactionHash: txHash };
    const registry: GovernanceProofRegistryClient = {
      async validateDeployment() {},
      async getProof() { return proof; },
      async findProofEvents() { return events; },
      async getTransactionReceipt() { return receipt; },
      async verifyProof(_reference, _version, hash) { return proof?.recordHash === hash; },
      async registerProof(reference, version, recordHash) {
        registrations += 1;
        const sender = '0x0000000000000000000000000000000000000001';
        proof = { recordReference: reference, version: BigInt(version), recordHash, registeredBy: sender, registeredAt: 1n };
        events = [{ transactionHash: txHash, blockNumber: 12, recordHash, sender }];
        return { hash: txHash, sender, wait: async () => receipt };
      },
    };
    const oldAttempt = { sequence: 1, startedAt: new Date('2023-04-06T00:00:00.000Z'), status: 'CONFIRMED', transactionHash: `0x${'e'.repeat(64)}` };
    const operation = savedOperation(record, 'CONFIRMED', [oldAttempt]);
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    mockOperationPersistence(operation);

    const result = await new AuditLogProofService(registry, config).submit(String(record._id));
    expect(registrations).toBe(1);
    expect(result).toMatchObject({ status: 'CONFIRMED', blockNumber: 12 });
    expect(result.attempts).toHaveLength(2);
    expect((result.attempts as Array<Record<string, unknown>>)[0].transactionHash).toBe(oldAttempt.transactionHash);
  });

  it('keeps a persisted CONFIRMED operation idempotent when its proof still verifies on the active chain', async () => {
    const record = historicalRecord();
    const operation = savedOperation(record, 'CONFIRMED', [{ sequence: 1, status: 'CONFIRMED', transactionHash: `0x${'c'.repeat(64)}` }]);
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    const upsert = vi.spyOn(BlockchainProofOperation, 'findOneAndUpdate').mockReturnValue({ select: async () => operation } as any);

    const result = await new AuditLogProofService(registryFor(record, true), config).submit(String(record._id));
    expect(result.status).toBe('CONFIRMED');
    expect(result.attempts).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('reports an operation from a previous deployment without calling it confirmed on the active registry', async () => {
    const record = historicalRecord();
    const oldOperation = {
      _id: new Types.ObjectId(), status: 'CONFIRMED', attempts: [], recordReference: deriveAuditLogReference(record.societyId as Types.ObjectId, record._id as Types.ObjectId),
      recordHash: record.recordHash, chainId: '31337', contractAddress: '0x0000000000000000000000000000000000000002',
      deploymentTransactionHash: `0x${'d'.repeat(64)}`, toObject() { return { ...this }; },
    };
    vi.spyOn(AuditLog, 'findById').mockReturnValue({ exec: async () => record } as any);
    const findOne = vi.spyOn(BlockchainProofOperation, 'findOne')
      .mockReturnValueOnce(Promise.resolve(null) as any)
      .mockReturnValueOnce({ sort: () => Promise.resolve(oldOperation) } as any);
    const status = await new AuditLogProofService(registryFor(record, false), config).status(String(record._id));
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(status).toMatchObject({
      status: 'STALE_DEPLOYMENT',
      deploymentTransactionHash: oldOperation.deploymentTransactionHash,
      activeDeployment: { deploymentTransactionHash: config.deploymentTransactionHash },
    });
  });
});
