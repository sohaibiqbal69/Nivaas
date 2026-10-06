import { createHash, randomBytes } from 'node:crypto';

export const SETUP_CREDENTIAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function hashCredential(rawCredential: string): string {
  return createHash('sha256').update(rawCredential, 'utf8').digest('hex');
}

export function generateSetupCredential(now: Date = new Date()): {
  rawCredential: string;
  credentialHash: string;
  expiresAt: Date;
} {
  const rawCredential = randomBytes(32).toString('base64url');
  const credentialHash = hashCredential(rawCredential);
  const expiresAt = new Date(now.getTime() + SETUP_CREDENTIAL_EXPIRY_MS);
  return { rawCredential, credentialHash, expiresAt };
}
