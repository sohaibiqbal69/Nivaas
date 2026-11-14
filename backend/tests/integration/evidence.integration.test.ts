import express from 'express';
import mongoose, { Types } from 'mongoose';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../../src/modules/auth/jwt.js';
import { createAuthRouter } from '../../src/modules/auth/auth-routes.js';
import { AuthenticationService, hashPassword } from '../../src/modules/auth/authentication-service.js';
import { createUsersRouter } from '../../src/modules/users/user-routes.js';
import { User } from '../../src/modules/users/models/User.js';
import { Complaint } from '../../src/modules/complaint/models/Complaint.js';
import { ComplaintUpdate } from '../../src/modules/complaint/models/ComplaintUpdate.js';
import { Evidence } from '../../src/modules/evidence/models/Evidence.js';
import { AuditLog } from '../../src/modules/audit/models/AuditLog.js';
import { createEvidenceRouter } from '../../src/modules/evidence/evidence-routes.js';
import { EvidenceService } from '../../src/modules/evidence/evidence-service.js';
import { LocalEvidenceStorage } from '../../src/modules/evidence/local-evidence-storage.js';
import { createComplaintsRouter } from '../../src/modules/complaint/complaint-routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { connectIntegrationTestDatabase, disconnectIntegrationTestDatabase } from './mongodb-test-database.js';
import { photo } from '../evidence-fixture.js';
import { Notice } from '../../src/modules/notice/models/Notice.js';
import { createNoticesRouter } from '../../src/modules/notice/notice-routes.js';
import { NoticeEvidenceService } from '../../src/modules/evidence/notice-evidence-service.js';
import { createGovernanceRouter } from '../../src/modules/governance/governance-routes.js';

