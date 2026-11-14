import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createProjectsRouter } from '../../src/modules/project/project-routes.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { ProjectUpdate } from '../../src/modules/project/models/ProjectUpdate.js';
import { createExpensesRouter } from '../../src/modules/expense/expense-routes.js';
import { Expense } from '../../src/modules/expense/models/Expense.js';
import { BudgetCategory } from '../../src/modules/budget/models/BudgetCategory.js';
import { Evidence } from '../../src/modules/evidence/models/Evidence.js';
import { createEvidenceRouter } from '../../src/modules/evidence/evidence-routes.js';
import { EvidenceService } from '../../src/modules/evidence/evidence-service.js';
import type { LocalEvidenceStorage } from '../../src/modules/evidence/local-evidence-storage.js';
import { photo } from '../evidence-fixture.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Budget } from '../../src/modules/budget/models/Budget.js';
import { Building } from '../../src/modules/property/models/Building.js';
import { Flat } from '../../src/modules/property/models/Flat.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
import { Residence } from '../../src/modules/property/models/Residence.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'project-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const ownerA = new Types.ObjectId();
const jointOwnerA = new Types.ObjectId();
const residentA = new Types.ObjectId();
const ownerB = new Types.ObjectId();
const residentB = new Types.ObjectId();
const admin = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createProjectsRouter(createAuthenticationMiddleware(() => secret)));
  application.use('/api', createExpensesRouter(createAuthenticationMiddleware(() => secret)));
  const files = new Map<string, Buffer>();
  const storage = { write: async (bytes: Buffer) => { const storagePath = `${new Types.ObjectId().toString()}.bin`; files.set(storagePath, Buffer.from(bytes)); return { provider: 'local' as const, storagePath }; }, read: async (reference: { storagePath: string }) => files.get(reference.storagePath)!, remove: async (reference: { storagePath: string }) => { files.delete(reference.storagePath); } } as unknown as LocalEvidenceStorage;
  application.use('/api', createEvidenceRouter(createAuthenticationMiddleware(() => secret), undefined, new EvidenceService(storage)));
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

