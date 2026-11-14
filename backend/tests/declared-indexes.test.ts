import { model, Schema } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ensureDeclaredIndexes, planDeclaredIndexes, verifyDeclaredIndexes } from '../src/migrations/declared-indexes.js';

function makeModel(name: string, unique = true) {
  const schema = new Schema({ societyId: String, externalId: String }, { collection: `migration_test_${name}` });
  schema.index({ societyId: 1, externalId: 1 }, { unique, name: 'society_external_unique' });
  return model(`MigrationIndexTest_${name}`, schema);
}

function makeDb(indexes: Array<Record<string, unknown>> = [], customCreateIndex?: (...args: any[]) => Promise<unknown>) {
  const createIndex = vi.fn(customCreateIndex ?? (async (key: Record<string, unknown>, options: Record<string, unknown>) => {
    indexes.push({ key, ...options });
    return String(options.name);
  }));
  const collection = { indexes: vi.fn(async () => indexes), createIndex };
  return { db: { collection: vi.fn(() => collection) }, collection, indexes };
}

describe('schema-declared index migration', () => {
  it('plans missing indexes without writing and then creates them idempotently', async () => {
    const schemaModel = makeModel('create');
    const { db, collection, indexes } = makeDb();
    const plan = await planDeclaredIndexes(db as never, [schemaModel]);
    expect(plan).toHaveLength(1);
    expect(collection.createIndex).not.toHaveBeenCalled();
    await ensureDeclaredIndexes(db as never, [schemaModel]);
    await ensureDeclaredIndexes(db as never, [schemaModel]);
    expect(collection.createIndex).toHaveBeenCalledWith(
      { societyId: 1, externalId: 1 },
      { background: true, unique: true, name: 'society_external_unique' },
    );
    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    await expect(verifyDeclaredIndexes(db as never, [schemaModel])).resolves.toBeUndefined();
    indexes.length = 0;
    await expect(verifyDeclaredIndexes(db as never, [schemaModel])).rejects.toThrow(/missing index/);
  });

  it('accepts an existing equivalent index even when MongoDB generated its name', async () => {
    const schemaModel = makeModel('equivalent');
    const { db, collection } = makeDb([{ name: 'societyId_1_externalId_1', key: { societyId: 1, externalId: 1 }, unique: true }]);
    await expect(planDeclaredIndexes(db as never, [schemaModel])).resolves.toEqual([]);
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('fails closed on a same-key index with conflicting uniqueness options', async () => {
    const schemaModel = makeModel('conflict');
    const { db, collection } = makeDb([{ name: 'societyId_1_externalId_1', key: { societyId: 1, externalId: 1 } }]);
    await expect(planDeclaredIndexes(db as never, [schemaModel])).rejects.toThrow(/incompatible index/);
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('turns existing duplicate-data failure into actionable guidance without cleanup', async () => {
    const schemaModel = makeModel('duplicates');
    const error = Object.assign(new Error('duplicate key'), { code: 11000 });
    const createIndex = vi.fn(async () => { throw error; });
    const { db } = makeDb([], createIndex);
    await expect(ensureDeclaredIndexes(db as never, [schemaModel])).rejects.toThrow(/records violate the declared uniqueness rule/);
    expect(createIndex).toHaveBeenCalledTimes(1);
  });
});
