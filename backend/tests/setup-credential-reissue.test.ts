import { describe, expect, it } from 'vitest';
import { hashCredential } from '../src/modules/auth/credential.js';
import {
  SetupCredentialReissueService,
  type PendingSetupUser,
  type SetupCredentialReissueAudit,
  type SetupCredentialReissueRepository,
} from '../src/modules/auth/setup-credential-reissue-service.js';

const targetId = '68a123456789012345678901';
const adminId = '68a123456789012345678902';
const societyId = '68a123456789012345678903';
const now = new Date('2026-10-18T12:00:00.000Z');

function setupRepository(status = 'PENDING_SETUP', exists = true, allowLock = true) {
  const user: PendingSetupUser = {
    _id: { toString: () => targetId },
    societyId: { toString: () => societyId },
    name: 'Demo Manager', email: 'manager@example.test', role: 'SOCIETY_MANAGER', status,
    createdAt: now, updatedAt: now,
  };
  const credentials: { credentialHash: string; createdAt: Date; expiresAt: Date; revokedAt?: Date }[] = [
    { credentialHash: 'old-hash', createdAt: now, expiresAt: new Date(now.getTime() + 60_000) },
  ];
  const audits: SetupCredentialReissueAudit[] = [];
  let locked = false;
  const repository: SetupCredentialReissueRepository = {
    async withTransaction<T>(operation: (session: null) => Promise<T>) { return operation(null); },
    async findUser() { return exists ? user : null; },
    async lockPendingUser() { locked = allowLock && user.status === 'PENDING_SETUP'; return locked; },
    async revokeOutstanding(_userId, revokedAt) {
      let count = 0;
      for (const credential of credentials) {
        if (!credential.revokedAt) { credential.revokedAt = revokedAt; count += 1; }
      }
      return count;
    },
    async createCredential(_userId, credential, createdAt) {
      credentials.push({ credentialHash: credential.credentialHash, expiresAt: credential.expiresAt, createdAt });
    },
    async createAuditLog(input) { audits.push(input); },
  };
  return { repository, credentials, audits, isLocked: () => locked };
}

describe('SetupCredentialReissueService', () => {
  it('revokes outstanding credentials, stores only the replacement hash, and writes a secret-free audit event', async () => {
    const state = setupRepository();
    const result = await new SetupCredentialReissueService(state.repository).reissue(targetId, adminId, now);
    expect(state.isLocked()).toBe(true);
    expect(state.credentials[0]?.revokedAt).toEqual(now);
    expect(state.credentials).toHaveLength(2);
    expect(state.credentials[1]?.credentialHash).toBe(hashCredential(result.credential.rawCredential));
    expect(state.credentials[1]?.credentialHash).not.toBe(result.credential.rawCredential);
    expect(result.credential.expiresAt).toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    expect(state.audits).toEqual([{
      actorId: adminId, userId: targetId, societyId, revokedCredentialCount: 1,
    }]);
    expect(JSON.stringify(state.credentials)).not.toContain(result.credential.rawCredential);
    expect(JSON.stringify(state.audits)).not.toContain(result.credential.rawCredential);
  });

  it.each([
    ['missing', 'PENDING_SETUP', false, true, 404],
    ['active', 'ACTIVE', true, true, 409],
    ['disabled', 'DISABLED', true, true, 409],
    ['changed before lock', 'PENDING_SETUP', true, false, 409],
  ])('rejects a %s target without creating a credential', async (_label, status, exists, allowLock, expectedStatus) => {
    const state = setupRepository(status, exists, allowLock);
    await expect(new SetupCredentialReissueService(state.repository).reissue(targetId, adminId, now))
      .rejects.toMatchObject({ status: expectedStatus });
    expect(state.credentials).toHaveLength(1);
    expect(state.audits).toHaveLength(0);
  });
});
