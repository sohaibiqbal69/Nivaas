import { Contract, Interface, JsonRpcProvider, Wallet } from 'ethers';

export const governanceProofRegistryAbi = [
  'error UnknownProof()',
  'function registerProof(bytes32 recordReference,uint256 version,bytes32 recordHash)',
  'function getProof(bytes32 recordReference,uint256 version) view returns (tuple(bytes32 recordReference,uint256 version,bytes32 recordHash,address registeredBy,uint64 registeredAt))',
  'function verifyProof(bytes32 recordReference,uint256 version,bytes32 recomputedRecordHash) view returns (bool)',
  'function authorizedSubmitters(address account) view returns (bool)',
  'event ProofRegistered(bytes32 indexed recordReference,uint256 indexed version,bytes32 indexed recordHash,address registeredBy,uint256 registeredAt)',
] as const;

export const governanceProofRegistryInterface = new Interface(governanceProofRegistryAbi);
export type RegistryProof = {
  recordReference: string;
  version: bigint;
  recordHash: string;
  registeredBy: string;
  registeredAt: bigint;
};
export type RegistryEvent = { transactionHash: string; blockNumber: number; recordHash: string; sender?: string };
export type ProofReceipt = { status: number | null; blockNumber: number; transactionHash: string };

export interface GovernanceProofRegistryClient {
  validateDeployment(): Promise<void>;
  getProof(reference: string, version: number): Promise<RegistryProof | null>;
  findProofEvents(reference: string, version: number): Promise<RegistryEvent[]>;
  getTransactionReceipt(hash: string): Promise<ProofReceipt | null>;
  registerProof(reference: string, version: number, recordHash: string): Promise<{ hash: string; sender: string; wait(): Promise<ProofReceipt | null> }>;
  verifyProof(reference: string, version: number, recordHash: string): Promise<boolean>;
}

export type RegistryConfiguration = {
  rpcUrl: string;
  chainId: string;
  contractAddress: string;
  deploymentTransactionHash: string;
  deploymentBlock: number;
  signerPrivateKey: string;
};

export class EthersGovernanceProofRegistryClient implements GovernanceProofRegistryClient {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly contract: Contract;

  constructor(private readonly config: RegistryConfiguration) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(config.signerPrivateKey, this.provider);
    this.contract = new Contract(config.contractAddress, governanceProofRegistryAbi, this.signer);
  }

  async validateDeployment(): Promise<void> {
    if (this.config.chainId !== '31337') throw new Error('BLOCKCHAIN_CHAIN_MISMATCH');
    const network = await this.provider.getNetwork();
    if (network.chainId.toString() !== this.config.chainId) throw new Error('BLOCKCHAIN_CHAIN_MISMATCH');
    const code = await this.provider.getCode(this.config.contractAddress);
    if (code === '0x') throw new Error('BLOCKCHAIN_CONTRACT_MISSING');
    const receipt = await this.provider.getTransactionReceipt(this.config.deploymentTransactionHash);
    if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== this.config.contractAddress.toLowerCase()) {
      throw new Error('BLOCKCHAIN_DEPLOYMENT_MISMATCH');
    }
    if (receipt.blockNumber !== this.config.deploymentBlock) throw new Error('BLOCKCHAIN_DEPLOYMENT_MISMATCH');
    if (!await this.contract.authorizedSubmitters(this.signer.address)) throw new Error('BLOCKCHAIN_SIGNER_UNAUTHORIZED');
  }

  async getProof(reference: string, version: number): Promise<RegistryProof | null> {
    try {
      const proof = await this.contract.getProof(reference, version);
      return {
        recordReference: proof.recordReference,
        version: proof.version,
        recordHash: proof.recordHash.toLowerCase(),
        registeredBy: proof.registeredBy,
        registeredAt: proof.registeredAt,
      };
    } catch (error) {
      if (isUnknownProofError(error)) return null;
      throw error;
    }
  }

  async findProofEvents(reference: string, version: number): Promise<RegistryEvent[]> {
    const events = await this.contract.queryFilter(this.contract.filters.ProofRegistered(reference, version), this.config.deploymentBlock);
    return events.flatMap((event) => {
      const parsed = this.contract.interface.parseLog({ topics: event.topics, data: event.data });
      return parsed ? [{
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        recordHash: String(parsed.args.recordHash).toLowerCase(),
        sender: String(parsed.args.registeredBy),
      }] : [];
    });
  }

  async getTransactionReceipt(hash: string): Promise<ProofReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    return receipt ? { status: receipt.status, blockNumber: receipt.blockNumber, transactionHash: receipt.hash } : null;
  }

  async registerProof(reference: string, version: number, recordHash: string) {
    const transaction = await this.contract.registerProof(reference, version, recordHash);
    return {
      hash: transaction.hash as string,
      sender: this.signer.address,
      wait: async () => {
        const receipt = await transaction.wait();
        return receipt ? {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          transactionHash: receipt.hash,
        } : null;
      },
    };
  }

  verifyProof(reference: string, version: number, recordHash: string): Promise<boolean> {
    return this.contract.verifyProof(reference, version, recordHash) as Promise<boolean>;
  }
}

export function isUnknownProofError(error: unknown): boolean {
  const selector = governanceProofRegistryInterface.getError('UnknownProof')?.selector;
  if (!selector) return false;

  // Ethers and Hardhat versions expose revert data in different places. Only
  // treat the contract's exact UnknownProof selector as the expected empty
  // lookup result; all other RPC and contract errors must remain failures.
  const visited = new Set<object>();
  const containsSelector = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      const selectorData = new RegExp(`^${selector}(?:[0-9a-f]{2})*$`, 'i');
      return selectorData.test(value)
        || normalized.includes(`unrecognized custom error data ${selector.toLowerCase()}`)
        || normalized.includes(`unknown custom error ${selector.toLowerCase()}`);
    }
    if (!value || typeof value !== 'object' || depth > 4 || visited.has(value)) return false;
    visited.add(value);
    const candidate = value as Record<string, unknown>;
    return ['data', 'error', 'info', 'cause', 'message', 'shortMessage'].some((key) => containsSelector(candidate[key], depth + 1));
  };

  // Keep support for ethers' decoded custom-error message as well as raw data.
  const message = error instanceof Error ? error.message : '';
  return containsSelector(error, 0) || /UnknownProof\s*\(/i.test(message);
}
