import mongoose, { type ClientSession } from 'mongoose';
import { AccountSetupCredential } from '../auth/models/AccountSetupCredential.js';
import { User } from './models/User.js';

export type PendingUserData = {
  societyId: string | null;
  name: string;
  email: string;
  phone?: string;
  walletAddress?: string;
  role: string;
  status: 'PENDING_SETUP';
};

export type RawSetupCredential = { rawCredential: string; credentialHash: string; expiresAt: Date };

/** Shared transactional account creation path used by user administration and local first-admin bootstrap. */
export async function persistPendingUserWithCredential(
  data: PendingUserData,
  credential: Pick<RawSetupCredential, 'credentialHash' | 'expiresAt'>,
  session: ClientSession,
): Promise<{ user: Record<string, any>; userId: string }> {
  const [user] = await User.create([data], { session });
  await AccountSetupCredential.create([{ userId: user._id, credentialHash: credential.credentialHash, expiresAt: credential.expiresAt }], { session });
  return { user: user.toObject() as Record<string, any>, userId: user._id.toString() };
}

/** Convenience wrapper for the existing admin API, preserving its transaction boundary. */
export async function createPendingUserWithCredential(
  data: PendingUserData,
  credential: Pick<RawSetupCredential, 'credentialHash' | 'expiresAt'>,
): Promise<Record<string, any>> {
  const session = await mongoose.startSession();
  try {
    let user: Record<string, any> | null = null;
    await session.withTransaction(async () => {
      user = (await persistPendingUserWithCredential(data, credential, session)).user;
    });
    if (!user) throw new Error('User creation did not return a persisted record.');
    return user;
  } finally {
    await session.endSession();
  }
}
