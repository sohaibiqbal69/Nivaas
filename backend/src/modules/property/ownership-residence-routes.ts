import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Flat } from './models/Flat.js';
import { Ownership } from './models/Ownership.js';
import { Residence } from './models/Residence.js';
import { User } from '../users/models/User.js';

type Relationship = 'ownership' | 'residence';
type DateFields = { startDate?: Date; endDate?: Date };

export type RelationshipRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  flatId: { toString(): string };
  userId: { toString(): string };
  ownershipType?: string;
  ownershipOrder?: number;
  occupancyType?: string;
  status: string;
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

type RelationshipRepository = {
  findFlatSocietyId(flatId: string): Promise<string | null>;
  findByFlat(type: Relationship, flatId: string): Promise<RelationshipRecord[] | null>;
  create(type: Relationship, flatId: string, data: Record<string, unknown>, actorId: string): Promise<RelationshipRecord>;
  update(type: Relationship, id: string, data: Record<string, unknown>, actorId: string): Promise<RelationshipRecord | null>;
};

const ownershipFields = '_id societyId flatId userId ownershipType ownershipOrder status startDate endDate createdAt updatedAt';
const residenceFields = '_id societyId flatId userId occupancyType status startDate endDate createdAt updatedAt';

const repository: RelationshipRepository = {
  async findFlatSocietyId(flatId) {
    const flat = await Flat.findById(flatId).select('societyId').lean().exec() as unknown as { societyId: { toString(): string } } | null;
    return flat?.societyId.toString() ?? null;
  },
  async findByFlat(type, flatId) {
    const Model = type === 'ownership' ? Ownership : Residence;
    const fields = type === 'ownership' ? ownershipFields : residenceFields;
    const flat = await Flat.findById(flatId).select('_id').lean().exec();
    if (!flat) return null;
    return Model.find({ flatId }).select(fields).lean().exec() as unknown as Promise<RelationshipRecord[]>;
  },
  async create(type, flatId, data, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: RelationshipRecord | null = null;
      await session.withTransaction(async () => {
        const [flatResult, user] = await Promise.all([
          Flat.findById(flatId).session(session).select('_id societyId').lean().exec(),
          User.findById(data.userId).session(session).select('_id societyId role').lean().exec(),
        ]);
        const flat = flatResult as unknown as { societyId: { toString(): string } } | null;
        if (!flat) throw new ApiError(400, 'VALIDATION_ERROR', 'The flat does not exist.');
        if (!user) throw new ApiError(400, 'VALIDATION_ERROR', 'The user does not exist.');
        const scopedUser = user as unknown as { societyId: { toString(): string } | null; role: string };
        if (scopedUser.role === 'SYSTEM_ADMIN' || scopedUser.societyId?.toString() !== flat.societyId.toString()) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'The user must be assigned to the flat society before recording this relationship.');
        }
        if (data.societyId && String(data.societyId) !== flat.societyId.toString()) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'The relationship does not belong to the flat society.');
        }
        const relationshipData = { ...data, flatId, societyId: flat.societyId };
        const Model = type === 'ownership' ? Ownership : Residence;
        const fields = type === 'ownership' ? ownershipFields : residenceFields;
        const [created] = await Model.create([relationshipData], { session });
        await writeAudit(type, 'CREATED', actorId, created._id.toString(), flat.societyId.toString(), {}, relationshipData, session);
        const persisted = await Model.findById(created._id).select(fields).session(session).lean().exec();
        result = persisted as unknown as RelationshipRecord;
      });
      if (!result) throw new Error('Relationship creation did not return a persisted record.');
      return result;
    } finally {
      await session.endSession();
    }
  },
  async update(type, id, data, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: RelationshipRecord | null = null;
      await session.withTransaction(async () => {
        const Model = type === 'ownership' ? Ownership : Residence;
        const fields = type === 'ownership' ? ownershipFields : residenceFields;
        const existing = await Model.findById(id).session(session).lean().exec() as unknown as RelationshipRecord | null;
        if (!existing) return;
        const startDate = (data.startDate as Date | undefined) ?? existing.startDate;
        const endDate = (data.endDate as Date | undefined) ?? existing.endDate;
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must not be earlier than startDate.');
        }
        const updated = await Model.findByIdAndUpdate(id, data, { new: true, runValidators: true, session })
          .select(fields).lean().exec() as unknown as RelationshipRecord | null;
        if (!updated) return;
        await writeAudit(type, 'UPDATED', actorId, id, existing.societyId.toString(), existing, updated, session);
        result = updated;
      });
      return result;
    } finally {
      await session.endSession();
    }
  },
};

