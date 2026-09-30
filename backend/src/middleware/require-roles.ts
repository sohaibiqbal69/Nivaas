import type { RequestHandler } from 'express';
import { ApiError } from '../lib/api-error.js';
import type { ApplicationRole } from './load-current-user.js';

export function requireRoles(...roles: ApplicationRole[]): RequestHandler {
  return (request, _response, next) => {
    const currentUser = request.currentUser;
    if (!request.auth?.userId || !currentUser || currentUser.userId !== request.auth.userId) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }

    if (!roles.includes(currentUser.role)) {
      next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
      return;
    }

    next();
  };
}
