import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentIsLive, deploymentMetadataIsValid, isLoopbackMongoUri, validateDevConfiguration } from './dev-workflow.mjs';

const baseEnvironment = {
  MONGODB_URI: 'mongodb+srv://example.invalid/nivaas',
  JWT_SECRET: 'placeholder-only-test-value-32-characters',
};

describe('development workflow configuration', () => {
  it('requires MongoDB and JWT settings without revealing values', () => {
    assert.deepEqual(validateDevConfiguration(baseEnvironment, false), []);
    assert.deepEqual(validateDevConfiguration({}, false), [
      'MONGODB_URI is required. Set the Atlas URI in the ignored root .env (or explicitly select local MongoDB).',
      'JWT_SECRET is required for authenticated development.',
    ]);
  });

  it('validates local signer settings only when the optional chain is enabled', () => {
    assert.deepEqual(validateDevConfiguration({ ...baseEnvironment, BLOCKCHAIN_SIGNER_PRIVATE_KEY: 'not-a-key' }, true), [
      'BLOCKCHAIN_SIGNER_PRIVATE_KEY must be a 32-byte local development key.',
    ]);
    assert.equal(validateDevConfiguration({
      ...baseEnvironment,
      BLOCKCHAIN_SIGNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545',
      BLOCKCHAIN_CHAIN_ID: '31337',
    }, true).length, 0);
  });

  it('recognizes only loopback MongoDB for optional local mode', () => {
    assert.equal(isLoopbackMongoUri('mongodb://127.0.0.1:27017/nivaas?replicaSet=rs0'), true);
    assert.equal(isLoopbackMongoUri('mongodb+srv://cluster.invalid/nivaas'), false);
    expectLocalReplicaSetRequirement();
  });
});

function expectLocalReplicaSetRequirement() {
  const errors = validateDevConfiguration({
    MONGODB_URI: 'mongodb://localhost:27017/nivaas',
    JWT_SECRET: 'placeholder-only-test-value-32-characters',
  }, false);
  assert.deepEqual(errors, ['Local MongoDB must use a replica set because application transactions require it.']);
}

describe('local deployment identity', () => {
  const record = {
    network: 'localhost', contractName: 'GovernanceProofRegistry', chainId: '31337',
    contractAddress: `0x${'a'.repeat(40)}`, deploymentTransactionHash: `0x${'b'.repeat(64)}`, deploymentBlock: 1,
  };

  it('requires the complete localhost deployment identity', () => {
    assert.equal(deploymentMetadataIsValid(record), true);
    assert.equal(deploymentMetadataIsValid({ ...record, chainId: '1' }), false);
  });

  it('reuses only a successful receipt at the recorded block with deployed bytecode', () => {
    assert.equal(deploymentIsLive(record, '0x7a69', { status: '0x1', blockNumber: '0x1' }, '0x6000'), true);
    assert.equal(deploymentIsLive(record, '0x7a69', { status: '0x0', blockNumber: '0x1' }, '0x6000'), false);
    assert.equal(deploymentIsLive(record, '0x7a69', { status: '0x1', blockNumber: '0x2' }, '0x6000'), false);
    assert.equal(deploymentIsLive(record, '0x7a69', { status: '0x1', blockNumber: '0x1' }, '0x'), false);
  });
});
