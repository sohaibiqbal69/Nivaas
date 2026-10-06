# Nivaas Engineering Handoff

**Repository inspected:** 2026-10-02
**Branch / HEAD:** `main` / `795384afc95b026e77bbafe447f34d9ed5fe2012`
**Source of truth:** the repository at that commit plus the explicitly listed uncommitted local MongoDB test-infrastructure work.

This handoff describes files actually present. Documentation-only designs and API proposals are labeled as planned; they are not evidence that their implementation exists.

## 1. Project Identity

Nivaas is a blockchain-assisted digital governance and transparency platform for housing societies. It is intended to make society projects, budgets, quotations, meetings, resolutions, voting, evidence, payments, and historical decisions easier to administer and verify. Its academic/prototype scope includes governance complexity, configurable society rules, historical snapshots, immutable audit records, and selected blockchain integrity proofs.

The project is a TypeScript modular monolith: a React/Vite frontend, an Express API/backend, MongoDB through Mongoose, and a separate Solidity/Hardhat workspace. The frontend presents information and calls the backend. The backend is intended to own authentication, authorization, business rules, persistence, and blockchain coordination. MongoDB is the application system of record. Blockchain is a selective proof/integrity layer; it does not decide governance outcomes, replace the database, establish a real-world event's truth or legality, or hold full audit records, personal information, files, or individual votes.

At present, the only implemented frontend feature is the application shell and honest empty-state dashboard. The backend implements health, login, and user read endpoints plus core Mongoose models and the AuditLog hashing foundation. Most documented domain workflows remain planned. Hardhat is configured, but there is no Nivaas Solidity contract.

## 2. Current Architecture

| Area | State | Actual implementation |
|---|---|---|
| Frontend | **Implemented foundation** | React 19/Vite/TypeScript shell, responsive navigation, dashboard, placeholders for documented modules, local UI primitives, CSS theme tokens. No API calls or business state. |
| API / HTTP | **Implemented foundation** | Express app, JSON parser, CORS middleware, `/api` router, structured API errors, unknown-route handler, health endpoint. Only login and user reads are feature routes. |
| Business logic | **Small implemented slice** | AuthenticationService handles password login. User retrieval authorization is in its route handler. No approval, project, governance, voting, payment, or other domain services. |
| Data access | **Implemented models; otherwise limited** | Mongoose model definitions exist for core society/property/membership/committee records and AuditLog. Authentication and user read routes query Mongoose directly. No general repository/service framework. |
| MongoDB | **Implemented connection foundation** | `connectDatabase()` delegates to `mongoose.connect()`. Server attempts connection at startup if `MONGODB_URI` exists. Health returns 503 when disconnected. Local Docker replica set is configured and currently running (see §11). |
| Authentication | **Implemented** | Node `scrypt`, JWT via `jose`, Bearer-token middleware, persisted current-user loading for protected routes, ACTIVE-status enforcement. Login only; no registration/setup/refresh/logout implementation. |
| Authorization | **Implemented foundation** | Current-user context, `requireRoles`, same-society primitive. User read routes implement documented endpoint-specific role/society behavior. No general permission engine or module business authorization. |
| Audit | **Integrity foundation implemented** | Immutable Mongoose AuditLog schema and canonical hash generation/validation. No audit writer/service, middleware, read API, or business-event integration is present. |
| Blockchain | **Scaffold only** | Hardhat/ethers configuration and compile wrapper. No contract, backend blockchain client, transaction service, or wallet interaction. |
| File storage | **Planned only** | Architecture docs describe an off-chain storage boundary. No upload API, storage adapter, or file persistence code exists. |
| Testing | **Implemented unit/API tests** | Vitest backend tests use injected repositories/in-memory fixtures; Mongoose schemas are validated in memory. No existing Mongo-connected integration tests. Playwright is configured but no e2e test exists. |
| Docker/development | **Implemented local database infrastructure, currently uncommitted** | `compose.yaml` starts one MongoDB `rs0` replica-set service with a named data volume. Application/frontend are not containerized. A helper and scripts prepare future transaction integration tests, but there are no such tests yet. |

The intended architecture in `docs/ARCHITECTURE.md` is broader than the code. Treat diagrams and suggested module lists as **PLANNED**, not implemented services.

## 3. Exact Repository Tree

Generated/dependency directories (`node_modules`, `dist`, Hardhat artifacts/cache, `.git`, and local `.hardhat-user-data`) are omitted. The six uncommitted files from the current MongoDB infrastructure checkpoint are included. `NIVAAS_ENGINEERING_HANDOFF.md` is the one file this task adds.

```text
Nivaas/
├── AGENTS.md
├── NIVAAS_ENGINEERING_HANDOFF.md              # added by this handoff task
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── skills-lock.json
├── playwright.config.ts
├── compose.yaml                                # untracked before this handoff
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── BLOCKCHAIN.md
│   ├── BUSINESS_RULES.md
│   ├── DATABASE.md
│   ├── IMPLEMENTATION_DECISIONS.md
│   ├── SRS.md
│   ├── UI_UX.md
│   └── VERSIONING.md
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── components.json
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── styles.css
│       ├── lib/utils.ts
│       ├── routes/navigation.ts
│       ├── pages/DashboardPage.tsx
│       ├── pages/ModulePlaceholderPage.tsx
│       ├── components/layout/AppShell.tsx
│       ├── components/layout/Brand.tsx
│       ├── components/layout/SidebarNavigation.tsx
│       └── components/ui/{badge,button,card}.tsx
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/{database,environment}.ts
│   │   ├── lib/api-error.ts
│   │   ├── middleware/
│   │   │   ├── {cors,error-handler,load-current-user,not-found,require-roles,society-isolation}.ts
│   │   ├── routes/{health,index}.ts
│   │   ├── modules/auth/
│   │   │   ├── {auth-routes,authentication-middleware,authentication-service,jwt,password}.ts
│   │   │   └── types/express.d.ts
│   │   ├── modules/users/user-routes.ts
│   │   ├── modules/users/models/User.ts
│   │   ├── modules/society/models/{Society,SocietyRuleVersion}.ts
│   │   ├── modules/property/models/{Building,Flat,Ownership,Residence}.ts
│   │   ├── modules/membership/models/Membership.ts
│   │   ├── modules/committee/models/{Committee,CommitteeMember}.ts
│   │   ├── modules/audit/{audit-log-hashing.ts,models/AuditLog.ts}
│   │   ├── blockchain/.gitkeep
│   │   ├── config/.gitkeep
│   │   ├── data/.gitkeep
│   │   └── modules/.gitkeep
│   └── tests/
│       ├── api.test.ts
│       ├── authentication.test.ts
│       ├── authorization.test.ts
│       ├── audit-log.test.ts
│       ├── models.test.ts
│       ├── users.test.ts
│       └── integration/mongodb-test-database.ts   # untracked helper; not a test
├── blockchain/
│   ├── package.json
│   ├── tsconfig.json
│   ├── hardhat.config.ts
│   ├── scripts/compile.cjs
│   └── contracts/README.md                       # no Solidity contract present
└── tests/e2e/.gitkeep                            # no Playwright tests present
```

