import express from 'express';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createBudgetsRouter } from '../../src/modules/budget/budget-routes.js';
import { Budget } from '../../src/modules/budget/models/Budget.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { User } from '../../src/modules/users/models/User.js';
import {
  clearIntegrationTestDatabase,
  connectIntegrationTestDatabase,
  disconnectIntegrationTestDatabase,
} from './mongodb-test-database.js';

const secret = 'budget-integration-tests-use-a-secret-32-bytes';
const societyA = new Types.ObjectId();
const societyB = new Types.ObjectId();
const managerA = new Types.ObjectId();
const managerB = new Types.ObjectId();
const admin = new Types.ObjectId();

function app() {
  const application = express();
  application.use(express.json());
  application.use('/api', createBudgetsRouter(
    createAuthenticationMiddleware(() => secret),
  ));
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

describe('Budget MongoDB integration', () => {
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

  it('creates a budget and recalculates totals from persisted items', async () => {
    const application = app();
    const created = await request(application, '/api/budgets', managerA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyA.toString(), financialYear: '2026-2027', title: 'Annual Budget' }),
    });
    expect(created.status).toBe(201);
    const budget = (await created.json()).data;
    expect(budget).toMatchObject({ societyId: societyA.toString(), status: 'DRAFT', totalAllocated: '0' });

    const item = await request(application, `/api/budgets/${budget._id}/categories`, managerA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Security', allocatedAmount: '100.10', spentAmount: '20.05' }),
    });
    expect(item.status).toBe(201);

    const details = await request(application, `/api/budgets/${budget._id}`, managerA);
    expect(details.status).toBe(200);
    expect((await details.json()).data).toMatchObject({
      totalAllocated: '100.1',
      totalSpent: '20.05',
      totalRemaining: '80.05',
      categories: [{ allocatedAmount: '100.1', spentAmount: '20.05', remainingAmount: '80.05' }],
    });
    expect(await AuditLog.countDocuments({ societyId: societyA })).toBe(2);
  });

  it('enforces society scope, validation, duplicate annual budgets, and authorization', async () => {
    const application = app();
    const body = { societyId: societyA.toString(), financialYear: '2026-2027', title: 'Annual Budget' };
    expect((await request(application, '/api/budgets', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).status).toBe(201);
    expect((await request(application, '/api/budgets', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).status).toBe(400);
    expect((await request(application, '/api/budgets', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, societyId: societyB.toString(), financialYear: '2027-2028' }),
    })).status).toBe(403);
    expect((await request(application, '/api/budgets', admin, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, societyId: societyB.toString(), financialYear: '2027-2028' }),
    })).status).toBe(201);
    expect((await request(application, '/api/budgets', managerA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, financialYear: '2026-2028' }),
    })).status).toBe(400);
    expect((await request(application, '/api/budgets', managerB)).status).toBe(200);
  });

  it('rejects invalid monetary precision and keeps totals authoritative during item updates', async () => {
    const application = app();
    const created = await request(application, '/api/budgets', managerA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId: societyA.toString(), financialYear: '2026-2027', title: 'Annual Budget' }),
    });
    const budgetId = (await created.json()).data._id as string;

    for (const allocatedAmount of ['-1', '1.12345678901234567890123456789012345', 'NaN']) {
      const response = await request(application, `/api/budgets/${budgetId}/categories`, managerA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid', allocatedAmount }),
      });
      expect(response.status).toBe(400);
    }

    const item = await request(application, `/api/budgets/${budgetId}/categories`, managerA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Security', allocatedAmount: '100', spentAmount: '20' }),
    });
    const itemId = (await item.json()).data._id as string;
    const update = await request(application, `/api/budget-categories/${itemId}`, managerA, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spentAmount: '35', totalAllocated: '999999' }),
    });
    expect(update.status).toBe(400);

    const validUpdate = await request(application, `/api/budget-categories/${itemId}`, managerA, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spentAmount: '35' }),
    });
    expect(validUpdate.status).toBe(200);
    const details = await request(application, `/api/budgets/${budgetId}`, managerA);
    expect((await details.json()).data).toMatchObject({
      totalAllocated: '100',
      totalSpent: '35',
      totalRemaining: '65',
    });
  });

  it('blocks edits after draft/rejected lifecycle states and rejects concurrent duplicate budgets', async () => {
    const application = app();
    const body = { societyId: societyA.toString(), financialYear: '2026-2027', title: 'Annual Budget' };
    const responses = await Promise.all([
      request(application, '/api/budgets', managerA, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
      request(application, '/api/budgets', managerA, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);

    const budget = await (await request(application, '/api/budgets', managerA)).json();
    const budgetId = budget.data[0]._id as string;
    await Budget.updateOne({ _id: budgetId }, { $set: { status: 'SUBMITTED' } });
    const update = await request(application, `/api/budgets/${budgetId}`, managerA, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should fail' }),
    });
    expect(update.status).toBe(400);
  });
});
