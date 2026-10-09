import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createProjectsRouter } from '../../src/modules/project/project-routes.js';
import { Project } from '../../src/modules/project/models/Project.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Budget } from '../../src/modules/budget/models/Budget.js';
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
const admin = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createProjectsRouter(createAuthenticationMiddleware(() => secret)));
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
});
