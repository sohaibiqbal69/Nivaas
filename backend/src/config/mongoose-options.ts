import type { ConnectOptions } from 'mongoose';

/** Keep local convenience behavior while making production schema setup explicit. */
export function applicationMongoOptions(nodeEnvironment: string | undefined): ConnectOptions {
  const isProduction = nodeEnvironment === 'production';
  return {
    autoCreate: !isProduction,
    autoIndex: !isProduction,
  };
}

/** The migration CLI inspects models but only its --apply mode writes schema state. */
export const migrationMongoOptions: ConnectOptions = {
  autoCreate: false,
  autoIndex: false,
  serverSelectionTimeoutMS: 10_000,
};
