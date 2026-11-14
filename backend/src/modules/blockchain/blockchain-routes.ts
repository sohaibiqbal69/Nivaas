import { Router, type Request } from 'express';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { AuditLogProofService } from './audit-log-proof-service.js';
import { assertOwnerSocietyAccess, isOwnerTransparencyAuditEntity } from '../property/owner-society-access.js';

export type AuditLogProofActions = Pick<AuditLogProofService, 'submit' | 'status' | 'verify'>;

export function createBlockchainRouter(
  service?: AuditLogProofActions,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  let defaultService: AuditLogProofService | undefined;
  const actions = service ?? {
    submit: (id: string) => (defaultService ??= new AuditLogProofService()).submit(id),
    status: (id: string) => (defaultService ??= new AuditLogProofService()).status(id),
    verify: (id: string) => (defaultService ??= new AuditLogProofService()).verify(id),
  };
  const readable = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER')];
  const submitter = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER')];

  router.post('/blockchain/audit-logs/:auditLogId/proof', ...submitter, async (request, response, next) => {
    try {
      const auditLogId = await authorizeAuditRecord(request);
      const data = await actions.submit(auditLogId);
      response.status(data.status === 'PENDING' ? 202 : 200).json({ success: true, data });
    } catch (error) { next(error); }
  });

  router.get('/blockchain/audit-logs/:auditLogId/proof', ...readable, async (request, response, next) => {
    try {
      const auditLogId = await authorizeAuditRecord(request);
      const data = await actions.status(auditLogId);
      response.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  });

  router.get('/blockchain/verify/audit-logs/:auditLogId', ...readable, async (request, response, next) => {
    try {
      const auditLogId = await authorizeAuditRecord(request);
      const data = await actions.verify(auditLogId);
      response.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  });
  return router;
}

async function authorizeAuditRecord(request: Request): Promise<string> {
  const user = request.currentUser;
  if (!user || user.userId !== request.auth?.userId) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const value = request.params.auditLogId;
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'auditLogId must be a valid ObjectId.');
  }
  const event = await AuditLog.findById(value).select('_id societyId entityType').lean().exec() as { societyId?: { toString(): string } | null; entityType?: string } | null;
  if (!event) throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
  if (user.role === 'OWNER_MEMBER' && !isOwnerTransparencyAuditEntity(event.entityType)) {
    throw new ApiError(404, 'NOT_FOUND', 'AuditLog event was not found.');
  }
  if (user.role === 'SYSTEM_ADMIN') return value;
  if (!event.societyId || !user.societyId || event.societyId.toString() !== user.societyId) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this AuditLog event.');
  }
  await assertOwnerSocietyAccess(user, event.societyId.toString());
  return value;
}
