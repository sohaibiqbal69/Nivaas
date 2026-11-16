import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const workingDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
if (basename(process.cwd()).toLowerCase() === 'backend') {
  // Load shared development settings first, then let ignored backend/.env
  // supply backend-only values such as the local proof signer.
  if (existsSync(parentDirectoryEnv)) dotenv.config({ path: parentDirectoryEnv });
  if (existsSync(workingDirectoryEnv)) dotenv.config({ path: workingDirectoryEnv });
} else {
  dotenv.config({ path: existsSync(workingDirectoryEnv) ? workingDirectoryEnv : parentDirectoryEnv });
}

export type BackendConfig = {
  port: number;
  mongoUri?: string;
  corsOrigin?: string;
  jwtSecret?: string;
  jwtAccessTokenTtlSeconds?: number;
  authRefreshSessionTtlSeconds: number;
  localBootstrapEnabled: boolean;
  localBootstrapSecret?: string;
  localSetupDeliveryEnabled: boolean;
  initialAdminBootstrapEnabled: boolean;
  initialAdminBootstrapSecret?: string;
  evidenceStorage: {
    provider: 'local' | 's3' | 'cloudinary';
    legacyProvider: 'local' | 's3';
    endpoint?: string;
    bucket?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
  };
  blockchain?: {
    rpcUrl: string;
    chainId: string;
    contractAddress: string;
    deploymentTransactionHash: string;
    deploymentBlock: number;
    signerPrivateKey: string;
  };
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
  const nodeEnvironment = environment.NODE_ENV?.trim().toLowerCase();
  const localBootstrapEnabled = environment.NIVAAS_LOCAL_BOOTSTRAP_ENABLED?.trim() === 'true';
  const localSetupDeliveryEnabled = environment.NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED?.trim() === 'true';
  const localBootstrapSecret = environment.NIVAAS_LOCAL_BOOTSTRAP_SECRET?.trim();
  const rawInitialAdminBootstrapEnabled = environment.NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED?.trim().toLowerCase();
  const initialAdminBootstrapEnabled = rawInitialAdminBootstrapEnabled === 'true';
  const initialAdminBootstrapSecret = environment.NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET?.trim();
  if (rawInitialAdminBootstrapEnabled && !['true', 'false'].includes(rawInitialAdminBootstrapEnabled)) {
    throw new Error('NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED must be true or false.');
  }
  if (initialAdminBootstrapEnabled && nodeEnvironment !== 'production') {
    throw new Error('NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED is available only for an explicit production one-time CLI run.');
  }
  if (initialAdminBootstrapEnabled && (!initialAdminBootstrapSecret || new TextEncoder().encode(initialAdminBootstrapSecret).byteLength < 32)) {
    throw new Error('NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET must contain at least 32 bytes when one-time bootstrap is enabled.');
  }
  if (!initialAdminBootstrapEnabled && initialAdminBootstrapSecret) {
    throw new Error('Remove NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET unless the one-time production bootstrap command is explicitly enabled.');
  }
  const localBlockchainToggle = environment.NIVAAS_DEV_BLOCKCHAIN_ENABLED?.trim().toLowerCase();
  if (localBlockchainToggle && localBlockchainToggle !== 'true' && localBlockchainToggle !== 'false') {
    throw new Error('NIVAAS_DEV_BLOCKCHAIN_ENABLED must be true or false.');
  }
  if (nodeEnvironment === 'production' && (localBootstrapEnabled || localSetupDeliveryEnabled || localBootstrapSecret)) {
    throw new Error('Local onboarding controls must not be configured in production.');
  }
  const localDemoBootstrapSecret = nodeEnvironment === 'development'
    && localBootstrapSecret === '1234'
    && isLoopbackDemoDatabase(mongoUri);
  if (localBootstrapEnabled && (!localBootstrapSecret || (localBootstrapSecret.length < 32 && !localDemoBootstrapSecret))) {
    throw new Error('NIVAAS_LOCAL_BOOTSTRAP_SECRET must contain at least 32 characters when local bootstrap is enabled.');
  }
  if (localBootstrapEnabled || localSetupDeliveryEnabled) {
    if (!isLoopbackDemoDatabase(mongoUri)) {
      throw new Error('Local onboarding requires MONGODB_URI to target the loopback nivaas_demo database.');
    }
  }
  const rawJwtTtl = environment.JWT_ACCESS_TOKEN_TTL_SECONDS?.trim();
  let jwtAccessTokenTtlSeconds: number | undefined;
  if (rawJwtTtl) {
    jwtAccessTokenTtlSeconds = Number(rawJwtTtl);
    if (!Number.isInteger(jwtAccessTokenTtlSeconds) || jwtAccessTokenTtlSeconds < 1) {
      throw new Error('JWT_ACCESS_TOKEN_TTL_SECONDS must be a positive integer.');
    }
  }
  const rawRefreshTtl = environment.AUTH_REFRESH_SESSION_TTL_SECONDS?.trim();
  const authRefreshSessionTtlSeconds = rawRefreshTtl ? Number(rawRefreshTtl) : 30 * 24 * 60 * 60;
  if (!Number.isSafeInteger(authRefreshSessionTtlSeconds) || authRefreshSessionTtlSeconds < 60) {
    throw new Error('AUTH_REFRESH_SESSION_TTL_SECONDS must be an integer of at least 60 seconds.');
  }
  const blockchainValues = {
    rpcUrl: environment.BLOCKCHAIN_RPC_URL?.trim(),
    chainId: environment.BLOCKCHAIN_CHAIN_ID?.trim(),
    contractAddress: environment.BLOCKCHAIN_CONTRACT_ADDRESS?.trim(),
    deploymentTransactionHash: environment.BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH?.trim(),
    deploymentBlock: environment.BLOCKCHAIN_DEPLOYMENT_BLOCK?.trim(),
    signerPrivateKey: environment.BLOCKCHAIN_SIGNER_PRIVATE_KEY?.trim(),
  };
  const blockchainDisabledForDevelopment = nodeEnvironment !== 'production' && localBlockchainToggle === 'false';
  const hasBlockchainConfig = !blockchainDisabledForDevelopment && Object.values(blockchainValues).some(Boolean);
  let blockchain: BackendConfig['blockchain'];
  if (!blockchainDisabledForDevelopment && localBlockchainToggle === 'true' && !hasBlockchainConfig) {
    throw new Error('All BLOCKCHAIN_* settings are required when NIVAAS_DEV_BLOCKCHAIN_ENABLED is true.');
  }
  if (hasBlockchainConfig) {
    if (Object.values(blockchainValues).some((value) => !value)) {
      throw new Error('All BLOCKCHAIN_* settings are required when blockchain proof integration is configured.');
    }
    const deploymentBlock = Number(blockchainValues.deploymentBlock);
    if (!Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0) {
      throw new Error('BLOCKCHAIN_DEPLOYMENT_BLOCK must be a non-negative safe integer.');
    }
    if (!/^\d+$/.test(blockchainValues.chainId!)) throw new Error('BLOCKCHAIN_CHAIN_ID must be a decimal integer string.');
    if (!['31337', '11155111'].includes(blockchainValues.chainId!)) throw new Error('BLOCKCHAIN_CHAIN_ID must be 31337 (localhost) or 11155111 (Sepolia).');
    if (!/^0x[0-9a-f]{40}$/i.test(blockchainValues.contractAddress!)) throw new Error('BLOCKCHAIN_CONTRACT_ADDRESS must be an EVM address.');
    if (!/^0x[0-9a-f]{64}$/i.test(blockchainValues.deploymentTransactionHash!)) throw new Error('BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH must be a 32-byte transaction hash.');
    if (!/^0x[0-9a-f]{64}$/i.test(blockchainValues.signerPrivateKey!)) throw new Error('BLOCKCHAIN_SIGNER_PRIVATE_KEY must be a 32-byte private key.');
    let rpc: URL;
    try { rpc = new URL(blockchainValues.rpcUrl!); } catch { throw new Error('BLOCKCHAIN_RPC_URL must be a valid URL.'); }
    if (rpc.protocol !== 'http:' && rpc.protocol !== 'https:') throw new Error('BLOCKCHAIN_RPC_URL must use HTTP or HTTPS.');
    const localRpc = rpc.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(rpc.hostname);
    const sepoliaRpc = blockchainValues.chainId === '11155111' && rpc.protocol === 'https:';
    if (!localRpc && !sepoliaRpc) {
      throw new Error('BLOCKCHAIN_RPC_URL must use loopback HTTP for localhost or HTTPS for Sepolia.');
    }
    blockchain = {
      rpcUrl: blockchainValues.rpcUrl!,
      chainId: blockchainValues.chainId!,
      contractAddress: blockchainValues.contractAddress!.toLowerCase(),
      deploymentTransactionHash: blockchainValues.deploymentTransactionHash!.toLowerCase(),
      deploymentBlock,
      signerPrivateKey: blockchainValues.signerPrivateKey!,
    };
  }
  const rawEvidenceProvider = environment.EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase();
  if (nodeEnvironment === 'production' && !rawEvidenceProvider) {
    throw new Error('EVIDENCE_STORAGE_PROVIDER=cloudinary is required in production; local evidence files are not durable on ephemeral hosts.');
  }
  const evidenceProvider = rawEvidenceProvider || 'local';
  if (evidenceProvider !== 'local' && evidenceProvider !== 's3' && evidenceProvider !== 'cloudinary') {
    throw new Error('EVIDENCE_STORAGE_PROVIDER must be local, s3, or cloudinary.');
  }
  if (nodeEnvironment === 'production' && evidenceProvider === 'local') {
    throw new Error('EVIDENCE_STORAGE_PROVIDER=cloudinary or s3 is required in production; local evidence files are not durable on ephemeral hosts.');
  }
  const rawLegacyEvidenceProvider = environment.EVIDENCE_LEGACY_STORAGE_PROVIDER?.trim().toLowerCase();
  if (rawLegacyEvidenceProvider && rawLegacyEvidenceProvider !== 'local' && rawLegacyEvidenceProvider !== 's3') {
    throw new Error('EVIDENCE_LEGACY_STORAGE_PROVIDER must be local or s3.');
  }
  const legacyEvidenceProvider: 'local' | 's3' = rawLegacyEvidenceProvider === 'local' || rawLegacyEvidenceProvider === 's3'
    ? rawLegacyEvidenceProvider
    : evidenceProvider === 's3' ? 's3' : 'local';
  const evidenceStorageValues = {
    endpoint: environment.EVIDENCE_S3_ENDPOINT?.trim(),
    bucket: environment.EVIDENCE_S3_BUCKET?.trim(),
    region: environment.EVIDENCE_S3_REGION?.trim(),
    accessKeyId: environment.EVIDENCE_S3_ACCESS_KEY_ID?.trim(),
    secretAccessKey: environment.EVIDENCE_S3_SECRET_ACCESS_KEY?.trim(),
  };
  const cloudinaryStorageValues = {
    cloudName: environment.EVIDENCE_CLOUDINARY_CLOUD_NAME?.trim(),
    apiKey: environment.EVIDENCE_CLOUDINARY_API_KEY?.trim(),
    apiSecret: environment.EVIDENCE_CLOUDINARY_API_SECRET?.trim(),
  };
  const hasS3Configuration = Object.values(evidenceStorageValues).some(Boolean);
  const s3IsNeeded = evidenceProvider === 's3' || legacyEvidenceProvider === 's3';
  if (s3IsNeeded) {
    if (Object.values(evidenceStorageValues).some((value) => !value)) {
      throw new Error('All EVIDENCE_S3_* settings are required when S3 is the active or legacy evidence provider.');
    }
    let endpoint: URL;
    try { endpoint = new URL(evidenceStorageValues.endpoint!); }
    catch { throw new Error('EVIDENCE_S3_ENDPOINT must be a valid HTTPS URL.'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('EVIDENCE_S3_ENDPOINT must be an HTTPS endpoint without embedded credentials, query, or fragment.');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(evidenceStorageValues.bucket!)) {
      throw new Error('EVIDENCE_S3_BUCKET must be a valid private object-store bucket name.');
    }
  } else if (hasS3Configuration) {
    throw new Error('Set EVIDENCE_LEGACY_STORAGE_PROVIDER=s3 to retain S3 access, or remove unused EVIDENCE_S3_* settings.');
  }
  const hasCloudinaryConfiguration = Object.values(cloudinaryStorageValues).some(Boolean);
  if (evidenceProvider === 'cloudinary') {
    if (Object.values(cloudinaryStorageValues).some((value) => !value)) {
      throw new Error('All EVIDENCE_CLOUDINARY_* settings are required when EVIDENCE_STORAGE_PROVIDER=cloudinary.');
    }
    if (!/^[a-zA-Z0-9_-]{1,255}$/.test(cloudinaryStorageValues.cloudName!)) {
      throw new Error('EVIDENCE_CLOUDINARY_CLOUD_NAME must be a Cloudinary cloud name.');
    }
  } else if (hasCloudinaryConfiguration) {
    throw new Error('Remove EVIDENCE_CLOUDINARY_* settings unless EVIDENCE_STORAGE_PROVIDER=cloudinary.');
  }
  const evidenceStorage: BackendConfig['evidenceStorage'] = {
    provider: evidenceProvider,
    legacyProvider: legacyEvidenceProvider,
    ...(s3IsNeeded ? evidenceStorageValues : {}),
    ...(evidenceProvider === 'cloudinary' ? cloudinaryStorageValues : {}),
  };
  if (nodeEnvironment === 'production') {
    validateProductionConfiguration({ mongoUri, corsOrigin, jwtSecret, jwtAccessTokenTtlSeconds, authRefreshSessionTtlSeconds, refreshTtlWasExplicit: Boolean(rawRefreshTtl) });
  }
  return {
    port,
    ...(mongoUri ? { mongoUri } : {}),
    ...(corsOrigin ? { corsOrigin } : {}),
    ...(jwtSecret ? { jwtSecret } : {}),
    ...(jwtAccessTokenTtlSeconds ? { jwtAccessTokenTtlSeconds } : {}),
    authRefreshSessionTtlSeconds,
    localBootstrapEnabled,
    ...(localBootstrapSecret ? { localBootstrapSecret } : {}),
    localSetupDeliveryEnabled,
    initialAdminBootstrapEnabled,
    ...(initialAdminBootstrapSecret ? { initialAdminBootstrapSecret } : {}),
    evidenceStorage,
    ...(blockchain ? { blockchain } : {}),
  };
}

function validateProductionConfiguration(configuration: {
  mongoUri?: string;
  corsOrigin?: string;
  jwtSecret?: string;
  jwtAccessTokenTtlSeconds?: number;
  authRefreshSessionTtlSeconds: number;
  refreshTtlWasExplicit: boolean;
}): void {
  const { mongoUri, corsOrigin, jwtSecret, jwtAccessTokenTtlSeconds, refreshTtlWasExplicit } = configuration;
  let databaseUrl: URL;
  try {
    if (!mongoUri) throw new Error();
    databaseUrl = new URL(mongoUri);
  } catch {
    throw new Error('MONGODB_URI must be configured with the production database connection.');
  }
  const databaseHost = databaseUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  const insecureTls = ['tls', 'ssl'].some((key) => databaseUrl.searchParams.get(key) === 'false')
    || ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames']
      .some((key) => databaseUrl.searchParams.get(key) === 'true');
  if (!['mongodb:', 'mongodb+srv:'].includes(databaseUrl.protocol)
    || !databaseHost
    || ['localhost', '127.0.0.1', '::1'].includes(databaseHost)
    || !databaseName
    || insecureTls
    || databaseUrl.protocol === 'mongodb:'
      && databaseUrl.searchParams.get('tls') !== 'true'
      && databaseUrl.searchParams.get('ssl') !== 'true') {
    throw new Error('MONGODB_URI must target a named, non-loopback production database with TLS enabled.');
  }

  if (!corsOrigin) throw new Error('CORS_ORIGIN must be configured as the production frontend origin.');
  let allowedOrigin: URL;
  try { allowedOrigin = new URL(corsOrigin); }
  catch { throw new Error('CORS_ORIGIN must be one exact HTTPS origin without a path.'); }
  if (allowedOrigin.protocol !== 'https:' || allowedOrigin.origin !== corsOrigin || allowedOrigin.username || allowedOrigin.password) {
    throw new Error('CORS_ORIGIN must be one exact HTTPS origin without a path.');
  }

  if (!jwtSecret || new TextEncoder().encode(jwtSecret).byteLength < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes in production.');
  }
  if (!jwtAccessTokenTtlSeconds) {
    throw new Error('JWT_ACCESS_TOKEN_TTL_SECONDS must be explicitly configured in production.');
  }
  if (!refreshTtlWasExplicit) {
    throw new Error('AUTH_REFRESH_SESSION_TTL_SECONDS must be explicitly configured in production.');
  }
}

export function isLoopbackDemoDatabase(mongoUri: string | undefined): boolean {
  if (!mongoUri) return false;
  try {
    const parsed = new URL(mongoUri);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return (parsed.protocol === 'mongodb:' || parsed.protocol === 'mongodb+srv:')
      && ['127.0.0.1', 'localhost', '::1'].includes(hostname)
      && database === 'nivaas_demo'
      && parsed.protocol === 'mongodb:';
  } catch {
    return false;
  }
}

export const backendConfig = readBackendConfig();
