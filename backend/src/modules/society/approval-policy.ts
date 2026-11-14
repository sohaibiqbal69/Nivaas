import canonicalize from 'canonicalize';
import { keccak256, toUtf8Bytes } from 'ethers';
import { ApiError } from '../../lib/api-error.js';

export const APPROVAL_POLICY_COMMITMENT_VERSION = 1 as const;
export const APPROVAL_THRESHOLD_POLICY_TYPE = 'PROJECT_SPENDING_APPROVAL_THRESHOLD' as const;

export type ApprovalThresholdInput = {
  threshold: string;
  committeeApproval?: { quorumNumerator: number; quorumDenominator: number; quorumMaximum?: number; majorityNumerator: number; majorityDenominator: number; majorityComparison: 'STRICTLY_GREATER' | 'AT_LEAST' };
  reason?: string;
  supportingDocumentReference?: string;
};

export function validateApprovalThresholdInput(value: unknown): ApprovalThresholdInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A JSON object is required.');
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set(['societyId', 'threshold', 'reason', 'supportingDocumentReference', 'committeeApproval']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported approval policy fields.');
  }
  if (typeof body.threshold !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(body.threshold)
    || body.threshold.replace('.', '').replace(/^0+/, '').length > 34) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'threshold must be a non-negative exact decimal string.');
  }
  const reason = optionalText(body.reason, 'reason');
  const supportingDocumentReference = optionalText(body.supportingDocumentReference, 'supportingDocumentReference');
  if (!reason && !supportingDocumentReference) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A change reason or supporting document reference is required.');
  }
  const committeeApproval = parseCommitteeApproval(body.committeeApproval);
  return { threshold: body.threshold, ...(committeeApproval ? { committeeApproval } : {}), ...(reason ? { reason } : {}), ...(supportingDocumentReference ? { supportingDocumentReference } : {}) };
}

export function hashApprovalPolicyCommitment(input: {
  societyId: string;
  versionNumber: number;
  threshold: string;
  committeeApproval?: ApprovalThresholdInput['committeeApproval'];
}): string {
  const canonical = canonicalize({
    domain: 'NIVAAS_GOVERNANCE_POLICY_COMMITMENT',
    commitmentVersion: input.committeeApproval ? 2 : 1,
    societyId: input.societyId.toLowerCase(),
    policyType: input.committeeApproval ? 'PROJECT_APPROVAL_POLICY' : APPROVAL_THRESHOLD_POLICY_TYPE,
    policyVersion: input.versionNumber,
    configuration: { threshold: input.threshold, ...(input.committeeApproval ? { committeeApproval: input.committeeApproval } : {}) },
  });
  if (!canonical) throw new TypeError('Approval policy could not be canonicalized.');
  return keccak256(toUtf8Bytes(canonical)).toLowerCase();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > (field === 'reason' ? 500 : 240)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a non-empty string within its length limit.`);
  }
  return value.trim();
}

function parseCommitteeApproval(value: unknown): ApprovalThresholdInput['committeeApproval'] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'committeeApproval must be an object.');
  const policy = value as Record<string, unknown>;
  const allowed = ['quorumNumerator', 'quorumDenominator', 'quorumMaximum', 'majorityNumerator', 'majorityDenominator', 'majorityComparison'];
  if (Object.keys(policy).some(key => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'committeeApproval contains unsupported settings.');
  const integer = (key: string, min = 1) => Number.isInteger(policy[key]) && Number(policy[key]) >= min;
  if (!integer('quorumNumerator') || !integer('quorumDenominator') || Number(policy.quorumNumerator) > Number(policy.quorumDenominator)
    || policy.quorumMaximum !== undefined && !integer('quorumMaximum')
    || !integer('majorityNumerator') || !integer('majorityDenominator') || Number(policy.majorityNumerator) > Number(policy.majorityDenominator)
    || !['STRICTLY_GREATER', 'AT_LEAST'].includes(String(policy.majorityComparison))) throw new ApiError(400, 'VALIDATION_ERROR', 'committeeApproval requires valid quorum and majority ratios.');
  return { quorumNumerator: Number(policy.quorumNumerator), quorumDenominator: Number(policy.quorumDenominator), ...(policy.quorumMaximum === undefined ? {} : { quorumMaximum: Number(policy.quorumMaximum) }), majorityNumerator: Number(policy.majorityNumerator), majorityDenominator: Number(policy.majorityDenominator), majorityComparison: policy.majorityComparison as 'STRICTLY_GREATER' | 'AT_LEAST' };
}
