import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { ApprovalDecision, type ApprovalDecisionRecord } from './models/ApprovalDecision.js';
import { Project } from '../project/models/Project.js';
import { Society } from '../society/models/Society.js';
import { SocietyRuleVersion } from '../society/models/SocietyRuleVersion.js';
import { Quotation } from '../quotation/models/Quotation.js';
import { ChangeRequest } from '../quotation/models/ChangeRequest.js';

type ApprovalProject = {
  _id: { toString(): string };
  societyId: { toString(): string };
  estimatedCost: { toString(): string };
  status: string;
  currentQuotationId?: { toString(): string };
  activeRuleVersionId?: { toString(): string };
};

export type ApprovalEvaluation = {
  decision: ApprovalDecisionRecord & { _id: Types.ObjectId };
  approvalType: string;
  requiredDecisionBody: string;
  evaluatedAmount: string;
  threshold: string;
  ruleVersionId: string;
};

export async function evaluateProjectApproval(
  projectId: string,
  evaluatedBy: string,
  session?: mongoose.ClientSession,
  changeRequestId?: string,
  reEvaluation = false,
): Promise<ApprovalEvaluation> {
  const project = await Project.findById(new Types.ObjectId(projectId))
    .select('_id societyId estimatedCost status currentQuotationId activeRuleVersionId')
    .session(session ?? null).lean().exec() as unknown as ApprovalProject | null;
  if (!project) throw notFound();

  const society = await Society.findById(project.societyId).select('activeRuleVersionId').session(session ?? null).lean().exec() as {
    activeRuleVersionId?: { toString(): string };
  } | null;
  if (!society?.activeRuleVersionId) {
    throw new ApiError(409, 'GOVERNANCE_CONFIGURATION_REQUIRED', 'The society has no active governance rule version.');
  }
  const rule = await SocietyRuleVersion.findOne({
    _id: society.activeRuleVersionId,
    societyId: project.societyId,
    status: 'ACTIVE',
    effectiveFrom: { $lte: new Date() },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: new Date() } }],
  }).session(session ?? null).lean().exec() as Record<string, unknown> | null;
  if (!rule) throw new ApiError(409, 'GOVERNANCE_CONFIGURATION_INVALID', 'The society active governance rule version is invalid.');

  const threshold = extractThreshold(rule.approvalPolicy);
  let evaluatedAmount = decimalText(project.estimatedCost);
  let quotationVersionId: Types.ObjectId | undefined;
  if (changeRequestId) {
    const changeRequest = await ChangeRequest.findOne({
      _id: new Types.ObjectId(changeRequestId),
      projectId: project._id,
    }).session(session ?? null).lean().exec() as { newAmount: { toString(): string } } | null;
    if (!changeRequest) throw notFound();
    evaluatedAmount = decimalText(changeRequest.newAmount);
  } else if (project.currentQuotationId) {
    const quotation = await Quotation.findOne({
      _id: project.currentQuotationId,
      projectId: project._id,
    }).session(session ?? null).lean().exec() as { amount: { toString(): string }; _id: Types.ObjectId } | null;
    if (quotation) {
      evaluatedAmount = decimalText(quotation.amount);
      quotationVersionId = quotation._id;
    }
  }
  const aboveThreshold = compareDecimal(evaluatedAmount, threshold) > 0;
  const approvalType = aboveThreshold ? 'SGM_REQUIRED' : 'COMMITTEE_APPROVAL';
  const requiredDecisionBody = aboveThreshold ? 'GENERAL_BODY_OR_SGM' : 'COMMITTEE';
  const ruleVersionId = String(rule._id);
  const decision = await ApprovalDecision.create([{
    societyId: project.societyId,
    projectId: project._id,
    ...(quotationVersionId ? { quotationVersionId } : {}),
    ...(changeRequestId ? { changeRequestId: new Types.ObjectId(changeRequestId) } : {}),
    ruleVersionId: rule._id,
    evaluatedAmount: mongoose.Types.Decimal128.fromString(evaluatedAmount),
    requiredThreshold: mongoose.Types.Decimal128.fromString(threshold),
    approvalType,
    requiredDecisionBody,
    status: reEvaluation ? 'RE_EVALUATED' : 'REQUIRED',
    reason: `Evaluated amount ${evaluatedAmount} against threshold ${threshold}.`,
    evaluatedBy: new Types.ObjectId(evaluatedBy),
    ruleSnapshot: {
      versionNumber: rule.versionNumber,
      effectiveFrom: rule.effectiveFrom,
      approvalPolicy: rule.approvalPolicy,
      threshold,
    },
  }], { session });
  return {
    decision: decision[0].toObject() as unknown as ApprovalDecisionRecord & { _id: Types.ObjectId },
    approvalType, requiredDecisionBody, evaluatedAmount, threshold, ruleVersionId,
  };
}

export function serializeApprovalEvaluation(value: ApprovalEvaluation): Record<string, unknown> {
  const decision = value.decision as unknown as Record<string, unknown>;
  return {
    _id: String(decision._id),
    projectId: String(decision.projectId),
    societyId: String(decision.societyId),
    ruleVersionId: value.ruleVersionId,
    evaluatedAmount: value.evaluatedAmount,
    threshold: value.threshold,
    approvalType: value.approvalType,
    requiredDecisionBody: value.requiredDecisionBody,
    status: decision.status,
    reason: decision.reason,
    evaluatedAt: decision.evaluatedAt,
    evaluatedBy: String(decision.evaluatedBy),
    ruleSnapshot: decision.ruleSnapshot,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

export function decimalText(value: { toString(): string } | string): string {
  const text = typeof value === 'string' ? value : value.toString();
  return normalizeDecimal(text);
}

function extractThreshold(policy: unknown): string {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new ApiError(409, 'GOVERNANCE_CONFIGURATION_INVALID', 'The active governance rule has no approval threshold.');
  }
  const threshold = (policy as Record<string, unknown>).threshold;
  if (typeof threshold !== 'string' && typeof threshold !== 'number') {
    throw new ApiError(409, 'GOVERNANCE_CONFIGURATION_INVALID', 'The active governance rule has no approval threshold.');
  }
  const text = String(threshold);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || text.replace('.', '').replace(/^0+/, '').length > 34) {
    throw new ApiError(409, 'GOVERNANCE_CONFIGURATION_INVALID', 'The active governance rule has an invalid approval threshold.');
  }
  return normalizeDecimal(text);
}

function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const whole = BigInt(leftWhole) - BigInt(rightWhole);
  if (whole !== 0n) return whole > 0n ? 1 : -1;
  const places = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(places, '0')}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(places, '0')}`);
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}
