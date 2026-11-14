import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Membership } from '../membership/models/Membership.js';
import { User } from '../users/models/User.js';
import { SocietyRuleVersion } from '../society/models/SocietyRuleVersion.js';
import { Society } from '../society/models/Society.js';
import { hashApprovalPolicyCommitment, validateApprovalThresholdInput } from '../society/approval-policy.js';
import { ApprovalDecision } from '../approval/models/ApprovalDecision.js';
import { Project } from '../project/models/Project.js';
import { Quotation } from '../quotation/models/Quotation.js';
import { ChangeRequest } from '../quotation/models/ChangeRequest.js';
import { GovernanceVote, GOVERNANCE_VOTE_VALUES } from './models/GovernanceVote.js';
import { AuditLogProofService } from '../blockchain/audit-log-proof-service.js';
import { GovernanceEligibilitySnapshot } from './models/GovernanceEligibilitySnapshot.js';
import { GovernanceResolution } from './models/GovernanceResolution.js';
import { OfflineResolutionRecordModel } from './models/OfflineResolutionRecord.js';
import { Meeting, MEETING_TYPES } from './models/Meeting.js';
import {
  assertGovernancePolicyConfigured,
  assertResolutionCanOpen,
  deriveEligibleMemberIds,
} from './governance-foundation.js';
import {
  GOVERNANCE_RESOLUTION_TYPES,
  GOVERNANCE_DECISION_BODIES,
  GOVERNANCE_VOTING_METHODS,
  createGeneralBodyStarterPolicy,
  type GovernancePolicyConfiguration,
} from './models/GovernancePolicyConfiguration.js';
import { calculateGeneralBodyOutcome, assertResolutionCanFinalize, countRecordedVotes, makeVoteFromAuthenticatedUser } from './governance-foundation.js';

const writableRoles = ['SOCIETY_MANAGER', 'COMMITTEE_MEMBER'] as const;
const readableRoles = [...writableRoles, 'OWNER_MEMBER', 'RESIDENT'] as const;

