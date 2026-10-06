import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';

const workingDirectoryEnv = resolve(process.cwd(), '.env');
const parentDirectoryEnv = resolve(process.cwd(), '..', '.env');
dotenv.config({ path: existsSync(workingDirectoryEnv) ? workingDirectoryEnv : parentDirectoryEnv });

const EXPECTED_DATABASE = 'nivaas_test';
const EXPECTED_REPLICA_SET = 'rs0';

export async function connectIntegrationTestDatabase(): Promise<void> {
  const uri = process.env.MONGODB_TEST_URI?.trim();
  if (!uri) {
    throw new Error('MONGODB_TEST_URI is required for MongoDB integration tests.');
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error('MONGODB_TEST_URI must be a valid MongoDB connection URI.');
  }

  if (
    decodeURIComponent(parsedUri.pathname.replace(/^\//, '')) !== EXPECTED_DATABASE
    || parsedUri.searchParams.get('replicaSet') !== EXPECTED_REPLICA_SET
  ) {
    throw new Error(`MONGODB_TEST_URI must target ${EXPECTED_DATABASE} on replica set ${EXPECTED_REPLICA_SET}.`);
  }

  try {
    await connectDatabase(uri);
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (hello?.setName !== EXPECTED_REPLICA_SET || hello.isWritablePrimary !== true) {
      throw new Error('MongoDB did not report an rs0 writable primary.');
    }
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

  const collections = await database.collections();
  await Promise.all(
    collections
      .filter((collection) => !collection.collectionName.startsWith('system.'))
      .map((collection) => collection.deleteMany({})),
  );
}

export async function disconnectIntegrationTestDatabase(): Promise<void> {
  await disconnectDatabase();
}
