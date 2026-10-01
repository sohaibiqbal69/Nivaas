import { backendConfig } from '../../config/environment.js';
import { ApiError } from '../../lib/api-error.js';
import { User } from '../users/models/User.js';
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

export type AuthenticationResult = { user: AuthenticatedUser; token: string };
export type UserRepository = { findByEmail(email: string): Promise<LoginUserRecord | null> };

const userRepository: UserRepository = {
  async findByEmail(email) {
    return User.findOne({ email }).select('+passwordHash').lean().exec() as Promise<LoginUserRecord | null>;
  },
};

function configuredJwt(): JwtConfiguration {
  const { jwtSecret, jwtAccessTokenTtlSeconds } = backendConfig;
  if (!jwtSecret || !jwtAccessTokenTtlSeconds) {
    throw new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.');
  }
  return { secret: jwtSecret, accessTokenTtlSeconds: jwtAccessTokenTtlSeconds };
}

export class AuthenticationService {
  constructor(
    private readonly repository: UserRepository = userRepository,
    private readonly jwtConfiguration: () => JwtConfiguration = configuredJwt,
  ) {}

  async login(email: string, password: string): Promise<AuthenticationResult> {
    const user = await this.repository.findByEmail(email);
    const passwordIsValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || user.status !== 'ACTIVE' || !passwordIsValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'The email or password is incorrect.');
    }

    const token = await issueAccessToken(user._id.toString(), this.jwtConfiguration());
    return {
      user: {
        _id: user._id.toString(),
        societyId: user.societyId?.toString() ?? null,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    };
  }
}

export { hashPassword, verifyPassword };
