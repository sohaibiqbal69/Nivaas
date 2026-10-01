import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error.js';
import { loadCurrentUser } from '../../middleware/load-current-user.js';
import { requireRoles } from '../../middleware/require-roles.js';
import { authenticate } from '../auth/authentication-middleware.js';
import { User } from './models/User.js';

const USER_RESPONSE_FIELDS = [
  '_id',
  'societyId',
  'name',
  'email',
  'phone',
  'role',
  'walletAddress',
  'status',
  'createdAt',
  'updatedAt',
] as const;

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

export type UserReadRepository = {
  findAll(): Promise<UserProfileRecord[]>;
  findById(userId: string): Promise<UserProfileRecord | null>;
};

const userReadRepository: UserReadRepository = {
  async findAll() {
    return User.find()
      .select(USER_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<UserProfileRecord[]>;
  },
  async findById(userId) {
    return User.findById(userId)
      .select(USER_RESPONSE_FIELDS.join(' '))
      .lean()
      .exec() as unknown as Promise<UserProfileRecord | null>;
  },
};

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
  repository: UserReadRepository = userReadRepository,
  authenticateRequest = authenticate,
  loadAuthenticatedUser = loadCurrentUser,
): Router {
  const router = Router();

  router.get(
    '/',
    authenticateRequest,
    loadAuthenticatedUser,
    requireRoles('SYSTEM_ADMIN'),
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const users = await repository.findAll();
        response.status(200).json({ success: true, data: users.map(serializeUser) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id',
    authenticateRequest,
    loadAuthenticatedUser,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const currentUser = request.currentUser;
        if (!currentUser) {
          next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
          return;
        }

        const requestedIdParam = request.params.id;
        if (typeof requestedIdParam !== 'string' || !Types.ObjectId.isValid(requestedIdParam)) {
          throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
        }

        const requestedUserId = new Types.ObjectId(requestedIdParam).toString();
        if ((currentUser.role === 'OWNER_MEMBER' || currentUser.role === 'RESIDENT')
          && currentUser.userId !== requestedUserId) {
          throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
        }

        const user = await repository.findById(requestedUserId);
        if (!user) {
          throw new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.');
        }

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
    },
  );

  return router;
}
