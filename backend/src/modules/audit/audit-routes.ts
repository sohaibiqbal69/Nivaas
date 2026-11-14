import { Router, type Request } from 'express';
import { mongo, Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from './models/AuditLog.js';
import { hashAuditLog } from './audit-log-hashing.js';
import { assertOwnerSocietyAccess, isOwnerTransparencyAuditEntity, OWNER_TRANSPARENCY_AUDIT_ENTITY_TYPES } from '../property/owner-society-access.js';
import { Project } from '../project/models/Project.js';
import { Quotation } from '../quotation/models/Quotation.js';
import { ChangeRequest } from '../quotation/models/ChangeRequest.js';
import { ApprovalDecision } from '../approval/models/ApprovalDecision.js';
import { Vendor } from '../vendor/models/Vendor.js';

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
  search?: string;
  ownerTransparencyOnly?: boolean;
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
  findById(id: Types.ObjectId, societyId: string | null): Promise<AuditRecord | null>;
};

const auditRepository: AuditRepository = {
  async find(filters, societyId, skip, limit) {
    const query: Record<string, unknown> = {};
    if (societyId !== null) query.societyId = societyId;
    if (filters.action) query.action = filters.action;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.ownerTransparencyOnly) {
      if (filters.entityType && !isOwnerTransparencyAuditEntity(filters.entityType)) return [];
      query.entityType = filters.entityType ?? { $in: [...OWNER_TRANSPARENCY_AUDIT_ENTITY_TYPES] };
    }
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.from || filters.to) {
      query.createdAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    }
    const cursor = AuditLog.find(query)
      .select(auditFields)
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec() as unknown as Promise<AuditRecord[]>;
    if (!filters.search) return (await cursor).slice(skip, skip + limit);
    const events = await cursor;
    const expression = new RegExp(escapeRegExp(filters.search), 'i');
    const societyProjects = societyId === null ? {} : { societyId: new Types.ObjectId(societyId) };
    const ids = (type: string) => events.filter(event => event.entityType === type && event.entityId).map(event => new Types.ObjectId(event.entityId!.toString()));
    const projectIds = new Map<string, Types.ObjectId>();
    for (const event of events) {
      if (event.entityType === 'Project' && event.entityId) projectIds.set(event.entityId.toString(), new Types.ObjectId(event.entityId.toString()));
      for (const value of [event.newState, event.previousState, event.metadata]) {
        const id = value && typeof value === 'object' ? (value as Record<string, unknown>).projectId : undefined;
        if (typeof id === 'string' && Types.ObjectId.isValid(id)) projectIds.set(id, new Types.ObjectId(id));
        else if (id instanceof Types.ObjectId) projectIds.set(id.toString(), id);
      }
    }
    const [quotations, changes, decisions, matchedProjects, matchedVendors, matchedQuotationDescriptions] = await Promise.all([
      Quotation.find({ _id: { $in: ids('Quotation') } }).select('_id projectId vendorId description').lean().exec(),
      ChangeRequest.find({ _id: { $in: ids('ChangeRequest') } }).select('_id projectId').lean().exec(),
      ApprovalDecision.find({ _id: { $in: ids('ApprovalDecision') } }).select('_id projectId societyId').lean().exec(),
      Project.find({ ...societyProjects, $or: [{ title: expression }, { description: expression }, { category: expression }] }).select('_id societyId title description category').lean().exec(),
      Vendor.find({ ...(societyId === null ? {} : { societyId: new Types.ObjectId(societyId) }), $or: [{ name: expression }, { companyName: expression }] }).select('_id name companyName societyId').lean().exec(),
      Quotation.find({ description: expression }).select('_id projectId vendorId description').lean().exec(),
    ]);
    for (const related of [...quotations, ...changes, ...decisions]) {
      const projectId = related.projectId;
      if (projectId) projectIds.set(String(projectId), new Types.ObjectId(String(projectId)));
    }
    const matchingVendorIds = matchedVendors.map(vendor => vendor._id as Types.ObjectId);
    const vendorQuotationProjects = matchingVendorIds.length
      ? await Quotation.find({ vendorId: { $in: matchingVendorIds } }).select('projectId').lean().exec()
      : [];
    for (const related of [...matchedQuotationDescriptions, ...vendorQuotationProjects]) {
      if (related.projectId) projectIds.set(String(related.projectId), new Types.ObjectId(String(related.projectId)));
    }
    const scopedProjects = await Project.find({ ...societyProjects, _id: { $in: [...projectIds.values(), ...matchedProjects.map(project => project._id)] } })
      .select('_id title description category societyId').lean().exec();
    const projectMap = new Map(scopedProjects.map(project => [String(project._id), project]));
    const scopedProjectIds = [...projectMap.keys()].map(id => new Types.ObjectId(id));
    // Quotations do not store societyId; scope them through their owning project.
    // This prevents a matching vendor/description in another society from
    // supplying names to a manager's audit search.
    const relatedQuotations = scopedProjectIds.length
      ? await Quotation.find({ projectId: { $in: scopedProjectIds } }).select('_id projectId vendorId description').lean().exec()
      : [];
    const quotationsByProject = new Map<string, typeof relatedQuotations>();
    for (const quotation of relatedQuotations) {
      const key = String(quotation.projectId);
      const records = quotationsByProject.get(key) ?? [];
      records.push(quotation);
      quotationsByProject.set(key, records);
    }
    const allVendorIds = [...new Set([...matchingVendorIds, ...relatedQuotations.map(item => String(item.vendorId))])]
      .filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
    const vendors = await Vendor.find({ _id: { $in: allVendorIds }, ...(societyId === null ? {} : { societyId: new Types.ObjectId(societyId) }) }).select('_id name companyName societyId').lean().exec();
    const vendorMap = new Map(vendors.map(vendor => [String(vendor._id), vendor]));
    const quoteById = new Map(relatedQuotations.map(quote => [String(quote._id), quote]));
    const titles = new Map<string, string>();
    const results = events.filter(event => {
      const direct = `${humanizeEvent(event.action)} ${safeAuditSearchText(event)}`;
      let relatedText = '';
      const projectId = eventProjectId(event, quoteById, changes, decisions);
      const project = projectId ? projectMap.get(projectId) : undefined;
      if (project) { relatedText += ` ${project.title} ${project.description ?? ''} ${project.category ?? ''}`; titles.set(event._id.toString(), `Project: ${project.title}`); }
      for (const quote of projectId ? quotationsByProject.get(projectId) ?? [] : []) {
        const vendor = vendorMap.get(String(quote.vendorId));
        relatedText += ` ${quote.description} ${vendor?.name ?? ''} ${vendor?.companyName ?? ''}`;
        if (event.entityType === 'Quotation' && event.entityId?.toString() === String(quote._id)) {
          titles.set(event._id.toString(), `Quotation: ${vendor?.name ?? quote.description}`);
        }
      }
      const match = expression.test(`${direct} ${relatedText}`);
      if (match && !titles.has(event._id.toString())) {
        const named = extractHumanName(event);
        if (named) titles.set(event._id.toString(), named);
      }
      return match;
    }).map(event => Object.assign(event, { relatedTitle: titles.get(event._id.toString()) }));
    return results.slice(skip, skip + limit) as AuditRecord[];
  },
  async findById(id, societyId) {
    const query: Record<string, unknown> = { _id: id };
    if (societyId !== null) query.societyId = societyId;
    return AuditLog.findOne(query).select(auditFields).lean().exec() as unknown as Promise<AuditRecord | null>;
  },
};

