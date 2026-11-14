import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deploymentIsLive,
  deploymentMetadataIsValid,
  isLoopbackMongoUri,
  validateDevConfiguration,
} from './dev-workflow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const blockchain = resolve(root, 'blockchain');
const stateFile = resolve(root, '.nivaas-dev-state.json');
const lockFile = resolve(root, '.nivaas-dev.lock');
const requireBackend = createRequire(resolve(backend, 'package.json'));
const requireBlockchain = createRequire(resolve(blockchain, 'package.json'));
const dotenv = requireBackend('dotenv');
const trackedChildren = new Map();
let stopping = false;
let reserved = false;
let chainStartedHere = false;
let resolveShutdown;

function loadEnvironment() {
  // Match backend/src/config/environment.ts: root settings first, backend-only
  // settings second, while existing PowerShell process values keep precedence.
  const rootEnvPath = resolve(root, '.env');
  if (existsSync(rootEnvPath)) {
    const rootValues = dotenv.parse(readFileSync(rootEnvPath));
    if (rootValues.BLOCKCHAIN_SIGNER_PRIVATE_KEY?.trim()) {
      throw new Error('Keep BLOCKCHAIN_SIGNER_PRIVATE_KEY only in ignored backend/.env or a temporary backend process environment, not the shared root .env.');
    }
  }
  dotenv.config({ path: resolve(root, '.env') });
  dotenv.config({ path: resolve(backend, '.env') });
}

function featureEnabled() {
  const value = process.env.NIVAAS_DEV_BLOCKCHAIN_ENABLED?.trim().toLowerCase();
  if (value && value !== 'true' && value !== 'false') {
    throw new Error('NIVAAS_DEV_BLOCKCHAIN_ENABLED must be true or false.');
  }
  return value === 'true';
}

function mongoMode(uri) {
  if (isLoopbackMongoUri(uri)) return 'local MongoDB configured (the database service remains external).';
  if (uri.startsWith('mongodb+srv://')) return 'MongoDB Atlas configured (the database service remains external).';
  return 'External MongoDB configured (the database service remains external).';
}

function checkConfiguration() {
  loadEnvironment();
  if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') throw new Error('The local development workflow cannot run with NODE_ENV=production.');
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
  const blockchainEnabled = featureEnabled();
  const errors = validateDevConfiguration(process.env, blockchainEnabled);
  if (errors.length) throw new Error(`Development configuration is incomplete:\n- ${errors.join('\n- ')}`);
  return { blockchainEnabled, port: Number(process.env.PORT ?? '4000') };
}

function redactLine(line) {
  if (/private\s*key\s*:/i.test(line) || /mnemonic\s*:/i.test(line)) return '[sensitive Hardhat account output suppressed]';
  let safe = line;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && /(secret|token|private.?key|password|mongodb_uri)/i.test(name)) {
      safe = safe.split(value).join('[redacted]');
    }
  }
  return safe;
}

function withoutApplicationSecrets(environment) {
  const safe = { ...environment };
  for (const name of Object.keys(safe)) {
    if (/(secret|token|private.?key|password|mongodb|blockchain_|nivaas_local_)/i.test(name)) delete safe[name];
  }
  return safe;
}

function streamLines(stream, destination, label) {
  let buffered = '';
  stream.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) if (line) destination.write(`[${label}] ${redactLine(line)}\n`);
  });
  stream.on('end', () => {
    if (buffered) destination.write(`[${label}] ${redactLine(buffered)}\n`);
  });
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function queryProcessIdentity(pid, marker) {
  if (process.platform !== 'win32') return { exists: true, matches: true, created: String(pid) };
  const command = [
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}'`,
    'if ($null -eq $p) { @{exists=$false;matches=$false;created=""} | ConvertTo-Json -Compress; exit 0 }',
    `$c=[string]$p.CommandLine; $m=$c.IndexOf(${powershellQuote(root)},[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $c.IndexOf(${powershellQuote(marker)},[StringComparison]::OrdinalIgnoreCase) -ge 0`,
    '@{exists=$true;matches=$m;created=[string]$p.CreationDate} | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) return { exists: false, matches: false, created: '' };
  try { return JSON.parse(result.stdout.trim()); } catch { return { exists: false, matches: false, created: '' }; }
}

