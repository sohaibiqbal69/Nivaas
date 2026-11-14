import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Meeting } from '../governance/models/Meeting.js';
import { Project } from '../project/models/Project.js';
import { Notice, NOTICE_CATEGORIES, NOTICE_STATUSES } from './models/Notice.js';

const readRoles = ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'] as const;
const noticeFields = '_id societyId title description category priority status publishedAt expiresAt createdBy attachmentIds meetingId projectId createdAt updatedAt';

type NoticeInput = {
  title?: string;
  description?: string;
  category?: typeof NOTICE_CATEGORIES[number];
  priority?: string;
  expiresAt?: Date | null;
  meetingId?: Types.ObjectId;
  projectId?: Types.ObjectId;
};

export function validateNoticeInput(value: unknown, partial = false): NoticeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be an object.');
  const body = value as Record<string, unknown>;
  const allowed = ['title', 'description', 'category', 'priority', 'expiresAt', 'meetingId', 'projectId'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw validation('The request contains unsupported notice fields.');
  if (!partial && !['title', 'description', 'category', 'priority'].every((field) => Object.hasOwn(body, field))) {
    throw validation('Title, description, category, and priority are required.');
  }
  const input: NoticeInput = {};
  if (Object.hasOwn(body, 'title')) input.title = requiredText(body.title, 'title', 160);
  if (Object.hasOwn(body, 'description')) input.description = requiredText(body.description, 'description', 10000);
  if (Object.hasOwn(body, 'category')) {
    if (typeof body.category !== 'string' || !NOTICE_CATEGORIES.includes(body.category as typeof NOTICE_CATEGORIES[number])) throw validation('category must be a documented notice category.');
    input.category = body.category as typeof NOTICE_CATEGORIES[number];
  }
  if (Object.hasOwn(body, 'priority')) input.priority = requiredText(body.priority, 'priority', 40);
  if (Object.hasOwn(body, 'expiresAt')) {
    if (body.expiresAt !== null && (typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)))) throw validation('expiresAt must be a valid date or null.');
    input.expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt as string);
  }
  for (const field of ['meetingId', 'projectId'] as const) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== 'string' || !Types.ObjectId.isValid(body[field])) throw validation(`${field} must be a valid record ID.`);
      input[field] = new Types.ObjectId(body[field]);
    }
  }
  return input;
}

export function assertNoticeManager(user: CurrentUserContext | undefined, societyId: string): void {
  if (!user || user.role !== 'SOCIETY_MANAGER' || user.societyId !== societyId) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the manager of this society can manage its notices.');
  }
}

