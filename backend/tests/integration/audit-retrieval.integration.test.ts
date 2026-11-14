import express from 'express';
import { createServer } from 'node:http';
import mongoose, { mongo, Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuditRouter } from '../../src/modules/audit/audit-routes.js';
import { hashAuditLog } from '../../src/modules/audit/audit-log-hashing.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { Quotation } from '../../src/modules/quotation/models/Quotation.js';
import { Vendor } from '../../src/modules/vendor/models/Vendor.js';
import { ApprovalDecision } from '../../src/modules/approval/models/ApprovalDecision.js';
import { User } from '../../src/modules/users/models/User.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
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
const ownerId = new Types.ObjectId();
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
      {
        _id: ownerId,
        name: 'Integration Owner',
        email: `${ownerId}@example.test`,
        role: 'OWNER_MEMBER',
        status: 'ACTIVE',
        societyId: societyA,
      },
    ]);
    await Ownership.create({ societyId: societyA, flatId: new Types.ObjectId(), userId: ownerId, ownershipType: 'JOINT', status: 'ACTIVE' });
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

  it('lets a verified owner read public transparency events only in their society', async () => {
    const projectId = new Types.ObjectId();
    const projectEvent = new AuditLog({ societyId: societyA, actorId: managerId, action: 'PROJECT_APPROVED', entityType: 'Project', entityId: projectId, newState: { title: 'Lift renewal', status: 'APPROVED' } });
    const accountEvent = new AuditLog({ societyId: societyA, actorId: managerId, action: 'USER_STATUS_CHANGED', entityType: 'User', entityId: new Types.ObjectId(), newState: { status: 'DISABLED' } });
    const foreignEvent = new AuditLog({ societyId: societyB, actorId: adminId, action: 'PROJECT_APPROVED', entityType: 'Project', entityId: new Types.ObjectId(), newState: { title: 'Foreign project' } });
    await Promise.all([projectEvent.save(), accountEvent.save(), foreignEvent.save()]);

    const response = await request(app(), '/api/audit', ownerId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((event: { _id: string }) => event._id)).toEqual([projectEvent._id.toString()]);
    expect((await request(app(), `/api/audit/events/${accountEvent._id}`, ownerId)).status).toBe(404);
    expect((await request(app(), `/api/audit/events/${foreignEvent._id}`, ownerId)).status).toBe(404);
  });

  it('searches audit events through real project, quotation, vendor and approval relationships before pagination', async () => {
    const projectId = new Types.ObjectId();
    const foreignProjectId = new Types.ObjectId();
    const vendorId = new Types.ObjectId();
    const foreignVendorId = new Types.ObjectId();
    const ruleVersionId = new Types.ObjectId();
    const quotationId = new Types.ObjectId();
    const foreignQuotationId = new Types.ObjectId();
    const decisionId = new Types.ObjectId();
    await Project.create([
      { _id: projectId, societyId: societyA, title: 'Lift replacement', description: 'Building equipment', category: 'MAINTENANCE', estimatedCost: mongo.BSON.Decimal128.fromString('125000'), proposedBy: managerId, status: 'APPROVAL_REQUIRED' },
      { _id: foreignProjectId, societyId: societyB, title: 'Restricted project', description: 'Foreign society record', category: 'MAINTENANCE', estimatedCost: mongo.BSON.Decimal128.fromString('125000'), proposedBy: adminId, status: 'APPROVAL_REQUIRED' },
    ]);
    await Vendor.create([
      { _id: vendorId, societyId: societyA, name: 'CCTV Systems', status: 'ACTIVE' },
      { _id: foreignVendorId, societyId: societyB, name: 'CCTV Foreign Vendor', status: 'ACTIVE' },
    ]);
    await Quotation.create([
      { _id: quotationId, projectId, vendorId, versionNumber: 1, amount: mongo.BSON.Decimal128.fromString('120000'), description: 'Camera installation scope', status: 'SUBMITTED' },
      { _id: foreignQuotationId, projectId: foreignProjectId, vendorId: foreignVendorId, versionNumber: 1, amount: mongo.BSON.Decimal128.fromString('120000'), description: 'Foreign camera quotation', status: 'SUBMITTED' },
    ]);
    await ApprovalDecision.create({
      _id: decisionId, societyId: societyA, projectId, ruleVersionId, evaluatedAmount: mongo.BSON.Decimal128.fromString('120000'),
      requiredThreshold: mongo.BSON.Decimal128.fromString('100000'), approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM',
      reason: 'Approval routing evaluation', evaluatedBy: managerId, ruleSnapshot: { threshold: '100000' },
    });
    const projectEvent = new AuditLog({ societyId: societyA, actorId: managerId, action: 'PROJECT_SUBMITTED_FOR_APPROVAL', entityType: 'Project', entityId: projectId, newState: { status: 'APPROVAL_REQUIRED' } });
    const quotationEvent = new AuditLog({ societyId: societyA, actorId: managerId, action: 'QUOTATION_CREATED', entityType: 'Quotation', entityId: quotationId, newState: { status: 'SUBMITTED' } });
    const decisionEvent = new AuditLog({ societyId: societyA, actorId: managerId, action: 'APPROVAL_ROUTE_EVALUATED', entityType: 'ApprovalDecision', entityId: decisionId, newState: { status: 'REQUIRED' } });
    const foreignEvent = new AuditLog({ societyId: societyB, actorId: adminId, action: 'PROJECT_SUBMITTED_FOR_APPROVAL', entityType: 'Project', entityId: foreignProjectId, newState: { status: 'APPROVAL_REQUIRED' } });
    await Promise.all([projectEvent.save(), quotationEvent.save(), decisionEvent.save(), foreignEvent.save()]);

    const matchingPage = await request(app(), '/api/audit?search=cCt&page=1&pageSize=1', managerId);
    const matchingBody = await matchingPage.json();
    expect(matchingPage.status).toBe(200);
    expect(matchingBody.data).toHaveLength(1);
    expect(matchingBody.data[0].societyId).toBe(societyA.toString());
    expect(matchingBody.data[0].eventTitle).toBeTruthy();
    const secondPage = await request(app(), '/api/audit?search=CCTV&page=2&pageSize=1', managerId);
    expect((await secondPage.json()).data).toHaveLength(1);
    const relatedDescription = await request(app(), '/api/audit?search=camera%20installation', managerId);
    expect((await relatedDescription.json()).data.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['PROJECT_SUBMITTED_FOR_APPROVAL', 'QUOTATION_CREATED', 'APPROVAL_ROUTE_EVALUATED']));
    const relatedVendor = await request(app(), '/api/audit?search=systems', managerId);
    expect((await relatedVendor.json()).data.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['PROJECT_SUBMITTED_FOR_APPROVAL', 'QUOTATION_CREATED', 'APPROVAL_ROUTE_EVALUATED']));
    const dateFiltered = await request(app(), `/api/audit?search=cctv&from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, managerId);
    expect((await dateFiltered.json()).data).toHaveLength(0);
    const hiddenForeign = await request(app(), '/api/audit?search=foreign%20vendor', managerId);
    expect((await hiddenForeign.json()).data).toHaveLength(0);
  });
});
