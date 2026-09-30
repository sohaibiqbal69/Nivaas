const { spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const localDataRoot = resolve(__dirname, '../../.hardhat-user-data');
const appData = resolve(localDataRoot, 'roaming');
const localAppData = resolve(localDataRoot, 'local');
const hardhatPackagePath = require.resolve('hardhat/package.json');
const hardhatPackage = require(hardhatPackagePath);
const hardhatCli = resolve(dirname(hardhatPackagePath), hardhatPackage.bin.hardhat);

mkdirSync(appData, { recursive: true });
mkdirSync(localAppData, { recursive: true });

const result = spawnSync(
  process.execPath,
  [hardhatCli, ...process.argv.slice(2)],
  {
    cwd: resolve(__dirname, '..'),
    env: {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
