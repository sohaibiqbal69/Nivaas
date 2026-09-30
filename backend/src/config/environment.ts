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
};

export function readBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const rawPort = environment.PORT ?? '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const mongoUri = environment.MONGODB_URI?.trim();
  const corsOrigin = environment.CORS_ORIGIN?.trim();
  return {
    port,
    ...(mongoUri ? { mongoUri } : {}),
    ...(corsOrigin ? { corsOrigin } : {}),
  };
}

export const backendConfig = readBackendConfig();
