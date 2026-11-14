import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { backendConfig } from '../../config/environment.js';
import { ApiError } from '../../lib/api-error.js';
import { User } from '../users/models/User.js';
import { AuthSession } from './models/AuthSession.js';
import { hashPassword, verifyPassword } from './password.js';
import { issueAccessToken, type JwtConfiguration } from './jwt.js';

const DUMMY_PASSWORD_HASH = `scrypt$32768$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export type LoginUserRecord = {
  _id: { toString(): string };
  societyId: { toString(): string } | null;
  name: string;
  email: string;
  role: string;
  status: string;
  passwordHash: string;
};

export type AuthenticatedUser = {
  _id: string;
  societyId: string | null;
  name: string;
  email: string;
  role: string;
};

export type AuthenticationResult = { user: AuthenticatedUser; token: string; refreshToken: string; refreshSessionId: string; refreshTokenExpiresAt: string };
export type UserRepository = {
  findByEmail(email: string): Promise<LoginUserRecord | null>;
  findById(userId: string): Promise<LoginUserRecord | null>;
};
export type AuthSessionRecord = { sessionId: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt?: Date | null };
export type AuthSessionRepository = {
  create(record: AuthSessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revoke(tokenHash: string, at: Date): Promise<void>;
};

const userRepository: UserRepository = {
  async findByEmail(email) {
    return User.findOne({ email }).select('+passwordHash').lean().exec() as Promise<LoginUserRecord | null>;
  },
  async findById(userId) {
    return User.findById(userId).select('_id societyId name email role status').lean().exec() as Promise<LoginUserRecord | null>;
  },
};

const authSessionRepository: AuthSessionRepository = {
  async create(record) { await AuthSession.create(record); },
  async findByTokenHash(tokenHash) {
    const record = await AuthSession.findOne({ tokenHash }).lean().exec() as unknown as {
      sessionId: string; userId: { toString(): string }; tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt?: Date | null;
    } | null;
    if (!record) return null;
    return {
      sessionId: record.sessionId,
      userId: record.userId.toString(),
      tokenHash: record.tokenHash,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
    };
  },
  async revoke(tokenHash, at) {
    await AuthSession.updateOne({ tokenHash, revokedAt: { $exists: false } }, { $set: { revokedAt: at } }).exec();
  },
};

function configuredJwt(): JwtConfiguration {
  const { jwtSecret, jwtAccessTokenTtlSeconds } = backendConfig;
  if (!jwtSecret || !jwtAccessTokenTtlSeconds) {
    throw new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.');
  }
  return { secret: jwtSecret, accessTokenTtlSeconds: jwtAccessTokenTtlSeconds };
}

function configuredRefreshTtl(): number { return backendConfig.authRefreshSessionTtlSeconds; }
function hashRefreshToken(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function serializeUser(user: LoginUserRecord): AuthenticatedUser {
  return {
    _id: user._id.toString(),
    societyId: user.societyId?.toString() ?? null,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
function isActiveUser(user: LoginUserRecord | null): user is LoginUserRecord {
  return Boolean(user && user.status === 'ACTIVE');
}

export type RenewedAuthentication = AuthenticationResult;

export class AuthenticationService {
  constructor(
    private readonly repository: UserRepository = userRepository,
    private readonly jwtConfiguration: () => JwtConfiguration = configuredJwt,
    private readonly sessions: AuthSessionRepository = authSessionRepository,
    private readonly refreshTtlSeconds: () => number = configuredRefreshTtl,
  ) {}

  async login(email: string, password: string): Promise<AuthenticationResult> {
    const user = await this.repository.findByEmail(email);
    const passwordIsValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || user.status !== 'ACTIVE' || !passwordIsValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'The email or password is incorrect.');
    }

    return this.startSession(user);
  }

  async refresh(refreshToken: string): Promise<RenewedAuthentication | null> {
    if (!isRefreshToken(refreshToken)) return null;
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
    const user = await this.repository.findById(session.userId);
    if (!isActiveUser(user)) {
      await this.sessions.revoke(tokenHash, now);
      return null;
    }
    const token = await issueAccessToken(user._id.toString(), this.jwtConfiguration());
    return {
      user: serializeUser(user),
      token,
      refreshToken,
      refreshSessionId: session.sessionId,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    if (!isRefreshToken(refreshToken)) return;
    await this.sessions.revoke(hashRefreshToken(refreshToken), new Date());
  }

  private async startSession(user: LoginUserRecord): Promise<AuthenticationResult> {
    const ttlSeconds = this.refreshTtlSeconds();
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60) {
      throw new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.');
    }
    const now = new Date();
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshSessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const token = await issueAccessToken(user._id.toString(), this.jwtConfiguration());
    await this.sessions.create({
      sessionId: refreshSessionId,
      userId: user._id.toString(),
      tokenHash: hashRefreshToken(refreshToken),
      createdAt: now,
      expiresAt,
    });
    return {
      user: serializeUser(user),
      token,
      refreshToken,
      refreshSessionId,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }
}

function isRefreshToken(token: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(token); }

export { hashPassword, verifyPassword };
