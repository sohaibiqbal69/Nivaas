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

  console.error('Unhandled request error', {
    name: error instanceof Error ? redactSecrets(error.name) : 'UnknownError',
    message: redactSecrets(error instanceof Error ? error.message : String(error)),
    ...(error instanceof Error && error.stack ? { stack: redactSecrets(error.stack) } : {}),
  });

  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
};

function redactSecrets(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\bmongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization)(\s*[=:]\s*)[^\s,;&]+/gi, '$1$2[REDACTED]');
}

function isMalformedJson(error: unknown): error is SyntaxError & { status: number; type: string } {
  return error instanceof SyntaxError
    && 'status' in error && error.status === 400
    && 'type' in error && error.type === 'entity.parse.failed';
}