export function createAuditRouter(
  repository: AuditRepository = auditRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
  hasActiveOwnership?: (userId: string, societyId: string, at: Date) => Promise<boolean>,
): Router {
  const router = Router();
  router.get('/audit/events/:auditLogId', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const user = await authorizedReader(request, hasActiveOwnership);
      const id = new Types.ObjectId(objectId(request.params.auditLogId, 'auditLogId'));
      const record = await repository.findById(id, societyScope(user));
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
      if (user.role === 'OWNER_MEMBER' && !isOwnerTransparencyAuditEntity(record.entityType)) {
        throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
      }
      response.status(200).json({ success: true, data: serializeAuditRecord(record) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/audit', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const user = await authorizedReader(request, hasActiveOwnership);
      const pagination = parsePagination(request.query);
      const filters = { ...parseFilters(request.query), ownerTransparencyOnly: user.role === 'OWNER_MEMBER' };
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
      const user = await authorizedReader(request, hasActiveOwnership);
      const entityType = nonEmpty(request.params.entityType, 'entityType');
      const entityId = objectId(request.params.entityId, 'entityId');
      const pagination = parsePagination(request.query);
      if (user.role === 'OWNER_MEMBER' && !isOwnerTransparencyAuditEntity(entityType)) throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
      const filters = { ...parseFilters(request.query), entityType, entityId, ownerTransparencyOnly: user.role === 'OWNER_MEMBER' };
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

async function authorizedReader(
  request: Request,
  hasActiveOwnership?: (userId: string, societyId: string, at: Date) => Promise<boolean>,
): Promise<CurrentUserContext> {
  const user = request.currentUser;
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  if (!['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'].includes(user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access audit history.');
  }
  if (user.role !== 'SYSTEM_ADMIN' && !user.societyId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access audit history.');
  }
  if (user.role === 'OWNER_MEMBER') await assertOwnerSocietyAccess(user, user.societyId!, hasActiveOwnership);
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
  if (query.search !== undefined) filters.search = nonEmpty(query.search, 'search').slice(0, 120);
  if (query.action !== undefined || query.entityType !== undefined) throw new ApiError(400, 'VALIDATION_ERROR', 'Use the single search filter for audit event text.');
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
    eventTitle: humanizeEvent(record.action),
    ...(typeof record.relatedTitle === 'string' ? { relatedTitle: record.relatedTitle } : {}),
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

const searchableKeys = new Set(['title', 'name', 'description', 'category', 'projectTitle', 'quotationTitle', 'vendorName', 'companyName', 'flatNumber', 'buildingName', 'reason', 'summary', 'status', 'approvalType', 'decisionType', 'noticeReference', 'reference', 'changeReason', 'resolutionTitle']);
function safeAuditSearchText(record: AuditRecord): string {
  const parts = [record.action, record.entityType ?? ''];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (searchableKeys.has(key) && typeof child === 'string') parts.push(child);
      else if (depth < 3 && child && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(record.previousState, 0); visit(record.newState, 0); visit(record.metadata, 0);
  return parts.join(' ');
}
function extractHumanName(record: AuditRecord): string | undefined {
  for (const state of [record.newState, record.previousState, record.metadata]) {
    if (!state || typeof state !== 'object') continue;
    const data = state as Record<string, unknown>;
    for (const key of ['title', 'name', 'projectTitle', 'quotationTitle', 'vendorName', 'buildingName', 'flatNumber']) {
      if (typeof data[key] === 'string' && data[key]) return `${record.entityType ?? 'Record'}: ${data[key]}`;
    }
  }
  return undefined;
}
function eventProjectId(record: AuditRecord, quotations: Map<string, any>, changes: any[], decisions: any[]): string | undefined {
  if (record.entityType === 'Project' && record.entityId) return record.entityId.toString();
  if (record.entityType === 'Quotation' && record.entityId) return quotations.get(record.entityId.toString())?.projectId?.toString();
  if (record.entityType === 'ChangeRequest' && record.entityId) return changes.find(item => String(item._id) === record.entityId?.toString())?.projectId?.toString();
  if (record.entityType === 'ApprovalDecision' && record.entityId) return decisions.find(item => String(item._id) === record.entityId?.toString())?.projectId?.toString();
  for (const state of [record.newState, record.previousState, record.metadata]) {
    if (!state || typeof state !== 'object') continue;
    const id = (state as Record<string, unknown>).projectId;
    if (id instanceof Types.ObjectId) return id.toString();
    if (typeof id === 'string' && Types.ObjectId.isValid(id)) return new Types.ObjectId(id).toString();
  }
  return undefined;
}
function humanizeEvent(value: string): string {
  return value.toLocaleLowerCase().split('_').filter(Boolean).map(word => word[0]!.toLocaleUpperCase() + word.slice(1)).join(' ');
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
