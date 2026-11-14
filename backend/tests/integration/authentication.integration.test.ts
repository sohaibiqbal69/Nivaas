import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuthRouter } from '../../src/modules/auth/auth-routes.js';
import { AuthenticationService, hashPassword, type AuthenticationResult } from '../../src/modules/auth/authentication-service.js';
import { AuthSession } from '../../src/modules/auth/models/AuthSession.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const password = 'auth-session-mongodb-integration-password';
const jwtConfiguration = {
  secret: 'auth-session-integration-secret-of-at-least-32-bytes',
  accessTokenTtlSeconds: 120,
};
const refreshLifetimeSeconds = 60 * 60;
let passwordHash: string;
let server: Server | undefined;
let baseUrl: string;

function createApp() {
  const app = express();
  const service = new AuthenticationService(
    undefined,
    () => jwtConfiguration,
    undefined,
    () => refreshLifetimeSeconds,
  );
  app.use(express.json());
  app.use('/auth', createAuthRouter(service));
  app.use(errorHandler);
  return app;
}

async function post<T>(path: string, body: unknown): Promise<{ response: Response; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() as T };
}

async function createActiveUser(role: 'SOCIETY_MANAGER' | 'RESIDENT' = 'SOCIETY_MANAGER') {
  return User.create({
    societyId: new Types.ObjectId(),
    name: `Refresh test ${role}`,
    email: `refresh-${randomUUID()}@example.test`,
    passwordHash,
    role,
    status: 'ACTIVE',
  });
}

async function login(email: string): Promise<AuthenticationResult> {
  const { response, payload } = await post<{ success: boolean; data: AuthenticationResult }>('/auth/login', { email, password });
  expect(response.status).toBe(200);
  expect(payload.success).toBe(true);
  return payload.data;
}

