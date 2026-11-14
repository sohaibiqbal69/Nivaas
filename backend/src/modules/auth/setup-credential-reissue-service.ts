import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { User } from '../users/models/User.js';
import { AccountSetupCredential } from './models/AccountSetupCredential.js';
import { generateSetupCredential } from './credential.js';

export type PendingSetupUser = {
  _id: { toString(): string };
  societyId: { toString(): string } | null;
  name: string;
  email: string;
  phone?: string;
  role: string;
  walletAddress?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ReissuedSetupCredential = {
  user: PendingSetupUser;
  credential: { rawCredential: string; expiresAt: Date };
};

export type SetupCredentialReissueAudit = {
  actorId: string;
  userId: string;
  societyId: string | null;
  revokedCredentialCount: number;
};

export type SetupCredentialReissueRepository = {
  withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>): Promise<T>;
  findUser(userId: string, session?: ClientSession | null): Promise<PendingSetupUser | null>;
  lockPendingUser(userId: string, session?: ClientSession | null): Promise<boolean>;
  revokeOutstanding(userId: string, revokedAt: Date, session?: ClientSession | null): Promise<number>;
  createCredential(userId: string, credential: { credentialHash: string; expiresAt: Date }, createdAt: Date, session?: ClientSession | null): Promise<void>;
  createAuditLog(input: SetupCredentialReissueAudit, session?: ClientSession | null): Promise<void>;
};

const defaultRepository: SetupCredentialReissueRepository = {
  async withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(() => operation(session)) as T;
    } finally {
      await session.endSession();
    }
  },
  async findUser(userId, session) {
    return User.findById(userId).session(session ?? null).lean().exec() as unknown as Promise<PendingSetupUser | null>;
  },
  async lockPendingUser(userId, session) {
    const result = await User.updateOne(
      { _id: new Types.ObjectId(userId), status: 'PENDING_SETUP' },
      { $currentDate: { updatedAt: true } },
      { session: session ?? undefined, timestamps: false },
    ).exec();
    return result.matchedCount === 1;
  },
  async revokeOutstanding(userId, revokedAt, session) {
    const result = await AccountSetupCredential.updateMany(
      { userId: new Types.ObjectId(userId), consumedAt: null, revokedAt: null },
      { $set: { revokedAt } },
      { session: session ?? undefined },
    ).exec();
    return result.modifiedCount;
  },
  async createCredential(userId, credential, createdAt, session) {
    await AccountSetupCredential.create([{
      userId: new Types.ObjectId(userId),
      credentialHash: credential.credentialHash,
      createdAt,
      expiresAt: credential.expiresAt,
    }], { session: session ?? undefined });
  },
  async createAuditLog(input, session) {
    await new AuditLog({
      action: 'USER_SETUP_CREDENTIAL_REISSUED',
      actorId: new Types.ObjectId(input.actorId),
      entityType: 'User',
      entityId: new Types.ObjectId(input.userId),
      societyId: input.societyId ? new Types.ObjectId(input.societyId) : null,
      previousState: { status: 'PENDING_SETUP' },
      newState: { status: 'PENDING_SETUP' },
      metadata: { revokedCredentialCount: input.revokedCredentialCount },
    }).save(session ? { session } : undefined);
  },
};

export class SetupCredentialReissueService {
  constructor(private readonly repository: SetupCredentialReissueRepository = defaultRepository) {}

  async reissue(userId: string, actorId: string, now = new Date()): Promise<ReissuedSetupCredential> {
    return this.repository.withTransaction(async (session) => {
      const initialUser = await this.repository.findUser(userId, session);
      if (!initialUser) throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
      if (initialUser.status !== 'PENDING_SETUP') {
        throw new ApiError(409, 'CONFLICT', 'A setup credential can only be reissued for an account awaiting setup.');
      }
      if (!await this.repository.lockPendingUser(userId, session)) {
        throw new ApiError(409, 'CONFLICT', 'The account is no longer awaiting setup. Refresh the account list and try again.');
      }
      const user = await this.repository.findUser(userId, session);
      if (!user || user.status !== 'PENDING_SETUP') {
        throw new ApiError(409, 'CONFLICT', 'The account is no longer awaiting setup. Refresh the account list and try again.');
      }

      const credential = generateSetupCredential(now);
      const revokedCredentialCount = await this.repository.revokeOutstanding(userId, now, session);
      await this.repository.createCredential(userId, {
        credentialHash: credential.credentialHash,
        expiresAt: credential.expiresAt,
      }, now, session);
      await this.repository.createAuditLog({
        actorId,
        userId,
        societyId: user.societyId?.toString() ?? null,
        revokedCredentialCount,
      }, session);

      return {
        user,
        credential: { rawCredential: credential.rawCredential, expiresAt: credential.expiresAt },
      };
    });
  }
}
