import express, { type RequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createApprovalRouter } from '../src/modules/approval/approval-routes.js';
import { createGovernanceRouter } from '../src/modules/governance/governance-routes.js';
import { createProjectsRouter } from '../src/modules/project/project-routes.js';
import { createQuotationRouter } from '../src/modules/quotation/quotation-routes.js';

const servers: Server[] = [];

function systemAdminMiddleware(): [RequestHandler, RequestHandler] {
  const authenticate: RequestHandler = (request, _response, next) => {
    request.auth = { userId: 'system-admin' };
    next();
  };
  const loadUser: RequestHandler = (request, _response, next) => {
    request.currentUser = { userId: 'system-admin', societyId: null, role: 'SYSTEM_ADMIN' };
    next();
  };
  return [authenticate, loadUser];
}

async function request(app: express.Express, path: string, body: unknown) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to localhost.');
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('platform administrator operational separation', () => {
  it('denies System Admin project, quotation, approval-evaluation and governance writes before database access', async () => {
    const factories = [
      { path: '/projects', router: createProjectsRouter },
      { path: '/projects/68a123456789012345678901/quotations', router: createQuotationRouter },
      { path: '/projects/68a123456789012345678901/submit-for-approval', router: createApprovalRouter },
      { path: '/meetings', router: createGovernanceRouter },
    ];
    for (const item of factories) {
      const app = express();
      app.use(express.json());
      app.use(item.router(...systemAdminMiddleware()));
      app.use(errorHandler);
      const response = await request(app, item.path, {});
      expect(response.status, item.path).toBe(403);
    }
  });
});
