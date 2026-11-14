import { backendConfig, isLoopbackDemoDatabase } from '../../config/environment.js';
import { createFirstSystemAdmin } from './first-system-admin-bootstrap.js';
import { matchesBootstrapSecret } from './bootstrap-secret.js';

export { matchesBootstrapSecret };

export type LocalAdminBootstrapInput = { name: string; email: string };
export type LocalAdminBootstrapResult = { userId: string; email: string; setupCredential: string; expiresAt: Date };

const SAFE_BOOTSTRAP_ERRORS = new Set([
  'Enable local bootstrap in backend/.env and target the loopback nivaas_demo database first.',
  'Bootstrap requires an interactive local terminal so the authorization secret is not echoed.',
  'Bootstrap cancelled.',
  'Local administrator bootstrap is unavailable in production.',
  'Local administrator bootstrap is disabled or its authorization secret is invalid.',
  'The one-time local administrator bootstrap has already been claimed.',
  'A SYSTEM_ADMIN already exists; bootstrap is not permitted.',
  'Local administrator bootstrap has already completed or is running.',
  'Initial System Admin bootstrap is available only in production CLI mode.',
  'Production administrator bootstrap is disabled or its one-time authorization secret is invalid.',
  'The first System Admin bootstrap has already completed or is running.',
  'A SYSTEM_ADMIN already exists; bootstrap is not permitted.',
  'The one-time first System Admin bootstrap has already been claimed.',
  'The first System Admin bootstrap requires a MongoDB transaction.',
  'Bootstrap requires a trusted interactive terminal; piped/CI input and output are refused.',
  'Enable the one-time production bootstrap and provide its server-side secret for this isolated CLI invocation.',
]);

export function safeBootstrapErrorMessage(error: unknown): string {
  if (error instanceof Error && SAFE_BOOTSTRAP_ERRORS.has(error.message)) return error.message;
  return 'Local administrator bootstrap failed. Check local configuration and database availability without sharing logs or secrets.';
}

export function assertLocalBootstrapAllowed(
  enabled: boolean,
  configuredSecret: string | undefined,
  suppliedSecret: string,
  nodeEnvironment?: string,
  mongoUri?: string,
): void {
  if (nodeEnvironment?.toLowerCase() === 'production') throw new Error('Local administrator bootstrap is unavailable in production.');
  const localDemoSecret = nodeEnvironment?.toLowerCase() === 'development'
    && configuredSecret === '1234'
    && suppliedSecret === '1234'
    && isLoopbackDemoDatabase(mongoUri);
  if (!enabled || (!matchesBootstrapSecret(configuredSecret, suppliedSecret) && !localDemoSecret)) {
    throw new Error('Local administrator bootstrap is disabled or its authorization secret is invalid.');
  }
}

export async function bootstrapFirstSystemAdmin(
  input: LocalAdminBootstrapInput,
  suppliedSecret: string,
): Promise<LocalAdminBootstrapResult> {
  assertLocalBootstrapAllowed(
    backendConfig.localBootstrapEnabled,
    backendConfig.localBootstrapSecret,
    suppliedSecret,
    process.env.NODE_ENV,
    backendConfig.mongoUri,
  );

  return createFirstSystemAdmin(input);
}
