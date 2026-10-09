import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { ApiError } from '../src/lib/api-error.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import {
  createOwnershipResidenceRouter,
  type RelationshipRecord,
} from '../src/modules/property/ownership-residence-routes.js';

const secret = 'ownership-residence-tests-use-a-secret-32-bytes';
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const societyA = '68a123456789012345678903';
const societyB = '68a123456789012345678904';
const flatA = '68a123456789012345678905';
const userA = '68a123456789012345678906';
const servers: Server[] = [];

function identity(id: string, role: string, societyId: string | null): CurrentUserRecord {
  return { _id: new Types.ObjectId(id), role, societyId: societyId ? new Types.ObjectId(societyId) : null, status: 'ACTIVE' };
}

function record(type: 'ownership' | 'residence', userId = userA, societyId = societyA): RelationshipRecord {
  return {
    _id: new Types.ObjectId(), societyId: new Types.ObjectId(societyId), flatId: new Types.ObjectId(flatA),
    userId: new Types.ObjectId(userId), status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
    ...(type === 'ownership' ? { ownershipType: 'PRIMARY', ownershipOrder: 1 } : { occupancyType: 'TENANT' }),
  };
}

function createApp(identities: CurrentUserRecord[]) {
  const ownerships: RelationshipRecord[] = [];
  const residences: RelationshipRecord[] = [];
  const audits: unknown[] = [];
  const repo = {
    async findByFlat(type: 'ownership' | 'residence', flatId: string) {
      return flatId === flatA ? (type === 'ownership' ? ownerships : residences) : null;
    },
    async create(type: 'ownership' | 'residence', flatId: string, data: Record<string, unknown>, actorId: string) {
      if (flatId !== flatA) throw new ApiError(400, 'VALIDATION_ERROR', 'The flat does not exist.');
      if (data.societyId === societyB) throw new ApiError(400, 'VALIDATION_ERROR', 'The relationship does not belong to the flat society.');
      if (data.userId === '000000000000000000000000') throw new ApiError(400, 'VALIDATION_ERROR', 'The user does not exist.');
      const created = { ...record(type), flatId: new Types.ObjectId(flatId), ...data, societyId: new Types.ObjectId(societyA) } as RelationshipRecord;
      (type === 'ownership' ? ownerships : residences).push(created);
      audits.push({ type, actorId });
      return created;
    },
    async update(type: 'ownership' | 'residence', id: string, data: Record<string, unknown>, actorId: string) {
      const items = type === 'ownership' ? ownerships : residences;
      const existing = items.find((item) => item._id.toString() === id);
      if (!existing) return null;
      Object.assign(existing, data);
      audits.push({ type, actorId });
      return existing;
    },
  };
  const identityMap = new Map(identities.map((item) => [item._id.toString(), item]));
  const app = express();
  app.use(express.json());
  app.use(createOwnershipResidenceRouter(
    repo,
    createAuthenticationMiddleware(() => secret),
    createLoadCurrentUser({ async findById(id) { return identityMap.get(id) ?? null; } }),
  ));
  app.use(errorHandler);
  return { app, ownerships, residences, audits };
}

async function request(app: express.Express, path: string, userId: string, init?: RequestInit) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${await issueAccessToken(userId, { secret, accessTokenTtlSeconds: 300 })}`);
  return fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('ownership and residence administration', () => {
  it('allows SYSTEM_ADMIN to create multiple ownerships and residences safely', async () => {
    const setup = createApp([identity(adminId, 'SYSTEM_ADMIN', null)]);
    const ownershipBody = { userId: userA, ownershipType: 'PRIMARY', ownershipOrder: 1, status: 'ACTIVE', startDate: '2026-01-01' };
    const first = await request(setup.app, `/flats/${flatA}/ownerships`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ownershipBody) });
    const second = await request(setup.app, `/flats/${flatA}/ownerships`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ownershipBody, ownershipOrder: 2 }) });
    const residence = await request(setup.app, `/flats/${flatA}/residents`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userA, occupancyType: 'OWNER', status: 'ACTIVE' }) });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(residence.status).toBe(201);
    expect(setup.ownerships).toHaveLength(2);
    expect(setup.residences).toHaveLength(1);
    expect((await first.json()).data).not.toHaveProperty('passwordHash');
    expect(setup.audits).toHaveLength(3);
  });

  it('rejects society-scoped roles, invalid ids, dates, and mismatched societies', async () => {
    const setup = createApp([identity(managerId, 'SOCIETY_MANAGER', societyA), identity(adminId, 'SYSTEM_ADMIN', null)]);
    const forbidden = await request(setup.app, `/flats/${flatA}/ownerships`, managerId, { method: 'POST', body: '{}' });
    expect(forbidden.status).toBe(403);
    const invalidId = await request(setup.app, '/flats/not-an-id/ownerships', adminId);
    expect(invalidId.status).toBe(400);
    const invalidDate = await request(setup.app, `/flats/${flatA}/residents`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userA, occupancyType: 'OWNER', status: 'ACTIVE', startDate: 'bad' }) });
    expect(invalidDate.status).toBe(400);
    const reversed = await request(setup.app, `/flats/${flatA}/residents`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userA, occupancyType: 'OWNER', status: 'ACTIVE', startDate: '2026-02-01', endDate: '2026-01-01' }) });
    expect(reversed.status).toBe(400);
    const mismatch = await request(setup.app, `/flats/${flatA}/ownerships`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ societyId: societyB, userId: userA, ownershipType: 'PRIMARY', status: 'ACTIVE' }) });
    expect(mismatch.status).toBe(400);
    const missingUser = await request(setup.app, `/flats/${flatA}/ownerships`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: '000000000000000000000000', ownershipType: 'PRIMARY', status: 'ACTIVE' }) });
    expect(missingUser.status).toBe(400);
    const missingFlat = await request(setup.app, `/flats/${societyB}/ownerships`, adminId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userA, ownershipType: 'PRIMARY', status: 'ACTIVE' }) });
    expect(missingFlat.status).toBe(400);
  });

  it('supports safe updates without changing relationship identity', async () => {
    const setup = createApp([identity(adminId, 'SYSTEM_ADMIN', null)]);
    const created = record('ownership');
    setup.ownerships.push(created);
    const response = await request(setup.app, `/ownerships/${created._id.toString()}`, adminId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'INACTIVE', endDate: '2026-12-31' }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status: 'INACTIVE', userId: userA, flatId: flatA });
    expect(setup.audits).toHaveLength(1);
  });
});
