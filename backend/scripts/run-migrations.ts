import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import type { MigrationMode } from '../src/migrations/migration-runner.js';
import { migrationMongoOptions } from '../src/config/mongoose-options.js';

const currentDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
if (basename(process.cwd()).toLowerCase() === 'backend') {
  if (existsSync(parentDirectoryEnv)) dotenv.config({ path: parentDirectoryEnv });
  if (existsSync(currentDirectoryEnv)) dotenv.config({ path: currentDirectoryEnv });
} else {
  dotenv.config({ path: existsSync(currentDirectoryEnv) ? currentDirectoryEnv : parentDirectoryEnv });
}

function parseMode(args: string[]): MigrationMode {
  if (args.length !== 1 || !['--status', '--dry-run', '--apply'].includes(args[0])) {
    throw new Error('Choose exactly one mode: --status, --dry-run, or --apply. --apply is the only mode that writes.');
  }
  return args[0].slice(2) as MigrationMode;
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  // Validate every target constraint before opening a network connection.
  const { validateMigrationTarget, runMigrations } = await import('../src/migrations/migration-runner.js');
  const target = validateMigrationTarget(process.env);
  const { default: mongoose } = await import('mongoose');
  try {
    await mongoose.connect(target.uri, migrationMongoOptions);
    const db = mongoose.connection.db;
    if (!db || db.databaseName !== target.databaseName) throw new Error('Connected database identity did not match the explicit migration target.');
    // Register models only after the connection has explicit no-auto-create/index options.
    const { migrations } = await import('../src/migrations/index.js');
    const status = await runMigrations(db, migrations, mode);
    console.info(`Migration ${mode} for database ${target.databaseName}:`);
    for (const item of status) {
      console.info(`- ${item.state}: ${item.id} — ${item.description}`);
      if (item.preview) console.info(`  ${item.preview}`);
    }
    if (mode === 'dry-run') console.info('Dry run only; no database changes were made.');
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  // Never include a MongoDB URI or driver connection object in operator logs.
  console.error(error instanceof Error ? error.message : 'Migration command failed.');
  process.exitCode = 1;
});