## 4. Technology Stack and Dependencies

Declared package ranges are from workspace manifests. “Installed” is the `npm ls --depth=0` snapshot at handoff time; installed patch versions can differ from manifest ranges because ranges use `^` and the lockfile resolves them.

| Technology | Declared / installed version | Use and status |
|---|---|---|
| Node.js | README requires 22+; installed `v22.20.0` | Frontend/backend tooling and scripts. |
| npm | README requires 10+; installed `10.9.3` | Root npm workspaces. |
| TypeScript | `^5.9.2` / `5.9.3` | Frontend and backend; also Hardhat config. |
| React / React DOM | `^19.1.1` / `19.3.0` | Implemented frontend shell. |
| Vite / React plugin | `^7.1.7` / `7.3.6`; plugin `^5.0.2` / `5.2.0` | Frontend dev/build. |
| Tailwind CSS | `^4.1.13` / `4.3.3` | Frontend styling; Tailwind Vite plugin is used. |
| shadcn/ui | No shadcn package declared | `components.json` and hand-maintained local button/card/badge primitives follow shadcn conventions; it is not an installed runtime framework. |
| React Router | `^7.9.1` / `7.18.4` | Implemented shell routes/placeholders. |
| Anime.js | `^4.1.3` / `4.5.0` | Declared/installed, but no current frontend source import/use was found. |
| Express | `^5.1.0` / `5.2.1` | Backend HTTP server and routes. |
| Mongoose | `^8.18.1` / `8.24.4` | Backend models and MongoDB driver access. |
| MongoDB Node driver | lockfile `6.20.0` | Installed transitively through Mongoose. |
| MongoDB server | Compose tag `mongo:8.0`; running server reported `8.0.32` | Local development/test database only. The `8.0` image tag may resolve to a later 8.0 patch over time; no production server version is specified. |
| Docker / Compose | Installed runtime reported Docker `29.8.1`, Compose `v5.5.1` | Runs the local MongoDB container only. |
| `canonicalize` | exact `5.1.0` | RFC 8785/JCS step of AuditLog hashing. Backend dependency. |
| ethers.js | `^6.15.0` / `6.17.0` | Backend Ethereum Keccak-256 hash function; also declared in frontend and blockchain workspaces. No browser wallet or transaction flow is implemented. |
| `jose` | `^6.2.12` / `6.2.12` | JWT issue/verification. |
| Vitest | `^3.2.4` / `3.2.7` | Frontend/backend test runner. |
| Playwright | `^1.55.0` / `1.63.0` | Root e2e tooling/configuration; no e2e specs currently exist. |
| Solidity / Hardhat | Solidity `0.8.28`; Hardhat `^2.26.3` / `2.29.1` | Blockchain workspace compile foundation only; no Nivaas contract. `@nomicfoundation/hardhat-ethers` is installed. |
| scrypt | Node built-in `crypto` | Password hashing; no separate password-hashing package. |
| dotenv | `^16.6.1` / `16.6.1` | Backend environment loading and integration helper. |
| Other frontend packages | See `frontend/package.json` | Fontsource packages for Space Grotesk/Syne/JetBrains Mono, Lucide icons, `clsx`, `tailwind-merge`, and class-variance-authority support the current shell/primitives. |

`npm ls --depth=0` also reports workspace type packages and `jsdom`; see the manifests and lockfile for the authoritative complete dependency inventory. No dependency is added by this handoff.

## 5. Environment Setup

The repository README requires Node.js 22+ and npm 10+. Docker Desktop is required for the local MongoDB replica set. MongoDB is the only Compose service; the frontend and backend run directly on the host.

From a fresh clone:

```sh
npm install
copy .env.example .env              # PowerShell; use cp on Unix-like shells
docker compose up -d mongodb
docker compose ps
npm run typecheck
npm test
npm run dev:backend
npm run dev:frontend
```

The two dev commands are separate processes. The backend listens on port 4000 by default; Vite uses port 5173. Backend normal application connection uses `MONGODB_URI` and database `nivaas`. The transaction-test URI points to the separate `nivaas_test` database. The replica set is called `rs0` and exists to support MongoDB multi-document transactions, which standalone MongoDB does not provide.

Current Compose details:

- File: root `compose.yaml` (untracked at inspection before this handoff).
- Service: `mongodb`; official Mongo image tag `mongo:8.0`.
- Command enables `mongod --replSet rs0 --bind_ip_all`.
- Host port: `27017` mapped to container port `27017`.
- Persistent named volume: `nivaas-mongo-data` mounted at `/data/db`.
- Health check attempts `rs.status()` and initializes `rs0` with one member at `127.0.0.1:27017` if not initialized.
- At inspection, container was healthy and its only member reported `PRIMARY`.
- No app container, Redis service, or other service is defined.

Useful commands:

```sh
docker compose up -d mongodb
docker compose ps
docker compose exec mongodb mongosh --quiet --eval "rs.status().members.map(m => ({name:m.name,stateStr:m.stateStr}))"
npm run test:integration
npm run typecheck
npm run build
npm test
npm run blockchain:compile
npm run test:e2e
```

At this handoff, `npm run test:integration` exits with Vitest “No test files found”: the helper exists, but no integration test has been written. `npm run test:e2e` likewise has no Playwright test file. To test an integration later, it must explicitly use the helper and `MONGODB_TEST_URI`; it must not silently fall back to an in-memory/disconnected mode.

