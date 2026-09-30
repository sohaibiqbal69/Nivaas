import type { AuthenticatedUserContext } from '../jwt.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUserContext;
    }
  }
}

export {};
