import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import type { Db, Document, IndexDescription } from 'mongodb';

const currentDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
if (basename(process.cwd()).toLowerCase() === 'backend') {
  if (existsSync(parentDirectoryEnv)) dotenv.config({ path: parentDirectoryEnv });
  if (existsSync(currentDirectoryEnv)) dotenv.config({ path: currentDirectoryEnv });
} else {
  dotenv.config({ path: existsSync(currentDirectoryEnv) ? currentDirectoryEnv : parentDirectoryEnv });
}

const BUILDINGS = 'buildings';
const KEY = { societyId: 1, buildingCode: 1 } as const;
const TARGET_NAME = 'uniq_society_building_code_present';
const TARGET_PARTIAL = { buildingCode: { $type: 'string' } };
const LEGACY_NAME = 'societyId_1_buildingCode_1';

type DuplicateGroup = { _id: { societyId: unknown; buildingCode: string }; count: number };

export async function migrateBuildingCodeIndex(db: Db, confirmation: string | undefined, uri: string | undefined): Promise<'created' | 'replaced' | 'already-current'> {
  assertDisposableTarget(db.databaseName, confirmation, uri);
  const collection = db.collection(BUILDINGS);
  const indexes = await collection.indexes();
  const namedTarget = indexes.find((index) => index.name === TARGET_NAME);
  if (namedTarget && !isTargetIndex(namedTarget)) {
    throw new Error(`Index ${TARGET_NAME} exists with unexpected options; no changes were made.`);
  }

  const duplicateGroups = await collection.aggregate<DuplicateGroup>([
    { $match: { buildingCode: { $type: 'string' } } },
    { $group: { _id: { societyId: '$societyId', buildingCode: '$buildingCode' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  if (duplicateGroups.length) {
    const detail = duplicateGroups.map((group) => `${String(group._id.societyId)}/${group._id.buildingCode} (${group.count})`).join(', ');
    throw new Error(`Duplicate building codes must be reviewed before index migration; no records or indexes were changed. Conflicts: ${detail}`);
  }

  const sameKey = indexes.filter((index) => sameKeyPattern(index.key, KEY));
  const otherSameKey = sameKey.filter((index) => index.name !== TARGET_NAME);
  let legacy: IndexDescription | undefined;
  if (otherSameKey.length) {
    if (otherSameKey.length !== 1 || !isKnownLegacyIndex(otherSameKey[0])) {
      throw new Error('An unrecognized index uses (societyId, buildingCode); no index was changed. Review the index definitions manually.');
    }
    legacy = otherSameKey[0];
  }

  if (!namedTarget) {
    await collection.createIndex(KEY, {
      name: TARGET_NAME,
      unique: true,
      partialFilterExpression: TARGET_PARTIAL,
    });
  }
  if (legacy) {
    // Build the stronger intended index while the old unique index is still
    // enforcing coded values. Only after it succeeds do we remove the legacy
    // index; a failed drop leaves both protections in place and can be retried.
    try {
      await collection.dropIndex(LEGACY_NAME);
    } catch {
      throw new Error('The new partial unique index is installed, but the recognized legacy index could not be removed. Both remain active; retry after checking database permissions.');
    }
    return 'replaced';
  }
  return namedTarget ? 'already-current' : 'created';
}

function assertDisposableTarget(databaseName: string, confirmation: string | undefined, uri: string | undefined): void {
  if (!uri || confirmation !== databaseName || !/^nivaas_disposable_[a-z0-9_]+$/.test(databaseName)
    || ['nivaas', 'nivaas_test', 'nivaas_demo'].includes(databaseName.toLowerCase())) {
    throw new Error('This migration runs only on a matching, explicitly confirmed nivaas_disposable_* database. Protected databases are refused.');
  }
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error('MONGODB_URI is invalid; no database was changed.'); }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const uriDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (parsed.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '::1'].includes(host) || uriDatabase !== databaseName) {
    throw new Error('The migration requires MONGODB_URI to point to the confirmed loopback disposable database. No database was changed.');
  }
}

function isKnownLegacyIndex(index: IndexDescription): boolean {
  return index.name === LEGACY_NAME && index.unique === true && index.sparse === true && !index.partialFilterExpression;
}

function isTargetIndex(index: IndexDescription): boolean {
  return index.unique === true && !index.sparse && sameKeyPattern(index.key, KEY)
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(TARGET_PARTIAL);
}

function sameKeyPattern(left: Document, right: Document): boolean {
  return JSON.stringify(Object.entries(left)) === JSON.stringify(Object.entries(right));
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  const confirmation = process.env.NIVAAS_DISPOSABLE_DATABASE;
  if (!uri) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection has no selected database.');
    const result = await migrateBuildingCodeIndex(db, confirmation, uri);
    console.log(`Building code index migration: ${result}. Database: ${db.databaseName}.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && /^migrate-building-code-index\.(?:ts|js)$/.test(basename(process.argv[1]))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Building code index migration failed.');
    process.exitCode = 1;
  });
}