## 6. Environment Variables

The variables below are referenced by code/configuration or currently exposed by `.env.example`. No secret values are included here.

| Name | Required? | Safe example / default | Purpose |
|---|---|---|---|
| `PORT` | Optional | `4000` (default) | Backend HTTP listen port; validated to 1–65535. |
| `MONGODB_URI` | Optional to start process; necessary for database operations | `mongodb://127.0.0.1:27017/nivaas` | Normal application MongoDB URI. Missing/broken DB causes database requests to be unavailable; server logs warning/failure but can listen. |
| `MONGODB_TEST_URI` | Required only for Mongo integration helper/tests | `mongodb://127.0.0.1:27017/nivaas_test?replicaSet=rs0` | Test helper requires database name exactly `nivaas_test`, replica set `rs0`, and a writable primary. Not read by normal app configuration. |
| `CORS_ORIGIN` | Optional | `http://localhost:5173` | Exact allowed frontend origin for basic development CORS. |
| `JWT_SECRET` | Optional in env parsing; required to login/verify JWT | Empty placeholder in example; locally provide a unique random secret of at least 32 characters | HMAC key for HS256 JWT. Runtime JWT helper rejects a UTF-8 key shorter than 32 bytes. Never put a real secret in Git. |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Optional in env parsing; auth service requires configured value | `900` | Positive integer access-token lifetime. |
| `CI` | Optional | unset locally | Playwright config enables `forbidOnly`, retries, and no existing-server reuse based on this value. |

The Hardhat compile wrapper internally sets `APPDATA`/`LOCALAPPDATA` to an ignored repository-local directory. Those are not project `.env` requirements. `.env.example` is at repository root; `backend/.env.example` is absent.

## 7. Database Architecture

MongoDB is the authoritative store. There are **11 implemented Mongoose models** and matching explicit collection names:

| Collection / model | Implemented shape and important rules | Indexes / timestamps |
|---|---|---|
| `societies` / Society | Society name and registration/contact/address/configuration fields, active rule reference, financial-year dates, status. | Mongoose timestamps; no custom index. |
| `societyRuleVersions` / SocietyRuleVersion | Society reference, version number, status/effective dates, opaque rule configuration objects, creator User reference. No formulas evaluated by model. | timestamps; unique `{societyId, versionNumber}` and `{societyId,status}`. |
| `users` / User | `societyId`, name, email, phone, `passwordHash`, role, walletAddress, status. Roles finite: `SYSTEM_ADMIN`, `SOCIETY_MANAGER`, `COMMITTEE_MEMBER`, `OWNER_MEMBER`, `RESIDENT`. `societyId` required except role-dependent behavior for SYSTEM_ADMIN; passwordHash is `select:false`. | timestamps; non-unique `{email:1}` and `{societyId:1}`. **Email uniqueness is documented, but current index is not unique.** |
| `buildings` / Building | Society reference, name/code/address/floors/status. | timestamps; `{societyId:1}`. |
| `flats` / Flat | Society and Building refs, flat number/floor/type/status. No ownerIds/residentIds. | timestamps; society/building indexes. |
| `ownerships` / Ownership | Separate Society–Flat–User relationship, ownership type/order/status/date range. | timestamps; `{flatId:1}`, `{userId:1}`. |
| `residences` / Residence | Separate Society–Flat–User occupancy relationship, occupancy type/status/date range. | timestamps; `{flatId:1}`, `{userId:1}`. |
| `memberships` / Membership | Separate User–Society relation, membership type/status/number/order, associated flat refs, validity dates. | timestamps; society/user and society/status indexes. |
| `committees` / Committee | Society ref, name, term dates, status. | timestamps; society index. |
| `committeeMembers` / CommitteeMember | Committee–User refs, position/status, membership dates. No elections. | timestamps; committee/user indexes. |
| `auditLogs` / AuditLog | Immutable event fields and fixed record hash; details in §9. | No Mongoose timestamps; only `societyId` and compound `entityType + entityId` indexes. |

All Society/Property/Membership/Committee models use Mongoose `timestamps:true`. Flat does not duplicate ownership or residence; relationship collections are authoritative. User role does not encode property, residence, membership, committee, or voting eligibility.

**Documented but not implemented model:** `AccountSetupCredential`, collection `accountSetupCredentials`, with user ref, credential hash, creation/expiry/consumption timestamps and unique hash index. No schema/model exists in source today.

Important persistence mismatch for the next setup phase: docs say a `PENDING_SETUP` User has no password hash until setup, but `User.ts` currently marks `passwordHash` required. No schema/model transition has yet reconciled this.

## 8. Authentication and Authorization

### Authentication

- `password.ts` uses Node `crypto.scrypt`: N=32768, r=8, p=1, random 16-byte salt, 64-byte derived key, 64 MiB max memory. Persisted encoding is `scrypt$N$r$p$saltHex$keyHex`; verification uses timing-safe equality.
- `POST /api/auth/login` finds email, selects `+passwordHash`, performs a dummy scrypt verification for unknown users, then gives the same generic 401 for unknown email, wrong password, or non-ACTIVE status.
- Only persisted `ACTIVE` users get a token. Pending/disabled normal login is rejected. Response returns `_id`, `societyId`, name, email, role, plus token; no passwordHash.
- JWT is `jose`, HS256, with `sub=userId`, `iat`, and `exp`. There is no refresh token, server-side session, revocation list, or logout implementation.
- Authentication middleware reads a strict Bearer token, verifies HS256, and attaches `{userId}` as `request.auth`.
- Protected routes then run `loadCurrentUser`: reloads the persisted user and role/society context, rejects missing or non-ACTIVE account with 401, rejects invalid role or invalid society-scoped account state, and attaches a minimal `request.currentUser`.
- Therefore a JWT by itself does not override persisted disabled/pending status.

### Roles, society scope, and routes

`SYSTEM_ADMIN` is platform-wide and can have null societyId. Other four roles require societyId. It has no automatic society membership or governance rights. `requireRoles` checks only explicit application role; it is not an authorization engine. `assertSameSociety`/`requireSameSociety` do not grant a hidden platform-admin bypass; the helper rejects SYSTEM_ADMIN for a same-society check, so platform capability must be explicitly implemented by a route.

