import { timingSafeEqual } from 'node:crypto';

export function matchesBootstrapSecret(configuredSecret: string | undefined, suppliedSecret: string): boolean {
  if (!configuredSecret || new TextEncoder().encode(configuredSecret).byteLength < 32) return false;
  const configured = Buffer.from(configuredSecret, 'utf8');
  const supplied = Buffer.from(suppliedSecret, 'utf8');
  return configured.length === supplied.length && timingSafeEqual(configured, supplied);
}