describe('MongoDB-backed refresh-session integration', () => {
  beforeAll(async () => {
    await connectIntegrationTestDatabase();
    await Promise.all([User.init(), AuthSession.init()]);
    passwordHash = await hashPassword(password);
    const testServer = createServer(createApp());
    server = testServer;
    await new Promise<void>((resolve, reject) => {
      testServer.once('error', reject);
      testServer.listen(0, '127.0.0.1', resolve);
    });
    const address = testServer.address();
    if (!address || typeof address === 'string') throw new Error('Authentication integration server did not bind.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => clearIntegrationTestDatabase());

  afterAll(async () => {
    const testServer = server;
    if (testServer?.listening) await new Promise<void>((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
    await disconnectIntegrationTestDatabase();
  });

  it('stores only the refresh-token hash and renews from the persisted session', async () => {
    const user = await createActiveUser();
    const result = await login(user.email);

    const stored = await AuthSession.collection.findOne({ sessionId: result.refreshSessionId });
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).toBe(createHash('sha256').update(result.refreshToken, 'utf8').digest('hex'));
    expect(stored?.tokenHash).not.toBe(result.refreshToken);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored).not.toHaveProperty('refreshToken');
    expect(stored?.userId.toString()).toBe(user._id.toString());
    expect(stored?.expiresAt).toBeInstanceOf(Date);

    // Refresh resolves through the default Mongoose AuthSession repository;
    // no in-memory session repository is injected.
    const { response, payload } = await post<{ success: boolean; data: AuthenticationResult }>('/auth/refresh', { refreshToken: result.refreshToken });
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.user._id).toBe(user._id.toString());
    expect(payload.data.user.role).toBe('SOCIETY_MANAGER');
    expect(payload.data.refreshSessionId).toBe(result.refreshSessionId);
    expect(payload.data.refreshToken).toBe(result.refreshToken);
  });

  it('revokes only the logged-out user session and leaves another user session renewable', async () => {
    const manager = await createActiveUser('SOCIETY_MANAGER');
    const resident = await createActiveUser('RESIDENT');
    const managerSession = await login(manager.email);
    const residentSession = await login(resident.email);
    expect(managerSession.user.societyId).toBe(manager.societyId.toString());
    expect(residentSession.user.societyId).toBe(resident.societyId.toString());

    const logout = await post<{ success: boolean }>('/auth/logout', { refreshToken: managerSession.refreshToken });
    expect(logout.response.status).toBe(200);
    expect((await AuthSession.collection.findOne({ sessionId: managerSession.refreshSessionId }))?.revokedAt).toBeInstanceOf(Date);
    expect((await AuthSession.collection.findOne({ sessionId: residentSession.refreshSessionId }))?.revokedAt).toBeUndefined();

    const rejected = await post<{ error: { code: string } }>('/auth/refresh', { refreshToken: managerSession.refreshToken });
    expect(rejected.response.status).toBe(401);
    const renewedResident = await post<{ data: AuthenticationResult }>('/auth/refresh', { refreshToken: residentSession.refreshToken });
    expect(renewedResident.response.status).toBe(200);
    expect(renewedResident.payload.data.user._id).toBe(resident._id.toString());
    expect(renewedResident.payload.data.user.role).toBe('RESIDENT');
    expect(renewedResident.payload.data.user.societyId).toBe(resident.societyId.toString());
  });

  it('rejects malformed, unknown and logically expired refresh credentials', async () => {
    const user = await createActiveUser();
    const active = await login(user.email);

    const malformed = await post<{ error: { code: string } }>('/auth/refresh', { refreshToken: 'malformed' });
    expect(malformed.response.status).toBe(400);
    expect(malformed.payload.error.code).toBe('VALIDATION_ERROR');

    const unknown = await post<{ error: { code: string } }>('/auth/refresh', { refreshToken: 'A'.repeat(43) });
    expect(unknown.response.status).toBe(401);
    expect(unknown.payload.error.code).toBe('UNAUTHORIZED');

    await AuthSession.collection.updateOne(
      { sessionId: active.refreshSessionId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    const expiredRecord = await AuthSession.collection.findOne({ sessionId: active.refreshSessionId });
    expect(expiredRecord?.expiresAt.getTime()).toBeLessThan(Date.now());
    const expired = await post<{ error: { code: string } }>('/auth/refresh', { refreshToken: active.refreshToken });
    expect(expired.response.status).toBe(401);
    expect(expired.payload.error.code).toBe('UNAUTHORIZED');
    // TTL cleanup is asynchronous; logical expiry is asserted independently of
    // when MongoDB's background TTL monitor physically removes this document.
  });

  it('rejects renewal and revokes the session after the persisted user becomes inactive', async () => {
    const user = await createActiveUser();
    const active = await login(user.email);
    await User.updateOne({ _id: user._id }, { $set: { status: 'DISABLED' } }).exec();

    const rejected = await post<{ error: { code: string } }>('/auth/refresh', { refreshToken: active.refreshToken });
    expect(rejected.response.status).toBe(401);
    expect(rejected.payload.error.code).toBe('UNAUTHORIZED');
    expect((await AuthSession.collection.findOne({ sessionId: active.refreshSessionId }))?.revokedAt).toBeInstanceOf(Date);
  });

  it('creates the schema-declared unique, lookup, revocation and TTL indexes', async () => {
    await AuthSession.init();
    const indexes = await AuthSession.collection.indexes();
    const byName = new Map(indexes.map((index) => [index.name, index]));

    expect(byName.get('sessionId_1')?.unique).toBe(true);
    expect(byName.get('tokenHash_1')?.unique).toBe(true);
    expect(byName.get('tokenHash_1')?.key).toEqual({ tokenHash: 1 });
    expect(byName.get('userId_1_revokedAt_1')?.key).toEqual({ userId: 1, revokedAt: 1 });
    expect(byName.get('expiresAt_1')?.key).toEqual({ expiresAt: 1 });
    expect(byName.get('expiresAt_1')?.expireAfterSeconds).toBe(0);
  });
});