export function createNoticesRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const readable = [authenticateRequest, loadAuthenticatedUser, requireRoles(...readRoles)] as const;

  router.get('/notices', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveReadSociety(request, user);
      const category = optionalCategory(request.query.category);
      const priority = typeof request.query.priority === 'string' ? request.query.priority.trim() : undefined;
      const canManage = user.role === 'SOCIETY_MANAGER' && user.societyId === societyId;
      const requestedStatus = typeof request.query.status === 'string' ? request.query.status : undefined;
      if (requestedStatus && !canManage && requestedStatus !== 'PUBLISHED') throw new ApiError(403, 'FORBIDDEN', 'Only a society manager can view unpublished notice records.');
      if (requestedStatus && !NOTICE_STATUSES.includes(requestedStatus as typeof NOTICE_STATUSES[number])) throw validation('status must be a supported notice status.');
      const page = parsePage(request.query.page, 1);
      const limit = Math.min(parsePage(request.query.limit, 20), 100);
      const filter: Record<string, unknown> = { societyId: new Types.ObjectId(societyId) };
      if (category) filter.category = category;
      if (priority) filter.priority = priority;
      if (canManage && requestedStatus) filter.status = requestedStatus;
      else filter.status = 'PUBLISHED';
      if (!canManage || user.role === 'SYSTEM_ADMIN') filter.$or = [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }];
      const [items, total] = await Promise.all([
        Notice.find(filter).select(noticeFields).sort({ publishedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        Notice.countDocuments(filter),
      ]);
      response.json({ success: true, data: { items: items.map(serializeNotice), page, limit, total } });
    } catch (error) { next(error); }
  });

  router.get('/notices/:id', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const notice = await findReadableNotice(request, user);
      if (!notice) throw notFound();
      response.json({ success: true, data: serializeNotice(notice) });
    } catch (error) { next(error); }
  });

  router.post('/notices', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'A society manager account is required.');
      assertNoticeManager(user, user.societyId);
      const input = validateNoticeInput(request.body);
      const session = await mongoose.startSession();
      let created: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          await assertRelatedRecordsBelongToSociety(input, user.societyId!, session);
          const [notice] = await Notice.create([{ ...input, societyId: new Types.ObjectId(user.societyId!), createdBy: new Types.ObjectId(user.userId), status: 'DRAFT' }], { session });
          await writeAudit('NOTICE_CREATED', notice, user.userId, {}, auditState(notice), session);
          created = serializeNotice(notice);
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: created });
    } catch (error) { next(error); }
  });

  router.patch('/notices/:id', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'A society manager account is required.');
      assertNoticeManager(user, user.societyId);
      const input = validateNoticeInput(request.body, true);
      if (!Object.keys(input).length) throw validation('At least one supported notice field is required.');
      const id = parseId(request.params.id);
      const session = await mongoose.startSession();
      let updated: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const notice = await Notice.findOne({ _id: id, societyId: new Types.ObjectId(user.societyId!) }).session(session).exec();
          if (!notice) throw notFound();
          if (notice.status !== 'DRAFT') throw new ApiError(409, 'INVALID_STATE', 'Only a draft notice can be edited.');
          await assertRelatedRecordsBelongToSociety(input, user.societyId!, session);
          const previous = auditState(notice);
          Object.assign(notice, input);
          await notice.save({ session });
          await writeAudit('NOTICE_UPDATED', notice, user.userId, previous, auditState(notice), session);
          updated = serializeNotice(notice);
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: updated });
    } catch (error) { next(error); }
  });

  router.post('/notices/:id/publish', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'A society manager account is required.');
      assertNoticeManager(user, user.societyId);
      const id = parseId(request.params.id);
      const session = await mongoose.startSession();
      let published: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const notice = await Notice.findOne({ _id: id, societyId: new Types.ObjectId(user.societyId!) }).session(session).exec();
          if (!notice) throw notFound();
          if (notice.status !== 'DRAFT') throw new ApiError(409, 'INVALID_STATE', 'Only a draft notice can be published.');
          const now = new Date();
          if (notice.expiresAt && notice.expiresAt <= now) throw validation('A notice expiry must be in the future when publishing.');
          const previous = auditState(notice);
          notice.status = 'PUBLISHED';
          notice.publishedAt = now;
          await notice.save({ session });
          await writeAudit('NOTICE_PUBLISHED', notice, user.userId, previous, auditState(notice), session);
          published = serializeNotice(notice);
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: published });
    } catch (error) { next(error); }
  });

  router.post('/notices/:id/archive', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'A society manager account is required.');
      assertNoticeManager(user, user.societyId);
      const id = parseId(request.params.id);
      const session = await mongoose.startSession();
      let archived: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const notice = await Notice.findOne({ _id: id, societyId: new Types.ObjectId(user.societyId!) }).session(session).exec();
          if (!notice) throw notFound();
          if (notice.status !== 'PUBLISHED') throw new ApiError(409, 'INVALID_STATE', 'Only a published notice can be archived.');
          const previous = auditState(notice);
          notice.status = 'ARCHIVED';
          await notice.save({ session });
          await writeAudit('NOTICE_ARCHIVED', notice, user.userId, previous, auditState(notice), session);
          archived = serializeNotice(notice);
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: archived });
    } catch (error) { next(error); }
  });

  return router;
}

