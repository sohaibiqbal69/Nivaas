import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createApprovalRouter } from '../../src/modules/approval/approval-routes.js';
import { ApprovalDecision } from '../../src/modules/approval/models/ApprovalDecision.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { SocietyRuleVersion } from '../../src/modules/society/models/SocietyRuleVersion.js';
import { createSocietiesRouter } from '../../src/modules/society/society-routes.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'approval-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const projectA = new Types.ObjectId();
const projectB = new Types.ObjectId();
const projectC = new Types.ObjectId();
const platformAdmin = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createApprovalRouter(createAuthenticationMiddleware(() => secret)));
  application.use('/api/societies', createSocietiesRouter(undefined, createAuthenticationMiddleware(() => secret)));
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

describe('Approval Engine MongoDB integration', () => {
  beforeAll(async () => connectIntegrationTestDatabase());
  beforeEach(async () => {
    await clearIntegrationTestDatabase();
    const ruleA = new Types.ObjectId();
    const ruleB = new Types.ObjectId();
    await Society.create([
      { _id: societyA, name: 'Society A', status: 'ACTIVE', activeRuleVersionId: ruleA },
      { _id: societyB, name: 'Society B', status: 'ACTIVE', activeRuleVersionId: ruleB },
    ]);
    await User.create([
      { _id: platformAdmin, name: 'Platform Admin', email: `${platformAdmin}@test`, role: 'SYSTEM_ADMIN', status: 'ACTIVE' },
      { _id: managerA, name: 'Manager A', email: `${managerA}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyA },
      { _id: managerB, name: 'Manager B', email: `${managerB}@test`, role: 'SOCIETY_MANAGER', status: 'ACTIVE', societyId: societyB },
    ]);
    await SocietyRuleVersion.create([
      {
        _id: ruleA, societyId: societyA, versionNumber: 1, status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 1000), createdBy: managerA,
        approvalPolicy: { threshold: '100000' },
      },
      {
        _id: ruleB, societyId: societyB, versionNumber: 1, status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 1000), createdBy: managerB,
        approvalPolicy: { threshold: '200000' },
      },
    ]);
    await Project.create([
      {
        _id: projectA, societyId: societyA, title: 'A', description: 'A',
        category: 'Repairs', estimatedCost: '100000', proposedBy: managerA, status: 'SUBMITTED',
      },
      {
        _id: projectB, societyId: societyB, title: 'B', description: 'B',
        category: 'Repairs', estimatedCost: '200000.01', proposedBy: managerB, status: 'SUBMITTED',
      },
      {
        _id: projectC, societyId: societyA, title: 'C', description: 'C',
        category: 'Repairs', estimatedCost: '99999.99', proposedBy: managerA, status: 'SUBMITTED',
      },
    ]);
  });
  afterAll(async () => disconnectIntegrationTestDatabase());

  it('uses each society threshold and preserves decision snapshots', async () => {
    const application = app();
    const equal = await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' });
    expect(equal.status).toBe(201);
    expect((await equal.json()).data).toMatchObject({ approvalType: 'COMMITTEE_APPROVAL', threshold: '100000' });

    const above = await request(application, `/api/projects/${projectB}/submit-for-approval`, managerB, { method: 'POST' });
    expect(above.status).toBe(201);
    expect((await above.json()).data).toMatchObject({ approvalType: 'SGM_REQUIRED', threshold: '200000' });

    const below = await request(application, `/api/projects/${projectC}/submit-for-approval`, managerA, { method: 'POST' });
    expect(below.status).toBe(201);
    expect((await below.json()).data).toMatchObject({ approvalType: 'COMMITTEE_APPROVAL', threshold: '100000' });

    const decision = await ApprovalDecision.findOne({ projectId: projectA }).lean();
    expect(decision?.ruleSnapshot).toMatchObject({ threshold: '100000', versionNumber: 1 });
    expect(await AuditLog.countDocuments({ entityType: 'ApprovalDecision' })).toBe(3);
  });

  it('provisions one active default rule atomically when a society is created', async () => {
    const application = app();
    const response = await request(application, '/api/societies', platformAdmin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Provisioned Society' }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    const society = await Society.findOne({ name: 'Provisioned Society' }).lean();
    expect(society?._id.toString()).toBe(body.data._id);
    const rule = await SocietyRuleVersion.findOne({ societyId: society?._id }).lean();
    expect(rule).toMatchObject({ versionNumber: 1, status: 'ACTIVE', approvalPolicy: { threshold: '100000' } });
    expect(society?.activeRuleVersionId?.toString()).toBe(rule?._id.toString());
    expect(await SocietyRuleVersion.countDocuments({ societyId: society?._id, status: 'ACTIVE' })).toBe(1);
  });

  it('enforces society isolation and blocks evaluation without active configuration', async () => {
    const application = app();
    expect((await request(application, `/api/projects/${projectA}/approval`, managerB)).status).toBe(404);
    await Society.updateOne({ _id: societyA }, { $unset: { activeRuleVersionId: 1 } });
    const response = await request(application, `/api/projects/${projectA}/submit-for-approval`, managerA, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await ApprovalDecision.countDocuments({ projectId: projectA })).toBe(0);
    expect(await AuditLog.countDocuments({ entityType: 'ApprovalDecision' })).toBe(0);
  });
});
