import { describe, expect, it } from 'vitest';
import { governanceProofRegistryInterface, isUnknownProofError } from '../src/modules/blockchain/governance-proof-registry.js';

describe('GovernanceProofRegistry ABI', () => {
  it('recognizes the contract UnknownProof custom error selector', () => {
    expect(governanceProofRegistryInterface.getError('UnknownProof')?.selector).toBe('0x708614f4');
  });

  it('recognizes the expected missing-proof revert across common Ethers and Hardhat error shapes', () => {
    expect(isUnknownProofError({ data: '0x708614f4' })).toBe(true);
    expect(isUnknownProofError({ info: { error: { data: { data: '0x708614f4' } } } })).toBe(true);
    expect(isUnknownProofError(new Error('execution reverted: unrecognized custom error data 0x708614f4'))).toBe(true);
    expect(isUnknownProofError(new Error('execution reverted: UnknownProof()'))).toBe(true);
  });

  it('does not mistake unrelated RPC failures or registry custom errors for a missing proof', () => {
    expect(isUnknownProofError({ data: '0x82b42900' })).toBe(false); // Unauthorized()
    expect(isUnknownProofError(new Error('connect ECONNREFUSED 127.0.0.1:8545'))).toBe(false);
    expect(isUnknownProofError(new Error('execution reverted: ProofAlreadyRegistered()'))).toBe(false);
    expect(isUnknownProofError(null)).toBe(false);
  });
});
