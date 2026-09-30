import type { NextFunction, Request, Response } from 'express';
import { backendConfig } from '../config/environment.js';

export function corsMiddleware(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get('Origin');
  response.vary('Origin');

  if (origin && backendConfig.corsOrigin && origin === backendConfig.corsOrigin) {
    response.setHeader('Access-Control-Allow-Origin', backendConfig.corsOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }

  next();
}
