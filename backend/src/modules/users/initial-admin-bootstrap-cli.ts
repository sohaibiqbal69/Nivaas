import { createInterface } from 'node:readline/promises';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { backendConfig } from '../../config/environment.js';
import { assertProductionBootstrapAllowed, bootstrapProductionFirstSystemAdmin } from './first-system-admin-bootstrap.js';
import { safeBootstrapErrorMessage } from './local-admin-bootstrap.js';

function readSecretWithoutEcho(prompt: string): Promise<string> {
  const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  if (!input.isTTY || typeof input.setRawMode !== 'function' || !process.stdout.isTTY) {
    return Promise.reject(new Error('Bootstrap requires a trusted interactive terminal; piped/CI input and output are refused.'));
  }
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode?.(false);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Bootstrap cancelled.'));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (!backendConfig.initialAdminBootstrapEnabled || !backendConfig.initialAdminBootstrapSecret || !backendConfig.mongoUri) {
    throw new Error('Enable the one-time production bootstrap and provide its server-side secret for this isolated CLI invocation.');
  }
  const suppliedSecret = await readSecretWithoutEcho('One-time bootstrap authorization secret (input hidden): ');
  assertProductionBootstrapAllowed({
    enabled: backendConfig.initialAdminBootstrapEnabled,
    secret: backendConfig.initialAdminBootstrapSecret,
    nodeEnvironment: process.env.NODE_ENV,
  }, suppliedSecret);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = await terminal.question('First administrator name: ');
    const email = await terminal.question('First administrator email: ');
    const confirmation = await terminal.question('Type CREATE FIRST SYSTEM ADMIN to continue: ');
    if (confirmation !== 'CREATE FIRST SYSTEM ADMIN') throw new Error('Bootstrap cancelled.');
    await connectDatabase(backendConfig.mongoUri);
    const result = await bootstrapProductionFirstSystemAdmin({ name, email }, suppliedSecret);
    process.stdout.write(`Created pending SYSTEM_ADMIN ${result.email} (${result.userId}).\n`);
    process.stdout.write(`One-time setup credential, expires ${result.expiresAt.toISOString()}:\n${result.setupCredential}\n`);
    process.stdout.write('Deliver this credential privately now. It is not returned by any API, stored in cleartext, or retrievable after this command exits.\n');
  } finally {
    terminal.close();
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeBootstrapErrorMessage(error)}\n`);
  process.exitCode = 1;
});
