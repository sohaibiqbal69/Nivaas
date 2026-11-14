import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { createAuthenticationMiddleware } from '../../src/modules/auth/authentication-middleware.js';
import { AuthenticationService } from '../../src/modules/auth/authentication-service.js';
import { createAuthRouter } from '../../src/modules/auth/auth-routes.js';
import { generateSetupCredential } from '../../src/modules/auth/credential.js';
import { createPendingUserWithCredential } from '../../src/modules/users/pending-user-provisioning.js';
import { createUsersRouter } from '../../src/modules/users/user-routes.js';
import { createSocietiesRouter } from '../../src/modules/society/society-routes.js';
import { createPropertyRouter } from '../../src/modules/property/property-routes.js';
import { createOwnershipResidenceRouter } from '../../src/modules/property/ownership-residence-routes.js';
import { createMembershipsRouter } from '../../src/modules/membership/membership-routes.js';
import { User } from '../../src/modules/users/models/User.js';
import { AccountSetupCredential } from '../../src/modules/auth/models/AccountSetupCredential.js';
import { Membership } from '../../src/modules/membership/models/Membership.js';
import { Ownership } from '../../src/modules/property/models/Ownership.js';
import { Residence } from '../../src/modules/property/models/Residence.js';
import { Flat } from '../../src/modules/property/models/Flat.js';
import { Building } from '../../src/modules/property/models/Building.js';
import { connectIntegrationTestDatabase, disconnectIntegrationTestDatabase } from './mongodb-test-database.js';

// Real repositories/transactions; only configuration is injected. No cleanup is
// performed: require a fresh disposable target so existing records are untouched.
const secret = randomBytes(48).toString('hex');
const password = randomBytes(24).toString('base64url');
let server: Server;
let origin: string;
let adminToken: string;
let managerToken: string;
let society: string;
let foreignSociety: string;
let flat: string;
let buildingId: string;
let managerEmail: string;
const adminEmail = 'admin@onboarding.example';
let ownerId: string;
const authenticate = createAuthenticationMiddleware(() => secret);

async function api(path: string, token?: string, body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function create(path: string, token: string, body: unknown) {
  const result = await api(path, token, body);
  expect(result.status, `${path}: ${result.body.error?.message ?? ''}`).toBe(201);
  return result.body.data;
}
async function activate(account: { setupCredential: string; email: string }) {
  expect((await api('/auth/setup', undefined, { credential: account.setupCredential, newPassword: password })).status).toBe(200);
  expect((await api('/auth/setup', undefined, { credential: account.setupCredential, newPassword: password })).status).toBe(401);
  const login = await api('/auth/login', undefined, { email: account.email, password });
  expect(login.status).toBe(200);
  return login.body.data.token as string;
}

beforeAll(async () => {
  await connectIntegrationTestDatabase();
  for (const collection of await mongoose.connection.db!.collections()) {
    if (!collection.collectionName.startsWith('system.') && await collection.countDocuments() > 0) {
      throw new Error('Onboarding verification requires a fresh empty disposable database; existing data will not be removed.');
    }
  }
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const application = express();
  application.use(express.json());
  application.use('/api/auth', createAuthRouter(new AuthenticationService(undefined, () => ({ secret, accessTokenTtlSeconds: 600 }))));
  application.use('/api/users', createUsersRouter(undefined, authenticate, undefined, { enabled: true }));
  application.use('/api/no-delivery/users', createUsersRouter(undefined, authenticate, undefined, { enabled: false }));
  application.use('/api/societies', createSocietiesRouter(undefined, authenticate));
  application.use('/api', createPropertyRouter(undefined, authenticate));
  application.use('/api', createOwnershipResidenceRouter(undefined, authenticate));
  application.use('/api/memberships', createMembershipsRouter(undefined, authenticate));
  application.use(errorHandler);
  server = createServer(application);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  const credential = generateSetupCredential();
  await createPendingUserWithCredential({ societyId: null, name: 'Isolated test admin', email: adminEmail, role: 'SYSTEM_ADMIN', status: 'PENDING_SETUP' }, credential);
  adminToken = await activate({ email: adminEmail, setupCredential: credential.rawCredential });
}, 30000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await disconnectIntegrationTestDatabase();
});

