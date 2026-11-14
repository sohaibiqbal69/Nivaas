import express from 'express';
import { createServer, type Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { createAuthRouter } from '../../src/modules/auth/auth-routes.js';
import { AuthenticationService, hashPassword } from '../../src/modules/auth/authentication-service.js';
import { createUsersRouter } from '../../src/modules/users/user-routes.js';
import { User } from '../../src/modules/users/models/User.js';
import { Society } from '../../src/modules/society/models/Society.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { Complaint } from '../../src/modules/complaint/models/Complaint.js';
import { ComplaintUpdate } from '../../src/modules/complaint/models/ComplaintUpdate.js';
import { createComplaintsRouter } from '../../src/modules/complaint/complaint-routes.js';
import { connectIntegrationTestDatabase, disconnectIntegrationTestDatabase } from './mongodb-test-database.js';

const secret = randomBytes(48).toString('hex');
const password = randomBytes(24).toString('base64url');
const society = new Types.ObjectId();
const foreignSociety = new Types.ObjectId();
const actors = { resident: new Types.ObjectId(), owner: new Types.ObjectId(), manager: new Types.ObjectId(), foreign: new Types.ObjectId(), admin: new Types.ObjectId(), committee: new Types.ObjectId() };
let server: Server;
let origin: string;
const input = { title: 'Leaking pipe', description: 'Water leaking near the stairs.', category: 'Maintenance', priority: 'High' };
async function request(path: string, actor: keyof typeof actors, body?: unknown) {
  const token = await issueAccessToken(actors[actor].toString(), { secret, accessTokenTtlSeconds: 300 });
  const response = await fetch(`${origin}/api/complaints${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function create() {
  const response = await request('', 'resident', input);
  expect(response.status).toBe(201);
  return response.body.data._id as string;
}
beforeAll(async () => {
  await connectIntegrationTestDatabase();
  // No collection cleanup. Each test uses fresh records in the explicitly confirmed target.
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await Society.create([{ _id: society, name: 'Complaint test society', status: 'ACTIVE' }, { _id: foreignSociety, name: 'Other society', status: 'ACTIVE' }]);
  const roles = { resident: 'RESIDENT', owner: 'OWNER_MEMBER', manager: 'SOCIETY_MANAGER', foreign: 'SOCIETY_MANAGER', admin: 'SYSTEM_ADMIN', committee: 'COMMITTEE_MEMBER' };
  const passwordHash = await hashPassword(password);
  await User.create(Object.entries(actors).map(([name, _id]) => ({ _id, name, email: `${_id}@complaint.example`, passwordHash, societyId: name === 'admin' ? null : name === 'foreign' ? foreignSociety : society, role: roles[name as keyof typeof roles], status: 'ACTIVE' })));
  const app = express(); app.use(express.json());
  const auth = createAuthenticationMiddleware(() => secret);
  app.use('/api/auth', createAuthRouter(new AuthenticationService(undefined, () => ({ secret, accessTokenTtlSeconds: 600 }))));
  app.use('/api/users', createUsersRouter(undefined, auth));
  app.use('/api', createComplaintsRouter(auth)); app.use(errorHandler);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await disconnectIntegrationTestDatabase(); });

it('persists and audits the resident-to-manager resolution workflow', async () => {
  const id = await create();
  for (const [action, status] of [['acknowledge', 'ACKNOWLEDGED'], ['update', 'IN_PROGRESS'], ['resolve', 'RESOLVED']]) {
    const result = await request(`/${id}/${action}`, 'manager', { description: `${action} note` });
    expect(result.status).toBe(200); expect(result.body.data.status).toBe(status);
  }
  const detail = await request(`/${id}`, 'resident');
  expect(detail.status).toBe(200); expect(detail.body.data.updates).toHaveLength(4);
  expect(detail.body.data.status).toBe('RESOLVED'); expect(detail.body.data.resolvedAt).toBeTruthy();
  expect(await AuditLog.countDocuments({ entityId: id })).toBe(4);
  expect(await ComplaintUpdate.countDocuments({ complaintId: id })).toBe(4);
});
it('isolates creators and societies and denies unauthorized operational roles', async () => {
  const id = await create();
  expect((await request(`/${id}`, 'owner')).status).toBe(404);
  expect((await request(`/${id}`, 'foreign')).status).toBe(404);
  expect((await request(`/${id}/acknowledge`, 'foreign', { description: 'Denied' })).status).toBe(404);
  expect((await request(`/${id}/acknowledge`, 'resident', { description: 'Denied' })).status).toBe(403);
  expect((await request('', 'owner')).body.data.items).toHaveLength(0);
  for (const role of ['manager', 'admin', 'committee'] as const) expect((await request('', role, input)).status).toBe(403);
  expect((await request('', 'resident', { ...input, societyId: foreignSociety.toString() })).status).toBe(400);
  expect((await request('?societyId=foreign', 'manager')).status).toBe(400);
});
it('rejects invalid states and appends exactly one concurrent resolution', async () => {
  const id = await create();
  expect((await request(`/${id}/resolve`, 'manager', { description: 'Too early' })).status).toBe(409);
  expect((await request(`/${id}/acknowledge`, 'manager', { description: '' })).status).toBe(400);
  await request(`/${id}/acknowledge`, 'manager', { description: 'Accepted' });
  await request(`/${id}/update`, 'manager', { description: 'Work begun' });
  const results = await Promise.all([1, 2].map(() => request(`/${id}/resolve`, 'manager', { description: 'Repaired' })));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect(await AuditLog.countDocuments({ entityId: id, action: 'COMPLAINT_RESOLVED' })).toBe(1);
  expect((await request(`/${id}/update`, 'manager', { description: 'Late mutation' })).status).toBe(409);
});
it('rolls back state and timeline if the audit write fails', async () => {
  const id = await create();
  const failure = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Test audit storage failure'));
  try { expect((await request(`/${id}/acknowledge`, 'manager', { description: 'Accepted' })).status).toBe(500); } finally { failure.mockRestore(); }
  expect((await Complaint.findById(id))?.status).toBe('OPEN');
  expect(await ComplaintUpdate.countDocuments({ complaintId: id })).toBe(1);
});
it('prevents timeline mutation through normal model operations', async () => {
  const id = await create();
  await expect(ComplaintUpdate.updateMany({ complaintId: id }, { description: 'Replacement' })).rejects.toThrow('append-only');
  await expect(ComplaintUpdate.deleteMany({ complaintId: id })).rejects.toThrow('append-only');
  expect(await ComplaintUpdate.countDocuments({ complaintId: id })).toBe(1);
});

it.runIf(process.env.NIVAAS_COMPLAINT_BROWSER === 'true')('completes resident submission and manager resolution through the real browser', async () => {
  const { chromium, expect: browserExpect } = await import('@playwright/test');
  const { createServer: createViteServer } = await import('vite');
  const frontend = await createViteServer({ root: resolve(process.cwd(), '../frontend'), configFile: resolve(process.cwd(), '../frontend/vite.config.ts'), define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0, proxy: { '/api': origin } } });
  let browser;
  try {
    await frontend.listen();
    const address = frontend.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Frontend listener unavailable');
    const frontendOrigin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    const resident = await browser.newPage(); const manager = await browser.newPage();
    for (const [page, id] of [[resident, actors.resident], [manager, actors.manager]] as const) {
      await page.goto(`${frontendOrigin}/login`);
      await page.getByLabel('Email', { exact: true }).fill(`${id}@complaint.example`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('link', { name: 'Complaints', exact: true }).click();
    }
    const form = resident.getByRole('form', { name: 'Raise a complaint' });
    for (const [label, value] of Object.entries({ Title: 'Browser corridor leak', Category: 'Maintenance', Priority: 'High', Description: 'Water beside the staircase.' })) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Submit complaint' }).click();
    await browserExpect(resident.getByText('Complaint submitted. Your society manager can now acknowledge it.', { exact: true })).toBeVisible();
    const stored = await Complaint.findOne({ title: 'Browser corridor leak', createdBy: actors.resident });
    expect(stored?.status).toBe('OPEN');
    await manager.reload();
    await manager.getByRole('button', { name: 'View complaint: Browser corridor leak', exact: true }).click();
    for (const [button, note] of [['Acknowledge', 'Inspection booked'], ['Record progress', 'Pipe repaired and tested'], ['Mark resolved', 'Corridor dry; repair completed']]) {
      await manager.getByLabel('Progress or resolution note', { exact: true }).fill(note);
      const saved = manager.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/complaints/${stored!._id}/`));
      await manager.getByRole('button', { name: button, exact: true }).click();
      expect((await saved).status()).toBe(200);
      await browserExpect(manager.getByRole('list', { name: 'Complaint timeline' }).getByText(note, { exact: true })).toBeVisible();
    }
    await resident.reload();
    await resident.getByRole('button', { name: 'View complaint: Browser corridor leak', exact: true }).click();
    await browserExpect(resident.getByRole('list', { name: 'Complaint timeline' }).getByText('Corridor dry; repair completed', { exact: true })).toBeVisible();
    await browserExpect(resident.getByText(/this complaint is not marked CLOSED/)).toBeVisible();
    expect((await Complaint.findById(stored!._id))?.status).toBe('RESOLVED');
  } finally { await browser?.close(); await frontend.close(); }
}, 60000);
