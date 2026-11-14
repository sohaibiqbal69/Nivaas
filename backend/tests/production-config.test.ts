import { describe, expect, it } from 'vitest';
import { readBackendConfig } from '../src/config/environment.js';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '10000',
  MONGODB_URI: 'mongodb+srv://nivaas-app:encoded-password@cluster.example.mongodb.net/nivaas_prod?retryWrites=true&w=majority',
  CORS_ORIGIN: 'https://nivaas.example',
  JWT_SECRET: 'a-test-only-secret-with-more-than-thirty-two-bytes',
  JWT_ACCESS_TOKEN_TTL_SECONDS: '900',
  AUTH_REFRESH_SESSION_TTL_SECONDS: '2592000',
  EVIDENCE_STORAGE_PROVIDER: 's3',
  EVIDENCE_S3_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  EVIDENCE_S3_BUCKET: 'nivaas-private-evidence-demo',
  EVIDENCE_S3_REGION: 'auto',
  EVIDENCE_S3_ACCESS_KEY_ID: 'test-access-key-id',
  EVIDENCE_S3_SECRET_ACCESS_KEY: 'test-secret-access-key-not-real',
};

describe('production environment validation', () => {
  it('accepts a named remote database, exact HTTPS frontend origin and configured JWT', () => {
    const config = readBackendConfig(productionEnvironment);
    expect(config.port).toBe(10000);
    expect(config.mongoUri).toBe(productionEnvironment.MONGODB_URI);
    expect(config.corsOrigin).toBe(productionEnvironment.CORS_ORIGIN);
    expect(config.jwtAccessTokenTtlSeconds).toBe(900);
    expect(config.authRefreshSessionTtlSeconds).toBe(2592000);
    expect(config.blockchain).toBeUndefined();
    expect(config.evidenceStorage).toMatchObject({ provider: 's3', bucket: 'nivaas-private-evidence-demo', region: 'auto' });
  });

  it('fails closed when production authentication or database configuration is missing', () => {
    expect(() => readBackendConfig({ ...productionEnvironment, MONGODB_URI: '' })).toThrow(/MONGODB_URI must be configured/);
    expect(() => readBackendConfig({ ...productionEnvironment, JWT_SECRET: '' })).toThrow(/JWT_SECRET must contain at least 32 bytes/);
    expect(() => readBackendConfig({ ...productionEnvironment, JWT_ACCESS_TOKEN_TTL_SECONDS: '' })).toThrow(/JWT_ACCESS_TOKEN_TTL_SECONDS/);
    expect(() => readBackendConfig({ ...productionEnvironment, AUTH_REFRESH_SESSION_TTL_SECONDS: '' })).toThrow(/AUTH_REFRESH_SESSION_TTL_SECONDS/);
  });

  it('requires one exact HTTPS browser origin and a non-loopback production database', () => {
    expect(() => readBackendConfig({ ...productionEnvironment, CORS_ORIGIN: '*' })).toThrow(/exact HTTPS origin/);
    expect(() => readBackendConfig({ ...productionEnvironment, CORS_ORIGIN: 'http://nivaas.example' })).toThrow(/exact HTTPS origin/);
    expect(() => readBackendConfig({ ...productionEnvironment, MONGODB_URI: 'mongodb://localhost:27017/nivaas_prod' })).toThrow(/non-loopback production database/);
    expect(() => readBackendConfig({ ...productionEnvironment, MONGODB_URI: 'mongodb://db.example:27017/nivaas_prod' })).toThrow(/TLS enabled/);
    expect(() => readBackendConfig({ ...productionEnvironment, MONGODB_URI: 'mongodb+srv://db.example/nivaas_prod?tlsInsecure=true' })).toThrow(/TLS enabled/);
    expect(readBackendConfig({ ...productionEnvironment, MONGODB_URI: 'mongodb://db.example:27017/nivaas_prod?tls=true' }).mongoUri).toContain('tls=true');
  });

  it('uses the documented 30-day local refresh-session default and validates configured lifetimes', () => {
    expect(readBackendConfig({ NODE_ENV: 'test' }).authRefreshSessionTtlSeconds).toBe(2_592_000);
    expect(readBackendConfig({ NODE_ENV: 'test', AUTH_REFRESH_SESSION_TTL_SECONDS: '3600' }).authRefreshSessionTtlSeconds).toBe(3600);
    expect(() => readBackendConfig({ NODE_ENV: 'test', AUTH_REFRESH_SESSION_TTL_SECONDS: '59' })).toThrow(/at least 60 seconds/);
    expect(() => readBackendConfig({ NODE_ENV: 'test', AUTH_REFRESH_SESSION_TTL_SECONDS: '1.5' })).toThrow(/integer/);
  });

  it('supports the existing private S3 provider and validates its HTTPS endpoint', () => {
    expect(() => readBackendConfig({ ...productionEnvironment, EVIDENCE_STORAGE_PROVIDER: '' })).toThrow(/required in production/);
    expect(() => readBackendConfig({ ...productionEnvironment, EVIDENCE_S3_SECRET_ACCESS_KEY: '' })).toThrow(/All EVIDENCE_S3_\* settings/);
    expect(() => readBackendConfig({ ...productionEnvironment, EVIDENCE_S3_ENDPOINT: 'http://127.0.0.1:9000' })).toThrow(/HTTPS endpoint/);
    expect(() => readBackendConfig({ ...productionEnvironment, EVIDENCE_STORAGE_PROVIDER: 'local' })).toThrow(/cloudinary or s3 is required in production/);
    expect(readBackendConfig({ NODE_ENV: 'test' }).evidenceStorage.provider).toBe('local');
  });

  it('accepts Cloudinary server credentials for production and rejects incomplete or misplaced settings', () => {
    const environment = {
      ...productionEnvironment,
      EVIDENCE_STORAGE_PROVIDER: 'cloudinary',
      EVIDENCE_CLOUDINARY_CLOUD_NAME: 'nivaas-demo',
      EVIDENCE_CLOUDINARY_API_KEY: '123456789012345',
      EVIDENCE_CLOUDINARY_API_SECRET: 'cloudinary-test-secret-not-real',
      EVIDENCE_S3_ENDPOINT: undefined,
      EVIDENCE_S3_BUCKET: undefined,
      EVIDENCE_S3_REGION: undefined,
      EVIDENCE_S3_ACCESS_KEY_ID: undefined,
      EVIDENCE_S3_SECRET_ACCESS_KEY: undefined,
    };
    const config = readBackendConfig(environment);
    expect(config.evidenceStorage).toMatchObject({ provider: 'cloudinary', cloudName: 'nivaas-demo', apiKey: '123456789012345', legacyProvider: 'local' });
    expect(() => readBackendConfig({ ...environment, EVIDENCE_CLOUDINARY_API_SECRET: '' })).toThrow(/All EVIDENCE_CLOUDINARY_\* settings/);
    expect(() => readBackendConfig({ ...environment, EVIDENCE_CLOUDINARY_CLOUD_NAME: 'https://example.invalid' })).toThrow(/cloud name/);
    expect(() => readBackendConfig({ ...productionEnvironment, EVIDENCE_STORAGE_PROVIDER: 's3', EVIDENCE_CLOUDINARY_CLOUD_NAME: 'nivaas-demo', EVIDENCE_CLOUDINARY_API_KEY: '123456789012345', EVIDENCE_CLOUDINARY_API_SECRET: 'cloudinary-test-secret-not-real' })).toThrow(/Remove EVIDENCE_CLOUDINARY_\*/);
  });

  it('keeps legacy S3 references available after selecting Cloudinary', () => {
    const config = readBackendConfig({
      ...productionEnvironment,
      EVIDENCE_STORAGE_PROVIDER: 'cloudinary',
      EVIDENCE_CLOUDINARY_CLOUD_NAME: 'nivaas-demo',
      EVIDENCE_CLOUDINARY_API_KEY: '123456789012345',
      EVIDENCE_CLOUDINARY_API_SECRET: 'cloudinary-test-secret-not-real',
      EVIDENCE_LEGACY_STORAGE_PROVIDER: 's3',
    });
    expect(config.evidenceStorage).toMatchObject({ provider: 'cloudinary', legacyProvider: 's3', bucket: 'nivaas-private-evidence-demo' });
    expect(() => readBackendConfig({
      NODE_ENV: 'production',
      ...productionEnvironment,
      EVIDENCE_STORAGE_PROVIDER: 'cloudinary',
      EVIDENCE_CLOUDINARY_CLOUD_NAME: 'nivaas-demo',
      EVIDENCE_CLOUDINARY_API_KEY: '123456789012345',
      EVIDENCE_CLOUDINARY_API_SECRET: 'cloudinary-test-secret-not-real',
      EVIDENCE_LEGACY_STORAGE_PROVIDER: 's3',
      EVIDENCE_S3_SECRET_ACCESS_KEY: '',
    })).toThrow(/All EVIDENCE_S3_\* settings/);
  });

  it('enables initial-admin bootstrap only for an explicitly configured production CLI secret', () => {
    const config = readBackendConfig({
      ...productionEnvironment,
      NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'true',
      NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET: 'test-only-bootstrap-secret-at-least-32-bytes',
    });
    expect(config.initialAdminBootstrapEnabled).toBe(true);
    expect(config.initialAdminBootstrapSecret).toBe('test-only-bootstrap-secret-at-least-32-bytes');
    expect(() => readBackendConfig({ ...productionEnvironment, NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'true' })).toThrow(/at least 32 bytes/);
    expect(() => readBackendConfig({ ...productionEnvironment, NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET: 'left-behind-secret-not-enabled' })).toThrow(/unless the one-time production bootstrap/);
    expect(() => readBackendConfig({ ...productionEnvironment, NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'true', NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET: 'short' })).toThrow(/at least 32 bytes/);
    expect(() => readBackendConfig({ ...productionEnvironment, NODE_ENV: 'development', NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'true', NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET: 'test-only-bootstrap-secret-at-least-32-bytes' })).toThrow(/only for an explicit production/);
  });
});
