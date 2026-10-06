import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { generateSetupCredential } from '../auth/credential.js';
import { AccountSetupCredential } from '../auth/models/AccountSetupCredential.js';
import { AuditLog } from '../audit/models/AuditLog.js';
import { User, USER_ROLES } from './models/User.js';

const USER_RESPONSE_FIELDS = [
  '_id', 'societyId', 'name', 'email', 'phone', 'role', 'walletAddress', 'status', 'createdAt', 'updatedAt',
] as const;

type SafeField = 'name' | 'email' | 'phone' | 'walletAddress';
type UserWriteData = {
  societyId: string | null;
  name: string;
  email: string;
  phone?: string;
  walletAddress?: string;
  role: string;
  status: 'PENDING_SETUP';
};

export type UserProfileRecord = {
  _id: { toString(): string };
  societyId: { toString(): string } | null;
  name: string;
  email: string;
  phone?: string;
  role: string;
  walletAddress?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
};

type UserAdministrationRecord = UserProfileRecord & { passwordHash?: string };
type AuditInput = {
  action: 'USER_ROLE_CHANGED' | 'USER_STATUS_CHANGED';
  actorId: string;
  entityId: string;
  societyId: string | null;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
};

export type UserAdministrationRepository = {
  findAll(): Promise<UserProfileRecord[]>;
  findById(userId: string): Promise<UserProfileRecord | null>;
  createWithCredential?(data: UserWriteData, credential: { credentialHash: string; expiresAt: Date }): Promise<UserProfileRecord>;
  findByIdForAdministration?(userId: string): Promise<UserAdministrationRecord | null>;
  updateProfile?(userId: string, data: Partial<Record<SafeField, string>>): Promise<UserProfileRecord | null>;
  updateRole?(userId: string, role: string): Promise<UserProfileRecord | null>;
  updateStatus?(userId: string, status: string): Promise<UserProfileRecord | null>;
  updateRoleWithAudit?(userId: string, role: string, input: AuditInput): Promise<UserProfileRecord | null>;
  updateStatusWithAudit?(userId: string, status: string, input: AuditInput): Promise<UserProfileRecord | null>;
  countActiveSystemAdmins?(): Promise<number>;
  createAuditLog?(input: AuditInput): Promise<void>;
};

const userAdministrationRepository: UserAdministrationRepository = {
  async findAll() {
    return User.find().select(USER_RESPONSE_FIELDS.join(' ')).lean().exec() as unknown as Promise<UserProfileRecord[]>;
  },
  async findById(userId) {
    return User.findById(userId).select(USER_RESPONSE_FIELDS.join(' ')).lean().exec() as unknown as Promise<UserProfileRecord | null>;
  },
  async createWithCredential(data, credential) {
    const session = await mongoose.startSession();
    try {
      let created: UserProfileRecord | null = null;
      await session.withTransaction(async () => {
        const [user] = await User.create([data], { session });
        await AccountSetupCredential.create([{ userId: user._id, ...credential }], { session });
        const createdDocument = await User.findById(user._id)
          .select(USER_RESPONSE_FIELDS.join(' ')).lean().session(session).exec();
        created = createdDocument as unknown as UserProfileRecord;
      });
      if (!created) throw new Error('User creation did not return a persisted user.');
      return created;
    } finally {
      await session.endSession();
    }
  },
  async findByIdForAdministration(userId) {
    const result = await User.findById(userId).select(`${USER_RESPONSE_FIELDS.join(' ')} +passwordHash`).lean().exec();
    return result as unknown as UserAdministrationRecord | null;
  },
  async updateProfile(userId, data) {
    return User.findByIdAndUpdate(userId, data, { new: true, runValidators: true })
      .select(USER_RESPONSE_FIELDS.join(' ')).lean().exec() as unknown as Promise<UserProfileRecord | null>;
  },
  async updateRole(userId, role) {
    return User.findByIdAndUpdate(userId, { role }, { new: true, runValidators: true })
      .select(USER_RESPONSE_FIELDS.join(' ')).lean().exec() as unknown as Promise<UserProfileRecord | null>;
  },
  async updateRoleWithAudit(userId, role, input) {
    return updateWithAudit(userId, { role }, input);
  },
  async updateStatus(userId, status) {
    return User.findByIdAndUpdate(userId, { status }, { new: true, runValidators: true })
      .select(USER_RESPONSE_FIELDS.join(' ')).lean().exec() as unknown as Promise<UserProfileRecord | null>;
  },
  async updateStatusWithAudit(userId, status, input) {
    return updateWithAudit(userId, { status }, input);
  },
  async countActiveSystemAdmins() {
    return User.countDocuments({ role: 'SYSTEM_ADMIN', status: 'ACTIVE' }).exec();
  },
  async createAuditLog(input) {
    await new AuditLog({
      action: input.action,
      actorId: input.actorId,
      entityType: 'User',
      entityId: input.entityId,
      societyId: input.societyId,
      previousState: input.previousState,
      newState: input.newState,
    }).save();
  },
};

