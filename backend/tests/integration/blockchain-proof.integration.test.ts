import express from 'express';
import { createServer } from 'node:http';
import { keccak256, toUtf8Bytes } from 'ethers';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { createBlockchainRouter } from '../../src/modules/blockchain/blockchain-routes.js';
import { deriveAuditLogReference } from '../../src/modules/blockchain/audit-log-reference.js';
import { AuditLogProofService } from '../../src/modules/blockchain/audit-log-proof-service.js';
import type { GovernanceProofRegistryClient, ProofReceipt, RegistryEvent, RegistryProof } from '../../src/modules/blockchain/governance-proof-registry.js';
import { BlockchainProofOperation } from '../../src/modules/blockchain/models/BlockchainProofOperation.js';
import { User } from '../../src/modules/users/models/User.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'blockchain-proof-integration-secret-32-bytes';
const societyA = new Types.ObjectId('68a123456789012345678902');
const societyB = new Types.ObjectId('68a123456789012345678903');
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const ownerA = new Types.ObjectId();
const admin = new Types.ObjectId();
const config = {
  rpcUrl: 'http://127.0.0.1:8545', chainId: '31337',
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  deploymentTransactionHash: `0x${'a'.repeat(64)}`, deploymentBlock: 1,
  signerPrivateKey: `0x${'b'.repeat(64)}`,
};

class FakeRegistry implements GovernanceProofRegistryClient {
  proofs = new Map<string, RegistryProof>();
  events: RegistryEvent[] = [];
  receipts = new Map<string, ProofReceipt>();
  mode: 'success' | 'revert' | 'ambiguous' = 'success';
  validationError?: Error;
  verificationOverride?: boolean;
  registrations = 0;
  beforeReturn?: () => Promise<void>;

  async validateDeployment() { if (this.validationError) throw this.validationError; }
  async getProof(reference: string, version: number) { return this.proofs.get(`${reference}:${version}`) ?? null; }
  async findProofEvents(reference: string, version: number) {
    const proof = this.proofs.get(`${reference}:${version}`);
    return proof ? this.events.filter((event) => event.recordHash === proof.recordHash) : [];
  }
  async getTransactionReceipt(hash: string) { return this.receipts.get(hash) ?? null; }
  async verifyProof(reference: string, version: number, hash: string) { return this.verificationOverride ?? ((await this.getProof(reference, version))?.recordHash === hash); }
  async registerProof(reference: string, version: number, recordHash: string) {
    this.registrations += 1;
    await this.beforeReturn?.();
    const hash = keccak256(toUtf8Bytes(`tx-${this.registrations}`));
    if (this.mode === 'revert') {
      this.receipts.set(hash, { status: 0, blockNumber: 2, transactionHash: hash });
      return { hash, sender: '0x0000000000000000000000000000000000000001', wait: async () => this.receipts.get(hash)! };
    }
    const proof = { recordReference: reference, version: BigInt(version), recordHash, registeredBy: '0x0000000000000000000000000000000000000001', registeredAt: 1n };
    this.proofs.set(`${reference}:${version}`, proof);
    this.events.push({ transactionHash: hash, blockNumber: 2, recordHash });
    this.receipts.set(hash, { status: 1, blockNumber: 2, transactionHash: hash });
    if (this.mode === 'ambiguous') throw new Error('simulated response lost after broadcast');
    return { hash, sender: proof.registeredBy, wait: async () => this.receipts.get(hash)! };
  }
}

const registry = new FakeRegistry();
const service = new AuditLogProofService(registry, config);
const application = express();
application.use('/api', createBlockchainRouter(service, createAuthenticationMiddleware(() => secret)));
application.use(errorHandler);

async function call(path: string, userId: Types.ObjectId, method = 'GET'): Promise<{ response: Response; body: any }> {
  const token = await issueAccessToken(userId.toString(), { secret, accessTokenTtlSeconds: 300 });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration server did not bind.');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return { response, body };
}