Actual user read permissions:

- `GET /api/users`: authenticated, persisted current-user loaded, SYSTEM_ADMIN only; returns all users platform-wide.
- `GET /api/users/:id`: SYSTEM_ADMIN platform-wide; manager/committee member same society; owner/resident only own profile. Cross-society requests are forbidden.
- Explicit serializer permits only `_id`, `societyId`, name, email, phone, role, walletAddress, status, createdAt, updatedAt. Raw documents and authentication fields are not returned.
- There is no `GET /api/auth/me`, user creation, profile update, role/status administration, setup, password reset, or registration route, even where API docs specify/planned them.

### Security tests

Tests cover password hashing/login generic errors, valid/invalid/expired JWTs, inactive-status enforcement including previously issued tokens, role restrictions, society isolation/no SYSTEM_ADMIN bypass, user retrieval matrix, safe responses, and null-society SYSTEM_ADMIN login/context.

## 9. AuditLog Integrity Foundation

Implemented in `backend/src/modules/audit/models/AuditLog.ts` and `audit-log-hashing.ts`; no API writer exists yet.

### Schema and immutability

AuditLog has exactly `_id`, `societyId`, `actorId`, `action`, `entityType`, `entityId`, `correctsAuditLogId`, `previousState`, `newState`, `metadata`, `ruleVersionId`, `hashVersion`, `recordHash`, `blockchainTransactionHash`, and `createdAt`. Timestamps are disabled, there is no `updatedAt` or version key, unknown fields throw, nested state/metadata values must be BSON/plain document or null. The only indexes are society and entity type+entity ID.

The schema uses immutable paths, blocks saving an existing document, and rejects update/replacement/deletion query operations (`updateOne/Many`, findOneAndUpdate/Replace, replaceOne, deleteOne/Many, findOneAndDelete, plus document deleteOne). `bulkWrite` rejects any non-insert operation; `bulkSave` tests confirm its updates are rejected through the bulk write path. Corrections are a new event with `correctsAuditLogId`; the original is unchanged.

These are Mongoose/application-layer protections. A direct MongoDB driver write, shell/admin action, or other path that bypasses Mongoose middleware is not stopped by this schema; database credentials/operations must remain protected. It is not a MongoDB server-level immutable collection.

`_id` is allocated by Mongoose on construction. On first validation the model overwrites caller-supplied `createdAt` with current time, preserving it for later validations. The hash is calculated in pre-validation after ID/time exist and stored on the initial document before first persistence. `createdAt` is required and immutable; no `updatedAt` exists.

### Version-1 canonical hash

`hashVersion` is BSON Int32 `1`, immutable, and describes the Nivaas hashing protocol rather than a society rule version. Top-level hashed-field order is explicitly:

```text
hashVersion, _id, societyId, actorId, action, entityType, entityId,
correctsAuditLogId, previousState, newState, metadata, ruleVersionId,
createdAt
```

The implementation builds ordered `[field,value]` pairs; absent optional fields are omitted, explicit null is retained. The pipeline is:

```text
ordered immutable fields
→ BSON Canonical Extended JSON v2 (relaxed:false)
→ RFC 8785 JCS (`canonicalize` package)
→ UTF-8 bytes
→ Ethereum Keccak-256 (`ethers` keccak256; not FIPS SHA3-256)
→ lowercase `0x` + 64 hex characters
```

`recordHash` itself, `blockchainTransactionHash`, and later blockchain proof/transaction state are excluded. ObjectIds use Extended JSON `$oid`; dates use Extended JSON UTC epoch-millisecond semantics. Nested object keys are canonicalized, arrays retain order, strings are not business-normalized, and finite BSON numeric subtypes remain distinct. Non-finite values and unsupported hashable BSON values are rejected. The JCS/BSON mapping is designed for independent reconstruction; `_id` participates, while a correction commits to the referenced original ID without recursively hashing the original event.

MongoDB BSON decoding normally promotes numeric wrappers. AuditLog `find`/`findOne` middleware disables value/long promotion so persisted BSON subtype values can be fed into hash reconstruction. `Double(-0)` remains a BSON double and canonical EJSON distinguishes its negative-zero representation. This matters because the hash must verify after persistence/reload, not merely match in-memory values.

Tests exercise determinism/order, absent vs null/empty/falsy values, ObjectIds, UTC dates, strings, nested objects, array order, numeric subtypes and negative zero, BSON serialize/reload reconstruction, exclusions, every included field, correction refs, hashVersion, invalid hash format, createdAt generation, append-only updates/replacements/deletes and bulk operations.

Blockchain transaction association remains a separate planned tracking layer. The complete AuditLog stays off-chain; proof means integrity/existence of a commitment, not truth/legal validity. `blockchainTransactionHash` remains compatibility-only and not authoritative for later asynchronous transaction hashes.

## 10. Account Setup State

### Specified policy

The documentation specifies `POST /api/auth/setup` with `{credential,newPassword}`; a 32-byte cryptographically random URL-safe base64 one-time credential, associated with one User, hash-only persistence, and 24-hour expiry; minimum eight-character password using existing scrypt; only PENDING_SETUP eligible; generic 401 for invalid/expired/consumed/replayed credential or ineligible account; and HTTP 200 `{success:true,data:{}}` without token/secrets.

Success must atomically set the password hash, consume the credential, transition PENDING_SETUP→ACTIVE, and append the mandatory status-transition AuditLog with `previousState.status` and `newState.status`. No audit event is required for generation, consumption alone, or failure. Delivery provider and resend are outside the initial endpoint. Setup does not establish membership/property/governance eligibility.

### Actual implementation

**Not implemented.** `auth-routes.ts` contains only `/login`. There is no setup credential model/collection in code, no setup service, no setup route, no password setup test, and no account-creation (`POST /api/users`) route. No credential delivery exists.

Current User schema requires `passwordHash`, conflicting with documented pending accounts having no hash before setup; the setup checkpoint must reconcile this to the specification rather than seed a fake hash. The dedicated model is specified in docs but does not exist in source.

### Required atomicity and test status

