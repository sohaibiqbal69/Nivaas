import express from 'express';
import { createServer, type Server } from 'node:http';
import { SignJWT, jwtVerify } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAuthRouter } from '../src/modules/auth/auth-routes.js';
import { createAuthenticationMiddleware } from '../src/modules/auth/authentication-middleware.js';
import { AuthenticationService, hashPassword, verifyPassword, type LoginUserRecord } from '../src/modules/auth/authentication-service.js';
import { issueAccessToken } from '../src/modules/auth/jwt.js';

const jwtSecret = 'test-only-secret-with-at-least-32-characters';
const jwtConfiguration = { secret: jwtSecret, accessTokenTtlSeconds: 60 };
const userId = '68a123456789012345678901';
const societyId = '68a123456789012345678902';
const password = 'correct horse battery staple';
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
      { findByEmail: async (email) => email === user.email ? user : null },
      () => jwtConfiguration,
    );
    const baseUrl = await startServer(createLoginApp(service));
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    const payload = await response.json() as {
      success: boolean;
      data: { user: Record<string, unknown>; token: string };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.user).toEqual({
      _id: userId, societyId, name: 'Test User', email: user.email, role: 'OWNER_MEMBER',
    });
    expect(payload.data.user).not.toHaveProperty('passwordHash');
    expect(payload.data.user).not.toHaveProperty('phone');
    const verified = await jwtVerify(payload.data.token, new TextEncoder().encode(jwtSecret));
    expect(verified.payload.sub).toBe(userId);
    expect(Object.keys(verified.payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('authenticates a platform administrator with null societyId without fabricating a society', async () => {
    const user = await makeUserRecord(null);
    user.role = 'SYSTEM_ADMIN';
    const service = new AuthenticationService(
      { findByEmail: async (email) => email === user.email ? user : null },
      () => jwtConfiguration,
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
      { findByEmail: async (email) => email === user.email ? user : null },
      () => jwtConfiguration,
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
      { findByEmail: async (email) => email === user.email ? user : null },
      () => jwtConfiguration,
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
      { findByEmail: async () => null }, () => jwtConfiguration,
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
