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

  it('accepts Sepolia HTTPS RPC with chain 11155111 and preserves localhost settings', () => {
    const sepolia = readBackendConfig({
      NODE_ENV: 'development', BLOCKCHAIN_RPC_URL: 'https://rpc.example.invalid', BLOCKCHAIN_CHAIN_ID: '11155111',
      BLOCKCHAIN_CONTRACT_ADDRESS: `0x${'1'.repeat(40)}`, BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH: `0x${'2'.repeat(64)}`,
      BLOCKCHAIN_DEPLOYMENT_BLOCK: '123', BLOCKCHAIN_SIGNER_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
    });
    expect(sepolia.blockchain?.chainId).toBe('11155111');
    expect(readBackendConfig({
      NODE_ENV: 'development', BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545', BLOCKCHAIN_CHAIN_ID: '31337',
      BLOCKCHAIN_CONTRACT_ADDRESS: `0x${'1'.repeat(40)}`, BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH: `0x${'2'.repeat(64)}`,
      BLOCKCHAIN_DEPLOYMENT_BLOCK: '123', BLOCKCHAIN_SIGNER_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
    }).blockchain?.chainId).toBe('31337');
  });

  it('rejects unsupported chains, malformed RPC URLs, and remote HTTP Sepolia RPC', () => {
    const base = { NODE_ENV: 'development', BLOCKCHAIN_RPC_URL: 'https://rpc.example.invalid', BLOCKCHAIN_CHAIN_ID: '11155111', BLOCKCHAIN_CONTRACT_ADDRESS: `0x${'1'.repeat(40)}`, BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH: `0x${'2'.repeat(64)}`, BLOCKCHAIN_DEPLOYMENT_BLOCK: '123', BLOCKCHAIN_SIGNER_PRIVATE_KEY: `0x${'3'.repeat(64)}` };
    expect(() => readBackendConfig({ ...base, BLOCKCHAIN_CHAIN_ID: '1' })).toThrow(/must be 31337.*11155111/);
    expect(() => readBackendConfig({ ...base, BLOCKCHAIN_RPC_URL: 'not a URL' })).toThrow(/valid URL/);
    expect(() => readBackendConfig({ ...base, BLOCKCHAIN_RPC_URL: 'http://rpc.example.invalid' })).toThrow(/loopback HTTP.*HTTPS/);
  });
});
