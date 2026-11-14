import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Project } from '../project/models/Project.js';
import { assertOwnerSocietyAccess } from '../property/owner-society-access.js';
import { SocietyRuleVersion } from '../society/models/SocietyRuleVersion.js';
import { ApprovalDecision } from './models/ApprovalDecision.js';
import { CommitteeApprovalVote } from './models/CommitteeApprovalVote.js';
import { CommitteeApprovalResult } from './models/CommitteeApprovalResult.js';
import { CommitteeApprovalElectorate } from './models/CommitteeApprovalElectorate.js';
import { Committee } from '../committee/models/Committee.js';
import { CommitteeMember } from '../committee/models/CommitteeMember.js';
import { User } from '../users/models/User.js';
import { evaluateProjectApproval, serializeApprovalEvaluation } from './approval-engine.js';
import { calculateCommitteeOutcome, type CommitteeDecision, type CommitteeApprovalPolicy } from './committee-outcome.js';

const ruleFields = '_id societyId versionNumber status effectiveFrom effectiveTo approvalPolicy majorityRules quorumRules noticeRules votingRules governancePolicy procurementRules financialVisibilityRules complaintRules completionRules createdBy changeReason supportingDocumentReference policyChangeAuditLogId createdAt updatedAt';
const decisionFields = '_id societyId projectId quotationVersionId changeRequestId ruleVersionId evaluatedAmount requiredThreshold approvalType requiredDecisionBody status reason meetingId governanceResolutionId evaluatedAt evaluatedBy createdAt updatedAt ruleSnapshot';

