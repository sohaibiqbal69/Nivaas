import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Project } from '../project/models/Project.js';
import { SocietyRuleVersion } from '../society/models/SocietyRuleVersion.js';
import { ApprovalDecision } from './models/ApprovalDecision.js';
import { evaluateProjectApproval, serializeApprovalEvaluation } from './approval-engine.js';

const ruleFields = '_id societyId versionNumber status effectiveFrom effectiveTo approvalPolicy majorityRules quorumRules noticeRules votingRules procurementRules financialVisibilityRules complaintRules completionRules createdBy createdAt updatedAt';
const decisionFields = '_id societyId projectId quotationVersionId changeRequestId ruleVersionId evaluatedAmount requiredThreshold approvalType requiredDecisionBody status reason meetingId governanceResolutionId evaluatedAt evaluatedBy createdAt updatedAt ruleSnapshot';

export function createApprovalRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const readable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'),
  ] as const;
  const mutable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER'),
  ] as const;

  router.get('/society/rules', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = await resolveSocietyId(user, request.query.societyId);
      const rule = await SocietyRuleVersion.findOne({ societyId, status: 'ACTIVE' })
        .select(ruleFields).lean().exec();
      if (!rule) throw configurationRequired();
      response.json({ success: true, data: serializeRule(rule as unknown as RuleRecord) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/society/rules/history', ...readable, async (request, response, next) => {
    try {
      const societyId = await resolveSocietyId(currentUser(request), request.query.societyId);
      const rules = await SocietyRuleVersion.find({ societyId }).select(ruleFields)
        .sort({ versionNumber: -1 }).lean().exec();
      response.json({ success: true, data: (rules as unknown as RuleRecord[]).map(serializeRule) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/society/rules/versions/:versionId', ...readable, async (request, response, next) => {
    try {
      const societyId = await resolveSocietyId(currentUser(request), request.query.societyId);
      const rule = await SocietyRuleVersion.findOne({
        _id: objectId(request.params.versionId, 'versionId'), societyId,
      }).select(ruleFields).lean().exec();
      if (!rule) throw notFound();
      response.json({ success: true, data: serializeRule(rule as unknown as RuleRecord) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:id/approval', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.id, currentUser(request));
      if (!project) throw notFound();
      const decision = await ApprovalDecision.findOne({ projectId: project._id, status: { $ne: 'INVALIDATED' } })
        .select(decisionFields).sort({ createdAt: -1 }).lean().exec();
      if (!decision) throw notFound();
      response.json({ success: true, data: serializeDecision(decision as unknown as DecisionRecord) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:id/approval-history', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.id, currentUser(request));
      if (!project) throw notFound();
      const decisions = await ApprovalDecision.find({ projectId: project._id })
        .select(decisionFields).sort({ createdAt: -1 }).lean().exec();
      response.json({ success: true, data: (decisions as unknown as DecisionRecord[]).map(serializeDecision) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:id/submit-for-approval', ...mutable, evaluateRoute(false));
  router.post('/projects/:id/re-evaluate-approval', ...mutable, evaluateRoute(true));

  function evaluateRoute(reEvaluation: boolean) {
    return async (request: Parameters<Router['post']>[1] extends (...args: infer A) => unknown ? A[0] : never,
      response: Parameters<Router['post']>[1] extends (...args: infer A) => unknown ? A[1] : never,
      next: Parameters<Router['post']>[1] extends (...args: infer A) => unknown ? A[2] : never) => {
      try {
        const user = currentUser(request);
        const existing = await findProject(request.params.id, user);
        if (!existing) throw notFound();
        if (!reEvaluation && existing.status !== 'SUBMITTED') {
          throw validation('Only submitted projects can be submitted for approval.');
        }
        if (reEvaluation && !['APPROVAL_REQUIRED', 'COMMITTEE_APPROVAL', 'SGM_REQUIRED', 'RE_APPROVAL', 'APPROVED', 'CHANGE_REQUESTED'].includes(existing.status)) {
          throw validation('The project is not in an approval-evaluation state.');
        }
        const session = await mongoose.startSession();
        try {
          let result: Record<string, unknown> | null = null;
          await session.withTransaction(async () => {
            const project = await findProject(request.params.id, user, session);
            if (!project) return;
            const requestedChangeRequestId = request.body && typeof request.body === 'object'
              && !Array.isArray(request.body) && typeof request.body.changeRequestId === 'string'
              ? objectId(request.body.changeRequestId, 'changeRequestId')
              : undefined;
            const evaluation = await evaluateProjectApproval(
              String(request.params.id),
              user.userId,
              session,
              requestedChangeRequestId,
              reEvaluation,
            );
            const nextStatus = reEvaluation
              ? 'RE_APPROVAL'
              : evaluation.approvalType === 'SGM_REQUIRED' ? 'SGM_REQUIRED' : 'COMMITTEE_APPROVAL';
            const updated = await Project.findOneAndUpdate(
              { _id: project._id, status: project.status },
              {
                status: nextStatus,
                approvalType: evaluation.approvalType,
                approvalStatus: 'REQUIRED',
                activeRuleVersionId: new Types.ObjectId(evaluation.ruleVersionId),
              },
              { new: true, runValidators: true, session },
            ).select('_id societyId status approvalType approvalStatus activeRuleVersionId').lean().exec() as unknown as {
              status: string;
              approvalType: string;
            } | null;
            if (!updated) throw new ApiError(409, 'APPROVAL_STATE_CHANGED', 'The project changed before approval evaluation could be applied.');
            const decision = evaluation.decision as unknown as Record<string, unknown>;
            await new AuditLog({
              societyId: project.societyId,
              actorId: user.userId,
              action: reEvaluation ? 'PROJECT_APPROVAL_RE_EVALUATED' : 'PROJECT_SUBMITTED_FOR_APPROVAL',
              entityType: 'ApprovalDecision',
              entityId: decision._id,
              ruleVersionId: decision.ruleVersionId,
              previousState: {
                status: project.status,
                approvalType: project.approvalType,
                approvalStatus: project.approvalStatus,
                activeRuleVersionId: project.activeRuleVersionId,
              },
              newState: {
                status: updated.status,
                approvalType: updated.approvalType,
                evaluatedAmount: evaluation.evaluatedAmount,
                threshold: evaluation.threshold,
                requiredDecisionBody: evaluation.requiredDecisionBody,
              },
              metadata: { approvalDecisionId: decision._id, ruleSnapshot: decision.ruleSnapshot },
            }).save({ session });
            result = serializeApprovalEvaluation(evaluation);
          });
          if (!result) throw notFound();
          response.status(reEvaluation ? 200 : 201).json({ success: true, data: result });
        } finally {
          await session.endSession();
        }
      } catch (error) {
        next(error);
      }
    };
  }

  return router;
}

type RuleRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  versionNumber: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  approvalPolicy?: unknown;
  [key: string]: unknown;
};

type DecisionRecord = Record<string, unknown> & {
  _id: { toString(): string };
  societyId: { toString(): string };
  projectId: { toString(): string };
  ruleVersionId: { toString(): string };
  evaluatedAmount: { toString(): string };
  requiredThreshold: { toString(): string };
  evaluatedAt: Date;
  evaluatedBy: { toString(): string };
};

type ProjectReference = {
  _id: { toString(): string };
  societyId: { toString(): string };
  status: string;
  approvalType?: string;
  approvalStatus?: string;
  activeRuleVersionId?: { toString(): string };
};

async function resolveSocietyId(user: CurrentUserContext, requestedSocietyId: unknown): Promise<string> {
  if (user.role !== 'SYSTEM_ADMIN') {
    if (!user.societyId) throw forbidden();
    return user.societyId;
  }
  if (typeof requestedSocietyId !== 'string' || !Types.ObjectId.isValid(requestedSocietyId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid societyId is required for platform-wide rule access.');
  }
  return new Types.ObjectId(requestedSocietyId).toString();
}

async function findProject(id: unknown, user: CurrentUserContext, session?: mongoose.ClientSession): Promise<ProjectReference | null> {
  const query: Record<string, unknown> = { _id: objectId(id, 'projectId') };
  if (user.role !== 'SYSTEM_ADMIN') query.societyId = user.societyId;
  return Project.findOne(query).select('_id societyId status approvalType approvalStatus activeRuleVersionId')
    .session(session ?? null).lean().exec() as unknown as Promise<ProjectReference | null>;
}

function serializeRule(rule: RuleRecord): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rule };
  result._id = rule._id.toString();
  result.societyId = rule.societyId.toString();
  result.createdBy = (rule.createdBy as { toString(): string }).toString();
  return result;
}

function serializeDecision(decision: DecisionRecord): Record<string, unknown> {
  return {
    _id: decision._id.toString(),
    societyId: decision.societyId.toString(),
    projectId: decision.projectId.toString(),
    ...(decision.quotationVersionId ? { quotationVersionId: String(decision.quotationVersionId) } : {}),
    ...(decision.changeRequestId ? { changeRequestId: String(decision.changeRequestId) } : {}),
    ruleVersionId: decision.ruleVersionId.toString(),
    evaluatedAmount: decision.evaluatedAmount.toString(),
    threshold: decision.requiredThreshold.toString(),
    approvalType: decision.approvalType,
    requiredDecisionBody: decision.requiredDecisionBody,
    status: decision.status,
    reason: decision.reason,
    evaluatedAt: decision.evaluatedAt,
    evaluatedBy: decision.evaluatedBy.toString(),
    ruleSnapshot: decision.ruleSnapshot,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function currentUser(request: { currentUser?: CurrentUserContext }): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value).toString();
}

function validation(message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message);
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}

function forbidden(): ApiError {
  return new ApiError(403, 'FORBIDDEN', 'You are not authorized to access this resource.');
}

function configurationRequired(): ApiError {
  return new ApiError(409, 'GOVERNANCE_CONFIGURATION_REQUIRED', 'The society has no active governance rule version.');
}
