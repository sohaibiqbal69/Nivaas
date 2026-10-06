import mongoose, { type ClientSession } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api-error.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { hashAuditLog } from '../../src/modules/audit/audit-log-hashing.js';
import {
  AccountSetupService,
  type AccountSetupRepository,
  type SetupAuditLogInput,
  type SetupCredentialRecord,
  type SetupUserRecord,
} from '../../src/modules/auth/account-setup-service.js';
import { generateSetupCredential } from '../../src/modules/auth/credential.js';
import { AccountSetupCredential } from '../../src/modules/auth/models/AccountSetupCredential.js';
import { verifyPassword } from '../../src/modules/auth/password.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const validNewPassword = 'newSecurePassword123';

function createMongoRepository(failAuditLogCreation = false): AccountSetupRepository {
  return {
    async withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>): Promise<T> {
      const session = await mongoose.startSession();
      try {
        return await session.withTransaction(() => operation(session)) as T;
      } finally {
        await session.endSession();
      }
    },

    async findCredentialByHash(credentialHash: string, session?: ClientSession | null) {
      return AccountSetupCredential.findOne({ credentialHash })
        .session(session ?? null)
        .exec() as Promise<SetupCredentialRecord | null>;
    },

    async findUserById(userId: unknown, session?: ClientSession | null) {
      return User.findById(userId)
        .session(session ?? null)
        .exec() as Promise<SetupUserRecord | null>;
    },

    async updateUser(user: SetupUserRecord, update: { passwordHash: string; status: string }, session?: ClientSession | null) {
      const document = user as mongoose.Document & SetupUserRecord;
      document.passwordHash = update.passwordHash;
      document.status = update.status;
      await document.save({ session: session ?? undefined });
    },

    async consumeCredential(credential: SetupCredentialRecord, consumedAt: Date, session?: ClientSession | null) {
      const document = credential as mongoose.Document & SetupCredentialRecord;
      document.consumedAt = consumedAt;
      await document.save({ session: session ?? undefined });
    },

    async createAuditLog(auditLogInput: SetupAuditLogInput, session?: ClientSession | null) {
      if (failAuditLogCreation) {
        throw new Error('Deliberate integration-test AuditLog failure.');
      }

      await new AuditLog({
        action: auditLogInput.action,
        actorId: auditLogInput.actorId,
        entityType: auditLogInput.entityType,
        entityId: auditLogInput.entityId,
        societyId: auditLogInput.societyId,
        previousState: auditLogInput.previousState,
        newState: auditLogInput.newState,
      }).save({ session: session ?? undefined });
    },
  };
}

async function seedPendingSetup() {
  const userId = new mongoose.Types.ObjectId();
  const societyId = new mongoose.Types.ObjectId();
  const { rawCredential, credentialHash, expiresAt } = generateSetupCredential();

  await User.create({
    _id: userId,
    societyId,
    name: 'Integration Setup User',
    email: `${userId.toString()}@example.test`,
    role: 'OWNER_MEMBER',
    status: 'PENDING_SETUP',
  });
  await AccountSetupCredential.create({
    userId,
    credentialHash,
    expiresAt,
  });

  return { userId, rawCredential, credentialHash };
}

async function loadUser(userId: mongoose.Types.ObjectId) {
  return User.findById(userId).select('+passwordHash').exec();
}

