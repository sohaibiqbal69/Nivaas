# Nivaas deployment preparation

**Status: preparation only.** No hosting service was created, no contract was
deployed, and no MongoDB instance was contacted or changed for this document.
Use the repository's existing specifications as the source of truth. This
guide records current implementation limits as well as the target shape; it
does not authorize a production launch.

## Current deployment assessment

The monorepo has npm workspaces for `frontend`, `backend` and `blockchain`.
The frontend production build is `npm run build --workspace=@nivaas/frontend`
and writes `frontend/dist`. The independent backend build/start commands are
`npm run build --workspace=@nivaas/backend` and
`npm run start --workspace=@nivaas/backend`; TypeScript writes
`backend/dist/server.js`. The Express process listens on the host-provided
`PORT`, mounts the API under `/api`, and already exposes `/api/health`, which
returns 503 until MongoDB is connected. The API uses a single exact CORS origin
and bearer-token authorization.

This is **not yet production deployable for real society users**. A controlled
one-time production first-System-Admin path and a private Cloudinary
evidence adapter are implemented, but no deployment has been performed and no
provider credentials are configured. Society Manager/member credential
delivery and reissue still fail closed in production because there is no
approved mail/SMS provider or routine operator delivery workflow. The
production bootstrap is a deliberate one-off CLI that outputs its setup
credential to a trusted interactive terminal; the operator must deliver that
credential privately. Public-testnet proof submission is not supported by the
current configuration/client/deployer. Do not bypass these gates with direct
database writes, public files, or a copied wallet key.

## Hosting shape

### Vercel frontend

`vercel.json` configures the monorepo-root project to install from the root
lockfile, build only the frontend workspace, publish `frontend/dist`, and send
client-side routes to the Vite entry point. In the Vercel project settings:

1. Set the repository root directory to `.` (the monorepo root), so npm can
   read the root lockfile and workspace packages.
2. Use the committed install/build/output settings from `vercel.json`.
3. Set `VITE_API_BASE_URL` to the backend HTTPS origin (or origin ending in
   `/api`) in `deployment/frontend.env.example` / Vercel Environment Variables.
4. Add only the canonical frontend origin to backend `CORS_ORIGIN`. Configure
   preview origins separately if preview deployments must call a backend.

