import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { applicationMongoOptions, migrationMongoOptions } from '../src/config/mongoose-options.js';
import { connectDatabase } from '../src/config/database.js';

vi.mock('../src/migrations/index.js', () => ({ migrations: [] }));
vi.mock('../src/migrations/migration-runner.js', () => ({ assertMigrationsApplied: vi.fn(async () => undefined) }));

describe('MongoDB connection creation policy', () => {
  it('keeps automatic model setup enabled in local and test environments', () => {
    expect(applicationMongoOptions('development')).toMatchObject({ autoCreate: true, autoIndex: true });
    expect(applicationMongoOptions('test')).toMatchObject({ autoCreate: true, autoIndex: true });
  });

  it('disables both implicit collection and index creation in production', () => {
    expect(applicationMongoOptions('production')).toMatchObject({ autoCreate: false, autoIndex: false });
  });

  it('uses explicit no-create/no-index settings for migration inspection and apply', () => {
    expect(migrationMongoOptions).toMatchObject({ autoCreate: false, autoIndex: false });
  });

  it('passes the production policy to the real application connection path', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const originalDb = Object.getOwnPropertyDescriptor(mongoose.connection, 'db');
    const db = { databaseName: 'unit-test' } as never;
    Object.defineProperty(mongoose.connection, 'db', { configurable: true, value: db });
    const connect = vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    const disconnect = vi.spyOn(mongoose, 'disconnect').mockResolvedValue(mongoose);
    process.env.NODE_ENV = 'production';
    try {
      await connectDatabase('mongodb://unused.invalid/unit-test');
      expect(connect).toHaveBeenCalledWith('mongodb://unused.invalid/unit-test', {
        autoCreate: false,
        autoIndex: false,
      });
    } finally {
      process.env.NODE_ENV = previousEnvironment;
      connect.mockRestore();
      disconnect.mockRestore();
      if (originalDb) Object.defineProperty(mongoose.connection, 'db', originalDb);
      else Reflect.deleteProperty(mongoose.connection, 'db');
    }
  });
});
