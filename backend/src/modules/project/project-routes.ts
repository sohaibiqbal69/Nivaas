import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Budget } from '../budget/models/Budget.js';
import { Committee } from '../committee/models/Committee.js';
import { CommitteeMember } from '../committee/models/CommitteeMember.js';
import { Society } from '../society/models/Society.js';
import { Project, PROJECT_STATUSES } from './models/Project.js';

const projectFields = '_id societyId title description category estimatedCost approvedCost finalCost status proposedBy approvalType approvalStatus meetingId vendorId budgetId currentQuotationId governanceResolutionId activeRuleVersionId createdAt updatedAt';
const governedFields = new Set(['status', 'approvalStatus', 'approvalType', 'approvedAt', 'finalApprovalResult']);
const terminalStatuses = new Set(['CLOSED', 'CANCELLED', 'COMPLETED']);

type ProjectRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  title: string;
  description: string;
  category: string;
  estimatedCost: { toString(): string };
  approvedCost?: { toString(): string };
  finalCost?: { toString(): string };
  status: string;
  proposedBy: { toString(): string };
  approvalType?: string;
  approvalStatus?: string;
  meetingId?: { toString(): string };
  vendorId?: { toString(): string };
  budgetId?: { toString(): string };
  currentQuotationId?: { toString(): string };
  governanceResolutionId?: { toString(): string };
  activeRuleVersionId?: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
};

