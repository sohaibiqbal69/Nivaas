import mongoose, { type ClientSession } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { User } from '../users/models/User.js';
import { AccountSetupCredential } from './models/AccountSetupCredential.js';
import { hashCredential } from './credential.js';
import { hashPassword } from './password.js';

export type SetupCredentialRecord = {
  _id: unknown;
  userId: unknown;
  credentialHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date | null;
  revokedAt?: Date | null;
};

export type SetupUserRecord = {
  _id: unknown;
  societyId: unknown | null;
  status: string;
  passwordHash?: string;
};

export type SetupAuditLogInput = {
  action: string;
  actorId: unknown;
  entityType: string;
  entityId: unknown;
  societyId: unknown | null;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
};

export type AccountSetupRepository = {
  withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>): Promise<T>;
  findCredentialByHash(credentialHash: string, session?: ClientSession | null): Promise<SetupCredentialRecord | null>;
  findUserById(userId: unknown, session?: ClientSession | null): Promise<SetupUserRecord | null>;
  updateUser(user: SetupUserRecord, update: { passwordHash: string; status: string }, session?: ClientSession | null): Promise<void>;
  consumeCredential(credential: SetupCredentialRecord, consumedAt: Date, session?: ClientSession | null): Promise<void>;
  createAuditLog(auditLogInput: SetupAuditLogInput, session?: ClientSession | null): Promise<void>;
};

function isTransactionConflictError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { code?: number; errorLabels?: string[]; name?: string; message?: string };
    if (err.code === 112 || err.name === 'WriteConflict') return true;
    if (Array.isArray(err.errorLabels) && err.errorLabels.includes('TransientTransactionError')) return true;
    if (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('transaction'))) {
      return true;
    }
  }
  return false;
}

const defaultAccountSetupRepository: AccountSetupRepository = {
  async withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => operation(session));
    } finally {
      await session.endSession();
    }
  },

  async findCredentialByHash(credentialHash: string, session?: ClientSession | null) {
    return AccountSetupCredential.findOne({ credentialHash }, null, session ? { session } : undefined);
  },

  async findUserById(userId: unknown, session?: ClientSession | null) {
    return User.findById(userId, null, session ? { session } : undefined);
  },

  async updateUser(user: SetupUserRecord, update: { passwordHash: string; status: string }, session?: ClientSession | null) {
    const doc = user as mongoose.Document & SetupUserRecord;
    doc.passwordHash = update.passwordHash;
    doc.status = update.status;
    await doc.save(session ? { session } : undefined);
  },

  async consumeCredential(credential: SetupCredentialRecord, consumedAt: Date, session?: ClientSession | null) {
    const doc = credential as mongoose.Document & SetupCredentialRecord;
    doc.consumedAt = consumedAt;
    await doc.save(session ? { session } : undefined);
  },

  async createAuditLog(auditLogInput: SetupAuditLogInput, session?: ClientSession | null) {
    const auditLog = new AuditLog({
      action: auditLogInput.action,
      actorId: auditLogInput.actorId,
      entityType: auditLogInput.entityType,
      entityId: auditLogInput.entityId,
      societyId: auditLogInput.societyId,
      previousState: auditLogInput.previousState,
      newState: auditLogInput.newState,
    });
    await auditLog.save(session ? { session } : undefined);
  },
};

export class AccountSetupService {
  constructor(
    private readonly repository: AccountSetupRepository = defaultAccountSetupRepository,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
  ) {}

  async setup(credential: string, newPassword: string): Promise<void> {
    const credentialHash = hashCredential(credential);

    try {
      await this.repository.withTransaction(async (session) => {
        const now = new Date();

        // 1. Find and validate the setup credential
        const credentialRecord = await this.repository.findCredentialByHash(credentialHash, session);
        if (!credentialRecord || credentialRecord.consumedAt || credentialRecord.revokedAt || credentialRecord.expiresAt <= now) {
          throw new ApiError(401, 'UNAUTHORIZED', 'The setup credential is invalid or has expired.');
        }

        // 2. Find and validate the associated user
        const user = await this.repository.findUserById(credentialRecord.userId, session);
        if (!user || user.status !== 'PENDING_SETUP') {
          throw new ApiError(401, 'UNAUTHORIZED', 'The setup credential is invalid or has expired.');
        }

        // 3. Hash the new password
        const passwordHash = await this.passwordHasher(newPassword);

        // 4 & 5. Set user.passwordHash and transition status from PENDING_SETUP to ACTIVE
        await this.repository.updateUser(user, { passwordHash, status: 'ACTIVE' }, session);

        // 6. Consume/invalidate the setup credential
        await this.repository.consumeCredential(credentialRecord, now, session);

        // 7. Create the mandatory AuditLog entry
        await this.repository.createAuditLog(
          {
            action: 'USER_STATUS_CHANGED',
            actorId: user._id,
            entityType: 'User',
            entityId: user._id,
            societyId: user.societyId ?? null,
            previousState: { status: 'PENDING_SETUP' },
            newState: { status: 'ACTIVE' },
          },
          session,
        );

        // 8. Commit happens atomically upon successful completion of withTransaction
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (isTransactionConflictError(error)) {
        throw new ApiError(401, 'UNAUTHORIZED', 'The setup credential is invalid or has expired.');
      }
      throw error;
    }
  }
}
