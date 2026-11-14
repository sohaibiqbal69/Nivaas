import { describe, expect, it, vi } from 'vitest';
import { assertMigrationsApplied, FORBIDDEN_DATABASES, inspectMigrations, runMigrations, validateMigrationOrder, validateMigrationTarget, type Migration } from '../src/migrations/migration-runner.js';

const safeEnvironment = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:password@cluster.example.mongodb.net/nivaas_college_demo_2026?retryWrites=true&w=majority',
  NIVAAS_MIGRATION_DATABASE_NAME: 'nivaas_college_demo_2026',
  NIVAAS_MIGRATION_ALLOWED_DATABASES: 'nivaas_college_demo_2026',
};

function fakeDb(initial: string[] = []) {
  const ledger = [...initial];
  const inserts: Array<{ migrationId: string; appliedAt: Date }> = [];
  const db = {
    listCollections: vi.fn(() => ({ hasNext: async () => ledger.length > 0 })),
    collection: vi.fn(() => ({
      find: () => ({ toArray: async () => ledger.map((migrationId) => ({ migrationId })) }),
      createIndex: vi.fn(async () => 'migration_id_unique'),
      insertOne: vi.fn(async (record: { migrationId: string; appliedAt: Date }) => { ledger.push(record.migrationId); inserts.push(record); }),
    })),
  };
  return { db, ledger, inserts };
}

const migration = (id: string, up = vi.fn(async () => undefined)): Migration => ({ id, description: id, up });

describe('production migration safety and runner', () => {
  it('validates exact remote TLS database target and explicit allowlist', () => {
    expect(validateMigrationTarget(safeEnvironment)).toEqual({
      uri: safeEnvironment.MONGODB_URI,
      databaseName: 'nivaas_college_demo_2026',
    });
    expect(() => validateMigrationTarget({ ...safeEnvironment, NIVAAS_MIGRATION_DATABASE_NAME: 'other' })).toThrow(/exactly match/);
    expect(() => validateMigrationTarget({ ...safeEnvironment, NIVAAS_MIGRATION_ALLOWED_DATABASES: 'other' })).toThrow(/not in/);
    expect(() => validateMigrationTarget({ ...safeEnvironment, NODE_ENV: 'development' })).toThrow(/NODE_ENV=production/);
    expect(() => validateMigrationTarget({ ...safeEnvironment, MONGODB_URI: 'mongodb://localhost:27017/nivaas_college_demo_2026?tls=true' })).toThrow(/remote MongoDB/);
    expect(() => validateMigrationTarget({ ...safeEnvironment, MONGODB_URI: safeEnvironment.MONGODB_URI.replace('mongodb+srv:', 'mongodb:') })).toThrow(/TLS enabled/);
  });

  it('rejects every protected and disposable database name even if allowlisted', () => {
    for (const databaseName of [...FORBIDDEN_DATABASES, 'nivaas_disposable_migration_check']) {
      const environment = {
        ...safeEnvironment,
        MONGODB_URI: `mongodb+srv://user:password@cluster.example.mongodb.net/${databaseName}`,
        NIVAAS_MIGRATION_DATABASE_NAME: databaseName,
        NIVAAS_MIGRATION_ALLOWED_DATABASES: databaseName,
      };
      expect(() => validateMigrationTarget(environment), databaseName).toThrow(/protected/);
    }
  });

  it('requires unique, ascending version IDs', () => {
    expect(() => validateMigrationOrder([migration('20261026_02_second'), migration('20261026_01_first')])).toThrow(/ascending/);
    expect(() => validateMigrationOrder([migration('20261026_01_first'), migration('20261026_01_first')])).toThrow(/unique/);
    expect(() => validateMigrationOrder([migration('first')])).toThrow(/YYYYMMDD/);
  });

  it('reports pending migrations without creating a ledger or applying work', async () => {
    const { db } = fakeDb();
    const first = migration('20261026_01_first');
    const second = migration('20261026_02_second');
    await expect(runMigrations(db as never, [first, second], 'dry-run')).resolves.toMatchObject([
      { id: first.id, state: 'pending' }, { id: second.id, state: 'pending' },
    ]);
    expect(first.up).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('runs the read-only preflight callback during dry-run', async () => {
    const { db } = fakeDb();
    const current: Migration = {
      id: '20261026_01_preview',
      description: 'Preview only',
      up: vi.fn(async () => undefined),
      preview: vi.fn(async () => '2 indexes missing'),
    };
    await expect(runMigrations(db as never, [current], 'dry-run')).resolves.toMatchObject([
      { state: 'pending', preview: '2 indexes missing' },
    ]);
    expect(current.preview).toHaveBeenCalledTimes(1);
    expect(current.up).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('applies ordered migrations once and records completion only after success', async () => {
    const { db, ledger, inserts } = fakeDb();
    const first = migration('20261026_01_first');
    const second = migration('20261026_02_second');
    await runMigrations(db as never, [first, second], 'apply');
    await runMigrations(db as never, [first, second], 'apply');
    expect(first.up).toHaveBeenCalledTimes(1);
    expect(second.up).toHaveBeenCalledTimes(1);
    expect(ledger).toEqual([first.id, second.id]);
    expect(inserts).toHaveLength(2);
  });

  it('does not record a failed migration and can retry after remediation', async () => {
    const { db, ledger } = fakeDb();
    const up = vi.fn().mockRejectedValueOnce(new Error('duplicate key')).mockResolvedValueOnce(undefined);
    const current = migration('20261026_01_unique_index', up);
    await expect(runMigrations(db as never, [current], 'apply')).rejects.toThrow(/No records or indexes were dropped/);
    expect(ledger).toEqual([]);
    await expect(runMigrations(db as never, [current], 'apply')).resolves.toMatchObject([{ state: 'applied' }]);
  });

  it('refuses unknown or out-of-order ledger history', async () => {
    const { db } = fakeDb(['19990101_01_unrecognized']);
    await expect(inspectMigrations(db as never, [migration('20261026_01_current')])).rejects.toThrow(/unknown migration/);
    const { db: gapDb } = fakeDb(['20261026_02_second']);
    await expect(inspectMigrations(gapDb as never, [migration('20261026_01_first'), migration('20261026_02_second')])).rejects.toThrow(/out of order/);
  });

  it('blocks production database readiness until the schema migration is recorded', async () => {
    const current = migration('20261026_01_schema_indexes');
    const { db } = fakeDb();
    await expect(assertMigrationsApplied(db as never, [current])).rejects.toThrow(/before starting the API/);
    const { db: appliedDb } = fakeDb([current.id]);
    await expect(assertMigrationsApplied(appliedDb as never, [current])).resolves.toBeUndefined();
  });
});