export function createApprovalRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const readable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'),
  ] as const;
  const mutable = [
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SOCIETY_MANAGER'),
  ] as const;

  router.get('/committee-approvals/pending-for-me', authenticateRequest, loadAuthenticatedUser, requireRoles('COMMITTEE_MEMBER'), async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (!user.societyId) throw forbidden();
      const now = new Date();
      const appointments = await CommitteeMember.find({ userId: user.userId, status: 'ACTIVE', $and: [
        { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gt: now } }] },
      ] }).select('committeeId').lean().exec() as unknown as Array<{ committeeId: Types.ObjectId }>;
      if (!appointments.length || !await User.exists({ _id: user.userId, societyId: user.societyId, status: 'ACTIVE' })) {
        response.json({ success: true, data: [] });
        return;
      }
      const committeeIds = appointments.map((item) => item.committeeId);
      const activeCommittees = await Committee.find({ _id: { $in: committeeIds }, societyId: new Types.ObjectId(user.societyId), status: 'ACTIVE' }).select('_id').lean().exec();
      const activeCommitteeIds = new Set(activeCommittees.map((item) => String(item._id)));
      if (!activeCommitteeIds.size) {
        response.json({ success: true, data: [] });
        return;
      }

      const societyId = new Types.ObjectId(user.societyId);
      const projects = await Project.find({ societyId, status: { $in: ['COMMITTEE_APPROVAL', 'RE_APPROVAL'] }, approvalType: 'COMMITTEE_APPROVAL' })
        .select('_id title status updatedAt').sort({ updatedAt: -1, _id: -1 }).lean().exec() as Array<Record<string, any>>;
      if (!projects.length) {
        response.json({ success: true, data: [] });
        return;
      }
      const projectIds = projects.map((project) => project._id);
      const decisions = await ApprovalDecision.find({ societyId, projectId: { $in: projectIds }, approvalType: 'COMMITTEE_APPROVAL', requiredDecisionBody: 'COMMITTEE', status: { $in: ['REQUIRED', 'RE_EVALUATED'] } })
        .select('_id projectId').sort({ createdAt: -1, _id: -1 }).lean().exec() as Array<Record<string, any>>;
      const latestByProject = new Map<string, Record<string, any>>();
      for (const decision of decisions) if (!latestByProject.has(String(decision.projectId))) latestByProject.set(String(decision.projectId), decision);
      const currentDecisions = [...latestByProject.values()];
      if (!currentDecisions.length) {
        response.json({ success: true, data: [] });
        return;
      }
      const decisionIds = currentDecisions.map((decision) => decision._id);
      const electorates = await CommitteeApprovalElectorate.find({ approvalDecisionId: { $in: decisionIds } }).select('approvalDecisionId committeeId eligibleMemberIds').lean().exec() as Array<Record<string, any>>;
      const electorateByDecision = new Map(electorates.map((electorate) => [String(electorate.approvalDecisionId), electorate]));
      const eligibleDecisions = currentDecisions.filter((decision) => {
        const electorate = electorateByDecision.get(String(decision._id));
        if (!electorate) return activeCommitteeIds.size > 0;
        return activeCommitteeIds.has(String(electorate.committeeId)) && electorate.eligibleMemberIds.some((memberId: Types.ObjectId) => String(memberId) === user.userId);
      });
      const eligibleIds = eligibleDecisions.map((decision) => decision._id);
      const votes = eligibleIds.length ? await CommitteeApprovalVote.find({ approvalDecisionId: { $in: eligibleIds }, proposalVersionId: { $in: eligibleIds }, voterId: new Types.ObjectId(user.userId) }).select('approvalDecisionId').lean().exec() as Array<Record<string, any>> : [];
      const votedIds = new Set(votes.map((vote) => String(vote.approvalDecisionId)));
      const projectById = new Map(projects.map((project) => [String(project._id), project]));
      const pending = eligibleDecisions.filter((decision) => !votedIds.has(String(decision._id))).flatMap((decision) => {
        const project = projectById.get(String(decision.projectId));
        return project ? [{ projectId: String(project._id), approvalDecisionId: String(decision._id), title: String(project.title), status: String(project.status), updatedAt: project.updatedAt }] : [];
      });
      response.json({ success: true, data: pending });
    } catch (error) { next(error); }
  });

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

  router.get('/projects/:id/committee-approval', ...readable, async (request, response, next) => {
    try {
      const project = await findProject(request.params.id, currentUser(request));
      if (!project) throw notFound();
      const decision = await ApprovalDecision.findOne({ projectId: project._id, societyId: project.societyId, approvalType: 'COMMITTEE_APPROVAL', status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }).sort({ createdAt: -1 }).lean().exec() as Record<string, any> | null;
      if (!decision) throw notFound();
      const votes = await CommitteeApprovalVote.find({ approvalDecisionId: decision._id, proposalVersionId: decision._id }).lean().exec() as Array<Record<string, any>>;
      const electorate = await CommitteeApprovalElectorate.findOne({ approvalDecisionId: decision._id }).lean().exec() as Record<string, any> | null;
      const totalCommitteeMembers = Number(electorate?.eligibleCount ?? 0);
      response.json({ success: true, data: { ...committeeSummary(decision, votes, totalCommitteeMembers), result: await CommitteeApprovalResult.findOne({ approvalDecisionId: decision._id }).lean().exec() } });
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/committee-approval/decisions', authenticateRequest, loadAuthenticatedUser, requireRoles('COMMITTEE_MEMBER'), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const project = await findProject(request.params.id, user);
      if (!project || !user.societyId) throw notFound();
      const body = parseObjectBody(request.body);
      if (!['APPROVE', 'REJECT'].includes(String(body.decision))) throw validation('decision must be APPROVE or REJECT.');
      const rationale = optionalRationale(body.rationale);
      const decision = await ApprovalDecision.findOne({ projectId: project._id, societyId: project.societyId, approvalType: 'COMMITTEE_APPROVAL', requiredDecisionBody: 'COMMITTEE', status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }).sort({ createdAt: -1 }).lean().exec() as Record<string, any> | null;
      if (!decision) throw new ApiError(409, 'COMMITTEE_DECISION_NOT_REQUIRED', 'The current approval rule does not permit a committee decision for this proposal.');
      const latest = await ApprovalDecision.findOne({ projectId: project._id, societyId: project.societyId, status: { $ne: 'INVALIDATED' } }).sort({ createdAt: -1 }).select('_id').lean().exec() as { _id: Types.ObjectId } | null;
      if (!latest || String(latest._id) !== String(decision._id)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'A newer approval evaluation exists.');
      const now = new Date();
      const electorateSession = await mongoose.startSession();
      const electorateBox: { value: Record<string, any> | null } = { value: null };
      try {
        await electorateSession.withTransaction(async () => {
          electorateBox.value = await CommitteeApprovalElectorate.findOne({ approvalDecisionId: decision._id }).session(electorateSession).lean().exec() as Record<string, any> | null;
          if (electorateBox.value) return;
        const appointments = await CommitteeMember.find({ status: 'ACTIVE', $and: [
          { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
          { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gt: now } }] },
        ] }).select('committeeId userId').session(electorateSession).lean().exec() as unknown as Array<{ committeeId: Types.ObjectId; userId: Types.ObjectId }>;
        const activeCommittees = appointments.length ? await Committee.find({ _id: { $in: appointments.map(item => item.committeeId) }, societyId: project.societyId, status: 'ACTIVE' }).select('_id').session(electorateSession).lean().exec() : [];
        const committeeIds = activeCommittees.map(item => String(item._id));
        const societyUsers = appointments.length ? await User.find({ _id: { $in: appointments.map(item => item.userId) }, societyId: project.societyId, status: 'ACTIVE' }).select('_id').session(electorateSession).lean().exec() : [];
        const activeUserIds = new Set(societyUsers.map(item => String(item._id)));
        const eligibleAppointments = appointments.filter(item => committeeIds.includes(String(item.committeeId)) && activeUserIds.has(String(item.userId)));
        const actorAppointment = eligibleAppointments.find(item => String(item.userId) === user.userId);
        if (!actorAppointment) throw new ApiError(403, 'COMMITTEE_MEMBERSHIP_REQUIRED', 'An active same-society committee appointment and user account are required.');
        const electedIds = [...new Set(eligibleAppointments.filter(item => String(item.committeeId) === String(actorAppointment.committeeId)).map(item => String(item.userId)))].map(id => new Types.ObjectId(id));
        const [createdElectorate] = await CommitteeApprovalElectorate.create([{ societyId: project.societyId, projectId: project._id, approvalDecisionId: decision._id, proposalVersionId: decision._id,
          committeeId: actorAppointment.committeeId, eligibleMemberIds: electedIds, eligibleCount: electedIds.length, ruleVersionId: decision.ruleVersionId, generatedAt: now }], { session: electorateSession });
        electorateBox.value = createdElectorate.toObject() as Record<string, any>;
        await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: 'COMMITTEE_APPROVAL_ELECTORATE_SNAPSHOTTED', entityType: 'ApprovalDecision', entityId: decision._id, ruleVersionId: decision.ruleVersionId, previousState: {}, newState: { electorateId: electorateBox.value._id, committeeId: electorateBox.value.committeeId, eligibleCount: electorateBox.value.eligibleCount, generatedAt: now } }).save({ session: electorateSession });
        });
      } finally { await electorateSession.endSession(); }
      const electorate = electorateBox.value;
      if (!electorate) throw new ApiError(503, 'COMMITTEE_ELECTORATE_UNAVAILABLE', 'The committee electorate could not be confirmed. Refresh before retrying.');
      const currentAppointment = await CommitteeMember.exists({ userId: user.userId, committeeId: electorate.committeeId, status: 'ACTIVE', $and: [
        { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gt: now } }] },
      ] });
      if (!currentAppointment || !await User.exists({ _id: user.userId, societyId: project.societyId, status: 'ACTIVE' })) throw new ApiError(403, 'COMMITTEE_MEMBERSHIP_REQUIRED', 'A current same-society committee appointment and active user account are required.');
      if (!electorate.eligibleMemberIds.some((id: Types.ObjectId) => String(id) === user.userId)) throw new ApiError(403, 'COMMITTEE_MEMBERSHIP_REQUIRED', 'The authenticated member is not in the immutable committee electorate for this proposal version.');
      const session = await mongoose.startSession();
      let recordedId: Types.ObjectId | undefined;
      try {
        await session.withTransaction(async () => {
          const [result] = await CommitteeApprovalVote.create([{ societyId: project.societyId, projectId: project._id, approvalDecisionId: decision._id, proposalVersionId: decision._id, committeeId: electorate!.committeeId, voterId: new Types.ObjectId(user.userId), decision: body.decision, ...(rationale ? { rationale } : {}), decidedAt: new Date() }], { session }) as unknown as Array<{ _id: Types.ObjectId; decidedAt: Date }>;
          await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: 'COMMITTEE_PROJECT_DECISION_RECORDED', entityType: 'ApprovalDecision', entityId: decision._id, ruleVersionId: decision.ruleVersionId, previousState: {}, newState: { approvalDecisionId: decision._id, proposalVersionId: decision._id, committeeId: electorate!.committeeId, decision: body.decision, decisionId: result._id, decidedAt: result.decidedAt, rationale: rationale ?? null } }).save({ session });
          recordedId = result._id;
        });
      } finally { await session.endSession(); }
      if (!recordedId) throw new ApiError(503, 'COMMITTEE_DECISION_FAILED', 'Committee decision could not be confirmed. Refresh before retrying.');
      const votes = await CommitteeApprovalVote.find({ approvalDecisionId: decision._id, proposalVersionId: decision._id }).lean().exec() as Array<Record<string, any>>;
      const totalCommitteeMembers = Number(electorate.eligibleCount);
      response.status(201).json({ success: true, data: { decisionId: String(recordedId), ...committeeSummary(decision, votes, totalCommitteeMembers) } });
    } catch (error) { next(isDuplicateKeyError(error) ? new ApiError(409, 'DUPLICATE_COMMITTEE_DECISION', 'This committee member has already decided this proposal version.') : error); }
  });

  router.post('/projects/:id/committee-approval/finalize', authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER'), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const project = await findProject(request.params.id, user);
      if (!project) throw notFound();
      const session = await mongoose.startSession();
      let finalized: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const decision = await ApprovalDecision.findOne({ projectId: project._id, societyId: project.societyId, approvalType: 'COMMITTEE_APPROVAL', status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }).sort({ createdAt: -1 }).session(session).lean().exec() as Record<string, any> | null;
          if (!decision) throw new ApiError(409, 'COMMITTEE_DECISION_NOT_REQUIRED', 'No pending committee approval exists.');
          const latest = await ApprovalDecision.findOne({ projectId: project._id, societyId: project.societyId, status: { $ne: 'INVALIDATED' } }).sort({ createdAt: -1 }).session(session).select('_id').lean().exec() as { _id: Types.ObjectId } | null;
          if (!latest || String(latest._id) !== String(decision._id)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'A newer approval evaluation exists.');
          const votes = await CommitteeApprovalVote.find({ approvalDecisionId: decision._id, proposalVersionId: decision._id }).session(session).lean().exec() as Array<Record<string, any>>;
          const electorate = await CommitteeApprovalElectorate.findOne({ approvalDecisionId: decision._id, projectId: project._id, societyId: project.societyId, proposalVersionId: decision._id }).session(session).lean().exec() as Record<string, any> | null;
          const committeeId = electorate?.committeeId;
          if (!electorate || !committeeId || votes.some(vote => String(vote.committeeId) !== String(committeeId) || !electorate.eligibleMemberIds.some((id: Types.ObjectId) => String(id) === String(vote.voterId)))) throw new ApiError(409, 'COMMITTEE_DECISION_INTEGRITY_ERROR', 'Committee decisions do not match the immutable committee electorate.');
          const totalCommitteeMembers = Number(electorate.eligibleCount);
          const summary = committeeSummary(decision, votes, totalCommitteeMembers);
          if (!summary.quorumMet) throw new ApiError(409, 'COMMITTEE_QUORUM_NOT_MET', `Committee quorum is ${summary.quorumRequired}; ${summary.participatingMembers} eligible committee members have decided.`);
          if (summary.outcome === 'PENDING') throw new ApiError(409, 'COMMITTEE_MAJORITY_NOT_MET', 'The configured approval majority has not been reached.');
          const status = summary.outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED';
          const updatedDecision = await ApprovalDecision.updateOne({ _id: decision._id, societyId: project.societyId, status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }, { $set: { status: 'COMPLETED' } }, { session });
          if (updatedDecision.modifiedCount !== 1) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The approval record changed during finalization.');
          const projectUpdate = await Project.updateOne({ _id: project._id, societyId: project.societyId, status: { $in: ['COMMITTEE_APPROVAL', 'RE_APPROVAL'] }, activeRuleVersionId: decision.ruleVersionId }, { $set: { status, approvalStatus: status, ...(status === 'APPROVED' ? { approvedCost: decision.evaluatedAmount } : {}) } }, { session });
          if (projectUpdate.modifiedCount !== 1) throw new ApiError(409, 'PROJECT_APPROVAL_STATE_CHANGED', 'The project or active approval rule changed during committee finalization.');
          const result = await CommitteeApprovalResult.create([{ societyId: project.societyId, projectId: project._id, approvalDecisionId: decision._id, proposalVersionId: decision._id, committeeId, totalCommitteeMembers: summary.totalCommitteeMembers, participatingMembers: summary.participatingMembers, approveCount: summary.approveCount, rejectCount: summary.rejectCount, quorumRequired: summary.quorumRequired, quorumMet: true, outcome: summary.outcome, ruleSnapshot: decision.ruleSnapshot, finalizedBy: user.userId, finalizedAt: new Date() }], { session });
          await new AuditLog({ societyId: project.societyId, actorId: user.userId, action: 'COMMITTEE_PROJECT_DECISION_FINALIZED', entityType: 'ApprovalDecision', entityId: decision._id, ruleVersionId: decision.ruleVersionId, previousState: { projectStatus: project.status, approvalStatus: project.approvalStatus }, newState: { projectStatus: status, outcome: summary.outcome, approveCount: summary.approveCount, rejectCount: summary.rejectCount, participatingMembers: summary.participatingMembers, totalCommitteeMembers: summary.totalCommitteeMembers, quorumRequired: summary.quorumRequired, resultId: result[0]._id } }).save({ session });
          finalized = { projectId: String(project._id), approvalDecisionId: String(decision._id), status, ...summary };
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: finalized });
    } catch (error) { next(error); }
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
    await assertOwnerSocietyAccess(user, user.societyId);
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
  const project = await Project.findOne(query).select('_id societyId status approvalType approvalStatus activeRuleVersionId')
    .session(session ?? null).lean().exec() as unknown as ProjectReference | null;
  if (project) await assertOwnerSocietyAccess(user, project.societyId.toString());
  return project;
}

