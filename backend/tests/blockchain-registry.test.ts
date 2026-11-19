import { EthersGovernanceProofRegistryClient, governanceProofRegistryInterface, isUnknownProofError } from '../src/modules/blockchain/governance-proof-registry.js';
import { JsonRpcProvider } from 'ethers';
import { describe, expect, it, vi } from 'vitest';

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

describe('registry deployment RPC network matching', () => {
  const config = (chainId: string, rpcUrl: string) => ({
    chainId, rpcUrl, contractAddress: `0x${'1'.repeat(40)}`,
    deploymentTransactionHash: `0x${'2'.repeat(64)}`, deploymentBlock: 12,
    signerPrivateKey: `0x${'3'.repeat(64)}`,
  });

  it.each([
    ['31337', 'https://rpc.example.invalid'],
    ['11155111', 'http://127.0.0.1:8545'],
  ])('rejects mismatched chain %s and RPC %s before querying the endpoint', async (chainId, rpcUrl) => {
    const client = new EthersGovernanceProofRegistryClient(config(chainId, rpcUrl));
    const getNetwork = vi.spyOn(JsonRpcProvider.prototype, 'getNetwork');
    await expect(client.validateDeployment()).rejects.toThrow('BLOCKCHAIN_RPC_MISMATCH');
    expect(getNetwork).not.toHaveBeenCalled();
    getNetwork.mockRestore();
  });

  it.each([
    ['31337', 'http://127.0.0.1:8545'],
    ['11155111', 'https://rpc.example.invalid'],
  ])('accepts network class for chain %s and RPC %s', (chainId, rpcUrl) => {
    const client = new EthersGovernanceProofRegistryClient(config(chainId, rpcUrl));
    expect(client).toBeInstanceOf(EthersGovernanceProofRegistryClient);
  });
});

describe('registry proof event lookup', () => {
  it('reads matching events from known transaction receipts without issuing eth_getLogs', async () => {
    const transactionHash = `0x${'c'.repeat(64)}`;
    const reference = `0x${'a'.repeat(64)}`;
    const recordHash = `0x${'b'.repeat(64)}`;
    const iface = governanceProofRegistryInterface;
    const encoded = iface.encodeEventLog(iface.getEvent('ProofRegistered')!, [reference, 1, recordHash, `0x${'1'.repeat(40)}`, 123]);
    const contractAddress = `0x${'2'.repeat(40)}`;
    const client = new EthersGovernanceProofRegistryClient({
      chainId: '11155111', rpcUrl: 'https://rpc.example.invalid', contractAddress,
      deploymentTransactionHash: `0x${'3'.repeat(64)}`, deploymentBlock: 1, signerPrivateKey: `0x${'4'.repeat(64)}`,
    });
    const provider = (client as unknown as { provider: JsonRpcProvider }).provider;
    vi.spyOn(provider, 'getTransactionReceipt').mockResolvedValue({
      hash: transactionHash, blockNumber: 42, logs: [{ address: contractAddress, topics: encoded.topics, data: encoded.data }],
    } as any);
    const send = vi.spyOn(provider, 'send').mockImplementation(async (method) => {
      if (method === 'eth_getLogs') throw new Error('eth_getLogs must not be called');
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    await expect(client.findProofEvents(reference, 1, [transactionHash])).resolves.toMatchObject([
      { transactionHash, blockNumber: 42, recordHash },
    ]);
    expect(send).not.toHaveBeenCalledWith('eth_getLogs', expect.anything());
  });

  it('requires transaction history and propagates receipt RPC failures', async () => {
    const client = new EthersGovernanceProofRegistryClient({
      chainId: '11155111', rpcUrl: 'https://rpc.example.invalid', contractAddress: `0x${'2'.repeat(40)}`,
      deploymentTransactionHash: `0x${'3'.repeat(64)}`, deploymentBlock: 1, signerPrivateKey: `0x${'4'.repeat(64)}`,
    });
    await expect(client.findProofEvents(`0x${'a'.repeat(64)}`, 1)).rejects.toThrow('BLOCKCHAIN_EVENT_TRANSACTION_HISTORY_REQUIRED');
    vi.spyOn((client as unknown as { provider: JsonRpcProvider }).provider, 'getTransactionReceipt')
      .mockRejectedValue(new Error('RPC unavailable'));
    await expect(client.findProofEvents(`0x${'a'.repeat(64)}`, 1, [`0x${'c'.repeat(64)}`])).rejects.toThrow('RPC unavailable');
  });
});