async function findReadableNotice(request: Request, user: CurrentUserContext) {
  const id = parseId(request.params.id);
  const societyId = resolveReadSociety(request, user);
  const filter: Record<string, unknown> = { _id: id, societyId: new Types.ObjectId(societyId) };
  const canManage = user.role === 'SOCIETY_MANAGER' && user.societyId === societyId;
  if (!canManage || user.role === 'SYSTEM_ADMIN') filter.status = 'PUBLISHED';
  const notice = await Notice.findOne(filter).select(noticeFields).lean().exec() as unknown as Record<string, any> | null;
  if (!notice) return null;
  if (notice.status === 'PUBLISHED' && notice.expiresAt && notice.expiresAt <= new Date()) return null;
  return notice;
}

function resolveReadSociety(request: Request, user: CurrentUserContext): string {
  const requested = typeof request.query.societyId === 'string' ? request.query.societyId : undefined;
  if (user.role === 'SYSTEM_ADMIN') {
    if (!requested || !Types.ObjectId.isValid(requested)) throw validation('SYSTEM_ADMIN must supply a valid societyId to read notices.');
    return requested;
  }
  if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'A society association is required.');
  if (requested && requested !== user.societyId) throw new ApiError(403, 'FORBIDDEN', 'The requested society does not match this account.');
  return user.societyId;
}

async function assertRelatedRecordsBelongToSociety(input: NoticeInput, societyId: string, session: mongoose.ClientSession): Promise<void> {
  if (input.meetingId && !await Meeting.exists({ _id: input.meetingId, societyId: new Types.ObjectId(societyId) }).session(session)) throw validation('meetingId must reference a meeting in this society.');
  if (input.projectId && !await Project.exists({ _id: input.projectId, societyId: new Types.ObjectId(societyId) }).session(session)) throw validation('projectId must reference a project in this society.');
}

async function writeAudit(action: string, notice: { _id: Types.ObjectId; societyId: Types.ObjectId }, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({ societyId: notice.societyId, actorId: new Types.ObjectId(actorId), action, entityType: 'NOTICE', entityId: notice._id, previousState, newState }).save({ session });
}

function auditState(notice: { _id: Types.ObjectId; title: string; category: string; priority: string; status: string; publishedAt?: Date | null; expiresAt?: Date | null; meetingId?: Types.ObjectId | null; projectId?: Types.ObjectId | null }): Record<string, unknown> {
  return {
    noticeId: notice._id.toString(), title: notice.title, category: notice.category, priority: notice.priority, status: notice.status,
    ...(notice.publishedAt ? { publishedAt: notice.publishedAt } : {}), ...(notice.expiresAt ? { expiresAt: notice.expiresAt } : {}),
    ...(notice.meetingId ? { meetingId: notice.meetingId.toString() } : {}), ...(notice.projectId ? { projectId: notice.projectId.toString() } : {}),
  };
}

function serializeNotice(notice: Record<string, any>): Record<string, unknown> {
  return {
    _id: notice._id.toString(), societyId: notice.societyId.toString(), title: notice.title, description: notice.description,
    category: notice.category, priority: notice.priority, status: notice.status,
    ...(notice.publishedAt ? { publishedAt: new Date(notice.publishedAt).toISOString() } : {}),
    ...(notice.expiresAt ? { expiresAt: new Date(notice.expiresAt).toISOString() } : {}),
    createdBy: notice.createdBy.toString(), attachmentIds: (notice.attachmentIds ?? []).map((id: Types.ObjectId) => id.toString()),
    ...(notice.meetingId ? { meetingId: notice.meetingId.toString() } : {}), ...(notice.projectId ? { projectId: notice.projectId.toString() } : {}),
    createdAt: new Date(notice.createdAt).toISOString(), updatedAt: new Date(notice.updatedAt).toISOString(),
  };
}

function currentUser(request: Request): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function optionalCategory(value: unknown): typeof NOTICE_CATEGORIES[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !NOTICE_CATEGORIES.includes(value as typeof NOTICE_CATEGORIES[number])) throw validation('category must be a documented notice category.');
  return value as typeof NOTICE_CATEGORIES[number];
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) throw validation(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  return value.trim();
}

function parsePage(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000) throw validation('Pagination values must be positive integers.');
  return Number(value);
}

function parseId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation('The notice ID is invalid.');
  return new Types.ObjectId(value);
}

function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.'); }
