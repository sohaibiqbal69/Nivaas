import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { ApprovalDecision } from '../approval/models/ApprovalDecision.js';
import { Project } from '../project/models/Project.js';
import { ChangeRequest } from './models/ChangeRequest.js';
import { Quotation } from './models/Quotation.js';

const quotationFields = '_id projectId vendorId versionNumber amount description documentEvidenceId status previousQuotationId supersededAt submittedBy submittedAt createdAt updatedAt';
const changeRequestFields = '_id projectId quotationId originalAmount additionalAmount newAmount reason supportingEvidenceIds requestedBy status requiredApprovalType approvalMeetingId approvalDecisionId resultingQuotationId createdAt updatedAt';

type QuotationRecord = {
  _id: { toString(): string };
  projectId: { toString(): string };
  vendorId: { toString(): string };
  versionNumber: number;
  amount: { toString(): string };
  description: string;
  documentEvidenceId?: { toString(): string };
  status: string;
  previousQuotationId?: { toString(): string };
  supersededAt?: Date;
  submittedBy?: { toString(): string };
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ChangeRequestRecord = {
  _id: { toString(): string };
  projectId: { toString(): string };
  quotationId: { toString(): string };
  originalAmount: { toString(): string };
  additionalAmount: { toString(): string };
  newAmount: { toString(): string };
  reason: string;
  supportingEvidenceIds: Array<{ toString(): string }>;
  requestedBy: { toString(): string };
  status: string;
  requiredApprovalType?: string;
  approvalMeetingId?: { toString(): string };
  approvalDecisionId?: { toString(): string };
  resultingQuotationId?: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
};

export function createQuotationRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const authorized = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER'),
  ] as const;
  const readable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'),
  ] as const;

  router.get('/projects/:projectId/quotations', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.projectId, currentUser(request));
      if (!project) throw notFound();
      const quotations = await Quotation.find({ projectId: project._id }).select(quotationFields)
        .sort({ versionNumber: 1 }).lean().exec();
      response.json({ success: true, data: (quotations as unknown as QuotationRecord[]).map(serializeQuotation) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/quotations/:id', ...readable, async (request, response, next) => {
    try {
      const quotation = await findQuotation(request.params.id, currentUser(request));
      if (!quotation) throw notFound();
      response.json({ success: true, data: serializeQuotation(quotation) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/projects/:projectId/quotations', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const project = await findProject(request.params.projectId, user);
      if (!project) throw notFound();
      if (project.status === 'CLOSED' || project.status === 'CANCELLED') {
        throw validation('Quotations cannot be added to a closed or cancelled project.');
      }
      const data = validateQuotationBody(request.body, false);
      const session = await mongoose.startSession();
      try {
        let created: QuotationRecord | null = null;
        await session.withTransaction(async () => {
          const latest = await Quotation.findOne({ projectId: project._id }).sort({ versionNumber: -1 }).session(session).lean().exec();
          if (latest) throw validation('Use a quotation change request to create a revision of an existing quotation.');
          const [quotation] = await Quotation.create([{
            projectId: project._id,
            ...data,
            versionNumber: 1,
            status: 'DRAFT',
          }], { session });
          await writeAudit('QUOTATION_CREATED', project, quotation, user.userId, {}, quotationState(quotation), session);
          created = quotation.toObject() as unknown as QuotationRecord;
        });

        if (!created) throw new Error('Quotation creation did not return a persisted record.');
        response.status(201).json({ success: true, data: serializeQuotation(created) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/quotations/:id/select', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const quotation = await findQuotation(request.params.id, user);
      if (!quotation) throw notFound();
      if (!['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(quotation.status)) {
        throw validation('Only an active quotation can be selected.');
      }
      const session = await mongoose.startSession();
      try {
        let selected: QuotationRecord | null = null;
        await session.withTransaction(async () => {
          const project = await findProject(quotation.projectId.toString(), user, session);
          if (!project) throw notFound();
          const current = await Quotation.findOne({ _id: quotation._id, projectId: project._id })
            .select(quotationFields).session(session).lean().exec() as unknown as QuotationRecord | null;
          if (!current || !['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(current.status)) {
            throw validation('Only an active quotation can be selected.');
          }
          const existingDecisions = await ApprovalDecision.find({
            projectId: project._id,
            status: { $ne: 'INVALIDATED' },
          }).sort({ createdAt: -1 }).session(session).lean().exec();
          const existingDecision = existingDecisions[0];
          const previous = project.currentQuotationId
            ? await Quotation.findOneAndUpdate(
              { _id: project.currentQuotationId, projectId: project._id, status: 'SELECTED' },
              { status: 'SUPERSEDED', supersededAt: new Date() },
              { new: true, session },
            ).select(quotationFields).lean().exec() as unknown as QuotationRecord | null
            : null;
          const updatedProject = await Project.findOneAndUpdate(
            { _id: project._id, status: project.status, currentQuotationId: project.currentQuotationId ?? null },
            existingDecision
              ? {
                currentQuotationId: current._id,
                status: 'RE_APPROVAL',
                approvalStatus: 'REQUIRED',
              }
              : { currentQuotationId: current._id },
            { new: true, runValidators: true, session },
          ).select('_id societyId status currentQuotationId').lean().exec() as unknown as {
            status: string; currentQuotationId?: { toString(): string };
          } | null;
          if (!updatedProject) throw new ApiError(409, 'QUOTATION_SELECTION_CONFLICT', 'The project changed before quotation selection completed.');
          const result = await Quotation.findOneAndUpdate(
            { _id: current._id, projectId: project._id, status: current.status },
            { status: 'SELECTED' },
            { new: true, runValidators: true, session },
          ).select(quotationFields).lean().exec();
          if (!result) throw new ApiError(409, 'QUOTATION_SELECTION_CONFLICT', 'The quotation changed before selection completed.');
          selected = result as unknown as QuotationRecord;
          if (existingDecision) {
            await ApprovalDecision.updateMany(
              { projectId: project._id, status: { $ne: 'INVALIDATED' } },
              { $set: { status: 'INVALIDATED' } },
              { session },
            ).exec();
            for (const decision of existingDecisions as unknown as Array<{
              _id: { toString(): string };
              status: string;
              ruleVersionId: { toString(): string };
            }>) {
              await writeApprovalInvalidationAudit(decision, project, user.userId, session);
            }
            const { evaluateProjectApproval } = await import('../approval/approval-engine.js');
            const evaluation = await evaluateProjectApproval(
              project._id.toString(), user.userId, session, undefined, true,
            );
            await Project.updateOne(
              { _id: project._id, status: 'RE_APPROVAL' },
              {
                $set: {
                  approvalType: evaluation.approvalType,
                  approvalStatus: 'REQUIRED',
                  activeRuleVersionId: new Types.ObjectId(evaluation.ruleVersionId),
                },
              },
              { session },
            ).exec();
            await writeApprovalAudit(evaluation, project, user.userId, session);
          }
          await writeAudit('QUOTATION_SELECTED', project, selected, user.userId, quotationState(current), quotationState(selected), session);
          await writeProjectAudit('PROJECT_QUOTATION_SELECTED', project, user.userId, {
            status: project.status, currentQuotationId: project.currentQuotationId,
          }, {
            status: updatedProject.status, currentQuotationId: updatedProject.currentQuotationId,
            previousQuotationId: previous?._id,
          }, session);
        });
        if (!selected) throw notFound();
        response.json({ success: true, data: serializeQuotation(selected) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.patch('/quotations/:id', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const quotation = await findQuotation(request.params.id, user);
      if (!quotation) throw notFound();
      if (quotation.status !== 'DRAFT') throw validation('Only draft quotations can be edited.');
      const update = validateQuotationBody(request.body, true);
      const session = await mongoose.startSession();
      try {
        let updated: QuotationRecord | null = null;
        await session.withTransaction(async () => {
          const currentQuotation = await Quotation.findOne({ _id: quotation._id, status: 'DRAFT' })
            .select(quotationFields).session(session).lean().exec() as unknown as QuotationRecord | null;
          if (!currentQuotation) return;
          const result = await Quotation.findOneAndUpdate({ _id: quotation._id, status: 'DRAFT' }, update, {
            new: true, runValidators: true, session,
          }).select(quotationFields).lean().exec();
          if (!result) return;
          updated = result as unknown as QuotationRecord;
          const project = await findProject(quotation.projectId.toString(), user, session);
          if (!project) throw notFound();
          await writeAudit('QUOTATION_UPDATED', project, updated, user.userId, quotationState(currentQuotation), quotationState(updated), session);
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeQuotation(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/projects/:projectId/change-requests', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.projectId, currentUser(request));
      if (!project) throw notFound();
      const records = await ChangeRequest.find({ projectId: project._id }).select(changeRequestFields)
        .sort({ createdAt: -1 }).lean().exec();
      response.json({ success: true, data: (records as unknown as ChangeRequestRecord[]).map(serializeChangeRequest) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/quotations/:quotationId/change-requests', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const quotation = await findQuotation(request.params.quotationId, user);
      if (!quotation) throw notFound();
      if (quotation.status === 'SUPERSEDED' || quotation.status === 'REJECTED') {
        throw validation('A revision cannot be requested for this quotation.');
      }
      const data = validateChangeRequestBody(request.body);
      const session = await mongoose.startSession();
      try {
        let created: ChangeRequestRecord | null = null;
        await session.withTransaction(async () => {
          const project = await findProject(quotation.projectId.toString(), user, session);
          if (!project) return;
          const currentQuotation = await Quotation.findOne({
            _id: quotation._id,
            projectId: project._id,
          }).select(quotationFields).session(session).lean().exec() as unknown as QuotationRecord | null;
          if (!currentQuotation) throw notFound();
          if (currentQuotation.status === 'SUPERSEDED' || currentQuotation.status === 'REJECTED') {
            throw validation('A revision cannot be requested for this quotation.');
          }
          const [changeRequest] = await ChangeRequest.create([{
            projectId: project._id,
            quotationId: currentQuotation._id,
            originalAmount: decimal(currentQuotation.amount.toString()),
            additionalAmount: decimal(data.additionalAmount),
            newAmount: decimal(add(currentQuotation.amount.toString(), data.additionalAmount)),
            reason: data.reason,
            supportingEvidenceIds: data.supportingEvidenceIds,
            requestedBy: user.userId,
            status: 'DRAFT',
          }], { session });
          await writeAudit('QUOTATION_CHANGE_REQUEST_CREATED', project, changeRequest, user.userId, {}, changeRequestState(changeRequest), session);
          created = changeRequest.toObject() as unknown as ChangeRequestRecord;
        });
        if (!created) throw notFound();
        response.status(201).json({ success: true, data: serializeChangeRequest(created) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/change-requests/:id', ...readable, async (request, response, next) => {
    try {
      const record = await ChangeRequest.findById(objectId(request.params.id, 'changeRequestId')).select(changeRequestFields).lean().exec() as unknown as ChangeRequestRecord | null;
      if (!record || !(await findProject(record.projectId.toString(), currentUser(request)))) throw notFound();
      response.json({ success: true, data: serializeChangeRequest(record) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/change-requests/:id/submit', ...authorized, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const record = await ChangeRequest.findById(objectId(request.params.id, 'changeRequestId')).lean().exec() as unknown as ChangeRequestRecord | null;
      if (!record || !(await findProject(record.projectId.toString(), user))) throw notFound();
      if (record.status !== 'DRAFT') throw validation('Only draft change requests can be submitted.');
      const session = await mongoose.startSession();
      try {
        let updated: ChangeRequestRecord | null = null;
        await session.withTransaction(async () => {
          const currentRecord = await ChangeRequest.findOne({ _id: record._id, status: 'DRAFT' })
            .select(changeRequestFields).session(session).lean().exec() as unknown as ChangeRequestRecord | null;
          if (!currentRecord) return;
          const result = await ChangeRequest.findOneAndUpdate({ _id: record._id, status: 'DRAFT' }, { status: 'SUBMITTED' }, {
            new: true, runValidators: true, session,
          }).select(changeRequestFields).lean().exec();
          if (!result) return;
          updated = result as unknown as ChangeRequestRecord;
          const project = await findProject(record.projectId.toString(), user, session);
          if (!project) throw notFound();
          if (!project.currentQuotationId || project.currentQuotationId.toString() !== record.quotationId.toString()) {
            throw validation('Only the currently selected quotation can be submitted for revision.');
          }
          const selectedQuotation = await Quotation.exists({
            _id: record.quotationId,
            projectId: project._id,
            status: 'SELECTED',
          }).session(session);
          if (!selectedQuotation) throw validation('Only the currently selected quotation can be submitted for revision.');
          const { evaluateProjectApproval } = await import('../approval/approval-engine.js');
          const evaluation = await evaluateProjectApproval(
            record.projectId.toString(), user.userId, session, record._id.toString(), true,
          );
          const projectUpdate = await Project.findOneAndUpdate(
            { _id: project._id, status: project.status },
            {
              status: 'RE_APPROVAL',
              approvalType: evaluation.approvalType,
              approvalStatus: 'REQUIRED',
              activeRuleVersionId: new Types.ObjectId(evaluation.ruleVersionId),
            },
            { new: true, runValidators: true, session },
          ).select('_id societyId status approvalType approvalStatus activeRuleVersionId').lean().exec();
          if (!projectUpdate) throw new ApiError(409, 'APPROVAL_STATE_CHANGED', 'The project changed before revision submission completed.');
          await writeAudit('QUOTATION_CHANGE_REQUEST_SUBMITTED', project, updated, user.userId, changeRequestState(currentRecord), {
            ...changeRequestState(updated), approvalType: evaluation.approvalType, evaluatedAmount: evaluation.evaluatedAmount,
          }, session);
          await writeApprovalAudit(evaluation, project, user.userId, session);
        });
        if (!updated) throw notFound();
        response.json({ success: true, data: serializeChangeRequest(updated) });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}

type ProjectReference = { _id: { toString(): string }; societyId: { toString(): string }; status?: string; currentQuotationId?: { toString(): string } };
async function findProject(id: unknown, user: CurrentUserContext, session?: mongoose.ClientSession): Promise<ProjectReference | null> {
  const query: Record<string, unknown> = { _id: objectId(id, 'projectId') };
  if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
  return Project.findOne(query).select('_id societyId status currentQuotationId')
    .session(session ?? null).lean().exec() as unknown as Promise<ProjectReference | null>;
}
async function findQuotation(id: unknown, user: CurrentUserContext): Promise<QuotationRecord | null> {
  const quotation = await Quotation.findById(objectId(id, 'quotationId')).select(quotationFields).lean().exec() as unknown as QuotationRecord | null;
  if (!quotation) return null;
  return (await findProject(quotation.projectId.toString(), user)) ? quotation : null;
}
function validateQuotationBody(value: unknown, partial: boolean): Record<string, unknown> {
  const body = objectBody(value);
  const allowed = new Set(['vendorId', 'amount', 'description', 'documentEvidenceId']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw validation('Unsupported quotation fields.');
  if (partial && Object.keys(body).length === 0) throw validation('At least one editable quotation field is required.');
  const result: Record<string, unknown> = {};
  if ('vendorId' in body) result.vendorId = objectId(body.vendorId, 'vendorId');
  if ('amount' in body) result.amount = decimal(monetary(body.amount, 'amount'));
  if ('description' in body) result.description = nonEmpty(body.description, 'description');
  if ('documentEvidenceId' in body) result.documentEvidenceId = objectId(body.documentEvidenceId, 'documentEvidenceId');
  if (!partial && ['vendorId', 'amount', 'description'].some((field) => result[field] === undefined)) throw validation('vendorId, amount, and description are required.');
  return result;
}
function validateChangeRequestBody(value: unknown): { additionalAmount: string; reason: string; supportingEvidenceIds: string[] } {
  const body = objectBody(value);
  const allowed = new Set(['additionalAmount', 'reason', 'supportingEvidenceIds']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw validation('Unsupported change request fields.');
  const supportingEvidenceIds = body.supportingEvidenceIds === undefined ? [] : arrayOfObjectIds(body.supportingEvidenceIds, 'supportingEvidenceIds');
  return { additionalAmount: monetary(body.additionalAmount, 'additionalAmount', true), reason: nonEmpty(body.reason, 'reason'), supportingEvidenceIds };
}
function serializeQuotation(record: QuotationRecord): Record<string, unknown> {
  return {
    _id: record._id.toString(), projectId: record.projectId.toString(), vendorId: record.vendorId.toString(),
    versionNumber: record.versionNumber, amount: record.amount.toString(), description: record.description,
    ...(record.documentEvidenceId ? { documentEvidenceId: record.documentEvidenceId.toString() } : {}),
    status: record.status, ...(record.previousQuotationId ? { previousQuotationId: record.previousQuotationId.toString() } : {}),
    ...(record.supersededAt ? { supersededAt: record.supersededAt } : {}),
    ...(record.submittedBy ? { submittedBy: record.submittedBy.toString() } : {}),
    ...(record.submittedAt ? { submittedAt: record.submittedAt } : {}),
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}
function serializeChangeRequest(record: ChangeRequestRecord): Record<string, unknown> {
  return {
    _id: record._id.toString(), projectId: record.projectId.toString(), quotationId: record.quotationId.toString(),
    originalAmount: record.originalAmount.toString(), additionalAmount: record.additionalAmount.toString(),
    newAmount: record.newAmount.toString(), reason: record.reason,
    supportingEvidenceIds: record.supportingEvidenceIds.map((id) => id.toString()), requestedBy: record.requestedBy.toString(),
    status: record.status, ...(record.resultingQuotationId ? { resultingQuotationId: record.resultingQuotationId.toString() } : {}),
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}
function quotationState(record: { versionNumber: number; amount: { toString(): string }; status: string }): Record<string, unknown> {
  return { versionNumber: record.versionNumber, amount: record.amount.toString(), status: record.status };
}
function changeRequestState(record: { originalAmount: { toString(): string }; additionalAmount: { toString(): string }; newAmount: { toString(): string }; status: string }): Record<string, unknown> {
  return { originalAmount: record.originalAmount.toString(), additionalAmount: record.additionalAmount.toString(), newAmount: record.newAmount.toString(), status: record.status };
}
async function writeAudit(action: string, project: ProjectReference, entity: { _id: { toString(): string } }, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({ societyId: project.societyId, actorId, action, entityType: action.startsWith('QUOTATION_CHANGE') ? 'ChangeRequest' : 'Quotation', entityId: entity._id, previousState, newState }).save({ session });
}
async function writeProjectAudit(action: string, project: ProjectReference, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>, session: mongoose.ClientSession): Promise<void> {
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
async function writeApprovalAudit(evaluation: { decision: { _id: { toString(): string } }; approvalType: string; evaluatedAmount: string; threshold: string; ruleVersionId: string }, project: ProjectReference, actorId: string, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    societyId: project.societyId,
    actorId,
    action: 'APPROVAL_EVALUATED',
    entityType: 'ApprovalDecision',
    entityId: evaluation.decision._id,
    ruleVersionId: evaluation.ruleVersionId,
    previousState: {},
    newState: {
      approvalType: evaluation.approvalType,
      evaluatedAmount: evaluation.evaluatedAmount,
      threshold: evaluation.threshold,
    },
  }).save({ session });
}
async function writeApprovalInvalidationAudit(decision: { _id: { toString(): string }; status: string; ruleVersionId: { toString(): string } }, project: ProjectReference, actorId: string, session: mongoose.ClientSession): Promise<void> {
  await new AuditLog({
    societyId: project.societyId,
    actorId,
    action: 'APPROVAL_INVALIDATED',
    entityType: 'ApprovalDecision',
    entityId: decision._id,
    ruleVersionId: decision.ruleVersionId,
    previousState: { status: decision.status },
    newState: { status: 'INVALIDATED' },
  }).save({ session });
}
function monetary(value: unknown, field: string, positive = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw validation(`${field} must be a ${positive ? 'positive' : 'non-negative'} decimal amount.`);
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || (positive && /^0(?:\.0*)?$/.test(text))) throw validation(`${field} must be a ${positive ? 'positive' : 'non-negative'} decimal amount.`);
  if (text.replace('.', '').replace(/^0+/, '').length > 34) throw validation(`${field} exceeds the supported decimal precision.`);
  return normalizeDecimal(text);
}
function add(left: string, right: string): string {
  const places = Math.max(left.split('.')[1]?.length ?? 0, right.split('.')[1]?.length ?? 0);
  const scale = (value: string) => `${value.split('.')[0]}${(value.split('.')[1] ?? '').padEnd(places, '0')}`;
  const result = BigInt(scale(left)) + BigInt(scale(right));
  const digits = result.toString().padStart(places + 1, '0');
  return normalizeDecimal(places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}
function decimal(value: string): mongoose.Types.Decimal128 { return mongoose.Types.Decimal128.fromString(value); }
function normalizeDecimal(value: string): string { const [whole, fraction = ''] = value.split('.'); const trimmed = fraction.replace(/0+$/, ''); return trimmed ? `${whole}.${trimmed}` : whole; }
function currentUser(request: Request): CurrentUserContext { if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'); return request.currentUser; }
function objectBody(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be a JSON object.'); return value as Record<string, unknown>; }
function objectId(value: unknown, field: string): string { if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`); return new Types.ObjectId(value).toString(); }
function arrayOfObjectIds(value: unknown, field: string): string[] { if (!Array.isArray(value)) throw validation(`${field} must be an array of ObjectIds.`); return value.map((item) => objectId(item, field)); }
function nonEmpty(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw validation(`${field} must be a non-empty string.`); return value.trim(); }
function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.'); }
function normalizeError(error: unknown): unknown { return error; }