it('persists supported admin provisioning and manager onboarding, setup and separate relationships', async () => {
  society = (await create('/societies', adminToken, { name: 'Isolated onboarding society' }))._id;
  foreignSociety = (await create('/societies', adminToken, { name: 'Isolation control society' }))._id;
  const building = await create('/buildings', adminToken, { societyId: society, name: 'A', status: 'ACTIVE' });
  buildingId = building._id;
  flat = (await create('/flats', adminToken, { societyId: society, buildingId, flatNumber: '101', status: 'ACTIVE' }))._id;
  managerEmail = 'manager@onboarding.example';
  const manager = await create('/users', adminToken, { societyId: society, name: 'Onboarding manager', email: managerEmail, role: 'SOCIETY_MANAGER' });
  managerToken = await activate(manager);
  const newFlat = await api('/flats', managerToken, { buildingId, flatNumber: '002', status: 'ACTIVE' });
  expect(newFlat.status).toBe(201);
  expect(newFlat.body.data).toMatchObject({ societyId: society, buildingId, flatNumber: '002' });
  const duplicate = await api('/flats', managerToken, { buildingId, flatNumber: '002', status: 'ACTIVE' });
  expect(duplicate.status).toBe(409);
  const secondBuilding = await create('/buildings', adminToken, { societyId: society, name: 'B', status: 'ACTIVE' });
  const sameNumberInOtherBuilding = await api('/flats', managerToken, { buildingId: secondBuilding._id, flatNumber: '002', status: 'ACTIVE' });
  expect(sameNumberInOtherBuilding.status).toBe(201);
  const codedBuilding = await create('/buildings', adminToken, { societyId: society, name: 'Coded', buildingCode: 'C', status: 'ACTIVE' });
  const duplicateBuildingCode = await api('/buildings', adminToken, { societyId: society, name: 'Another building', buildingCode: codedBuilding.buildingCode, status: 'ACTIVE' });
  expect(duplicateBuildingCode.status).toBe(409);
  expect(duplicateBuildingCode.body.error.code).toBe('BUILDING_CODE_ALREADY_EXISTS');
  const racingDuplicates = await Promise.all([
    api('/flats', managerToken, { buildingId, flatNumber: '0101', status: 'ACTIVE' }),
    api('/flats', managerToken, { buildingId, flatNumber: '0101', status: 'ACTIVE' }),
  ]);
  expect(racingDuplicates.map(result => result.status).sort()).toEqual([201, 409]);
  for (const role of ['OWNER_MEMBER', 'RESIDENT', 'COMMITTEE_MEMBER']) {
    const account = await create('/users/society', managerToken, { name: role, email: `${role.toLowerCase()}@onboarding.example`, role });
    expect(account.status).toBe('PENDING_SETUP');
    expect(account.societyId).toBe(society);
    const stored = await AccountSetupCredential.findOne({ userId: account._id }).lean();
    expect(stored).toBeTruthy();
    expect(stored!.credentialHash === account.setupCredential).toBe(false);
    const memberToken = await activate(account);
    expect((await api('/users/society', memberToken, { name: 'Denied', email: 'denied@onboarding.example', role: 'RESIDENT' })).status).toBe(403);
    expect(await Membership.countDocuments({ userId: account._id })).toBe(0);
    if (role === 'OWNER_MEMBER') {
      ownerId = account._id;
      await create(`/flats/${flat}/ownerships`, managerToken, { userId: account._id, ownershipType: 'PRIMARY', status: 'ACTIVE' });
      await create('/memberships', managerToken, { societyId: society, userId: account._id, unitId: flat, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' });
    }
    if (role === 'RESIDENT') {
      await create(`/flats/${flat}/residents`, managerToken, { userId: account._id, occupancyType: 'TENANT', status: 'ACTIVE' });
      expect(await Membership.countDocuments({ userId: account._id })).toBe(0);
    }
  }
  const jointOwner = await create('/users/society', managerToken, { name: 'Joint owner', email: 'joint-owner@onboarding.example', role: 'OWNER_MEMBER' });
  const jointOwnership = await create(`/flats/${flat}/ownerships`, managerToken, { userId: jointOwner._id, ownershipType: 'JOINT', ownershipOrder: 2, status: 'ACTIVE' });
  expect(jointOwnership).toMatchObject({ flatId: flat, userId: jointOwner._id, ownershipType: 'JOINT', ownershipOrder: 2 });
  expect(await Ownership.countDocuments({ flatId: flat })).toBe(2);
  expect(await Residence.countDocuments()).toBe(1);
  expect(await Membership.countDocuments()).toBe(1);
  const listing = await api('/users/society', managerToken);
  expect(listing.status).toBe(200);
  for (const record of listing.body.data) {
    expect(record.societyId).toBe(society);
    for (const key of ['setupCredential', 'credentialHash', 'passwordHash']) expect(record).not.toHaveProperty(key);
  }
  const indexes = await User.collection.indexes();
  expect(indexes.some(index => index.unique && index.key.email === 1)).toBe(true);
  const membershipIndexes = await Membership.collection.indexes();
  expect(membershipIndexes.some(index => index.unique && index.key.societyId === 1 && index.key.userId === 1 && index.key.unitId === 1 && index.partialFilterExpression?.membershipStatus === 'ACTIVE')).toBe(true);
  const credentialIndexes = await AccountSetupCredential.collection.indexes();
  expect(credentialIndexes.some(index => index.unique && index.key.credentialHash === 1)).toBe(true);
  const flatIndexes = await Flat.collection.indexes();
  expect(flatIndexes.some(index => index.unique && index.key.buildingId === 1 && index.key.flatNumber === 1)).toBe(true);
  const buildingIndexes = await Building.collection.indexes();
  expect(buildingIndexes.some(index => index.unique && index.key.societyId === 1 && index.key.buildingCode === 1
    && index.partialFilterExpression?.buildingCode?.$type === 'string' && !index.sparse)).toBe(true);
}, 30000);

it('rejects escalation, cross-society access, duplicates and unavailable delivery without orphan credentials', async () => {
  const beforeUsers = await User.countDocuments();
  const beforeCredentials = await AccountSetupCredential.countDocuments();
  for (const body of [
    { role: 'SYSTEM_ADMIN' }, { role: 'SOCIETY_MANAGER' }, { role: 'RESIDENT', societyId: foreignSociety },
  ]) expect((await api('/users/society', managerToken, { name: 'Denied', email: 'denied@onboarding.example', ...body })).status).toBe(400);
  expect((await api('/users/society', managerToken, { name: 'Duplicate', email: 'owner_member@onboarding.example', role: 'RESIDENT' })).status).toBe(409);
  expect((await api('/no-delivery/users/society', managerToken, { name: 'Undeliverable', email: 'delivery@onboarding.example', role: 'RESIDENT' })).status).toBe(503);
  expect((await api(`/memberships?societyId=${foreignSociety}`, managerToken)).status).toBe(403);
  expect((await api('/memberships', managerToken, { societyId: foreignSociety, userId: ownerId, unitId: flat, membershipType: 'PRIMARY', membershipStatus: 'ACTIVE' })).status).toBe(403);
  expect((await api('/buildings', managerToken, { societyId: society, name: 'Denied', status: 'ACTIVE' })).status).toBe(403);
  const foreignBuilding = await create('/buildings', adminToken, { societyId: foreignSociety, name: 'Foreign', status: 'ACTIVE' });
  const foreignFlat = await create('/flats', adminToken, { societyId: foreignSociety, buildingId: foreignBuilding._id, flatNumber: '201', status: 'ACTIVE' });
  expect((await api('/flats', managerToken, { buildingId: foreignBuilding._id, flatNumber: '202', status: 'ACTIVE' })).status).toBe(400);
  expect((await api(`/flats/${foreignFlat._id}/ownerships`, managerToken, { userId: ownerId, ownershipType: 'PRIMARY', status: 'ACTIVE' })).status).toBe(403);
  expect((await api(`/flats/${foreignFlat._id}/residents`, managerToken)).status).toBe(403);
  expect(await User.countDocuments()).toBe(beforeUsers);
  expect(await AccountSetupCredential.countDocuments()).toBe(beforeCredentials);
});

it('rolls back user creation when credential persistence fails', async () => {
  const credential = generateSetupCredential();
  await expect(createPendingUserWithCredential({ societyId: society, name: 'Rollback', email: 'rollback@onboarding.example', role: 'RESIDENT', status: 'PENDING_SETUP' }, { credentialHash: credential.credentialHash, expiresAt: undefined as unknown as Date })).rejects.toThrow();
  expect(await User.exists({ email: 'rollback@onboarding.example' })).toBeNull();
});

it.runIf(process.env.NIVAAS_ONBOARDING_BROWSER === 'true')('uses the real Members & Flats browser form against the isolated API and MongoDB', async () => {
  const { chromium } = await import('@playwright/test');
  const { createServer: createViteServer } = await import('vite');
  const frontend = await createViteServer({
    root: resolve(process.cwd(), '../frontend'),
    configFile: resolve(process.cwd(), '../frontend/vite.config.ts'),
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': origin } },
  });
  let browser;
  try {
    await frontend.listen();
    const address = frontend.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Frontend listener unavailable');
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/login`);
    await page.getByLabel('Email', { exact: true }).fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Societies', exact: true }).click();

    const createdBuildings: Record<string, string> = {};
    for (const buildingName of ['Browser Building A', 'Browser Building B']) {
      await page.getByRole('button', { name: `Add building to Isolated onboarding society`, exact: true }).click();
      const buildingForm = page.getByRole('form', { name: 'Add building to Isolated onboarding society' });
      await buildingForm.getByLabel('Building name *').fill(buildingName);
      await buildingForm.getByLabel('Building code (optional)').fill('');
      const creatingBuilding = page.waitForResponse((response) => response.url().endsWith('/api/buildings') && response.request().method() === 'POST');
      await buildingForm.getByRole('button', { name: 'Create building', exact: true }).click();
      const buildingResponse = await creatingBuilding;
      expect(buildingResponse.status()).toBe(201);
      const persisted = (await buildingResponse.json()).data;
      expect(persisted.buildingCode).toBeUndefined();
      createdBuildings[buildingName] = persisted._id;
    }
    expect(await Building.countDocuments({ _id: { $in: Object.values(createdBuildings) }, societyId: society, buildingCode: { $exists: false } })).toBe(2);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto(`http://127.0.0.1:${address.port}/login`);
    await page.getByLabel('Email', { exact: true }).fill(managerEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Members & Flats' }).click();
    const form = page.getByRole('form', { name: 'Create society account' });
    await form.waitFor();
    const accounts: Record<string, string> = {};
    for (const role of ['OWNER_MEMBER', 'RESIDENT', 'COMMITTEE_MEMBER']) {
      await form.getByLabel('Name *', { exact: true }).fill(`Browser ${role}`);
      await form.getByLabel('Email *', { exact: true }).fill(`browser_${role.toLowerCase()}@onboarding.example`);
      await form.getByLabel('Application role *').selectOption(role);
      const submitted = page.waitForResponse(response => response.url().endsWith('/api/users/society') && response.request().method() === 'POST');
      await form.getByRole('button').click();
      const response = await submitted;
      expect(response.status()).toBe(201);
      const account = (await response.json()).data;
      await page.getByText(`Reveal credential for Browser ${role}`, { exact: true }).waitFor();
      expect((await User.findById(account._id))?.status).toBe('PENDING_SETUP');
      accounts[role] = account._id;
      await activate(account);
    }
    await form.getByLabel('Name *', { exact: true }).fill('Browser Joint Owner');
    await form.getByLabel('Email *', { exact: true }).fill('browser_joint_owner@onboarding.example');
    await form.getByLabel('Application role *').selectOption('OWNER_MEMBER');
    const jointOwnerResponse = page.waitForResponse(response => response.url().endsWith('/api/users/society') && response.request().method() === 'POST');
    await form.getByRole('button').click();
    const jointOwnerHttpResponse = await jointOwnerResponse;
    expect(jointOwnerHttpResponse.status()).toBe(201);
    const jointOwnerAccount = (await jointOwnerHttpResponse.json()).data;
    expect((await User.findById(jointOwnerAccount._id))?.status).toBe('PENDING_SETUP');
    accounts.JOINT_OWNER = jointOwnerAccount._id;
    await activate(jointOwnerAccount);
    // Repeat the same email to verify the actual UI displays a server validation failure.
    await form.getByLabel('Name *', { exact: true }).fill('Duplicate');
    await form.getByLabel('Email *', { exact: true }).fill('browser_resident@onboarding.example');
    const duplicate = page.waitForResponse(response => response.url().endsWith('/api/users/society') && response.request().method() === 'POST');
    await form.getByRole('button').click();
    expect((await duplicate).status()).toBe(409);
    await page.getByRole('alert').waitFor();
    await page.reload();
    const addFlatForm = page.getByRole('form', { name: 'Add society flat' });
    await addFlatForm.getByLabel('Building').selectOption(createdBuildings['Browser Building A']);
    await addFlatForm.getByLabel('Flat number').fill('002');
    const flatResponse = page.waitForResponse(response => response.url().endsWith('/api/flats') && response.request().method() === 'POST');
    await addFlatForm.getByRole('button', { name: 'Add Flat', exact: true }).click();
    const flatHttpResponse = await flatResponse;
    const createdFlatA = (await flatHttpResponse.json()).data;
    expect(createdFlatA.flatNumber).toBe('002');
    expect(await Flat.findById(createdFlatA._id).then(record => record?.flatNumber)).toBe('002');

    await addFlatForm.getByLabel('Flat number').fill('002');
    const duplicateFlatResponse = page.waitForResponse(response => response.url().endsWith('/api/flats') && response.request().method() === 'POST');
    await addFlatForm.getByRole('button', { name: 'Add Flat', exact: true }).click();
    expect((await duplicateFlatResponse).status()).toBe(409);
    await page.getByRole('alert').waitFor();

    await addFlatForm.getByLabel('Building').selectOption(createdBuildings['Browser Building B']);
    await addFlatForm.getByLabel('Flat number').fill('002');
    const otherBuildingFlatResponse = page.waitForResponse(response => response.url().endsWith('/api/flats') && response.request().method() === 'POST');
    await addFlatForm.getByRole('button', { name: 'Add Flat', exact: true }).click();
    const otherBuildingFlatHttpResponse = await otherBuildingFlatResponse;
    const createdFlatB = (await otherBuildingFlatHttpResponse.json()).data;
    expect(createdFlatB).toMatchObject({ societyId: society, buildingId: createdBuildings['Browser Building B'], flatNumber: '002' });

    const membershipForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add membership', exact: true }) });
    await membershipForm.getByLabel('Existing society account').selectOption(accounts.OWNER_MEMBER);
    await membershipForm.getByRole('combobox', { name: /^Flat/ }).selectOption(createdFlatA._id);
    const membershipSaved = page.waitForResponse(response => response.url().endsWith('/api/memberships') && response.request().method() === 'POST');
    await membershipForm.getByRole('button', { name: 'Add membership', exact: true }).click();
    expect((await membershipSaved).status()).toBe(201);
    expect(await Membership.countDocuments({ userId: accounts.OWNER_MEMBER, unitId: createdFlatA._id })).toBe(1);
    const relationshipForm = page.locator('form').filter({ has: page.getByRole('combobox', { name: /^Relationship/ }) });
    for (const [userId, type, order] of [[accounts.OWNER_MEMBER, 'PRIMARY', '1'], [accounts.JOINT_OWNER, 'JOINT', '2']]) {
      await relationshipForm.getByRole('combobox', { name: /^Relationship/ }).selectOption('ownership');
      await relationshipForm.getByLabel('Building').selectOption(createdBuildings['Browser Building A']);
      await relationshipForm.getByLabel('Flat number').fill('002');
      await relationshipForm.getByLabel('Existing society account').selectOption(userId);
      await relationshipForm.getByLabel('Ownership type *', { exact: false }).fill(type);
      await relationshipForm.getByLabel('Ownership order (optional)', { exact: false }).fill(order);
      await relationshipForm.getByLabel('Relationship status *', { exact: false }).fill('ACTIVE');
      const saved = page.waitForResponse(response => response.url().endsWith(`/flats/${createdFlatA._id}/ownerships`) && response.request().method() === 'POST');
      await relationshipForm.getByRole('button', { name: 'Save ownership record', exact: true }).click();
      expect((await saved).status()).toBe(201);
      if (order === '2') expect(await Ownership.countDocuments({ flatId: createdFlatA._id })).toBe(2);
    }
    await relationshipForm.getByRole('combobox', { name: /^Relationship/ }).selectOption('residence');
    await relationshipForm.getByLabel('Building').selectOption(createdBuildings['Browser Building A']);
    await relationshipForm.getByLabel('Flat number').fill('002');
    await relationshipForm.getByLabel('Existing society account').selectOption(accounts.RESIDENT);
    await relationshipForm.getByLabel('Occupancy type *', { exact: false }).fill('TENANT');
    await relationshipForm.getByLabel('Relationship status *', { exact: false }).fill('ACTIVE');
    const residenceSaved = page.waitForResponse(response => response.url().endsWith(`/flats/${createdFlatA._id}/residents`) && response.request().method() === 'POST');
    await relationshipForm.getByRole('button', { name: 'Save residence record', exact: true }).click();
    expect((await residenceSaved).status()).toBe(201);
    expect(await Ownership.countDocuments({ flatId: createdFlatA._id })).toBe(2);
    expect(await Residence.countDocuments({ userId: accounts.RESIDENT, flatId: createdFlatA._id })).toBe(1);
    expect(await Membership.countDocuments({ userId: accounts.RESIDENT })).toBe(0);
  } finally {
    await browser?.close();
    await frontend.close();
  }
}, 60000);
