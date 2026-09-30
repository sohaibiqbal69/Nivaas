import { Router } from 'express';
import { isDatabaseConnected } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  if (!isDatabaseConnected()) {
    response.status(503).json({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'A required service dependency is unavailable.' },
    });
    return;
  }

  response.status(200).json({
    success: true,
    data: { status: 'available', database: 'connected' },
  });
});
