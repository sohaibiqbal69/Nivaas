import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Society } from '../society/models/Society.js';
import { Building, PROPERTY_STATUSES } from './models/Building.js';
import { Flat } from './models/Flat.js';

type BuildingData = {
  societyId: string;
  name: string;
  buildingCode?: string;
  address?: string;
  numberOfFloors?: number;
  status: typeof PROPERTY_STATUSES[number];
};

type FlatData = {
  societyId: string;
  buildingId: string;
  flatNumber: string;
  floor?: number;
  type?: string;
  status: typeof PROPERTY_STATUSES[number];
};

export type BuildingRecord = BuildingData & {
  _id: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

export type FlatRecord = FlatData & {
  _id: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

export type PropertyRepository = {
  findBuildings(filters: Record<string, string>): Promise<BuildingRecord[]>;
  findBuildingById(id: string): Promise<BuildingRecord | null>;
  createBuilding(data: BuildingData, actorId: string): Promise<BuildingRecord>;
  updateBuilding(id: string, data: Partial<Omit<BuildingData, 'societyId' | 'status'>>, actorId: string): Promise<BuildingRecord | null>;
  updateBuildingStatus(id: string, status: typeof PROPERTY_STATUSES[number], actorId: string): Promise<BuildingRecord | null>;
  findFlats(filters: Record<string, string>): Promise<FlatRecord[]>;
  findFlatById(id: string): Promise<FlatRecord | null>;
  createFlat(data: FlatData, actorId: string): Promise<FlatRecord>;
  updateFlat(id: string, data: Partial<Pick<FlatData, 'flatNumber' | 'floor' | 'type'>>, actorId: string): Promise<FlatRecord | null>;
  updateFlatStatus(id: string, status: typeof PROPERTY_STATUSES[number], actorId: string): Promise<FlatRecord | null>;
};

const buildingFields = '_id societyId name buildingCode address numberOfFloors status createdAt updatedAt';
const flatFields = '_id societyId buildingId flatNumber floor type status createdAt updatedAt';

const propertyRepository: PropertyRepository = {
  async findBuildings(filters) {
    return Building.find(filters).select(buildingFields).lean().exec() as unknown as Promise<BuildingRecord[]>;
  },
  async findBuildingById(id) {
    return Building.findById(id).select(buildingFields).lean().exec() as unknown as Promise<BuildingRecord | null>;
  },
  async createBuilding(data, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: BuildingRecord | null = null;
      await session.withTransaction(async () => {
        await ensureSociety(data.societyId, session);
        const [building] = await Building.create([data], { session });
        await writeAudit('BUILDING_CREATED', actorId, building._id.toString(), data.societyId, {}, {
          name: data.name, buildingCode: data.buildingCode, status: data.status,
        }, session);
        const persisted = await Building.findById(building._id).select(buildingFields).session(session).lean().exec();
        result = persisted as unknown as BuildingRecord;
      });
      if (!result) throw new Error('Building creation did not return a persisted record.');
      return result;
    } finally {
      await session.endSession();
    }
  },
  async updateBuilding(id, data, actorId) {
    return updateBuildingWithAudit(id, data, actorId);
  },
  async updateBuildingStatus(id, status, actorId) {
    return updateBuildingWithAudit(id, { status }, actorId);
  },
  async findFlats(filters) {
    return Flat.find(filters).select(flatFields).lean().exec() as unknown as Promise<FlatRecord[]>;
  },
  async findFlatById(id) {
    return Flat.findById(id).select(flatFields).lean().exec() as unknown as Promise<FlatRecord | null>;
  },
  async createFlat(data, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: FlatRecord | null = null;
      await session.withTransaction(async () => {
        const building = await ensureBuildingSociety(data.buildingId, data.societyId, session);
        if (!building) throw new ApiError(400, 'VALIDATION_ERROR', 'The building does not exist.');
        const [flat] = await Flat.create([data], { session });
        await writeAudit('FLAT_CREATED', actorId, flat._id.toString(), data.societyId, {}, {
          buildingId: data.buildingId, flatNumber: data.flatNumber, status: data.status,
        }, session);
        const persisted = await Flat.findById(flat._id).select(flatFields).session(session).lean().exec();
        result = persisted as unknown as FlatRecord;
      });
      if (!result) throw new Error('Flat creation did not return a persisted record.');
      return result;
    } finally {
      await session.endSession();
    }
  },
  async updateFlat(id, data, actorId) {
    return updateFlatWithAudit(id, data, actorId);
  },
  async updateFlatStatus(id, status, actorId) {
    return updateFlatWithAudit(id, { status }, actorId);
  },
};

