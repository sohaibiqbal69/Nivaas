import express from 'express';
import { createServer } from 'node:http';
import mongoose, { mongo, Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuditRouter } from '../../src/modules/audit/audit-routes.js';
import { hashAuditLog } from '../../src/modules/audit/audit-log-hashing.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { User } from '../../src/modules/users/models/User.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'audit-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const adminId = new Types.ObjectId();
const managerId = new Types.ObjectId();
const entityId = new Types.ObjectId();

function app() {
  const application = express();
  application.use('/api', createAuditRouter(undefined, createAuthenticationMiddleware(() => secret)));
  application.use(errorHandler);
  return application;
}

async function request(application: express.Express, path: string, userId: Types.ObjectId): Promise<Response> {
  const token = await issueAccessToken(userId.toString(), { secret, accessTokenTtlSeconds: 300 });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration server did not bind.');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return response;
}

async function insertAudit(societyId: Types.ObjectId, metadata: Record<string, unknown> = {}) {
  const event = new AuditLog({
    societyId,
    actorId: adminId,
    action: 'INTEGRATION_EVENT',
    entityType: 'IntegrationEntity',
    entityId,
    metadata,
  });
  await event.validate();
  await event.save();
  return event;
}

describe('Audit history retrieval MongoDB integration', () => {
  beforeAll(async () => {
    await connectIntegrationTestDatabase();
  });

  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    await User.create([
      {
        _id: adminId,
        name: 'Integration Admin',
        email: `${adminId}@example.test`,
        role: 'SYSTEM_ADMIN',
        status: 'ACTIVE',
        societyId: null,
      },
      {
        _id: managerId,
        name: 'Integration Manager',
        email: `${managerId}@example.test`,
        role: 'SOCIETY_MANAGER',
        status: 'ACTIVE',
        societyId: societyA,
      },
    ]);
  });

  afterAll(async () => {
    await disconnectIntegrationTestDatabase();
  });

  it('preserves BSON numeric subtypes through the real query and detects persisted tampering', async () => {
    const event = await insertAudit(societyA, { amount: new mongo.BSON.Int32(7), nested: { passwordHash: 'redact-me' } });
    const response = await request(app(), `/api/audit/IntegrationEntity/${entityId.toString()}`, adminId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].integrity.status).toBe('valid');
    expect(body.data[0].metadata.amount).toBe(7);
    expect(body.data[0].metadata.nested).not.toHaveProperty('passwordHash');

    await mongoose.connection.db?.collection('auditLogs').updateOne(
      { _id: event._id },
      { $set: { newState: { tampered: true } } },
    );

    const tamperedResponse = await request(app(), `/api/audit/IntegrationEntity/${entityId.toString()}`, adminId);
    const tamperedBody = await tamperedResponse.json();
    expect(tamperedBody.data[0].integrity.status).toBe('invalid');
  });

  it('applies society scope in the actual MongoDB query', async () => {
    await insertAudit(societyA);
    await insertAudit(societyB);
    const response = await request(app(), '/api/audit', managerId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].societyId).toBe(societyA.toString());
  });
});
