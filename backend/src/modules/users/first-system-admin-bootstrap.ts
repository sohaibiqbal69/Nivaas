import mongoose, { type ClientSession } from 'mongoose';
import { backendConfig } from '../../config/environment.js';
import { generateSetupCredential } from '../auth/credential.js';
import { LocalBootstrapClaim } from './models/LocalBootstrapClaim.js';
import { User } from './models/User.js';
import { persistPendingUserWithCredential } from './pending-user-provisioning.js';
import { validateCreateUserRequest, type UserWriteData } from './user-routes.js';
import { matchesBootstrapSecret } from './bootstrap-secret.js';

export type FirstSystemAdminInput = { name: string; email: string };
export type FirstSystemAdminResult = { userId: string; email: string; setupCredential: string; expiresAt: Date };
export type ProductionBootstrapConfiguration = { enabled: boolean; secret?: string; nodeEnvironment?: string };
export type FirstSystemAdminBootstrapRepository = {
  withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>): Promise<T>;
  hasClaim(session?: ClientSession | null): Promise<boolean>;
  hasSystemAdmin(session?: ClientSession | null): Promise<boolean>;
  createPending(input: UserWriteData, credential: { credentialHash: string; expiresAt: Date }, session?: ClientSession | null): Promise<string>;
  createClaim(userId: string, session?: ClientSession | null): Promise<void>;
};

const repository: FirstSystemAdminBootstrapRepository = {
  async withTransaction<T>(operation: (session: ClientSession | null) => Promise<T>) {
    const session = await mongoose.startSession();
    try { return await session.withTransaction(() => operation(session)) as T; }
    finally { await session.endSession(); }
  },
  async hasClaim(session) {
    return Boolean(await LocalBootstrapClaim.exists({ _id: 'first-system-admin' }).session(session ?? null));
  },
  async hasSystemAdmin(session) {
    return Boolean(await User.exists({ role: 'SYSTEM_ADMIN' }).session(session ?? null));
  },
  async createPending(input, credential, session) {
    if (!session) throw new Error('The first System Admin bootstrap requires a MongoDB transaction.');
    const created = await persistPendingUserWithCredential(input, credential, session);
    return created.userId;
  },
  async createClaim(userId, session) {
    await LocalBootstrapClaim.create([{
      _id: 'first-system-admin',
      claimedAt: new Date(),
      administratorId: userId,
    }], { session: session ?? undefined });
  },
};

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000);
}

export function assertProductionBootstrapAllowed(configuration: ProductionBootstrapConfiguration, suppliedSecret: string): void {
  if (configuration.nodeEnvironment?.toLowerCase() !== 'production') {
    throw new Error('Initial System Admin bootstrap is available only in production CLI mode.');
  }
  if (!configuration.enabled || !matchesBootstrapSecret(configuration.secret, suppliedSecret)) {
    throw new Error('Production administrator bootstrap is disabled or its one-time authorization secret is invalid.');
  }
}

export async function createFirstSystemAdmin(
  input: FirstSystemAdminInput,
  target: FirstSystemAdminBootstrapRepository = repository,
): Promise<FirstSystemAdminResult> {
  const account = validateCreateUserRequest({ ...input, role: 'SYSTEM_ADMIN' });
  const credential = generateSetupCredential();
  return target.withTransaction(async (session) => {
    if (await target.hasClaim(session)) throw new Error('The one-time first System Admin bootstrap has already been claimed.');
    if (await target.hasSystemAdmin(session)) throw new Error('A SYSTEM_ADMIN already exists; bootstrap is not permitted.');
    const userId = await target.createPending(account, {
      credentialHash: credential.credentialHash,
      expiresAt: credential.expiresAt,
    }, session);
    try {
      await target.createClaim(userId, session);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new Error('The first System Admin bootstrap has already completed or is running.');
      }
      throw error;
    }
    return { userId, email: account.email, setupCredential: credential.rawCredential, expiresAt: credential.expiresAt };
  });
}

export async function bootstrapProductionFirstSystemAdmin(
  input: FirstSystemAdminInput,
  suppliedSecret: string,
  target: FirstSystemAdminBootstrapRepository = repository,
  configuration: ProductionBootstrapConfiguration = {
    enabled: backendConfig.initialAdminBootstrapEnabled,
    secret: backendConfig.initialAdminBootstrapSecret,
    nodeEnvironment: process.env.NODE_ENV,
  },
): Promise<FirstSystemAdminResult> {
  assertProductionBootstrapAllowed(configuration, suppliedSecret);
  return createFirstSystemAdmin(input, target);
}
