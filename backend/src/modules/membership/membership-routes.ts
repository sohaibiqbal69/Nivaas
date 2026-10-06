import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Flat } from '../property/models/Flat.js';
import { Society } from '../society/models/Society.js';
import { User } from '../users/models/User.js';
import { Membership, MEMBERSHIP_STATUSES, MEMBERSHIP_TYPES } from './models/Membership.js';

type MembershipField = 'unitId' | 'membershipType' | 'membershipNumber' | 'primaryMemberOrder'
  | 'associatedFlatIds' | 'validFrom' | 'validTo';

export type MembershipRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  userId: { toString(): string };
  unitId: { toString(): string };
  membershipType: string;
  membershipStatus: string;
  membershipNumber?: string;
  primaryMemberOrder?: number;
  associatedFlatIds?: Array<{ toString(): string }>;
  validFrom?: Date;
  validTo?: Date;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

type MembershipWriteData = {
  societyId: string;
  userId: string;
  unitId: string;
  membershipType: string;
  membershipStatus: string;
  membershipNumber?: string;
  primaryMemberOrder?: number;
  associatedFlatIds?: string[];
  validFrom?: Date;
  validTo?: Date;
};

export type MembershipRepository = {
  findAll(filters: Record<string, string>): Promise<MembershipRecord[]>;
  findById(id: string): Promise<MembershipRecord | null>;
  createWithAudit(data: MembershipWriteData, actorId: string): Promise<MembershipRecord>;
  updateWithAudit(id: string, update: Partial<Record<MembershipField, unknown>>, actorId: string): Promise<MembershipRecord | null>;
  updateStatusWithAudit(id: string, status: string, actorId: string): Promise<MembershipRecord | null>;
};

const responseFields = [
  '_id', 'societyId', 'userId', 'unitId', 'membershipType', 'membershipStatus',
  'membershipNumber', 'primaryMemberOrder', 'associatedFlatIds', 'validFrom', 'validTo', 'createdAt', 'updatedAt',
].join(' ');

const membershipRepository: MembershipRepository = {
  async findAll(filters) {
    return Membership.find(filters).select(responseFields).lean().exec() as unknown as Promise<MembershipRecord[]>;
  },
  async findById(id) {
    return Membership.findById(id).select(responseFields).lean().exec() as unknown as Promise<MembershipRecord | null>;
  },
  async createWithAudit(data, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: MembershipRecord | null = null;
      await session.withTransaction(async () => {
        await validateReferences(data.societyId, data.userId, data.unitId, session);
        const [membership] = await Membership.create([data], { session });
        await createAudit({
          action: 'MEMBERSHIP_CREATED',
          actorId,
          entityId: membership._id.toString(),
          societyId: data.societyId,
          previousState: {},
          newState: { membershipType: data.membershipType, membershipStatus: data.membershipStatus, unitId: data.unitId },
        }, session);
        const createdDocument = await Membership.findById(membership._id)
          .select(responseFields).session(session).lean().exec();
        result = createdDocument as unknown as MembershipRecord;
      });
      if (!result) throw new Error('Membership creation did not return a persisted record.');
      return result;
    } finally {
      await session.endSession();
    }
  },
  async updateWithAudit(id, update, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: MembershipRecord | null = null;
      await session.withTransaction(async () => {
        const existing = await Membership.findById(id).session(session).lean().exec() as unknown as MembershipRecord | null;
        if (!existing) return;
        if (update.unitId) await validateReferences(existing.societyId.toString(), existing.userId.toString(), String(update.unitId), session);
        const updated = await Membership.findByIdAndUpdate(id, update, { new: true, runValidators: true, session })
          .select(responseFields).lean().exec() as unknown as MembershipRecord | null;
        if (!updated) return;
        await createAudit({
          action: 'MEMBERSHIP_UPDATED',
          actorId,
          entityId: id,
          societyId: existing.societyId.toString(),
          previousState: { membershipType: existing.membershipType, unitId: existing.unitId.toString() },
          newState: { membershipType: updated.membershipType, unitId: updated.unitId.toString() },
        }, session);
        result = updated;
      });
      return result;
    } finally {
      await session.endSession();
    }
  },
  async updateStatusWithAudit(id, status, actorId) {
    const session = await mongoose.startSession();
    try {
      let result: MembershipRecord | null = null;
      await session.withTransaction(async () => {
        const existing = await Membership.findById(id).session(session).lean().exec() as unknown as MembershipRecord | null;
        if (!existing) return;
        if (existing.membershipStatus === status) throw new ApiError(400, 'VALIDATION_ERROR', 'The membership already has this status.');
        const updated = await Membership.findByIdAndUpdate(id, { membershipStatus: status }, { new: true, runValidators: true, session })
          .select(responseFields).lean().exec() as unknown as MembershipRecord | null;
        if (!updated) return;
        await createAudit({
          action: 'MEMBERSHIP_STATUS_CHANGED',
          actorId,
          entityId: id,
          societyId: existing.societyId.toString(),
          previousState: { membershipStatus: existing.membershipStatus },
          newState: { membershipStatus: status },
        }, session);
        result = updated;
      });
      return result;
    } finally {
      await session.endSession();
    }
  },
};

