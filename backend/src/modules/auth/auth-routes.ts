import { Router, type Request, type Response, type NextFunction } from 'express';
import { ApiError } from '../../lib/api-error.js';
import { AuthenticationService } from './authentication-service.js';

export function createAuthRouter(authenticationService: AuthenticationService = new AuthenticationService()): Router {
  const router = Router();

  router.post('/login', async (request: Request, response: Response, next: NextFunction) => {
    const body: unknown = request.body;
    if (!isLoginRequest(body)) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Email and password are required.'));
      return;
    }

    try {
      const result = await authenticationService.login(body.email.trim(), body.password);
      response.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isLoginRequest(value: unknown): value is { email: string; password: string } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.email === 'string' && body.email.trim().length > 0
    && typeof body.password === 'string' && body.password.length > 0;
}
