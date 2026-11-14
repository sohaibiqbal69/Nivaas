import type { Db, IndexDescription } from 'mongodb';
import type { Model } from 'mongoose';

const COMPARABLE_OPTIONS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'collation', 'wildcardProjection', 'hidden'] as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function equivalent(existing: IndexDescription, expectedKey: Record<string, 1 | -1 | 'text' | '2dsphere'>, expectedOptions: Record<string, unknown>): boolean {
  if (stable(existing.key) !== stable(expectedKey)) return false;
  return COMPARABLE_OPTIONS.every((key) => stable((existing as unknown as Record<string, unknown>)[key] ?? undefined) === stable(expectedOptions[key] ?? undefined));
}

function indexName(key: Record<string, number | string>, options: Record<string, unknown>): string {
  return typeof options.name === 'string' ? options.name : Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_');
}

type PlannedIndex = { collection: string; key: Record<string, 1 | -1 | 'text' | '2dsphere'>; options: Record<string, unknown>; name: string };

export async function planDeclaredIndexes(db: Db, models: Model<any>[]): Promise<PlannedIndex[]> {
  const sortedModels = [...models].sort((a, b) => a.collection.collectionName.localeCompare(b.collection.collectionName));
  const missing: PlannedIndex[] = [];
  for (const model of sortedModels) {
    const collection = db.collection(model.collection.collectionName);
    let existing: IndexDescription[];
    try { existing = await collection.indexes(); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 26)) throw error;
      existing = [];
    }

    const definitions = model.schema.indexes() as Array<[Record<string, 1 | -1 | 'text' | '2dsphere'>, Record<string, unknown>]>;
    for (const [key, rawOptions] of definitions) {
      const options = { ...rawOptions };
      const name = indexName(key, options);
      const sameName = existing.find((item) => item.name === name);
      if (sameName) {
        if (!equivalent(sameName, key, options)) {
          throw new Error(`Index ${collection.collectionName}.${name} exists with options that conflict with the current schema; review it manually. No index was dropped.`);
        }
        continue;
      }

      const sameKey = existing.filter((item) => stable(item.key) === stable(key));
      if (sameKey.some((item) => equivalent(item, key, options))) continue;
      if (sameKey.length) {
        throw new Error(`Collection ${collection.collectionName} already has an incompatible index on ${Object.keys(key).join(', ')}; review legacy indexes before applying schema indexes. No index was dropped.`);
      }
      missing.push({ collection: collection.collectionName, key, options, name });
    }
  }
  return missing;
}

export async function ensureDeclaredIndexes(db: Db, models: Model<any>[]): Promise<void> {
  const missing = await planDeclaredIndexes(db, models);
  for (const index of missing) {
    try {
      await db.collection(index.collection).createIndex(index.key, { ...index.options, name: index.name });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        throw new Error(`Cannot create unique index ${index.collection}.${index.name}: existing records violate the declared uniqueness rule. Review and reconcile records through an approved process; migration will not delete or rewrite them.`);
      }
      throw error;
    }
  }
}

export async function verifyDeclaredIndexes(db: Db, models: Model<any>[]): Promise<void> {
  const missing = await planDeclaredIndexes(db, models);
  if (missing.length) {
    const preview = missing.slice(0, 10).map(({ collection, name }) => `${collection}.${name}`).join(', ');
    throw new Error(`Schema index readiness check found ${missing.length} missing index(es): ${preview}${missing.length > 10 ? ', …' : ''}. Rerun the explicit migration command.`);
  }
}