function persistState() {
  const children = [...trackedChildren.values()];
  writeFileSync(stateFile, JSON.stringify({
    root,
    supervisor: { pid: process.pid, marker: 'scripts/dev.mjs', created: queryProcessIdentity(process.pid, 'scripts/dev.mjs').created },
    children,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function reserveWorkflow() {
  if (existsSync(stateFile) || existsSync(lockFile)) {
    throw new Error('A Nivaas development session or stale process record already exists. Run `npm run dev:stop` before starting another one.');
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, root }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  reserved = true;
}

async function spawnManaged(label, cwd, args, environment, marker) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (!child.pid) throw new Error(`Could not start ${label}.`);
  streamLines(child.stdout, process.stdout, label);
  streamLines(child.stderr, process.stderr, label);
  let identity;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    identity = queryProcessIdentity(child.pid, marker);
    if (identity.exists && identity.matches) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  if (!identity?.exists || !identity.matches) {
    child.kill();
    throw new Error(`Could not verify that the ${label} process belongs to this Nivaas workflow.`);
  }
  trackedChildren.set(child.pid, { pid: child.pid, label, marker, created: identity.created });
  persistState();
  child.once('error', (error) => {
    if (!stopping) void shutdown(1, `${label} failed to start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    trackedChildren.delete(child.pid);
    if (!stopping) void shutdown(1, `${label} exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
  });
  return child;
}

function terminateProcessTree(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  }
  try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

async function shutdown(code = 0, reason) {
  if (stopping) return;
  stopping = true;
  if (reason) console.error(`Nivaas development workflow stopping: ${reason}`);
  for (const child of trackedChildren.values()) terminateProcessTree(child.pid);
  trackedChildren.clear();
  if (existsSync(stateFile)) unlinkSync(stateFile);
  if (reserved && existsSync(lockFile)) unlinkSync(lockFile);
  process.exitCode = code;
  resolveShutdown?.();
}

async function jsonRpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`Local Hardhat RPC returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Local Hardhat RPC method ${method} failed.`);
  return payload.result;
}

async function waitForRpc(url, child, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('The local Hardhat node exited before becoming ready.');
    try { return await jsonRpc(url, 'eth_chainId'); } catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 400)); }
  }
  throw new Error('The local Hardhat RPC did not become ready within 30 seconds.');
}

function readDeploymentRecord() {
  const deploymentPath = resolve(blockchain, 'deployments', 'localhost.json');
  if (!existsSync(deploymentPath)) return null;
  try { return JSON.parse(readFileSync(deploymentPath, 'utf8')); } catch { return null; }
}

async function deploymentIsCurrent(record, chainId) {
  if (!deploymentMetadataIsValid(record)) return false;
  try {
    const [receipt, code] = await Promise.all([
      jsonRpc(process.env.BLOCKCHAIN_RPC_URL, 'eth_getTransactionReceipt', [record.deploymentTransactionHash]),
      jsonRpc(process.env.BLOCKCHAIN_RPC_URL, 'eth_getCode', [record.contractAddress, 'latest']),
    ]);
    return Boolean(receipt && deploymentIsLive(record, chainId, receipt, code));
  } catch { return false; }
}

function runHardhat(args) {
  const wrapper = resolve(blockchain, 'scripts', 'compile.cjs');
  const result = spawnSync(process.execPath, [wrapper, ...args], {
    cwd: root,
    env: withoutApplicationSecrets(process.env),
    encoding: 'utf8',
    windowsHide: true,
  });
  for (const line of `${result.stdout ?? ''}`.split(/\r?\n/)) if (line) console.log(`[hardhat] ${redactLine(line)}`);
  for (const line of `${result.stderr ?? ''}`.split(/\r?\n/)) if (line) console.error(`[hardhat] ${redactLine(line)}`);
  if (result.error || result.status !== 0) throw new Error(`Hardhat command failed: ${args[0]}.`);
}