export function serializeBuilding(building: BuildingRecord): Record<string, unknown> {
  return {
    _id: building._id.toString(),
    societyId: building.societyId,
    name: building.name,
    ...(building.buildingCode === undefined ? {} : { buildingCode: building.buildingCode }),
    ...(building.address === undefined ? {} : { address: building.address }),
    ...(building.numberOfFloors === undefined ? {} : { numberOfFloors: building.numberOfFloors }),
    status: building.status,
    createdAt: building.createdAt,
    updatedAt: building.updatedAt,
  };
}

export function serializeFlat(flat: FlatRecord): Record<string, unknown> {
  return {
    _id: flat._id.toString(),
    societyId: flat.societyId,
    buildingId: flat.buildingId,
    flatNumber: flat.flatNumber,
    ...(flat.floor === undefined ? {} : { floor: flat.floor }),
    ...(flat.type === undefined ? {} : { type: flat.type }),
    status: flat.status,
    createdAt: flat.createdAt,
    updatedAt: flat.updatedAt,
  };
}

export function createPropertyRouter(
  repository: PropertyRepository = propertyRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const adminOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN')] as const;

  router.post('/buildings', ...adminOnly, async (request, response, next) => {
    try {
      const building = await repository.createBuilding(validateBuildingCreate(request.body), currentUser(request).userId);
      response.status(201).json({ success: true, data: serializeBuilding(building) });
    } catch (error) {
      next(normalizePropertyError(error));
    }
  });
  router.get('/buildings', ...adminOnly, async (request, response, next) => {
    try {
      const buildings = await repository.findBuildings(validateFilters(request.query, 'building'));
      response.status(200).json({ success: true, data: buildings.map(serializeBuilding) });
    } catch (error) { next(error); }
  });
  router.get('/buildings/:id', ...adminOnly, async (request, response, next) => {
    try {
      const building = await repository.findBuildingById(parseId(request.params.id));
      if (!building) throw notFound();
      response.status(200).json({ success: true, data: serializeBuilding(building) });
    } catch (error) { next(error); }
  });
  router.patch('/buildings/:id/status', ...adminOnly, async (request, response, next) => {
    try {
      const status = validateStatusRequest(request.body);
      const building = await repository.updateBuildingStatus(parseId(request.params.id), status, currentUser(request).userId);
      if (!building) throw notFound();
      response.status(200).json({ success: true, data: serializeBuilding(building) });
    } catch (error) { next(normalizePropertyError(error)); }
  });
  router.patch('/buildings/:id', ...adminOnly, async (request, response, next) => {
    try {
      const building = await repository.updateBuilding(parseId(request.params.id), validateBuildingUpdate(request.body), currentUser(request).userId);
      if (!building) throw notFound();
      response.status(200).json({ success: true, data: serializeBuilding(building) });
    } catch (error) { next(normalizePropertyError(error)); }
  });

  router.post('/flats', ...adminOnly, async (request, response, next) => {
    try {
      const flat = await repository.createFlat(validateFlatCreate(request.body), currentUser(request).userId);
      response.status(201).json({ success: true, data: serializeFlat(flat) });
    } catch (error) { next(normalizePropertyError(error)); }
  });
  router.get('/flats', ...adminOnly, async (request, response, next) => {
    try {
      const flats = await repository.findFlats(validateFilters(request.query, 'flat'));
      response.status(200).json({ success: true, data: flats.map(serializeFlat) });
    } catch (error) { next(error); }
  });
  router.get('/flats/:id', ...adminOnly, async (request, response, next) => {
    try {
      const flat = await repository.findFlatById(parseId(request.params.id));
      if (!flat) throw notFound();
      response.status(200).json({ success: true, data: serializeFlat(flat) });
    } catch (error) { next(error); }
  });
  router.patch('/flats/:id/status', ...adminOnly, async (request, response, next) => {
    try {
      const flat = await repository.updateFlatStatus(parseId(request.params.id), validateStatusRequest(request.body), currentUser(request).userId);
      if (!flat) throw notFound();
      response.status(200).json({ success: true, data: serializeFlat(flat) });
    } catch (error) { next(normalizePropertyError(error)); }
  });
  router.patch('/flats/:id', ...adminOnly, async (request, response, next) => {
    try {
      const flat = await repository.updateFlat(parseId(request.params.id), validateFlatUpdate(request.body), currentUser(request).userId);
      if (!flat) throw notFound();
      response.status(200).json({ success: true, data: serializeFlat(flat) });
    } catch (error) { next(normalizePropertyError(error)); }
  });
  return router;
}

