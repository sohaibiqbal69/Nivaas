import express from 'express';
import { createServer } from 'node:http';
import { ApiError } from '../../backend/src/lib/api-error.js';
import { errorHandler } from '../../backend/src/middleware/error-handler.js';
import { requireRoles } from '../../backend/src/middleware/require-roles.js';
import { requireSameSociety } from '../../backend/src/middleware/society-isolation.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../../backend/src/middleware/load-current-user.js';
import { createAuthenticationMiddleware } from '../../backend/src/modules/auth/authentication-middleware.js';
import {
  AuthenticationService,
  hashPassword,
  type AuthSessionRecord,
  type AuthSessionRepository,
  type LoginUserRecord,
  type UserRepository,
} from '../../backend/src/modules/auth/authentication-service.js';
import { createAuthRouter } from '../../backend/src/modules/auth/auth-routes.js';

const secret = 'nivaas-e2e-only-secret-with-at-least-32-bytes';
const societyId = 'f'.repeat(24);
const roles = ['SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'] as const;
const password = 'nivaas-e2e-test-password';
let users: LoginUserRecord[] = [];
const sessions: AuthSessionRecord[] = [];
const resourceSocieties = new Map([['same-society-resource', societyId], ['other-society-resource', 'e'.repeat(24)]]);
let refreshAttempts = 0;

const userRepository: UserRepository = {
  async findByEmail(email) { return users.find((user) => user.email === email) ?? null; },
  async findById(id) { return users.find((user) => user._id.toString() === id) ?? null; },
};

const sessionRepository: AuthSessionRepository = {
  async create(session) { sessions.push(session); },
  async findByTokenHash(hash) {
    refreshAttempts += 1;
    return sessions.find((session) => session.tokenHash === hash) ?? null;
  },
  async revoke(hash, at) {
    const session = sessions.find((item) => item.tokenHash === hash);
    if (session) session.revokedAt = at;
  },
};

const service = new AuthenticationService(
  userRepository,
  () => ({ secret, accessTokenTtlSeconds: 15 }),
  sessionRepository,
  () => 10 * 60,
);
const app = express();
const authenticate = createAuthenticationMiddleware(() => secret);
const loadCurrentUser = createLoadCurrentUser({
  async findById(userId): Promise<CurrentUserRecord | null> {
    const user = await userRepository.findById(userId);
    if (!user) return null;
    return { _id: user._id, societyId: user.societyId, role: user.role, status: user.status };
  },
});

app.disable('x-powered-by');
app.use(express.json());
app.get('/api/health', (_request, response) => response.status(200).json({ success: true, data: { status: 'ready' } }));
app.use('/api/auth', createAuthRouter(service));
app.get('/api/e2e/metrics', (_request, response) => response.json({ success: true, data: { refreshAttempts } }));
app.get('/api/e2e/session-context', authenticate, loadCurrentUser, (request, response, next) => {
  if (!request.currentUser) {
    next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
    return;
  }
  response.json({ success: true, data: request.currentUser });
});
for (const role of roles) {
  app.get(`/api/e2e/role-check/${role}`, authenticate, loadCurrentUser, requireRoles(role), (_request, response) => {
    response.json({ success: true, data: { authorizedRole: role } });
  });
}
app.get('/api/e2e/society-check/:resourceId', authenticate, loadCurrentUser, requireSameSociety((request) => resourceSocieties.get(String(request.params.resourceId ?? ''))), (request, response) => {
  response.json({ success: true, data: { resourceId: request.params.resourceId } });
});
app.get('/api/users/:id', authenticate, loadCurrentUser, (request, response, next) => {
  if (!request.currentUser) {
    next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
    return;
  }
  if (request.params.id !== request.currentUser.userId) {
    next(new ApiError(403, 'FORBIDDEN', 'The test session may only read its own profile.'));
    return;
  }
  const user = users.find((item) => item._id.toString() === request.currentUser!.userId);
  if (!user) {
    next(new ApiError(404, 'NOT_FOUND', 'The test profile was not found.'));
    return;
  }
  response.json({ success: true, data: { _id: user._id.toString(), societyId: user.societyId?.toString() ?? null, name: user.name, email: user.email, role: user.role } });
});
app.use('/api', authenticate, loadCurrentUser, (_request, _response, next) => {
  next(new ApiError(404, 'NOT_FOUND', 'No domain records are configured in the isolated auth test server.'));
});
app.use(errorHandler);

const port = Number(process.env.NIVAAS_E2E_AUTH_PORT ?? '4011');
const server = createServer(app);
void hashPassword(password).then((passwordHash) => {
  users = roles.map((role, index) => {
    const id = `${'0'.repeat(23)}${index + 1}`;
    return {
      _id: { toString: () => id },
      societyId: { toString: () => societyId },
      name: `Test ${role}`,
      email: `${role.toLowerCase()}@example.test`,
      role,
      status: 'ACTIVE',
      passwordHash,
    };
  });
  server.listen(port, '127.0.0.1', () => console.info(`Nivaas isolated auth test server listening on ${port}`));
}).catch((error: unknown) => {
  console.error('Nivaas isolated auth test server failed to initialize.', error);
  process.exitCode = 1;
});
server.on('error', (error) => {
  console.error('Nivaas isolated auth test server failed to start.', error.message);
  process.exitCode = 1;
});

process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());






