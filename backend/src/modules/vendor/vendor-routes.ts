import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser, type CurrentUserContext } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { Society } from '../society/models/Society.js';
import { Vendor } from './models/Vendor.js';
import { assertOwnerSocietyAccess } from '../property/owner-society-access.js';

const vendorFields = '_id societyId name companyName contactPerson phone email address registrationDetails status createdAt updatedAt';
const readRoles = ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] as const;
const writeRoles = ['SYSTEM_ADMIN', 'SOCIETY_MANAGER'] as const;

export function validateVendorInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('The request body must be an object.');
  const body = value as Record<string, unknown>;
  const fields = ['societyId', 'name', 'companyName', 'contactPerson', 'phone', 'email', 'address', 'registrationDetails'];
  if (Object.keys(body).some((field) => !fields.includes(field))) throw validation('The request contains unsupported vendor fields.');
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field) || field === 'societyId') continue;
    const item = body[field];
    if (field === 'name') {
      if (typeof item !== 'string' || !item.trim()) throw validation('name must be a non-empty string.');
      result.name = item.trim();
    } else if (item !== undefined && item !== null && item !== '') {
      if (typeof item !== 'string') throw validation(`${field} must be a string.`);
      result[field] = item.trim();
    }
  }
  if (body.societyId !== undefined) result.societyId = parseObjectId(body.societyId, 'societyId');
  if (result.name === undefined) throw validation('name must be a non-empty string.');
  return result;
}

export function createVendorsRouter(authenticateRequest = authenticate, loadAuthenticatedUser = loadCurrentUser): Router {
  const router = Router();
  router.get('/vendors', authenticateRequest, loadAuthenticatedUser, requireRoles(...readRoles), async (request, response, next) => {
    try {
      const user = currentUser(request);
      if (user.role !== 'SYSTEM_ADMIN' && !user.societyId) throw forbidden();
      const societyId = user.role === 'SYSTEM_ADMIN'
        ? parseObjectId(request.query.societyId, 'societyId')
        : new Types.ObjectId(user.societyId!);
      if (user.role === 'OWNER_MEMBER') await assertOwnerSocietyAccess(user, societyId.toString());
      const vendors = await Vendor.find({ societyId, status: 'ACTIVE' }).select(vendorFields).sort({ name: 1, _id: 1 }).lean().exec();
      response.json({ success: true, data: vendors.map((vendor) => serializeVendor(vendor, user.role === 'OWNER_MEMBER')) });
    } catch (error) { next(error); }
  });

  router.post('/vendors', authenticateRequest, loadAuthenticatedUser, requireRoles(...writeRoles), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const input = validateVendorInput(request.body);
      const societyId = user.role === 'SYSTEM_ADMIN' ? input.societyId as Types.ObjectId | undefined : new Types.ObjectId(user.societyId!);
      if (!societyId) throw validation('societyId is required for platform administration.');
      if (user.role !== 'SYSTEM_ADMIN' && input.societyId !== undefined && String(input.societyId) !== user.societyId) throw forbidden();
      if (!(await Society.exists({ _id: societyId }))) throw validation('The society does not exist.');

      const session = await mongoose.startSession();
      try {
        let record: Record<string, any> | null = null;
        await session.withTransaction(async () => {
          const [created] = await Vendor.create([{ ...input, societyId, status: 'ACTIVE' }], { session });
          await new AuditLog({
            societyId, actorId: user.userId, action: 'VENDOR_CREATED', entityType: 'Vendor', entityId: created._id,
            previousState: {}, newState: { name: created.name, status: created.status },
          }).save({ session });
          record = created.toObject();
        });
        if (!record) throw new Error('Vendor creation did not return a persisted record.');
        response.status(201).json({ success: true, data: serializeVendor(record) });
      } finally { await session.endSession(); }
    } catch (error) { next(error); }
  });
  return router;
}

function serializeVendor(record: Record<string, any>, transparencyView = false): Record<string, unknown> {
  return {
    _id: record._id.toString(), societyId: record.societyId.toString(), name: record.name,
    ...(record.companyName ? { companyName: record.companyName } : {}),
    ...(!transparencyView && record.contactPerson ? { contactPerson: record.contactPerson } : {}),
    ...(!transparencyView && record.phone ? { phone: record.phone } : {}),
    ...(!transparencyView && record.email ? { email: record.email } : {}),
    ...(!transparencyView && record.address ? { address: record.address } : {}),
    ...(!transparencyView && record.registrationDetails ? { registrationDetails: record.registrationDetails } : {}),
    status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}
function currentUser(request: Request): CurrentUserContext {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}
function parseObjectId(value: unknown, field: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw validation(`${field} must be a valid ObjectId.`);
  return new Types.ObjectId(value);
}
function validation(message: string): ApiError { return new ApiError(400, 'VALIDATION_ERROR', message); }
function forbidden(): ApiError { return new ApiError(403, 'FORBIDDEN', 'The requested society is not accessible to this account.'); }
