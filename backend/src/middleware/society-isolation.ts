import type { Request, RequestHandler, Response } from 'express';
import { ApiError } from '../lib/api-error.js';
import type { CurrentUserContext } from './load-current-user.js';

export type SocietyId = string | { toString(): string };
// The resolver should read the society ID from a resource loaded by the backend, not raw client input.
export type ResourceSocietyIdResolver = (request: Request, response: Response) => SocietyId | undefined;

export function assertSameSociety(currentUser: CurrentUserContext | undefined, resourceSocietyId: SocietyId | undefined): void {
  if (!currentUser) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (
    currentUser.role === 'SYSTEM_ADMIN'
    || currentUser.societyId === null
    || !resourceSocietyId
    || currentUser.societyId !== resourceSocietyId.toString()
  ) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
  }
}

export function requireSameSociety(resolveResourceSocietyId: ResourceSocietyIdResolver): RequestHandler {
  return (request, response, next) => {
    try {
      if (!request.auth?.userId || request.currentUser?.userId !== request.auth.userId) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
      }
      assertSameSociety(request.currentUser, resolveResourceSocietyId(request, response));
      next();
    } catch (error) {
      next(error);
    }
  };
}
