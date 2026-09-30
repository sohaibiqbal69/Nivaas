import type { RequestHandler } from 'express';
import { backendConfig } from '../../config/environment.js';
import { ApiError } from '../../lib/api-error.js';
import { verifyAccessToken } from './jwt.js';

export function createAuthenticationMiddleware(secret: () => string | undefined = () => backendConfig.jwtSecret): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.get('Authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      next(new ApiError(401, 'UNAUTHORIZED', 'A valid Bearer token is required.'));
      return;
    }

    const configuredSecret = secret();
    if (!configuredSecret) {
      next(new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.'));
      return;
    }

    try {
      const context = await verifyAccessToken(match[1], configuredSecret);
      if (!context) {
        next(new ApiError(401, 'UNAUTHORIZED', 'A valid Bearer token is required.'));
        return;
      }
      request.auth = context;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authenticate = createAuthenticationMiddleware();
