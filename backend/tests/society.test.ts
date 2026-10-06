import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import {
  createSocietiesRouter,
  type SocietyRecord,
  type SocietyRepository,
} from '../src/modules/society/society-routes.js';

const jwtSecret = 'society-tests-use-a-secret-with-at-least-32-bytes';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 300 };
const adminId = '68a123456789012345678901';
const residentId = '68a123456789012345678902';
const societyAId = '68a123456789012345678903';
const societyBId = '68a123456789012345678904';
const servers: Server[] = [];

function currentUser(userId: string, societyId: string | null, role: string): CurrentUserRecord {
  return {
    _id: new Types.ObjectId(userId),
    societyId: societyId ? new Types.ObjectId(societyId) : null,
    role,
    status: 'ACTIVE',
  };
}

function society(id: string, name: string): SocietyRecord {
  return {
    _id: new Types.ObjectId(id),
    name,
    registrationNumber: 'REG-001',
    address: '1 Main Street',
    contactEmail: 'office@example.test',
    contactPhone: '+91-555-0100',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    internalField: 'must-not-leak',
    activeRuleVersionId: new Types.ObjectId(),
  };
}

function createSocietyApp(records: CurrentUserRecord[], initialSocieties: SocietyRecord[]) {
  const identities = new Map(records.map((record) => [record._id.toString(), record]));
  const societies = new Map(initialSocieties.map((record) => [record._id.toString(), record]));
  const repository: SocietyRepository = {
    async findAll() { return [...societies.values()]; },
    async findById(id) { return societies.get(id) ?? null; },
    async create(data) {
      const record = society(new Types.ObjectId().toString(), String(data.name));
      Object.assign(record, data);
      societies.set(record._id.toString(), record);
      return record;
    },
    async update(id, data) {
      const record = societies.get(id);
      if (!record) return null;
      Object.assign(record, data);
      return record;
    },
    async updateStatus(id, status) {
      const record = societies.get(id);
      if (!record) return null;
      record.status = status;
      return record;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/societies', createSocietiesRouter(
    repository,
    createAuthenticationMiddleware(() => jwtSecret),
    createLoadCurrentUser({ async findById(id) { return identities.get(id) ?? null; } }),
  ));
  app.use(errorHandler);
  return app;
}

async function startServer(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

async function request(app: express.Express, path: string, userId: string | undefined, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (userId) headers.set('Authorization', `Bearer ${await issueAccessToken(userId, jwtConfiguration)}`);
  return fetch(`${await startServer(app)}${path}`, { ...init, headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('Society administration', () => {
  it('allows SYSTEM_ADMIN to create a society without exposing internal fields', async () => {
    const response = await request(createSocietyApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], []), '/api/societies', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Society', address: '2 Main Street' }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ name: 'New Society', status: 'ACTIVE' });
    expect(body.data).not.toHaveProperty('activeRuleVersionId');
    expect(body.data).not.toHaveProperty('internalField');
  });

  it('allows SYSTEM_ADMIN to list and view societies across societies', async () => {
    const app = createSocietyApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [
      society(societyAId, 'Society A'), society(societyBId, 'Society B'),
    ]);
    const listResponse = await request(app, '/api/societies', adminId);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data).toHaveLength(2);
    const viewResponse = await request(app, `/api/societies/${societyBId}`, adminId);
    expect(viewResponse.status).toBe(200);
    expect((await viewResponse.json()).data.name).toBe('Society B');
  });

  it('allows SYSTEM_ADMIN to update details and status', async () => {
    const app = createSocietyApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [society(societyAId, 'Old Name')]);
    const updateResponse = await request(app, `/api/societies/${societyAId}`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name', contactEmail: 'new@example.test' }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).data).toMatchObject({ name: 'Updated Name', contactEmail: 'new@example.test' });
    const statusResponse = await request(app, `/api/societies/${societyAId}/status`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    expect(statusResponse.status).toBe(200);
    expect((await statusResponse.json()).data.status).toBe('DISABLED');
  });

  it('rejects invalid input and non-admin access', async () => {
    const app = createSocietyApp([currentUser(adminId, null, 'SYSTEM_ADMIN'), currentUser(residentId, societyAId, 'RESIDENT')], [society(societyAId, 'Society A')]);
    const invalidResponse = await request(app, '/api/societies', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(invalidResponse.status).toBe(400);
    expect((await invalidResponse.json()).error.code).toBe('VALIDATION_ERROR');
    const unauthorizedResponse = await request(app, '/api/societies', residentId);
    expect(unauthorizedResponse.status).toBe(403);
  });

  it('does not allow a society user to access another society through administration routes', async () => {
    const app = createSocietyApp([currentUser(residentId, societyAId, 'SOCIETY_MANAGER')], [society(societyBId, 'Society B')]);
    const response = await request(app, `/api/societies/${societyBId}`, residentId);
    expect(response.status).toBe(403);
  });
});
