import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Budget } from '../budget/models/Budget.js';
import { Evidence } from '../evidence/models/Evidence.js';
import { Expense } from '../expense/models/Expense.js';
import { Committee } from '../committee/models/Committee.js';
import { CommitteeMember } from '../committee/models/CommitteeMember.js';
import { Society } from '../society/models/Society.js';
import { assertOwnerSocietyAccess } from '../property/owner-society-access.js';
import { Project, PROJECT_STATUSES } from './models/Project.js';
import { ProjectUpdate } from './models/ProjectUpdate.js';

const projectFields = '_id societyId title description category estimatedCost approvedCost finalCost status proposedBy approvalType approvalStatus meetingId vendorId budgetId currentQuotationId governanceResolutionId activeRuleVersionId createdAt updatedAt __v';
const projectDiscoveryFields = '_id title category status createdAt updatedAt';
const projectUpdateFields = '_id societyId projectId kind title description invoiceReference createdBy createdAt';
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
  __v: number;
};

type ProjectUpdateRecord = { _id: { toString(): string }; societyId: { toString(): string }; projectId: { toString(): string }; kind: string; title: string; description: string; invoiceReference?: string; createdBy: { toString(): string }; createdAt: Date };

type ProjectDiscoveryRecord = {
  _id: { toString(): string };
  title: string;
  category: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export function createProjectsRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const readable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'),
  ] as const;
  const projectCreator = [authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER', 'COMMITTEE_MEMBER')] as const;
  const managerOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER')] as const;
  const listable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'),
  ] as const;

  router.get('/projects', ...listable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (user.role === 'OWNER_MEMBER') {
        if (!user.societyId) throw forbidden();
        await assertOwnerSocietyAccess(user, user.societyId);
      }
      const discoveryOnly = user.role === 'RESIDENT';
      const query: Record<string, unknown> = {};
      if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
      else if (request.query.societyId !== undefined) query.societyId = objectId(request.query.societyId, 'societyId');
      if (request.query.status !== undefined) query.status = status(request.query.status);
      if (request.query.category !== undefined) query.category = nonEmpty(request.query.category, 'category');
      const page = positiveInteger(request.query.page, 'page', 1);
      const pageSize = positiveInteger(request.query.pageSize, 'pageSize', 25);
      if (pageSize > 100) throw validation('pageSize must not exceed 100.');
      const records = await Project.find(query).select(discoveryOnly ? projectDiscoveryFields : projectFields)
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean().exec();
      response.json({
        success: true,
        data: discoveryOnly
          ? (records as unknown as ProjectDiscoveryRecord[]).map(serializeProjectDiscovery)
          : (records as unknown as ProjectRecord[]).map(serializeProject),
        pagination: { page, pageSize },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/projects/:projectId/updates', authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'), async (request, response, next) => {
    try {
      const user = currentUser(request); const project = await findProject(request.params.projectId, user);
      if (!project) throw notFound();
      const records = await ProjectUpdate.find({ societyId: project.societyId, projectId: project._id }).select(projectUpdateFields).sort({ createdAt: 1, _id: 1 }).lean().exec() as unknown as ProjectUpdateRecord[];
      const updates = await Promise.all(records.map(async update => ({ ...serializeProjectUpdate(update, user.role !== 'OWNER_MEMBER'), evidence: (await Evidence.find({ societyId: project.societyId, relatedEntityType: 'ProjectUpdate', relatedEntityId: update._id }).select('_id fileName fileType fileSize fileHash category createdAt').sort({ createdAt: 1 }).lean().exec()).map(item => ({ ...item, _id: String(item._id) })) })));
      response.json({ success: true, data: updates });
    } catch (error) { next(normalizeError(error)); }
  });

  router.get('/project-updates/:id', authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'), async (request, response, next) => {
    try {
      const user = currentUser(request); const update = await ProjectUpdate.findById(objectId(request.params.id, 'projectUpdateId')).select(projectUpdateFields).lean().exec() as unknown as ProjectUpdateRecord | null;
      if (!update || !await findProject(update.projectId.toString(), user)) throw notFound();
      const evidence = await Evidence.find({ societyId: update.societyId, relatedEntityType: 'ProjectUpdate', relatedEntityId: update._id }).select('_id fileName fileType fileSize fileHash category createdAt').sort({ createdAt: 1 }).lean().exec();
      response.json({ success: true, data: { ...serializeProjectUpdate(update, user.role !== 'OWNER_MEMBER'), evidence: evidence.map(item => ({ ...item, _id: String(item._id) })) } });
    } catch (error) { next(normalizeError(error)); }
  });

  router.post('/projects/:projectId/updates', ...managerOnly, async (request, response, next) => {
    try {
      const user = currentUser(request); const body = objectBody(request.body);
      if (Object.keys(body).some(key => !['kind', 'title', 'description', 'invoiceReference'].includes(key))) throw validation('The project update contains unsupported fields.');
      if (!['PROGRESS', 'COMPLETION'].includes(String(body.kind))) throw validation('kind must be PROGRESS or COMPLETION.');
      const title = nonEmpty(body.title, 'title'); const description = nonEmpty(body.description, 'description');
      const invoiceReference = body.invoiceReference === undefined ? undefined : nonEmpty(body.invoiceReference, 'invoiceReference');
      if (title.length > 160 || description.length > 5000 || invoiceReference && invoiceReference.length > 240) throw validation('The project update exceeds an allowed field length.');
      if (body.kind === 'COMPLETION' && !invoiceReference) throw validation('A final invoice reference is required for a completion record.');
      const session = await mongoose.startSession();
      try {
        let created: Record<string, unknown> | null = null;
        await session.withTransaction(async () => {
          const project = await findProject(request.params.projectId, user, session);
          if (!project) return;
          if (project.status !== 'IN_PROGRESS') throw new ApiError(409, 'PROJECT_NOT_IN_PROGRESS', 'Progress or completion evidence can only be added while the project is IN_PROGRESS.');
          const locked = await Project.updateOne({ _id: project._id, societyId: project.societyId, status: 'IN_PROGRESS', __v: project.__v }, { $inc: { __v: 1 } }, { session });
          if (locked.modifiedCount !== 1) throw new ApiError(409, 'PROJECT_CHANGED', 'Project state changed. Refresh before adding progress.');
          const [update] = await ProjectUpdate.create([{ societyId: project.societyId, projectId: project._id, kind: body.kind, title, description, ...(invoiceReference ? { invoiceReference } : {}), createdBy: user.userId }], { session });
          await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: body.kind === 'COMPLETION' ? 'PROJECT_COMPLETION_EVIDENCE_RECORDED' : 'PROJECT_PROGRESS_UPDATED', entityType: 'ProjectUpdate', entityId: update._id, newState: { projectId: project._id, kind: update.kind, title: update.title, description: update.description, ...(update.invoiceReference ? { invoiceReference: update.invoiceReference } : {}) } }).save({ session });
          created = serializeProjectUpdate(update.toObject() as unknown as ProjectUpdateRecord, true);
        });
        if (!created) throw notFound();
        response.status(201).json({ success: true, data: created });
      } finally { await session.endSession(); }
    } catch (error) { next(normalizeError(error)); }
  });

  router.get('/projects/:id', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.id, currentUser(request));
      if (!project) throw notFound();
      response.json({ success: true, data: serializeProject(project) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/projects', ...projectCreator, async (request, response, next) => {
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

  router.patch('/projects/:id', ...managerOnly, async (request, response, next) => {
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

  router.post('/projects/:id/submit', ...managerOnly, (request, response, next) =>
    transition(request, response, next, 'SUBMITTED', 'PROJECT_SUBMITTED'));
  router.post('/projects/:id/start', ...managerOnly, (request, response, next) =>
    transition(request, response, next, 'IN_PROGRESS', 'PROJECT_STARTED', 'APPROVED'));
  router.post('/projects/:id/complete', ...managerOnly, async (request, response, next) => {
    try {
      const user = currentUser(request); const body = objectBody(request.body);
      if (Object.keys(body).some(key => !['completionUpdateId', 'finalCost'].includes(key))) throw validation('The completion request contains unsupported fields.');
      const finalCost = monetary(body.finalCost);
      const completionUpdateId = objectId(body.completionUpdateId, 'completionUpdateId');
      const session = await mongoose.startSession();
      try {
        let updated: ProjectRecord | null = null;
        await session.withTransaction(async () => {
          const project = await findProject(request.params.id, user, session);
          if (!project) return;
          if (project.status !== 'IN_PROGRESS') throw validation('Project must be IN_PROGRESS before it can be completed.');
          if (!project.approvedCost) throw new ApiError(409, 'APPROVED_COST_REQUIRED', 'A persisted approved project amount is required before completion.');
          if (compareDecimal(finalCost, project.approvedCost.toString()) > 0) throw new ApiError(409, 'PROJECT_COST_EXCEEDS_APPROVAL', 'Final cost exceeds the approved amount. Record the applicable quotation change and governance re-approval before completion.');
          const completion = await ProjectUpdate.findOne({ _id: completionUpdateId, societyId: project.societyId, projectId: project._id, kind: 'COMPLETION' }).session(session).lean().exec() as ProjectUpdateRecord | null;
          if (!completion) throw new ApiError(409, 'COMPLETION_RECORD_REQUIRED', 'A completion record with a final invoice reference is required.');
          const afterEvidence = await Evidence.exists({ societyId: project.societyId, relatedEntityType: 'ProjectUpdate', relatedEntityId: completion._id, category: 'AFTER_PHOTO' }).session(session);
          if (!afterEvidence) throw new ApiError(409, 'COMPLETION_EVIDENCE_REQUIRED', 'At least one private after-condition photograph must be attached to the completion record.');
          const expenses = await Expense.find({ societyId: project.societyId, projectId: project._id }).select('amount').session(session).lean().exec() as unknown as Array<{ amount: { toString(): string } }>;
          const spent = expenses.reduce((sum, expense) => addDecimal(sum, expense.amount.toString()), '0');
          if (compareDecimal(finalCost, spent) < 0) throw new ApiError(409, 'FINAL_COST_BELOW_RECORDED_EXPENSES', 'Final cost cannot be lower than the total of recorded project expenses.');
          const result = await Project.findOneAndUpdate({ _id: project._id, societyId: project.societyId, status: 'IN_PROGRESS', __v: project.__v }, { $set: { status: 'COMPLETED', finalCost: Types.Decimal128.fromString(finalCost) }, $inc: { __v: 1 } }, { new: true, runValidators: true, session }).select(projectFields).lean().exec();
          if (!result) throw new ApiError(409, 'PROJECT_STATE_CHANGED', 'The project changed during completion. Refresh before retrying.');
          updated = result as unknown as ProjectRecord;
          await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: 'PROJECT_COMPLETED', entityType: 'Project', entityId: project._id, previousState: { status: project.status, finalCost: project.finalCost?.toString() }, newState: { status: 'COMPLETED', finalCost, completionUpdateId, expenseTotal: spent } }).save({ session });
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeProject(updated) });
      } finally { await session.endSession(); }
    } catch (error) { next(normalizeError(error)); }
  });
  router.post('/projects/:id/cancel', ...managerOnly, (request, response, next) =>
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
          const result = await Project.findOneAndUpdate({ _id: existing._id, societyId: existing.societyId, status: existing.status, __v: existing.__v }, { $set: { status: targetStatus }, $inc: { __v: 1 } }, {
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
  const project = await Project.findOne(query).select(projectFields).session(session ?? null).lean().exec() as unknown as ProjectRecord | null;
  if (project) await assertOwnerSocietyAccess(user, project.societyId.toString());
  return project;
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

function serializeProjectDiscovery(project: ProjectDiscoveryRecord): Record<string, unknown> {
  return {
    _id: project._id.toString(),
    title: project.title,
    category: project.category,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function serializeProjectUpdate(update: ProjectUpdateRecord, showActor: boolean): Record<string, unknown> {
  return { _id: update._id.toString(), societyId: update.societyId.toString(), projectId: update.projectId.toString(), kind: update.kind, title: update.title, description: update.description, ...(showActor && update.invoiceReference ? { invoiceReference: update.invoiceReference } : {}), ...(showActor ? { createdBy: update.createdBy.toString() } : {}), createdAt: update.createdAt };
}

function compareDecimal(left: string, right: string): number {
  const places = Math.max(left.split('.')[1]?.length ?? 0, right.split('.')[1]?.length ?? 0);
  const integer = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(places, '0')}`); };
  const a = integer(left); const b = integer(right); return a === b ? 0 : a < b ? -1 : 1;
}

function addDecimal(left: string, right: string): string {
  const places = Math.max(left.split('.')[1]?.length ?? 0, right.split('.')[1]?.length ?? 0);
  const integer = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(places, '0')}`); };
  const sum = (integer(left) + integer(right)).toString().padStart(places + 1, '0');
  return normalizeDecimal(places ? `${sum.slice(0, -places)}.${sum.slice(-places)}` : sum);
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
