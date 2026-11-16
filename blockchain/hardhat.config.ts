import '@nomicfoundation/hardhat-ethers';
import type { HardhatUserConfig } from 'hardhat/config';

const sepoliaRpcUrl = process.env.BLOCKCHAIN_RPC_URL?.trim();
const sepoliaPrivateKey = process.env.BLOCKCHAIN_SIGNER_PRIVATE_KEY?.trim();
if (Boolean(sepoliaRpcUrl) !== Boolean(sepoliaPrivateKey)) {
  throw new Error('Sepolia Hardhat configuration requires both BLOCKCHAIN_RPC_URL and BLOCKCHAIN_SIGNER_PRIVATE_KEY.');
}

const config: HardhatUserConfig = {
  solidity: '0.8.28',
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    ...(sepoliaRpcUrl && sepoliaPrivateKey ? {
      sepolia: {
        url: sepoliaRpcUrl,
        chainId: 11155111,
        accounts: [sepoliaPrivateKey],
      },
    } : {}),
  },
};

export default config;
