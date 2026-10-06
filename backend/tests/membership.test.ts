import express from 'express';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import {
  createMembershipsRouter,
  type MembershipRecord,
  type MembershipRepository,
} from '../src/modules/membership/membership-routes.js';
import { ApiError } from '../src/lib/api-error.js';

const jwtSecret = 'membership-tests-use-a-secret-with-at-least-32-bytes';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 300 };
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const societyAId = '68a123456789012345678903';
const societyBId = '68a123456789012345678904';
const memberId = '68a123456789012345678905';
const unitAId = '68a123456789012345678906';
const unitBId = '68a123456789012345678907';
const membershipId = '68a123456789012345678908';
const servers: Server[] = [];

function currentUser(userId: string, societyId: string | null, role: string): CurrentUserRecord {
  return { _id: new Types.ObjectId(userId), societyId: societyId ? new Types.ObjectId(societyId) : null, role, status: 'ACTIVE' };
}

function membership(id = membershipId, societyId = societyAId, unitId = unitAId): MembershipRecord {
  return {
    _id: new Types.ObjectId(id),
    societyId: new Types.ObjectId(societyId),
    userId: new Types.ObjectId(memberId),
    unitId: new Types.ObjectId(unitId),
    membershipType: 'PRIMARY',
    membershipStatus: 'ACTIVE',
    membershipNumber: 'M-001',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: 'must-not-leak',
  };
}

function createApp(identities: CurrentUserRecord[], initial: MembershipRecord[] = []) {
  const records = new Map(initial.map((record) => [record._id.toString(), record]));
  const audits: Record<string, unknown>[] = [];
  const repository: MembershipRepository = {
    async findAll(filters) {
      return [...records.values()].filter((record) => Object.entries(filters).every(([field, value]) => {
        const actual = field === 'membershipStatus' ? record.membershipStatus : record[field];
        return actual?.toString() === value;
      }));
    },
    async findById(id) { return records.get(id) ?? null; },
    async createWithAudit(data, actorId) {
      if (data.societyId === societyBId) throw new ApiError(400, 'VALIDATION_ERROR', 'The society does not exist.');
      if (data.userId === '000000000000000000000000') throw new ApiError(400, 'VALIDATION_ERROR', 'The user does not exist.');
      if (data.unitId === unitBId) throw new ApiError(400, 'VALIDATION_ERROR', 'The unit does not belong to the society.');
      if (records.size > 0) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const created = membership('68a123456789012345678910', data.societyId, data.unitId);
      Object.assign(created, data);
      records.set(created._id.toString(), created);
      audits.push({ action: 'MEMBERSHIP_CREATED', actorId });
      return created;
    },
    async updateWithAudit(id, update, actorId) {
      const existing = records.get(id);
      if (!existing) return null;
      Object.assign(existing, update);
      audits.push({ action: 'MEMBERSHIP_UPDATED', actorId });
      return { ...existing };
    },
    async updateStatusWithAudit(id, status, actorId) {
      const existing = records.get(id);
      if (!existing) return null;
      existing.membershipStatus = status;
      audits.push({
        action: 'MEMBERSHIP_STATUS_CHANGED',
        actorId,
        previousState: { membershipStatus: 'ACTIVE' },
        newState: { membershipStatus: status },
      });
      return { ...existing };
    },
  };
  const identityMap = new Map(identities.map((record) => [record._id.toString(), record]));
  const app = express();
  app.use(express.json());
  app.use('/api/memberships', createMembershipsRouter(
    repository,
    createAuthenticationMiddleware(() => jwtSecret),
    createLoadCurrentUser({ async findById(id) { return identityMap.get(id) ?? null; } }),
  ));
  app.use(errorHandler);
  return { app, audits };
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

describe('Membership administration', () => {
  it('allows SYSTEM_ADMIN to create a membership and audits status changes', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')]);
    const created = await request(state.app, '/api/memberships', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        societyId: societyAId,
        userId: memberId,
        unitId: unitAId,
        membershipType: 'PRIMARY',
        membershipStatus: 'ACTIVE',
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).data).toMatchObject({
      societyId: societyAId,
      userId: memberId,
      unitId: unitAId,
      membershipType: 'PRIMARY',
      membershipStatus: 'ACTIVE',
    });

    const status = await request(state.app, `/api/memberships/${'68a123456789012345678910'}/status`, adminId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipStatus: 'INACTIVE' }),
    });
    expect(status.status).toBe(200);
    expect(state.audits.map((audit) => audit.action)).toEqual(['MEMBERSHIP_CREATED', 'MEMBERSHIP_STATUS_CHANGED']);
  });

  it('rejects unauthorized and cross-society administration', async () => {
    const state = createApp([currentUser(managerId, societyAId, 'SOCIETY_MANAGER')], [membership()]);
    const response = await request(state.app, '/api/memberships', managerId, { method: 'POST' });
    expect(response.status).toBe(403);
    const crossSociety = await request(state.app, `/api/memberships/${membershipId}`, managerId);
    expect(crossSociety.status).toBe(403);
  });

  it('rejects invalid references, invalid type/status, inconsistent unit, and duplicates', async () => {
    const admin = currentUser(adminId, null, 'SYSTEM_ADMIN');
    const invalidState = createApp([admin]);
    const cases = [
      { societyId: societyBId, userId: memberId, unitId: unitAId, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
      { societyId: societyAId, userId: '000000000000000000000000', unitId: unitAId, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
      { societyId: societyAId, userId: memberId, unitId: unitBId, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' },
      { societyId: societyAId, userId: memberId, unitId: unitAId, membershipType: 'INVALID', membershipStatus: 'ACTIVE' },
      { societyId: societyAId, userId: memberId, unitId: unitAId, membershipType: 'PRIMARY', membershipStatus: 'INVALID' },
    ];
    for (const body of cases) {
      const response = await request(invalidState.app, '/api/memberships', adminId, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }

    const duplicateState = createApp([admin], [membership()]);
    const duplicate = await request(duplicateState.app, '/api/memberships', adminId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyAId, userId: memberId, unitId: unitAId, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' }),
    });
    expect(duplicate.status).toBe(409);
  });

  it('does not expose secrets or confer governance authority', async () => {
    const state = createApp([currentUser(adminId, null, 'SYSTEM_ADMIN')], [membership()]);
    const response = await request(state.app, `/api/memberships/${membershipId}`, adminId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.data).not.toHaveProperty('credentialHash');
    expect(body.data).not.toHaveProperty('canVote');
    expect(body.data).not.toHaveProperty('governanceEligible');
  });
});