describe('Project MongoDB integration', () => {
  beforeAll(async () => connectIntegrationTestDatabase());
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    await Society.create([
      { _id: societyA, name: 'Society A', status: 'ACTIVE' },
      { _id: societyB, name: 'Society B', status: 'ACTIVE' },
    ]);
    await User.create([
      { _id: admin, name: 'Admin', email: `${admin}@test`, role: 'SYSTEM_ADMIN', status: 'ACTIVE', societyId: null },
      { _id: managerA, name: 'Manager A', email: `${managerA}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
      { _id: ownerA, name: 'Owner A', email: `${ownerA}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyA },
      { _id: jointOwnerA, name: 'Joint Owner A', email: `${jointOwnerA}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyA },
      { _id: residentA, name: 'Resident A', email: `${residentA}@test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyA },
      { _id: ownerB, name: 'Owner B', email: `${ownerB}@test`, role: 'OWNER_MEMBER', status: 'ACTIVE', societyId: societyB },
      { _id: residentB, name: 'Resident B', email: `${residentB}@test`, role: 'RESIDENT', status: 'ACTIVE', societyId: societyB },
    ]);
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('creates, retrieves, updates, submits, and audits a project without approving it', async () => {
    const application = app();
    const created = await request(application, '/api/projects', managerA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        societyId: societyA.toString(),
        title: 'Roof repair',
        description: 'Repair damaged roof tiles.',
        category: 'Repairs and maintenance',
        estimatedCost: '100000.25',
      }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()).data;
    expect(project).toMatchObject({ status: 'DRAFT', societyId: societyA.toString(), estimatedCost: '100000.25' });
    expect(project).not.toHaveProperty('passwordHash');

    const updated = await request(application, `/api/projects/${project._id}`, managerA, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Roof and gutter repair' }),
    });
    expect(updated.status).toBe(200);

    const submitted = await request(application, `/api/projects/${project._id}/submit`, managerA, { method: 'POST' });
    expect(submitted.status).toBe(200);
    expect((await submitted.json()).data.status).toBe('SUBMITTED');
    expect(await AuditLog.countDocuments({ entityType: 'Project' })).toBe(3);
  });

  it('enforces society and budget relationships, blocks governed-field bypass, and validates transitions', async () => {
    const budget = await Budget.create({
      societyId: societyA,
      financialYear: '2026-2027',
      title: 'Annual',
      totalAllocated: '1000',
      totalSpent: '0',
      totalRemaining: '1000',
      status: 'DRAFT',
    });
    const application = app();
    const base = {
      societyId: societyA.toString(),
      title: 'Lift repair',
      description: 'Repair lift.',
      category: 'Repairs',
      estimatedCost: '500',
    };
    expect((await request(application, '/api/projects', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, budgetId: budget._id.toString() }),
    })).status).toBe(201);
    expect((await request(application, '/api/projects', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, title: 'Wrong society', societyId: societyB.toString() }),
    })).status).toBe(403);
    expect((await request(application, '/api/projects', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, title: 'Wrong budget', budgetId: new Types.ObjectId().toString() }),
    })).status).toBe(400);

    const project = await Project.findOne({ title: 'Lift repair' }).lean();
    expect(project).not.toBeNull();
    const bypass = await request(application, `/api/projects/${project?._id.toString()}`, managerA, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    expect(bypass.status).toBe(400);
    const start = await request(application, `/api/projects/${project?._id.toString()}/start`, managerA, { method: 'POST' });
    expect(start.status).toBe(400);
    expect((await request(application, '/api/projects', managerB)).status).toBe(200);
    expect((await request(application, `/api/projects/${project?._id.toString()}`, managerB)).status).toBe(404);
  });

  it('allows an active owner to follow society project and approval details while residents receive only discovery summaries', async () => {
    const projectA = new Types.ObjectId();
    const projectB = new Types.ObjectId();
    const building = await Building.create({ societyId: societyA, name: 'Building A', status: 'ACTIVE' });
    const flat = await Flat.create({ societyId: societyA, buildingId: building._id, flatNumber: '002', status: 'ACTIVE' });
    await Project.create([
      { _id: projectA, societyId: societyA, title: 'Lift repair', description: 'Private cost details', category: 'Maintenance', estimatedCost: '42500', approvedCost: '41000', finalCost: '42000', status: 'APPROVED', proposedBy: managerA },
      { _id: projectB, societyId: societyB, title: 'Roof repair', description: 'Other society details', category: 'Maintenance', estimatedCost: '99000', status: 'SUBMITTED', proposedBy: managerB },
    ]);
    await Ownership.create([
      { societyId: societyA, flatId: flat._id, userId: ownerA, ownershipType: 'PRIMARY', ownershipOrder: 1, status: 'ACTIVE' },
      { societyId: societyA, flatId: flat._id, userId: jointOwnerA, ownershipType: 'JOINT', ownershipOrder: 2, status: 'ACTIVE' },
      { societyId: societyB, flatId: new Types.ObjectId(), userId: ownerB, ownershipType: 'JOINT', status: 'ACTIVE' },
    ]);
    // Owners need not reside at the property. A tenant is a separate account and
    // residence record attached to the same persisted flat.
    await Residence.create({ societyId: societyA, flatId: flat._id, userId: residentA, occupancyType: 'TENANT', status: 'ACTIVE', startDate: new Date(Date.now() - 86_400_000) });
    expect(await Ownership.countDocuments({ societyId: societyA, flatId: flat._id })).toBe(2);
    expect(await Residence.countDocuments({ societyId: societyA, flatId: flat._id, status: 'ACTIVE' })).toBe(1);
    const application = app();

    const ownerRecords = (await (await request(application, '/api/projects', ownerA)).json()).data;
    expect(ownerRecords).toHaveLength(1);
    expect(ownerRecords[0]).toMatchObject({ _id: projectA.toString(), title: 'Lift repair', status: 'APPROVED', estimatedCost: '42500', approvedCost: '41000', finalCost: '42000' });
    const ownerDetail = await request(application, `/api/projects/${projectA}`, ownerA);
    expect((await ownerDetail.json()).data).toMatchObject({ _id: projectA.toString(), societyId: societyA.toString(), estimatedCost: '42500', approvedCost: '41000', finalCost: '42000' });
    expect((await request(application, `/api/projects/${projectB}`, ownerA)).status).toBe(404);
    expect((await request(application, '/api/projects', jointOwnerA)).status).toBe(200);

    // Ending a tenancy changes occupancy only; both ownership records and their
    // independent owner transparency remain intact.
    await Residence.updateOne({ societyId: societyA, flatId: flat._id, userId: residentA }, { $set: { status: 'ENDED', endDate: new Date() } });
    expect(await Ownership.countDocuments({ societyId: societyA, flatId: flat._id, status: 'ACTIVE' })).toBe(2);
    expect(await Residence.countDocuments({ societyId: societyA, flatId: flat._id, status: 'ACTIVE' })).toBe(0);
    expect((await request(application, '/api/projects', ownerA)).status).toBe(200);
    expect((await request(application, '/api/projects', jointOwnerA)).status).toBe(200);

    const residentResponse = await request(application, '/api/projects', residentA);
    expect(residentResponse.status).toBe(200);
    const residentRecords = (await residentResponse.json()).data;
    expect(residentRecords).toHaveLength(1);
    expect(residentRecords[0]).toMatchObject({ _id: projectA.toString(), title: 'Lift repair', category: 'Maintenance', status: 'APPROVED' });
    for (const privateField of ['societyId', 'description', 'estimatedCost', 'approvedCost', 'finalCost', 'proposedBy', 'approvalType', 'currentQuotationId']) {
      expect(residentRecords[0]).not.toHaveProperty(privateField);
    }

    const ownerBRecords = (await (await request(application, '/api/projects', ownerB)).json()).data;
    const residentBRecords = (await (await request(application, '/api/projects', residentB)).json()).data;
    expect(ownerBRecords).toHaveLength(1);
    expect(ownerBRecords[0]._id).toBe(projectB.toString());
    expect(residentBRecords).toHaveLength(1);
    expect(residentBRecords[0]._id).toBe(projectB.toString());
  });

  it('revokes owner transparency when the active ownership relationship ends', async () => {
    await Project.create({ societyId: societyA, title: 'Lift upgrade', description: 'Upgrade', category: 'Maintenance', estimatedCost: '1', proposedBy: managerA, status: 'APPROVED' });
    await Ownership.create({ societyId: societyA, flatId: new Types.ObjectId(), userId: ownerA, ownershipType: 'PRIMARY', status: 'ACTIVE' });
    const application = app();
    expect((await request(application, '/api/projects', ownerA)).status).toBe(200);
    await Ownership.updateOne({ userId: ownerA, societyId: societyA }, { $set: { status: 'ENDED', endDate: new Date(Date.now() - 1000) } });
    expect((await request(application, '/api/projects', ownerA)).status).toBe(404);
  });

  it('tracks authorized project progress, private completion evidence, immutable expenses, budget totals and hard-stop overruns', async () => {
    const budget = await Budget.create({ societyId: societyA, financialYear: '2026-2027', title: 'Approved works', status: 'APPROVED', totalAllocated: '100', totalSpent: '0', totalRemaining: '100' });
    const category = await BudgetCategory.create({ budgetId: budget._id, name: 'Lift maintenance', allocatedAmount: '100', spentAmount: '0', remainingAmount: '100' });
    const project = await Project.create({ societyId: societyA, title: 'Lift repair', description: 'Repair lift', category: 'Maintenance', estimatedCost: '100', approvedCost: '100', status: 'APPROVED', proposedBy: managerA, budgetId: budget._id });
    const building = await Building.create({ societyId: societyA, name: 'Ownership Building', status: 'ACTIVE' });
    const flat = await Flat.create({ societyId: societyA, buildingId: building._id, flatNumber: '001', status: 'ACTIVE' });
    await Ownership.create({ societyId: societyA, flatId: flat._id, userId: ownerA, ownershipType: 'PRIMARY', status: 'ACTIVE' });
    const application = app();
    expect((await request(application, `/api/projects/${project._id}/start`, managerA, { method: 'POST' })).status).toBe(200);
    const progressResponse = await request(application, `/api/projects/${project._id}/updates`, managerA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'PROGRESS', title: 'Site preparation', description: 'Protected work zone prepared.' }) });
    expect(progressResponse.status).toBe(201);
    const progress = (await progressResponse.json()).data;
    expect((await request(application, `/api/projects/${project._id}/updates`, residentA)).status).toBe(403);
    expect((await request(application, `/api/projects/${project._id}/updates`, managerB)).status).toBe(404);

    const expenseResponse = await request(application, '/api/expenses', managerA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id.toString(), budgetCategoryId: category._id.toString(), title: 'Replacement part', amount: '60.25', expenseDate: '2026-10-20', invoiceReference: 'INV-001' }) });
    expect(expenseResponse.status).toBe(201);
    expect(await Expense.countDocuments({ projectId: project._id })).toBe(1);
    expect(await BudgetCategory.findById(category._id).select('spentAmount remainingAmount').lean()).toMatchObject({ spentAmount: Types.Decimal128.fromString('60.25'), remainingAmount: Types.Decimal128.fromString('39.75') });
    expect(await Budget.findById(budget._id).select('totalSpent totalRemaining').lean()).toMatchObject({ totalSpent: Types.Decimal128.fromString('60.25'), totalRemaining: Types.Decimal128.fromString('39.75') });
    const rejectedOverrun = await request(application, '/api/expenses', managerA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id.toString(), budgetCategoryId: category._id.toString(), title: 'Over limit', amount: '40', expenseDate: '2026-10-21' }) });
    expect(rejectedOverrun.status).toBe(409);
    expect((await rejectedOverrun.json()).error.code).toBe('EXPENSE_LIMIT_EXCEEDED');
    expect(await Expense.countDocuments({ projectId: project._id })).toBe(1);
    const ownerExpenses = await request(application, `/api/expenses?projectId=${project._id}`, ownerA);
    expect((await ownerExpenses.json()).data.items[0]).not.toHaveProperty('invoiceReference');
    expect((await request(application, `/api/expenses?projectId=${project._id}`, residentA)).status).toBe(403);
    expect((await request(application, `/api/expenses/${(await expenseResponse.json()).data._id}`, managerB)).status).toBe(404);

    const completionResponse = await request(application, `/api/projects/${project._id}/updates`, managerA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'COMPLETION', title: 'Final inspection', description: 'Works complete; invoice reconciled.', invoiceReference: 'FINAL-INV-001' }) });
    expect(completionResponse.status).toBe(201);
    const completion = (await completionResponse.json()).data as { _id: string };
    const photoResponse = await request(application, `/api/evidence/upload?projectUpdateId=${completion._id}&category=AFTER_PHOTO`, managerA, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(photo) });
    expect(photoResponse.status).toBe(201);
    const complete = await request(application, `/api/projects/${project._id}/complete`, managerA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completionUpdateId: completion._id, finalCost: '95' }) });
    expect(complete.status).toBe(200);
    expect((await complete.json()).data).toMatchObject({ status: 'COMPLETED', finalCost: '95' });
    expect(await ProjectUpdate.countDocuments({ projectId: project._id })).toBe(2);
    expect(await Evidence.countDocuments({ relatedEntityType: 'ProjectUpdate', relatedEntityId: completion._id, category: 'AFTER_PHOTO' })).toBe(1);
    expect(await AuditLog.countDocuments({ societyId: societyA, action: { $in: ['PROJECT_STARTED', 'PROJECT_PROGRESS_UPDATED', 'PROJECT_EXPENSE_RECORDED', 'PROJECT_COMPLETION_EVIDENCE_RECORDED', 'PROJECT_COMPLETION_PHOTO_ADDED', 'PROJECT_COMPLETED'] } })).toBe(6);
  });
});
