import { describe, expect, it } from 'vitest';
import { readBackendConfig } from '../src/config/environment.js';
import { assertLocalBootstrapAllowed, matchesBootstrapSecret, safeBootstrapErrorMessage } from '../src/modules/users/local-admin-bootstrap.js';
import { serializeCreatedUser, type UserProfileRecord } from '../src/modules/users/user-routes.js';

const demoUri = 'mongodb://127.0.0.1:27017/nivaas_demo?replicaSet=rs0';
const bootstrapSecret = 'local-bootstrap-secret-for-tests-only-123456';

describe('local onboarding configuration', () => {
  it('enables bootstrap only with an explicit secret and isolated loopback demo database', () => {
    const config = readBackendConfig({
      MONGODB_URI: demoUri,
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true',
      NIVAAS_LOCAL_BOOTSTRAP_SECRET: bootstrapSecret,
    });

    expect(config.localBootstrapEnabled).toBe(true);
    expect(config.localSetupDeliveryEnabled).toBe(false);
  });

  it('rejects production use, short secrets, remote MongoDB, and non-demo databases', () => {
    expect(() => readBackendConfig({
      NODE_ENV: 'production', MONGODB_URI: demoUri,
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: bootstrapSecret,
    })).toThrow(/must not be configured in production/);
    expect(() => readBackendConfig({
      MONGODB_URI: demoUri, NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: 'short',
    })).toThrow(/at least 32 characters/);
    expect(() => readBackendConfig({
      NODE_ENV: 'production', MONGODB_URI: demoUri,
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: '1234',
    })).toThrow(/must not be configured in production/);
    expect(() => readBackendConfig({
      MONGODB_URI: 'mongodb://example.invalid:27017/nivaas_demo',
      NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED: 'true',
    })).toThrow(/loopback nivaas_demo/);
    expect(() => readBackendConfig({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/nivaas',
      NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED: 'true',
    })).toThrow(/loopback nivaas_demo/);
  });

  it('allows the simple bootstrap secret only in explicitly enabled local development on nivaas_demo', () => {
    const config = readBackendConfig({
      NODE_ENV: 'development', MONGODB_URI: demoUri,
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: '1234',
    });
    expect(config.localBootstrapEnabled).toBe(true);
    expect(() => readBackendConfig({
      NODE_ENV: 'test', MONGODB_URI: demoUri,
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: '1234',
    })).toThrow(/at least 32 characters/);
    expect(() => readBackendConfig({
      NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/nivaas',
      NIVAAS_LOCAL_BOOTSTRAP_ENABLED: 'true', NIVAAS_LOCAL_BOOTSTRAP_SECRET: '1234',
    })).toThrow(/at least 32 characters/);
    expect(() => assertLocalBootstrapAllowed(true, '1234', '1234', 'development')).toThrow(/disabled or its authorization secret is invalid/);
    expect(() => assertLocalBootstrapAllowed(true, '1234', '1234', 'development', demoUri)).not.toThrow();
    expect(() => assertLocalBootstrapAllowed(true, '1234', '1234', 'development', 'mongodb://example.invalid/nivaas_demo'))
      .toThrow(/disabled or its authorization secret is invalid/);
  });

  it('compares bootstrap secrets without accepting missing or mismatched values', () => {
    expect(matchesBootstrapSecret(bootstrapSecret, bootstrapSecret)).toBe(true);
    expect(matchesBootstrapSecret(bootstrapSecret, `${bootstrapSecret}x`)).toBe(false);
    expect(matchesBootstrapSecret(undefined, bootstrapSecret)).toBe(false);
    expect(() => assertLocalBootstrapAllowed(false, bootstrapSecret, bootstrapSecret)).toThrow(/disabled/);
    expect(() => assertLocalBootstrapAllowed(true, bootstrapSecret, bootstrapSecret, 'production')).toThrow(/unavailable in production/);
    expect(() => assertLocalBootstrapAllowed(true, bootstrapSecret, bootstrapSecret)).not.toThrow();
  });

  it('does not expose unknown database or connection error details in CLI output', () => {
    const message = safeBootstrapErrorMessage(new Error('sensitive-connection-placeholder'));
    expect(message).not.toContain('sensitive-connection-placeholder');
    expect(message).toMatch(/without sharing logs or secrets/);
  });
});

describe('local setup credential response', () => {
  const user: UserProfileRecord = {
    _id: { toString: () => 'user-id' },
    societyId: null,
    name: 'Demo Admin', email: 'admin@example.test', role: 'SYSTEM_ADMIN', status: 'PENDING_SETUP',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('never includes the raw setup credential in the ordinary user response', () => {
    const response = serializeCreatedUser(user, { rawCredential: 'one-time-secret', expiresAt: new Date() }, false);
    expect(response).not.toHaveProperty('setupCredential');
    expect(JSON.stringify(response)).not.toContain('one-time-secret');
  });

  it('delivers the one-time credential only in explicitly enabled local mode', () => {
    const expiresAt = new Date('2026-01-02T00:00:00Z');
    const response = serializeCreatedUser(user, { rawCredential: 'one-time-secret', expiresAt }, true);
    expect(response).toMatchObject({ setupCredential: 'one-time-secret', setupCredentialExpiresAt: expiresAt });
  });
});