The required logical transaction spans credential consumption, User update, and AuditLog insert. MongoDB must run as a replica set/sharded transaction-capable deployment. Docker `rs0` now runs locally and reports a primary. The integration helper is present, checks `MONGODB_TEST_URI` targets `nivaas_test`/`rs0`, checks `hello` for writable primary, provides collection cleanup and disconnect, and fails clearly on missing/unavailable DB.

There are **no Mongo-connected tests yet**. `npm run test:integration` currently exits non-zero with “No test files found.” Account setup is the natural next implementation checkpoint, with real replica-set tests for transaction rollback and concurrent token consumption. The documented account-creation API remains unimplemented; setup tests can seed their pending User and hashed credential directly rather than adding POST /users outside scope.

## 11. MongoDB Transaction Infrastructure

- Root `compose.yaml`: one service only, official `mongo:8.0`, `rs0`, port 27017, named volume, health check initializes replica set if needed.
- At inspection, `docker compose ps` showed `nivaas-mongodb-1`, image `mongo:8.0`, `Up (healthy)`, port mapping `27017`; `db.version()` returned **8.0.32**.
- Replica-set status returned one member `127.0.0.1:27017` with `stateStr: PRIMARY`.
- `.env.example` currently contains `MONGODB_TEST_URI=mongodb://127.0.0.1:27017/nivaas_test?replicaSet=rs0`; normal `MONGODB_URI` remains `.../nivaas`.
- `backend/tests/integration/mongodb-test-database.ts` is helper code, not a test file. It connects using existing `connectDatabase`, validates database/replica set and primary, deletes documents from non-system collections for cleanup, and exposes disconnect.
- Root and backend package scripts expose `npm run test:integration`; currently no matching specs, so this command fails “No test files found.”
- No npm dependency was introduced for replica-set transactions or test setup.

The replica set exists for correct transaction testing; **it does not containerize the Nivaas application**. The Mongo image is dev/test infrastructure, not a production Mongo version commitment.

## 12. API Inventory

Only routes registered in backend source are “implemented.” Paths below include the `/api` mount.

| Method | Path | Implemented? | Auth | Authorization | Purpose | Tested? |
|---|---|---:|---|---|---|---:|
| GET | `/api/health` | Yes | No | None | Reports 503 if Mongoose disconnected, otherwise process/database availability. | Yes; API foundation test checks disconnected response. |
| POST | `/api/auth/login` | Yes | No | Credentials; persisted status must be ACTIVE | Scrypt verification and JWT issue; generic login failure. | Yes; auth tests. |
| GET | `/api/users` | Yes | Bearer JWT + DB current-user load | SYSTEM_ADMIN only; platform-wide | Safe user list. | Yes; in-memory repository/injected middleware. |
| GET | `/api/users/:id` | Yes | Bearer JWT + DB current-user load | SYSTEM_ADMIN platform-wide; manager/committee same society; owner/resident self only | Safe user profile. | Yes; in-memory repository/injected middleware. |

Documented but **not implemented**: `POST /api/auth/setup`, `/api/auth/me`, logout, `POST /api/users`, user PATCH/status/role, society routes, and all building/property/membership/committee/budget/project/quotation/governance/meeting/voting/complaint/notice/payment/audit/blockchain APIs.

## 13. Test Inventory

Current `npm test` passed: **6 backend test files, 70 tests**; frontend Vitest reports no tests and succeeds due `--passWithNoTests`.

| File | Cases | Coverage | Database mode |
|---|---:|---|---|
| `backend/tests/api.test.ts` | 3 | Health disconnected error, unknown API 404, malformed JSON safe error. | Disconnected. |
| `backend/tests/authentication.test.ts` | 10 | Scrypt, login and safe user result, JWT issue/verify/malformed/expired, unknown email/wrong password/inactive status generic behavior. | Injected repository/in-memory HTTP. |
| `backend/tests/authorization.test.ts` | 13 | Current user, no/malformed auth, roles, society isolation, status recheck including old JWT after persisted status change, SYSTEM_ADMIN scope. | Injected repository. |
| `backend/tests/users.test.ts` | 17 | List/profile authorization matrix, cross-society, 404, safe fields/no secrets. | Injected repository. |
| `backend/tests/models.test.ts` | 8 | Core schema validation, enums, refs, timestamps, indexes, separate ownership/residence structure. | In-memory Mongoose validation. |
| `backend/tests/audit-log.test.ts` | 19 | Audit model, canonical hashing, BSON persistence simulation, and append-only guards. | In-memory model/BSON serialization; no Mongo server. |
| `backend/tests/integration/mongodb-test-database.ts` | Not a test | Connection/cleanup helper only. | No transaction assertion exists. |
| `tests/e2e/` | 0 | `.gitkeep` only. | No Playwright specs. |

Commands verified at handoff: `npm test` 70 passed; `npm run typecheck` passed; `npm run build` passed; Docker Compose config/health/replica-set status validated in the prior infrastructure correction. `npm run test:integration` was run and fails because no test files exist, not because a transaction test failed. No coverage thresholds/config are present.

## 14. Documentation Inventory

All are active planning/specification documents. They describe planned behavior in addition to implemented foundations; source code remains the test for actual current behavior.

| File | Version | Purpose / emphasis |
|---|---:|---|
| `docs/API.md` | 1.9 | API envelopes, auth, user contracts, planned module endpoints. Includes setup contract but route absent. |
| `docs/ARCHITECTURE.md` | 1.11 | Modular-monolith, subsystem boundaries, governance, audit, blockchain and transaction flows. |
| `docs/BLOCKCHAIN.md` | 1.4 | On-chain/off-chain boundary, proof meaning, canonical AuditLog hash and asynchronous tracking. |
| `docs/BUSINESS_RULES.md` | 1.9 | Roles, society rules, membership/governance separation, status lifecycle and setup policy. |
| `docs/DATABASE.md` | 1.12 | Documented entities/fields/indexes, AuditLog model/hash protocol, and not-yet-coded `AccountSetupCredential`. |
| `docs/IMPLEMENTATION_DECISIONS.md` | 1.10 | Approved stack/implementation decisions and explicit unresolved items. |
| `docs/SRS.md` | 1.9 | Requirement-level product behavior including setup, auth, governance, audit and blockchain. |
| `docs/UI_UX.md` | 1.1 | Planned modules, accessibility, Nivaas palette/typography, interface authority rules. |
| `docs/VERSIONING.md` | 1.0 | Source-of-truth hierarchy, requirement/spec change process and traceability. |