export function createGovernanceRouter(
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
  policyProofSubmitter: ((auditLogId: string) => Promise<Record<string, unknown>>) | undefined = undefined,
): Router {
  const router = Router();
  const readable = [authenticateRequest, loadAuthenticatedUser, requireRoles(...readableRoles)] as const;
  const writable = [authenticateRequest, loadAuthenticatedUser, requireRoles(...writableRoles)] as const;

  router.post('/society/rules/approval-threshold', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (user.role !== 'SOCIETY_MANAGER' || !user.societyId) {
        throw new ApiError(403, 'FORBIDDEN', 'Only the authenticated society manager can change this society approval threshold.');
      }
      const input = validateApprovalThresholdInput(request.body);
      const body = objectBody(request.body);
      if (body.societyId !== undefined && String(body.societyId) !== user.societyId) {
        throw new ApiError(403, 'FORBIDDEN', 'The requested society does not match the authenticated manager.');
      }
      const societyId = new Types.ObjectId(user.societyId);
      const session = await mongoose.startSession();
      let created: Record<string, unknown> | null = null;
      let auditLogId: string | undefined;
      try {
        await session.withTransaction(async () => {
          const society = await Society.findById(societyId).session(session).lean().exec() as Record<string, any> | null;
          if (!society) throw notFound();
          const active = await SocietyRuleVersion.findOne({ societyId, status: 'ACTIVE' }).session(session).lean().exec() as Record<string, any> | null;
          if (!active || !society.activeRuleVersionId || String(society.activeRuleVersionId) !== String(active._id)) {
            throw policyUnresolved('The society active rule pointer and active rule version must agree before configuration can be changed.');
          }
          const previousThreshold = active.approvalPolicy?.threshold;
          if (typeof previousThreshold !== 'string') throw policyUnresolved('The active rule version has no valid approval threshold.');
          const previousPolicy = active.approvalPolicy as Record<string, unknown>;
          const approvalPolicy = { ...previousPolicy, threshold: input.threshold,
            ...(input.committeeApproval ? { committeeApproval: input.committeeApproval } : {}),
          };
          if (JSON.stringify(previousPolicy) === JSON.stringify(approvalPolicy)) throw new ApiError(409, 'APPROVAL_POLICY_UNCHANGED', 'The submitted approval policy is already active.');

          const effectiveFrom = new Date();
          const versionNumber = Number(active.versionNumber) + 1;
          const versionId = new Types.ObjectId();
          const canonicalConfigurationHash = hashApprovalPolicyCommitment({ societyId: societyId.toString(), versionNumber, threshold: input.threshold, committeeApproval: approvalPolicy.committeeApproval as never });
          const audit = new AuditLog({
            societyId, actorId: new Types.ObjectId(user.userId), action: 'SOCIETY_APPROVAL_THRESHOLD_CHANGED',
            entityType: 'SocietyRuleVersion', entityId: versionId, ruleVersionId: versionId,
            previousState: { ruleVersionId: active._id, versionNumber: active.versionNumber, approvalPolicy: active.approvalPolicy },
            newState: { ruleVersionId: versionId, versionNumber, approvalPolicy, effectiveFrom },
            metadata: {
              policyType: approvalPolicy.committeeApproval ? 'PROJECT_APPROVAL_POLICY' : 'PROJECT_SPENDING_APPROVAL_THRESHOLD', commitmentVersion: approvalPolicy.committeeApproval ? 2 : 1,
              canonicalConfigurationHash,
              ...(input.reason ? { reason: input.reason } : {}),
              ...(input.supportingDocumentReference ? { supportingDocumentReference: input.supportingDocumentReference } : {}),
            },
          });
          await audit.save({ session });
          auditLogId = audit._id.toString();

          const superseded = await SocietyRuleVersion.updateOne(
            { _id: active._id, societyId, status: 'ACTIVE' },
            { $set: { status: 'SUPERSEDED', effectiveTo: effectiveFrom } }, { session },
          );
          if (superseded.modifiedCount !== 1) throw new ApiError(409, 'RULE_VERSION_CHANGED', 'The active society rule version changed during configuration.');

          const copiedRules = Object.fromEntries([
            'majorityRules', 'quorumRules', 'noticeRules', 'votingRules', 'governancePolicy',
            'procurementRules', 'financialVisibilityRules', 'complaintRules', 'completionRules',
          ].filter((field) => active[field] !== undefined).map((field) => [field, active[field]]));
          const [version] = await SocietyRuleVersion.create([{
            _id: versionId, societyId, versionNumber, status: 'ACTIVE', effectiveFrom,
            approvalPolicy, ...copiedRules, createdBy: new Types.ObjectId(user.userId),
            changeReason: input.reason,
            supportingDocumentReference: input.supportingDocumentReference,
            policyChangeAuditLogId: audit._id,
          }], { session });
          const activated = await Society.updateOne(
            { _id: societyId, activeRuleVersionId: active._id },
            { $set: { activeRuleVersionId: version._id }, $inc: { configurationVersion: 1 } }, { session },
          );
          if (activated.modifiedCount !== 1) throw new ApiError(409, 'RULE_VERSION_CHANGED', 'The society configuration changed during rule activation.');
          created = {
            _id: version._id.toString(), societyId: societyId.toString(), versionNumber,
            status: version.status, effectiveFrom, createdBy: user.userId,
            approvalPolicy: version.approvalPolicy, changeReason: input.reason,
            supportingDocumentReference: input.supportingDocumentReference,
            policyChangeAuditLogId: audit._id.toString(), canonicalConfigurationHash,
          };
        });
      } finally { await session.endSession(); }
      if (!created || !auditLogId) throw new Error('Approval policy version activation returned no record.');
      const policyProof = await (policyProofSubmitter ?? submitPolicyVersionProof)(auditLogId);
      response.status(201).json({ success: true, data: { ...(created as Record<string, unknown>), policyProof } });
    } catch (error) { next(error); }
  });

  // Publish a new immutable society rule version. The reference is supplied by
  // the society; Nivaas records it but does not certify legal applicability.
  router.post('/society/rules/governance', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const body = objectBody(request.body);
      const societyId = resolveSocietyId(user, body.societyId);
      if (user.role !== 'SOCIETY_MANAGER') {
        throw new ApiError(403, 'FORBIDDEN', 'Only the society manager can configure a society governance rule version.');
      }
      const documentReference = requiredText(body.confirmedDocumentReference, 'confirmedDocumentReference');
      if (documentReference.length > 240) throw validation('confirmedDocumentReference must be at most 240 characters.');
      const suppliedPolicy = body.starterPolicy === true
        ? createGeneralBodyStarterPolicy()
        : body.governancePolicy;
      if (!suppliedPolicy || typeof suppliedPolicy !== 'object' || Array.isArray(suppliedPolicy)) throw validation('A complete governancePolicy object or starterPolicy: true is required.');
      const governancePolicy = { ...(suppliedPolicy as Record<string, unknown>), confirmationState: 'CONFIRMED', confirmedDocumentReference: documentReference, confirmedAt: new Date(), confirmedBy: new Types.ObjectId(user.userId) };
      const session = await mongoose.startSession();
      let created: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const society = await Society.findById(societyId).session(session).exec();
          if (!society) throw notFound();
          const active = await SocietyRuleVersion.findOne({ societyId, status: 'ACTIVE' }).session(session).lean().exec() as Record<string, any> | null;
          if (!active) throw policyUnresolved('An active society rule version is required before governance settings can be revised.');
          const effectiveFrom = new Date();
          const superseded = await SocietyRuleVersion.updateOne({ _id: active._id, societyId, status: 'ACTIVE' }, { $set: { status: 'SUPERSEDED', effectiveTo: effectiveFrom } }, { session });
          if (superseded.modifiedCount !== 1) throw new ApiError(409, 'RULE_VERSION_CHANGED', 'The active society rule version changed during configuration.');
          const [version] = await SocietyRuleVersion.create([{
            societyId, versionNumber: Number(active.versionNumber) + 1, status: 'ACTIVE', effectiveFrom,
            approvalPolicy: active.approvalPolicy, majorityRules: active.majorityRules, quorumRules: active.quorumRules,
            noticeRules: active.noticeRules ?? { agmClearDays: 14, ordinarySgmClearDays: 5 }, votingRules: active.votingRules, procurementRules: active.procurementRules,
            financialVisibilityRules: active.financialVisibilityRules, complaintRules: active.complaintRules,
            completionRules: active.completionRules, governancePolicy, createdBy: user.userId,
          }], { session });
          const activated = await Society.updateOne({ _id: societyId }, { $set: { activeRuleVersionId: version._id }, $inc: { configurationVersion: 1 } }, { session });
          if (activated.modifiedCount !== 1) throw new ApiError(409, 'RULE_VERSION_CHANGED', 'The society configuration changed during rule activation.');
          await new AuditLog({
            societyId, actorId: user.userId, action: 'GOVERNANCE_POLICY_VERSION_ACTIVATED',
            entityType: 'SocietyRuleVersion', entityId: version._id, ruleVersionId: version._id,
            previousState: { ruleVersionId: active._id, versionNumber: active.versionNumber },
            newState: { ruleVersionId: version._id, versionNumber: version.versionNumber, governancePolicySchemaVersion: version.governancePolicy?.schemaVersion, confirmationDocumentReference: documentReference },
          }).save({ session });
          created = { _id: String(version._id), societyId: String(societyId), versionNumber: version.versionNumber, status: version.status, effectiveFrom: version.effectiveFrom, governancePolicy: version.governancePolicy };
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: created });
    } catch (error) { next(error); }
  });

  router.get('/meetings', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const records = await Meeting.find({ societyId }).sort({ scheduledAt: -1 }).lean().exec();
      response.json({ success: true, data: records.map(serialize) });
    } catch (error) { next(error); }
  });

  router.post('/meetings', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const body = objectBody(request.body);
      const societyId = resolveSocietyId(user, body.societyId);
      if (!isOneOf(MEETING_TYPES, body.type)) throw validation('type must be AGM, SGM, or COMMITTEE.');
      const title = requiredText(body.title, 'title');
      const scheduledAt = requiredDate(body.scheduledAt, 'scheduledAt');
      const projectId = body.projectId === undefined ? undefined : objectId(body.projectId);
      const session = await mongoose.startSession();
      let created: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          if (projectId && !await Project.exists({ _id: projectId, societyId }).session(session)) throw notFound();
          const [meeting] = await Meeting.create([{
            societyId, ...(projectId ? { projectId } : {}), type: body.type, title, description: optionalText(body.description),
            scheduledAt, location: optionalText(body.location), agenda: textArray(body.agenda, 'agenda'), documentReferences: meetingDocumentReferences(body.documentReferences),
            status: 'DRAFT', createdBy: user.userId,
          }], { session });
          await new AuditLog({
            societyId, actorId: user.userId, action: 'GOVERNANCE_MEETING_DRAFT_CREATED',
            entityType: 'Meeting', entityId: meeting._id,
            previousState: {}, newState: { type: meeting.type, title: meeting.title, status: meeting.status, projectId: meeting.projectId },
          }).save({ session });
          created = serialize(meeting.toObject());
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: created });
    } catch (error) { next(error); }
  });

  router.post('/meetings/:meetingId/publish', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const body = objectBody(request.body);
      const societyId = resolveSocietyId(user, body.societyId);
      const meetingId = objectId(request.params.meetingId);
      const noticeReference = requiredText(body.noticeReference, 'noticeReference');
      const noticeIssuedAt = requiredDate(body.noticeIssuedAt, 'noticeIssuedAt');
      const session = await mongoose.startSession();
      let published: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const meeting = await Meeting.findOne({ _id: meetingId, societyId }).session(session).exec();
          if (!meeting) throw notFound();
          if (meeting.status !== 'DRAFT') throw new ApiError(409, 'INVALID_MEETING_STATE', 'Only a draft meeting can be published.');
          if (meeting.type === 'COMMITTEE') throw policyUnresolved('Committee meeting publication is disabled until committee notice and decision rules are configured.');
          if (!meeting.agenda?.length) throw validation('At least one agenda item is required before publishing a general-body meeting.');
          if (noticeIssuedAt >= meeting.scheduledAt) throw validation('The meeting notice must be issued before the meeting date.');
          const rule = await SocietyRuleVersion.findOne({
            societyId, status: { $in: ['ACTIVE', 'SUPERSEDED'] }, effectiveFrom: { $lte: meeting.scheduledAt },
            $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gt: meeting.scheduledAt } }],
          }).sort({ versionNumber: -1 }).session(session).lean().exec() as Record<string, any> | null;
          const noticeRules = rule?.noticeRules as Record<string, unknown> | undefined;
          const requiredDays = meeting.type === 'AGM' ? noticeRules?.agmClearDays : noticeRules?.ordinarySgmClearDays;
          if (!rule || !Number.isInteger(requiredDays) || Number(requiredDays) < 0) throw policyUnresolved('A configured AGM/ordinary SGM clear-notice period is required before publishing this meeting.');
          const clearDays = calendarClearDays(noticeIssuedAt, meeting.scheduledAt);
          if (clearDays < Number(requiredDays)) throw new ApiError(409, 'NOTICE_PERIOD_INSUFFICIENT', `This meeting has ${clearDays} clear notice days, but the active society rule requires ${requiredDays}. Issue the notice earlier or choose a later meeting date, then retry. The configured rule cannot be bypassed.`);
          meeting.noticeReference = noticeReference;
          meeting.noticeIssuedAt = noticeIssuedAt;
          meeting.noticePeriodDays = Number(requiredDays);
          meeting.quorumRuleVersionId = rule._id;
          meeting.status = 'PUBLISHED';
          await meeting.save({ session });
          await new AuditLog({ societyId, actorId: user.userId, action: 'GOVERNANCE_MEETING_PUBLISHED', entityType: 'Meeting', entityId: meetingId, ruleVersionId: rule._id,
            previousState: { status: 'DRAFT' }, newState: { status: 'PUBLISHED', type: meeting.type, noticeReference, noticeIssuedAt, clearDays, ruleVersionId: rule._id } }).save({ session });
          published = serialize(meeting.toObject());
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: published });
    } catch (error) { next(error); }
  });

  router.get('/meetings/:meetingId', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const meeting = await Meeting.findOne({ _id: objectId(request.params.meetingId), societyId }).lean().exec();
      if (!meeting) throw notFound();
      response.json({ success: true, data: serialize(meeting) });
    } catch (error) { next(error); }
  });

  router.get('/resolutions', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const records = await GovernanceResolution.find({ societyId }).sort({ createdAt: -1 }).lean().exec();
      response.json({ success: true, data: records.map(serialize) });
    } catch (error) { next(error); }
  });

  router.get('/resolutions/:resolutionId', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const record = await GovernanceResolution.findOne({ _id: objectId(request.params.resolutionId), societyId }).lean().exec();
      if (!record) throw notFound();
      response.json({ success: true, data: serialize(record as unknown as Record<string, any>) });
    } catch (error) { next(error); }
  });

  router.post('/resolutions', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const body = objectBody(request.body);
      const societyId = resolveSocietyId(user, body.societyId);
      if (!isOneOf(GOVERNANCE_RESOLUTION_TYPES, body.resolutionType)) throw validation('resolutionType is invalid.');
      if (!['OTHER', 'PROJECT_APPROVAL'].includes(String(body.resolutionType))) throw policyUnresolved('Budget, vendor, quotation, committee, and special decision types are not enabled in this general-body workflow.');
      if (body.resolutionType === 'PROJECT_APPROVAL' && body.decisionBody !== 'GENERAL_BODY') throw policyUnresolved('Project approval is enabled only for a general-body decision.');
      if (!isOneOf(GOVERNANCE_DECISION_BODIES, body.decisionBody)) throw validation('decisionBody is invalid.');
      if (!isOneOf(GOVERNANCE_VOTING_METHODS, body.votingMethod)) throw validation('votingMethod is invalid.');
      const meetingId = objectId(body.meetingId);
      const ruleVersionId = objectId(body.ruleVersionId);
      const votingStart = requiredDate(body.votingStart, 'votingStart');
      const votingEnd = requiredDate(body.votingEnd, 'votingEnd');
      if (votingEnd <= votingStart) throw validation('votingEnd must be later than votingStart.');
      const session = await mongoose.startSession();
      let created: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const meeting = await Meeting.findOne({ _id: meetingId, societyId }).session(session).lean().exec() as unknown as MeetingReference | null;
          if (!meeting) throw notFound();
          if (meeting.status !== 'PUBLISHED' || meeting.type === 'COMMITTEE') throw policyUnresolved('A published AGM/SGM meeting is required for general-body resolution voting.');
          const ruleVersion = await SocietyRuleVersion.findOne({
            _id: ruleVersionId, societyId,
            effectiveFrom: { $lte: meeting.scheduledAt },
            $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gt: meeting.scheduledAt } }],
          })
            .session(session).lean().exec() as unknown as RuleVersionDocument | null;
          const policy = findDecisionPolicy(ruleVersion?.governancePolicy, String(body.resolutionType), String(body.decisionBody));
          if (!ruleVersion || !policy) throw policyUnresolved('A complete, confirmed policy for this decision type and body is required to create a resolution draft.');
          if (!policy.voting?.methods?.includes(String(body.votingMethod) as typeof GOVERNANCE_VOTING_METHODS[number])) {
            throw policyUnresolved('The selected voting method is not configured for this decision.');
          }
          if (body.decisionBody !== 'GENERAL_BODY' || !['AGM', 'SGM'].includes(meeting.type)) throw policyUnresolved('Only general-body AGM/SGM resolutions are currently enabled.');
          if (String(meeting.quorumRuleVersionId) !== String(ruleVersionId)) throw policyUnresolved('The meeting notice and resolution must use the same immutable society rule version.');
          let projectId: Types.ObjectId | undefined;
          let approvalDecisionId: Types.ObjectId | undefined;
          let amount: mongoose.Types.Decimal128 | undefined;
          let quotationVersionId: Types.ObjectId | undefined;
          if (body.resolutionType === 'PROJECT_APPROVAL') {
            projectId = objectId(body.projectId);
            approvalDecisionId = objectId(body.approvalDecisionId);
            const decision = await ApprovalDecision.findOne({ _id: approvalDecisionId, projectId, societyId, status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }).session(session).lean().exec() as Record<string, any> | null;
            if (!decision || decision.requiredDecisionBody !== 'GENERAL_BODY_OR_SGM' || decision.approvalType !== 'SGM_REQUIRED'
              || String(decision.ruleVersionId) !== String(ruleVersionId) || meeting.type !== 'SGM') {
              throw policyUnresolved('The current SGM-required ApprovalDecision, its rule version, and an SGM meeting must match exactly.');
            }
            const latest = await ApprovalDecision.findOne({ projectId, societyId, status: { $ne: 'INVALIDATED' } }).sort({ createdAt: -1 }).session(session).select('_id').lean().exec() as unknown as { _id: Types.ObjectId } | null;
            if (!latest || String(latest._id) !== String(decision._id)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The selected ApprovalDecision is no longer current.');
            const project = await Project.findOne({ _id: projectId, societyId }).session(session).lean().exec() as Record<string, any> | null;
            if (!project || !['SGM_REQUIRED', 'RE_APPROVAL'].includes(project.status)) throw new ApiError(409, 'PROJECT_APPROVAL_STATE_INVALID', 'The project is not awaiting a general-body approval decision.');
            if (String(meeting.projectId) !== String(projectId)) throw new ApiError(409, 'MEETING_PROJECT_MISMATCH', 'The SGM must be explicitly linked to the project it will decide.');
            if (decision.quotationVersionId) {
              const quotation = await Quotation.findOne({ _id: decision.quotationVersionId, projectId }).session(session).lean().exec() as Record<string, any> | null;
              if (!quotation || String(project.currentQuotationId) !== String(quotation._id) || String(quotation.amount) !== String(decision.evaluatedAmount)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The project quotation or evaluated amount no longer matches the ApprovalDecision.');
              quotationVersionId = quotation._id;
            } else if (decision.changeRequestId) {
              const change = await ChangeRequest.findOne({ _id: decision.changeRequestId, projectId, approvalDecisionId: decision._id, status: 'REQUIRES_SGM' }).session(session).lean().exec() as Record<string, any> | null;
              if (!change || String(change.newAmount) !== String(decision.evaluatedAmount)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The change request amount or state no longer matches the ApprovalDecision.');
            } else if (String(project.estimatedCost) !== String(decision.evaluatedAmount)) {
              throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The project amount no longer matches the ApprovalDecision.');
            }
            amount = decision.evaluatedAmount;
          }
          const title = requiredText(body.title, 'title');
          const [resolution] = await GovernanceResolution.create([{
            societyId, meetingId, resolutionType: body.resolutionType, decisionBody: body.decisionBody,
            ...(projectId ? { projectId, approvalDecisionId, amount, ...(quotationVersionId ? { quotationVersionId } : {}) } : {}),
            title, description: optionalText(body.description), votingMethod: body.votingMethod,
            votingStart, votingEnd, ruleVersionId,
            eligibilityRule: policy.eligibility, majorityRule: policy.majority,
            quorumRequired: policy.quorum, governancePolicySnapshot: policy,
            ruleSnapshot: { ruleVersionId: String(ruleVersionId), versionNumber: ruleVersion.versionNumber, governancePolicy: ruleVersion.governancePolicy },
            status: 'DRAFT', createdBy: user.userId,
          }], { session });
          await new AuditLog({
            societyId, actorId: user.userId, action: 'GOVERNANCE_RESOLUTION_DRAFT_CREATED',
            entityType: 'GovernanceResolution', entityId: resolution._id, ruleVersionId,
            previousState: {}, newState: { meetingId, resolutionType: resolution.resolutionType, decisionBody: resolution.decisionBody, status: resolution.status },
          }).save({ session });
          created = serialize(resolution.toObject());
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: created });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/eligibility-snapshot', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const session = await mongoose.startSession();
      let result: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).exec();
          if (!resolution) throw notFound();
          if (resolution.status !== 'DRAFT') throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'Eligibility can only be snapshotted while the resolution is a draft.');
          if (resolution.eligibilitySnapshotId) throw new ApiError(409, 'ELIGIBILITY_SNAPSHOT_EXISTS', 'An immutable eligibility snapshot already exists for this resolution.');
          const rule = await SocietyRuleVersion.findOne({ _id: resolution.ruleVersionId, societyId }).session(session).lean().exec() as unknown as RuleVersionDocument | null;
          assertGovernancePolicyConfigured(resolution, rule ?? undefined);
          const policy = findDecisionPolicy(rule?.governancePolicy, resolution.resolutionType, resolution.decisionBody);
          if (!policy?.eligibility?.membershipTypes?.length || !policy.eligibility.membershipStatuses?.length) {
            throw policyUnresolved('The decision policy does not define an electorate.');
          }
          const unsupportedCurrentMembers = await Membership.countDocuments({
            societyId,
            membershipType: { $in: ['JOINT', 'ASSOCIATE', 'PROVISIONAL'] },
            membershipStatus: 'ACTIVE',
            $and: [
              { $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: new Date() } }] },
              { $or: [{ validTo: { $exists: false } }, { validTo: null }, { validTo: { $gt: new Date() } }] },
            ],
          }).session(session);
          if (unsupportedCurrentMembers > 0) {
            throw policyUnresolved('This society has current joint, associate, or provisional memberships whose applicable voting evidence cannot be verified by the current data model.');
          }
          const memberships = await Membership.find({
            societyId,
            membershipType: { $in: policy.eligibility.membershipTypes },
            membershipStatus: { $in: policy.eligibility.membershipStatuses },
            $and: [
              { $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: new Date() } }] },
              { $or: [{ validTo: { $exists: false } }, { validTo: null }, { validTo: { $gt: new Date() } }] },
            ],
          }).session(session).select('societyId userId membershipType membershipStatus validFrom validTo').lean().exec();
          const candidateIds = [...new Set(memberships.map((membership) => String(membership.userId)))];
          const activeUsers = candidateIds.length
            ? await User.find({ _id: { $in: candidateIds }, societyId, status: 'ACTIVE' }).session(session).select('_id').lean().exec()
            : [];
          const eligibleMemberIds = deriveEligibleMemberIds({
            societyId: String(societyId),
            eligibility: policy.eligibility,
            memberships: memberships as unknown as Array<{ societyId: Types.ObjectId; userId: Types.ObjectId; membershipType: string; membershipStatus: string; validFrom?: Date; validTo?: Date }>,
            activeUserIds: activeUsers.map((member) => member._id as Types.ObjectId),
          }).map((id) => new Types.ObjectId(id));
          const [snapshot] = await GovernanceEligibilitySnapshot.create([{
            societyId, resolutionId, ruleVersionId: resolution.ruleVersionId,
            governancePolicySnapshot: policy, eligibilityRule: policy.eligibility,
            eligibleMemberIds, eligibleCount: eligibleMemberIds.length, generatedAt: new Date(), generatedBy: user.userId,
          }], { session });
          resolution.eligibilitySnapshotId = snapshot._id;
          resolution.eligibleVoterCount = eligibleMemberIds.length;
          await resolution.save({ session });
          await new AuditLog({
            societyId, actorId: user.userId, action: 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_CREATED',
            entityType: 'GovernanceEligibilitySnapshot', entityId: snapshot._id, ruleVersionId: resolution.ruleVersionId,
            previousState: {}, newState: { resolutionId, eligibleCount: eligibleMemberIds.length },
          }).save({ session });
          result = { _id: String(snapshot._id), societyId: String(societyId), resolutionId: String(resolutionId), ruleVersionId: String(resolution.ruleVersionId), eligibleCount: eligibleMemberIds.length, generatedAt: snapshot.generatedAt };
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: result });
    } catch (error) {
      next(isDuplicateKeyError(error)
        ? new ApiError(409, 'ELIGIBILITY_SNAPSHOT_EXISTS', 'An eligibility snapshot already exists for this resolution.')
        : error);
    }
  });

  router.get('/resolutions/:resolutionId/eligible-attendees', authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER'), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId, status: 'DRAFT' }).select('_id eligibilitySnapshotId').lean().exec() as unknown as { eligibilitySnapshotId?: Types.ObjectId } | null;
      if (!resolution?.eligibilitySnapshotId) throw new ApiError(409, 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED', 'Create an eligibility snapshot before preparing offline attendance.');
      const snapshot = await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId, resolutionId }).select('eligibleMemberIds').lean().exec() as unknown as { eligibleMemberIds: Types.ObjectId[] } | null;
      if (!snapshot) throw notFound();
      const users = await User.find({ _id: { $in: snapshot.eligibleMemberIds }, societyId, status: 'ACTIVE' }).select('_id name').lean().exec() as unknown as Array<{ _id: Types.ObjectId; name: string }>;
      response.json({ success: true, data: users.map(item => ({ memberId: String(item._id), displayName: item.name })) });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/open', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const session = await mongoose.startSession();
      const opened: { value: { _id: Types.ObjectId; status: string } | null } = { value: null };
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).lean().exec() as unknown as ResolutionDocument | null;
          if (!resolution) throw notFound();
          const rule = await SocietyRuleVersion.findOne({ _id: resolution.ruleVersionId, societyId }).session(session).lean().exec() as unknown as RuleVersionDocument | null;
          const snapshot = resolution.eligibilitySnapshotId
            ? await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId }).session(session).lean().exec() as unknown as EligibilityDocument | null
            : null;
          assertResolutionCanOpen(resolution, rule ?? undefined, snapshot ?? undefined);
          const updated = await GovernanceResolution.findOneAndUpdate(
            { _id: resolutionId, societyId, status: 'DRAFT', eligibilitySnapshotId: snapshot?._id },
            { status: 'OPEN' }, { new: true, runValidators: true, session },
          ).select('_id status').lean().exec() as unknown as { _id: Types.ObjectId; status: string } | null;
          if (!updated) throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'The resolution changed before voting could be opened.');
          await new AuditLog({
            societyId, actorId: user.userId, action: 'GOVERNANCE_RESOLUTION_OPENED',
            entityType: 'GovernanceResolution', entityId: resolutionId, ruleVersionId: resolution.ruleVersionId,
            previousState: { status: 'DRAFT' }, newState: { status: 'OPEN', eligibilitySnapshotId: snapshot?._id },
          }).save({ session });
          opened.value = updated;
        });
      } finally { await session.endSession(); }
      if (!opened.value) throw notFound();
      response.json({ success: true, data: { _id: String(opened.value._id), status: opened.value.status } });
    } catch (error) { next(error); }
  });

  router.get('/resolutions/:resolutionId/my-vote', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).select('_id eligibilitySnapshotId').lean().exec() as unknown as { eligibilitySnapshotId?: Types.ObjectId } | null;
      if (!resolution) throw notFound();
      const eligible = await GovernanceEligibilitySnapshot.exists({ _id: resolution.eligibilitySnapshotId, societyId, resolutionId, eligibleMemberIds: user.userId });
      if (!eligible) throw new ApiError(403, 'INELIGIBLE_VOTER', 'The authenticated user is not in this resolution eligibility snapshot.');
      const vote = await GovernanceVote.findOne({ societyId, resolutionId, voterId: user.userId }).select('_id vote castAt').lean().exec() as unknown as { vote: string; castAt: Date } | null;
      response.json({ success: true, data: vote ? { vote: vote.vote, castAt: vote.castAt } : null });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/votes', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const body = objectBody(request.body);
      if (!isOneOf(GOVERNANCE_VOTE_VALUES, body.vote)) throw validation('vote must be YES, NO, or ABSTAIN.');
      const session = await mongoose.startSession();
      let accepted: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).lean().exec() as unknown as ResolutionDocument & { votingStart: Date; votingEnd: Date } | null;
          if (!resolution) throw notFound();
          const snapshot = resolution.eligibilitySnapshotId
            ? await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId }).session(session).lean().exec() as unknown as EligibilityDocument | null : null;
          if (!snapshot) throw new ApiError(409, 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED', 'A matching electorate snapshot is required before voting.');
          const policy = resolution.governancePolicySnapshot as unknown as NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number];
          if (!policy?.voting || policy.voting.oneMemberOneVote !== true || policy.voting.voteChangePolicy !== 'IMMUTABLE_AFTER_CAST' || policy.voting.ballotPrivacy !== 'RECORDED') throw policyUnresolved('Only configured immutable, recorded, one-member-one-vote ballots are enabled.');
          const vote = makeVoteFromAuthenticatedUser({ resolution: { ...resolution, societyId: String(resolution.societyId) }, evidence: snapshot, authenticatedUser: user, vote: body.vote as 'YES' | 'NO' | 'ABSTAIN' });
          const claimed = await GovernanceResolution.updateOne({ _id: resolutionId, societyId, status: 'OPEN', votingStart: { $lte: vote.castAt }, votingEnd: { $gt: vote.castAt } }, { $inc: { acceptedVoteCount: 1 } }, { session });
          if (claimed.modifiedCount !== 1) throw new ApiError(409, 'RESOLUTION_NOT_OPEN', 'The resolution closed before this vote could be recorded.');
          const [record] = await GovernanceVote.create([vote], { session });
          await new AuditLog({ societyId, actorId: user.userId, action: 'GOVERNANCE_VOTE_ACCEPTED', entityType: 'GovernanceResolution', entityId: resolutionId, ruleVersionId: resolution.ruleVersionId,
            previousState: {}, newState: { resolutionId, voteId: record._id, castAt: record.castAt } }).save({ session });
          accepted = { _id: String(record._id), resolutionId: String(resolutionId), castAt: record.castAt };
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: accepted });
    } catch (error) { next(isDuplicateKeyError(error) ? new ApiError(409, 'DUPLICATE_GOVERNANCE_VOTE', 'A vote has already been recorded for this member and resolution.') : error); }
  });

  router.post('/resolutions/:resolutionId/close', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const session = await mongoose.startSession();
      let closed: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).exec();
          if (!resolution) throw notFound();
          if (resolution.status !== 'OPEN') throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'Only an open resolution can be closed.');
          const now = new Date();
          if (resolution.votingEnd > now) throw new ApiError(409, 'VOTING_WINDOW_OPEN', 'Voting cannot close before the configured voting end time.');
          const snapshot = await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId, resolutionId }).session(session).lean().exec() as unknown as EligibilityDocument | null;
          if (!snapshot) throw new ApiError(409, 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED', 'A matching electorate snapshot is required to calculate the result.');
          const votes = await GovernanceVote.find({ societyId, resolutionId }).session(session).lean().exec() as unknown as Array<{ societyId: Types.ObjectId; voterId: Types.ObjectId; vote: 'YES' | 'NO' | 'ABSTAIN' }>;
          const counts = countRecordedVotes(String(societyId), snapshot!, votes);
          const policy = resolution.governancePolicySnapshot as unknown as NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number];
          const outcome = calculateGeneralBodyOutcome({ counts, quorum: policy.quorum!, majority: policy.majority! });
          resolution.status = 'CLOSED';
          resolution.result = { ...counts, quorumMet: outcome.quorumMet, quorumRequired: outcome.quorumRequired, outcome: outcome.outcome, calculatedAt: now } as never;
          await resolution.save({ session });
          await new AuditLog({ societyId, actorId: user.userId, action: 'GOVERNANCE_RESOLUTION_CLOSED', entityType: 'GovernanceResolution', entityId: resolutionId, ruleVersionId: resolution.ruleVersionId,
            previousState: { status: 'OPEN' }, newState: { status: 'CLOSED', ...counts, ...outcome, resolutionType: resolution.resolutionType } }).save({ session });
          closed = { _id: String(resolution._id), status: resolution.status, result: resolution.result };
        });
      } finally { await session.endSession(); }
      response.json({ success: true, data: closed });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/finalize', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const session = await mongoose.startSession();
      const finalized: { value: { status: string; auditLogId?: string; result?: unknown } | null } = { value: null };
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).exec();
          if (!resolution) throw notFound();
          if (['APPROVED', 'REJECTED', 'NO_DECISION'].includes(resolution.status)) {
            finalized.value = { status: resolution.status, auditLogId: resolution.finalizationAuditLogId?.toString(), result: resolution.result };
            return;
          }
          const rule = await SocietyRuleVersion.findOne({ _id: resolution.ruleVersionId, societyId }).session(session).lean().exec() as unknown as RuleVersionDocument | null;
          const snapshot = await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId, resolutionId }).session(session).lean().exec() as unknown as EligibilityDocument | null;
          assertResolutionCanFinalize(resolution as never, rule ?? undefined, snapshot ?? undefined);
          const votes = await GovernanceVote.find({ societyId, resolutionId }).session(session).lean().exec() as unknown as Array<{ societyId: Types.ObjectId; voterId: Types.ObjectId; vote: 'YES' | 'NO' | 'ABSTAIN' }>;
          const counts = countRecordedVotes(String(societyId), snapshot!, votes);
          const policy = resolution.governancePolicySnapshot as unknown as NonNullable<GovernancePolicyConfiguration['decisionPolicies']>[number];
          const recomputed = calculateGeneralBodyOutcome({ counts, quorum: policy.quorum!, majority: policy.majority! });
          if (resolution.status !== 'CLOSED' || !resolution.result || resolution.result.outcome !== recomputed.outcome
            || resolution.result.totalVotes !== counts.totalVotes || resolution.result.yesCount !== counts.yesCount
            || resolution.result.noCount !== counts.noCount || resolution.result.abstainCount !== counts.abstainCount) {
            throw new ApiError(409, 'GOVERNANCE_RESULT_INTEGRITY_ERROR', 'The closed resolution result does not match its immutable vote records.');
          }
          const meeting = await Meeting.findOne({ _id: resolution.meetingId, societyId, status: 'PUBLISHED' }).session(session).lean().exec() as Record<string, any> | null;
          if (!meeting || meeting.type === 'COMMITTEE' || String(meeting.quorumRuleVersionId) !== String(resolution.ruleVersionId)) throw policyUnresolved('A published, same-society general-body meeting and matching notice rule snapshot are required.');
          let projectApprovalContext: Record<string, unknown> | undefined;
          if (resolution.resolutionType === 'PROJECT_APPROVAL' && recomputed.outcome === 'APPROVED') {
            projectApprovalContext = await completeProjectApproval(resolution, societyId, meeting, user.userId, session);
          }
          const status = recomputed.outcome;
          const finalAudit = new AuditLog({ societyId, actorId: user.userId, action: 'GOVERNANCE_RESOLUTION_FINALIZED', entityType: 'GovernanceResolution', entityId: resolutionId, ruleVersionId: resolution.ruleVersionId,
            previousState: { status: 'CLOSED' }, newState: { status, result: resolution.result, projectId: resolution.projectId, approvalDecisionId: resolution.approvalDecisionId, ruleVersionId: resolution.ruleVersionId, eligibilitySnapshotId: resolution.eligibilitySnapshotId, ...(projectApprovalContext ? { projectApprovalContext } : {}) } });
          await finalAudit.save({ session });
          resolution.status = status;
          resolution.finalizedAt = new Date();
          resolution.finalizationAuditLogId = finalAudit._id;
          if (status === 'APPROVED') resolution.approvedAt = resolution.finalizedAt;
          await resolution.save({ session });
          finalized.value = { status, auditLogId: String(finalAudit._id), result: resolution.result };
        });
      } finally { await session.endSession(); }
      if (!finalized.value) throw notFound();
      const proof = finalized.value.auditLogId ? await submitFinalizationProof(finalized.value.auditLogId) : { status: 'UNAVAILABLE' };
      response.json({ success: true, data: { resolutionId: String(resolutionId), status: finalized.value.status, result: finalized.value.result, proof } });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/record-offline', authenticateRequest, loadAuthenticatedUser, requireRoles('SOCIETY_MANAGER'), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolutionId = objectId(request.params.resolutionId);
      const body = objectBody(request.body);
      if (body.confirm !== true) throw validation('confirm must be true to record an authorized offline meeting result.');
      const method = body.method;
      if (!['SHOW_OF_HANDS', 'POLL'].includes(String(method))) throw policyUnresolved('Offline recording supports configured show-of-hands or non-secret poll methods only.');
      const attendanceIds = objectIdArray(body.attendanceMemberIds, 'attendanceMemberIds');
      const yesCount = countField(body.yesCount, 'yesCount');
      const noCount = countField(body.noCount, 'noCount');
      const abstainCount = countField(body.abstainCount, 'abstainCount');
      const minutesReference = requiredText(body.minutesReference, 'minutesReference');
      if (minutesReference.length > 240) throw validation('minutesReference must be at most 240 characters.');
      const evidenceReferences = textArray(body.supportingEvidenceReferences, 'supportingEvidenceReferences') ?? [];
      if (!evidenceReferences.length || evidenceReferences.some(reference => reference.length > 240)) throw validation('At least one supporting evidence reference of at most 240 characters is required.');
      if (yesCount + noCount + abstainCount > attendanceIds.length) throw validation('Recorded vote counts cannot exceed attendanceMemberIds.length. Present members who did not vote remain represented in attendance.');
      const session = await mongoose.startSession();
      let recorded: Record<string, unknown> | null = null;
      try {
        await session.withTransaction(async () => {
          const resolution = await GovernanceResolution.findOne({ _id: resolutionId, societyId }).session(session).exec();
          if (!resolution) throw notFound();
          if (resolution.status !== 'DRAFT' || resolution.finalizationAuditLogId) throw new ApiError(409, 'INVALID_RESOLUTION_STATE', 'Only an unfinalized draft resolution can receive an offline meeting record.');
          if (await GovernanceVote.exists({ societyId, resolutionId }).session(session)) throw new ApiError(409, 'LIVE_VOTES_EXIST', 'An offline decision cannot be recorded after individual electronic votes exist.');
          const meeting = await Meeting.findOne({ _id: resolution.meetingId, societyId, status: 'PUBLISHED', type: { $in: ['AGM', 'SGM'] } }).session(session).lean().exec() as Record<string, any> | null;
          if (!meeting || String(meeting.quorumRuleVersionId) !== String(resolution.ruleVersionId)) throw policyUnresolved('A published AGM/SGM and matching notice rule version are required.');
          if (meeting.scheduledAt > new Date()) throw new ApiError(409, 'MEETING_NOT_HELD', 'An offline result can be recorded only after the scheduled general-body meeting time.');
          const rule = await SocietyRuleVersion.findOne({ _id: resolution.ruleVersionId, societyId }).session(session).lean().exec() as unknown as RuleVersionDocument | null;
          assertGovernancePolicyConfigured(resolution as never, rule ?? undefined);
          const policy = findDecisionPolicy(rule?.governancePolicy, resolution.resolutionType, resolution.decisionBody);
          if (!policy?.voting?.methods?.includes(String(method))) throw policyUnresolved('The selected offline voting method is not in the resolution policy snapshot.');
          const snapshot = resolution.eligibilitySnapshotId ? await GovernanceEligibilitySnapshot.findOne({ _id: resolution.eligibilitySnapshotId, societyId, resolutionId }).session(session).lean().exec() as unknown as EligibilityDocument | null : null;
          if (!snapshot) throw new ApiError(409, 'GOVERNANCE_ELIGIBILITY_SNAPSHOT_REQUIRED', 'A matching eligibility snapshot is required before recording attendance.');
          if (attendanceIds.some(id => !snapshot.eligibleMemberIds.some(eligible => String(eligible) === String(id)))) throw new ApiError(409, 'INELIGIBLE_ATTENDEE', 'Every recorded attendee must be in the resolution eligibility snapshot.');
          const counts = { totalEligible: snapshot.eligibleCount, totalVotes: yesCount + noCount + abstainCount, yesCount, noCount, abstainCount };
          const outcome = calculateGeneralBodyOutcome({ counts, attendanceCount: attendanceIds.length, quorum: policy.quorum!, majority: policy.majority! });
          const now = new Date();
          const [record] = await OfflineResolutionRecordModel.create([{ societyId, meetingId: meeting._id, resolutionId, ruleVersionId: resolution.ruleVersionId, method,
            attendanceMemberIds: attendanceIds, attendanceCount: attendanceIds.length, yesCount, noCount, abstainCount,
            quorumRequired: outcome.quorumRequired, quorumMet: outcome.quorumMet, outcome: outcome.outcome,
            minutesReference, supportingEvidenceReferences: evidenceReferences, confirmedBy: user.userId, confirmedAt: now,
            policySnapshot: { governancePolicy: rule?.governancePolicy, resolutionPolicy: policy } }], { session });
          resolution.status = outcome.outcome;
          resolution.result = { ...counts, attendanceCount: attendanceIds.length, quorumRequired: outcome.quorumRequired, quorumMet: outcome.quorumMet, outcome: outcome.outcome, calculatedAt: now } as never;
          resolution.finalizedAt = now;
          if (outcome.outcome === 'APPROVED') resolution.approvedAt = now;
          if (outcome.outcome === 'APPROVED' && resolution.resolutionType === 'PROJECT_APPROVAL') await completeProjectApproval(resolution.toObject() as Record<string, any>, societyId, meeting, user.userId, session);
          const audit = await new AuditLog({ societyId, actorId: user.userId, action: 'OFFLINE_GOVERNANCE_DECISION_CONFIRMED', entityType: 'GovernanceResolution', entityId: resolutionId, ruleVersionId: resolution.ruleVersionId,
            previousState: { status: 'DRAFT' }, newState: { status: outcome.outcome, recordId: record._id, result: resolution.result, meetingId: meeting._id, method, minutesReference, supportingEvidenceReferences: evidenceReferences, confirmedAt: now } }).save({ session });
          resolution.finalizationAuditLogId = audit._id;
          await resolution.save({ session });
          const heldMeeting = await Meeting.updateOne({ _id: meeting._id, societyId, status: 'PUBLISHED' }, { $set: { status: 'HELD', attendanceCount: attendanceIds.length, quorumStatus: outcome.quorumMet ? 'MET' : 'NOT_MET' } }, { session });
          if (heldMeeting.modifiedCount !== 1) throw new ApiError(409, 'MEETING_STATE_CHANGED', 'The meeting changed while its offline decision was being recorded.');
          recorded = { recordId: String(record._id), resolutionId: String(resolutionId), meetingId: String(meeting._id), status: outcome.outcome, result: resolution.result, confirmedBy: user.userId, confirmedAt: now };
        });
      } finally { await session.endSession(); }
      response.status(201).json({ success: true, data: recorded });
    } catch (error) { next(error); }
  });

  router.post('/resolutions/:resolutionId/proof', ...writable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.body?.societyId);
      const resolution = await GovernanceResolution.findOne({ _id: objectId(request.params.resolutionId), societyId, status: { $in: ['APPROVED', 'REJECTED', 'NO_DECISION'] } }).select('finalizationAuditLogId').lean().exec() as unknown as { finalizationAuditLogId?: Types.ObjectId } | null;
      if (!resolution?.finalizationAuditLogId) throw new ApiError(409, 'RESOLUTION_NOT_FINALIZED', 'Blockchain proof can be requested only for a finalized resolution.');
      response.json({ success: true, data: await submitFinalizationProof(String(resolution.finalizationAuditLogId)) });
    } catch (error) { next(error); }
  });

  router.get('/resolutions/:resolutionId/proof', ...readable, async (request, response, next) => {
    try {
      const user = currentUser(request);
      const societyId = resolveSocietyId(user, request.query.societyId);
      const resolution = await GovernanceResolution.findOne({ _id: objectId(request.params.resolutionId), societyId, status: { $in: ['APPROVED', 'REJECTED', 'NO_DECISION'] } }).select('finalizationAuditLogId').lean().exec() as unknown as { finalizationAuditLogId?: Types.ObjectId } | null;
      if (!resolution?.finalizationAuditLogId) throw new ApiError(409, 'RESOLUTION_NOT_FINALIZED', 'Proof status is available only for a finalized resolution.');
      try { response.json({ success: true, data: await new AuditLogProofService().status(String(resolution.finalizationAuditLogId)) }); }
      catch (error) {
        const code = error instanceof ApiError ? error.code : 'BLOCKCHAIN_UNAVAILABLE';
        response.json({ success: true, data: { status: 'UNAVAILABLE', errorCode: code } });
      }
    } catch (error) { next(error); }
  });

  return router;
}

