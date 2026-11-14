import mongoose from 'mongoose';
import { applicationMongoOptions } from './mongoose-options.js';

export async function connectDatabase(uri: string): Promise<void> {
  // Production collection and index creation is controlled by explicit migrations.
  // Model registration during route/startup imports must remain side-effect free.
  await mongoose.connect(uri, applicationMongoOptions(process.env.NODE_ENV));
  if (process.env.NODE_ENV !== 'production') return;

  try {
    const [{ migrations }, { assertMigrationsApplied }] = await Promise.all([
      import('../migrations/index.js'),
      import('../migrations/migration-runner.js'),
    ]);
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection did not expose a database handle.');
    await assertMigrationsApplied(db, migrations);
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
