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
import { SocietyRuleVersion } from '../../src/modules/society/models/SocietyRuleVersion.js';
import { ApprovalDecision } from '../../src/modules/approval/models/ApprovalDecision.js';
import { User } from '../../src/modules/users/models/User.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
import { Residence } from '../../src/modules/property/models/Residence.js';
import { Vendor } from '../../src/modules/vendor/models/Vendor.js';
import { createVendorsRouter } from '../../src/modules/vendor/vendor-routes.js';
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
const ownerA = new Types.ObjectId();
const residentA = new Types.ObjectId();
const ownerB = new Types.ObjectId();
const residentB = new Types.ObjectId();
const projectId = new Types.ObjectId();
const ruleA = new Types.ObjectId();
const activeVendorId = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createQuotationRouter(createAuthenticationMiddleware(() => secret)));
  application.use('/api', createVendorsRouter(createAuthenticationMiddleware(() => secret)));
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
      { _id: societyA, name: 'Society A', status: 'ACTIVE', activeRuleVersionId: ruleA },
      { _id: societyB, name: 'Society B', status: 'ACTIVE' },
    ]);
    await SocietyRuleVersion.create({
      _id: ruleA, societyId: societyA, versionNumber: 1, status: 'ACTIVE',
      effectiveFrom: new Date(Date.now() - 1000), createdBy: managerA,
      approvalPolicy: { threshold: '100000' },
    });
    await User.create([
      { _id: managerA, name: 'Manager A', email: `${managerA}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
      { _id: ownerA, name: 'Owner A', email: `${ownerA}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyA },
      { _id: residentA, name: 'Resident A', email: `${residentA}@test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA },
      { _id: ownerB, name: 'Owner B', email: `${ownerB}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyB },
      { _id: residentB, name: 'Resident B', email: `${residentB}@test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyB },
    ]);
    await Ownership.create([
      { societyId: societyA, flatId: new Types.ObjectId(), userId: ownerA, ownershipType: 'PRIMARY', status: 'ACTIVE' },
      { societyId: societyB, flatId: new Types.ObjectId(), userId: ownerB, ownershipType: 'JOINT', status: 'ACTIVE' },
    ]);
    await Residence.create({ societyId: societyA, flatId: new Types.ObjectId(), userId: ownerA, occupancyType: 'OWNER', status: 'ENDED', endDate: new Date(Date.now() - 86_400_000) });
    await Project.create({
      _id: projectId, societyId: societyA, title: 'Roof repair', description: 'Repair',
      category: 'Repairs', estimatedCost: '1000', proposedBy: managerA, status: 'DRAFT',
    });
    await Vendor.create({ _id: activeVendorId, societyId: societyA, name: 'Active Vendor', status: 'ACTIVE' });
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('creates, retrieves, updates draft quotations and preserves revision requests', async () => {
    const application = app();
    const created = await request(application, `/api/projects/${projectId}/quotations`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId: activeVendorId.toString(), amount: '100.25', description: 'Initial quote' }),
    });
    expect(created.status).toBe(201);
    const quotation = (await created.json()).data;
    expect(quotation).toMatchObject({ versionNumber: 1, status: 'DRAFT', amount: '100.25' });

    const update = await request(application, `/api/quotations/${quotation._id}`, managerA, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '125.50' }),
    });
    expect(update.status).toBe(200);

    const selection = await request(application, `/api/quotations/${quotation._id}/select`, managerA, {
      method: 'POST',
    });
    expect(selection.status).toBe(200);
    expect((await selection.json()).data).toMatchObject({ status: 'SELECTED' });
    expect((await Project.findById(projectId).lean())?.currentQuotationId?.toString()).toBe(quotation._id);

    const revision = await request(application, `/api/quotations/${quotation._id}/change-requests`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalAmount: '25.50', reason: 'Additional materials' }),
    });
    expect(revision.status).toBe(201);
    expect((await revision.json()).data).toMatchObject({
      originalAmount: '125.5', additionalAmount: '25.5', newAmount: '151', status: 'DRAFT',
    });
    const submitted = await request(application, `/api/change-requests/${(await ChangeRequest.findOne({ quotationId: quotation._id }))?._id}/submit`, managerA, {
      method: 'POST',
    });
    expect(submitted.status).toBe(200);
    expect((await Project.findById(projectId).lean())?.status).toBe('RE_APPROVAL');
    expect((await ApprovalDecision.findOne({ projectId }).lean())?.evaluatedAmount.toString()).toBe('151');
    expect(await Quotation.countDocuments({ projectId })).toBe(1);
    expect(await ChangeRequest.countDocuments({ quotationId: quotation._id })).toBe(1);
    expect(await AuditLog.countDocuments({ societyId: societyA })).toBe(7);

    const replacement = await Quotation.create({
      projectId,
      vendorId: new Types.ObjectId(),
      versionNumber: 2,
      amount: '200',
      description: 'Replacement quote',
      status: 'SUBMITTED',
      previousQuotationId: quotation._id,
    });
    const switched = await request(application, `/api/quotations/${replacement._id}/select`, managerA, { method: 'POST' });
    expect(switched.status).toBe(200);
    expect((await Project.findById(projectId).lean())?.currentQuotationId?.toString()).toBe(replacement._id.toString());
    expect((await ApprovalDecision.findOne({ projectId, changeRequestId: { $exists: true } }).lean())?.status).toBe('INVALIDATED');
    expect(await ApprovalDecision.findOne({ projectId, quotationVersionId: replacement._id, status: 'RE_EVALUATED' }).lean()).toBeTruthy();
  });

  it('isolates societies, rejects invalid relationships and protects non-draft quotations', async () => {
    const application = app();
    const created = await request(application, `/api/projects/${projectId}/quotations`, managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId: activeVendorId.toString(), amount: '100', description: 'Quote' }),
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

  it('allows active owners to read society quotations while residents do not inherit financial visibility from role alone', async () => {
    const projectB = new Types.ObjectId();
    const quotationA = new Types.ObjectId();
    const quotationB = new Types.ObjectId();
    await Project.create({
      _id: projectB, societyId: societyB, title: 'Roof repair', description: 'Repair',
      category: 'Repairs', estimatedCost: '2000', proposedBy: managerB, status: 'DRAFT',
    });
    await Quotation.create([
      { _id: quotationA, projectId, vendorId: new Types.ObjectId(), versionNumber: 1, amount: '100.25', description: 'Society A quote', status: 'DRAFT' },
      { _id: quotationB, projectId: projectB, vendorId: new Types.ObjectId(), versionNumber: 1, amount: '900.75', description: 'Society B quote', status: 'DRAFT' },
    ]);
    const vendorA = await Vendor.create({ societyId: societyA, name: 'Lift Works', companyName: 'Lift Works Ltd', contactPerson: 'Private Contact', phone: '5550100', email: 'private@example.test', address: 'Private address', status: 'ACTIVE' });
    await Vendor.create({ societyId: societyB, name: 'Foreign Vendor', status: 'ACTIVE' });
    const application = app();

    const ownResponse = await request(application, `/api/projects/${projectId}/quotations`, ownerA);
    expect(ownResponse.status).toBe(200);
    const ownRecords = (await ownResponse.json()).data;
    expect(ownRecords).toHaveLength(1);
    expect(ownRecords[0]).toMatchObject({ _id: quotationA.toString(), projectId: projectId.toString(), amount: '100.25' });
    expect((await request(application, `/api/projects/${projectB}/quotations`, ownerA)).status).toBe(404);
    expect((await request(application, `/api/quotations/${quotationB}`, ownerA)).status).toBe(404);
    expect((await request(application, `/api/projects/${projectId}/quotations`, residentA)).status).toBe(403);
    expect((await request(application, '/api/vendors', residentA)).status).toBe(403);
    const ownerVendors = (await (await request(application, '/api/vendors', ownerA)).json()).data;
    expect(ownerVendors.every((vendor: { societyId: string }) => vendor.societyId === societyA.toString())).toBe(true);
    const visibleVendor = ownerVendors.find((vendor: { _id: string }) => vendor._id === vendorA._id.toString());
    expect(visibleVendor).toMatchObject({ _id: vendorA._id.toString(), name: 'Lift Works', companyName: 'Lift Works Ltd' });
    for (const privateField of ['contactPerson', 'phone', 'email', 'address', 'registrationDetails']) expect(visibleVendor).not.toHaveProperty(privateField);
    expect((await request(application, `/api/vendors?societyId=${societyB}`, ownerA)).status).toBe(200);
    const ignoredSocietyOverride = (await (await request(application, `/api/vendors?societyId=${societyB}`, ownerA)).json()).data;
    expect(ignoredSocietyOverride.map((vendor: { _id: string }) => vendor._id)).toEqual(ownerVendors.map((vendor: { _id: string }) => vendor._id));

    for (const reader of [ownerB, residentB]) {
      if (reader === residentB) {
        expect((await request(application, `/api/projects/${projectB}/quotations`, reader)).status).toBe(403);
        continue;
      }
      const ownResponse = await request(application, `/api/projects/${projectB}/quotations`, reader);
      expect(ownResponse.status).toBe(200);
      expect((await ownResponse.json()).data[0]._id).toBe(quotationB.toString());
      expect((await request(application, `/api/projects/${projectId}/quotations`, reader)).status).toBe(404);
      expect((await request(application, `/api/quotations/${quotationA}`, reader)).status).toBe(404);
    }
  });
});
