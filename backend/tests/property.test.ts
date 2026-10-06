import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import {
  createPropertyRouter,
  type BuildingRecord,
  type FlatRecord,
  type PropertyRepository,
} from '../src/modules/property/property-routes.js';

const secret = 'property-tests-use-a-secret-with-at-least-32-bytes';
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const societyAId = '68a123456789012345678903';
const buildingId = '68a123456789012345678904';
const flatId = '68a123456789012345678905';
const servers: Server[] = [];

function identity(id: string, role: string, societyId: string | null): CurrentUserRecord {
  return { _id: new Types.ObjectId(id), role, societyId: societyId ? new Types.ObjectId(societyId) : null, status: 'ACTIVE' };
}

function building(): BuildingRecord {
  return { _id: new Types.ObjectId(buildingId), societyId: societyAId, name: 'A', buildingCode: 'A', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), internal: 'hidden' };
}

function flat(): FlatRecord {
  return { _id: new Types.ObjectId(flatId), societyId: societyAId, buildingId, flatNumber: '101', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), internal: 'hidden' };
}

function app(identities: CurrentUserRecord[]) {
  const buildings = new Map([[buildingId, building()]]);
  const flats = new Map([[flatId, flat()]]);
  const repository: PropertyRepository = {
    async findBuildings() { return [...buildings.values()]; },
    async findBuildingById(id) { return buildings.get(id) ?? null; },
    async createBuilding(data) { const record = { ...building(), ...data, _id: new Types.ObjectId() } as BuildingRecord; buildings.set(record._id.toString(), record); return record; },
    async updateBuilding(id, data) { const record = buildings.get(id); if (!record) return null; Object.assign(record, data); return record; },
    async updateBuildingStatus(id, status) { const record = buildings.get(id); if (!record) return null; record.status = status; return record; },
    async findFlats() { return [...flats.values()]; },
    async findFlatById(id) { return flats.get(id) ?? null; },
    async createFlat(data) { const record = { ...flat(), ...data, _id: new Types.ObjectId() } as FlatRecord; flats.set(record._id.toString(), record); return record; },
    async updateFlat(id, data) { const record = flats.get(id); if (!record) return null; Object.assign(record, data); return record; },
    async updateFlatStatus(id, status) { const record = flats.get(id); if (!record) return null; record.status = status; return record; },
  };
  const identitiesById = new Map(identities.map((item) => [item._id.toString(), item]));
  const serverApp = express();
  serverApp.use(express.json());
  serverApp.use(createPropertyRouter(
    repository,
    createAuthenticationMiddleware(() => secret),
    createLoadCurrentUser({ async findById(id) { return identitiesById.get(id) ?? null; } }),
  ));
  serverApp.use(errorHandler);
  return serverApp;
}

async function request(serverApp: express.Express, path: string, userId: string, init?: RequestInit) {
  const server = createServer(serverApp);
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

describe('property structure administration', () => {
  it('allows SYSTEM_ADMIN to create and safely return buildings and flats', async () => {
    const response = await request(app([identity(adminId, 'SYSTEM_ADMIN', null)]), '/buildings', adminId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, name: 'New', status: 'ACTIVE' }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).data).not.toHaveProperty('internal');
  });

  it('rejects society-scoped users and invalid property input', async () => {
    const serverApp = app([identity(managerId, 'SOCIETY_MANAGER', societyAId)]);
    const unauthorized = await request(serverApp, '/buildings', managerId, { method: 'POST', body: '{}' });
    expect(unauthorized.status).toBe(403);
    const invalid = await request(app([identity(adminId, 'SYSTEM_ADMIN', null)]), '/flats', adminId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, buildingId: 'bad', flatNumber: '101', status: 'ACTIVE' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('supports safe status updates', async () => {
    const response = await request(app([identity(adminId, 'SYSTEM_ADMIN', null)]), `/flats/${flatId}/status`, adminId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'INACTIVE' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe('INACTIVE');
  });
});
