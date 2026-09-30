import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../lib/api-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (isMalformedJson(error)) {
    response.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'The request body must contain valid JSON.' },
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
};

function isMalformedJson(error: unknown): error is SyntaxError & { status: number; type: string } {
  return error instanceof SyntaxError
    && 'status' in error && error.status === 400
    && 'type' in error && error.type === 'entity.parse.failed';
}
