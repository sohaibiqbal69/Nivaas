import { describe, expect, it } from 'vitest';
import { readBackendConfig } from '../src/config/environment.js';

describe('optional local blockchain development configuration', () => {
  it('ignores partial local chain settings only when explicitly disabled outside production', () => {
    const config = readBackendConfig({
      PORT: '4000', NODE_ENV: 'development', NIVAAS_DEV_BLOCKCHAIN_ENABLED: 'false',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545', BLOCKCHAIN_CHAIN_ID: '31337',
    });
    expect(config.blockchain).toBeUndefined();
  });

  it('keeps blockchain settings strict when opted in', () => {
    expect(() => readBackendConfig({
      PORT: '4000', NODE_ENV: 'development', NIVAAS_DEV_BLOCKCHAIN_ENABLED: 'true',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545', BLOCKCHAIN_CHAIN_ID: '31337',
    })).toThrow(/All BLOCKCHAIN_\* settings are required/);
  });

  it('does not let the development toggle bypass production validation', () => {
    expect(() => readBackendConfig({
      PORT: '4000', NODE_ENV: 'production', NIVAAS_DEV_BLOCKCHAIN_ENABLED: 'false',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545', BLOCKCHAIN_CHAIN_ID: '31337',
    })).toThrow(/All BLOCKCHAIN_\* settings are required/);
  });
});