## 15. Git History / Completed Milestones

Chronological relevant commits from the current `main` ancestry:

| Commit | Message | Milestone / current status |
|---|---|---|
| `0662f4e80b40c9d0492901ef5b918c58fc27ae7a` | `chore: establish Nivaas project specification` | Initial specification set; ancestor of current main. |
| `3132c8c56eeeebd599f412b441bf0e2a6f1dac1e` | `docs: establish implementation decisions` | Stack/decision baseline. |
| `9673bd9837ee6df35b1aa9aae8beb1f45d08717c` | `chore: scaffold Nivaas application` | Workspace scaffold. |
| `d54fb13f48fdea2873a83c4d85eb4cdbf8f761ff` | `chore: complete project foundation` | Foundation fixes/configuration. |
| `4e0d018d09cbbb24580ed0f078a29a76eb87e2d5` | `feat: establish Nivaas application shell` | Frontend shell. |
| `e240c3f18cff8649ea59ccfedeadaf505079312f` | `feat: establish backend application foundation` | Express/Mongoose foundation. |
| `0ff10b525202055e97506f62459ca90db3c2933c` | `docs: clarify property realtionship ownership` | Separate ownership/residence documentation decision. |
| `bdde41a97528228cbcad9ffad6927e94f2d34753` | `feat: establish core domain data models` | Society/property/user/membership/committee Mongoose models. |
| `035bd61f39a9d78be8ff3b183a9e634d2c6c5184` | `feat: establish authentication foundation` | Scrypt/JWT login foundation. |
| `c5cb5f90c922a050873ee25a80ab0741bd670358` | `feat: establish authorization foundation` | Current-user, roles, society-scope primitives. |
| `d44ed1a762a2eb1887c305942f85a327bc5b8494` | `docs: define user account setup policy` | Early initial credential policy. |
| `5425f344102ac4652531fa488269b4c1b5755196` | `docs: define user profile update policy` | PATCH editable fields policy. |
| `fb18a3169be3d2b8f195e3dc5e22c95a00fd0b2c` | `docs: define user account status policy` | Statuses and lifecycle/access policy. |
| `b0e98d886b69b0ee3f6f7cfb55583c62b3fd5092` | `docs: define AuditLog foundation` | AuditLog principles/mandatory events. |
| `d6a56a617f62a72eadf4647fb2477a803d65b95c` | `docs: define audit blockchain proof association` | Async proof association, immutable original. |
| `ec74c02ee1974925ee1fd8a16510bc69bf45251e` | `docs: define AuditLog data model` | Exact documented fields/indexes. |
| `3dca8283d865e45f16b611768d5b649669130382` | `docs: define AuditLog canonical hashing` | Hash protocol and hashVersion. |
| `e21c45fe3fe8398f54bb7b9466db548a97443a2a` | `feat: implement audit log integrity foundation` | Model/hash/tests; present in HEAD. |
| `5d03bc92c9ced0762a3e9532eb3cc14b42839575` | `feat: align system admin platform scope` | Nullable platform admin society context; present in HEAD. |
| `a2c2d796c9553d71ffccfc9c91a2dfe94ecd8ef3` | `feat: implement user retrieval APIs` | GET users/profile; present in HEAD. |
| `63fd4ed06190a24169df3faed6955512ce52801e` | `feat: enforce active user account status` | Persisted ACTIVE status checks; present in HEAD. |
| `795384afc95b026e77bbafe447f34d9ed5fe2012` | `docs: define account setup policy` | Current HEAD; policy only, not code. |

The latest MongoDB Compose/helper/scripts work is **not committed** and therefore is not in the commit list above.

## 16. Current Git State

At inspection, `main` and `origin/main` both point to `795384afc95b026e77bbafe447f34d9ed5fe2012`; divergence is 0 ahead / 0 behind. Remote name is `origin` (`https://github.com/sohaibiqbal69/Nivaas.git`). The worktree is **not clean**.

Before this handoff file was created, status showed:

```text
 M .env.example
 M README.md
 M backend/package.json
 M package.json
?? backend/tests/integration/mongodb-test-database.ts
?? compose.yaml
```

Those are the local MongoDB transaction-test infrastructure changes from the preceding checkpoint; they are intentionally not committed. After creating this handoff, `NIVAAS_ENGINEERING_HANDOFF.md` is additionally untracked. No source code or documentation specification was modified for the Mongo checkpoint. Do not accidentally commit unrelated local work.

## 17. Known Unresolved Decisions

These come from current specifications; the list is not a license to guess.

### Governance / business rules

- Committee-majority formula; special-resolution majority and quorum.
- Detailed voting eligibility outcomes for joint, associate, and provisional members.
- Authority for changing governance-rule versions.
- Exact mapping/relationship of General Body and SGM terminology for each approval route.
- Project-completion authority and budget-overrun approval workflow.
- Society Manager’s full permissions and role-matrix details remain a baseline rather than a complete authorization engine.
- User status API request/response details are not defined in API docs; status semantics are documented.
- Singular `/society` route target selection for a platform-wide SYSTEM_ADMIN is unspecified; never trust client societyId as authorization.

### Account setup and account administration

- Setup credential hash algorithm and encoded representation; credential cleanup/retention.
- Whether disabling a pending account invalidates an unexpired credential and whether reactivation requires reissue.
- Future credential reissue/resend process; provider/delivery implementation.
- Forgot-password, email identity case/normalization, email verification, reauthentication, and notification behavior.
- Password rules beyond minimum eight characters.
- User creation (`POST /users`) and setup are documented but neither is implemented. These unresolved policies are not needed to invent a delivery provider or resend feature.

### Audit and blockchain

- Audit action-code/entity-type vocabulary and allowed metadata keys.
- Detailed semantics for system-generated audit actors; failed/denied security-event logging.
- How one action spanning multiple societies is represented.
- Legacy meaning/use of AuditLog `blockchainTransactionHash`.
- Blockchain logical-operation/transaction-tracking persistence model, retained chain/contract verification metadata, and API exposure of pending/failed proof states.
- Detailed AuditLog endpoint visibility/permissions.

