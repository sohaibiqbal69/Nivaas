import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import { hashCredential } from '../src/modules/auth/credential.js';
import {
  createUsersRouter,
  type UserAdministrationRepository,
  type UserProfileRecord,
} from '../src/modules/users/user-routes.js';

const jwtSecret = 'user-administration-tests-use-a-secret-with-at-least-32-bytes';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 300 };
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const targetId = '68a123456789012345678903';
const societyAId = '68a123456789012345678904';
const societyBId = '68a123456789012345678905';
const servers: Server[] = [];

function currentUser(userId: string, societyId: string | null, role: string): CurrentUserRecord {
  return { _id: new Types.ObjectId(userId), societyId: societyId ? new Types.ObjectId(societyId) : null, role, status: 'ACTIVE' };
}

function user(id: string, societyId: string | null, role = 'RESIDENT', status = 'ACTIVE', passwordHash?: string): UserProfileRecord & { passwordHash?: string } {
  return {
    _id: new Types.ObjectId(id),
    societyId: societyId ? new Types.ObjectId(societyId) : null,
    name: 'Target User',
    email: `${id}@example.test`,
    phone: '+91-555-0100',
    role,
    walletAddress: '0x123',
    status,
    passwordHash,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    credentialHash: 'internal-credential-hash',
  };
}

function createApp(identities: CurrentUserRecord[], initialUsers: (UserProfileRecord & { passwordHash?: string })[]) {
  const users = new Map(initialUsers.map((record) => [record._id.toString(), record]));
  const audits: Record<string, unknown>[] = [];
  const credentials: { userId: string; credentialHash: string; expiresAt: Date }[] = [];
  const repository: UserAdministrationRepository = {
    async findAll() { return [...users.values()]; },
    async findById(id) { return users.get(id) ?? null; },
    async createWithCredential(data, credential) {
      const created = user(new Types.ObjectId().toString(), data.societyId, data.role, data.status);
      Object.assign(created, data);
      users.set(created._id.toString(), created);
      credentials.push({ userId: created._id.toString(), ...credential });
      return created;
    },
    async findByIdForAdministration(id) { return users.get(id) ?? null; },
    async updateProfile(id, data) {
      const target = users.get(id);
      if (!target) return null;
      Object.assign(target, data);
      return target;
    },
    async updateRole(id, role) {
      const target = users.get(id);
      if (!target) return null;
      target.role = role;
      return { ...target };
    },
    async updateStatus(id, status) {
      const target = users.get(id);
      if (!target) return null;
      target.status = status;
      return { ...target };
    },
    async countActiveSystemAdmins() {
      return [...users.values()].filter((record) => record.role === 'SYSTEM_ADMIN' && record.status === 'ACTIVE').length;
    },
    async createAuditLog(input) { audits.push(input); },
  };
  const identityMap = new Map(identities.map((record) => [record._id.toString(), record]));
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter(
    repository,
    createAuthenticationMiddleware(() => jwtSecret),
    createLoadCurrentUser({ async findById(id) { return identityMap.get(id) ?? null; } }),
  ));
  app.use(errorHandler);
  return { app, credentials, audits };
}

async function request(app: express.Express, path: string, userId: string | undefined, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (userId) headers.set('Authorization', `Bearer ${await issueAccessToken(userId, jwtConfiguration)}`);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('User administration', () => {
  it('creates a pending user with hashed setup credential and no secrets in response', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], []);
    const response = await request(state.app, '/api/users', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, name: 'New User', email: 'new@example.test', role: 'RESIDENT' }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ status: 'PENDING_SETUP', societyId: societyAId });
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.data).not.toHaveProperty('credentialHash');
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0].credentialHash).not.toBe(state.credentials[0].expiresAt.toISOString());
    expect(state.credentials[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(hashCredential('plaintext-credential')).not.toBe(state.credentials[0].credentialHash);
  });

  it('rejects creation by society-scoped administrators and invalid privilege input', async () => {
    const state = createApp([currentUser(managerId, societyAId, 'SOCIETY_MANAGER')], []);
    const denied = await request(state.app, '/api/users', managerId, { method: 'POST' });
    expect(denied.status).toBe(403);
    const adminState = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], []);
    const escalation = await request(adminState.app, '/api/users', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, name: 'Admin', email: 'admin@example.test', role: 'SYSTEM_ADMIN' }),
    });
    expect(escalation.status).toBe(400);
  });

  it('updates safe profile fields but rejects privilege fields', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [user(targetId, societyAId)]);
    const response = await request(state.app, `/api/users/${targetId}`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated User', role: 'SYSTEM_ADMIN' }),
    });
    expect(response.status).toBe(400);
    const valid = await request(state.app, `/api/users/${targetId}`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated User', phone: '+91-555-0111' }),
    });
    expect(valid.status).toBe(200);
    expect((await valid.json()).data).toMatchObject({ name: 'Updated User', phone: '+91-555-0111' });
  });

  it('rejects promoting a society-scoped user to SYSTEM_ADMIN', async () => {
    const state = createApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN')],
      [user(targetId, societyAId, 'RESIDENT')],
    );
    const response = await request(state.app, `/api/users/${targetId}/role`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SYSTEM_ADMIN' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(state.audits).toHaveLength(0);
  });

  it('audits authorized role and status changes and rejects unauthorized/cross-society operations', async () => {
    const state = createApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN'), currentUser(managerId, societyAId, 'SOCIETY_MANAGER')],
      [user(targetId, societyBId)],
    );
    const deniedRole = await request(state.app, `/api/users/${targetId}/role`, managerId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'SOCIETY_MANAGER' }),
    });
    expect(deniedRole.status).toBe(403);
    const role = await request(state.app, `/api/users/${targetId}/role`, adminId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'SOCIETY_MANAGER' }),
    });
    expect(role.status).toBe(200);
    const status = await request(state.app, `/api/users/${targetId}/status`, adminId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DISABLED' }),
    });
    expect(status.status).toBe(200);
    expect(state.audits.map((audit) => audit.action)).toEqual(['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED']);
    expect(state.audits[0]).toMatchObject({ previousState: { role: 'RESIDENT' }, newState: { role: 'SOCIETY_MANAGER' } });
    expect(state.audits[1]).toMatchObject({ previousState: { status: 'ACTIVE' }, newState: { status: 'DISABLED' } });
  });

  it('never exposes internal credential or password fields through retrieval', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [user(targetId, societyBId, 'RESIDENT', 'ACTIVE', 'password-hash')]);
    const response = await request(state.app, `/api/users/${targetId}`, adminId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.data).not.toHaveProperty('credentialHash');
  });
});
