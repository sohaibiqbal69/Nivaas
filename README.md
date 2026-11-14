# Nivaas

Nivaas is a blockchain-assisted digital governance and transparency platform
for housing societies. MongoDB is the primary application data store;
blockchain is used as an integrity and proof layer for selected records.

## Technical workspaces

- `frontend/` — React, Vite, TypeScript, Tailwind CSS, shadcn/ui conventions,
  React Router, native Fetch API, and Anime.js.
- `backend/` — Node.js, Express, TypeScript, Mongoose, authentication and
  society-scoped governance, property, project, finance, notice, complaint,
  evidence, audit and proof APIs.
- `blockchain/` — Solidity and Hardhat, including the versioned
  `GovernanceProofRegistry` contract. The current deployment script is
  localhost-only.

The workspaces form a modular monolith. Business rules and governance
decisions belong in backend services and remain governed by the specifications
in `docs/`.

## Requirements

- Node.js 22 or later
- npm 10 or later
- MongoDB is needed to run the backend against persisted records.
- Docker Desktop is needed for the local transaction-capable MongoDB test replica set.

## Install and run

```sh
npm install
npm run dev:frontend
npm run dev:backend
```

Run workspace checks:

```sh
npm run typecheck
npm run build
npm test
npm run blockchain:compile
npm run test:e2e
```

Playwright browser binaries may be installed separately with
`npx playwright install` when browser-level tests are added.

## Configuration

Copy `.env.example` to `.env` when configuring local services. Never commit
environment files or secrets. Database and blockchain connection details are
not needed to build the frontend/backend. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
for deployment preparation, current production blockers, and safe environment
configuration. No service or public contract is currently deployed.

## Transaction integration tests

The MongoDB integration-test setup uses a local single-node replica set named
`rs0`. Install Docker Desktop, then start the database from the repository
root:

```sh
docker compose up -d mongodb
```

Set `MONGODB_TEST_URI` and `NIVAAS_DISPOSABLE_DATABASE` in `.env` when running
transaction-dependent integration tests. Both must name the same new local
`nivaas_disposable_*` database on the `rs0` replica set. The integration helper
clears all collections in that disposable database and refuses `nivaas`,
`nivaas_demo`, `nivaas_test` and other protected targets. Never reuse
`MONGODB_URI` or point integration tests at a production/Atlas database.
Existing unit tests do not connect to MongoDB.

## Scope

Production service configuration, private cloud evidence storage, production
account/credential provisioning, public-testnet deployment and MetaMask
interactions remain unfinished or unresolved. See `AGENTS.md` and `docs/`
before changing behavior or architecture.
