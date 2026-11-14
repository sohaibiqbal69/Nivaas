import express from 'express';
import { createServer, type Server } from 'node:http';
import { SignJWT, jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAuthRouter } from '../src/modules/auth/auth-routes.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { AuthenticationService, hashPassword, verifyPassword, type AuthenticatedUser, type AuthSessionRecord, type AuthSessionRepository, type LoginUserRecord } from '../src/modules/auth/authentication-service.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';

const jwtSecret = 'test-only-secret-with-at-least-32-characters';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 60 };
const userId = '68a123456789012345678901';
const societyId = '68a123456789012345678902';
const password = 'correct horse battery staple';
const servers: Server[] = [];
const sessionStore = () => {
  const records: AuthSessionRecord[] = [];
  const repository: AuthSessionRepository = {
    create: async (record) => { records.push(record); },
    findByTokenHash: async (hash) => records.find((record) => record.tokenHash === hash) ?? null,
    revoke: async (hash, at) => { const record = records.find((item) => item.tokenHash === hash); if (record) record.revokedAt = at; },
  };
  return repository;
};

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

async function makeUserRecord(userSocietyId: string | null = societyId): Promise<LoginUserRecord> {
  return {
    _id: { toString: () => userId },
    societyId: userSocietyId === null ? null : { toString: () => userSocietyId },
    name: 'Test User',
    email: 'person@example.com',
    role: 'OWNER_MEMBER',
    status: 'ACTIVE',
    passwordHash: await hashPassword(password),
  };
}

function createLoginApp(service: AuthenticationService): express.Express {
  const app = express();
  app.use(express.json(), createAuthRouter(service), errorHandler);
  return app;
}

describe('password hashing', () => {
  it('hashes with a per-password salt and verifies without plaintext comparison', async () => {
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).not.toBe(password);
    expect(firstHash).not.toBe(secondHash);
    expect(await verifyPassword(password, firstHash)).toBe(true);
    expect(await verifyPassword('wrong password', firstHash)).toBe(false);
  });
});