export function createProjectsRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const authorized = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER'),
  ] as const;

  router.get('/projects', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const query: Record<string, unknown> = {};
      if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
      else if (request.query.societyId !== undefined) query.societyId = objectId(request.query.societyId, 'societyId');
      if (request.query.status !== undefined) query.status = status(request.query.status);
      if (request.query.category !== undefined) query.category = nonEmpty(request.query.category, 'category');
      const page = positiveInteger(request.query.page, 'page', 1);
      const pageSize = positiveInteger(request.query.pageSize, 'pageSize', 25);
      if (pageSize > 100) throw validation('pageSize must not exceed 100.');
      const records = await Project.find(query).select(projectFields)
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean().exec();
      response.json({
        success: true,
        data: (records as unknown as ProjectRecord[]).map(serializeProject),
        pagination: { page, pageSize },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/projects/:id', ...authorized, async (request, response, next) => {
    try {
      const project = await findProject(request.params.id, currentUser(request));
      if (!project) throw notFound();
      response.json({ success: true, data: serializeProject(project) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/projects', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const data = validateProjectBody(request.body, false);
      const societyId = data.societyId as string;
      if (user.role === 'SOCIETY_MANAGER' && societyId !== user.societyId) throw forbidden();
      if (user.role === 'COMMITTEE_MEMBER') {
        if (societyId !== user.societyId || !(await isAuthorizedCommitteeMember(user.userId, societyId))) throw forbidden();
      }
      if (!(await Society.exists({ _id: societyId }))) throw validation('The society does not exist.');
      if (data.budgetId !== undefined) await validateBudget(societyId, data.budgetId as string);
      const session = await mongoose.startSession();
      try {
        let created: ProjectRecord | null = null;
        await session.withTransaction(async () => {
          const [project] = await Project.create([{
            ...data,
            proposedBy: user.userId,
            status: 'DRAFT',
          }], { session });
          await audit('PROJECT_CREATED', project, user.userId, {}, projectState(project), session);
          created = project.toObject() as unknown as ProjectRecord;
        });
        if (!created) throw new Error('Project creation did not return a persisted record.');
        response.status(201).json({ success: true, data: serializeProject(created) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.patch('/projects/:id', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const update = validateProjectBody(request.body, true);
      if (Object.keys(request.body ?? {}).some((field) => governedFields.has(field))) {
        throw validation('Governed project fields must be changed through workflow actions.');
      }
      const session = await mongoose.startSession();
      try {
        let updated: ProjectRecord | null = null;
        await session.withTransaction(async () => {
          const existing = await findProject(request.params.id, user, session);
          if (!existing) return;
          ensureEditable(existing);
          if (update.societyId !== undefined || update.proposedBy !== undefined) throw validation('Project relationships cannot be changed.');
          if (update.budgetId !== undefined) await validateBudget(existing.societyId.toString(), update.budgetId as string, session);
          const result = await Project.findByIdAndUpdate(existing._id, update, {
            new: true, runValidators: true, session,
          }).select(projectFields).lean().exec();
          if (!result) return;
          updated = result as unknown as ProjectRecord;
          await audit('PROJECT_UPDATED', existing, user.userId, projectState(existing), projectState(updated), session);
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeProject(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/projects/:id/submit', ...authorized, (request, response, next) =>
    transition(request, response, next, 'SUBMITTED', 'PROJECT_SUBMITTED'));
  router.post('/projects/:id/start', ...authorized, (request, response, next) =>
    transition(request, response, next, 'IN_PROGRESS', 'PROJECT_STARTED', 'APPROVED'));
  router.post('/projects/:id/complete', ...authorized, (request, response, next) =>
    transition(request, response, next, 'COMPLETED', 'PROJECT_COMPLETED', 'IN_PROGRESS'));
  router.post('/projects/:id/cancel', ...authorized, (request, response, next) =>
    transition(request, response, next, 'CANCELLED', 'PROJECT_CANCELLED'));

  return router;

  async function transition(
    request: Request,
    response: Response,
    next: NextFunction,
    targetStatus: string,
    action: string,
    requiredStatus?: string,
  ): Promise<void> {
    try {
      const user = currentUser(request);
      const session = await mongoose.startSession();
      try {
        let updated: ProjectRecord | null = null;
        await session.withTransaction(async () => {
          const existing = await findProject(request.params.id, user, session);
          if (!existing) return;
          if (requiredStatus && existing.status !== requiredStatus) {
            throw validation(`Project must be ${requiredStatus} before it can be ${targetStatus}.`);
          }
          if (targetStatus === 'CANCELLED' && terminalStatuses.has(existing.status)) {
            throw validation('This project cannot be cancelled from its current status.');
          }
          if (targetStatus === 'SUBMITTED' && existing.status !== 'DRAFT') {
            throw validation('Only draft projects can be submitted.');
          }
          const result = await Project.findByIdAndUpdate(existing._id, { status: targetStatus }, {
            new: true, runValidators: true, session,
          }).select(projectFields).lean().exec();
          if (!result) return;
          updated = result as unknown as ProjectRecord;
          await audit(action, existing, user.userId, projectState(existing), projectState(updated), session);
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeProject(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  }
}

async function findProject(id: unknown, user: CurrentUserContext, session?: mongoose.ClientSession): Promise<ProjectRecord | null> {
  const query: Record<string, unknown> = { _id: objectId(id, 'projectId') };
  if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
  return Project.findOne(query).select(projectFields).session(session ?? null).lean().exec() as unknown as Promise<ProjectRecord | null>;
}

async function isAuthorizedCommitteeMember(userId: string, societyId: string): Promise<boolean> {
  const memberships = await CommitteeMember.find({ userId, status: 'ACTIVE' }).select('committeeId').lean().exec();
  const committeeIds = memberships.map((item) => item.committeeId);
  return committeeIds.length > 0 && Boolean(await Committee.exists({ _id: { $in: committeeIds }, societyId }));
}

async function validateBudget(societyId: string, budgetId: string, session?: mongoose.ClientSession): Promise<void> {
  if (!(await Budget.exists({ _id: budgetId, societyId }).session(session ?? null))) {
    throw validation('The budget does not exist or does not belong to the society.');
  }
}

async function audit(action: string, project: { _id: { toString(): string }; societyId: { toString(): string } }, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    societyId: project.societyId,
    actorId,
    action,
    entityType: 'Project',
    entityId: project._id,
    previousState,
    newState,
  }).save({ session });
}

function serializeProject(project: ProjectRecord): Record<string, unknown> {
  const result: Record<string, unknown> = {
    _id: project._id.toString(),
    societyId: project.societyId.toString(),
    title: project.title,
    description: project.description,
    category: project.category,
    estimatedCost: project.estimatedCost.toString(),
    status: project.status,
    proposedBy: project.proposedBy.toString(),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  for (const field of ['approvedCost', 'finalCost', 'approvalType', 'approvalStatus', 'meetingId', 'vendorId', 'budgetId', 'currentQuotationId', 'governanceResolutionId', 'activeRuleVersionId'] as const) {
    const value = project[field];
    if (value !== undefined) result[field] = typeof value === 'object' && value !== null && 'toString' in value ? value.toString() : value;
  }
  return result;
}

function validateProjectBody(value: unknown, partial: boolean): Record<string, unknown> {
  const body = objectBody(value);
  const allowed = new Set(['societyId', 'title', 'description', 'category', 'estimatedCost', 'budgetId']);
  if (Object.keys(body).some((field) => !allowed.has(field))) throw validation('Unsupported project fields.');
  if (partial && Object.keys(body).length === 0) throw validation('At least one editable project field is required.');
  const result: Record<string, unknown> = {};
  if ('societyId' in body) result.societyId = objectId(body.societyId, 'societyId');
  if ('title' in body) result.title = nonEmpty(body.title, 'title');
  if ('description' in body) result.description = nonEmpty(body.description, 'description');
  if ('category' in body) result.category = nonEmpty(body.category, 'category');
  if ('estimatedCost' in body) result.estimatedCost = monetary(body.estimatedCost);
  if ('budgetId' in body) result.budgetId = objectId(body.budgetId, 'budgetId');
  if (!partial && ['societyId', 'title', 'description', 'category', 'estimatedCost'].some((field) => result[field] === undefined)) {
    throw validation('societyId, title, description, category, and estimatedCost are required.');
  }
  return result;
}

function monetary(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw validation('estimatedCost must be a non-negative decimal amount.');
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || text.replace('.', '').replace(/^0+/, '').length > 34) {
    throw validation('estimatedCost must be a valid non-negative decimal amount.');
  }
  return normalizeDecimal(text);
}
function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function currentUser(request: Request): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}
function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be a JSON object.');
  return value as Record<string, unknown>;
}
function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}
function status(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_STATUSES.includes(value as typeof PROJECT_STATUSES[number])) throw validation('status must be a valid project status.');
  return value;
}
function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw validation(`${field} must be a non-empty string.`);
  return value.trim();
}
function positiveInteger(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) throw validation(`${field} must be a positive integer.`);
  return Number(value);
}
function ensureEditable(project: ProjectRecord): void {
  if (project.status !== 'DRAFT' && project.status !== 'REJECTED') throw validation('Only draft or rejected projects can be updated.');
}
function projectState(project: ProjectRecord): Record<string, unknown> {
  return {
    title: project.title,
    category: project.category,
    estimatedCost: project.estimatedCost.toString(),
    status: project.status,
    ...(project.budgetId ? { budgetId: project.budgetId.toString() } : {}),
  };
}
function validation(message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message);
}
function forbidden(): ApiError {
  return new ApiError(403, 'FORBIDDEN', 'You do not have permission to administer this project.');
}
function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}
function normalizeError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
    return validation('The project could not be created because a uniqueness constraint was violated.');
  }
  return error;
}