export function createOwnershipResidenceRouter(
  relationshipRepository: RelationshipRepository = repository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const adminOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN')] as const;
  const adminOrManager = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER')] as const;

  router.get('/flats/:flatId/ownerships', ...adminOrManager, async (request, response, next) => {
    await listRelationships('ownership', request, response, next, relationshipRepository);
  });
  router.post('/flats/:flatId/ownerships', ...adminOrManager, async (request, response, next) => {
    await createRelationship('ownership', request, response, next, relationshipRepository);
  });
  router.patch('/ownerships/:id', ...adminOnly, async (request, response, next) => {
    await updateRelationship('ownership', request, response, next, relationshipRepository);
  });
  router.get('/flats/:flatId/residents', ...adminOrManager, async (request, response, next) => {
    await listRelationships('residence', request, response, next, relationshipRepository);
  });
  router.post('/flats/:flatId/residents', ...adminOrManager, async (request, response, next) => {
    await createRelationship('residence', request, response, next, relationshipRepository);
  });
  router.patch('/residences/:id', ...adminOnly, async (request, response, next) => {
    await updateRelationship('residence', request, response, next, relationshipRepository);
  });
  return router;
}

async function listRelationships(type: Relationship, request: Request, response: Response, next: NextFunction, repository: RelationshipRepository): Promise<void> {
  try {
    const flatId = parseId(request.params.flatId);
    await assertRelationshipFlatScope(request, flatId, repository);
    const records = await repository.findByFlat(type, flatId);
    if (!records) throw notFound();
    response.status(200).json({ success: true, data: records.map((record) => serialize(record, type)) });
  } catch (error) { next(error); }
}

async function createRelationship(type: Relationship, request: Request, response: Response, next: NextFunction, repository: RelationshipRepository): Promise<void> {
  try {
    const flatId = parseId(request.params.flatId);
    await assertRelationshipFlatScope(request, flatId, repository);
    const body = validateCreate(request.body, type);
    const actor = requireCurrentUser(request);
    if (actor.role === 'SOCIETY_MANAGER' && body.userId === actor.userId) throw new ApiError(403, 'FORBIDDEN', 'Managers cannot create flat relationships for their own account.');
    const record = await repository.create(type, flatId, body, actor.userId);
    response.status(201).json({ success: true, data: serialize(record, type) });
  } catch (error) { next(normalizeError(error)); }
}

async function assertRelationshipFlatScope(request: Request, flatId: string, repository: RelationshipRepository): Promise<void> {
  const actor = requireCurrentUser(request);
  if (actor.role !== 'SOCIETY_MANAGER') return;
  const societyId = await repository.findFlatSocietyId(flatId);
  if (!societyId || actor.societyId !== societyId) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this society flat.');
}

async function updateRelationship(type: Relationship, request: Request, response: Response, next: NextFunction, repository: RelationshipRepository): Promise<void> {
  try {
    const id = parseId(request.params.id);
    const update = validateUpdate(request.body, type);
    const actor = requireCurrentUser(request);
    const record = await repository.update(type, id, update, actor.userId);
    if (!record) throw notFound();
    response.status(200).json({ success: true, data: serialize(record, type) });
  } catch (error) { next(normalizeError(error)); }
}