function committeeSummary(decision: Record<string, any>, votes: Array<Record<string, any>>, totalCommitteeMembers: number): Record<string, unknown> {
  const policy = decision.ruleSnapshot?.approvalPolicy?.committeeApproval ?? { quorumNumerator: 2, quorumDenominator: 3, quorumMaximum: null, majorityNumerator: 1, majorityDenominator: 2, majorityComparison: 'STRICTLY_GREATER' };
  const outcome = calculateCommitteeOutcome(totalCommitteeMembers, votes.map(vote => vote.decision as CommitteeDecision), {
    quorumNumerator: Number(policy.quorumNumerator), quorumDenominator: Number(policy.quorumDenominator),
    ...(policy.quorumMaximum === null || policy.quorumMaximum === undefined ? {} : { quorumMaximum: Number(policy.quorumMaximum) }),
    majorityNumerator: Number(policy.majorityNumerator), majorityDenominator: Number(policy.majorityDenominator),
    majorityComparison: policy.majorityComparison as CommitteeApprovalPolicy['majorityComparison'],
  });
  return { approvalDecisionId: String(decision._id), proposalVersionId: String(decision._id), committeeId: votes[0]?.committeeId ? String(votes[0].committeeId) : null,
    ...outcome,
    policySnapshot: policy };
}

function optionalRationale(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > 2000) throw validation('rationale must be text up to 2000 characters.');
  return value.trim();
}
function parseObjectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('A JSON object is required.');
  return value as Record<string, unknown>;
}
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}

function serializeRule(rule: RuleRecord): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rule };
  result._id = rule._id.toString();
  result.societyId = rule.societyId.toString();
  result.createdBy = (rule.createdBy as { toString(): string }).toString();
  if (rule.policyChangeAuditLogId) result.policyChangeAuditLogId = (rule.policyChangeAuditLogId as { toString(): string }).toString();
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