async function updateBuildingWithAudit(id: string, update: Record<string, unknown>, actorId: string): Promise<BuildingRecord | null> {
  const session = await mongoose.startSession();
  try {
    let result: BuildingRecord | null = null;
    await session.withTransaction(async () => {
      const existing = await Building.findById(id).session(session).lean().exec() as unknown as BuildingRecord | null;
      if (!existing) return;
      const updated = await Building.findByIdAndUpdate(id, update, { new: true, runValidators: true, session })
        .select(buildingFields).lean().exec() as unknown as BuildingRecord | null;
      if (!updated) return;
      await writeAudit('BUILDING_UPDATED', actorId, id, existing.societyId, existing, updated, session);
      result = updated;
    });
    return result;
  } finally { await session.endSession(); }
}

async function updateFlatWithAudit(id: string, update: Record<string, unknown>, actorId: string): Promise<FlatRecord | null> {
  const session = await mongoose.startSession();
  try {
    let result: FlatRecord | null = null;
    await session.withTransaction(async () => {
      const existing = await Flat.findById(id).session(session).lean().exec() as unknown as FlatRecord | null;
      if (!existing) return;
      const updated = await Flat.findByIdAndUpdate(id, update, { new: true, runValidators: true, session })
        .select(flatFields).lean().exec() as unknown as FlatRecord | null;
      if (!updated) return;
      await writeAudit('FLAT_UPDATED', actorId, id, existing.societyId, existing, updated, session);
      result = updated;
    });
    return result;
  } finally { await session.endSession(); }
}

async function writeAudit(action: string, actorId: string, entityId: string, societyId: string, previousState: unknown, newState: unknown, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    action, actorId, entityType: action.startsWith('BUILDING') ? 'Building' : 'Flat', entityId, societyId,
    previousState: sanitizeState(previousState), newState: sanitizeState(newState),
  }).save({ session });
}

function sanitizeState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const state = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(state).filter(([key]) => !['_id', 'createdAt', 'updatedAt', '__v'].includes(key)));
}

async function ensureSociety(societyId: string, session: mongoose.ClientSession): Promise<void> {
  if (!await Society.exists({ _id: societyId }).session(session)) throw new ApiError(400, 'VALIDATION_ERROR', 'The society does not exist.');
}

async function ensureBuildingSociety(buildingId: string, societyId: string, session: mongoose.ClientSession): Promise<BuildingRecord | null> {
  const building = await Building.findById(buildingId).session(session).lean().exec() as unknown as BuildingRecord | null;
  if (!building) return null;
  if (building.societyId.toString() !== societyId) throw new ApiError(400, 'VALIDATION_ERROR', 'The building does not belong to the society.');
  return building;
}

function currentUser(request: Request) {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function parseId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw notFound();
  return new Types.ObjectId(value).toString();
}