function serialize(record: RelationshipRecord, type: Relationship): Record<string, unknown> {
  const result: Record<string, unknown> = {
    _id: record._id.toString(), societyId: record.societyId.toString(),
    flatId: record.flatId.toString(), userId: record.userId.toString(),
    status: record.status, ...(record.startDate === undefined ? {} : { startDate: record.startDate }),
    ...(record.endDate === undefined ? {} : { endDate: record.endDate }),
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
  if (type === 'ownership') {
    result.ownershipType = record.ownershipType;
    if (record.ownershipOrder !== undefined) result.ownershipOrder = record.ownershipOrder;
  } else {
    result.occupancyType = record.occupancyType;
  }
  return result;
}

function validateCreate(value: unknown, type: Relationship): Record<string, unknown> {
  const body = object(value);
  const allowed = type === 'ownership'
    ? ['societyId', 'userId', 'ownershipType', 'ownershipOrder', 'status', 'startDate', 'endDate']
    : ['societyId', 'userId', 'occupancyType', 'status', 'startDate', 'endDate'];
  assertKeys(body, allowed);
  const dates = validateDates(body);
  const data: Record<string, unknown> = {
    userId: objectId(body.userId, 'userId'), status: requiredString(body.status, 'status'), ...dates,
  };
  if (type === 'ownership') {
    data.ownershipType = requiredString(body.ownershipType, 'ownershipType');
    if (body.ownershipOrder !== undefined) data.ownershipOrder = integer(body.ownershipOrder, 'ownershipOrder');
  } else {
    data.occupancyType = requiredString(body.occupancyType, 'occupancyType');
  }
  if (body.societyId !== undefined) data.societyId = objectId(body.societyId, 'societyId');
  return data;
}

function validateUpdate(value: unknown, type: Relationship): Record<string, unknown> {
  const body = object(value);
  const allowed = type === 'ownership'
    ? ['ownershipType', 'ownershipOrder', 'status', 'startDate', 'endDate']
    : ['occupancyType', 'status', 'startDate', 'endDate'];
  assertKeys(body, allowed);
  if (Object.keys(body).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one relationship field is required.');
  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = requiredString(body.status, 'status');
  if (type === 'ownership' && body.ownershipType !== undefined) data.ownershipType = requiredString(body.ownershipType, 'ownershipType');
  if (type === 'residence' && body.occupancyType !== undefined) data.occupancyType = requiredString(body.occupancyType, 'occupancyType');
  if (body.ownershipOrder !== undefined) data.ownershipOrder = integer(body.ownershipOrder, 'ownershipOrder');
  const dates = validateDates(body);
  Object.assign(data, dates);
  return data;
}

function validateDates(body: Record<string, unknown>): DateFields {
  const dates: DateFields = {};
  if (body.startDate !== undefined) dates.startDate = validDate(body.startDate, 'startDate');
  if (body.endDate !== undefined) dates.endDate = validDate(body.endDate, 'endDate');
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endDate must not be earlier than startDate.');
  }
  return dates;
}

async function writeAudit(type: Relationship, action: string, actorId: string, entityId: string, societyId: string, previousState: unknown, newState: unknown, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    action: `${type.toUpperCase()}_${action}`, actorId, entityType: type === 'ownership' ? 'Ownership' : 'Residence',
    entityId, societyId, previousState: auditState(previousState), newState: auditState(newState),
  }).save({ session });
}

function auditState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const state = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(state).filter(([key]) => !['_id', 'createdAt', 'updatedAt', '__v'].includes(key)));
}

function requireCurrentUser(request: Request) {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function parseId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'The id must be a valid ObjectId.');
  return new Types.ObjectId(value).toString();
}

function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function validDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
  return date;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required.`);
  return value.trim();
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
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported relationship fields.');
}

function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.'); }

function normalizeError(error: unknown): unknown {
  return error instanceof ApiError ? error : error;
}
