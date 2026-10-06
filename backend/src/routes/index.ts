import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter } from '../modules/auth/auth-routes.js';
import { createUsersRouter } from '../modules/users/user-routes.js';
import { createSocietiesRouter } from '../modules/society/society-routes.js';

export const apiRouter = Router();
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', createAuthRouter());
apiRouter.use('/users', createUsersRouter());
apiRouter.use('/societies', createSocietiesRouter());