async function ensureBlockchain() {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL?.trim() || 'http://127.0.0.1:8545';
  process.env.BLOCKCHAIN_RPC_URL = rpcUrl;
  process.env.BLOCKCHAIN_CHAIN_ID = '31337';
  let chainId;
  let node;
  try { chainId = await jsonRpc(rpcUrl, 'eth_chainId'); }
  catch {
    node = await spawnManaged('hardhat', root, [resolve(blockchain, 'scripts', 'compile.cjs'), 'node', '--hostname', '127.0.0.1'], withoutApplicationSecrets(process.env), 'compile.cjs');
    chainStartedHere = true;
    chainId = await waitForRpc(rpcUrl, node);
  }
  if (String(BigInt(chainId)) !== '31337') throw new Error('The configured local RPC is running the wrong chain; expected chain ID 31337.');

  const ethers = requireBlockchain('ethers');
  const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_SIGNER_PRIVATE_KEY.trim());
  const accounts = await jsonRpc(rpcUrl, 'eth_accounts');
  if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error('BLOCKCHAIN_SIGNER_PRIVATE_KEY does not match the first local Hardhat development account.');
  }

  let record = readDeploymentRecord();
  if (!(await deploymentIsCurrent(record, chainId))) {
    const blockNumber = BigInt(await jsonRpc(rpcUrl, 'eth_blockNumber'));
    if (!chainStartedHere && blockNumber > 0n) {
      throw new Error('The running local chain has activity but no matching localhost deployment record. Refusing to deploy over an unverified chain; inspect its deployment state first.');
    }
    if (record) console.warn('The saved local deployment is not present on this chain. A reset chain has a new deployment identity; proofs from the prior local chain are not confirmed on this one.');
    console.log('Compiling GovernanceProofRegistry for the local chain…');
    runHardhat(['compile']);
    console.log('Deploying GovernanceProofRegistry to local chain 31337…');
    runHardhat(['run', 'scripts/deploy.ts', '--network', 'localhost']);
    record = readDeploymentRecord();
    if (!(await deploymentIsCurrent(record, chainId))) throw new Error('The deployment record did not verify against the active local chain.');
  }

  process.env.BLOCKCHAIN_CONTRACT_ADDRESS = record.contractAddress;
  process.env.BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH = record.deploymentTransactionHash;
  process.env.BLOCKCHAIN_DEPLOYMENT_BLOCK = String(record.deploymentBlock);
  console.log(`Local proof registry ready at ${record.contractAddress} (deployment ${record.deploymentTransactionHash}; block ${record.deploymentBlock}).`);
}

async function probe(url, expected) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const body = await response.text();
    return { status: response.status, matches: expected(response.status, body) };
  } catch { return null; }
}

async function waitForService(url, expected, child, label, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`${label} exited before becoming ready.`);
    const result = await probe(url, expected);
    if (result?.matches) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${label} did not become ready at ${url}. Check its logs and the configured external MongoDB service.`);
}

async function ensureBackend(port) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const existing = await probe(url, (status) => status === 200);
  if (existing?.matches) { console.log(`Backend already healthy at http://127.0.0.1:${port}; reusing it.`); return null; }
  if (existing) throw new Error(`Port ${port} is already serving an unhealthy backend response (HTTP ${existing.status}); refusing to start a duplicate.`);
  const backendRequire = createRequire(resolve(backend, 'package.json'));
  const tsx = backendRequire.resolve('tsx/cli');
  const child = await spawnManaged('backend', backend, [tsx, 'watch', 'src/server.ts'], { ...process.env }, 'tsx');
  await waitForService(url, (status) => status === 200, child, 'Backend (including MongoDB health check)');
  return child;
}

