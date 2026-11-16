import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers, network } from 'hardhat';

const EXPECTED_CHAIN_IDS: Record<string, bigint> = { localhost: 31337n, sepolia: 11155111n };

export function validateDeploymentNetwork(networkName: string, chainId: bigint): void {
  const expectedChainId = EXPECTED_CHAIN_IDS[networkName];
  if (expectedChainId === undefined) throw new Error('GovernanceProofRegistry deployment is allowed only on localhost or Sepolia.');
  if (chainId !== expectedChainId) throw new Error(`Expected ${networkName} chain ${expectedChainId}, received ${chainId}.`);
}

async function main(): Promise<void> {
  const chain = await ethers.provider.getNetwork();
  validateDeploymentNetwork(network.name, chain.chainId);

  const [submitter] = await ethers.getSigners();
  if (!submitter) throw new Error('No local Hardhat deployment account is available.');

  const registryFactory = await ethers.getContractFactory('GovernanceProofRegistry');
  const registry = await registryFactory.deploy(submitter.address);
  const deploymentTransaction = registry.deploymentTransaction();
  if (!deploymentTransaction) throw new Error('The contract deployment transaction was not created.');
  const receipt = await deploymentTransaction.wait();
  const address = await registry.getAddress();
  const record = {
    network: network.name,
    chainId: chain.chainId.toString(),
    contractName: 'GovernanceProofRegistry',
    contractAddress: address,
    deploymentTransactionHash: deploymentTransaction.hash,
    deploymentBlock: receipt?.blockNumber ?? null,
    abiArtifact: 'artifacts/contracts/GovernanceProofRegistry.sol/GovernanceProofRegistry.json',
  };

  const deploymentsDirectory = resolve(__dirname, '..', 'deployments');
  mkdirSync(deploymentsDirectory, { recursive: true });
  const deploymentRecordPath = resolve(deploymentsDirectory, `${network.name}.json`);
  writeFileSync(deploymentRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
