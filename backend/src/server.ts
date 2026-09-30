import { createServer } from 'node:http';
import { app } from './app.js';
import { backendConfig } from './config/environment.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

const server = createServer(app);
let shuttingDown = false;

server.listen(backendConfig.port, () => {
  console.info(`Nivaas backend listening on port ${backendConfig.port}`);
  if (!backendConfig.mongoUri) {
    console.warn('MONGODB_URI is not configured; database-dependent requests will be unavailable.');
    return;
  }

  void connectDatabase(backendConfig.mongoUri).catch(() => {
    console.error('MongoDB connection failed; the API is running with database-dependent requests unavailable.');
  });
});

server.on('error', (error) => {
  console.error('Nivaas backend could not start.', error.message);
  process.exitCode = 1;
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Nivaas backend received ${signal}; shutting down.`);
  server.close(async (error) => {
    if (error) {
      console.error('Nivaas backend did not close cleanly.', error.message);
      process.exitCode = 1;
    }
    try {
      await disconnectDatabase();
    } catch {
      console.error('MongoDB connection did not close cleanly.');
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
