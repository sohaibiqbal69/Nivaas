import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/api-error.js';

export function notFoundHandler(_request: Request, _response: Response, next: NextFunction): void {
  next(new ApiError(404, 'NOT_FOUND', 'The requested API resource was not found.'));
}