function findDecisionPolicy(configuration: unknown, resolutionType: string, decisionBody: string): Record<string, any> | null {
  if (!configuration || typeof configuration !== 'object') return null;
  const value = configuration as { confirmationState?: string; schemaVersion?: number; decisionPolicies?: Array<Record<string, any>> };
  if (value.confirmationState !== 'CONFIRMED' || value.schemaVersion !== 1) return null;
  return value.decisionPolicies?.find((item) => item.resolutionType === resolutionType && item.decisionBody === decisionBody) ?? null;
}

type RuleVersionDocument = { _id: Types.ObjectId; societyId: Types.ObjectId; versionNumber: number; governancePolicy?: GovernancePolicyConfiguration };
type MeetingReference = { _id: Types.ObjectId; societyId: Types.ObjectId; scheduledAt: Date; status: string; type: string; quorumRuleVersionId?: Types.ObjectId; projectId?: Types.ObjectId };
type ResolutionDocument = { _id: Types.ObjectId; societyId: Types.ObjectId; ruleVersionId: Types.ObjectId; resolutionType: string; decisionBody: string; status: string; eligibilitySnapshotId?: Types.ObjectId; governancePolicySnapshot?: unknown };
type EligibilityDocument = { _id: Types.ObjectId; societyId: Types.ObjectId; resolutionId: Types.ObjectId; ruleVersionId: Types.ObjectId; eligibleMemberIds: Types.ObjectId[]; eligibleCount: number };