The canonical AuditLog hashing protocol itself is specified and implemented at version 1; do not reopen it as part of setup implementation.

## 18. Known Technical Debt / Risks

1. **Pending-user schema mismatch:** docs require no password hash before setup; `User.passwordHash` remains `required: true`. This must be reconciled for valid PENDING_SETUP persistence.
2. **No account setup code:** no credential collection model, endpoint, transaction, or audit integration exists.
3. **No transaction integration test yet:** replica set and helper exist, but integration command finds no tests. Atomicity and concurrent one-time-token use are not tested.
4. **Email uniqueness mismatch:** docs require unique login email, but User schema currently defines a non-unique `{email:1}` index. Current GET behavior is unaffected, but future creation/update must not claim DB uniqueness from this index.
5. **Audit write integration absent:** hash/model exists, but there is no application service that creates mandatory status-transition events.
6. **Mongoose append-only limits:** guards are not MongoDB database-level immutability; privileged/direct driver writes bypass Mongoose middleware.
7. **Documented API exceeds implementation:** no auth/me, logout, setup, create/update/admin, society, governance, or other module endpoints.
8. **No frontend/backend API integration:** current dashboard placeholders are static honest content; no fetch use was found.
9. **No blockchain behavior:** Hardhat scaffold has no contract, and backend `.gitkeep` is not an integration.
10. **Integration test script currently exits 1:** until a matching `*.test.ts` exists in `backend/tests/integration/`, Vitest reports no test files.
11. **Mongo image tag is a major-line tag:** Compose uses requested `mongo:8.0`; the resolved patch can change on future pulls. At this inspection the container runs 8.0.32. This is local dev infrastructure, not a production compatibility declaration.

## 19. Development Rules for the Next AI

1. Read `AGENTS.md` first.
2. Read relevant current specifications before coding.
3. Never guess when specifications conflict or leave a material decision unresolved; stop and ask.
4. Work in small, reviewable implementation checkpoints.
5. Run relevant tests/checks before reporting completion.
6. Never weaken security, governance, immutability, or atomicity merely to make tests pass.
7. Explain and justify dependencies before adding any.
8. Do not change unrelated files or approved architecture.
9. Keep MongoDB authoritative and blockchain as a selective proof layer.
10. Documentation is an important source of truth, but distinguish it from implemented code.
11. Report changed files, commands/results, failures, deviations, and remaining issues.
12. Do not commit or push unless explicitly asked.

## 20. Complexity Philosophy

Nivaas is allowed to become technically sophisticated and feature-rich. Do not remove meaningful governance/versioning/audit/blockchain complexity simply because it is difficult. Equally, do not introduce abstractions without a real need. Significant mechanisms should be explainable in an academic presentation: each should have a clear functional, security, integrity, or architectural purpose. Prefer the easiest-to-explain correct design when alternatives preserve the same guarantees.

## 21. Recommended Next Checkpoint

The next logical implementation checkpoint is **initial account setup**, using the now-running transaction-capable replica set. This follows the committed setup policy and the transaction-infrastructure work; it is not already implemented.

Scope should be limited to the dedicated credential model, test fixture creation of a pending user/credential (not a public user-creation API), `POST /api/auth/setup`, scrypt password establishment, conditional single-use credential consumption, `PENDING_SETUP → ACTIVE`, required immutable AuditLog creation, and focused replica-set integration tests for rollback and concurrent credential use.

Before coding, inspect and reconcile the current User schema’s required passwordHash with the documented pending-user-without-hash invariant. Preserve `select:false` for passwordHash and existing scrypt behavior. The helper in `backend/tests/integration/mongodb-test-database.ts` is the intended connection/cleanup basis; use the separate `nivaas_test` database, never the application database. Existing unit/API tests should stay Mongo-disconnected.

Potential decision to clarify before implementation: the AuditLog action vocabulary is expressly open, while setup must create a mandatory status event; actor attribution for a credential-authenticated setup is also subject to the documented unresolved system-actor semantics. If current approved docs do not provide an event action/actor representation that the implementation can use without inventing vocabulary, ask rather than silently defining new audit policy.

Do not add `POST /users`, credential delivery, resend/reissue, email verification, password reset, token framework, or frontend setup UI in that checkpoint. No governance formulas are involved.

Likely affected files are `backend/src/modules/users/models/User.ts`, new auth credential model/service/route registration, AuditLog construction integration, focused unit and `backend/tests/integration/*.test.ts` tests, and possibly the package script only if test wiring requires it. Specifications already define the policy; do not change them to accommodate code.

## 22. Full Source Inventory

The repository tree in §3 is exhaustive for meaningful current source/configuration files. The table below explains responsibilities and coverage.

