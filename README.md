# Nivaas

Nivaas is a blockchain-assisted digital governance and transparency platform
for housing societies. MongoDB is the primary application data store;
blockchain is used as an integrity and proof layer for selected records.

## Technical workspaces

- `frontend/` — React, Vite, TypeScript, Tailwind CSS, shadcn/ui conventions,
  React Router, native Fetch API, and Anime.js.
- `backend/` — Node.js, Express, TypeScript, and Mongoose foundation.
- `blockchain/` — Solidity and Hardhat development foundation. No Nivaas
  contract behavior is implemented yet.

The workspaces form a modular monolith. Business rules and governance
decisions belong in backend services and remain governed by the specifications
in `docs/`.

## Requirements

- Node.js 22 or later
- npm 10 or later
- MongoDB is needed only when using the database connection foundation.
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
not needed to compile the scaffold.

## Transaction integration tests

The MongoDB integration-test setup uses a local single-node replica set named
`rs0`. Install Docker Desktop, then start the database from the repository
root:

```sh
docker compose up -d mongodb
```

Set `MONGODB_TEST_URI` from `.env.example` when running transaction-dependent
integration tests. It points to the separate `nivaas_test` database and must
not replace the normal application `MONGODB_URI`. The test helper fails
clearly if the variable is missing, MongoDB is unavailable, or the connection
does not report an `rs0` primary. Existing unit tests do not connect to MongoDB.

## Scope

This repository foundation intentionally does not implement authentication,
domain models, governance workflows, business APIs, production deployment,
wallet transactions, or a Nivaas smart contract. See `AGENTS.md` and `docs/`
before extending it.