describe('Account Setup MongoDB integration', () => {
  beforeAll(async () => {
    await connectIntegrationTestDatabase();
  });

  afterEach(async () => {
    await clearIntegrationTestDatabase();
  });

  afterAll(async () => {
    await disconnectIntegrationTestDatabase();
  });

  it('completes setup and persists an integrity-verifiable activation audit log', async () => {
    const { userId, rawCredential, credentialHash } = await seedPendingSetup();

    await new AccountSetupService(createMongoRepository()).setup(rawCredential, validNewPassword);

    const user = await loadUser(userId);
    const credential = await AccountSetupCredential.findOne({ credentialHash }).exec();
    const auditLog = await AuditLog.findOne({ entityId: userId }).exec();

    expect(user?.status).toBe('ACTIVE');
    expect(user?.passwordHash).toEqual(expect.any(String));
    expect(await verifyPassword(validNewPassword, user!.passwordHash!)).toBe(true);
    expect(credential?.consumedAt).toEqual(expect.any(Date));
    expect(auditLog).not.toBeNull();
    expect(auditLog).toMatchObject({
      action: 'USER_STATUS_CHANGED',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      previousState: { status: 'PENDING_SETUP' },
      newState: { status: 'ACTIVE' },
    });
    expect(hashAuditLog(auditLog!)).toBe(auditLog!.recordHash);
  });

  it('rejects an expired credential without changing the user or credential', async () => {
    const seeded = await seedPendingSetup();
    await AccountSetupCredential.updateOne(
      { credentialHash: seeded.credentialHash },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    ).exec();

    await expect(new AccountSetupService(createMongoRepository()).setup(seeded.rawCredential, validNewPassword))
      .rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' } satisfies Partial<ApiError>);

    const user = await loadUser(seeded.userId);
    const credential = await AccountSetupCredential.findOne({ credentialHash: seeded.credentialHash }).exec();
    expect(user?.status).toBe('PENDING_SETUP');
    expect(user?.passwordHash).toBeUndefined();
    expect(credential?.consumedAt ?? null).toBeNull();
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('rejects credential replay without creating a second activation audit', async () => {
    const seeded = await seedPendingSetup();
    const service = new AccountSetupService(createMongoRepository());

    await service.setup(seeded.rawCredential, validNewPassword);
    await expect(service.setup(seeded.rawCredential, 'anotherPassword123'))
      .rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' } satisfies Partial<ApiError>);

    const user = await loadUser(seeded.userId);
    const credential = await AccountSetupCredential.findOne({ credentialHash: seeded.credentialHash }).exec();
    expect(user?.status).toBe('ACTIVE');
    expect(await verifyPassword(validNewPassword, user!.passwordHash!)).toBe(true);
    expect(credential?.consumedAt).toEqual(expect.any(Date));
    expect(await AuditLog.countDocuments({ entityId: seeded.userId, action: 'USER_STATUS_CHANGED' })).toBe(1);
  });

  it('rolls back user and credential changes when AuditLog creation fails', async () => {
    const seeded = await seedPendingSetup();

    await expect(new AccountSetupService(createMongoRepository(true)).setup(seeded.rawCredential, validNewPassword))
      .rejects.toThrow('Deliberate integration-test AuditLog failure.');

    const user = await loadUser(seeded.userId);
    const credential = await AccountSetupCredential.findOne({ credentialHash: seeded.credentialHash }).exec();
    expect(user?.status).toBe('PENDING_SETUP');
    expect(user?.passwordHash).toBeUndefined();
    expect(credential?.consumedAt ?? null).toBeNull();
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('allows only one concurrent setup operation to activate the account', async () => {
    const seeded = await seedPendingSetup();
    const firstService = new AccountSetupService(createMongoRepository());
    const secondService = new AccountSetupService(createMongoRepository());

    const results = await Promise.allSettled([
      firstService.setup(seeded.rawCredential, validNewPassword),
      secondService.setup(seeded.rawCredential, validNewPassword),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejectedResult = results.find((result) => result.status === 'rejected');
    expect(rejectedResult).toMatchObject({
      status: 'rejected',
      reason: { status: 401, code: 'UNAUTHORIZED' },
    });

    const user = await loadUser(seeded.userId);
    const credential = await AccountSetupCredential.findOne({ credentialHash: seeded.credentialHash }).exec();
    expect(user?.status).toBe('ACTIVE');
    expect(await verifyPassword(validNewPassword, user!.passwordHash!)).toBe(true);
    expect(credential?.consumedAt).toEqual(expect.any(Date));
    expect(await AuditLog.countDocuments({ entityId: seeded.userId, action: 'USER_STATUS_CHANGED' })).toBe(1);
  });
});