Vite substitutes every `VITE_*` value into browser assets. Treat all of them
as public. Do not put database credentials, JWT secrets, RPC-provider API keys,
object-store credentials or any wallet/private key in a frontend variable.
Vercel documents monorepo Root Directory and build/output configuration in
[Configure a Build](https://vercel.com/docs/builds/configure-a-build).

### Express backend host

Render is a compatible example for a staging/demo API: select the repository
root (`.`), Node.js 20 or newer (the S3 SDK requires Node 20+), install `npm ci`, build
`npm run build --workspace=@nivaas/backend`, start
`npm run start --workspace=@nivaas/backend`, and set health check path
`/api/health`. The process uses the platform-injected `PORT`; configure the
backend environment in the provider's secret settings, not in a committed
file. These commands are for an independently running API, not a Vercel
serverless function.

Render's free web services spin down after 15 minutes without traffic, can
take about a minute to wake, may restart, and have an ephemeral filesystem;
Render explicitly says free instances are not for production applications.
They are acceptable for a non-critical preview once evidence storage is moved
off disk. Choose an always-on paid service or a provider with production
availability/durability guarantees before handling real society records.
See [Render free service limits](https://render.com/docs/free) and
[Render persistent disks](https://render.com/docs/disks).

### Environment templates

- `deployment/frontend.env.example` — browser-visible API origin only.
- `deployment/backend.env.example` — server-only settings and intentional
  notes about unset/unimplemented integrations.

Copy values into each provider's environment settings. Do not rename the
existing root `.env.example` or `backend/.env.example`; those preserve current
local workflows. Do not place populated production files in Git. Production
backend startup now fails early unless it has a named, non-loopback MongoDB
URI with TLS enabled, one exact HTTPS `CORS_ORIGIN`, a `JWT_SECRET` of at
least 32 bytes, and an explicit positive `JWT_ACCESS_TOKEN_TTL_SECONDS`. Local
onboarding settings remain prohibited in production.

| Variable | Where | Production handling |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Vercel build environment | Public API HTTPS origin; no credentials |
| `NODE_ENV` | Backend host | `production` |
| `PORT` | Backend host | Let the platform inject it |
| `MONGODB_URI` | Backend host secret | Atlas app-user URI for the named production DB; server only |
| `CORS_ORIGIN` | Backend host config | One exact HTTPS frontend origin; no path or wildcard |
| `JWT_SECRET` | Backend host secret | Independently generated high-entropy secret, at least 32 bytes; never reuse local/test value |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Backend host config | Explicit positive integer; current local template uses 900 seconds |
| `AUTH_REFRESH_SESSION_TTL_SECONDS` | Backend host config | Explicit integer of at least 60 seconds; default/local value is 2,592,000 seconds (30 days); production startup requires it explicitly |
| `BLOCKCHAIN_RPC_URL` | Backend host secret/config | Do not set for public testnet yet; current backend rejects it |
| `BLOCKCHAIN_CHAIN_ID` | Backend host config | Public chain ID not supported yet; current code requires `31337` |
| `BLOCKCHAIN_CONTRACT_ADDRESS` | Backend host config | Only after an approved deployment and code support |
| `BLOCKCHAIN_DEPLOYMENT_TRANSACTION_HASH`, `BLOCKCHAIN_DEPLOYMENT_BLOCK` | Backend host config | Capture from the verified deployment receipt; do not guess |
| `BLOCKCHAIN_SIGNER_PRIVATE_KEY` | Backend host secret | Current local-only key setting; do not set a personal MetaMask key or production value before custody approval and testnet support |
| `EVIDENCE_STORAGE_PROVIDER` | Backend host config | Set `cloudinary` for new production deployments; local is non-production only |
| `EVIDENCE_CLOUDINARY_CLOUD_NAME`, `EVIDENCE_CLOUDINARY_API_KEY`, `EVIDENCE_CLOUDINARY_API_SECRET` | Backend host secrets/config | Required together; server only, never Vercel `VITE_*` variables |
| `EVIDENCE_LEGACY_STORAGE_PROVIDER` | Backend host config | Optional `local` or `s3` fallback only for pre-discriminator evidence records; S3 fallback requires its credentials |
| `EVIDENCE_S3_ENDPOINT`, `EVIDENCE_S3_BUCKET`, `EVIDENCE_S3_REGION`, `EVIDENCE_S3_ACCESS_KEY_ID`, `EVIDENCE_S3_SECRET_ACCESS_KEY` | Backend host secrets/config | Retain only while existing S3 evidence references need access; bucket stays private |
| `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED`, `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET` | One-shot operator CLI environment only | Explicitly enable with a fresh 32+ byte secret for the CLI invocation; never set on the long-running API host |

The API key embedded in some RPC endpoint URLs is also a secret. Keep it in
the backend host's secret store, restrict it to the selected chain and
operations where supported, and never log the full URL.

## MongoDB Atlas and safe initial setup

The application depends on MongoDB replica-set transactions: account setup,
governance decisions, quotation/project changes, audit writes and evidence
metadata span multiple documents. Use an Atlas replica-set deployment and
confirm transaction support before relying on it. A standalone MongoDB server
is not compatible with these workflows.

For a **new, empty production database** (this task did not create or connect
to one):

1. Create a separate Atlas project and fresh database name; do not reuse
   `nivaas`, `nivaas_demo`, `nivaas_test` or a developer's Atlas cluster.
2. Create a dedicated least-privilege database user scoped to that database.
   Configure TLS by using Atlas's driver URI. Allow only the backend host's
   outbound IPs where the host makes these available; do not leave a permanent
   `0.0.0.0/0` database access rule.
3. Put the URI only in backend `MONGODB_URI`. Verify the database name,
   Atlas user, network path and replica-set connection before inviting users.
4. Use `nivaas_college_demo_2026` as the proposed database name for a fresh,
   synthetic-data college demo. It is distinct from the protected `nivaas`,
   `nivaas_test`, and `nivaas_demo` names. Confirm ownership/retention and
   Atlas cluster selection before creating it. Configure a dedicated database
   user scoped only to this database. The migration operator needs permissions
   to inspect collections and create collections/indexes; the backend runtime
   still needs its normal application read/write privileges. Keep TLS enabled
   and verify Atlas reports replica-set transaction support.
5. Production Mongoose automatic collection creation (`autoCreate`) and
   automatic index creation (`autoIndex`) are both disabled. Model registration
   during API startup therefore cannot create collections or indexes; production
   schema changes are controlled by the explicit migration. Run the
   versioned migration against the new empty database before starting normal
   backend traffic. It creates indexes declared by the currently registered
   API models and records completion in `_nivaasMigrations`. It does not seed
   records, rewrite documents, drop indexes, or create a fictitious historical
   baseline. A unique-index duplicate failure is actionable and fails closed;
   indexes completed earlier in a failed run remain and are safe to recheck on
   retry. Existing incompatible indexes stop the migration without being
   dropped. Migration selection requires `NODE_ENV=production`, an exact
   `NIVAAS_MIGRATION_DATABASE_NAME` matching `MONGODB_URI`, and the same name
   explicitly present in `NIVAAS_MIGRATION_ALLOWED_DATABASES`. The command
   rejects protected and `nivaas_disposable_*` names before connecting.
Production backend startup also refuses readiness while the migration is
pending or a declared index is missing/conflicting; local/test startup is
unchanged.
6. Do not run `migrate:building-code-index` against Atlas. Its existing guard
   explicitly accepts only a confirmed loopback `nivaas_disposable_*`
   database and remains unchanged. The production index runner refuses a
   conflicting legacy Building index; populated-database transition requires
   a separately reviewed, backed-up migration and is not implemented here.
7. Take a verified backup/snapshot before applying migrations to any database
   with records. There is no automatic index rollback: created indexes are
   not dropped on failure, and an index already in use may be required for
   correctness. Recovery is forward-only after resolving duplicate data or
   index conflicts under an approved operator plan. Atlas Free backup and
   restore capabilities must be confirmed directly before real data is used.

Atlas describes Free clusters as a small-scale development environment and
lists its limits in [Atlas Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
MongoDB's transaction guidance requires a replica set or sharded deployment;
see [Transactions](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

There is no production seed or initial-System-Admin provisioning command.
`bootstrap:local-admin` is restricted to the loopback `nivaas_demo` database.
Do not create an administrator by directly inserting a record; that would
bypass credential setup and audit behavior. Resolve and implement the
approved operator-controlled first-admin process and secure setup-credential
delivery before production onboarding.

### Production index command

The new command is explicitly opt-in and does not run on backend startup:

```powershell
# Supply NODE_ENV=production, MONGODB_URI, and the exact migration name and
# allowlist in an operator-only shell/secret context. Do not save a populated
# migration environment file in Git or attach these values to the runtime host.
npm.cmd run db:migrate --workspace=@nivaas/backend -- --status
npm.cmd run db:migrate --workspace=@nivaas/backend -- --dry-run
npm.cmd run db:migrate --workspace=@nivaas/backend -- --apply
```

`--status` reads the migration ledger. `--dry-run` checks existing schema
indexes (including drift after a prior apply) and lists missing indexes. Both
connect with `autoCreate: false` and `autoIndex: false`, register schema models
only after those settings are active, and perform no collection, index, or
ledger writes. Only `--apply` writes migration state: it creates the ledger
index, declared indexes, and the successful migration record. The runner refuses
unknown or out-of-order ledger entries. Its first migration is
`20261026_01_declared_indexes_v1`: on the database where it is actually run, it
checks/creates all schema-declared indexes from the explicit registry of 36
persisted Mongoose models (66 declared indexes, including 18 unique indexes
and one TTL index).
Unique indexes enforce account identity, per-society and per-building records,
single votes/decisions, quotation and governance versioning, refresh/setup
credential uniqueness, and proof-operation uniqueness. Lookup indexes support
society/project/user, lifecycle, audit, evidence, and workflow queries. The
AuthSession expiry index is TTL cleanup only; renewal checks absolute expiry
in application logic and does not depend on asynchronous TTL deletion. MongoDB
replica-set support is required by multi-document transactions, not by index
creation itself.

No migration is executed by this task. For an existing populated database,
first take/verify a restorable backup, run status and dry-run, inspect actual
indexes and duplicate data, then approve a database-specific plan. Do not label
indexes already present before runner adoption as a fabricated migration
history: the ledger is written only after this runner successfully validates
and applies the versioned step. Future index changes require a new ordered
migration; never edit an already-applied migration to represent a different
historical operation.

The non-secret migration variable names and proposed database target are in
`deployment/migration.env.example`; it intentionally contains no URI. Supply
the actual URI only through the operator's approved secret mechanism, and
remove migration-only variables from the shell after the operation. Run only
one migration operator at a time for a given database.

## Private complaint, notice and project evidence

The `EvidenceStorage` interface is used by complaint, project-update and
notice evidence services. Non-production defaults to `LocalEvidenceStorage`,
which writes server-generated private files under
`backend/uploads/complaint-evidence`. New production deployments use the
official Cloudinary Node SDK through `CloudinaryEvidenceStorage`. It uploads
validated JPEG/PNG bytes server-to-server as `resource_type=image` and
`type=authenticated`, with a unique generated public ID and no unsigned upload
preset. Authenticated originals are delivered only through a short-lived
signed URL generated internally by the backend; the API streams bytes through
its existing authorization, integrity and private/no-store response path and
never returns that URL. Deletion uses the exact hidden public ID plus stored
resource/delivery type. Credentials are backend-only.

Cloudinary free accounts use a shared 25-credit monthly allowance for storage,
image bandwidth and transformations. The free plan currently limits individual
images to 10 MB and 25 megapixels; Nivaas enforces a stricter 5 MiB byte limit
and the same 25-megapixel dimension limit. Time-limited authenticated downloads use Cloudinary's
secure API delivery path without CDN caching; Cloudinary warns that this method
can consume twice the bandwidth compared with ordinary CDN delivery. Nivaas
also proxies bytes through the backend, so account for backend egress and
latency. Size/account limits and current plan terms must be checked before a
public demo. See [Cloudinary billing and plans](https://cloudinary.com/documentation/billing_and_plans),
[plan comparison](https://cloudinary.com/pricing/compare-plans),
[authenticated media access](https://cloudinary.com/documentation/control_access_to_media),
and the [Node upload guide](https://cloudinary.com/documentation/node_image_and_video_upload).

The prior `S3EvidenceStorage` adapter remains available for already stored
references and deployments that explicitly retain S3. Every newly written
record stores a hidden provider discriminator and, for Cloudinary, asset ID,
image resource type, authenticated delivery type, format and version. Older
records without a discriminator use `EVIDENCE_LEGACY_STORAGE_PROVIDER` (or the
provider-derived default); when selecting Cloudinary for a database with old S3
records, keep `EVIDENCE_LEGACY_STORAGE_PROVIDER=s3` and all S3 credentials until
those records are migrated or retired. A single fallback cannot classify a
historical database that already mixes untagged local and S3 records; inventory
and migrate such records before switching providers.

The existing API download route authenticates and authorizes each request
before reading the object, then compares byte length and SHA-256 against
MongoDB metadata. Upload MIME/signature checks, the 5 MiB limit, hashes and
metadata are unchanged. The file write and Mongo transaction cannot be atomic;
known aborted transactions remove the object, while ambiguous commits retain
it for reconciliation. No object-store credentials are read by the frontend
or logged. Adapter tests use mocked SDK/fetch behavior. Neither Cloudinary nor
S3 has been connected or integration-tested from this repository.

Do not use the local adapter on Vercel/serverless or an ephemeral backend host:
deploys, restarts, scale-out and idle spin-down can lose the files. Cloudinary
is the selected durable provider for new production evidence. S3-compatible
storage remains an optional compatibility provider, not a new-deployment
requirement.

Existing local/S3 objects are not copied automatically when selecting
Cloudinary. Provider references are now stored per new record, but old records
need a compatible legacy-provider fallback or a separately planned,
integrity-checked copy and metadata update. Do not enable public upload presets
or make authenticated evidence assets public.

## First administrator and account onboarding

Run `npm.cmd run bootstrap:initial-admin --workspace=@nivaas/backend` only
from a trusted interactive operator terminal after Atlas setup and the
production index migration. For that CLI process only, set
`NODE_ENV=production`, the normal backend connection/configuration required
by `connectDatabase`, `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED=true`, and a
fresh `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET` with at least 32 bytes. The CLI
refuses piped/CI input/output, reads the authorization secret without echo,
requires typed confirmation, and verifies the secret before opening MongoDB.
It creates a `PENDING_SETUP` platform account, stores only a hash of the
generated one-time setup credential, and records a transactional singleton
claim. It refuses an existing System Admin or prior claim; the unique claim
handles concurrent invocations. The long-running API refuses to start if the
bootstrap flag is enabled. Remove both bootstrap variables after the command;
deliver the credential privately to the administrator, who completes the
existing `/auth/setup` flow. The raw credential is never returned by an API,
stored in cleartext, or recoverable after the CLI exits.

There is no external email/SMS integration. Routine Society Manager/member
creation and setup-credential reissue therefore fail closed in production.
Before a multi-account cloud demo, choose and review a delivery mechanism or a
controlled operator workflow for these additional accounts. A college demo
can use the one-off first-admin path, but must not claim routine onboarding is
available until that decision is implemented.

## Blockchain and wallet deployment gate

The existing Solidity 0.8.28 `GovernanceProofRegistry` stores opaque record
references, versions and hashes. It does not store ballots or full records.
The current Hardhat configuration defines only localhost chain `31337`, and
`blockchain/scripts/deploy.ts` refuses every network except localhost. The
backend config and `EthersGovernanceProofRegistryClient.validateDeployment`
also require chain `31337` and loopback HTTP RPC. As a result, the deployment
templates intentionally leave public-chain values unset. No public-testnet
deployment is currently possible by changing environment variables alone.

Before testnet deployment, resolve the network/chain and operator/submitter
authorization mapping in the controlled specifications, plus custody and
rotation of the backend proof signer. Then separately implement and test:

1. Explicit Hardhat RPC/chain config for the selected testnet and fail-closed
   chain-id checks in the deployer and backend client.
2. A deployment flow that uses a dedicated, funded **testnet-only** deployer,
   records the exact network, chain ID, contract address, deployment tx/block
   and ABI artifact, and verifies deployed bytecode/receipt and authorized
   submitter status. Keep the generated deployment record and key out of Git.
3. A recorded verified deployment address/ABI and a real proof round trip:
   submit one permitted audit proof, wait for its actual receipt, then read
   and verify the exact proof. Never report confirmation based only on a
   submitted hash or frontend state.
4. Monitoring for RPC outages, gas/funding limits, ambiguous transaction
   outcomes and key rotation. Keep the MongoDB audit record authoritative.

MetaMask appears in architecture decisions as wallet interaction “where
required”, but the current frontend has no `window.ethereum`/MetaMask
integration. The implemented proof path is a backend ethers `Wallet` using
`BLOCKCHAIN_SIGNER_PRIVATE_KEY`, not a resident's wallet. Do not substitute
MetaMask signing for that backend flow without an approved design change.
The controlled implementation decision currently says to begin locally and
not introduce public deployment during initial application development;
revise it through change control before enabling testnet work.

## Pre-launch checklist

### Ordered synthetic-data college demo checklist

1. Create Atlas database `nivaas_college_demo_2026` in a new/approved project;
   configure TLS, a database-scoped least-privilege user, restricted network
   access, replica-set transactions, and a tested backup/restore path.
2. From a restricted operator shell, set migration-only target/allowlist
   variables, run `--status` and `--dry-run`, review the plan, then explicitly
   run `--apply`. Do not run `migrate:building-code-index` against Atlas.
3. Configure a Cloudinary account and set
   `EVIDENCE_STORAGE_PROVIDER=cloudinary` plus
   `EVIDENCE_CLOUDINARY_CLOUD_NAME`, `EVIDENCE_CLOUDINARY_API_KEY`, and
   `EVIDENCE_CLOUDINARY_API_SECRET` in backend secrets only. Smoke test
   authenticated upload/download authorization, integrity and cleanup before
   adding evidence. No provider connection has been tested yet.
4. Select a backend host. A sleeping free tier is only suitable for a
   non-critical preview; Cloudinary prevents evidence loss from ephemeral
   disks, but does not remove availability or plan-limit constraints.
5. Configure backend secrets/settings (`MONGODB_URI`, `CORS_ORIGIN`, `JWT_SECRET`,
   access/refresh TTLs, `EVIDENCE_STORAGE_PROVIDER=cloudinary`, and the
   backend-only Cloudinary settings in the host secret store with
   `NODE_ENV=production`. Run the first-admin CLI
   from a trusted operator terminal with the temporary bootstrap variables;
   verify setup and remove those variables. Decide how additional demo
   accounts will receive one-time credentials before attempting manager/member
   onboarding.
   Configure Vercel at monorepo root with the existing `vercel.json`, set only
   public `VITE_API_BASE_URL` to the backend HTTPS API origin, then set backend
   `CORS_ORIGIN` to that exact deployed frontend origin. Keep preview origins
   separate and explicit.
6. Against staging synthetic accounts, verify login, expired-access renewal,
   per-session logout, refresh revocation, role boundaries, society scoping,
   transaction-backed workflows, evidence authorization/integrity and health.
   Public testnet is optional for a UI/data demo; current proof support is local
   Hardhat chain 31337 only and MetaMask is not implemented.

### Additional gates before real society data

- [ ] Choose a host with production availability and durable private evidence;
  implement/test the object-storage adapter if private persistent disk is not
  guaranteed.
- [ ] Confirm Atlas backup/restore and retention with a real recovery drill;
  Atlas Free is a development sandbox and should not be assumed to meet this.
- [ ] Approve security/operations controls: account provisioning and delivery,
  least privilege, rate limiting/abuse response, monitoring, incident response,
  privacy retention and support access.
- [ ] Confirm the society's registered governance rules and applicable legal
  workflow; repository defaults are not legal compliance certification.
- [ ] Resolve and separately implement/verify public testnet and signer custody
  only if blockchain proofs are required. MetaMask is not currently available.

## Local verification commands (no remote services)

From the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run blockchain:compile
npm exec --workspace=@nivaas/blockchain -- node scripts/compile.cjs test
```

These commands compile and test local code only. Do not run the MongoDB
integration suite or migration command as part of deployment preparation; the
integration tests require an explicitly disposable local replica-set database.