async function ensureFrontend() {
  const url = 'http://127.0.0.1:5173/';
  const existing = await probe(url, (status, body) => status === 200 && body.includes('/src/main.tsx'));
  if (existing) { console.log('Frontend already serving Nivaas at http://127.0.0.1:5173; reusing it.'); return null; }
  const response = await probe(url, () => true);
  if (response) throw new Error(`Port 5173 is already serving an unrelated or unhealthy page (HTTP ${response.status}); refusing to start a duplicate.`);
  const frontendRequire = createRequire(resolve(root, 'frontend/package.json'));
  const vite = frontendRequire.resolve('vite/bin/vite.js');
  const child = await spawnManaged('frontend', resolve(root, 'frontend'), [vite, '--host', '127.0.0.1', '--strictPort'], withoutApplicationSecrets(process.env), 'vite/bin/vite.js');
  await waitForService(url, (status, body) => status === 200 && body.includes('/src/main.tsx'), child, 'Frontend');
  return child;
}

async function start() {
  reserveWorkflow();
  persistState();
  const { blockchainEnabled, port } = checkConfiguration();
  process.env.NIVAAS_DEV_BLOCKCHAIN_ENABLED = blockchainEnabled ? 'true' : 'false';
  console.log(`Configuration valid. ${mongoMode(process.env.MONGODB_URI)} MongoDB is not started by this command.`);
  console.log(`Frontend-only and backend-only fallbacks: npm run dev:frontend / npm run dev:backend.`);
  if (blockchainEnabled) await ensureBlockchain();
  else console.log('Local blockchain disabled; set NIVAAS_DEV_BLOCKCHAIN_ENABLED=true to opt in.');
  await ensureBackend(port);
  await ensureFrontend();
  console.log(`Nivaas is ready: http://127.0.0.1:5173 (API health: http://127.0.0.1:${port}/api/health).`);
  console.log('Press Ctrl+C here or run `npm run dev:stop` to stop only processes started by this workflow.');
  await new Promise((resolveWait) => {
    resolveShutdown = resolveWait;
    process.once('SIGINT', () => { void shutdown(0); });
    process.once('SIGTERM', () => { void shutdown(0); });
  });
}

function stopFromState() {
  if (!existsSync(stateFile)) {
    if (existsSync(lockFile)) {
      const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
      const owner = queryProcessIdentity(lock.pid, 'scripts/dev.mjs');
      if (owner.exists && owner.matches) throw new Error('The development workflow is still starting. Run `npm run dev:stop` again after it finishes startup.');
      unlinkSync(lockFile);
    }
    console.log('No Nivaas development workflow processes were recorded.');
    return;
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.root !== root || !Array.isArray(state.children)) throw new Error('The development process record does not match this repository; refusing to stop processes.');
  const entries = [...state.children];
  if (state.supervisor?.pid && state.supervisor.pid !== process.pid) entries.push({ ...state.supervisor, label: 'workflow supervisor' });
  const unverified = [];
  for (const entry of entries) {
    const identity = queryProcessIdentity(entry.pid, entry.marker);
    if (!identity.exists) continue;
    if (!identity.matches || identity.created !== entry.created) {
      unverified.push(entry.label);
      continue;
    }
    if (!terminateProcessTree(entry.pid)) unverified.push(entry.label);
  }
  if (unverified.length) throw new Error(`Could not safely verify/stop: ${unverified.join(', ')}. The process record was preserved.`);
  if (existsSync(stateFile)) unlinkSync(stateFile);
  if (existsSync(lockFile)) unlinkSync(lockFile);
  console.log(`Stopped ${entries.length ? 'the recorded Nivaas development session' : 'no running processes'}. Reused services were not recorded or stopped.`);
}

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === 'stop') return stopFromState();
  if (command === 'check') {
    const { blockchainEnabled } = checkConfiguration();
    console.log(`Configuration valid. ${mongoMode(process.env.MONGODB_URI)}`);
    console.log(`Local blockchain ${blockchainEnabled ? 'enabled (signer presence validated; deployment is checked on start)' : 'disabled'}.`);
    return;
  }
  if (command !== 'start') throw new Error('Usage: npm run dev [-- start|stop|check].');
  await start();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : 'Nivaas development workflow failed.');
  await shutdown(1);
});