| Path | Purpose | Implemented | Test coverage |
|---|---|---:|---|
| `backend/src/app.ts` | Express middleware/router/error order. | Yes | API tests exercise. |
| `backend/src/server.ts` | Listen, optional Mongo connect, graceful shutdown. | Yes | Not directly tested. |
| `backend/src/config/database.ts` | Mongoose connect/disconnect/connected state. | Yes | Health disconnected path tested; no live db tests in regular suite. |
| `backend/src/config/environment.ts` | dotenv and validated backend env config. | Yes | Indirectly exercised; no separate config test file. |
| `backend/src/lib/api-error.ts` | Structured API error type. | Yes | Through API/auth tests. |
| `backend/src/middleware/cors.ts` | Exact-origin CORS and OPTIONS. | Yes | No dedicated test identified. |
| `backend/src/middleware/error-handler.ts` | Safe API error envelope, malformed JSON handling. | Yes | API tests. |
| `backend/src/middleware/not-found.ts` | Standard 404 conversion. | Yes | API test. |
| `backend/src/middleware/load-current-user.ts` | Persisted user/status/role/society context. | Yes | Authorization/auth/users tests. |
| `backend/src/middleware/require-roles.ts` | Explicit role membership check. | Yes | Authorization/users tests. |
| `backend/src/middleware/society-isolation.ts` | Same-society primitive, no platform bypass. | Yes | Authorization tests. |
| `backend/src/modules/auth/password.ts` | Node scrypt hash and verify. | Yes | Authentication tests. |
| `backend/src/modules/auth/jwt.ts` | HS256 JWT issue/verify. | Yes | Authentication/authorization tests. |
| `backend/src/modules/auth/authentication-middleware.ts` | Bearer token verification. | Yes | Authentication/authorization/users tests. |
| `backend/src/modules/auth/authentication-service.ts` | Active-user login and safe login result. | Yes | Authentication tests. |
| `backend/src/modules/auth/auth-routes.ts` | `POST /login` only. | Yes | Authentication tests. |
| `backend/src/modules/auth/types/express.d.ts` | Typed `request.auth` and current-user augmentation. | Yes | Compile-time. |
| `backend/src/modules/users/user-routes.ts` | GET list/profile, authorization, safe serializer. | Yes | 17 user tests. |
| `backend/src/modules/users/models/User.ts` | User schema and role enum. | Yes | Model/auth/user tests. |
| `backend/src/modules/society/models/Society.ts` | Society persistence schema. | Yes | Model tests. |
| `backend/src/modules/society/models/SocietyRuleVersion.ts` | Versioned opaque rule configuration schema. | Yes | Model tests. |
| `backend/src/modules/property/models/Building.ts` | Building schema. | Yes | Model tests. |
| `backend/src/modules/property/models/Flat.ts` | Flat schema; only society/building/property data. | Yes | Model tests assert no owner/resident arrays. |
| `backend/src/modules/property/models/Ownership.ts` | Ownership relation. | Yes | Structural model tests. |
| `backend/src/modules/property/models/Residence.ts` | Occupancy relation. | Yes | Structural model tests. |
| `backend/src/modules/membership/models/Membership.ts` | Society membership relation. | Yes | Model tests. |
| `backend/src/modules/committee/models/Committee.ts` | Committee schema. | Yes | Model tests. |
| `backend/src/modules/committee/models/CommitteeMember.ts` | User/committee membership schema. | Yes | Model tests. |
| `backend/src/modules/audit/models/AuditLog.ts` | Append-only model, hash validation, query guards. | Yes | Audit tests. |
| `backend/src/modules/audit/audit-log-hashing.ts` | Version-1 canonical serialization and Keccak hash. | Yes | Audit tests. |
| `backend/src/routes/health.ts` | `GET /api/health`. | Yes | API tests. |
| `backend/src/routes/index.ts` | Mounts health, auth, user routers. | Yes | API-level tests. |
| `backend/tests/integration/mongodb-test-database.ts` | Test-only Mongo connect/verify/cleanup helper. | Yes, untracked | Not a `*.test.ts`; no transaction test uses it yet. |
| `frontend/src/App.tsx` | React Router shell routes/placeholders. | Yes | No frontend tests. |
| `frontend/src/components/layout/*` | Brand/sidebar/mobile navigation/app frame. | Yes | No frontend tests. |
| `frontend/src/components/ui/{button,card,badge}.tsx` | Small local primitives. | Yes | No frontend tests. |
| `frontend/src/pages/DashboardPage.tsx` | Static empty dashboard messaging. | Yes | No frontend tests. |
| `frontend/src/pages/ModulePlaceholderPage.tsx` | Honest unpopulated module page. | Yes | No frontend tests. |
| `frontend/src/routes/navigation.ts` | Documented major module navigation labels/routes. | Yes | No frontend tests. |
| `frontend/src/styles.css` | Nivaas palette, semantic CSS variables, fonts/Tailwind. | Yes | No frontend tests. |
| `blockchain/hardhat.config.ts` | Solidity 0.8.28 and local Hardhat paths. | Foundation only | Compile command exists; no contract tests. |
| `blockchain/scripts/compile.cjs` | Hardhat invocation with repository-local Windows APPDATA paths. | Foundation only | No dedicated tests. |
| `blockchain/contracts/README.md` | Contract directory note. | Yes | No contract source. |
| `playwright.config.ts` | Browser runner/web server setup. | Config only | No Playwright spec exists. |

## 23. Clean Bootstrap README

Standalone instructions for a new developer (PowerShell shown; use shell equivalents elsewhere):

```powershell
# 1. Clone/open repository
git clone https://github.com/sohaibiqbal69/Nivaas.git
cd Nivaas

# 2. Install prerequisites: Node 22+, npm 10+, Docker Desktop
# 3. Install JS dependencies
npm install

# 4. Configure local settings (never commit .env)
Copy-Item .env.example .env

# 5. Start only MongoDB
docker compose up -d mongodb
docker compose ps

# 6. Verify single-node rs0 is PRIMARY
docker compose exec mongodb mongosh --quiet --eval "rs.status().members.map(m => ({name:m.name,stateStr:m.stateStr}))"

# 7. Run the backend (JWT auth requires a local JWT_SECRET in .env)
npm run dev:backend

# In another terminal, run the frontend
npm run dev:frontend

# 8. Existing unit/API tests (MongoDB disconnected)
npm test

# 9. Transaction integration tests (currently no specs; command reports no files)
npm run test:integration

# 10. Static verification
npm run typecheck
npm run build
npm run blockchain:compile
```

When transaction integration specs are added, ensure they explicitly call `connectIntegrationTestDatabase`, clear the dedicated test DB between cases, and disconnect afterward. The command must fail loudly if `MONGODB_TEST_URI` or the replica-set primary is unavailable. Do not use `MONGODB_URI` for test cleanup.

## 24. Migration Instructions for the Next AI

**The repository is the source of truth.** The next AI should:

1. Clone/open this repository.
2. Read `AGENTS.md`.
3. Read `NIVAAS_ENGINEERING_HANDOFF.md`.
4. Inspect `git status` and preserve the uncommitted Mongo infrastructure changes.
5. Inspect recent commits and confirm HEAD against `origin/main`.
6. Verify Docker, `docker compose ps`, and `rs0` PRIMARY status.
7. Run `npm test`; recognize that integration tests do not yet exist.
8. Compare proposed implementation against current `docs/`, especially account setup, AuditLog, and database constraints.
9. Continue with the account-setup checkpoint only after resolving any material action/actor audit ambiguity; use a transaction and real replica-set tests.

Do not treat this handoff as higher authority than current approved specifications or actual source. If this document and repository differ, inspect the repository and update your understanding before changing code.