function currentUser(request: { currentUser?: CurrentUserContext }): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}
function resolveSocietyId(user: CurrentUserContext, requested: unknown): Types.ObjectId {
  if (user.role !== 'SYSTEM_ADMIN') {
    if (!user.societyId) throw new ApiError(403, 'FORBIDDEN', 'The authenticated account has no society association.');
    return new Types.ObjectId(user.societyId);
  }
  if (typeof requested !== 'string' || !Types.ObjectId.isValid(requested)) throw validation('A valid societyId is required for platform-wide access.');
  return new Types.ObjectId(requested);
}
function objectId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation('A valid identifier is required.');
  return new Types.ObjectId(value);
}
function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('A JSON object is required.');
  return value as Record<string, unknown>;
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw validation(`${field} is required.`);
  return value.trim();
}
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw validation('Text fields must be strings.');
  return value.trim();
}
function textArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw validation(`${field} must be an array of non-empty strings.`);
  return value.map((item) => item.trim());
}
function objectIdArray(value: unknown, field: string): Types.ObjectId[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !Types.ObjectId.isValid(item))) throw validation(`${field} must be an array of valid identifiers.`);
  const ids = value.map(item => new Types.ObjectId(item as string));
  if (new Set(ids.map(String)).size !== ids.length) throw validation(`${field} cannot contain duplicate identifiers.`);
  return ids;
}
function countField(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw validation(`${field} must be a non-negative integer.`);
  return Number(value);
}
function meetingDocumentReferences(value: unknown): Array<{ kind: string; reference: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw validation('documentReferences must contain at most 20 references.');
  const allowed = ['NOTICE', 'PROPOSAL', 'QUOTATION', 'MINUTES', 'SUPPORTING_EVIDENCE'];
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw validation(`documentReferences[${index}] must be an object.`);
    const reference = item as Record<string, unknown>;
    if (!allowed.includes(String(reference.kind)) || typeof reference.reference !== 'string' || !reference.reference.trim() || reference.reference.trim().length > 240) throw validation(`documentReferences[${index}] requires a supported kind and reference up to 240 characters.`);
    return { kind: String(reference.kind), reference: reference.reference.trim() };
  });
}
function requiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw validation(`${field} must be a valid date.`);
  return new Date(value);
}
function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] { return typeof value === 'string' && values.includes(value); }
function serialize(value: Record<string, any>): Record<string, unknown> {
  return { ...value, _id: String(value._id), societyId: String(value.societyId), ...(value.meetingId ? { meetingId: String(value.meetingId) } : {}), ...(value.ruleVersionId ? { ruleVersionId: String(value.ruleVersionId) } : {}), ...(value.createdBy ? { createdBy: String(value.createdBy) } : {}) };
}
function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', 'The requested governance record was not found in this society.'); }
function policyUnresolved(message: string): ApiError { return new ApiError(409, 'GOVERNANCE_POLICY_UNRESOLVED', message); }
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}

