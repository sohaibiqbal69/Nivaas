import type { Db } from 'mongodb';

export const MIGRATION_COLLECTION = '_nivaasMigrations';
export const FORBIDDEN_DATABASES = new Set(['nivaas', 'nivaas_test', 'nivaas_demo', 'admin', 'local', 'config']);

export type Migration = {
  id: string;
  description: string;
  up(db: Db): Promise<void>;
  preview?(db: Db): Promise<string>;
  verify?(db: Db): Promise<void>;
};

export type MigrationMode = 'status' | 'dry-run' | 'apply';
export type MigrationStatus = { id: string; description: string; state: 'applied' | 'pending'; preview?: string };

export function validateMigrationTarget(environment: NodeJS.ProcessEnv): { uri: string; databaseName: string } {
  if (environment.NODE_ENV !== 'production') {
    throw new Error('Database migrations require NODE_ENV=production.');
  }
  const uri = environment.MONGODB_URI?.trim();
  const configuredName = environment.NIVAAS_MIGRATION_DATABASE_NAME?.trim();
  const allowlist = environment.NIVAAS_MIGRATION_ALLOWED_DATABASES?.split(',').map((name) => name.trim()).filter(Boolean) ?? [];
  if (!uri || !configuredName || allowlist.length === 0) {
    throw new Error('Set MONGODB_URI, NIVAAS_MIGRATION_DATABASE_NAME, and NIVAAS_MIGRATION_ALLOWED_DATABASES before connecting.');
  }

  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { throw new Error('MONGODB_URI is not a valid MongoDB URI; no database connection was made.'); }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const tlsDisabled = ['tls', 'ssl'].some((key) => parsed.searchParams.get(key)?.toLowerCase() === 'false')
    || ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames']
      .some((key) => parsed.searchParams.get(key)?.toLowerCase() === 'true');
  const isRemote = hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname);
  const hasTls = parsed.protocol === 'mongodb+srv:'
    || parsed.searchParams.get('tls')?.toLowerCase() === 'true'
    || parsed.searchParams.get('ssl')?.toLowerCase() === 'true';
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !isRemote || !hasTls || tlsDisabled || !databaseName) {
    throw new Error('Migration URI must target a named remote MongoDB database with TLS enabled; no database connection was made.');
  }
  if (configuredName !== databaseName) {
    throw new Error('NIVAAS_MIGRATION_DATABASE_NAME must exactly match the database in MONGODB_URI; no connection was made.');
  }
  if (FORBIDDEN_DATABASES.has(databaseName.toLowerCase()) || databaseName.toLowerCase().startsWith('nivaas_disposable_')) {
    throw new Error(`Database ${databaseName} is protected from production migrations; no connection was made.`);
  }
  if (allowlist.some((name) => name === '*' || FORBIDDEN_DATABASES.has(name.toLowerCase()) || name.toLowerCase().startsWith('nivaas_disposable_'))) {
    throw new Error('The migration allowlist contains a wildcard or protected database name; no connection was made.');
  }
  if (!allowlist.includes(databaseName)) {
    throw new Error(`Database ${databaseName} is not in NIVAAS_MIGRATION_ALLOWED_DATABASES; no connection was made.`);
  }
  return { uri, databaseName };
}

export function validateMigrationOrder(migrations: Migration[]): void {
  const ids = migrations.map(({ id }) => id);
  if (ids.some((id) => !/^\d{8}_\d{2}_[a-z0-9_-]+$/.test(id))) {
    throw new Error('Migration IDs must use YYYYMMDD_NN_description format.');
  }
  if (new Set(ids).size !== ids.length) throw new Error('Migration IDs must be unique.');
  const sorted = [...ids].sort();
  if (ids.some((id, index) => id !== sorted[index])) {
    throw new Error('Migrations must be listed in ascending ID order.');
  }
}

export async function inspectMigrations(db: Db, migrations: Migration[]): Promise<MigrationStatus[]> {
  validateMigrationOrder(migrations);
  const hasLedger = await db.listCollections({ name: MIGRATION_COLLECTION }, { nameOnly: true }).hasNext();
  const applied = hasLedger
    ? await db.collection<{ migrationId: string }>(MIGRATION_COLLECTION).find({}, { projection: { migrationId: 1, _id: 0 } }).toArray()
    : [];
  const appliedIds = applied.map(({ migrationId }) => migrationId);
  const knownIds = new Set(migrations.map(({ id }) => id));
  const unknown = appliedIds.filter((id) => !knownIds.has(id));
  if (unknown.length) throw new Error(`Migration ledger contains unknown migration(s): ${unknown.join(', ')}. No changes were made.`);
  if (new Set(appliedIds).size !== appliedIds.length) throw new Error('Migration ledger contains duplicate IDs. No changes were made.');

  let foundPending = false;
  return migrations.map(({ id, description }) => {
    const isApplied = appliedIds.includes(id);
    if (!isApplied) foundPending = true;
    if (isApplied && foundPending) throw new Error(`Migration ledger is out of order at ${id}. No changes were made.`);
    return { id, description, state: isApplied ? 'applied' : 'pending' };
  });
}

export async function assertMigrationsApplied(db: Db, migrations: Migration[]): Promise<void> {
  const pending = (await inspectMigrations(db, migrations)).filter(({ state }) => state === 'pending');
  if (pending.length) {
    throw new Error(`Required database migrations are pending: ${pending.map(({ id }) => id).join(', ')}. Run the explicit production migration command before starting the API.`);
  }
  for (const migration of migrations) await migration.verify?.(db);
}

export async function runMigrations(db: Db, migrations: Migration[], mode: MigrationMode): Promise<MigrationStatus[]> {
  let status = await inspectMigrations(db, migrations);
  if (mode === 'status') return status;
  if (mode === 'dry-run') {
    status = await Promise.all(status.map(async (item, index) => {
      if (!migrations[index].preview) return item;
      return { ...item, preview: await migrations[index].preview!(db) };
    }));
    return status;
  }

  const ledger = db.collection<{ migrationId: string; appliedAt: Date }>(MIGRATION_COLLECTION);
  await ledger.createIndex({ migrationId: 1 }, { unique: true, name: 'migration_id_unique' });
  for (let index = 0; index < migrations.length; index += 1) {
    if (status[index].state === 'applied') continue;
    const migration = migrations[index];
    try {
      await migration.up(db);
      await ledger.insertOne({ migrationId: migration.id, appliedAt: new Date() });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown MongoDB error';
      throw new Error(`Migration ${migration.id} failed: ${detail}. No records or indexes were dropped. Some earlier indexes in this migration may exist; resolve the conflict and rerun safely.`, { cause: error });
    }
  }
  await assertMigrationsApplied(db, migrations);
  return inspectMigrations(db, migrations);
}
