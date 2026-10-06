import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAuthRouter } from '../src/modules/auth/auth-routes.js';
import {
  AccountSetupService,
  type AccountSetupRepository,
  type SetupAuditLogInput,
  type SetupCredentialRecord,
  type SetupUserRecord,
} from '../src/modules/auth/account-setup-service.js';
import { generateSetupCredential, hashCredential } from '../src/modules/auth/credential.js';
import { verifyPassword } from '../src/modules/auth/password.js';

const userId = '68a123456789012345678901';
const societyId = '68a123456789012345678902';
const validNewPassword = 'newSecurePassword123';
const servers: Server[] = [];

async function startServer(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function createMockRepository(overrides: {
  credential?: SetupCredentialRecord | null;
  user?: SetupUserRecord | null;
} = {}): {
  repository: AccountSetupRepository;
  state: {
    user: SetupUserRecord | null;
    credential: SetupCredentialRecord | null;
    auditLogs: SetupAuditLogInput[];
  };
} {
  const { rawCredential, credentialHash, expiresAt } = generateSetupCredential();

  const state = {
    user: overrides.user !== undefined ? overrides.user : {
      _id: userId,
      societyId,
      status: 'PENDING_SETUP',
      passwordHash: undefined,
    },
    credential: overrides.credential !== undefined ? overrides.credential : {
      _id: 'credential-id-1',
      userId,
      credentialHash,
      createdAt: new Date(),
      expiresAt,
      consumedAt: null,
    },
    auditLogs: [] as SetupAuditLogInput[],
    rawCredential,
  };

  const repository: AccountSetupRepository = {
    async withTransaction<T>(operation: (session: null) => Promise<T>): Promise<T> {
      return operation(null);
    },
    async findCredentialByHash(hash: string): Promise<SetupCredentialRecord | null> {
      if (state.credential && state.credential.credentialHash === hash) {
        return state.credential;
      }
      return null;
    },
    async findUserById(id: unknown): Promise<SetupUserRecord | null> {
      if (state.user && state.user._id === id) {
        return state.user;
      }
      return null;
    },
    async updateUser(user: SetupUserRecord, update: { passwordHash: string; status: string }): Promise<void> {
      user.passwordHash = update.passwordHash;
      user.status = update.status;
    },
    async consumeCredential(credential: SetupCredentialRecord, consumedAt: Date): Promise<void> {
      credential.consumedAt = consumedAt;
    },
    async createAuditLog(auditLogInput: SetupAuditLogInput): Promise<void> {
      state.auditLogs.push(auditLogInput);
    },
  };

  return { repository, state };
}

function createSetupApp(setupService: AccountSetupService): express.Express {
  const app = express();
  app.use(express.json(), createAuthRouter(undefined, setupService), errorHandler);
  return app;
}

describe('account setup unit tests', () => {
  it('completes setup successfully, transitioning status to ACTIVE and creating an audit record', async () => {
    const { repository, state } = createMockRepository();
    const service = new AccountSetupService(repository);
    const baseUrl = await startServer(createSetupApp(service));

    const response = await fetch(`${baseUrl}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: state.rawCredential,
        newPassword: validNewPassword,
      }),
    });

    const payload = await response.json() as { success: boolean; data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({});

    // Verify user transition
    expect(state.user?.status).toBe('ACTIVE');
    expect(typeof state.user?.passwordHash).toBe('string');
    expect(await verifyPassword(validNewPassword, state.user!.passwordHash!)).toBe(true);

    // Verify credential consumption
    expect(state.credential?.consumedAt).toBeInstanceOf(Date);

    // Verify audit log creation
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toEqual({
      action: 'USER_STATUS_CHANGED',
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      societyId,
      previousState: { status: 'PENDING_SETUP' },
      newState: { status: 'ACTIVE' },
    });
  });

  it('does not return any secrets, credentials, or internal fields in success response', async () => {
    const { repository, state } = createMockRepository();
    const service = new AccountSetupService(repository);
    const baseUrl = await startServer(createSetupApp(service));

    const response = await fetch(`${baseUrl}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: state.rawCredential,
        newPassword: validNewPassword,
      }),
    });

    const payload = await response.json() as Record<string, unknown>;
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('credential');
    expect(payload).not.toHaveProperty('credentialHash');
    expect(payload).not.toHaveProperty('passwordHash');
    expect(payload).not.toHaveProperty('user');
    expect(payload).toEqual({ success: true, data: {} });
  });

  describe('validation errors (HTTP 400)', () => {
    it.each([
      ['empty object', {}],
      ['missing password', { credential: 'some-credential' }],
      ['empty credential', { credential: '', newPassword: validNewPassword }],
      ['whitespace credential', { credential: '   ', newPassword: validNewPassword }],
      ['non-string credential', { credential: 12345, newPassword: validNewPassword }],
      ['password too short (7 characters)', { credential: 'valid-cred', newPassword: '1234567' }],
      ['empty password', { credential: 'valid-cred', newPassword: '' }],
      ['client-supplied passwordHash', { credential: 'valid-cred', newPassword: validNewPassword, passwordHash: 'pre-hashed' }],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_name, body) => {
      const { repository } = createMockRepository();
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(400);
      expect(payload.success).toBe(false);
      expect(payload.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a primitive JSON request body with 400 INVALID_JSON', async () => {
      const { repository } = createMockRepository();
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify('just-a-string'),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(400);
      expect(payload.success).toBe(false);
      expect(payload.error.code).toBe('INVALID_JSON');
    });
  });

  describe('unauthorized rejections with identical 401 error', () => {
    const expectedError = {
      code: 'UNAUTHORIZED',
      message: 'The setup credential is invalid or has expired.',
    };

    it('rejects an unknown / invalid credential with generic 401', async () => {
      const { repository } = createMockRepository();
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: 'completely-unknown-credential',
          newPassword: validNewPassword,
        }),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(401);
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(expectedError);
    });

    it('rejects an expired credential with generic 401', async () => {
      const rawCredential = 'my-expired-raw-credential';
      const { repository } = createMockRepository({
        credential: {
          _id: 'cred-expired',
          userId,
          credentialHash: hashCredential(rawCredential),
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
          consumedAt: null,
        },
      });
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: rawCredential,
          newPassword: validNewPassword,
        }),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(401);
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(expectedError);
    });

    it('rejects an already consumed credential with generic 401', async () => {
      const rawCredential = 'my-consumed-raw-credential';
      const { repository } = createMockRepository({
        credential: {
          _id: 'cred-consumed',
          userId,
          credentialHash: hashCredential(rawCredential),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumedAt: new Date(), // Already consumed
        },
      });
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: rawCredential,
          newPassword: validNewPassword,
        }),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(401);
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(expectedError);
    });

    it.each(['ACTIVE', 'DISABLED'])('rejects an account with status %s with generic 401', async (status) => {
      const rawCredential = `my-cred-for-${status}`;
      const { repository } = createMockRepository({
        credential: {
          _id: `cred-${status}`,
          userId,
          credentialHash: hashCredential(rawCredential),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        },
        user: {
          _id: userId,
          societyId,
          status,
        },
      });
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: rawCredential,
          newPassword: validNewPassword,
        }),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(401);
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(expectedError);
    });

    it('rejects when the associated user does not exist with generic 401', async () => {
      const rawCredential = 'my-cred-for-missing-user';
      const { repository } = createMockRepository({
        credential: {
          _id: 'cred-missing-user',
          userId: 'nonexistent-user-id',
          credentialHash: hashCredential(rawCredential),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        },
        user: null,
      });
      const service = new AccountSetupService(repository);
      const baseUrl = await startServer(createSetupApp(service));

      const response = await fetch(`${baseUrl}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: rawCredential,
          newPassword: validNewPassword,
        }),
      });

      const payload = await response.json() as { success: boolean; error: { code: string; message: string } };
      expect(response.status).toBe(401);
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(expectedError);
    });
  });

  it('supports platform administrator with null societyId for audit logging', async () => {
    const { repository, state } = createMockRepository({
      user: {
        _id: userId,
        societyId: null,
        status: 'PENDING_SETUP',
      },
    });
    const service = new AccountSetupService(repository);

    await service.setup(state.rawCredential, validNewPassword);

    expect(state.user?.status).toBe('ACTIVE');
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0].societyId).toBeNull();
  });
});