async function insertAudit(societyId = societyA) {
  const record = new AuditLog({ societyId, actorId: managerA, action: 'PROJECT_SUBMITTED_FOR_APPROVAL', entityType: 'ApprovalDecision', entityId: new Types.ObjectId(), metadata: { approvalRoute: 'configured' } });
  await record.save();
  return record;
}

describe('AuditLog blockchain proof API and service integration', () => {
  beforeAll(async () => { await connectIntegrationTestDatabase(); });
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    registry.proofs.clear(); registry.events = []; registry.receipts.clear(); registry.mode = 'success'; registry.validationError = undefined; registry.verificationOverride = undefined; registry.registrations = 0; registry.beforeReturn = undefined;
    await User.create([
      { _id: managerA, societyId: societyA, name: 'Manager A', email: `${managerA}@proof.test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE' },
      { _id: managerB, societyId: societyB, name: 'Manager B', email: `${managerB}@proof.test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE' },
      { _id: ownerA, societyId: societyA, name: 'Owner A', email: `${ownerA}@proof.test`, role: 'OWNER_MEMBER', status: 'ACTIVE' },
      { _id: admin, societyId: null, name: 'Admin', email: `${admin}@proof.test`, role: 'SYSTEM_ADMIN', status: 'ACTIVE' },
    ]);
    await Ownership.create({ societyId: societyA, flatId: new Types.ObjectId(), userId: ownerA, ownershipType: 'PRIMARY', status: 'ACTIVE' });
  });
  afterAll(async () => { await disconnectIntegrationTestDatabase(); });

  it('enforces role authorization and society isolation', async () => {
    const record = await insertAudit();
    expect((await call(`/api/blockchain/audit-logs/${record.id}/proof`, ownerA, 'POST')).response.status).toBe(403);
    expect((await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerB, 'POST')).response.status).toBe(403);
    expect((await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerA, 'POST')).response.status).toBe(200);
    expect((await call(`/api/blockchain/audit-logs/${record.id}/proof`, admin)).response.status).toBe(200);
  });

  it('rejects tampered persisted AuditLog content', async () => {
    const record = await insertAudit();
    await mongoose.connection.db?.collection('auditLogs').updateOne({ _id: record._id }, { $set: { action: 'ALTERED_EVENT' } });
    const { response, body } = await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerA, 'POST');
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('AUDIT_LOG_INTEGRITY_ERROR');
    expect(registry.registrations).toBe(0);
  });

  it('submits once, confirms by receipt/read-back, and returns status and independent verification', async () => {
    const record = await insertAudit();
    let operationPersistedBeforeBroadcast = false;
    registry.beforeReturn = async () => {
      operationPersistedBeforeBroadcast = await BlockchainProofOperation.exists({ recordId: record._id }) !== null;
    };
    const submitted = await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerA, 'POST');
    expect(submitted.response.status).toBe(200);
    expect(submitted.body.data.status).toBe('CONFIRMED');
    expect(operationPersistedBeforeBroadcast).toBe(true);
    expect(submitted.body.data.attempts[0].transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(submitted.body.data).not.toHaveProperty('record');
    expect(registry.registrations).toBe(1);
    const status = await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerA);
    expect(status.body.data.status).toBe('CONFIRMED');
    const verified = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(verified.body.data.verified).toBe(true);
    expect(verified.body.data.onChainRecordHash).toBe(record.recordHash);
    const ownerStatus = await call(`/api/blockchain/audit-logs/${record.id}/proof`, ownerA);
    expect(ownerStatus.response.status).toBe(200);
    expect(ownerStatus.body.data.status).toBe('CONFIRMED');
    const ownerVerification = await call(`/api/blockchain/verify/audit-logs/${record.id}`, ownerA);
    expect(ownerVerification.response.status).toBe(200);
    expect(ownerVerification.body.data.verified).toBe(true);
  });

  it('converges concurrent requests on one persisted operation and transaction', async () => {
    const record = await insertAudit();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    registry.beforeReturn = async () => { entered(); await gate; };
    const first = service.submit(record.id);
    await started;
    const second = await service.submit(record.id);
    expect(second.status).toBe('PENDING');
    release();
    expect((await first).status).toBe('CONFIRMED');
    expect(registry.registrations).toBe(1);
    expect(await BlockchainProofOperation.countDocuments({ recordId: record._id })).toBe(1);
  });

  it('records reverted attempts as FAILED and safely retries them', async () => {
    const record = await insertAudit();
    registry.mode = 'revert';
    const failed = await service.submit(record.id);
    expect(failed.status).toBe('FAILED');
    registry.mode = 'success';
    const recovered = await service.submit(record.id);
    expect(recovered.status).toBe('CONFIRMED');
    expect((recovered.attempts as unknown[])).toHaveLength(2);
  });

  it('reconciles an on-chain success after the response is lost without broadcasting again', async () => {
    const record = await insertAudit();
    registry.mode = 'ambiguous';
    await expect(service.submit(record.id)).rejects.toMatchObject({ code: 'BLOCKCHAIN_OUTCOME_AMBIGUOUS' });
    registry.mode = 'success';
    const recovered = await service.submit(record.id);
    expect(recovered.status).toBe('CONFIRMED');
    expect(registry.registrations).toBe(1);
    expect((recovered.attempts as unknown[])).toHaveLength(2);
  });

  it('never overwrites a conflicting on-chain hash', async () => {
    const record = await insertAudit();
    const reference = deriveAuditLogReference(societyA, record._id);
    registry.proofs.set(`${reference}:1`, { recordReference: reference, version: 1n, recordHash: `0x${'f'.repeat(64)}`, registeredBy: '0x0000000000000000000000000000000000000001', registeredAt: 1n });
    const { response, body } = await call(`/api/blockchain/audit-logs/${record.id}/proof`, managerA, 'POST');
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('BLOCKCHAIN_PROOF_CONFLICT');
    expect(registry.registrations).toBe(0);
  });

  it('does not report a matching stored proof as confirmed until its successful receipt is available', async () => {
    const record = await insertAudit();
    const reference = deriveAuditLogReference(societyA, record._id);
    const transactionHash = `0x${'c'.repeat(64)}`;
    registry.proofs.set(`${reference}:1`, { recordReference: reference, version: 1n, recordHash: record.recordHash, registeredBy: '0x0000000000000000000000000000000000000001', registeredAt: 1n });
    registry.events.push({ transactionHash, blockNumber: 2, recordHash: record.recordHash });
    const { body: beforeReceipt } = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(beforeReceipt.data.proofStatus).toBe('PENDING');
    expect(beforeReceipt.data.verified).toBe(false);
    registry.receipts.set(transactionHash, { status: 1, blockNumber: 2, transactionHash });
    const { body: afterReceipt } = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(afterReceipt.data.proofStatus).toBe('CONFIRMED');
    expect(afterReceipt.data.verified).toBe(true);
  });

  it('reports unknown proofs and rejects incorrect chain or contract deployment configuration', async () => {
    const record = await insertAudit();
    const unknown = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(unknown.body.data.proofStatus).toBe('UNKNOWN');
    registry.validationError = new Error('BLOCKCHAIN_CHAIN_MISMATCH');
    const wrongNetwork = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(wrongNetwork.response.status).toBe(503);
    expect(wrongNetwork.body.error.code).toBe('BLOCKCHAIN_CHAIN_MISMATCH');
    registry.validationError = new Error('BLOCKCHAIN_DEPLOYMENT_MISMATCH');
    const wrongContract = await call(`/api/blockchain/verify/audit-logs/${record.id}`, managerA);
    expect(wrongContract.response.status).toBe(503);
    expect(wrongContract.body.error.code).toBe('BLOCKCHAIN_DEPLOYMENT_MISMATCH');
  });
});
