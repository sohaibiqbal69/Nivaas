import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('API foundation', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('reports the API envelope and database unavailability when MongoDB is disconnected', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'A required service dependency is unavailable.' },
    });
  });

  it('returns a consistent not-found error for unknown API routes', async () => {
    const response = await fetch(`${baseUrl}/api/not-a-route`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'The requested API resource was not found.' },
    });
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'INVALID_JSON', message: 'The request body must contain valid JSON.' },
    });
  });
});
