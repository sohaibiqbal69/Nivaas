import type { AuthenticatedUserContext } from '../jwt.js';
import type { CurrentUserContext } from '../../../middleware/load-current-user.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUserContext;
      currentUser?: CurrentUserContext;
    }
  }
}

export {};
