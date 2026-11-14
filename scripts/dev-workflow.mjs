export function validateDevConfiguration(environment, blockchainEnabled) {
  const errors = [];
  if (!environment.MONGODB_URI?.trim()) errors.push('MONGODB_URI is required. Set the Atlas URI in the ignored root .env (or explicitly select local MongoDB).');
  else {
    try {
      const uri = new URL(environment.MONGODB_URI.trim());
      if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol) || !uri.pathname || uri.pathname === '/') errors.push('MONGODB_URI must include a MongoDB database name.');
      if (isLoopbackMongoUri(environment.MONGODB_URI.trim()) && !uri.searchParams.get('replicaSet')) errors.push('Local MongoDB must use a replica set because application transactions require it.');
    } catch {
      errors.push('MONGODB_URI must be a valid MongoDB connection URI.');
    }
  }
  if (!environment.JWT_SECRET?.trim()) errors.push('JWT_SECRET is required for authenticated development.');
  else if (environment.JWT_SECRET.trim().length < 32) errors.push('JWT_SECRET must contain at least 32 characters.');
  const port = Number(environment.PORT ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535.');

  if (blockchainEnabled) {
    const signer = environment.BLOCKCHAIN_SIGNER_PRIVATE_KEY?.trim();
    if (!signer) errors.push('BLOCKCHAIN_SIGNER_PRIVATE_KEY is required when local blockchain development is enabled.');
    else if (!/^0x[0-9a-f]{64}$/i.test(signer)) errors.push('BLOCKCHAIN_SIGNER_PRIVATE_KEY must be a 32-byte local development key.');
    const chainId = environment.BLOCKCHAIN_CHAIN_ID?.trim();
    if (chainId && chainId !== '31337') errors.push('BLOCKCHAIN_CHAIN_ID must be 31337 for the local Hardhat workflow.');
    const rpc = environment.BLOCKCHAIN_RPC_URL?.trim() || 'http://127.0.0.1:8545';
    try {
      const url = new URL(rpc);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.replace(/^\[|\]$/g, ''))) errors.push('BLOCKCHAIN_RPC_URL must point to a loopback HTTP endpoint.');
    } catch {
      errors.push('BLOCKCHAIN_RPC_URL must be a valid local HTTP URL.');
    }
  }
  return errors;
}

export function deploymentMetadataIsValid(record) {
  return Boolean(record
    && record.network === 'localhost'
    && record.contractName === 'GovernanceProofRegistry'
    && String(record.chainId) === '31337'
    && /^0x[0-9a-f]{40}$/i.test(record.contractAddress ?? '')
    && /^0x[0-9a-f]{64}$/i.test(record.deploymentTransactionHash ?? '')
    && Number.isSafeInteger(Number(record.deploymentBlock))
    && Number(record.deploymentBlock) > 0);
}

export function deploymentIsLive(record, chainId, receipt, contractCode) {
  return deploymentMetadataIsValid(record)
    && String(BigInt(chainId)) === '31337'
    && receipt?.status === '0x1'
    && Number(BigInt(receipt.blockNumber)) === Number(record.deploymentBlock)
    && contractCode !== '0x'
    && contractCode !== '0x0';
}

export function isLoopbackMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'mongodb:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}
