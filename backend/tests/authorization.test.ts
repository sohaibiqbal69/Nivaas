import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLoadCurrentUser, type CurrentUserRecord } from '../src/middleware/load-current-user.js';
import { requireRoles } from '../src/middleware/require-roles.js';
import { requireSameSociety } from '../src/middleware/society-isolation.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';

const secret = 'authorization-tests-use-an-independent-secret';
const jwtConfiguration = { secret, accessTokenTtlSeconds: 300 };
const userAId = '68a1234567890123456789a1';
const userBId = '68a1234567890123456789b2';
const societyAId = '68a1234567890123456789c3';
const societyBId = '68a1234567890123456789d4';
const servers: Server[] = [];

async function startServer(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function record(userId: string, societyId: string, role = 'OWNER_MEMBER'): CurrentUserRecord {
  return {
    _id: { toString: () => userId },
    societyId: { toString: () => societyId },
    role,
  };
}

function createProtectedApp(records: Map<string, CurrentUserRecord>, lookup = vi.fn(async (userId: string) => records.get(userId) ?? null)) {
  const app = express();
  app.use(express.json());
  const authenticate = createAuthenticationMiddleware(() => secret);
  const loadCurrentUser = createLoadCurrentUser({ findById: lookup });

  const addResourceRoute = (path: string, resourceSocietyId: string) => {
    app.post(
      path,
      authenticate,
      loadCurrentUser,
      requireRoles('OWNER_MEMBER'),
      (_request, response, next) => {
        response.locals.resourceSocietyId = resourceSocietyId;
        next();
      },
      requireSameSociety((_request, response) => response.locals.resourceSocietyId as string | undefined),
      (request, response) => response.json({
        success: true,
        data: { userId: request.currentUser?.userId, societyId: request.currentUser?.societyId },
      }),
    );
  };

  addResourceRoute('/same-society', societyAId);
  addResourceRoute('/other-society', societyBId);
  app.get('/missing-context', requireRoles('OWNER_MEMBER'), (_request, response) => response.sendStatus(200));
  app.get('/loader-without-context', loadCurrentUser, (_request, response) => response.sendStatus(200));
  app.use(errorHandler);
  return { app, lookup };
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

describe('authorization foundation', () => {
  it('rejects requests without a JWT', async () => {
    const { app } = createProtectedApp(new Map([[userAId, record(userAId, societyAId)]]));
    const response = await fetch(`${await startServer(app)}/same-society`, { method: 'POST' });

    expect(response.status).toBe(401);
  });

  it('rejects a valid JWT when its user no longer exists', async () => {
    const { app } = createProtectedApp(new Map());
    const token = await issueAccessToken(userAId, jwtConfiguration);
    const response = await fetch(`${await startServer(app)}/same-society`, {
      method: 'POST', headers: bearer(token),
    });

    expect(response.status).toBe(401);
  });

  it('loads the token identity from storage and allows an explicitly permitted role', async () => {
    const lookup = vi.fn(async (userId: string) => new Map([
      [userAId, record(userAId, societyAId)],
      [userBId, record(userBId, societyBId)],
    ]).get(userId) ?? null);
    const { app } = createProtectedApp(new Map(), lookup);
    const token = await issueAccessToken(userAId, jwtConfiguration);
    const response = await fetch(`${await startServer(app)}/same-society`, {
      method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userBId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, data: { userId: userAId, societyId: societyAId },
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith(userAId);
  });

  it('returns 403 for an authenticated user whose role is not explicitly permitted', async () => {
    const { app } = createProtectedApp(new Map([[userAId, record(userAId, societyAId, 'RESIDENT')]]));
    const token = await issueAccessToken(userAId, jwtConfiguration);
    const response = await fetch(`${await startServer(app)}/same-society`, {
      method: 'POST', headers: bearer(token),
    });

    expect(response.status).toBe(403);
  });

  it('returns 401 when current-user loading or role authorization runs without authentication context', async () => {
    const { app } = createProtectedApp(new Map());
    const baseUrl = await startServer(app);
    const responses = await Promise.all([
      fetch(`${baseUrl}/loader-without-context`),
      fetch(`${baseUrl}/missing-context`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401]);
  });

  it('allows a resource in the current society and rejects one in another society', async () => {
    const { app } = createProtectedApp(new Map([[userAId, record(userAId, societyAId)]]));
    const baseUrl = await startServer(app);
    const token = await issueAccessToken(userAId, jwtConfiguration);
    const sameSocietyResponse = await fetch(`${baseUrl}/same-society`, {
      method: 'POST', headers: bearer(token),
    });
    const otherSocietyResponse = await fetch(`${baseUrl}/other-society`, {
      method: 'POST', headers: bearer(token),
    });

    expect(sameSocietyResponse.status).toBe(200);
    expect(otherSocietyResponse.status).toBe(403);
  });
});