async function updateWithAudit(
  userId: string,
  update: Record<string, string>,
  input: AuditInput,
): Promise<UserProfileRecord | null> {
  const session = await mongoose.startSession();
  try {
    let updated: UserProfileRecord | null = null;
    await session.withTransaction(async () => {
      updated = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true })
        .select(USER_RESPONSE_FIELDS.join(' ')).session(session).lean().exec() as unknown as UserProfileRecord | null;
      if (!updated) return;
      await new AuditLog({
        action: input.action,
        actorId: input.actorId,
        entityType: 'User',
        entityId: input.entityId,
        societyId: input.societyId,
        previousState: input.previousState,
        newState: input.newState,
      }).save({ session });
    });
    return updated;
  } finally {
    await session.endSession();
  }
}

export type UserReadRepository = Pick<UserAdministrationRepository, 'findAll' | 'findById'>;

export function serializeUser(user: UserProfileRecord): Record<string, unknown> {
  const safeUser: Record<string, unknown> = {
    _id: user._id.toString(),
    societyId: user.societyId?.toString() ?? null,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
  if (user.phone !== undefined) safeUser.phone = user.phone;
  if (user.walletAddress !== undefined) safeUser.walletAddress = user.walletAddress;
  return safeUser;
}

export function createUsersRouter(
  repository: UserAdministrationRepository = userAdministrationRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();
  const adminOnly = [authenticateRequest, loadAuthenticatedUser, requireRoles('SYSTEM_ADMIN')] as const;

  router.post('/', ...adminOnly, async (request, response, next) => {
    try {
      const data = validateCreateUserRequest(request.body);
      const credential = generateSetupCredential();
      const user = await requireAdminMethod(repository.createWithCredential)(data, credential);
      response.status(201).json({ success: true, data: serializeUser(user) });
    } catch (error) {
      next(normalizeUserWriteError(error));
    }
  });

  router.get('/', ...adminOnly, async (_request, response, next) => {
    try {
      const users = await repository.findAll();
      response.status(200).json({ success: true, data: users.map(serializeUser) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/role', ...adminOnly, async (request, response, next) => {
    try {
      const actor = requireCurrentUser(request);
      const userId = parseUserId(request.params.id);
      const role = validateRoleRequest(request.body);
      const target = await requireAdminMethod(repository.findByIdForAdministration)(userId);
      if (!target) throw notFound();
      if (target.role === role) throw new ApiError(400, 'VALIDATION_ERROR', 'The user already has this role.');
      const previousRole = target.role;
      if (role === 'SYSTEM_ADMIN' && target.societyId !== null) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'SYSTEM_ADMIN users must not have a society association.');
      }
      if (role !== 'SYSTEM_ADMIN' && target.societyId === null) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Society-scoped roles require a society association.');
      }
      const auditInput = {
        action: 'USER_ROLE_CHANGED' as const,
        actorId: actor.userId,
        entityId: userId,
        societyId: target.societyId?.toString() ?? null,
        previousState: { role: previousRole },
        newState: { role },
      };
      const updated = repository.updateRoleWithAudit
        ? await repository.updateRoleWithAudit(userId, role, auditInput)
        : await requireAdminMethod(repository.updateRole)(userId, role);
      if (!updated) throw notFound();
      if (!repository.updateRoleWithAudit) await requireAdminMethod(repository.createAuditLog)(auditInput);
      response.status(200).json({ success: true, data: serializeUser(updated) });
    } catch (error) {
      next(normalizeUserWriteError(error));
    }
  });

  router.patch('/:id/status', ...adminOnly, async (request, response, next) => {
    try {
      const actor = requireCurrentUser(request);
      const userId = parseUserId(request.params.id);
      const requestedStatus = validateStatusRequest(request.body);
      const target = await requireAdminMethod(repository.findByIdForAdministration)(userId);
      if (!target) throw notFound();
      if (target.status === requestedStatus) throw new ApiError(400, 'VALIDATION_ERROR', 'The user already has this status.');
      const previousStatus = target.status;
      if (requestedStatus === 'DISABLED' && actor.userId === userId) {
        throw new ApiError(403, 'FORBIDDEN', 'A System Administrator cannot disable their own account.');
      }
      if (requestedStatus === 'ACTIVE' && (target.status !== 'DISABLED' || !target.passwordHash)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Only a disabled active account may be reactivated.');
      }
      if (requestedStatus === 'PENDING_SETUP' && (target.status !== 'DISABLED' || target.passwordHash)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Only a disabled pending account may return to pending setup.');
      }
      if (requestedStatus === 'DISABLED' && target.status === 'ACTIVE'
        && target.role === 'SYSTEM_ADMIN' && await requireAdminMethod(repository.countActiveSystemAdmins)() <= 1) {
        throw new ApiError(403, 'FORBIDDEN', 'The last active System Administrator cannot be disabled.');
      }
      const auditInput = {
        action: 'USER_STATUS_CHANGED' as const,
        actorId: actor.userId,
        entityId: userId,
        societyId: target.societyId?.toString() ?? null,
        previousState: { status: previousStatus },
        newState: { status: requestedStatus },
      };
      const updated = repository.updateStatusWithAudit
        ? await repository.updateStatusWithAudit(userId, requestedStatus, auditInput)
        : await requireAdminMethod(repository.updateStatus)(userId, requestedStatus);
      if (!updated) throw notFound();
      if (!repository.updateStatusWithAudit) await requireAdminMethod(repository.createAuditLog)(auditInput);
      response.status(200).json({ success: true, data: serializeUser(updated) });
    } catch (error) {
      next(normalizeUserWriteError(error));
    }
  });

  router.patch('/:id', ...adminOnly, async (request, response, next) => {
    try {
      const updated = await requireAdminMethod(repository.updateProfile)(parseUserId(request.params.id), validateProfileRequest(request.body));
      if (!updated) throw notFound();
      response.status(200).json({ success: true, data: serializeUser(updated) });
    } catch (error) {
      next(normalizeUserWriteError(error));
    }
  });

  router.get('/:id', authenticateRequest, loadAuthenticatedUser, async (request, response, next) => {
    try {
      const currentUser = request.currentUser;
      if (!currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
      const requestedUserId = parseUserId(request.params.id);
      if ((currentUser.role === 'OWNER_MEMBER' || currentUser.role === 'RESIDENT')
        && currentUser.userId !== requestedUserId) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      }
      const user = await repository.findById(requestedUserId);
      if (!user) throw notFound();
      if (currentUser.role === 'SYSTEM_ADMIN') {
        response.status(200).json({ success: true, data: serializeUser(user) });
        return;
      }
      if (currentUser.role === 'SOCIETY_MANAGER' || currentUser.role === 'COMMITTEE_MEMBER') {
        if (currentUser.societyId !== user.societyId?.toString()) {
          throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
        }
        response.status(200).json({ success: true, data: serializeUser(user) });
        return;
      }
      if (currentUser.role === 'OWNER_MEMBER' || currentUser.role === 'RESIDENT') {
        response.status(200).json({ success: true, data: serializeUser(user) });
        return;
      }
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireCurrentUser(request: Request) {
  if (!request.currentUser) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return request.currentUser;
}

function requireAdminMethod<Args extends unknown[], Result>(
  method: ((...args: Args) => Result) | undefined,
): (...args: Args) => Result {
  if (!method) throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'User administration is not configured.');
  return method;
}

function parseUserId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw notFound();
  return new Types.ObjectId(value).toString();
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
}

function validateCreateUserRequest(value: unknown): UserWriteData {
  const body = validateObject(value);
  const allowed = new Set(['societyId', 'name', 'email', 'phone', 'walletAddress', 'role']);
  if (Object.keys(body).some((field) => !allowed.has(field))
    || 'password' in body || 'passwordHash' in body || 'credential' in body || 'credentialHash' in body) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request contains unsupported user fields.');
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0
    || typeof body.email !== 'string' || body.email.trim().length === 0
    || typeof body.role !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Name, email, and role are required.');
  }
  const role = validateRole(body.role);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address.');
  }
  const societyId = body.societyId;
  if (role !== 'SYSTEM_ADMIN' && (typeof societyId !== 'string' || !Types.ObjectId.isValid(societyId))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid societyId is required for society-scoped users.');
  }
  if (role === 'SYSTEM_ADMIN' && societyId !== undefined && societyId !== null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'SYSTEM_ADMIN users must not be assigned a society.');
  }
  const normalizedSocietyId = typeof societyId === 'string' ? new Types.ObjectId(societyId).toString() : null;
  return {
    societyId: normalizedSocietyId,
    name: body.name.trim(),
    email: body.email.trim(),
    ...(body.phone === undefined ? {} : { phone: validateString(body.phone, 'phone') }),
    ...(body.walletAddress === undefined ? {} : { walletAddress: validateString(body.walletAddress, 'walletAddress') }),
    role,
    status: 'PENDING_SETUP',
  };
}

