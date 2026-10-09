import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createQuotationRouter } from '../../src/modules/quotation/quotation-routes.js';
import { Quotation } from '../../src/modules/quotation/models/Quotation.js';
import { ChangeRequest } from '../../src/modules/quotation/models/ChangeRequest.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'quotation-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const projectId = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createQuotationRouter(createAuthenticationMiddleware(() => secret)));
  application.use(errorHandler);
  return application;
}

async function request(application: express.Express, path: string, userId: Types.ObjectId, init?: RequestInit) {
  const token = await issueAccessToken(userId.toString(), { secret, accessTokenTtlSeconds: 300 });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration server did not bind.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return response;
}

describe('Quotation MongoDB integration', () => {
  beforeAll(async () => connectIntegrationTestDatabase());
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    await Society.create([
      { _id: societyA, name: 'Society A', status: 'ACTIVE' },
      { _id: societyB, name: 'Society B', status: 'ACTIVE' },
    ]);
    await User.create([
      { _id: managerA, name: 'Manager A', email: `${managerA}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
    ]);
    await Project.create({
      _id: projectId, societyId: societyA, title: 'Roof repair', description: 'Repair',
      category: 'Repairs', estimatedCost: '1000', proposedBy: managerA, status: 'DRAFT',
    });
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('creates, retrieves, updates draft quotations and preserves revision requests', async () => {
    const application = app();
    const created = await request(application, `/api/projects/${projectId}/quotations`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId: new Types.ObjectId().toString(), amount: '100.25', description: 'Initial quote' }),
    });
    expect(created.status).toBe(201);
    const quotation = (await created.json()).data;
    expect(quotation).toMatchObject({ versionNumber: 1, status: 'DRAFT', amount: '100.25' });

    const update = await request(application, `/api/quotations/${quotation._id}`, managerA, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '125.50' }),
    });
    expect(update.status).toBe(200);

    const revision = await request(application, `/api/quotations/${quotation._id}/change-requests`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalAmount: '25.50', reason: 'Additional materials' }),
    });
    expect(revision.status).toBe(201);
    expect((await revision.json()).data).toMatchObject({
      originalAmount: '125.5', additionalAmount: '25.5', newAmount: '151', status: 'DRAFT',
    });
    expect(await Quotation.countDocuments({ projectId })).toBe(1);
    expect(await ChangeRequest.countDocuments({ quotationId: quotation._id })).toBe(1);
    expect(await AuditLog.countDocuments({ societyId: societyA })).toBe(3);
  });

  it('isolates societies, rejects invalid relationships and protects non-draft quotations', async () => {
    const application = app();
    const created = await request(application, `/api/projects/${projectId}/quotations`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId: new Types.ObjectId().toString(), amount: '100', description: 'Quote' }),
    });
    const quotation = (await created.json()).data;
    expect((await request(application, `/api/quotations/${quotation._id}`, managerB)).status).toBe(404);
    expect((await request(application, `/api/projects/${new Types.ObjectId()}/quotations`, managerA)).status).toBe(404);

    await Quotation.updateOne({ _id: quotation._id }, { $set: { status: 'SELECTED' } });
    const auditCountBeforeRejectedUpdate = await AuditLog.countDocuments({ societyId: societyA });
    const update = await request(application, `/api/quotations/${quotation._id}`, managerA, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '200' }),
    });
    expect(update.status).toBe(400);
    expect(await AuditLog.countDocuments({ societyId: societyA })).toBe(auditCountBeforeRejectedUpdate);
    const revision = await request(application, `/api/quotations/${quotation._id}/change-requests`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalAmount: '-1', reason: 'Invalid' }),
    });
    expect(revision.status).toBe(400);

    const validRevision = await request(application, `/api/quotations/${quotation._id}/change-requests`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalAmount: '10', reason: 'Additional work' }),
    });
    expect(validRevision.status).toBe(201);
    const revisionId = (await validRevision.json()).data._id;
    await ChangeRequest.updateOne({ _id: revisionId }, { $set: { status: 'SUBMITTED' } });
    const auditCountBeforeRejectedSubmit = await AuditLog.countDocuments({ societyId: societyA });
    const submit = await request(application, `/api/change-requests/${revisionId}/submit`, managerA, { method: 'POST' });
    expect(submit.status).toBe(400);
    expect(await AuditLog.countDocuments({ societyId: societyA })).toBe(auditCountBeforeRejectedSubmit);
  });
});
