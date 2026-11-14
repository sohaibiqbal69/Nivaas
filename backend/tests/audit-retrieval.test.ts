import express from 'express';
import { createServer, type Server } from 'node:http';
import { mongo, Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';
import { createAuditRouter, type AuditRecord, type AuditRepository } from '../src/modules/audit/audit-routes.js';
import { hashAuditLog } from '../src/modules/audit/audit-log-hashing.js';
import { isOwnerTransparencyAuditEntity } from '../src/modules/property/owner-society-access.js';

const secret = 'audit-retrieval-tests-use-a-secret-with-32-bytes';
const adminId = '68a123456789012345678901';
const managerId = '68a123456789012345678902';
const committeeId = '68a123456789012345678903';
const ownerId = '68a123456789012345678904';
const societyA = '68a123456789012345678905';
const societyB = '68a123456789012345678906';
const entityId = '68a123456789012345678907';
const servers: Server[] = [];

function identity(id: string, role: string, societyId: string | null): CurrentUserRecord {
  return { _id: new Types.ObjectId(id), role, societyId: societyId ? new Types.ObjectId(societyId) : null, status: 'ACTIVE' };
}

function audit(overrides: Partial<AuditRecord> = {}): AuditRecord {
  const record = {
    _id: new Types.ObjectId(),
    societyId: new Types.ObjectId(societyA),
    actorId: new Types.ObjectId(adminId),
    action: 'USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: new Types.ObjectId(entityId),
    previousState: { status: 'ACTIVE' },
    newState: { status: 'DISABLED', passwordHash: 'must-not-leak' },
    metadata: { reason: 'test' },
    hashVersion: 1,
    recordHash: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  } as AuditRecord;
  Object.assign(record, overrides);
  if (!overrides.recordHash) record.recordHash = hashAuditLog(record as unknown as Record<string, unknown>);
  return record;
}

function createApp(identities: CurrentUserRecord[], initial: AuditRecord[], hasActiveOwnership = async () => false) {
  const repository: AuditRepository = {
    async find(filters, societyId, skip, limit) {
      return initial
        .filter((record) => societyId === null || record.societyId?.toString() === societyId)
        .filter((record) => !filters.action || record.action === filters.action)
        .filter((record) => !filters.entityType || record.entityType === filters.entityType)
        .filter((record) => !filters.ownerTransparencyOnly || isOwnerTransparencyAuditEntity(record.entityType))
        .filter((record) => !filters.entityId || record.entityId?.toString() === filters.entityId)
        .filter((record) => !filters.from || record.createdAt >= filters.from)
        .filter((record) => !filters.to || record.createdAt <= filters.to)
        .filter((record) => !filters.search || JSON.stringify([record.action.replaceAll('_', ' '), record.entityType, record.newState, record.previousState, record.metadata, record.relatedTitle]).toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(skip, skip + limit);
    },
    async findById(id, societyId) {
      return initial.find((record) => record._id.toString() === id.toString()
        && (societyId === null || record.societyId?.toString() === societyId)) ?? null;
    },
  };
  const identityMap = new Map(identities.map((record) => [record._id.toString(), record]));
  const app = express();
  app.use(createAuditRouter(
    repository,
    createAuthenticationMiddleware(() => secret),
    createLoadCurrentUser({ async findById(id) { return identityMap.get(id) ?? null; } }),
    hasActiveOwnership,
  ));
  app.use(errorHandler);
  return app;
}

async function request(app: express.Express, path: string, userId?: string) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  const headers = new Headers();
  if (userId) headers.set('Authorization', `Bearer ${await issueAccessToken(userId, { secret, accessTokenTtlSeconds: 300 })}`);
  return fetch(`http://127.0.0.1:${address.port}${path}`, { headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('audit history retrieval', () => {
  it('allows SYSTEM_ADMIN to read all societies and system events', async () => {
    const records = [audit(), audit({ societyId: new Types.ObjectId(societyB), createdAt: new Date('2026-01-02') }), audit({ societyId: null, createdAt: new Date('2026-01-03') })];
    const response = await request(createApp([identity(adminId, 'SYSTEM_ADMIN', null)], records), '/audit', adminId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.data[0].societyId).toBeNull();
  });

  it('limits managers and committee members to their own society and requires owners to prove an active ownership relationship', async () => {
    const publicRecord = audit({ action: 'PROJECT_APPROVED', entityType: 'Project' });
    const privateRecord = audit();
    const foreignRecord = audit({ societyId: new Types.ObjectId(societyB), action: 'PROJECT_APPROVED', entityType: 'Project' });
    const records = [publicRecord, privateRecord, foreignRecord];
    for (const user of [
      identity(managerId, 'SOCIETY_MANAGER', societyA),
      identity(committeeId, 'COMMITTEE_MEMBER', societyA),
    ]) {
      const response = await request(createApp([user], records), '/audit', user._id.toString());
      expect((await response.json()).data).toHaveLength(2);
    }
    const owner = identity(ownerId, 'OWNER_MEMBER', societyA);
    const ownerApp = createApp([owner], records, async (_userId, targetSocietyId) => targetSocietyId === societyA);
    const ownerResponse = await request(ownerApp, '/audit', ownerId);
    expect(ownerResponse.status).toBe(200);
    expect((await ownerResponse.json()).data.map((event: { _id: string }) => event._id)).toEqual([publicRecord._id.toString()]);
    expect((await request(ownerApp, `/audit/events/${privateRecord._id}`, ownerId)).status).toBe(404);
    expect((await request(createApp([owner], records), '/audit', ownerId)).status).toBe(404);

    const resident = identity(ownerId, 'RESIDENT', societyA);
    expect((await request(createApp([resident], records), '/audit', ownerId)).status).toBe(403);
  });

  it('filters entity history, rejects society bypass and validates pagination/date filters', async () => {
    const records = [audit(), audit({ entityId: new Types.ObjectId(), createdAt: new Date('2026-02-01') })];
    const app = createApp([identity(managerId, 'SOCIETY_MANAGER', societyA)], records);
    const history = await request(app, `/audit/User/${entityId}?pageSize=1&from=2025-12-01&to=2026-01-31`, managerId);
    expect((await history.json()).data).toHaveLength(1);
    expect((await request(app, '/audit?societyId=' + societyB, managerId)).status).toBe(400);
    expect((await request(app, '/audit?pageSize=101', managerId)).status).toBe(400);
    expect((await request(app, '/audit?from=bad', managerId)).status).toBe(400);
    expect((await request(app, '/audit?from=2026-02-01&to=2026-01-01', managerId)).status).toBe(400);
    expect((await request(app, '/audit', undefined)).status).toBe(401);
  });

  it('searches one partial case-insensitive event field before pagination and keeps dates and society scope', async () => {
    const match = audit({ action: 'PROJECT_SUBMITTED_FOR_APPROVAL', newState: { title: 'CCTV replacement' }, createdAt: new Date('2026-01-03') });
    const second = audit({ action: 'QUOTATION_CREATED', newState: { title: 'CCTV vendor quote' }, createdAt: new Date('2026-01-02') });
    const foreign = audit({ societyId: new Types.ObjectId(societyB), action: 'PROJECT_SUBMITTED', newState: { title: 'CCTV foreign' } });
    const app = createApp([identity(managerId, 'SOCIETY_MANAGER', societyA)], [match, second, foreign]);
    const response = await request(app, '/audit?search=cCt&page=1&pageSize=1&from=2026-01-01&to=2026-01-04', managerId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]._id).toBe(match._id.toString());
    expect(body.data[0].eventTitle).toBe('Project Submitted For Approval');
    expect((await request(app, '/audit?search=CCTV&action=PROJECT_SUBMITTED', managerId)).status).toBe(400);
  });

  it('searches human-readable event titles without requiring underscores from the stored action', async () => {
    const record = audit({ action: 'PROJECT_SUBMITTED_FOR_APPROVAL' });
    const response = await request(createApp([identity(managerId, 'SOCIETY_MANAGER', societyA)], [record]), '/audit?search=submitted%20for%20approval', managerId);
    expect((await response.json()).data.map((event: { eventTitle: string }) => event.eventTitle)).toEqual(['Project Submitted For Approval']);
  });

  it('retrieves a directly linked historical audit record without pagination and preserves society isolation', async () => {
    const historical = audit({ createdAt: new Date('2023-04-05T06:07:08.000Z') });
    const foreign = audit({ societyId: new Types.ObjectId(societyB), createdAt: new Date('2023-04-05T06:07:08.000Z') });
    const records = [historical, foreign];
    const app = createApp([identity(managerId, 'SOCIETY_MANAGER', societyA)], records);
    const response = await request(app, `/audit/events/${historical._id}`, managerId);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ _id: historical._id.toString(), integrity: { status: 'valid' } });
    expect((await request(app, `/audit/events/${foreign._id}`, managerId)).status).toBe(404);
  });

  it('reports valid, tampered, and unsupported hashes while preserving BSON subtypes', async () => {
    const valid = audit({ metadata: { amount: new mongo.BSON.Int32(1) } });
    const tampered = audit();
    tampered.newState = { status: 'TAMPERED' };
    const unsupported = audit({ hashVersion: 2, recordHash: `0x${'a'.repeat(64)}` });
    const response = await request(createApp([identity(adminId, 'SYSTEM_ADMIN', null)], [valid, tampered, unsupported]), '/audit', adminId);
    const body = await response.json();
    expect(body.data.map((item: any) => item.integrity.status)).toEqual(['valid', 'invalid', 'unsupported']);
    expect(body.data[0].newState).not.toHaveProperty('passwordHash');
  });

  it('redacts sensitive nested array fields and does not return unsupported instances', async () => {
    class SensitiveContainer {
      passwordHash = 'hidden';
    }
    const record = audit({
      metadata: {
        values: [
          { setupCredential: 'hidden', visible: 'ok' },
          new SensitiveContainer(),
        ],
      },
      recordHash: `0x${'a'.repeat(64)}`,
    });
    const response = await request(createApp([identity(adminId, 'SYSTEM_ADMIN', null)], [record]), '/audit', adminId);
    const body = await response.json();

    expect(body.data[0].metadata.values[0]).toEqual({ visible: 'ok' });
    expect(body.data[0].metadata.values[1]).toBeNull();
  });
});
