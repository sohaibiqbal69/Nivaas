import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrateBuildingCodeIndex } from '../../scripts/migrate-building-code-index.js';
import { connectIntegrationTestDatabase, disconnectIntegrationTestDatabase } from './mongodb-test-database.js';

beforeAll(async () => {
  await connectIntegrationTestDatabase();
  for (const collection of await mongoose.connection.db!.collections()) {
    if (!collection.collectionName.startsWith('system.') && await collection.countDocuments() > 0) {
      throw new Error('Index migration verification requires a fresh empty disposable database; no records will be removed.');
    }
  }
}, 30000);

afterAll(async () => {
  await disconnectIntegrationTestDatabase();
});

it('replaces only the known legacy index and permits multiple optional codes while keeping coded buildings unique', async () => {
  const db = mongoose.connection.db!;
  const collection = db.collection('buildings');
  await expect(migrateBuildingCodeIndex(db, 'nivaas_demo', 'mongodb://127.0.0.1:27017/nivaas_demo')).rejects.toThrow('Protected databases are refused');
  await collection.createIndex({ societyId: 1, buildingCode: 1 }, { name: 'societyId_1_buildingCode_1', unique: true, sparse: true });
  const societyA = new mongoose.Types.ObjectId();
  const societyB = new mongoose.Types.ObjectId();
  await collection.insertOne({ societyId: societyA, name: 'No code A' });
  await collection.insertOne({ societyId: societyA, name: 'Code A', buildingCode: 'A' });
  const beforeCount = await collection.countDocuments();

  expect(await migrateBuildingCodeIndex(db, process.env.NIVAAS_DISPOSABLE_DATABASE, process.env.MONGODB_TEST_URI)).toBe('replaced');
  expect(await collection.countDocuments()).toBe(beforeCount);
  const indexes = await collection.indexes();
  expect(indexes.some((index) => index.name === 'societyId_1_buildingCode_1')).toBe(false);
  expect(indexes.some((index) => index.name === 'uniq_society_building_code_present'
    && index.unique === true
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ buildingCode: { $type: 'string' } }))).toBe(true);

  // This is the state observed when application auto-indexing has already
  // created the replacement but left the legacy sparse index in place.
  await collection.createIndex({ societyId: 1, buildingCode: 1 }, { name: 'societyId_1_buildingCode_1', unique: true, sparse: true });
  expect(await migrateBuildingCodeIndex(db, process.env.NIVAAS_DISPOSABLE_DATABASE, process.env.MONGODB_TEST_URI)).toBe('replaced');
  expect((await collection.indexes()).some((index) => index.name === 'societyId_1_buildingCode_1')).toBe(false);
  await collection.insertOne({ societyId: societyA, name: 'No code B' });
  await expect(collection.insertOne({ societyId: societyA, name: 'Duplicate code A', buildingCode: 'A' })).rejects.toMatchObject({ code: 11000 });
  await collection.insertOne({ societyId: societyB, name: 'Same code in another society', buildingCode: 'A' });
  expect(await collection.countDocuments()).toBe(beforeCount + 2);
  expect(await migrateBuildingCodeIndex(db, process.env.NIVAAS_DISPOSABLE_DATABASE, process.env.MONGODB_TEST_URI)).toBe('already-current');

  await collection.dropIndex('uniq_society_building_code_present');
  await collection.insertOne({ societyId: societyA, name: 'Legacy duplicate code A', buildingCode: 'A' });
  const duplicateCount = await collection.countDocuments();
  await expect(migrateBuildingCodeIndex(db, process.env.NIVAAS_DISPOSABLE_DATABASE, process.env.MONGODB_TEST_URI)).rejects.toThrow('Duplicate building codes must be reviewed');
  expect(await collection.countDocuments()).toBe(duplicateCount);
  expect((await collection.indexes()).some((index) => index.name === 'uniq_society_building_code_present')).toBe(false);
}, 30000);
