import { Router, type Request, type Response, type NextFunction } from 'express';
import { ApiError } from '../../lib/api-error.js';
import { AuthenticationService } from './authentication-service.js';
import { AccountSetupService } from './account-setup-service.js';

export function createAuthRouter(
  authenticationService: AuthenticationService = new AuthenticationService(),
  accountSetupService: AccountSetupService = new AccountSetupService(),
): Router {
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

  router.post('/refresh', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const refreshToken = readRefreshToken(request.body);
      const result = await authenticationService.refresh(refreshToken);
      if (!result) throw new ApiError(401, 'UNAUTHORIZED', 'The authentication session has expired. Sign in again.');
      response.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const refreshToken = readRefreshToken(request.body);
      await authenticationService.logout(refreshToken);
      response.status(200).json({ success: true, data: {} });
    } catch (error) {
      next(error);
    }
  });

  router.post('/setup', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { credential, newPassword } = validateSetupRequest(request.body);
      await accountSetupService.setup(credential, newPassword);
      response.status(200).json({ success: true, data: {} });
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

function readRefreshToken(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A refresh token is required.');
  }
  const token = (value as Record<string, unknown>).refreshToken;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A refresh token is required.');
  }
  return token;
}

function validateSetupRequest(value: unknown): { credential: string; newPassword: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  }

  const body = value as Record<string, unknown>;

  if ('passwordHash' in body) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A client-supplied passwordHash is not permitted.');
  }

  if (typeof body.credential !== 'string' || body.credential.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid setup credential is required.');
  }

  if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A new password of at least 8 characters is required.');
  }

  return {
    credential: body.credential.trim(),
    newPassword: body.newPassword,
  };
}