function validateBuildingCreate(value: unknown): BuildingData {
  const body = object(value);
  assertKeys(body, ['societyId', 'name', 'buildingCode', 'address', 'numberOfFloors', 'status']);
  return {
    societyId: objectId(body.societyId, 'societyId'),
    name: nonEmpty(body.name, 'name'),
    ...(body.buildingCode === undefined ? {} : { buildingCode: nonEmpty(body.buildingCode, 'buildingCode') }),
    ...(body.address === undefined ? {} : { address: stringValue(body.address, 'address') }),
    ...(body.numberOfFloors === undefined ? {} : { numberOfFloors: positiveNumber(body.numberOfFloors, 'numberOfFloors') }),
    status: status(body.status),
  };
}

function validateBuildingUpdate(value: unknown): Partial<Omit<BuildingData, 'societyId' | 'status'>> {
  const body = object(value);
  assertKeys(body, ['name', 'buildingCode', 'address', 'numberOfFloors']);
  if (Object.keys(body).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one building field is required.');
  return {
    ...(body.name === undefined ? {} : { name: nonEmpty(body.name, 'name') }),
    ...(body.buildingCode === undefined ? {} : { buildingCode: nonEmpty(body.buildingCode, 'buildingCode') }),
    ...(body.address === undefined ? {} : { address: stringValue(body.address, 'address') }),
    ...(body.numberOfFloors === undefined ? {} : { numberOfFloors: positiveNumber(body.numberOfFloors, 'numberOfFloors') }),
  };
}

function validateFlatCreate(value: unknown): FlatData {
  const body = object(value);
  assertKeys(body, ['societyId', 'buildingId', 'flatNumber', 'floor', 'type', 'status']);
  return {
    societyId: objectId(body.societyId, 'societyId'),
    buildingId: objectId(body.buildingId, 'buildingId'),
    flatNumber: nonEmpty(body.flatNumber, 'flatNumber'),
    ...(body.floor === undefined ? {} : { floor: integer(body.floor, 'floor') }),
    ...(body.type === undefined ? {} : { type: stringValue(body.type, 'type') }),
    status: status(body.status),
  };
}

function validateFlatUpdate(value: unknown): Partial<Pick<FlatData, 'flatNumber' | 'floor' | 'type'>> {
  const body = object(value);
  assertKeys(body, ['flatNumber', 'floor', 'type']);
  if (Object.keys(body).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one flat field is required.');
  return {
    ...(body.flatNumber === undefined ? {} : { flatNumber: nonEmpty(body.flatNumber, 'flatNumber') }),
    ...(body.floor === undefined ? {} : { floor: integer(body.floor, 'floor') }),
    ...(body.type === undefined ? {} : { type: stringValue(body.type, 'type') }),
  };
}

function validateStatusRequest(value: unknown): typeof PROPERTY_STATUSES[number] {
  const body = object(value);
  if (Object.keys(body).length !== 1 || body.status === undefined) throw new ApiError(400, 'VALIDATION_ERROR', 'status is required.');
  return status(body.status);
}

function validateFilters(query: Request['query'], kind: 'building' | 'flat'): Record<string, string> {
  const allowed = kind === 'building' ? ['societyId', 'status'] : ['societyId', 'buildingId', 'status'];
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported or invalid property filter.');
    filters[key] = key === 'status' ? status(value) : objectId(value, key);
  }
  return filters;
}

function status(value: unknown): typeof PROPERTY_STATUSES[number] {
  if (typeof value !== 'string' || !PROPERTY_STATUSES.includes(value as typeof PROPERTY_STATUSES[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'The property status is invalid.');
  return value as typeof PROPERTY_STATUSES[number];
}

function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function nonEmpty(value: unknown, field: string): string {
  const result = stringValue(value, field);
  if (!result) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must not be empty.`);
  return result;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
  return value.trim();
}

function positiveNumber(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a positive integer.`);
  return Number(value);
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an integer.`);
  return Number(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  return value as Record<string, unknown>;
}

function assertKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported property fields.');
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}

function normalizePropertyError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return new ApiError(409, 'CONFLICT', 'The property identifier already exists.');
  return error;
}