function validateProfileRequest(value: unknown): Partial<Record<SafeField, string>> {
  const body = validateObject(value);
  const allowed = new Set<SafeField>(['name', 'email', 'phone', 'walletAddress']);
  if (Object.keys(body).length === 0 || Object.keys(body).some((field) => !allowed.has(field as SafeField))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only safe profile fields may be updated.');
  }
  const result: Partial<Record<SafeField, string>> = {};
  for (const field of allowed) {
    if (field in body) result[field] = validateString(body[field], field);
  }
  if (result.name !== undefined && result.name.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name must not be empty.');
  }
  if (result.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result.email)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'email must be a valid email address.');
  }
  return result;
}

function validateRoleRequest(value: unknown): string {
  const body = validateObject(value);
  if (Object.keys(body).length !== 1 || typeof body.role !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid role is required.');
  }
  return validateRole(body.role);
}

function validateStatusRequest(value: unknown): 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED' {
  const body = validateObject(value);
  if (Object.keys(body).length !== 1
    || (body.status !== 'PENDING_SETUP' && body.status !== 'ACTIVE' && body.status !== 'DISABLED')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be PENDING_SETUP, ACTIVE, or DISABLED.');
  }
  return body.status;
}

function validateRole(value: string): string {
  if (!USER_ROLES.includes(value as typeof USER_ROLES[number])) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The requested role is not valid.');
  }
  return value;
}

function validateObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function validateString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
  return value.trim();
}

function normalizeUserWriteError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
    return new ApiError(409, 'CONFLICT', 'The email is already in use.');
  }
  return error;
}
