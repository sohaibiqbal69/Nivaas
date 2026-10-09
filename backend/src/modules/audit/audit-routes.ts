import { Router, type Request } from 'express';
import { mongo, Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from './models/AuditLog.js';
import { hashAuditLog } from './audit-log-hashing.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const auditFields = [
  '_id', 'societyId', 'actorId', 'action', 'entityType', 'entityId', 'correctsAuditLogId',
  'previousState', 'newState', 'metadata', 'ruleVersionId', 'hashVersion', 'recordHash',
  'blockchainTransactionHash', 'createdAt',
].join(' ');

type AuditFilters = {
  action?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  entityId?: string;
};

export type AuditRecord = {
  _id: { toString(): string };
  societyId: { toString(): string } | null;
  actorId?: { toString(): string } | null;
  action: string;
  entityType?: string;
  entityId?: { toString(): string } | null;
  correctsAuditLogId?: { toString(): string } | null;
  previousState?: unknown;
  newState?: unknown;
  metadata?: unknown;
  ruleVersionId?: { toString(): string } | null;
  hashVersion: number;
  recordHash: string;
  blockchainTransactionHash?: string;
  createdAt: Date;
  [field: string]: unknown;
};

export type AuditRepository = {
  find(filters: AuditFilters, societyId: string | null, skip: number, limit: number): Promise<AuditRecord[]>;
};

const auditRepository: AuditRepository = {
  async find(filters, societyId, skip, limit) {
    const query: Record<string, unknown> = {};
    if (societyId !== null) query.societyId = societyId;
    if (filters.action) query.action = filters.action;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.from || filters.to) {
      query.createdAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    }
    return AuditLog.find(query)
      .select(auditFields)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec() as unknown as Promise<AuditRecord[]>;
  },
};

export function createAuditRouter(
  repository: AuditRepository = auditRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  router.get('/audit', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const user = authorizedReader(request);
      const pagination = parsePagination(request.query);
      const filters = parseFilters(request.query);
      const records = await repository.find(filters, societyScope(user), pagination.skip, pagination.limit);
      response.status(200).json({
        success: true,
        data: records.map(serializeAuditRecord),
        pagination: { page: pagination.page, pageSize: pagination.limit },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/audit/:entityType/:entityId', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const user = authorizedReader(request);
      const entityType = nonEmpty(request.params.entityType, 'entityType');
      const entityId = objectId(request.params.entityId, 'entityId');
      const pagination = parsePagination(request.query);
      const filters = { ...parseFilters(request.query), entityType, entityId };
      const records = await repository.find(filters, societyScope(user), pagination.skip, pagination.limit);
      response.status(200).json({
        success: true,
        data: records.map(serializeAuditRecord),
        pagination: { page: pagination.page, pageSize: pagination.limit },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function authorizedReader(request: Request): CurrentUserContext {
  const user = request.currentUser;
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  if (!['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER'].includes(user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access audit history.');
  }
  if (user.role !== 'SYSTEM_ADMIN' && !user.societyId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access audit history.');
  }
  return user;
}

function societyScope(user: CurrentUserContext): string | null {
  return user.role === 'SYSTEM_ADMIN' ? null : user.societyId;
}

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const page = positiveInteger(query.page, 'page', 1);
  const limit = positiveInteger(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
  if (limit > MAX_PAGE_SIZE) throw new ApiError(400, 'VALIDATION_ERROR', `pageSize must not exceed ${MAX_PAGE_SIZE}.`);
  return { page, limit, skip: (page - 1) * limit };
}

function parseFilters(query: Request['query']): AuditFilters {
  if (query.societyId !== undefined) throw new ApiError(400, 'VALIDATION_ERROR', 'societyId is not a supported audit filter.');
  const filters: AuditFilters = {};
  if (query.action !== undefined) filters.action = nonEmpty(query.action, 'action');
  if (query.entityType !== undefined) filters.entityType = nonEmpty(query.entityType, 'entityType');
  if (query.from !== undefined) filters.from = validDate(query.from, 'from');
  if (query.to !== undefined) filters.to = validDate(query.to, 'to');
  if (filters.from && filters.to && filters.to < filters.from) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'to must not be earlier than from.');
  }
  return filters;
}

function serializeAuditRecord(record: AuditRecord): Record<string, unknown> {
  return {
    _id: record._id.toString(),
    societyId: record.societyId?.toString() ?? null,
    ...(record.actorId === undefined ? {} : { actorId: record.actorId?.toString() ?? null }),
    action: record.action,
    ...(record.entityType === undefined ? {} : { entityType: record.entityType }),
    ...(record.entityId === undefined ? {} : { entityId: record.entityId?.toString() ?? null }),
    ...(record.correctsAuditLogId === undefined ? {} : { correctsAuditLogId: record.correctsAuditLogId?.toString() ?? null }),
    ...(record.previousState === undefined ? {} : { previousState: sanitizeState(record.previousState) }),
    ...(record.newState === undefined ? {} : { newState: sanitizeState(record.newState) }),
    ...(record.metadata === undefined ? {} : { metadata: sanitizeState(record.metadata) }),
    ...(record.ruleVersionId === undefined ? {} : { ruleVersionId: record.ruleVersionId?.toString() ?? null }),
    hashVersion: record.hashVersion,
    recordHash: record.recordHash,
    ...(record.blockchainTransactionHash === undefined ? {} : { blockchainTransactionHash: record.blockchainTransactionHash }),
    createdAt: record.createdAt,
    integrity: verifyIntegrity(record),
  };
}

function verifyIntegrity(record: AuditRecord): { status: 'valid' | 'invalid' | 'unsupported'; computedHash?: string } {
  try {
    const computedHash = hashAuditLog(record as unknown as Record<string, unknown>);
    return computedHash === record.recordHash
      ? { status: 'valid', computedHash }
      : { status: 'invalid', computedHash };
  } catch (error) {
    if (error instanceof RangeError && error.message.includes('Unsupported AuditLog hash version')) {
      return { status: 'unsupported' };
    }
    return { status: 'invalid' };
  }
}

function sanitizeState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeState);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof mongo.BSON.Int32 || value instanceof mongo.BSON.Double) return value.value;
  if (value instanceof mongo.BSON.Long || value instanceof mongo.BSON.Decimal128) return value.toString();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(password|credential|token|secret|jwt|private|api.?key)/i.test(key))
      .map(([key, child]) => [key, sanitizeState(child)]),
  );
}

function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must not be empty.`);
  return value.trim();
}

function validDate(value: unknown, field: string): Date {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
  return date;
}

function positiveInteger(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a positive integer.`);
  }
  return Number(value);
}
