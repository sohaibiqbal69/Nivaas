import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from '../../lib/api-error.js';

export type AuthenticatedUserContext = { userId: string };
export type JwtConfiguration = { secret: string; accessTokenTtlSeconds: number };

function signingKey(secret: string): Uint8Array {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) {
    throw new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.');
  }
  return key;
}

export async function issueAccessToken(userId: string, configuration: JwtConfiguration): Promise<string> {
  if (!Number.isInteger(configuration.accessTokenTtlSeconds) || configuration.accessTokenTtlSeconds < 1) {
    throw new ApiError(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is not configured.');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + configuration.accessTokenTtlSeconds)
    .sign(signingKey(configuration.secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AuthenticatedUserContext | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' && payload.sub.length > 0
      ? { userId: payload.sub }
      : null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return null;
  }
}