function calendarClearDays(issuedAt: Date, meetingAt: Date): number {
  const issued = Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate());
  const meeting = Date.UTC(meetingAt.getUTCFullYear(), meetingAt.getUTCMonth(), meetingAt.getUTCDate());
  return Math.floor((meeting - issued) / 86_400_000) - 1;
}

async function completeProjectApproval(
  resolution: Record<string, any>, societyId: Types.ObjectId, meeting: Record<string, any>, actorId: string | Types.ObjectId, session: mongoose.ClientSession,
): Promise<Record<string, unknown>> {
  if (!resolution.projectId || !resolution.approvalDecisionId || resolution.resolutionType !== 'PROJECT_APPROVAL'
    || resolution.decisionBody !== 'GENERAL_BODY' || meeting.type !== 'SGM' || String(meeting.projectId) !== String(resolution.projectId)) {
    throw new ApiError(409, 'APPROVAL_DECISION_MISMATCH', 'A project approval requires its linked project, current decision, and SGM context.');
  }
  const decision = await ApprovalDecision.findOne({
    _id: resolution.approvalDecisionId, projectId: resolution.projectId, societyId,
    status: { $in: ['REQUIRED', 'RE_EVALUATED'] }, approvalType: 'SGM_REQUIRED', requiredDecisionBody: 'GENERAL_BODY_OR_SGM',
  }).session(session).lean().exec() as Record<string, any> | null;
  if (!decision || String(decision.ruleVersionId) !== String(resolution.ruleVersionId)) throw new ApiError(409, 'APPROVAL_DECISION_MISMATCH', 'The current SGM-required ApprovalDecision no longer matches this resolution.');
  const latest = await ApprovalDecision.findOne({ projectId: resolution.projectId, societyId, status: { $ne: 'INVALIDATED' } }).sort({ createdAt: -1 }).session(session).select('_id').lean().exec() as unknown as { _id: Types.ObjectId } | null;
  if (!latest || String(latest._id) !== String(decision._id)) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'A newer approval evaluation exists.');
  const project = await Project.findOne({ _id: resolution.projectId, societyId, status: { $in: ['SGM_REQUIRED', 'RE_APPROVAL'] } }).session(session).lean().exec() as Record<string, any> | null;
  if (!project) throw new ApiError(409, 'PROJECT_APPROVAL_STATE_INVALID', 'The project is not in an approval state.');
  if (decision.quotationVersionId) {
    const quotation = await Quotation.findOne({ _id: decision.quotationVersionId, projectId: project._id }).session(session).lean().exec() as Record<string, any> | null;
    if (!quotation || String(project.currentQuotationId) !== String(quotation._id) || String(quotation.amount) !== String(decision.evaluatedAmount)
      || String(resolution.quotationVersionId) !== String(quotation._id) || String(resolution.amount) !== String(decision.evaluatedAmount)) {
      throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The current quotation revision or amount differs from the evaluated approval record.');
    }
  } else if (decision.changeRequestId) {
    const change = await ChangeRequest.findOne({ _id: decision.changeRequestId, projectId: project._id, approvalDecisionId: decision._id, status: 'REQUIRES_SGM' }).session(session).lean().exec() as Record<string, any> | null;
    if (!change || String(change.newAmount) !== String(decision.evaluatedAmount) || String(resolution.amount) !== String(decision.evaluatedAmount)) {
      throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The active change request or evaluated amount no longer matches.');
    }
  } else if (String(project.estimatedCost) !== String(decision.evaluatedAmount) || String(resolution.amount) !== String(decision.evaluatedAmount)) {
    throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The project amount differs from the evaluated approval record.');
  }
  const decisionUpdate = await ApprovalDecision.updateOne({ _id: decision._id, societyId, status: { $in: ['REQUIRED', 'RE_EVALUATED'] } }, {
    $set: { status: 'COMPLETED', meetingId: meeting._id, governanceResolutionId: resolution._id },
  }, { session });
  if (decisionUpdate.modifiedCount !== 1) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The ApprovalDecision changed during finalization.');
  const projectUpdate = await Project.updateOne({ _id: project._id, societyId, status: project.status, currentQuotationId: project.currentQuotationId ?? null }, {
    $set: { status: 'APPROVED', approvalStatus: 'APPROVED', approvedCost: decision.evaluatedAmount, meetingId: meeting._id, governanceResolutionId: resolution._id },
  }, { session });
  if (projectUpdate.modifiedCount !== 1) throw new ApiError(409, 'PROJECT_APPROVAL_STATE_CHANGED', 'The project changed during governance finalization.');
  if (decision.changeRequestId) {
    const changeUpdate = await ChangeRequest.updateOne({ _id: decision.changeRequestId, projectId: project._id, status: 'REQUIRES_SGM', approvalDecisionId: decision._id }, { $set: { status: 'APPROVED', approvalMeetingId: meeting._id } }, { session });
    if (changeUpdate.modifiedCount !== 1) throw new ApiError(409, 'APPROVAL_DECISION_STALE', 'The approved change request changed during finalization.');
  }
  await new AuditLog({ societyId, actorId: new Types.ObjectId(actorId), action: 'PROJECT_APPROVED_BY_GOVERNANCE', entityType: 'Project', entityId: project._id, ruleVersionId: resolution.ruleVersionId,
    previousState: { status: project.status, approvalStatus: project.approvalStatus },
    newState: { status: 'APPROVED', approvalStatus: 'APPROVED', evaluatedAmount: String(decision.evaluatedAmount), requiredThreshold: String(decision.requiredThreshold), approvalType: decision.approvalType, requiredDecisionBody: decision.requiredDecisionBody, quotationVersionId: decision.quotationVersionId, changeRequestId: decision.changeRequestId, meetingId: meeting._id, resolutionId: resolution._id, approvalDecisionId: decision._id } }).save({ session });
  return {
    approvalDecisionId: decision._id,
    ruleVersionId: decision.ruleVersionId,
    approvalType: decision.approvalType,
    requiredDecisionBody: decision.requiredDecisionBody,
    evaluatedAmount: String(decision.evaluatedAmount),
    requiredThreshold: String(decision.requiredThreshold),
    quotationVersionId: decision.quotationVersionId ?? null,
    changeRequestId: decision.changeRequestId ?? null,
  };
}

async function submitFinalizationProof(auditLogId: string): Promise<Record<string, unknown>> {
  try {
    return await new AuditLogProofService().submit(auditLogId);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'BLOCKCHAIN_OUTCOME_AMBIGUOUS';
    return { status: code === 'BLOCKCHAIN_PROOF_CONFLICT' ? 'FAILED' : 'PENDING', errorCode: code, retryAvailable: true };
  }
}

async function submitPolicyVersionProof(auditLogId: string): Promise<Record<string, unknown>> {
  try {
    return await new AuditLogProofService().submit(auditLogId);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'BLOCKCHAIN_OUTCOME_AMBIGUOUS';
    return {
      status: code === 'BLOCKCHAIN_PROOF_CONFLICT' ? 'CONFLICT' : code === 'BLOCKCHAIN_NOT_CONFIGURED' ? 'UNCONFIGURED' : 'PENDING',
      errorCode: code,
      retryAvailable: code !== 'BLOCKCHAIN_NOT_CONFIGURED',
    };
  }
}
