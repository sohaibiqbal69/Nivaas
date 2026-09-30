import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const workingDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
dotenv.config({ path: existsSync(workingDirectoryEnv) ? workingDirectoryEnv : parentDirectoryEnv });

export type BackendConfig = {
  port: number;
  mongoUri?: string;
  corsOrigin?: string;
  jwtSecret?: string;
  jwtAccessTokenTtlSeconds?: number;
};

export function readBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const rawPort = environment.PORT ?? '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const mongoUri = environment.MONGODB_URI?.trim();
  const corsOrigin = environment.CORS_ORIGIN?.trim();
  const jwtSecret = environment.JWT_SECRET?.trim();
  const rawJwtTtl = environment.JWT_ACCESS_TOKEN_TTL_SECONDS?.trim();
  let jwtAccessTokenTtlSeconds: number | undefined;
  if (rawJwtTtl) {
    jwtAccessTokenTtlSeconds = Number(rawJwtTtl);
    if (!Number.isInteger(jwtAccessTokenTtlSeconds) || jwtAccessTokenTtlSeconds < 1) {
      throw new Error('JWT_ACCESS_TOKEN_TTL_SECONDS must be a positive integer.');
    }
  }
  return {
    port,
    ...(mongoUri ? { mongoUri } : {}),
    ...(corsOrigin ? { corsOrigin } : {}),
    ...(jwtSecret ? { jwtSecret } : {}),
    ...(jwtAccessTokenTtlSeconds ? { jwtAccessTokenTtlSeconds } : {}),
  };
}

export const backendConfig = readBackendConfig();