const secret = randomBytes(48).toString('hex');
const password = randomBytes(24).toString('base64url');
const society = new Types.ObjectId(); const foreign = new Types.ObjectId();
const actors = { resident: new Types.ObjectId(), manager: new Types.ObjectId(), other: new Types.ObjectId(), foreign: new Types.ObjectId() };
const directory = resolve(process.cwd(), 'uploads', `evidence-test-${randomUUID()}`);
const storage = new LocalEvidenceStorage(directory);
let server: Server; let origin: string; let complaint: string;
async function call(path: string, actor: keyof typeof actors | null, bytes?: Buffer) {
  const token = actor ? await issueAccessToken(String(actors[actor]), { secret, accessTokenTtlSeconds: 600 }) : '';
  return fetch(`${origin}/api${path}`, { method: bytes ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/octet-stream' }, ...(bytes ? { body: new Uint8Array(bytes) } : {}) });
}
const upload = (actor: keyof typeof actors | null, bytes = photo, category = 'COMPLAINT_PHOTO') => call(`/evidence/upload?complaintId=${complaint}&category=${category}`, actor, bytes);
beforeAll(async () => {
  await connectIntegrationTestDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const passwordHash = await hashPassword(password);
  await User.create(Object.entries(actors).map(([name, _id]) => ({ _id, name, email: `${_id}@evidence.example`, passwordHash, role: name === 'manager' || name === 'foreign' ? 'SOCIETY_MANAGER' : 'RESIDENT', societyId: name === 'foreign' ? foreign : society, status: 'ACTIVE' })));
  const record = await Complaint.create({ societyId: society, createdBy: actors.resident, title: 'Photo test', description: 'Repair evidence', category: 'Repair', priority: 'High', status: 'OPEN' }); complaint = String(record._id);
  const app = express(); app.use(express.json()); const auth = createAuthenticationMiddleware(() => secret);
  app.use('/api/auth', createAuthRouter(new AuthenticationService(undefined, () => ({ secret, accessTokenTtlSeconds: 600 }))));
  app.use('/api/users', createUsersRouter(undefined, auth));
  app.use('/api', createEvidenceRouter(auth, undefined, new EvidenceService(storage), new NoticeEvidenceService(storage)));
  app.use('/api', createNoticesRouter(auth));
  app.use('/api', createGovernanceRouter(auth));
  app.use('/api', createComplaintsRouter(auth)); app.use(errorHandler);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Listener unavailable'); origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await disconnectIntegrationTestDatabase(); });
const noticeDraft = () => Notice.create({ societyId: society, createdBy: actors.manager, title: 'Notice scans', description: 'Maintenance information', category: 'GENERAL', priority: 'Normal', status: 'DRAFT' });
it('notice scans enforce publication, society and expiry restrictions with transactional audit metadata', async () => {
  const notice = await noticeDraft();
  const path = `/evidence/upload?noticeId=${notice._id}&category=NOTICE_ATTACHMENT`;
  expect((await call(path, 'resident', photo)).status).toBe(403);
  expect((await call(path, 'foreign', photo)).status).toBe(404);
  expect((await call(path, null, photo)).status).toBe(401);
  expect((await call(path, 'manager', Buffer.from('<svg/>'))).status).toBe(415);
  expect((await call(path, 'manager', Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413);
  const uploaded = await call(path, 'manager', photo); expect(uploaded.status).toBe(201);
  const record = (await uploaded.json()).data;
  expect(record).not.toHaveProperty('storagePath');
  expect(await Notice.exists({ _id: notice._id, attachmentIds: record._id })).not.toBeNull();
  expect(await AuditLog.countDocuments({ action: 'NOTICE_ATTACHMENT_UPLOADED', entityId: notice._id })).toBe(1);
  expect((await call(`/evidence/${record._id}`, 'resident')).status).toBe(404);
  const token = await issueAccessToken(String(actors.manager), { secret, accessTokenTtlSeconds: 600 });
  const published = await fetch(`${origin}/api/notices/${notice._id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  expect(published.status).toBe(200);
  expect((await call(path, 'manager', photo)).status).toBe(409);
  const download = await call(`/evidence/${record._id}`, 'resident'); expect(download.status).toBe(200);
  expect(download.headers.get('cache-control')).toContain('no-store');
  expect(Buffer.from(await download.arrayBuffer())).toEqual(photo);
  expect((await call(`/evidence/${record._id}`, 'foreign')).status).toBe(404);
  const read = vi.spyOn(storage, 'read').mockResolvedValueOnce(Buffer.from('changed'));
  try { expect((await call(`/evidence/${record._id}`, 'resident')).status).toBe(409); } finally { read.mockRestore(); }
  await Notice.updateOne({ _id: notice._id }, { expiresAt: new Date(0) });
  expect((await call(`/evidence/${record._id}`, 'resident')).status).toBe(404);
});
it('notice attachment audit failure rolls back the link and evidence and removes only its staged file', async () => {
  const notice = await noticeDraft();
  const files = await readdir(directory); const count = await Evidence.countDocuments();
  const spy = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Test write failure'));
  try { expect((await call(`/evidence/upload?noticeId=${notice._id}&category=NOTICE_ATTACHMENT`, 'manager', photo)).status).toBe(503); }
  finally { spy.mockRestore(); }
  expect((await Notice.findById(notice._id))?.attachmentIds).toHaveLength(0);
  expect(await Evidence.countDocuments()).toBe(count);
  expect(await readdir(directory)).toEqual(files);
});
it('title-only complaint usability preserves the initial timeline and audit transaction', async () => {
  const token = await issueAccessToken(String(actors.resident), { secret, accessTokenTtlSeconds: 600 });
  const response = await fetch(`${origin}/api/complaints`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Lift is noisy' }) });
  expect(response.status).toBe(201); const record = (await response.json()).data;
  expect(record).toMatchObject({ title: 'Lift is noisy', description: '', category: '', priority: '', status: 'OPEN' });
  expect(await ComplaintUpdate.countDocuments({ complaintId: record._id, description: 'Complaint submitted: Lift is noisy' })).toBe(1);
  expect(await AuditLog.countDocuments({ entityId: record._id, action: 'COMPLAINT_CREATED' })).toBe(1);
});
it.runIf(process.env.NIVAAS_EVIDENCE_BROWSER === 'true')('notice usability in Chrome creates, attaches, publishes and privately downloads real scan bytes', async () => {
  const { chromium, expect: browserExpect } = await import('@playwright/test');
  const { createServer: createViteServer } = await import('vite');
  const frontend = await createViteServer({ root: resolve(process.cwd(), '../frontend'), configFile: resolve(process.cwd(), '../frontend/vite.config.ts'), define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0, proxy: { '/api': origin } } });
  let browser;
  try {
    await frontend.listen(); const address = frontend.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Frontend unavailable');
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    const manager = await browser.newPage(); const resident = await browser.newPage();
    for (const [page, actor] of [[manager, 'manager'], [resident, 'resident']] as const) {
      await page.goto(`http://127.0.0.1:${address.port}/login`);
      await page.getByLabel('Email', { exact: true }).fill(`${actors[actor]}@evidence.example`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('link', { name: 'Notice Board', exact: true }).click();
    }
    await manager.getByLabel('Title', { exact: true }).fill('Browser notice scan');
    await manager.getByLabel('Description', { exact: true }).fill('Lift inspection tomorrow');
    await manager.getByLabel('Priority label', { exact: true }).fill('Normal');
    await manager.getByRole('button', { name: 'Save notice draft', exact: true }).click();
    const card = manager.locator('section').filter({ has: manager.getByRole('heading', { name: 'Browser notice scan', exact: true }) });
    await browserExpect(card).toBeVisible();
    const form = card.getByRole('form', { name: 'Attach notice scan' });
    await form.locator('input[type=file]').setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('MZ executable') });
    await form.getByRole('button', { name: 'Attach scan', exact: true }).click();
    await browserExpect(card.getByRole('alert')).toContainText('Upload a complete JPEG or PNG');
    await form.locator('input[type=file]').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: photo });
    const uploadResponse = manager.waitForResponse(response => response.url().includes('/evidence/upload') && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Attach scan', exact: true }).click();
    expect((await uploadResponse).status()).toBe(201);
    await browserExpect(card.getByRole('status')).toContainText('Attachment saved.');
    await card.getByRole('button', { name: 'Publish notice', exact: true }).click();
    await browserExpect(card.getByText('PUBLISHED', { exact: true })).toBeVisible();
    await browserExpect(card.getByRole('form', { name: 'Attach notice scan' })).toHaveCount(0);
    await resident.reload();
    const readerCard = resident.locator('section').filter({ has: resident.getByRole('heading', { name: 'Browser notice scan', exact: true }) });
    const downloadEvent = resident.waitForEvent('download');
    await readerCard.getByRole('button', { name: 'Download scan 1', exact: true }).click();
    const downloaded = await downloadEvent;
    expect(await downloaded.failure()).toBeNull(); expect(downloaded.suggestedFilename()).toMatch(/^[a-f0-9]{24}\.png$/);
    expect(await Evidence.countDocuments({ relatedEntityType: 'Notice', category: 'NOTICE_ATTACHMENT' })).toBeGreaterThan(0);
    await resident.getByRole('link', { name: 'Voting', exact: true }).click();
    await browserExpect(resident.getByText('Voting is not currently available', { exact: true })).toBeVisible();
  } finally { await browser?.close(); await frontend.close(); }
}, 60000);
it('stores private evidence, links its timeline/audit metadata and authorizes verified downloads', async () => {
  const response = await upload('resident'); expect(response.status).toBe(201);
  const record = (await response.json()).data;
  expect(record).not.toHaveProperty('storagePath');
  expect(await Evidence.countDocuments({ _id: record._id })).toBe(1);
  expect(await ComplaintUpdate.countDocuments({ complaintId: complaint, evidenceIds: record._id })).toBe(1);
  expect(await AuditLog.countDocuments({ action: 'COMPLAINT_EVIDENCE_UPLOADED', entityId: complaint })).toBe(1);
  for (const actor of ['resident', 'manager'] as const) {
    const download = await call(`/evidence/${record._id}`, actor); expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment;'); expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await download.arrayBuffer()).equals(photo)).toBe(true);
  }
  for (const actor of ['other', 'foreign'] as const) expect((await call(`/evidence/${record._id}`, actor)).status).toBe(404);
  expect((await call(`/evidence/${record._id}`, null)).status).toBe(401);
  const detail = await (await call(`/complaints/${complaint}`, 'resident')).json();
  expect(detail.data.evidence).toHaveLength(1); expect(detail.data.evidence[0]).not.toHaveProperty('storagePath');
});
it('rejects unauthorized, executable, oversized and traversal submissions without persistence', async () => {
  const count = await Evidence.countDocuments();
  expect((await upload(null)).status).toBe(401);
  expect((await upload('other')).status).toBe(404); expect((await upload('foreign')).status).toBe(404);
  expect((await upload('resident', Buffer.from('MZ malicious.exe'))).status).toBe(415);
  expect((await upload('resident', Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413);
  expect((await call('/evidence/upload?complaintId=..%2F..%2F.env&category=COMPLAINT_PHOTO', 'resident', photo)).status).toBe(400);
  expect(await Evidence.countDocuments()).toBe(count);
});
it('rolls back metadata/timeline and removes staged files when persistence fails', async () => {
  const counts = [await Evidence.countDocuments(), await ComplaintUpdate.countDocuments(), await AuditLog.countDocuments()];
  const files = await readdir(directory);
  const spy = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Simulated database failure'));
  try { expect((await upload('resident')).status).toBe(503); } finally { spy.mockRestore(); }
  expect([await Evidence.countDocuments(), await ComplaintUpdate.countDocuments(), await AuditLog.countDocuments()]).toEqual(counts);
  expect(await readdir(directory)).toEqual(files);
});
it('does not record evidence on a filesystem failure', async () => {
  const count = await Evidence.countDocuments();
  const spy = vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('Simulated disk failure'));
  try { expect((await upload('resident')).status).toBe(503); } finally { spy.mockRestore(); }
  expect(await Evidence.countDocuments()).toBe(count);
});
it('refuses a download whose bytes no longer match the immutable hash', async () => {
  const record = await Evidence.findOne({ relatedEntityId: complaint });
  const spy = vi.spyOn(storage, 'read').mockResolvedValueOnce(Buffer.from('changed'));
  try { expect((await call(`/evidence/${record!._id}`, 'resident')).status).toBe(409); } finally { spy.mockRestore(); }
});
it('allows manager repair/resolution photos without changing the complaint state', async () => {
  await Complaint.updateOne({ _id: complaint }, { status: 'IN_PROGRESS' });
  expect((await upload('manager', photo, 'PROGRESS_PHOTO')).status).toBe(201);
  expect((await upload('manager', photo, 'AFTER_PHOTO')).status).toBe(201);
  expect((await upload('resident')).status).toBe(409);
  expect((await Complaint.findById(complaint))?.status).toBe('IN_PROGRESS');
});

it.runIf(process.env.NIVAAS_EVIDENCE_BROWSER === 'true')('uploads real PNG/JPEG bytes and downloads authorized evidence through Chrome', async () => {
  const { chromium, expect: browserExpect } = await import('@playwright/test');
  const { createServer: createViteServer } = await import('vite');
  await Complaint.create({ societyId: society, createdBy: actors.resident, title: 'Browser evidence', description: 'Photos for repair', category: 'Repair', priority: 'High', status: 'OPEN' });
  const frontend = await createViteServer({ root: resolve(process.cwd(), '../frontend'), configFile: resolve(process.cwd(), '../frontend/vite.config.ts'), define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0, proxy: { '/api': origin } } });
  let browser;
  try {
    await frontend.listen(); const address = frontend.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Frontend unavailable');
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    const resident = await browser.newPage(); const manager = await browser.newPage();
    for (const [page, actor] of [[resident, 'resident'], [manager, 'manager']] as const) {
      await page.goto(`http://127.0.0.1:${address.port}/login`);
      await page.getByLabel('Email', { exact: true }).fill(`${actors[actor]}@evidence.example`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('link', { name: 'Complaints', exact: true }).click();
      await page.getByRole('button', { name: 'View complaint: Browser evidence', exact: true }).click();
    }
    const jpeg = await resident.screenshot({ type: 'jpeg' });
    for (const [name, bytes] of [['untrusted.exe', photo], ['photo.jpg', jpeg]] as const) {
      const form = resident.getByRole('form', { name: 'Upload complaint evidence' });
      await form.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
      const uploaded = resident.waitForResponse(response => response.url().includes('/evidence/upload') && response.request().method() === 'POST');
      await form.getByRole('button', { name: 'Upload photo', exact: true }).click();
      expect((await uploaded).status()).toBe(201);
      await browserExpect(resident.getByText('Photo evidence saved and recorded in the complaint timeline.', { exact: true })).toBeVisible();
      await resident.getByRole('form', { name: 'Upload complaint evidence' }).waitFor();
    }
    const form = resident.getByRole('form', { name: 'Upload complaint evidence' });
    await form.locator('input[type=file]').setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('MZ executable') });
    await form.getByRole('button', { name: 'Upload photo', exact: true }).click();
    await browserExpect(resident.getByRole('alert')).toContainText('Upload a complete JPEG or PNG');
    await manager.reload(); await manager.getByRole('button', { name: 'View complaint: Browser evidence', exact: true }).click();
    const downloadEvent = manager.waitForEvent('download');
    await manager.getByRole('button', { name: /^Download .*\.png$/ }).click();
    const downloaded = await downloadEvent;
    expect(downloaded.suggestedFilename()).toMatch(/^[a-f0-9]{24}\.png$/);
    expect(await downloaded.failure()).toBeNull();
  } finally { await browser?.close(); await frontend.close(); }
}, 60000);
