import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';
import { assertDisposableDatabase, validateTestUri } from './disposable-database.js';

const workingDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
dotenv.config({ path: existsSync(workingDirectoryEnv) ? workingDirectoryEnv : parentDirectoryEnv });

const EXPECTED_REPLICA_SET = 'rs0';
let connectedTestDatabase: string | undefined;

export async function connectIntegrationTestDatabase(): Promise<void> {
  const uri = process.env.MONGODB_TEST_URI?.trim();
  if (!uri) {
    throw new Error('MONGODB_TEST_URI is required for MongoDB integration tests.');
  }

  connectedTestDatabase = undefined;
  const expectedDatabase = validateTestUri(uri, process.env.NIVAAS_DISPOSABLE_DATABASE);

  try {
    await connectDatabase(uri);
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (hello?.setName !== EXPECTED_REPLICA_SET || hello.isWritablePrimary !== true) {
      throw new Error('MongoDB did not report an rs0 writable primary.');
    }
    if (mongoose.connection.db?.databaseName !== expectedDatabase) throw new Error('Test database identity mismatch.');
    connectedTestDatabase = expectedDatabase;
  } catch {
    await disconnectDatabase().catch(() => undefined);
    throw new Error('Could not connect to the rs0 test replica set. Start it with `docker compose up -d mongodb`.');
  }
}

export async function clearIntegrationTestDatabase(): Promise<void> {
  const database = mongoose.connection.db;
  if (!database || mongoose.connection.readyState !== 1) {
    throw new Error('The MongoDB integration-test database is not connected.');
  }
  assertDisposableDatabase(database.databaseName, process.env.NIVAAS_DISPOSABLE_DATABASE);
  if (database.databaseName !== connectedTestDatabase) throw new Error('Test database connection changed; cleanup refused.');

  const collections = await database.collections();
  await Promise.all(
    collections
      .filter((collection) => !collection.collectionName.startsWith('system.'))
      .map((collection) => collection.deleteMany({})),
  );
}

export async function disconnectIntegrationTestDatabase(): Promise<void> {
  connectedTestDatabase = undefined;
  await disconnectDatabase();
}
