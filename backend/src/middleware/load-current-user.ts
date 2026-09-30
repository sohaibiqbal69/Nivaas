import type { RequestHandler } from 'express';
import { User, USER_ROLES } from '../modules/users/models/User.js';
import { ApiError } from '../lib/api-error.js';

export type ApplicationRole = typeof USER_ROLES[number];

export type CurrentUserContext = {
  userId: string;
  societyId: string;
  role: ApplicationRole;
};

export type CurrentUserRecord = {
  _id: { toString(): string };
  societyId: { toString(): string };
  role: string;
};

export type CurrentUserRepository = {
  findById(userId: string): Promise<CurrentUserRecord | null>;
};

const userRepository: CurrentUserRepository = {
  async findById(userId) {
    return User.findById(userId).select('_id societyId role').lean().exec() as Promise<CurrentUserRecord | null>;
  },
};

export function createLoadCurrentUser(repository: CurrentUserRepository = userRepository): RequestHandler {
  return async (request, _response, next) => {
    const userId = request.auth?.userId;
    if (!userId) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }

    try {
      const user = await repository.findById(userId);
      if (!user) {
        next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
        return;
      }

      if (!USER_ROLES.includes(user.role as ApplicationRole)) {
        next(new ApiError(403, 'FORBIDDEN', 'The authenticated account has no permitted application role.'));
        return;
      }

      request.currentUser = {
        userId: user._id.toString(),
        societyId: user.societyId.toString(),
        role: user.role as ApplicationRole,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const loadCurrentUser = createLoadCurrentUser();
