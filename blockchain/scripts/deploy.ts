import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers, network } from 'hardhat';

const EXPECTED_LOCAL_CHAIN_ID = 31337n;

async function main(): Promise<void> {
  if (network.name !== 'localhost') {
    throw new Error('GovernanceProofRegistry deployment is restricted to the configured localhost network.');
  }

  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== EXPECTED_LOCAL_CHAIN_ID) {
    throw new Error(`Expected local Hardhat chain ${EXPECTED_LOCAL_CHAIN_ID}, received ${chain.chainId}.`);
  }

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
  writeFileSync(resolve(deploymentsDirectory, 'localhost.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
