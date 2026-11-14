import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import { generateSetupCredential, hashCredential } from '../src/modules/auth/credential.js';
import { ApiError } from '../src/lib/api-error.js';
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

function createApp(identities: CurrentUserRecord[], initialUsers: (UserProfileRecord & { passwordHash?: string })[], localDeliveryEnabled = true) {
  const users = new Map(initialUsers.map((record) => [record._id.toString(), record]));
  const audits: Record<string, unknown>[] = [];
  const credentials: { userId: string; credentialHash: string; expiresAt: Date }[] = [];
  const repository: UserAdministrationRepository = {
    async findAll() { return [...users.values()]; },
    async findSocietyStatus(id) { return id === societyAId ? 'ACTIVE' : null; },
    async findById(id) { return users.get(id) ?? null; },
    async createWithCredential(data, credential) {
      if ([...users.values()].some((record) => record.email.toLocaleLowerCase() === data.email.toLocaleLowerCase())) {
        throw Object.assign(new Error('duplicate email'), { code: 11000 });
      }
      const created = user(new Types.ObjectId().toString(), data.societyId, data.role, data.status);
      Object.assign(created, data);
      users.set(created._id.toString(), created);
      credentials.push({ userId: created._id.toString(), ...credential });
      return created;
    },
    async reissueSetupCredential(id, actorId) {
      const target = users.get(id);
      if (!target) throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
      if (target.status !== 'PENDING_SETUP') throw new ApiError(409, 'CONFLICT', 'A setup credential can only be reissued for an account awaiting setup.');
      const credential = generateSetupCredential();
      credentials.push({ userId: id, credentialHash: credential.credentialHash, expiresAt: credential.expiresAt });
      audits.push({ action: 'USER_SETUP_CREDENTIAL_REISSUED', actorId, entityId: id });
      return { user: target, credential: { rawCredential: credential.rawCredential, expiresAt: credential.expiresAt } };
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
    { enabled: localDeliveryEnabled },
  ));
  app.use(errorHandler);
  return { app, credentials, audits, get userCount() { return users.size; } };
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

  it('does not persist a pending account when setup credential delivery is unavailable', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [], false);
    const before = state.userCount;
    const response = await request(state.app, '/api/users', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, name: 'No Delivery', email: 'no-delivery@example.test', role: 'RESIDENT' }),
    });
    expect(response.status).toBe(503);
    expect(state.userCount).toBe(before);
    expect(state.credentials).toHaveLength(0);
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

  it.each(['OWNER_MEMBER', 'RESIDENT', 'COMMITTEE_MEMBER'])('allows a manager to create a pending same-society %s through local setup delivery', async (role) => {
    const state = createApp([currentUser(managerId, societyAId, 'SOCIETY_MANAGER')], []);
    const response = await request(state.app, '/api/users/society', managerId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New member', email: 'new-member@example.test', role }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ societyId: societyAId, role, status: 'PENDING_SETUP' });
    expect(body.data.setupCredential).toEqual(expect.any(String));
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.data).not.toHaveProperty('credentialHash');
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0].credentialHash).not.toBe(body.data.setupCredential);
    const listing = await request(state.app, '/api/users/society', managerId);
    expect(listing.status).toBe(200);
    const listed = (await listing.json()).data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('setupCredential');
    expect(listed[0]).not.toHaveProperty('credentialHash');
    expect(listed[0]).not.toHaveProperty('passwordHash');
  });

  it('rejects manager account escalation and caller-selected society associations before creating credentials', async () => {
    const state = createApp([currentUser(managerId, societyAId, 'SOCIETY_MANAGER')], []);
    for (const body of [
      { name: 'Admin', email: 'admin-role@example.test', role: 'SYSTEM_ADMIN' },
      { name: 'Manager', email: 'manager-role@example.test', role: 'SOCIETY_MANAGER' },
      { name: 'Cross society', email: 'cross@example.test', role: 'RESIDENT', societyId: societyBId },
    ]) {
      const response = await request(state.app, '/api/users/society', managerId, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(state.credentials).toHaveLength(0);
  });

  it('fails closed before manager account creation when local setup delivery is disabled', async () => {
    const state = createApp([currentUser(managerId, societyAId, 'SOCIETY_MANAGER')], [], false);
    const response = await request(state.app, '/api/users/society', managerId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New owner', email: 'new-owner@example.test', role: 'OWNER_MEMBER' }),
    });
    expect(response.status).toBe(503);
    expect(state.credentials).toHaveLength(0);
  });

  it('returns a conflict for a duplicate platform email without issuing another setup credential', async () => {
    const state = createApp(
      [currentUser(managerId, societyAId, 'SOCIETY_MANAGER')],
      [user(targetId, societyAId, 'OWNER_MEMBER')],
    );
    const response = await request(state.app, '/api/users/society', managerId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate', email: `${targetId}@example.test`, role: 'RESIDENT' }),
    });
    expect(response.status).toBe(409);
    expect(state.credentials).toHaveLength(0);
  });

  it('exposes only safe same-society profiles to managers while retaining platform account provisioning for System Admin', async () => {
    const state = createApp(
      [currentUser(managerId, societyAId, 'SOCIETY_MANAGER')],
      [user(targetId, societyAId, 'OWNER_MEMBER', 'ACTIVE', 'private-hash'), user('68a123456789012345678909', societyBId)],
    );
    const response = await request(state.app, '/api/users/society?search=Target', managerId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ _id: targetId, societyId: societyAId, role: 'OWNER_MEMBER' });
    expect(body.data[0]).not.toHaveProperty('passwordHash');
    expect((await request(state.app, '/api/users', managerId)).status).toBe(403);
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

  it('reissues a one-time credential for a pending account only to an authenticated platform admin', async () => {
    const state = createApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN'), currentUser(managerId, societyAId, 'SOCIETY_MANAGER')],
      [user(targetId, societyBId, 'SOCIETY_MANAGER', 'PENDING_SETUP')],
    );
    const denied = await request(state.app, `/api/users/${targetId}/setup-credential`, managerId, { method: 'POST' });
    expect(denied.status).toBe(403);

    const response = await request(state.app, `/api/users/${targetId}/setup-credential`, adminId, { method: 'POST' });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ _id: targetId, status: 'PENDING_SETUP', setupCredentialExpiresAt: expect.any(String) });
    expect(typeof body.data.setupCredential).toBe('string');
    expect(body.data).not.toHaveProperty('credentialHash');
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(state.audits.at(-1)).toMatchObject({ action: 'USER_SETUP_CREDENTIAL_REISSUED', actorId: adminId, entityId: targetId });
    expect(JSON.stringify(state.audits)).not.toContain(body.data.setupCredential);
  });

  it.each(['ACTIVE', 'DISABLED'])('rejects setup credential reissue for %s accounts', async (status) => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [user(targetId, societyAId, 'SOCIETY_MANAGER', status)]);
    const response = await request(state.app, `/api/users/${targetId}/setup-credential`, adminId, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(state.credentials).toHaveLength(0);
  });

  it('fails before credential issuance when no secure delivery channel is configured', async () => {
    const state = createApp(
      [currentUser(adminId, null, 'SYSTEM_ADMIN')],
      [user(targetId, societyAId, 'SOCIETY_MANAGER', 'PENDING_SETUP')],
      false,
    );
    const response = await request(state.app, `/api/users/${targetId}/setup-credential`, adminId, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(state.credentials).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});
