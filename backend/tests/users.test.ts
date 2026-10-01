import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import { createUsersRouter, type UserProfileRecord, type UserReadRepository } from '../src/modules/users/user-routes.js';

const jwtSecret = 'user-read-tests-use-a-secret-with-at-least-32-bytes';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 300 };
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const committeeId = '68a123456789012345678903';
const ownerId = '68a123456789012345678904';
const residentId = '68a123456789012345678905';
const targetId = '68a123456789012345678906';
const otherTargetId = '68a123456789012345678907';
const societyAId = '68a123456789012345678908';
const societyBId = '68a123456789012345678909';
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

function currentUser(userId: string, societyId: string | null, role: string): CurrentUserRecord {
  return {
    _id: new Types.ObjectId(userId),
    societyId: societyId === null ? null : new Types.ObjectId(societyId),
    role,
  };
}

function profile(userId: string, societyId: string | null, name = 'Nivaas User'): UserProfileRecord {
  return {
    _id: new Types.ObjectId(userId),
    societyId: societyId === null ? null : new Types.ObjectId(societyId),
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
    phone: '+91-555-0100',
    role: 'RESIDENT',
    walletAddress: '0x1234567890abcdef',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    passwordHash: 'sensitive-password-hash',
    password: 'sensitive-password',
    setupToken: 'sensitive-setup-token',
    token: 'sensitive-jwt',
    secret: 'sensitive-secret',
    internalAuthMaterial: 'sensitive-internal-value',
    internalField: 'must-not-leak',
  };
}

function createUsersApp(
  records: CurrentUserRecord[],
  userProfiles: UserProfileRecord[],
): express.Express {
  const app = express();
  const identities = new Map(records.map((record) => [record._id.toString(), record]));
  const users = new Map(userProfiles.map((record) => [record._id.toString(), record]));
  const repository: UserReadRepository = {
    async findAll() { return [...users.values()]; },
    async findById(userId) { return users.get(userId) ?? null; },
  };
  const router = createUsersRouter(
    repository,
    createAuthenticationMiddleware(() => jwtSecret),
    createLoadCurrentUser({ async findById(userId) { return identities.get(userId) ?? null; } }),
  );
  app.use('/api/users', router);
  app.use(errorHandler);
  return app;
}

async function request(
  app: express.Express,
  path: string,
  userId?: string,
): Promise<Response> {
  const headers: HeadersInit = {};
  if (userId) headers.Authorization = `Bearer ${await issueAccessToken(userId, jwtConfiguration)}`;
  return fetch(`${await startServer(app)}${path}`, { headers });
}

describe('GET /api/users', () => {
  const roles = [
    ['SOCIETY_MANAGER', managerId],
    ['COMMITTEE_MEMBER', committeeId],
    ['OWNER_MEMBER', ownerId],
    ['RESIDENT', residentId],
  ] as const;

  it('allows SYSTEM_ADMIN to retrieve users across societies with only safe fields', async () => {
    const app = createUsersApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN')],
      [profile(targetId, societyAId), profile(otherTargetId, societyBId, 'Other Society User')],
    );
    const response = await request(app, '/api/users', adminId);
    const body = await response.json() as { success: boolean; data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((user) => user.societyId)).toEqual([societyAId, societyBId]);
    expectSafeUser(body.data[0]);
  });

  it.each(roles)('rejects %s from the generic user list', async (_role, userId) => {
    const app = createUsersApp([currentUser(userId, societyAId, _role)], [profile(targetId, societyAId)]);
    const response = await request(app, '/api/users', userId);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(createUsersApp([], [profile(targetId, societyAId)]), '/api/users');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/users/:id', () => {
  it('allows SYSTEM_ADMIN to retrieve a user in another society', async () => {
    const app = createUsersApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN')],
      [profile(targetId, societyBId)],
    );
    const response = await request(app, `/api/users/${targetId}`, adminId);
    expect(response.status).toBe(200);
    expectSafeUser((await response.json()).data);
  });

  it.each([
    ['SOCIETY_MANAGER', managerId],
    ['COMMITTEE_MEMBER', committeeId],
  ] as const)('allows %s to retrieve a permitted same-society profile', async (role, userId) => {
    const app = createUsersApp(
      [currentUser(userId, societyAId, role)],
      [profile(targetId, societyAId)],
    );
    const response = await request(app, `/api/users/${targetId}`, userId);
    expect(response.status).toBe(200);
    expectSafeUser((await response.json()).data);
  });

  it.each([
    ['SOCIETY_MANAGER', managerId],
    ['COMMITTEE_MEMBER', committeeId],
  ] as const)('rejects %s from retrieving another society profile', async (role, userId) => {
    const app = createUsersApp(
      [currentUser(userId, societyAId, role)],
      [profile(targetId, societyBId)],
    );
    const response = await request(app, `/api/users/${targetId}`, userId);
    expect(response.status).toBe(403);
  });

  it.each([
    ['OWNER_MEMBER', ownerId],
    ['RESIDENT', residentId],
  ] as const)('allows %s to retrieve their own profile', async (role, userId) => {
    const app = createUsersApp(
      [currentUser(userId, societyAId, role)],
      [profile(userId, societyAId)],
    );
    const response = await request(app, `/api/users/${userId}`, userId);
    expect(response.status).toBe(200);
    expectSafeUser((await response.json()).data);
  });

  it.each([
    ['OWNER_MEMBER', ownerId],
    ['RESIDENT', residentId],
  ] as const)('rejects %s from retrieving another user profile', async (role, userId) => {
    const app = createUsersApp(
      [currentUser(userId, societyAId, role)],
      [profile(userId, societyAId), profile(targetId, societyAId)],
    );
    const response = await request(app, `/api/users/${targetId}`, userId);
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(createUsersApp([], [profile(targetId, societyAId)]), `/api/users/${targetId}`);
    expect(response.status).toBe(401);
  });

  it('returns the documented not-found error for a nonexistent user', async () => {
    const app = createUsersApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], []);
    const response = await request(app, `/api/users/${targetId}`, adminId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'The requested API resource was not found.' },
    });
  });
});

function expectSafeUser(user: Record<string, unknown>): void {
  expect(Object.keys(user).sort()).toEqual([
    '_id', 'createdAt', 'email', 'name', 'phone', 'role', 'societyId', 'status', 'updatedAt', 'walletAddress',
  ]);
  expect(user).toMatchObject({
    _id: expect.any(String),
    societyId: expect.any(String),
    name: expect.any(String),
    email: expect.any(String),
    phone: expect.any(String),
    role: expect.any(String),
    walletAddress: expect.any(String),
    status: expect.any(String),
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  for (const field of [
    'passwordHash', 'password', 'setupToken', 'token', 'secret', 'internalAuthMaterial', 'internalField',
  ]) {
    expect(user).not.toHaveProperty(field);
  }
}
