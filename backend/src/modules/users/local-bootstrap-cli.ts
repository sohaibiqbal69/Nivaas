import { createInterface } from 'node:readline/promises';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { backendConfig } from '../../config/environment.js';
import { bootstrapFirstSystemAdmin, safeBootstrapErrorMessage } from './local-admin-bootstrap.js';

function readSecretWithoutEcho(prompt: string): Promise<string> {
  const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Bootstrap requires an interactive local terminal so the authorization secret is not echoed.'));
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
  if (!backendConfig.localBootstrapEnabled || !backendConfig.mongoUri) {
    throw new Error('Enable local bootstrap in backend/.env and target the loopback nivaas_demo database first.');
  }
  const secret = await readSecretWithoutEcho('Local bootstrap authorization secret (input hidden): ');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = await terminal.question('Administrator name: ');
    const email = await terminal.question('Administrator email: ');
    const confirmation = await terminal.question('Type BOOTSTRAP FIRST ADMIN to continue: ');
    if (confirmation !== 'BOOTSTRAP FIRST ADMIN') throw new Error('Bootstrap cancelled.');
    await connectDatabase(backendConfig.mongoUri);
    const result = await bootstrapFirstSystemAdmin({ name, email }, secret);
    process.stdout.write(`Created pending local SYSTEM_ADMIN ${result.email} (${result.userId}).\n`);
    process.stdout.write(`One-time setup credential (expires ${result.expiresAt.toISOString()}):\n${result.setupCredential}\n`);
    process.stdout.write('Use it once at /setup now; this credential is not stored by this command after exit.\n');
  } finally {
    terminal.close();
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  // Database and driver errors can contain connection details. Keep CLI failure
  // output useful without echoing URIs, credentials, or other sensitive values.
  process.stderr.write(`${safeBootstrapErrorMessage(error)}\n`);
  process.exitCode = 1;
});