describe('authentication service and login endpoint', () => {
  it('issues a JWT and returns only the documented safe user profile fields', async () => {
    const user = await makeUserRecord();
    const service = new AuthenticationService(
      { findByEmail: async (email) => email === user.email ? user : null, findById: async () => user },
      () => jwtConfiguration,
      sessionStore(),
    );
    const baseUrl = await startServer(createLoginApp(service));
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    const payload = await response.json() as {
      success: boolean;
      data: { user: Record<string, unknown>; token: string; refreshToken: string; refreshSessionId: string; refreshTokenExpiresAt: string };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.user).toEqual({
      _id: userId, societyId, name: 'Test User', email: user.email, role: 'OWNER_MEMBER',
    });
    expect(payload.data.user).not.toHaveProperty('passwordHash');
    expect(payload.data.user).not.toHaveProperty('phone');
    expect(payload.data.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.data.refreshSessionId).toBeTruthy();
    expect(Date.parse(payload.data.refreshTokenExpiresAt)).toBeGreaterThan(Date.now());
    const verified = await jwtVerify(payload.data.token, new TextEncoder().encode(jwtSecret));
    expect(verified.payload.sub).toBe(userId);
    expect(Object.keys(verified.payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('authenticates a platform administrator with null societyId without fabricating a society', async () => {
    const user = await makeUserRecord(null);
    user.role = 'SYSTEM_ADMIN';
    const service = new AuthenticationService(
      { findByEmail: async (email) => email === user.email ? user : null, findById: async () => user },
      () => jwtConfiguration,
      sessionStore(),
    );

    const result = await service.login(user.email, password);

    expect(result.user.societyId).toBeNull();
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('token');
    const verified = await jwtVerify(result.token, new TextEncoder().encode(jwtSecret));
    expect(verified.payload.sub).toBe(userId);
  });

  it.each(['PENDING_SETUP', 'DISABLED'])('rejects normal password login for a %s account generically', async (status) => {
    const user = await makeUserRecord();
    user.status = status;
    const service = new AuthenticationService(
      { findByEmail: async (email) => email === user.email ? user : null, findById: async () => user },
      () => jwtConfiguration,
      sessionStore(),
    );
    const app = createLoginApp(service);
    const response = await fetch(`${await startServer(app)}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'The email or password is incorrect.' },
    });
  });

  it('returns the same generic authentication failure for a wrong password and an unknown email', async () => {
    const user = await makeUserRecord();
    const service = new AuthenticationService(
      { findByEmail: async (email) => email === user.email ? user : null, findById: async () => user },
      () => jwtConfiguration,
      sessionStore(),
    );
    const baseUrl = await startServer(createLoginApp(service));
    const responses = await Promise.all([
      fetch(`${baseUrl}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'wrong password' }),
      }),
      fetch(`${baseUrl}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown@example.com', password }),
      }),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([401, 401]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'The email or password is incorrect.' },
    });
  });

  it('rejects an empty or malformed credential payload', async () => {
    const app = createLoginApp(new AuthenticationService(
      { findByEmail: async () => null, findById: async () => null }, () => jwtConfiguration, sessionStore(),
    ));
    const baseUrl = await startServer(app);
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false, error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' },
    });
  });

  it('keeps four role sessions independent, renews expired access tokens, and revokes only the logged-out session', async () => {
    const roles = ['SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER', 'RESIDENT'];
    const users = await Promise.all(roles.map(async (role, index) => {
      const user = await makeUserRecord();
      user._id = { toString: () => `68a12345678901234567890${index}` };
      user.email = `${role.toLowerCase()}@example.test`;
      user.role = role;
      return user;
    }));
    const records: AuthSessionRecord[] = [];
    const sessions: AuthSessionRepository = {
      create: async (record) => { records.push(record); },
      findByTokenHash: async (hash) => records.find((record) => record.tokenHash === hash) ?? null,
      revoke: async (hash, at) => { const record = records.find((item) => item.tokenHash === hash); if (record) record.revokedAt = at; },
    };
    const service = new AuthenticationService(
      { findByEmail: async (email) => users.find((user) => user.email === email) ?? null, findById: async (id) => users.find((user) => user._id.toString() === id) ?? null },
      () => jwtConfiguration,
      sessions,
      () => 30 * 24 * 60 * 60,
    );
    const logins = await Promise.all(users.map((user) => service.login(user.email, password)));
    expect(new Set(logins.map((login) => login.refreshToken)).size).toBe(4);
    expect(new Set(logins.map((login) => login.refreshSessionId)).size).toBe(4);
    expect(logins.map((login) => login.user.role)).toEqual(roles);

    const targetSession = records.find((record) => record.sessionId === logins[0]!.refreshSessionId)!;
    targetSession.expiresAt = new Date(Date.now() - 1);
    const renewedOtherTabs = await Promise.all(logins.slice(1).map((login) => service.refresh(login.refreshToken)));
    expect(renewedOtherTabs.map((result) => result?.user.role)).toEqual(roles.slice(1));
    for (const [offset, result] of renewedOtherTabs.entries()) {
      expect(result?.user.societyId).toBe(societyId);
      const claims = await jwtVerify(result!.token, new TextEncoder().encode(jwtSecret));
      expect(claims.payload.sub).toBe(users[offset + 1]!._id.toString());
    }
    await service.logout(logins[1]!.refreshToken);
    expect(await service.refresh(logins[1]!.refreshToken)).toBeNull();
    expect(await service.refresh(logins[0]!.refreshToken)).toBeNull();
    expect(await service.refresh(logins[2]!.refreshToken)).toMatchObject({ user: { role: roles[2] } });
  });

  it('rejects malformed, unknown, revoked, expired and disabled-user refresh credentials', async () => {
    const user = await makeUserRecord();
    const sessions: AuthSessionRecord[] = [];
    const repository: AuthSessionRepository = {
      create: async (record) => { sessions.push(record); },
      findByTokenHash: async (hash) => sessions.find((record) => record.tokenHash === hash) ?? null,
      revoke: async (hash, at) => { const record = sessions.find((item) => item.tokenHash === hash); if (record) record.revokedAt = at; },
    };
    const users = { findByEmail: async () => user, findById: async () => user };
    const service = new AuthenticationService(users, () => jwtConfiguration, repository);
    expect(await service.refresh('malformed')).toBeNull();
    expect(await service.refresh('A'.repeat(43))).toBeNull();
    const login = await service.login(user.email, password);
    await service.logout(login.refreshToken);
    expect(await service.refresh(login.refreshToken)).toBeNull();

    const activeSession = await service.login(user.email, password);
    sessions.find((record) => record.sessionId === activeSession.refreshSessionId)!.expiresAt = new Date(Date.now() - 1);
    expect(await service.refresh(activeSession.refreshToken)).toBeNull();
    sessions.find((record) => record.sessionId === activeSession.refreshSessionId)!.expiresAt = new Date(Date.now() + 60_000);
    user.status = 'DISABLED';
    expect(await service.refresh(activeSession.refreshToken)).toBeNull();
  });

  it('supports parallel refreshes for one session without changing its identity', async () => {
    const user = await makeUserRecord();
    const service = new AuthenticationService(
      { findByEmail: async () => user, findById: async () => user }, () => jwtConfiguration, sessionStore(),
    );
    const login = await service.login(user.email, password);
    const renewed = await Promise.all(Array.from({ length: 8 }, () => service.refresh(login.refreshToken)));
    expect(renewed.every((result) => result?.user._id === userId && result.user.role === 'OWNER_MEMBER')).toBe(true);
  });

  it('exposes refresh and logout routes that renew and revoke the matching session', async () => {
    const user = await makeUserRecord();
    const service = new AuthenticationService(
      { findByEmail: async () => user, findById: async () => user }, () => jwtConfiguration, sessionStore(),
    );
    const baseUrl = await startServer(createLoginApp(service));
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password }),
    });
    const login = await loginResponse.json() as { data: { token: string; refreshToken: string; refreshSessionId: string } };
    const refreshResponse = await fetch(`${baseUrl}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: login.data.refreshToken }),
    });
    const refreshed = await refreshResponse.json() as { data: { token: string; user: AuthenticatedUser } };
    expect(refreshResponse.status).toBe(200);
    expect(refreshed.data.user.role).toBe(user.role);
    expect((await jwtVerify(refreshed.data.token, new TextEncoder().encode(jwtSecret))).payload.sub).toBe(userId);

    const logoutResponse = await fetch(`${baseUrl}/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: login.data.refreshToken }),
    });
    expect(logoutResponse.status).toBe(200);
    const afterLogout = await fetch(`${baseUrl}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: login.data.refreshToken }),
    });
    expect(afterLogout.status).toBe(401);
  });
});

describe('authentication middleware', () => {
  async function protectedServer(): Promise<string> {
    const app = express();
    app.get('/protected', createAuthenticationMiddleware(() => jwtSecret), (request, response) => {
      response.json({ success: true, data: { userId: request.auth?.userId } });
    });
    app.use(errorHandler);
    return startServer(app);
  }

  it('attaches the authenticated identity for a valid JWT', async () => {
    const token = await issueAccessToken(userId, jwtConfiguration);
    const response = await fetch(`${await protectedServer()}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { userId } });
  });

  it('rejects missing, malformed, and invalid authorization credentials', async () => {
    const baseUrl = await protectedServer();
    const responses = await Promise.all([
      fetch(`${baseUrl}/protected`),
      fetch(`${baseUrl}/protected`, { headers: { Authorization: 'Basic abc' } }),
      fetch(`${baseUrl}/protected`, { headers: { Authorization: 'Bearer invalid.token.value' } }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    for (const response of responses) {
      expect(await response.json()).toEqual({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required.' },
      });
    }
  });

  it('rejects an expired JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(jwtSecret));
    const response = await fetch(`${await protectedServer()}/protected`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required.' },
    });
  });
});
