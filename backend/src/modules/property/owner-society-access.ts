import { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { Ownership } from './models/Ownership.js';

export type OwnerSocietyContext = {
  userId: string;
  societyId: string | null;
  role: string;
};

export type ActiveOwnershipChecker = (userId: string, societyId: string, at: Date) => Promise<boolean>;

export const OWNER_TRANSPARENCY_AUDIT_ENTITY_TYPES = [
  'Project', 'Quotation', 'ChangeRequest', 'ApprovalDecision', 'Budget', 'BudgetCategory',
  'ProjectUpdate', 'GovernanceResolution', 'Meeting', 'SocietyRuleVersion', 'NOTICE',
  'Vendor',
] as const;

export function isOwnerTransparencyAuditEntity(entityType: string | undefined): boolean {
  return entityType !== undefined && (OWNER_TRANSPARENCY_AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType);
}

const ownershipExists: ActiveOwnershipChecker = async (userId, societyId, at) => Boolean(await Ownership.exists({
  userId: new Types.ObjectId(userId),
  societyId: new Types.ObjectId(societyId),
  status: 'ACTIVE',
  $and: [
    { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: at } }] },
    { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gt: at } }] },
  ],
}));

/** Owner transparency follows recorded ownership, not residence or app role alone. */
export async function assertOwnerSocietyAccess(
  user: OwnerSocietyContext,
  targetSocietyId: string,
  hasActiveOwnership: ActiveOwnershipChecker = ownershipExists,
): Promise<void> {
  if (user.role !== 'OWNER_MEMBER') return;
  if (!user.societyId || user.societyId !== targetSocietyId
    || !(await hasActiveOwnership(user.userId, targetSocietyId, new Date()))) {
    throw new ApiError(404, 'NOT_FOUND', 'The requested society record was not found.');
  }
}