export function serializeMembership(membership: MembershipRecord): Record<string, unknown> {
  return {
    _id: membership._id.toString(),
    societyId: membership.societyId.toString(),
    userId: membership.userId.toString(),
    unitId: membership.unitId.toString(),
    membershipType: membership.membershipType,
    membershipStatus: membership.membershipStatus,
    ...(membership.membershipNumber === undefined ? {} : { membershipNumber: membership.membershipNumber }),
    ...(membership.primaryMemberOrder === undefined ? {} : { primaryMemberOrder: membership.primaryMemberOrder }),
    ...(membership.associatedFlatIds === undefined ? {} : { associatedFlatIds: membership.associatedFlatIds.map((id) => id.toString()) }),
    ...(membership.validFrom === undefined ? {} : { validFrom: membership.validFrom }),
    ...(membership.validTo === undefined ? {} : { validTo: membership.validTo }),
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

export function createMembershipsRouter(
  repository: MembershipRepository = membershipRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const adminOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN')] as const;

  router.post('/', ...adminOnly, async (request, response, next) => {
    try {
      const actor = requireCurrentUser(request);
      const data = validateCreateRequest(request.body);
      const membership = await repository.createWithAudit(data, actor.userId);
      response.status(201).json({ success: true, data: serializeMembership(membership) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/', ...adminOnly, async (request, response, next) => {
    try {
      const filters = validateFilters(request.query);
      const memberships = await repository.findAll(filters);
      response.status(200).json({ success: true, data: memberships.map(serializeMembership) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', ...adminOnly, async (request, response, next) => {
    try {
      const membership = await repository.findById(parseId(request.params.id));
      if (!membership) throw notFound();
      response.status(200).json({ success: true, data: serializeMembership(membership) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/status', ...adminOnly, async (request, response, next) => {
    try {
      const actor = requireCurrentUser(request);
      const status = validateStatusRequest(request.body);
      const membership = await repository.updateStatusWithAudit(parseId(request.params.id), status, actor.userId);
      if (!membership) throw notFound();
      response.status(200).json({ success: true, data: serializeMembership(membership) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.patch('/:id', ...adminOnly, async (request, response, next) => {
    try {
      const actor = requireCurrentUser(request);
      const update = validateUpdateRequest(request.body);
      const membership = await repository.updateWithAudit(parseId(request.params.id), update, actor.userId);
      if (!membership) throw notFound();
      response.status(200).json({ success: true, data: serializeMembership(membership) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}

async function validateReferences(societyId: string, userId: string, unitId: string, session: mongoose.ClientSession): Promise<void> {
  const [society, user, unit] = await Promise.all([
    Society.findById(societyId).session(session).select('_id').lean().exec(),
    User.findById(userId).session(session).select('_id').lean().exec(),
    Flat.findById(unitId).session(session).select('_id societyId').lean().exec(),
  ]);
  if (!society) throw new ApiError(400, 'VALIDATION_ERROR', 'The society does not exist.');
  if (!user) throw new ApiError(400, 'VALIDATION_ERROR', 'The user does not exist.');
  if (!unit) throw new ApiError(400, 'VALIDATION_ERROR', 'The unit does not exist.');
  const unitSocietyId = (unit as unknown as { societyId: { toString(): string } }).societyId;
  if (!unitSocietyId || unitSocietyId.toString() !== societyId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The unit does not belong to the society.');
  }
}

async function createAudit(input: {
  action: string;
  actorId: string;
  entityId: string;
  societyId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
}, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    action: input.action,
    actorId: input.actorId,
    entityType: 'Membership',
    entityId: input.entityId,
    societyId: input.societyId,
    previousState: input.previousState,
    newState: input.newState,
  }).save({ session });
}

function requireCurrentUser(request: Request) {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function parseId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw notFound();
  return new Types.ObjectId(value).toString();
}

function validateCreateRequest(value: unknown): MembershipWriteData {
  const body = validateObject(value);
  const allowed = new Set(['societyId', 'userId', 'unitId', 'membershipType', 'membershipStatus', 'membershipNumber', 'primaryMemberOrder', 'associatedFlatIds', 'validFrom', 'validTo']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported membership fields.');
  const societyId = validateObjectId(body.societyId, 'societyId');
  const userId = validateObjectId(body.userId, 'userId');
  const unitId = validateObjectId(body.unitId, 'unitId');
  const membershipType = validateType(body.membershipType);
  const membershipStatus = validateStatus(body.membershipStatus);
  return { societyId, userId, unitId, membershipType, membershipStatus, ...validateOptionalFields(body) };
}

function validateUpdateRequest(value: unknown): Partial<Record<MembershipField, unknown>> {
  const body = validateObject(value);
  const allowed = new Set(['unitId', 'membershipType', 'membershipNumber', 'primaryMemberOrder', 'associatedFlatIds', 'validFrom', 'validTo']);
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.has(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'Only membership details may be updated.');
  const update: Partial<Record<MembershipField, unknown>> = {};
  if (body.unitId !== undefined) update.unitId = validateObjectId(body.unitId, 'unitId');
  if (body.membershipType !== undefined) update.membershipType = validateType(body.membershipType);
  Object.assign(update, validateOptionalFields(body));
  return update;
}

function validateOptionalFields(body: Record<string, unknown>): Partial<MembershipWriteData> {
  const result: Partial<MembershipWriteData> = {};
  if (body.membershipNumber !== undefined) result.membershipNumber = validateString(body.membershipNumber, 'membershipNumber');
  if (body.primaryMemberOrder !== undefined) {
    if (!Number.isInteger(body.primaryMemberOrder) || Number(body.primaryMemberOrder) < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'primaryMemberOrder must be a positive integer.');
    result.primaryMemberOrder = Number(body.primaryMemberOrder);
  }
  if (body.associatedFlatIds !== undefined) {
    if (!Array.isArray(body.associatedFlatIds)) throw new ApiError(400, 'VALIDATION_ERROR', 'associatedFlatIds must be an array.');
    result.associatedFlatIds = body.associatedFlatIds.map((id) => validateObjectId(id, 'associatedFlatIds'));
  }
  for (const field of ['validFrom', 'validTo'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string' || Number.isNaN(Date.parse(body[field]))) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
      result[field] = new Date(body[field]);
    }
  }
  return result;
}

function validateFilters(query: Request['query']): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const field of ['societyId', 'userId', 'unitId', 'status'] as const) {
    const value = query[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || (field !== 'status' && !Types.ObjectId.isValid(value))) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${field}.`);
      filters[field === 'status' ? 'membershipStatus' : field] = field === 'status' ? validateStatus(value) : new Types.ObjectId(value).toString();
    }
  }
  return filters;
}

function validateStatus(value: unknown): string {
  if (typeof value !== 'string' || !MEMBERSHIP_STATUSES.includes(value as typeof MEMBERSHIP_STATUSES[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'The membership status is invalid.');
  return value;
}

function validateStatusRequest(value: unknown): string {
  const body = validateObject(value);
  if (Object.keys(body).length !== 1 || !('membershipStatus' in body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'membershipStatus is required.');
  }
  return validateStatus(body.membershipStatus);
}

function validateType(value: unknown): string {
  if (typeof value !== 'string' || !MEMBERSHIP_TYPES.includes(value as typeof MEMBERSHIP_TYPES[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'The membership type is invalid.');
  return value;
}

function validateObjectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function validateString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a non-empty string.`);
  return value.trim();
}

function validateObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  return value as Record<string, unknown>;
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}

function normalizeError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
    return new ApiError(409, 'CONFLICT', 'The membership relationship already exists.');
  }
  return error;
}
