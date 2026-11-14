## Production database readiness and migration runner — 26 October 2026

### Repository context and implementation

- Work began on branch `main` at `dc7b8d1` (`docs: add AI engineering handoff`).
  The working tree already contained extensive unrelated modified/untracked
  work. No reset, staging, commit, deployment, Atlas connection, or database
  operation was performed. Changes for this checkpoint are limited to the
  migration runner/index strategy, its package command and tests, the migration
  environment template, `docs/DEPLOYMENT.md`, and this handoff entry.
- Added an explicit, versioned production migration runner at
  `backend/src/migrations/` and `backend/scripts/run-migrations.ts`, exposed as
  `npm.cmd run db:migrate --workspace=@nivaas/backend -- --status|--dry-run|--apply`.
  Production target validation occurs before connection: `NODE_ENV=production`,
  TLS-enabled remote MongoDB URI, exact database-name match, an explicit
  allowlist match, and rejection of protected/system/disposable names. The URI
  is never printed. Apply is opt-in; status and dry-run do not write.
- The first migration checks/creates current schema indexes from the explicit
  registry of persisted Mongoose models. Inventory at implementation time: 36 models,
  66 declared indexes, 18 unique indexes and one TTL index. Unique indexes
  protect email/session/setup-credential identity, society/building/flat
  uniqueness, versioned governance/quotation state, one-vote/one-result
  constraints, and proof-operation uniqueness. Other indexes support
  society-scoped workflow and audit/evidence lookup. The AuthSession TTL index
  only removes expired records asynchronously; refresh rejects expiry directly.
- Existing equivalent indexes count as satisfied. Same-key incompatible
  options and same-name conflicts fail before writes in the planned index
  pass. MongoDB duplicate-key failure is reported with a safe remediation
  message; the runner does not delete/rewrite records or drop/replace indexes.
  Earlier indexes may remain if a later create fails; retry is idempotent.
  Unknown/duplicate/out-of-order ledger entries fail closed. No historical
  baseline is fabricated; the ledger gets a migration record only after the
  real migration passes. Operators must serialize runs for the same database.
- Production `connectDatabase` now sets Mongoose `autoIndex: false`; local and
  test behavior remains unchanged. Production startup also refuses DB
  readiness when the migration ledger is pending or any declared index is
  missing/conflicting. This makes the explicit migration the production
  schema-index path instead of silently creating indexes at API startup.
  Multi-document transaction support still requires Atlas/MongoDB
  replica-set or sharded deployment; index creation alone does not require it.
- The existing `migrate:building-code-index` and its disposable-local-target
  guard were not changed. The production runner creates the current partial
  unique Building-code index on a fresh target, but refuses an incompatible
  existing legacy index; a populated-database legacy transition still needs a
  separately reviewed, backed-up operation. No index-drop rollback is
  offered. Recovery is forward-only after resolving conflicts.

### Deployment plan and blockers

- Proposed fresh synthetic-demo database: `nivaas_college_demo_2026` (not
  created). Create it in the approved Atlas project with TLS, a database-
  scoped user able to inspect/create collections and indexes, restricted
  network access, replica-set transactions, and a verified backup/restore.
  Apply the migration from a restricted operator context using an exact
  database name and allowlist; do not attach migration variables to the
  runtime service. `deployment/migration.env.example` contains names only,
  with no URI or secret.
- Deployment sequence, Vercel root/build/output/API origin, exact CORS origin,
  backend variables, evidence-storage limitation, account-provisioning gate,
  and staging smoke checks are updated in `docs/DEPLOYMENT.md`.
- Even a synthetic college demo is blocked on safe production first-System-
  Admin provisioning and setup-credential delivery: current bootstrap and
  setup delivery remain local-only and no production route exists. No direct
  database insertion workaround is approved. For demo evidence workflows,
  ephemeral/serverless storage is also unsuitable; use a guaranteed durable
  private disk for a bounded single-instance preview or implement the private
  R2/S3 adapter. Real society data additionally requires production-grade
  backup/restore, durable evidence, operations/privacy controls and confirmation
  of society-specific governance rules. Public testnet/MetaMask remains outside
  this task and is optional for a synthetic UI/API demo.

### Verification actually run

- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/migration-runner.test.ts tests/declared-indexes.test.ts tests/migration-schema-inventory.test.ts tests/disposable-database.test.ts tests/production-config.test.ts tests/authentication.test.ts` — passed, 6 files / 41 tests. The first sandboxed attempt failed auth tests because the environment denied loopback `127.0.0.1` (`EACCES`); the focused suite passed with local HTTP permission. One initial index-option expectation was corrected for Mongoose's declared `background: true` option, and the inventory test records 36 actual model schemas/66 indexes.
- `npm.cmd run typecheck` — passed for frontend and backend.
- `npm.cmd run build` — passed for frontend and backend. Existing Vite advisory remains: main JS `567.50 kB` minified / `164.76 kB` gzip, lazy ArchitectureScene `554.85 kB` / `141.50 kB`; no frontend code was changed here.
- `git diff --check` — passed; only Git LF-to-CRLF notices for existing dirty files.
- No migration command (`--status`, `--dry-run`, or `--apply`) was run against a live database. No Atlas or local MongoDB connection, migration, seed, cleanup, database write, deployment, or testnet operation occurred. The index count was read from in-process Mongoose schemas only.
- The full backend unit suite, MongoDB integration suites, frontend tests, Playwright, blockchain tests/compile, and actual Atlas permission/transaction/backup verification were not run as part of this checkpoint.

## MongoDB refresh-session integration verification — 26 October 2026

### Implementation and defect fixed

- Added `backend/tests/integration/authentication.integration.test.ts`. It uses
  the existing guarded loopback rs0 integration helper, the actual auth router
  and service, real `User` documents, and the default Mongoose
  `AuthSession` repository. No in-memory session repository is supplied for
  persistence assertions.
- The first database-backed run exposed a production defect missed by the
  in-memory unit/browser tests: `AuthSession.createdAt` is required by the
  schema, but login had not included it in the record written by
  `AuthenticationService`. Login therefore failed Mongoose validation. The
  service now records `createdAt: now`, the session repository type includes
  it, and lookup maps it from MongoDB.
- The suite verifies stored refresh secrets are represented only by their
  SHA-256 hash; persisted session renewal; logout revocation; malformed,
  unknown and logically expired credentials; inactive-user rejection and
  revocation; independent users/sessions with one-session logout; and the
  declared unique, token lookup, user/revocation and TTL indexes. Expiry is
  asserted through the saved expiry timestamp and renewal result. The test
  does not assume that TTL deletion happens immediately or test physical TTL
  cleanup.

### Database safety and actual test target

- Used the repository Docker Compose MongoDB 8.0 single-node `rs0` replica set
  on the local Docker Desktop engine. The container was stopped before the run;
  it was started for verification and stopped afterward. Its volume was not
  removed.
- The exact target was
  `nivaas_disposable_auth_sessions_20261026_9f51c8a2`, with
  `mongodb://127.0.0.1:27017/<name>?replicaSet=rs0` and matching
  `NIVAAS_DISPOSABLE_DATABASE` confirmation. The existing helper accepted it
  in a no-connection preflight before Vitest ran. Each test's cleanup was
  limited to that confirmed database. No protected database, Atlas cluster,
  migration, seed, deployment or other database was used.
- The disposable database was left in place; it was not dropped. The final
  test setup left its records empty after the per-test cleanup and retained
  the schema indexes.

### Verification actually run

Passed:

- Focused MongoDB suite, final run: 1 file / 5 tests passed:
  `npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/authentication.integration.test.ts`
- Focused auth unit tests: 1 file / 14 tests passed:
  `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/authentication.test.ts`
- `npm.cmd run typecheck` — frontend and backend passed.
- Focused integration-test TypeScript check passed:
  `npm.cmd exec -- tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --strict --noUnusedLocals --noUnusedParameters --skipLibCheck --types node,vitest/globals backend/src/modules/auth/types/express.d.ts backend/tests/integration/authentication.integration.test.ts`
- `npm.cmd run build` — frontend and backend passed. Frontend outputs are
  unchanged from the previous build; Vite still reports the existing >500 kB
  chunk advisory.
- `git diff --check` passed; output contained only the repository's existing
  LF-to-CRLF notices for dirty files.

The first focused MongoDB run failed four login-dependent cases because of the
missing required `createdAt`; after fixing the persistence record, all five
integration tests passed. The full backend suite, all other integration
suites, frontend tests and Playwright were not rerun for this backend-only
change.

## Browser verification — independent authentication sessions — 26 October 2026

### Browser setup and findings

- The repository uses `@playwright/test` 1.63.0. Playwright's configured Chromium
  build is Chrome for Testing 153.0.8010.12 (Chromium revision v1243), expected
  under the sandbox-scoped `ms-playwright/chromium-1243` cache. That managed
  browser was absent. `npm exec -- playwright install chromium` retried the
  Playwright CDN download five times and timed out; the package lock and browser
  version were not changed.
- Used the existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` config hook with the
  installed Google Chrome 155.0.8059.86. This is a real Chromium browser run, but
  not the pinned Playwright-managed browser build.
- The Playwright setup now starts an isolated in-memory authentication API and
  Vite frontend. Its browser logins use Nivaas's actual `AuthenticationService`,
  `/auth/login`, `/auth/refresh`, `/auth/logout`, JWT verifier, current-user
  loader, `requireRoles`, and `requireSameSociety` middleware. Hashed test users
  and refresh sessions exist only in memory; the test server does not connect to
  MongoDB or Atlas, and no migration, seed, or deployment was run. The harness
  uses a 15-second access JWT and a 10-minute in-memory refresh lifetime solely
  to make expiry testable in a short run; product defaults/configuration were
  not changed.

### Browser results

Passed on Chrome 155.0.8059.86:

- `npm.cmd run test:e2e -- --workers=1` — 3/3 tests passed (four-tab auth
  scenario, sign-in form, and unauthenticated route redirect; four-tab case
  ran in about 1.1 minutes).
- Four separate pages in one browser context logged in as Society Manager,
  Committee Member, Owner Member, and Resident. Each kept its own session ID
  and backend-derived role through navigation and reload.
- The test waited for real JWT `exp` values, then confirmed a parallel dashboard
  refresh caused one shared refresh attempt. Four simultaneous expired-tab
  reloads renewed four separate sessions. The UI's token update was awaited
  before protected endpoint assertions.
- Post-renewal backend checks confirmed the correct role for each page,
  rejected a Committee-only route for other roles, allowed the matching
  society resource and rejected a different society's resource.
- Chromium `window.open` cloned the source `sessionStorage`; BroadcastChannel
  detection sent the clone to sign-in and cleared its copy while the original
  remained authenticated. Logging out the Manager revoked only that session;
  the other three tabs independently renewed. Revoked and unknown, validly
  shaped refresh credentials each caused one refresh attempt, then cleared the
  affected tab without a retry loop.

The initial real-browser attempts exposed only test-harness timing issues: a
three-second test JWT could expire while four accounts were being signed in
sequentially, and a refresh-attempt metric could be observed before the browser
had stored the new token. The harness now signs in pages concurrently, uses a
15-second test-only TTL, waits against the JWT expiration, and waits for token
replacement. No product authentication defect was found in the completed run.

### Other verification

- `npm.cmd test --workspace=@nivaas/frontend` — 32 files, 97 tests passed.
- `npm.cmd test --workspace=@nivaas/backend` — 31 files, 242 tests passed. This
  excludes database integration tests; auth tests use in-memory repositories
  and temporary HTTP servers.
- `npm.cmd run typecheck` — frontend and backend passed.
- Focused E2E harness check passed:
  `npm.cmd exec -- tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --strict --skipLibCheck --types node backend/src/modules/auth/types/express.d.ts tests/e2e/session-auth-server.ts tests/e2e/auth-session-isolation.spec.ts`.
- `npm.cmd run build` — frontend and backend passed. Frontend output remains
  entry JavaScript 567.50 kB minified / 164.76 kB gzip, CSS 55.43 kB / 11.02 kB,
  and lazy architecture scene 554.85 kB / 141.50 kB. The existing >500 kB Vite
  chunk advisory remains. No dependency was added.
- `git diff --check` passed. Existing line-ending notices concern unrelated
  dirty files and were not normalized as part of this task.

### Remaining browser limitations

- Browser-level renewal used the real auth service and authorization middleware
  with an in-memory repository, not MongoDB-backed `AuthSession` persistence.
  This respects the no-database constraint; persistence/revocation across an
  actual database restart remains unverified here.
- Duplicate-tab behavior was verified in Chrome 155 only. Other browser engines,
  browsers without BroadcastChannel, real society accounts, and manual UI
  verification remain outstanding. Browsers without BroadcastChannel cannot
  detect cloned `sessionStorage` using the current design.
- Browser command when a compatible installed Chrome is available:

  ```powershell
  $env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  npm.cmd run test:e2e -- --workers=1
  ```

# Nivaas — AI Engineering Handoff

## Continuation checkpoint — 24 October 2026: flats, meeting notices, audit search

This is the latest milestone in the active C: checkout. Preserve the existing
modified and untracked work. The original Z: checkout and protected databases
were not changed. No commit, stage, reset, or cleanup was performed.

### Milestone completed

- Society Managers can list assigned-society buildings, create flats through
  `POST /flats`, preserve flat numbers as text (`002`, `0101`), and choose the
  existing `ACTIVE`/`INACTIVE` property status. Flat relationships use a
  typeable flat-number field backed by persisted flats; an explicit create
  action creates a missing flat first, then leaves ownership/residence/membership
  as separate submissions. Existing flats can be selected by exact number.
  Joint owners remain separate `Ownership` records; order is metadata, not a
  vote or ownership share.
- Manager flat creation derives society scope from the authenticated account,
  checks the selected building's society, and preserves the existing unique
  `(buildingId, flatNumber)` database index as the final concurrent-duplicate
  guard. A duplicate returns `409 FLAT_ALREADY_EXISTS`. Property duplicate
  errors now identify duplicate building codes separately instead of labeling
  every duplicate key as a flat conflict.
- The reported meeting-publication `409` was a legitimate notice-period
  conflict: the active rule required five clear calendar days and the supplied
  notice provided two. `409 NOTICE_PERIOD_INSUFFICIENT` now reports both
  counts and directs the manager to issue notice earlier or choose a later
  date. It leaves the meeting in DRAFT and does not bypass rule checks. The
  Meetings navigation item is removed; `/meetings` redirects to `/notices`.
  Formal meeting/resolution controls remain available inside the manager's
  Notice Board disclosure. Meeting records, routes, governance, attendance,
  resolution and audit behavior remain intact. Publishing an everyday notice
  does not publish a formal meeting.
- Audit Trail has one text search plus From/To date filters. Backend partial,
  case-insensitive matching covers humanized action names and safe allowlisted
  event text. Project events can also match real quotation/vendor names through
  their actual project relationship. Related quotations are scoped through
  society-authorized projects before text is used; search runs before
  pagination. Society filters and audit immutability remain server-enforced.

### Implementation and specifications

Relevant changes: `backend/src/modules/property/property-routes.ts`,
`backend/src/modules/audit/audit-routes.ts`,
`backend/src/modules/governance/governance-routes.ts`,
`backend/src/modules/approval/approval-routes.ts`,
`frontend/src/pages/SocietyMembersPage.tsx`,
`frontend/src/pages/GovernancePage.tsx`,
`frontend/src/pages/NoticeBoardPage.tsx`,
`frontend/src/pages/AuditTrailPage.tsx`, `frontend/src/App.tsx`,
`frontend/src/routes/navigation.ts`, their focused tests, and
`docs/API.md`/`docs/DATABASE.md`.

The existing Flat schema already declares the unique `(buildingId,
flatNumber)` index; no index migration or record repair was performed. Legacy
duplicate records must not be silently rewritten or deleted if a future index
build reports a conflict. This checkpoint initially exposed the legacy sparse
Building index issue; see the later property-management checkpoint below for
the corrected schema, guarded migration, and current protected-database status.

### Verification in this milestone

Passed:

- Backend focused property/audit unit tests: `14/14`.
- Frontend focused members, notices, governance, audit, navigation and API
  helper tests: `17/17`.
- Manager-onboarding MongoDB integration: `3 passed`; the optional browser
  case was skipped because `NIVAAS_ONBOARDING_BROWSER` was not enabled. It
  used a fresh `nivaas_disposable_*` loopback rs0 database and verified leading
  zeroes, same-building duplicate rejection, concurrent duplicate handling,
  reuse in another building, same-society scoping, and separate joint-owner
  records.
- Meeting publication integration: successful publication `1 passed` and
  insufficient-notice conflict `1 passed`; each command filtered the other
  eight governance tests.
- Real MongoDB audit relationship-search integration: `1 passed`; the other
  two tests were filtered. It covered project/quotation/vendor/approval links,
  partial case-insensitive search, pagination, date filtering, and society
  isolation.

The first audit integration attempt exposed that project and approval events
did not search associated quotation/vendor text. That relationship traversal
was fixed and the focused real-Mongo test then passed. The first onboarding
integration attempt used a second building without a code and exposed the
existing Building index behavior noted above; the passing verification used a
distinct building code. Failed and successful test database targets were all
fresh `nivaas_disposable_*` databases. They were left untouched after tests;
future runs must use fresh names. No protected database was targeted.

No live authenticated browser run was performed. The focused React tests use
mocked API responses; the MongoDB route/integration tests used real persistence
in isolated databases. Test accounts and ownership relationships were created
only in those disposable targets; `nivaas`, `nivaas_test`, and `nivaas_demo`
were not targeted.

Exact focused commands run:

```powershell
npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/lib/members.test.ts src/pages/SocietyMembersPage.test.tsx src/pages/NoticeBoardPage.test.tsx src/pages/GovernancePage.test.tsx src/pages/AuditTrailPage.test.tsx src/routes/navigation.test.ts
npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/property.test.ts tests/audit-retrieval.test.ts
npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/manager-onboarding.integration.test.ts
npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/governance.integration.test.ts -t 'actionable 409'
npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/governance.integration.test.ts -t 'publishes a meeting'
npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/audit-retrieval.integration.test.ts -t 'searches audit events through real project'
npm.cmd run typecheck --workspace=@nivaas/backend
npm.cmd run typecheck --workspace=@nivaas/frontend
npm.cmd run build --workspace=@nivaas/frontend
git diff --check
```

Results: frontend `17/17`; backend focused unit `14/14`; manager-onboarding
MongoDB `3 passed, 1 skipped`; each targeted governance integration `1 passed,
8 skipped`; audit relationship integration `1 passed, 2 skipped`; backend and
frontend typechecks passed; production build passed with an existing 512.29 kB
minified JavaScript chunk advisory; `git diff --check` passed. Its only output
was Git's existing DashboardPage LF-to-CRLF warning. The test database names
were newly generated `nivaas_disposable_*` targets; those targets were left
untouched after test completion and must not be reused for a destructive run.

### Remaining issues and next milestone

- The unique sparse compound Building index effectively required distinct
  `buildingCode` values at this checkpoint. A later property-management
  checkpoint changes the model to a partial unique index and verifies a guarded
  migration on an isolated database; the protected `nivaas_demo` database was
  deliberately not migrated.
- No standalone Meetings page remains; formal meeting controls are nested under
  Notice Board for managers. Verify this interaction in a real authenticated
  browser when the demo environment is available.
- Audit search loads the society-scoped candidate event set before applying
  pagination, which gives correct partial-match results but may need a
  dedicated indexed search representation if audit volume becomes large.
- Continue in this order: finish core functionality and focused verification;
  prepare MongoDB Atlas, backend/frontend hosting and production configuration;
  deploy to a persistent EVM testnet and verify proofs; perform the final
  GPT-Taste UI overhaul; then run final acceptance tests and prepare the demo.

### Instructions for the next session

The repository is the source of truth. Preserve all uncommitted work and local
data. Do not repeat already-passing suites without a specific reason. Read
this checkpoint and inspect the relevant current source before continuing;
do not restart the project or assume prior reports are more current than code.

## Continuation checkpoint — 24 October 2026: targeted usability

Active implementation is **C:\Users\sohaibiqbal\Nivaas**, not the historical Z:
path described below. Preserve all uncommitted and untracked work. No databases
were cleared, no chain was reset, and no commit/staging was performed.

- Complaint intake now requires only a title. Optional details stay blank rather
  than receiving invented priorities/categories. Timeline/status/evidence labels
  are readable; private files, SHA-256 and transactional audit remain intact.
- Notice Board now supports private JPEG/PNG document scans up to 5 MiB using the
  existing evidence API/storage. Save draft → attach → publish. Draft attachments
  lock on publication; downloads enforce society, parent linkage and notice expiry.
  PDF/Office uploads and scheduled publishing remain unsupported.
- Members & Flats searches real flats by number/floor/building name and requires
  an explicit selection. Field guidance separates ownership, residence, membership
  and voting eligibility. Missing property records require System Admin through
  existing property APIs, then refresh; property creation has no browser form yet.
- /voting shows a clear unavailable placeholder. Backend governance and histories
  remain intact. Do not represent voting as an available browser workflow.
- A missing registry proof with prior confirmed operation/attempt history returns
  UNVERIFIABLE, not a fresh NO PROOF. Deterministic Hardhat resets can reuse deployment
  address/hash. Current pending/failed attempts remain distinct; confirmation still
  requires successful receipt, registration event and matching registry read-back.
  Saved metadata remains visible when status can be read but verification fails.

Changed implementation: complaint service/model; evidence model/router/service plus
notice-evidence-service; AuditLog proof service; ComplaintsPage, NoticeBoardPage,
NoticeAttachments, SocietyMembersPage, members API helper, BlockchainPage, App and
VotingUnavailablePage. Focused regressions cover these changes. API, DATABASE,
ARCHITECTURE, BLOCKCHAIN and IMPLEMENTATION_DECISIONS contain the contract updates.

Verification completed so far in this continuation:
- Backend focused evidence/complaints/notices/proof-history/registry: 27/27.
- Frontend selected pages and members helper: 17/17.
- New real MongoDB/API cases: 3 passed, 7 older tests intentionally filtered out.
  Database: nivaas_disposable_usability_8a7ed3886926451da24ddaa8c51135d4.
- Real Chrome notice upload/publish/download and disabled Voting: 1 passed,
  10 other cases filtered out. Database:
  nivaas_disposable_notice_ae50fe342d7b4132bdaf05057076a820.
- No live blockchain transaction/reset in this pass; reset/retry behavior used the
  test registry. Existing production/demo data and signer configuration untouched.
- Both TypeScript checks (`tsc --noEmit --incremental false`) passed. Frontend
  production build passed with the existing >500 kB bundle advisory. The members
  helper regression rerun passed 3/3. `git diff --check` passed (an unrelated existing
  DashboardPage LF/CRLF advisory remains).

Exact focused commands (repository root unless indicated):
```powershell
npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/blockchain-proof-history.test.ts tests/blockchain-registry.test.ts tests/evidence.test.ts tests/complaints.test.ts tests/notices.test.ts
npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/pages/ComplaintsPage.test.tsx src/pages/SocietyMembersPage.test.tsx src/pages/BlockchainPage.test.tsx src/pages/NoticeBoardPage.test.tsx src/pages/VotingUnavailablePage.test.tsx src/lib/members.test.ts
npm.cmd exec --workspace=@nivaas/backend -- tsc --noEmit --incremental false
npm.cmd exec --workspace=@nivaas/frontend -- tsc --noEmit --incremental false
npm.cmd run build --workspace=@nivaas/frontend
git diff --check
```
For just the new database cases, from `backend/`, with a newly generated matching
disposable DB name/URI, run:
```powershell
node ../node_modules/vitest/vitest.mjs run --no-file-parallelism tests/integration/evidence.integration.test.ts -t 'notice|title-only'
```
Set `NIVAAS_EVIDENCE_BROWSER=true` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to
installed Chrome to include the new notice browser case. Using Node directly
preserves the regex separator on Windows (npm.cmd can reinterpret it as a pipe).

Test harness uses random test credentials without logging them and fresh guarded
`nivaas_disposable_*` databases. No cleanup helper runs in evidence integration tests.
Use short disposable names (MongoDB limit: 63 characters). Existing services on
occupied ports are preserved; the browser harness uses a separate listener.

Next useful milestone: System Admin building/flat provisioning UI using the existing
property APIs, so the manager's missing-flat request is completable in the browser.
Persistent blockchain deployment and production file storage are separate milestones.

---

**Prepared:** 11 October 2026  
**Purpose:** Transfer project context from GitHub Copilot to another coding agent (for example, Codex) without losing architecture, constraints, implementation history, or the next engineering priorities.

> This document is a context handoff, not a substitute for checking the live repository. Before editing, the next agent must inspect Git status, recent commits, package scripts, and the actual implementation. Where this file says a test or change was “reported passing,” rerun it if practical rather than assuming the current checkout is identical.

---

## 1. Project overview

**Project name:** Nivaas  
**Type:** Blockchain-assisted apartment housing-society governance and transparency DApp  
**Academic context:** MSc Computer Science semester project  
**Repository path on the developer's Windows machine:**

```text
Z:\College\MSc-CompSci\blockchain-technology\Nivaas
```

Nivaas helps apartment societies manage budgets, projects/repairs, quotations, approvals, meetings, notices, governance resolutions, voting, complaints, payments, progress evidence, and audit history.

The blockchain is an integrity/proof layer—not the primary database and not a claim that every action is automatically lawful or truthful. MongoDB remains the authoritative application store. Selected governance records are hashed and their proofs registered on-chain so that later changes can be detected.

### Non-negotiable goals

1. **Real blockchain implementation:** Solidity contracts, Hardhat, ethers.js, local deployment, secure signer/authorization, real transaction lifecycle, persisted transaction metadata, backend integration, and independent verification. Do not settle for blockchain-themed UI or merely storing a hash in MongoDB.
2. **Exceptionally polished frontend:** Responsive, coherent visual identity with purposeful Anime.js animation and a memorable “wow” factor. Animation is mandatory, but must respect reduced-motion preferences and must not fake transaction success.
3. **Keep frontend and backend integration continuous.** Do not build a disconnected frontend mock and postpone all integration until the end.
4. **Do not reduce scope just because the semester deadline is approaching.** Improve execution, tooling, sequencing, and testing rather than casually deleting required features.
5. **Use disciplined checkpoints:** inspect → implement one coherent scope → inspect actual diff → test → stage explicit paths → commit → push → verify. Do not stage everything indiscriminately.

---

## 2. Technology stack

### Monorepo

- npm workspaces
- `backend/`: Node.js, Express 5, TypeScript, MongoDB/Mongoose
- `frontend/`: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn-style UI components, React Router, Lucide icons, Anime.js 4.5
- `blockchain/`: Solidity 0.8.28, Hardhat 2, `@nomicfoundation/hardhat-ethers`, ethers.js 6
- Testing includes unit/integration tests and a Playwright E2E setup.
- Authentication uses JWT (`jose`) and scrypt-based password handling.
- Integration testing uses MongoDB replica-set behavior through Docker Compose.

Useful root scripts (verify exact current scripts in root `package.json` before relying on them):

```powershell
npm run build
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run blockchain:compile
npm run dev:frontend --workspace=@nivaas/frontend
npm run dev:backend --workspace=@nivaas/backend
```

Blockchain workspace scripts include compile and test commands; inspect `blockchain/package.json` for the exact current form.

---

## 3. Visual identity and frontend requirements

Use these established design tokens:

- Background: `#FFF8DB`
- Text: `#091120`
- Primary: `#E03B29`
- Secondary: `#1D5287`
- Accent: `#F6E7A7`
- Headings: Space Grotesk Bold
- Body/UI: Syne
- Technical/data text and wallet addresses: JetBrains Mono

Frontend engineering requirements:

- Reuse the shared app shell, page headers, state/empty/loading/error patterns, and motion utilities instead of inventing a separate design system per page.
- Use Anime.js through shared utilities/hooks; scope animations, clean them up, and respect `prefers-reduced-motion`.
- Use motion to clarify state transitions and hierarchy, not as decoration on every element.
- Ensure keyboard accessibility, visible focus, sensible loading/error/empty states, responsive layouts, and usable contrast.
- Never display a successful blockchain status until the relevant transaction has actually succeeded and the required confirmation policy has been met.
- Keep API contracts and UI behavior integrated; avoid hardcoded demo-only data when a real backend flow exists.

---

## 4. Domain model and business rules

### Roles

- `SYSTEM_ADMIN`
- `SOCIETY_MANAGER`
- `COMMITTEE_MEMBER`
- `OWNER_MEMBER`
- `RESIDENT`

System administrators operate at platform scope. They must not bypass society governance rules or rewrite historical decisions.

### Governance / approval rules

- Default prototype spending threshold: **₹1,00,000**, configurable per society.
- At or below the threshold: committee approval route.
- Above the threshold: General Body / SGM route.
- Governance rules are versioned. Decisions must preserve historical snapshots of the applicable rules/configuration.
- Projects cannot simply be marked approved directly; approval must flow through the governance engine.
- Approved quotations are immutable. Revisions/change requests may require reapproval.
- Voting eligibility must be based on membership and the applicable rules, not merely a role label or residence.
- Audit history is intended to be append-only and integrity-verifiable.
- Keep ownership, residence, membership, and governance eligibility distinct.
- Some Maharashtra co-operative housing society details remain unresolved. **Do not invent legal rules, quorum, majority formulas, eligibility outcomes, or authorities.** Preserve explicitly unresolved decisions and ask the project owner before finalizing them.
- Blockchain proofs attest to registered content integrity; they do not establish that the content was true or the decision legally valid.

### Intended core modules

- Society/member/building/flat administration
- Annual budget
- Projects and repairs
- Quotations, versions, and change requests
- Approval evaluation and governance rules
- AGM/SGM meetings, notices, resolutions, and voting
- Complaints and notice board
- Payments
- Project progress/photos and completion evidence
- Audit history and blockchain proof verification

Committee/election secret-ballot voting is a future/deferred module, not part of the initial MVP. Do not place secret election ballots on-chain.

---

## 5. Implementation decisions and repository safety

Existing project docs include (confirm exact current contents before editing):

- `docs/IMPLEMENTATION_DECISIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/VERSIONING.md`
- `docs/BLOCKCHAIN.md`
- `NIVAAS_ENGINEERING_HANDOFF.md` may already exist in the repository; inspect it and reconcile this document with it rather than blindly overwriting it.

### Explicit safety constraints

- **Never edit `opencode.json`** as part of routine Nivaas work.
- **Do not touch the unrelated pre-existing path** `backend/src/modules/project/models/` unless the owner explicitly requests it.
- Never run destructive cleanup commands or `docker compose down -v` casually. MongoDB data may be in Docker volumes.
- Never run `git add .` or `git add -A` as a shortcut. Stage only reviewed paths.
- Do not overwrite project specifications or handoff documents wholesale without reading them first.
- Do not claim an endpoint, script, or workflow exists until the live code confirms it.
- Before any work, inspect:
  ```powershell
  git status --short
  git branch --show-current
  git log -8 --oneline
  ```
- If the worktree is dirty, identify and preserve the user's changes before editing.

---

## 6. Progress — backend

The backend has substantial implementation already. The following checkpoints were previously committed/pushed:

- AuditLog integrity: `e21c45fe3fe8398f54bb7b9466db548a97443a2a`
- `SYSTEM_ADMIN` platform scope: `5d03bc92c9ced0762a3e9532eb3cc14b42839575`
- User retrieval APIs: `a2c2d796c9553d71ffccfc9c91a2dfe94ecd8ef3`
- Account status enforcement: `63fd4ed06190a24169df3faed6955512ce52801e`
- Account setup policy docs: `795384afc95b026e77bbafe447f34d9ed5fe2012`
- Quotations/change requests: `18d9b29 feat(quotations): add quotation revisions and change requests`
- Versioned governance approval engine: `d5d94b2 feat(governance): add versioned approval engine`

Previously reported test status at the governance checkpoint:

- Backend test total reported: 118 tests
- Governance integration suite: 18/18 passed across six files
- Quotation tests: 2/2
- Approval tests: 3/3
- Typecheck/build and `git diff --check` passed
- MongoDB replica-set health was reported as `rs.status().ok = 1`

These are historical reports; rerun current checks when changing related code.

### Governance approval engine capabilities reported

- Versioned society governance rules and active rule version
- Configurable threshold/approval-route evaluation
- Approval decisions and audit activity
- Invalidation/re-evaluation when the selected quotation changes
- Transactional behavior where required

Continue from the actual repository implementation, not from this summary alone.

---

## 7. Progress — frontend and authentication

A frontend foundation/auth checkpoint was committed and pushed.

Reported components/files include:

- `motion.ts`
- `motion.test.ts`
- `usePageMotion.ts`
- `PageHeader.tsx`
- `states.tsx`
- Responsive `AppShell`
- Dashboard and placeholder-page refinements
- `api.ts`
- `session.ts`
- `AuthContext.tsx`
- `ProtectedRoute.tsx`
- `LoginPage.tsx`
- `AccountSetupPage.tsx`

### Current auth contract reported

- `POST /api/auth/login` returns `{ user, token }` inside the API data envelope; only active accounts can log in.
- `POST /api/auth/setup` accepts `{ credential, newPassword }`; it does not return a token.
- `GET /api/users/:id` uses a bearer token for session revalidation.
- There is no confirmed `/auth/me`, refresh/revocation endpoint, accessible-societies endpoint, or normal society-detail endpoint yet.
- JWT is held in `sessionStorage`, not `localStorage`.
- Client logout clears the token but does not revoke a JWT server-side.
- `POST /api/users` is admin-only and reportedly returns a safe user shape; a bootstrap/first-admin flow remains unresolved.
- Safe frontend user shape: `_id`, `societyId`, `name`, `email`, `role`, optional `status`.
- `api.ts` normalizes `VITE_API_BASE_URL` with or without a trailing `/api`.
- A token-matched global 401 handler avoids clearing a newer session when an older request fails; 403 does not automatically log the user out.
- Minor possible cleanup: `clearSession()` is called inside a React state updater in `AuthContext.tsx`; consider refactoring later to keep the updater pure, but this is not the next priority.

Reported frontend tests: 4 files / 11 tests passed; typecheck, build, and `git diff --check` passed. Revalidate on current checkout.

The app shell/dashboard is protected. If the first-admin/bootstrap path is still absent, a fresh user may be unable to reach authenticated pages without an existing seeded/admin account. Do not solve this with an unsafe public admin-creation endpoint. Design a documented, secure development bootstrap path.

---

## 8. Progress — blockchain

### Current first contract

`blockchain/contracts/GovernanceProofRegistry.sol` has been created, tested, and **the user reports that it was pushed**.

Contract summary:

- Solidity `0.8.28`
- Immutable `owner`
- `authorizedSubmitters` allowlist controlled by owner
- `registerProof(recordReference, version, recordHash)`
- Prevents zero record reference/hash and version zero
- Prevents duplicate registration for the same `(recordReference, version)`
- Stores hash, submitter, and registration timestamp
- `getProof(...)`
- `verifyProof(...)`
- Events for submitter authorization and proof registration
- Custom errors for authorization, invalid input, duplicate/unknown proof, and zero address

Proof key is `keccak256(abi.encode(recordReference, version))`.

Tests were reported passing (7 tests) and compile/test commands were reported successful after earlier failures were corrected. The exact current Git state and scripts must be checked. Files in the first contract checkpoint were:

- `blockchain/contracts/GovernanceProofRegistry.sol`
- `blockchain/test/GovernanceProofRegistry.test.cjs`
- `blockchain/contracts/README.md`
- `blockchain/package.json` (adds test script)

### What the contract does NOT yet complete

- No confirmed deployment script/configuration
- No confirmed backend blockchain service
- No end-to-end integration with actual governance records
- No canonical record-hashing contract between backend and chain
- No persisted transaction lifecycle/confirmation/error metadata
- No production signer/key-management strategy
- No proof-verification endpoint/UI integrated with actual record versions

### Immediate next milestone

**Local deployment + backend integration. Do not start a second contract yet.**

1. Verify the committed contract and tests in the current checkout.
2. Add/verify a repeatable local Hardhat deployment script and documented local workflow.
3. Define canonical hashing for a specific versioned governance record, based on an explicit allowlist of stable fields. Do not hash arbitrary JSON serialization with unstable key/order/date formats.
4. Integrate ethers.js in a backend service; submit only eligible, finalized governance records.
5. Keep private keys in environment configuration for local development; never expose signer private keys to the frontend or commit secrets. Make authorization and local-only assumptions explicit.
6. Persist chain ID, contract address, record reference/version, record hash, transaction hash, sender, submission/confirmation status, block number, and relevant failure/retry state in MongoDB, with idempotency and duplicate handling.
7. Provide backend APIs to submit/get/verify proof for an actual governance record. Enforce role/ownership/society authorization.
8. Frontend shows pending/submitted/confirmed/failed states and a verifiable transaction/proof detail view.
9. Test success, unauthorized access, duplicate submission, reverted transaction, retry, record tampering, wrong chain/contract, and missing proof.
10. Never say “verified on blockchain” before a successful read-back comparison on the intended chain/contract.

Keep the application DB as the authoritative store. Do not store sensitive personal data or full governance documents on-chain—only an opaque reference and cryptographic hash.

---

## 9. Recommended end-to-end demonstration

The target is a complete, coherent workflow, not a collection of disconnected screens:

1. Manager creates **Lift Modernization**, budget **₹3,50,000**.
2. Approval engine selects the General Body/SGM route because the amount exceeds the configured ₹1,00,000 threshold.
3. Meeting/SGM and notice are created.
4. Eligible members are determined using membership and the applicable rule snapshot.
5. Eligible members vote; results are computed according to configured, documented rules.
6. The finalized decision is stored with the relevant rule version and audit history.
7. Backend computes a canonical hash and registers the proof in `GovernanceProofRegistry`.
8. UI presents pending/confirmed transaction state and proof metadata.
9. User can independently verify the on-chain hash against the record version.
10. Project approval is derived from the recorded governance decision; no manual bypass.
11. Work progress and photos are recorded.
12. A quotation revision/change request follows the applicable reapproval process.
13. Completion evidence/final invoice/payment and audit history are recorded.
14. Altering a protected field in a test copy causes verification to fail.

Do not claim the whole flow exists just because one module works; track the actual implementation state.

---

## 10. Git workflow and validation

Always begin with:

```powershell
Set-Location 'Z:\College\MSc-CompSci\blockchain-technology\Nivaas'
git status --short
git branch --show-current
git log -8 --oneline
```

Then inspect relevant package scripts, docs, source files, and existing tests.

For each bounded change:

1. Ask the agent to plan and inspect before editing if the scope is unfamiliar.
2. Specify allowed files/modules and exclusions.
3. Implement one vertical slice.
4. Review the actual diff, especially authorization, transaction boundaries, error handling, schema changes, and business-rule enforcement.
5. Run the narrow test first, then relevant workspace tests, typecheck/build, and `git diff --check`.
6. Stage explicit files only, inspect staged diff/stat, then commit and push.
7. Verify clean/expected status and latest commit.

Never commit secrets, `.env` files, private keys, generated chain state, or unrelated user work.

---

## 11. Instructions for the next AI coding agent

You are taking over an existing project, not starting a new one.

**First response / first action:**

- Read this handoff and the repository's own `NIVAAS_ENGINEERING_HANDOFF.md`, `docs/IMPLEMENTATION_DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/BUSINESS_RULES.md`, `docs/BLOCKCHAIN.md`, `docs/API.md`, `docs/DATABASE.md`, and `docs/VERSIONING.md` where present.
- Inspect `git status`, current branch, recent commits, package scripts, current contract/test, backend governance services, and frontend auth/motion foundation.
- Do not edit anything during this initial audit.
- Return a concise factual report: current branch/dirty state, latest commits, implemented features, current tests and results, unresolved decisions, and the smallest sensible next checkpoint.
- Do not assume the summary is more current than the source code.
- Do not repeat already-completed work. Do not generate speculative rewrites or change the architecture just to suit a preferred pattern.
- Do not alter `opencode.json` or `backend/src/modules/project/models/` without explicit authorization.
- Do not use `git add .`, destructive Docker volume commands, or unreviewed bulk changes.
- Prioritize **local deployment + real backend integration of the existing GovernanceProofRegistry** as the next engineering milestone unless repository inspection shows it is already done.
- Keep implementation, tests, frontend integration, and documentation synchronized.

### Suggested first task prompt

> Read `NIVAAS_AI_HANDOFF.md` and the repository's own handoff/specification documents. Do not edit files yet. Inspect the current Git status/branch/recent commits, root and workspace package scripts, `GovernanceProofRegistry.sol` and its tests, existing backend governance/approval/audit modules, and the frontend auth/motion foundation. Do not touch `opencode.json` or `backend/src/modules/project/models/`. Report only what the current repository confirms: completed functionality, tests you can verify, gaps, unresolved business-rule decisions, and the smallest next checkpoint for local deployment and backend integration. Do not implement anything until I approve the plan.

---

## 12. Open questions / known gaps to verify

- Secure first-admin/bootstrap flow.
- No confirmed normal society retrieval/listing endpoint for frontend navigation.
- Meetings, notices, resolutions, voting, complaints, payments, and project lifecycle may be partially implemented or still pending; inspect source/tests rather than infer status.
- Deployment network, production chain, contract upgrade policy, production signer/custody, and final on-chain payload/interface need explicit decisions. Local Hardhat is the initial environment.
- Governance quorum/majority/eligibility/legal specifics intentionally unresolved where not decided in project docs.
- Frontend auth session currently uses a bearer token in sessionStorage; assess security trade-offs without casually redesigning it mid-checkpoint.
- E2E test flow and actual authenticated app demo should be validated after secure bootstrap is available.

---

## 13. Subscription / tool transition note

The project should remain portable through Git and this handoff file; do not rely on one AI tool's conversation memory. Before switching coding agents, make sure all desired changes are committed/pushed or clearly documented as uncommitted. A new agent must inspect the repository.

If using a one-month subscription trial, check the offer's eligibility, renewal date, recurring price, and cancellation terms before entering payment details. Set a reminder to cancel before renewal if you do not intend to continue. Use an account/trial only in accordance with the provider's terms; do not assume a new account is eligible for an introductory offer.

## Continuation checkpoint — 24 October 2026: Building codes and property verification

This is the latest property-management checkpoint for the active C: checkout.
Preserve all existing modifications and local data. No changes were made to
the historical Z: checkout. No commit, staging, reset, cleanup, or protected
database write was performed.

### Completed

- `buildingCode` remains optional as the existing API validator and product
  requirements permit. `Building` now has a unique partial compound index on
  `(societyId, buildingCode)` for string-valued codes only. Multiple buildings
  without a code are allowed, while a supplied code remains unique within its
  society. A same code in another society remains allowed. Flat number/index
  behavior is unchanged.
- Added `backend/scripts/migrate-building-code-index.ts` and
  `npm run migrate:building-code-index --workspace=@nivaas/backend`. The
  migration requires a matching loopback `nivaas_disposable_*` target and
  `NIVAAS_DISPOSABLE_DATABASE` confirmation; it refuses `nivaas`,
  `nivaas_test`, and `nivaas_demo`. It checks the exact index definitions and
  scans for duplicate string codes before mutation. It only replaces the
  recognized legacy unique sparse index, builds the new partial unique index
  first to keep code uniqueness enforced, then drops the legacy index. Unknown
  indexes and duplicate code data abort without index or document changes. It
  never rewrites or deletes building records.
- A legacy-index conflict on an omitted code now returns HTTP 409
  `BUILDING_CODE_INDEX_MIGRATION_REQUIRED`; a duplicate supplied code remains
  HTTP 409 `BUILDING_CODE_ALREADY_EXISTS`.
- The existing System Admin Societies screen can list buildings per society
  and create one with an optional code through the authenticated
  `POST /api/buildings` API. Manager flat creation and relationship flows remain
  in Members & Flats; no property permissions were broadened.

### Protected database inspection and migration limitation

- `nivaas_demo` was inspected read-only before deciding whether to migrate. It
  reported one building, one building without a code, and no duplicate
  string-valued building-code groups. Its `buildings` collection has both the
  legacy unique sparse index `societyId_1_buildingCode_1` and the new partial
  unique index `uniq_society_building_code_present`; the application/schema
  index creation did not remove the old restriction. This database remains
  unchanged, so it still cannot create another code-less building until a
  separately authorized migration is performed. The migration CLI used for
  this milestone intentionally refuses protected names.
- The inherited `MONGODB_TEST_URI` pointed at protected `nivaas_test`. Tests did
  not connect to that database: each Mongo integration run rewrote only the
  child process URI path to a fresh random `nivaas_disposable_*` name, preserved
  the loopback rs0 endpoint, and supplied the exact database confirmation.
  Disposable test databases listed below were left untouched and must not be
  reused for any run that assumes emptiness.
- `docker compose ps` could not inspect Docker because access to the Docker
  named pipe was denied. Mongo availability was independently confirmed by
  integration tests, which connected to the loopback rs0 replica set and
  verified a writable primary.

### Authenticated browser verification

The optional Playwright case in
`backend/tests/integration/manager-onboarding.integration.test.ts` now signs
in as SYSTEM_ADMIN, creates two code-less buildings through the Society UI,
then signs in as the Society Manager. Through Members & Flats it creates flat
`002`, gets a visible 409 for a duplicate in the same building, creates `002`
in a different building, and records one primary and one joint owner as
separate ownership records. Existing membership/residence separation checks
remain in the same workflow. The browser test uses actual Chrome, the frontend
Vite app, authenticated HTTP APIs, and MongoDB persistence in an isolated
database; it does not use the main application database or the local blockchain.

### Verification in this checkpoint

Passed:

- Backend property unit tests: `8/8`.
- Frontend Society/Admin API helper tests: `5/5`; Society Administration page
  permission/render tests: `2/2` (`7/7` across the two focused files).
- Backend TypeScript check and frontend TypeScript check.
- Standalone migration script TypeScript check:
  `npm.cmd exec --workspace=@nivaas/backend -- tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck scripts/migrate-building-code-index.ts`.
- Real MongoDB migration integration: `1/1` in fresh
  `nivaas_disposable_index_b3bf989e8bed`. Covered legacy-only replacement,
  legacy-plus-new index cleanup, code-less insertions, same-society duplicate
  rejection, same code in another society, duplicate-data abort, protected-name
  guard, and record preservation.
- The actual `npm.cmd run migrate:building-code-index --workspace=@nivaas/backend`
  CLI passed against fresh `nivaas_disposable_cli_ff1b96606e61`; it replaced the
  recognized legacy index, preserved both seeded records, and left the partial
  unique index in place.
- Real MongoDB onboarding API integration: `3 passed, 1 skipped` in fresh
  `nivaas_disposable_property_da3827f2c020`; the browser-only case was disabled
  in that run.
- Authenticated Chrome + MongoDB onboarding integration: `4/4` in fresh
  `nivaas_disposable_browser_50a322c7661a`, including System Admin building
  creation, optional code, manager flat creation, duplicate and cross-building
  behavior, membership, primary/joint ownership, and residence checks.
- Frontend production build passed. It emitted the existing advisory that the
  minified JavaScript chunk exceeds 500 kB (built chunk: 514.86 kB).

Final focused commands:

```powershell
npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/property.test.ts
npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/lib/members.test.ts src/pages/AdministrationPages.test.tsx
npm.cmd run typecheck --workspace=@nivaas/backend
npm.cmd run typecheck --workspace=@nivaas/frontend
npm.cmd exec --workspace=@nivaas/backend -- tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck scripts/migrate-building-code-index.ts
npm.cmd run build --workspace=@nivaas/frontend
git diff --check
```

MongoDB integration commands were `npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/building-code-index-migration.integration.test.ts` and `npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/manager-onboarding.integration.test.ts`. Each invocation ran in a child process with a fresh random disposable database name and exact confirmation; the optional browser flag was enabled only for the Chrome run. The actual migration CLI was also run once against a separately seeded, fresh disposable database, never a protected target.

The initial sandboxed attempts were blocked by local HTTP bind (`EACCES`), Vite
temporary-file (`EPERM`), and TypeScript cache (`EPERM`) restrictions; the
focused checks were rerun with the required local execution access and passed.
Two first browser attempts exposed test-harness issues (unawaited Playwright
response and exact matching against labels containing help text); both were
corrected and the final authenticated browser run passed. No live application
database migration was attempted. The final read-only Git inspection showed
branch `main`, HEAD `dc7b8d1a4e4c01e8c03ba02061f31dbe40e7a734`, and many existing
modified and untracked files; all were preserved. `git diff --check` passed
with Git's existing DashboardPage LF-to-CRLF warning. The working tree is not
clean.

### Remaining property limitation and next action

- The protected `nivaas_demo` still contains the old sparse index, so code-less
  building creation there remains blocked until an authorized maintenance
  change applies the verified migration. Do not rerun integration tests against
  its configured `nivaas_test` URI and do not change `nivaas_demo` without
  explicit authorization.
- Current migration command is intentionally limited to disposable loopback
  databases. Any migration of a protected or hosted database needs a separate
  reviewed rollout with a target-specific read-only preflight, backup/restore
  plan, and explicit approval.
- The working tree has extensive existing modified and untracked work. Do not
  reset, clean, overwrite, stage, or discard it.
- Continue the agreed sequence: finish core functionality and focused
  verification; prepare Atlas, backend/frontend hosting and production
  configuration; deploy to a persistent EVM testnet and verify proofs; perform
  the final GPT-Taste UI overhaul; then run final acceptance tests and prepare
  the demo.

### Instructions for the next session

Treat the repository as the source of truth, preserve existing uncommitted
work, avoid repeating completed checks without a reason, and continue from this
checkpoint rather than restarting the project. Do not apply the protected
database index migration until it is separately authorized.

## Continuation checkpoint — 24 October 2026: owner transparency and governance-law review

### Owner transparency: completed scope

The active C: checkout adds authenticated read-only owner access to society
projects, quotation revisions/change requests, approval decisions, approved
budgets, comparison-safe vendor information, allowlisted audit history, and
blockchain proof status/verification. The root cause was route-level role
exclusion in project/approval/audit/proof reads and, in some routes, trusting
`User.societyId` without confirming an active `Ownership` relationship.
`backend/src/modules/property/owner-society-access.ts` now requires a matching
same-society active ownership record with effective dates for owner access.
Residence is deliberately not part of that check, so ending a tenancy or an
owner moving out does not remove ownership-based transparency. Ending the
ownership record revokes that owner's access. Cross-society requests return
not-found behavior. Mutating actions, including proof submission and all
committee/manager operations, retain their existing role restrictions.

Owners can navigate to Projects, Budget, Quotations, Audit Trail, and
Blockchain. Project rows link to their related quotations. Audit reads remain
restricted to public/operational allowlisted entity types; credentials, user
account setup events, complaint evidence, and other sensitive records are not
exposed. Owner vendor results omit contact and registration details. Residents
remain a separate explicit product scope: they can see permitted project
discovery summaries, but the implementation does not grant quotation,
financial, audit, proof, or voting access from residence or the `RESIDENT` app
role. No ownership, residence, membership, application-role, committee, or
voting record is automatically created or inferred by these read permissions.

The existing separate `Ownership` and `Residence` schemas already support
joint owners and a distinct tenant on the same flat; no schema migration was
needed. Membership and governance eligibility remain separate. A focused
integration fixture now uses persisted Building/Flat records for flat `002`,
two owner records, and a separate tenant residence; it checks that ending the
residence does not alter ownership or either owner's transparency access. That
newly strengthened fixture has **not** completed in the current shell because
MongoDB loopback access was denied; its earlier, less specific version and the
other owner-transparency API integration cases did pass against a fresh
disposable database (details below).

Completion updates/evidence do not yet have a general project-update API/model
in this checkout. Complaint/notice evidence remains private and complaint-
scoped. There is no general expense/payment ledger or actual payment
processing; the budget screen exposes only supported approved budget records.
Do not present these gaps as working owner transparency features. Blockchain
status is still read from the existing proof service and is not inferred from
audit integrity; owners can verify but cannot submit proofs.

### Maharashtra approval-rule research and current implementation

The official Maharashtra Law and Judiciary Department Act page publishes the
Maharashtra Co-operative Societies Act text as of 6 June 2025. The reviewed
Act/official English copy describes general-body authority subject to the
Act, Rules, and registered bye-laws (sections 72–73), and voting/member
conditions for housing societies (section 154B-11). Application role,
ownership, and residence are not interchangeable with society membership
evidence. See the [official Act text](https://lj.maharashtra.gov.in/en/document/the-maharashtra-co-operative-societies-act-1960-text-as-on-6th-june-2025-2/)
and [Commissioner for Cooperation English Act copy](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/maharashtra-co-operative-societies-act-1960-%20English%20Edition.pdf).

The [official Acts & Rules catalog](https://mahasahakar.maharashtra.gov.in/en/document-category/acts-rules/)
and [Commissioner for Cooperation site](https://sahakarayukta.maharashtra.gov.in/1124/Home)
were checked. The latter lists a 106-C housing-rules notification dated
22 June 2026, but its Gazette attachment was unavailable to inspect during
this task. Part IV-B Gazette No. 366, Notification
Sanini 0321/C.R.41/13-C, dated 18 June 2026, was therefore not independently
verified from primary Gazette wording. Third-party reproductions describe
Rule 106C-13(5)(b) as a narrow committee competence for one-time annual repair
and maintenance expenditure on society property, with membership-size caps.
That reproduced text is not treated as authenticated law, does not establish
a universal project/purchase threshold, and does not prove that every amount
above a cap automatically requires an SGM. The complete conditions, legal
effect, effective date, eligible membership-count basis, interaction with
the 2026 amendment Act, registered society bye-laws, and rules for other
spending categories remain unresolved. The evidence and source limitations
are recorded in `docs/MAHARASHTRA_GOVERNANCE_RULE_RESEARCH.md`.

No approval-routing behavior or threshold was changed on the basis of the
reproduced Gazette text. The existing single configurable project threshold
remains an MVP product setting, not a claim of legal compliance. Obtain the
primary Gazette, each society's registered bye-laws, and qualified legal
confirmation before encoding category-specific statutory routes, notice,
quorum, majority, tender, or SGM requirements.

### Files and verification in this checkpoint

Backend owner read scope was updated in project, quotation, approval, budget,
vendor, audit, and blockchain routes; frontend navigation and owner visibility
were updated in Projects, Quotations, Budgets, Audit Trail, and Blockchain,
with a project-to-quotation link. Focused unit/integration tests were added or
updated for same-society ownership, resident field redaction, audit entity
allowlisting, vendor privacy, approved-budget reads, proof read/verify versus
submit, and cross-society rejection. Relevant documentation was updated in
BUSINESS_RULES, SRS, API, DATABASE, ARCHITECTURE, and
IMPLEMENTATION_DECISIONS; the legal-source note is separate.

Commands and results from this owner-transparency work:

- Backend unit tests `tests/owner-society-access.test.ts` and
  `tests/audit-retrieval.test.ts`: **11/11 passed**.
- Frontend focused navigation/Projects/Quotations/Audit/Blockchain tests:
  **13/13 passed**.
- Backend and frontend typechecks: **passed**.
- Frontend production build: **passed**; Vite reported the existing large
  JavaScript chunk advisory (>500 kB).
- Six focused MongoDB integration files (project, quotation, approval, audit,
  blockchain proof, and budget): **28/28 passed** against a fresh generated
  `nivaas_disposable_owner_transparency_*` loopback `rs0` database. The helper
  required the generated database name as its cleanup confirmation; protected
  `nivaas`, `nivaas_test`, and `nivaas_demo` were not used. This run preceded
  the final same-flat fixture strengthening noted above.
- The final focused attempt for the strengthened project fixture did not
  execute: `connectIntegrationTestDatabase()` timed out because this shell
  returned `connect EACCES` for loopback HTTP test servers and could not reach
  the configured MongoDB loopback endpoint. Vitest consequently reported the
  project suite hook timed out (and unrelated port-based unit tests failed in
  that attempt); those are environment failures, not passing assertions.
- No authenticated browser session or live Hardhat transaction was run in
  this checkpoint. Earlier browser onboarding verification is recorded in
  the preceding checkpoint and was not repeated.
- Git status/diff commands currently report `fatal: this operation must be
  run in a work tree`; do not infer a clean tree. Existing user changes were
  preserved. Run `git diff --check` from the correctly attached repository
  terminal when Git access is restored.

### Current state and next milestone

Owner transparency is implemented for existing supported read APIs; the
strengthened same-flat MongoDB fixture still needs one successful rerun in a
permitted local test environment. Completion evidence and a general expense
ledger remain unsupported. Legal-category approval routing remains blocked
on primary Gazette wording and society-specific registered bye-laws.

Continue the agreed sequence: finish core functionality and focused
verification; prepare MongoDB Atlas, frontend/backend hosting, and production
configuration; deploy to a persistent EVM testnet and verify proofs; perform
the final GPT-Taste UI overhaul; then run final acceptance tests and prepare
the demo. The repository is the source of truth; preserve all existing
uncommitted changes and avoid repeating completed tests without a reason.

**End of handoff.**

## Continuation checkpoint — 24 October 2026: committee approvals and offline SGM records

Preserved the pre-existing uncommitted work. Added an immutable committee decision ledger, immutable active-committee electorate snapshot, and immutable committee result record. Committee decisions require the active `COMMITTEE_MEMBER` role, an active same-society User, a current CommitteeMember appointment under an active Committee, and a current COMMITTEE_APPROVAL ApprovalDecision. A Society Manager may finalize only after the separately calculated quorum and an unambiguous configured majority are satisfied. Initial product assumptions are two-thirds quorum rounded up and strictly more than half of recorded APPROVE/REJECT decisions; the rule version stores configurable ratios/maximum and audit evidence. These are product defaults, not legal conclusions.

Added an immutable `OfflineResolutionRecord` and manager-only confirmation API for published AGM/SGM resolutions. It requires a past scheduled meeting, a matching rule version, an eligibility snapshot, unique eligible attendance IDs, aggregate counts not exceeding attendance, minutes/evidence references and explicit confirmation. Quorum uses attendance; the majority uses the recorded counts. An approved SGM project resolution still passes the existing current ApprovalDecision/amount/quotation checks before project status changes. Meeting drafts can carry society-provided document references. This is reference metadata, not general file upload; existing Notice evidence remains limited to JPEG/PNG.

The Projects page now shows committee counts and permits committee approve/reject actions and manager finalization. The manager Notice Board governance disclosure supports offline attendance/count entry. Existing live-voting APIs were not expanded; the `/voting` browser route remains unavailable.

Affected docs updated: BUSINESS_RULES, SRS, ARCHITECTURE, DATABASE, API, IMPLEMENTATION_DECISIONS and UI_UX. AuditLog remains append-only; vote/attendance records remain off-chain; no blockchain contract or proof semantics changed.

Verification: backend TypeScript check passed; frontend TypeScript check passed; frontend focused tests passed 12/12; backend approval-policy, governance-foundation, and model tests passed 34/34; `MONGODB_TEST_URI` was not configured, so the added offline route integration case was not run. No protected database was targeted.

Remaining: project category/budget authority mappings are not defined by the active configuration contract. An attempted broad Approval Engine change was rejected by automatic review because it also added a mandatory approved-budget gate and altered routing for all projects. That change was dropped. Keep the current threshold route until an approved versioned category/budget mapping is specified and reviewed. Current 2026 Gazette wording and each society's registered bye-laws remain unverified; MVP assumptions must not be represented as legal guarantees.

### Verification follow-up — 24 October 2026

Added a pure committee outcome calculator and focused unit coverage for quorum
failure, independent quorum/majority calculation, tied votes, rejection,
unanimity, configurable AT_LEAST majority, and quorum caps. Strengthened the
guarded MongoDB approval fixture to check the member decision timestamp,
rationale and proposal revision, duplicate and unauthorized actions,
cross-society finalization, audit history, quorum rejection, and tied-majority
rejection. Strengthened the guarded governance fixture to cover eligible
attendee listing, ineligible attendance, cross-society confirmation, unanimous
counts, duplicate confirmation, audit history, and a quorum-failure
NO_DECISION. These MongoDB integration cases were added but not executed.

Passed in this follow-up:

- Backend unit tests: 38/38 across `committee-outcome.test.ts`,
  `approval-policy.test.ts`, `governance-foundation.test.ts`, and
  `models.test.ts`.
- Frontend committee/offline focused tests: 12/12 across the Projects and
  Governance pages and their API helpers.
- Backend and frontend TypeScript checks.
- `git diff --check`.

Integration tests were deliberately not run. The configured
`MONGODB_TEST_URI` resolves to protected database `nivaas_test`, not a guarded
`nivaas_disposable_*` database. Do not target it. Run the two focused
integration files only after a fresh local loopback `rs0` disposable database
and matching `NIVAAS_DISPOSABLE_DATABASE` confirmation are available. The
owner-transparency `project.integration.test.ts` fixture remains unverified;
do not retry unless loopback access is available.

The separate test-source TypeScript invocation bypassing the backend
`tsconfig.json` did not pass: it exposed existing test typing errors from the
Mongoose lean-result unions and request augmentations. The supported backend
source typecheck passed; the custom command does not establish integration
test correctness. The integration suites remain an outstanding verification
item.

Meeting files currently use typed society-provided document references, not
general binary attachments. Existing private evidence upload remains JPEG/PNG
for Notice and Complaint records; meeting proposal/quotation file attachment
support is still outstanding. Do not claim PDF or general meeting-file upload
support. The existing threshold rule determines committee versus general-body
routing; category/budget authority mappings, primary 2026 Gazette wording, and
society-registered bye-laws remain unresolved. No deployment, testnet action,
or unrelated UI work was performed.

### Governance integration and production build verification — 24 October 2026

Inspected the guarded committee and offline SGM integration fixtures. The
existing database harness accepts only a loopback MongoDB `rs0`, a database
matching `nivaas_disposable_*`, and an exact matching
`NIVAAS_DISPOSABLE_DATABASE` confirmation. It refuses protected database
names before connecting or clearing collections.

The configured URI currently names protected database `nivaas_test`; it was
not used. `Test-NetConnection 127.0.0.1 -Port 27017` reported no listener,
Docker could not access its engine pipe (`permission denied`), and `mongod` is
not installed. The repository `compose.yaml` uses a persistent named volume;
it was not started. No integration test ran and no MongoDB data was touched.
Do not retry the owner-transparency project fixture unless loopback access is
available.

When a fresh guarded database is available, the relevant focused command is
from `backend/`:

```powershell
node ../node_modules/vitest/vitest.mjs run --no-file-parallelism tests/integration/approval.integration.test.ts tests/integration/governance.integration.test.ts -t "committee member decision|below quorum|offline general-body|quorum failure"
```

Set `MONGODB_TEST_URI` to the fresh loopback `rs0` database and
`NIVAAS_DISPOSABLE_DATABASE` to that exact database name for the command. The
approval cases cover authorized and duplicate decisions, approval audit
history, cross-society denial, quorum failure and tie handling. The governance
cases cover eligible attendees, ineligible attendance, unanimous counts,
duplicate and cross-society confirmation, audit history, and offline quorum
failure. The committee scenario also finalizes a four-to-two rejection after
the tie is resolved. Do not use `nivaas`, `nivaas_test`, or `nivaas_demo`.

The frontend production build initially found an unsupported `size="sm"` on
the committee-finalization Button. Changed it to the shared component's
supported `size="default"`. The rerun of
`npm.cmd run build --workspace=@nivaas/frontend` passed, including its TypeScript
build, and the focused `ProjectsPage.test.tsx` passed 2/2. Vite emitted the
existing large-chunk advisory (523.61 kB minified JavaScript). No separate
typecheck or broad unit suite was rerun. `git diff --check` passed after the
fix; its output consists only of existing LF-to-CRLF notices.

The committee/offline workflow is ready for end-to-end browser acceptance
testing of the frontend paths, subject to an available safely configured
MongoDB test environment. MongoDB integration verification remains outstanding
until that environment is available. Meeting document references are still
metadata rather than general file attachments, and legal/category/budget
authority mappings remain unresolved as recorded above.

### Focused browser acceptance attempt — 24 October 2026

Inspected the available browser and existing local app without opening any
authenticated society data. The in-app browser showed the Nivaas sign-in page
with labelled Email and Password fields. Unauthenticated navigation to
`/meetings`, `/projects`, `/quotations`, `/notices`, `/audit`, `/blockchain`,
and `/voting` landed on `/login`. This verifies the unauthenticated guard only;
it does not verify any role-specific permission or authenticated workflow.

A read-only `GET /api/health` reported the backend and database as connected.
Before signing in or opening society screens, the configured MongoDB URI was
parsed without printing credentials: its database name is `nivaas_demo` on
loopback. `nivaas_demo` is protected, so no login, project/quotation read,
committee action, offline result submission, audit query, or proof query was
performed. No account credentials were read or used, and no database records
were changed. Do not use this connected backend for acceptance until an
explicitly authorized safe test database is configured.

The repository Playwright command
`npm.cmd run test:e2e -- tests/e2e/auth.spec.ts --workers=1` did not report a
test result; it stalled after startup warnings and was interrupted. A direct
PowerShell request to local port 5173 was denied with socket `EACCES`, while
the in-app browser could display the already-running frontend. A temporary
Vite process launched for a local binding check chose port 5174 because 5173
was occupied and was stopped immediately. No Docker, MongoDB, or
persistent-volume service was started.

Source inspection confirms the `Meetings` navigation item remains absent and
the authenticated `/meetings` route redirects to `/notices`; this route was
not browser-verified because the available backend points at protected demo
data. Audit Trail and Notice Board navigation entries exist, but their
authenticated screens were not opened. Society Manager project/quotation
access, committee quorum/outcome UI, offline SGM recording, owner transparency
(including a non-resident owner), and resident restrictions remain unverified
in browser. The guarded committee/offline MongoDB integration tests are still
blocked by the unavailable safe disposable `rs0` environment described above.

Browser result: the unauthenticated shell and auth redirects are verified.
The governance and owner/resident journeys are not ready to be marked
end-to-end accepted. Next step is to configure an isolated, authorized
`nivaas_disposable_*` database (or equivalent explicitly safe test environment)
and test accounts, then rerun the guarded governance integration cases before
authenticated browser acceptance. The owner-transparency project fixture must
remain untouched unless loopback access is available. No hosting, migration,
contract deployment, or UI redesign was started.

### Voting UI integration — 24 October 2026

Replaced the `/voting` unavailable placeholder with the existing
`GovernancePage` voting view. The view keeps committee project decisions,
ordinary general-body resolutions, and manager-recorded offline general-body
results in separate sections and uses their existing backend API helpers.

- Committee members see projects routed to committee approval, the proposal
  version, participation and quorum, approve/reject counts, required majority,
  and server outcome. They can submit an approve/reject decision with an
  optional rationale. The backend remains authoritative for active appointment,
  society scope, duplicate decisions, version validity and immutable history;
  API validation failures are surfaced in the page status. Managers can request
  finalization only when the server summary says quorum is met. The interface
  does not calculate or override the result.
- General-body members see their backend-reported vote or eligibility error.
  A 403 is displayed as the backend's eligibility explanation; service/API
  failures are distinguished as an inability to verify eligibility. The page
  keeps the existing one-vote API behavior and displays server result counts,
  quorum, outcome and proof status.
- Managers can record an offline result for a snapshotted draft from Voting.
  The existing eligible-attendee endpoint supplies the private attendance
  choices; the form records attendance, SHOW_OF_HANDS or non-secret POLL,
  aggregate counts, minutes/evidence references and explicit confirmation.
  Backend rejection text is shown, and successful submission displays the
  backend-returned result and refreshes the resolution. Meeting notice,
  agenda, and proposal/quotation/evidence references are shown when present.
- The existing `ProjectsPage` committee UI and APIs were not rewritten. The
  dead placeholder page and its test were removed. No live electronic voting,
  anonymous ballots, election voting, upload infrastructure, threshold changes,
  backend behavior, or blockchain behavior was added.

Focused verification actually run after the final UI edits:

```powershell
npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/pages/GovernancePage.test.tsx src/pages/ProjectsPage.test.tsx src/lib/governance.test.ts src/routes/navigation.test.ts
npm.cmd run typecheck --workspace=@nivaas/frontend
npm.cmd run build --workspace=@nivaas/frontend
git diff --check
```

Results: 4 focused test files passed, 15/15 tests; frontend typecheck passed;
frontend production build passed; `git diff --check` passed. Vite emitted its
existing advisory for a 529.11 kB minified JS chunk. Git emitted existing
LF-to-CRLF working-copy notices during diff checking. No backend tests or
MongoDB integration tests were rerun, and no database was accessed. No
authenticated browser acceptance was performed: the last verified backend
configuration targets protected `nivaas_demo`, while the isolated loopback
MongoDB fixture remains unavailable. The frontend tests verify rendering,
role separation, quorum/majority display, eligibility messaging and offline
form availability, but they do not verify persistence or complete browser
flows.

Remaining UI limitation: the existing committee-summary API returns aggregate
counts, not the authenticated committee member's own recorded decision. A
duplicate submission is blocked by the backend and its validation response is
shown, but the page cannot pre-display that member's prior committee choice.
Next milestone: run the guarded committee/offline governance integration cases
against a fresh explicitly confirmed disposable `rs0` database, then perform
role-based browser acceptance with safe test accounts and that isolated
backend. Do not use protected `nivaas`, `nivaas_test`, or `nivaas_demo` data.

## Project lifecycle and financial tracking — 24 October 2026

Implemented the project lifecycle extension using the existing Project, Budget,
BudgetCategory, Evidence, AuditLog, quotation change-request, and approval
architecture. No separate project/financial module or blockchain behavior was
introduced beyond the expense records and project update records described
below. Existing unrelated changes in the working tree were preserved.

### Implemented

- `ProjectUpdate` is a new append-only collection for progress/completion
  timeline entries. Society Managers can record updates only while a project
  is IN_PROGRESS. Each entry is audited. JPEG/PNG progress and after-photos
  use the existing private Evidence adapter with a 5 MiB limit and hash check.
- Project completion now requires a completion update with invoice reference,
  a private AFTER_PHOTO, and a final cost no higher than the approved project
  amount and no lower than recorded expenses. Completion status and final cost
  are updated transactionally with the audit event. Society Manager is the
  current product authorization; formal completion authority remains
  unresolved.
- `Expense` records are append-only. Manager-only creation is limited to an
  APPROVED/IN_PROGRESS project linked to an APPROVED budget and one of its
  categories. Decimal-safe amounts are checked against both the remaining
  approved project amount and category allocation. Expense, budget/category
  totals, and audit event are written in one transaction.
- Project amount overruns require the existing quotation change-request and
  approval path before expense retry. No budget/category revision route is
  configured; an over-allocation attempt fails closed, without recording the
  expense or silently increasing the allocation. This leaves the approval path
  for annual budget/category overruns unresolved.
- Manager and committee reads retain operational expense fields. Verified
  same-society owners can see public project financial summaries and progress
  records; invoice references and update actor identity are omitted. Residents
  do not receive expense or project-evidence access through residence. Project
  photos and expense records remain off-chain and no blockchain proof is
  generated by these changes.
- Updated API, Database, Architecture, Business Rules, and Implementation
  Decisions documentation. These behavior choices are product assumptions,
  not legal guarantees. Gazette/bye-law rules, completion authority, budget
  amendment route, and broader financial visibility remain open questions.

### Verification actually run

- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/expense-calculations.test.ts tests/committee-outcome.test.ts tests/approval-policy.test.ts` — passed, 3 files / 11 tests.
- `npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/pages/ProjectLifecyclePanel.test.tsx src/pages/ProjectsPage.test.tsx src/pages/QuotationsPage.test.tsx` — passed, 3 files / 6 tests.
- `npm.cmd run typecheck --workspace=@nivaas/backend` — passed after fixing missing decimal comparator import, an unused result binding, and the update serializer argument discovered by the first run.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Vite reports the existing large-chunk advisory; the main JS chunk is 544.90 kB minified.
- `git diff --check` — passed; Git emitted its existing LF-to-CRLF working-copy notices.

The guarded `backend/tests/integration/project.integration.test.ts` was not
run. It clears collections and requires a fresh loopback MongoDB `rs0` database
whose name matches `nivaas_disposable_*` and the explicit
`NIVAAS_DISPOSABLE_DATABASE` confirmation; the repository's last verified
backend points to protected `nivaas_demo`, and no safe disposable database was
available/confirmed for this run. No integration result or persistence has
been claimed. Do not start MongoDB or target `nivaas`, `nivaas_test`, or
`nivaas_demo` without separate authorization.

### Remaining limitations and next milestone

Budget/category amendment approval is not represented, so category cap
exceedance remains blocked. PDF invoice upload and payment reconciliation are
not part of this workflow. Committee confirmation for project completion and
formal completion evidence authority remain TBC. The focused UI tests and
production build do not prove database persistence or complete browser flows.
The next concrete milestone is to run the guarded project lifecycle integration
case on a fresh explicitly confirmed disposable `rs0` database, then accept the
Manager and non-resident Owner journeys in a browser against that isolated
backend. Keep protected databases untouched.

## GPT-Taste visual refresh — 24 October 2026

Applied a shared Nivaas visual refresh to the existing React application. The
installed GPT-Taste skill's required randomized design preflight was completed;
its GSAP and alternate-font requirements were overridden by the explicit
project/user requirements for Anime.js and the Nivaas-approved Space Grotesk,
Syne, and JetBrains Mono stack. The design is an authenticated operational
workspace, so no marketing-only CTA, fabricated metrics, stock imagery, or
mock records were introduced.

### Implemented

- Refined shared theme tokens around the approved cream, ink, red, blue and
  accent palette, with warmer borders, rounded surfaces, a restrained ambient
  background, and consistent headline/body/technical typefaces.
- Restyled the responsive application shell, sidebar active state, brand mark,
  page headers, cards, inputs, tables, hover/focus states and mobile table
  overflow. Existing role-based navigation and mobile dialog behavior remain.
- Updated the dashboard title and workspace layout. Platform counts still come
  only from the authenticated admin APIs; workflow cards link to existing
  screens and show no invented society activity.
- Kept the existing Anime.js page entrance and press feedback. Motion is gated
  by `prefers-reduced-motion`; reduced-motion CSS also removes transition and
  animation effects.
- No API, backend, governance, database, permission, or blockchain behavior was
  changed. The existing module screens retain their data, forms, actions, and
  loading/error/empty behavior under the shared styles.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 25 files / 75 tests.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed; Vite reports the
  existing large-chunk advisory (545.05 kB minified JavaScript).

No authenticated browser or device-size visual review was performed. The
remaining visual gap is visual acceptance at desktop/tablet/mobile widths and
role-specific sessions. Existing frontend tests use mocked API behavior and do
not establish persisted browser workflows.

## Nivaas UI redesign refinement — 24 October 2026

This refinement replaces the generic rounded-card treatment from the prior
visual pass with an open, content-led interface. The screenshot mentioned in
the request was not attached or available in this chat context, so this work
used the reported issues and the current source implementation as its visual
reference. No mocked data or marketing imagery was introduced.

### Implemented screens and presentation

- **Application shell and dashboard:** removed the oversized framed header,
  duplicate route title, decorative rules, and repeated workspace labels. The
  dashboard is now a compact role-filtered record index with real society and
  account counts only for System Admin, sourced from the existing APIs.
- **Projects and approvals:** project proposals retain their full lifecycle,
  approval evaluation, committee decisions, history, quotation links and
  expense/update actions. The list uses a focused proposal layout rather than
  repeated rounded boxes. Committee/general-body decisions remain in their
  existing governed workflows.
- **Budget and quotations:** budget allocations, spending and remaining totals
  are presented as financial figures; quotation versions remain an ordered
  revision timeline with existing change-request actions.
- **Voting and notices:** meeting, resolution, voting and outcome screens keep
  their existing backend states and controls. Notices read as announcement
  entries, with formal meeting publication still distinct from everyday
  notices.
- **Complaints and Members & Flats:** complaint lists and timelines are
  differentiated from the multi-step account, flat, membership and property
  relationship forms. Ownership, residence, application role and membership
  remain separate records.
- **Societies, Users & Admin, Audit Trail and Blockchain:** administrative
  records use open list rows; audit activity reads as a ledger; blockchain
  verification uses a distinct navy verification panel. Proof and integrity
  meanings remain separate.
- **Loading, empty, error and permission states:** replaced generic card/icon
  blocks with concise text, whitespace and a small loading indicator. Status
  text remains explicit and is no longer presented as a pill by default.
- **Authentication screens:** sign-in and account setup retain a focused form
  surface consistent with the redesigned application.

Anime.js now animates the page heading and the dashboard destination links,
with short stagger timing. Button press feedback remains Anime.js-driven.
Reduced-motion preferences disable the Anime.js scope and CSS transitions.
The existing font packages and palette are unchanged. No dependency or backend
behavior was changed.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 25 files / 75 tests.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Vite reports the
  existing large-chunk advisory (543.10 kB minified JavaScript).

### Remaining gaps

- Payments remains the existing unavailable-MVP placeholder; there is no
  payment records API or working payment flow to redesign. The dashboard does
  not invent a payment count or status.
- No authenticated browser walkthrough or desktop/tablet/mobile visual review
  was available during this task. Frontend tests use mocked API responses and
  do not prove persisted flows or pixel-level responsive acceptance.
- Approvals remain embedded in Projects and Governance/Voting as specified;
  there is no separate Approvals route in the current frontend.

## Visual consistency refinement — 24 October 2026

Refined the existing GPT-Taste UI implementation around the approved Nivaas
cream, ink, red, navy and accent palette. This was a focused consistency pass;
no API, authorization, governance, data-flow or backend behavior was changed.

### Implemented

- Made the cream canvas the shared surface for the sidebar, ordinary records,
  forms and proof details. Shared fields now use a consistent subtle accent tint
  instead of translucent white. Status and error colors remain semantic.
- Removed the dominant navy fill from blockchain proof status. Proof details now
  use open cream space, a restrained navy edge for hierarchy, and retain their
  actual verification and warning/error states.
- Changed project proposals to full-width ledger rows, so a single proposal can
  use the available content width. Removed the near-white card fill and navy
  stripe. Blue-tinted contextual blocks now use an open treatment.
- Removed the Audit record width cap and fixed its filter action row to fit its
  three-column form grid. Blockchain record selection and proof status now share
  the same available width and tighter vertical rhythm.
- Refined sign-in as a modest accent-tinted form surface with a brand-red edge,
  matching the shared field and spacing language without a white card.
- Because task forms and semantic surface tokens are shared, the same change
  applies to Budget, Quotations, Voting, Notices, Complaints, Members & Flats,
  Societies, Users & Admin and other implemented workflow forms. Payments still
  routes to the existing module placeholder; no Payments data screen exists to
  restyle in this checkout.

### Verification

- Frontend tests: `npm.cmd test --workspace=@nivaas/frontend` — passed,
  25 files and 75 tests.
- Typecheck: `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- Production build: `npm.cmd run build --workspace=@nivaas/frontend` — passed.
  Vite reports the existing 543.09 kB main JavaScript chunk advisory.
- `git diff --check` — passed; Git emitted only working-copy line-ending notices.
- No new dependencies were added. Authentication, role permissions, real API
  data, and existing reduced-motion/Anime.js behavior were left intact.

### Remaining visual review

The screenshot referenced for this pass was not available in the message context
exposed to this workspace, so verification used the reported issues and source
inspection rather than a side-by-side screenshot comparison. No authenticated
browser visual review was performed.

## Form layout and data-backed dashboard — 24 October 2026

This follow-up used the quotation, header, notice-filter and dashboard
screenshots supplied with the request. It fixes the shared form-grid behavior
behind the stretched quotation amount field, removes the repeated header
identity, and replaces the dashboard's module-link list with role-scoped
summaries from persisted APIs.

### Implemented

- Shared form grids now align fields at the top so a nested vendor form cannot
  stretch the amount control. Inputs/selects/textareas fill their own field
  column and can shrink safely; the quotation amount remains a numeric input
  with a deliberate control height. Long descriptions remain full-width.
- Notice category filtering now uses a responsive, aligned label/select/count
  layout. The header keeps one identity area with name, role and sign-out.
- The dashboard loads role-appropriate platform or society data, shows
  available project status, latest approved budget, open complaint totals,
  published notices, upcoming manager meetings, and governance participation
  only when the relevant API confirms the member is eligible and has not voted.
  Each resource has its own loading, error/retry and empty presentation; quick
  links are secondary navigation. No sample metrics are used.
- Added a read-only, same-society committee decision inbox endpoint for the
  committee member dashboard. It requires the `COMMITTEE_MEMBER` role and
  returns only current decisions awaiting that member. Its route, service call,
  integration assertions and API documentation are updated together.
- Updated the API specification version and documented the new endpoint.

### Verification

- Frontend tests: `npm.cmd test --workspace=@nivaas/frontend` — passed,
  26 files and 83 tests, including dashboard calculation/role-visibility,
  quotation, notice and navigation coverage.
- Backend tests: `npm.cmd test --workspace=@nivaas/backend` — passed,
  30 files and 234 tests. Local loopback access was enabled for this run after
  the sandbox initially blocked test-server connections.
- Focused committee approval integration test — passed (1 test; 68 unrelated
  integration tests skipped). It used a generated disposable local MongoDB
  database and verified authorization, pending visibility and removal after
  voting.
- Frontend and backend typechecks — passed.
- Frontend production build — passed. Vite reports the existing large-chunk
  advisory; the main bundle is 552.14 kB minified.
- `git diff --check` — passed, with only Git working-copy line-ending notices.
- No dependencies were added. Existing authentication, governance decisions,
  roles and data APIs remain authoritative.

### Remaining review

- The screenshots were inspected, but no authenticated browser walkthrough was
  performed at multiple viewport sizes. Responsive behavior is covered by the
  layout rules and component tests, not a full visual acceptance session.
- Dashboard project summaries use the existing paginated society/project APIs;
  they show recent records rather than presenting a partial page as a complete
  project total. The committee inbox is the only added API route.

## Dashboard typography and spacing fix — 24 October 2026

Kept the dashboard's existing layout, palette, content and proportions. Added a
shared record-row grid for project titles and status labels, with independent
line heights, a stable column gap and natural long-title wrapping. At mobile
widths the status moves below the title. Applied the same row treatment to
committee decisions and governance outcomes, and added wrapping-safe typography
to published notice summaries. No data, metrics, APIs, role checks or motion
behavior changed.

Verification: frontend tests passed (26 files, 83 tests); frontend typecheck
passed; production build passed with the existing large-bundle advisory (552.35
kB main JavaScript chunk); `git diff --check` passed. No new dependencies were
added.

## Brand assets and login experience — 24 October 2026

- Added optimized supplied brand artwork under `frontend/public/assets/`:
  `nivaas-wordmark.png` (transparent full wordmark), `nivaas-mark.png`
  (architectural mark for the sign-in composition), `nivaas-mark-small.png`
  (square small-size crop for the application brand) and
  `nivaas-favicon.png` (64px browser-tab icon). The source artwork was retained
  in design and aspect; only size and framing derivatives were prepared.
- Replaced the generic sidebar N badge with the supplied architectural mark and
  wired the favicon into the frontend document.
- Reworked the sign-in page as a responsive editorial brand experience using
  the supplied wordmark and architectural visual, while retaining the existing
  login request, redirect, setup link, validation, errors and loading behavior.
- Used the existing Anime.js dependency for a restrained staggered entrance,
  low-amplitude pointer depth and input/button feedback. Entrance and pointer
  motion respect reduced-motion preferences; form controls retain visible
  keyboard focus and native labels/autocomplete.
- Added a focused login rendering test for brand asset paths and sign-in/setup
  access. No backend or authentication contract was changed and no dependency
  was added.

Verification: `npm.cmd test --workspace=@nivaas/frontend` passed (27 files,
84 tests); `npm.cmd run typecheck --workspace=@nivaas/frontend` passed;
`npm.cmd run build --workspace=@nivaas/frontend` passed. Vite reports the
existing large-chunk advisory (555.96 kB minified main JavaScript bundle).

## Brand identity and authentication refinement — 24 October 2026

- Inspected the newly supplied architectural mark at 1312×1199. Its PNG is
  32-bit RGBA with transparent corners. The prior application mark was an
  opaque RGB PNG with a cream rectangle, which caused the visible background
  mismatch. Replaced it with a tightly framed, transparent 1000×736 derivative
  at `frontend/public/assets/nivaas-mark.png`; generated transparent 160×160
  sidebar and 64×64 favicon variants at `nivaas-mark-small.png` and
  `nivaas-favicon.png`. The existing 1200×400 transparent wordmark remains the
  source used in the application.
- The sidebar now pairs the architectural mark and wordmark. The favicon and
  Apple touch icon use compact mark assets. The login and account-setup screens
  share a responsive brand-led composition; the full wordmark, architectural
  mark, exact requested headline/copy/tagline and three value statements are
  integrated with their real forms. Form surfaces remain open rather than
  appearing as generic cards, and primary auth actions use the Nivaas red.
- Both auth routes retain their existing request, credential, validation,
  error, success and navigation behavior. Anime.js now scopes a restrained
  staggered reveal for brand/story/form and a subtle input-focus response.
  Reduced-motion users see the static end state. No backend/API/role behavior
  or dependency changed; authenticated pages were left intact.

Verification: frontend tests passed (29 files, 86 tests), including focused
login, setup and sidebar-brand rendering checks; frontend typecheck passed;
production build passed. Vite reports the existing large-chunk advisory
(555.84 kB minified main JavaScript bundle). `git diff --check` passed with
working-copy line-ending notices only. A browser screenshot walkthrough was
not available because this environment has no installed Playwright Chromium
executable. The supplied alpha asset and its cream-background composite were
inspected directly.

## Signature interactive login architecture — 24 October 2026

- Added `frontend/src/components/auth/ArchitectureScene.tsx`, a self-contained
  Three.js scene built from a terracotta portal, stepped cream residential
  volume, navy tower, courtyard plinth, narrow blue window recesses and
  restrained architectural foliage. A gently moving camera, directional,
  hemisphere and portal lights add depth; a soft shadow plane grounds the
  installation. The scene uses the Nivaas palette and the supplied transparent
  mark remains its fallback.
- The sign-in route loads the scene as a dynamic chunk only on desktop, when
  the scene approaches the viewport and reduced motion is not requested. The
  mobile and reduced-motion presentation keeps the supplied static artwork.
  Unsupported intersection observation, Three.js import failures, WebGL
  initialization failures and context loss also leave the fallback visible.
- Pointer movement on the scene gently tilts the installation and shifts its
  key light. Rendering is event-driven: frames run while the scene settles,
  then stop; resize and pointer events render as needed. Pixel ratio is capped
  at 1.5, shadow resolution is bounded, geometries/materials are disposed on
  unmount, and no perpetual animation loop was introduced. Existing Anime.js
  remains responsible for the page reveal; no second motion library was added.
- Added runtime dependency `three` and development-only `@types/three`. The
  scene is referenced only from `LoginPage`; account setup and authenticated
  pages retain their existing presentation and behavior. Authentication,
  credential setup, APIs, permissions, validation and navigation are unchanged.
- The focused login test checks the static fallback and decorative
  accessibility treatment. No backend or deployment files were changed.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 29 files / 86 tests.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. The emitted
  `ArchitectureScene` lazy chunk is 556.88 kB minified / 142.14 kB gzip. The
  main entry is 557.89 kB / 161.33 kB gzip; compared with the previous
  555.84 kB entry report, its minified size increased by 2.05 kB. The scene
  adds a notable download only on the desktop sign-in experience when it is
  near the viewport. Vite reports the existing main-chunk advisory and now
  reports the separately lazy-loaded Three.js chunk above 500 kB as well.
- `git diff --check` — passed; Git printed only existing working-copy
  line-ending notices.
- A local Vite preview started successfully, but the Codex in-app browser
  could not connect to `127.0.0.1:4173` or `localhost:4173` (both returned
  `ERR_CONNECTION_TIMED_OUT`). No browser/WebGL visual walkthrough or device
  performance measurement was therefore performed; the component was verified
  by TypeScript, React tests and the production build only.

### Remaining review

- Visually review the 3D composition and pointer response in a browser that can
  reach the local dev server, including a narrow viewport and WebGL-disabled
  fallback. The supplied transparent architectural mark is the static fallback
  for mobile and reduced-motion users.
- Measure frame rate and GPU memory on representative lower-power devices if
  this scene is retained for production. No other authenticated screens use
  Three.js in this milestone.

## Login environment and architectural motion — 24 October 2026

- Replaced the previous logo-like 3D concept with a scene of layered residential facades, staggered building profiles, window planes, terraces and suspended architectural panels. The actual Nivaas architectural mark stays a crisp supplied image in the editorial content; it is not modeled in Three.js.
- `frontend/src/components/auth/AuthExperience.tsx` now composes a full-viewport SVG architectural fallback, restrained CSS atmosphere (ambient facade drift, subtle light sweep and texture), and the lazy-loaded WebGL scene behind the login content. Brand copy and the form remain foregrounded, with a cream translucent form surface for legibility. At mobile widths the form moves into a single-column composition and remains immediately reachable.
- `frontend/src/components/auth/ArchitectureScene.tsx` uses the existing Three.js dependency for real material depth, directional/hemisphere/point lighting, soft bounded shadows and layered pointer parallax. Rendering is event-driven and settles to a stop after pointer movement; no perpetual render loop or post-processing was added. Pixel ratio is capped at 1.25, the lazy scene loads only on non-coarse desktop when reduced motion is not requested, and geometries/materials/renderer resources are disposed on unmount.
- The SVG/CSS composition remains visible on mobile, touch-first devices, reduced-motion settings, WebGL initialization failures, context loss, and dynamic import failure. Anime.js runs the atmosphere/content reveal and existing input/button feedback; CSS handles slow ambient movement. Reduced-motion preference skips the Anime.js scope and disables CSS movement. Authentication and account setup code, API calls, permissions and validation flows were not changed.

### Verification actually run for this refinement

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 29 files / 86 tests, including the login brand/auth-access test.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed after the final source changes.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Emitted login scene chunk: `ArchitectureScene` 554.85 kB minified / 141.50 kB gzip. Main entry: 561.98 kB / 163.05 kB gzip; stylesheet: 50.72 kB / 10.21 kB gzip. Vite emits its >500 kB advisory for both the main entry and the lazy Three.js scene; the scene is split from the initial app bundle but remains a substantial download when enabled on desktop login.
- `git diff --check` — passed; Git reported working-copy line-ending notices only.
- Browser visual/WebGL verification and device performance profiling were not completed in this environment. The earlier Codex in-app browser attempt could not reach the local Vite server (`ERR_CONNECTION_TIMED_OUT` for localhost and 127.0.0.1), so visual quality and actual GPU/frame-rate behavior still need a browser/device walkthrough.

## Login card alignment correction — 24 October 2026

- The login form panel had been stretching to the full dashboard-column height and using the default row direction for its children. This caused the form surface and permission note to sit beside one another, while flex sizing squeezed the actual inputs.
- The panel now uses a compact, centered vertical flow. Form fields and the submit button explicitly share the available content width; the permissions note sits beneath the form, and the setup sentence wraps at normal word boundaries. Updated the card's intrinsic height, padding and small-screen alignment without changing the animated architectural backdrop, palette, authentication behavior or setup flow.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 29 files / 86 tests.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Main entry: 561.98 kB minified / 163.05 kB gzip; lazy scene: 554.85 kB / 141.50 kB gzip; stylesheet: 51.37 kB / 10.31 kB gzip. Vite continues to warn that the JavaScript chunks exceed 500 kB.
- `git diff --check` — passed with working-copy line-ending notices only.

## Authenticated application motion system — 24 October 2026

- Extended `frontend/src/lib/motion.ts` into the shared Anime.js motion layer. `usePageMotion` now observes page headers, real record rows, dashboard metrics, status/alert feedback and verification panels; visible targets enter with a short transform/opacity reveal, and newly inserted API-backed records are observed as they arrive. The observer animates at most twelve visible targets per batch, disconnects on page cleanup and skips animation when reduced motion is active. Content remains present and readable before an observer fires.
- Added one-time header, route-entry and mobile drawer entrance helpers and applied them in `AppShell.tsx`. The native `<dialog>` drawer remains the accessible keyboard/focus-trapped control; sidebar links use existing Anime.js press feedback and restrained CSS hover transitions. Status badges now transition their semantic color changes without changing labels or states.
- Added `frontend/src/components/ui/ProgressTrack.tsx`, an accessible, reduced-motion-safe Anime.js progress track. Dashboard and Budget use it only when the authorized real budget record has a numeric positive allocation; the percentage is derived from recorded spending and capped visually at 100%, while the accessible value text retains the actual amounts. No project completion percentages, activity, API results or governance states were invented.
- The shared page hook applies the reveal pattern across Dashboard, Projects and lifecycle records, Budget, Quotations, Governance/Voting, Notices, Complaints, Members & Flats, society/user administration, Payments placeholder, Audit Trail, Blockchain and governance settings. Blockchain proof records reveal only after their actual returned state is rendered; there is no simulated confirmation or mining sequence. Authentication, role filtering, endpoints, authorization and business rules are unchanged. No dependency or backend changes were made.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 30 files / 88 tests, including accessible progress value/clamping and invalid-allocation coverage.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Main entry: 564.98 kB minified / 164.12 kB gzip; stylesheet: 52.90 kB / 10.52 kB gzip; lazy login scene: 554.85 kB / 141.50 kB gzip. Relative to the preceding recorded build, the main entry increased by 3.00 kB minified / 1.07 kB gzip and CSS by 1.53 kB / 0.21 kB gzip. Vite continues to report the >500 kB advisory for main and lazy scene chunks; the authenticated motion code adds only a small increment.
- `git diff --check` — passed with the repository's existing working-copy line-ending notices.
- No browser rendering walkthrough was available in this run. The previously attempted local Vite browser connection timed out; visual transitions, mobile drawer behavior and representative-device performance still warrant browser verification.

## Authenticated architectural overview and motion stabilization — 24 October 2026

- Removed the route-wrapper entrance and the page-wide `IntersectionObserver` / `MutationObserver` reveal system. Previously, every navigation replayed a route fade/translation while each mounted page independently staggered headers, rows, alerts and records; this was the source of repeated motion and visible page-change jerk. Route content and the shared header now render immediately, without entrance opacity or position changes.
- Kept the useful, bounded interactions: Anime.js press feedback, the mobile navigation drawer transition, the reduced-motion-aware budget `ProgressTrack`, and the existing login environment motion. No second animation library or dependency was added.
- Added a shared shell surface treatment using the existing cream canvas, a faint texture, restrained translucent topbar, warm sidebar tint and shared ivory/edge/warm-surface tokens. The authenticated area now carries the login environment's warmth without changing its palette or introducing a dark/glass-heavy dashboard.
- Added `frontend/src/components/dashboard/DashboardArchitectureExperience.tsx` and the dynamically imported `DashboardArchitectureScene.tsx`. The operational view combines actual authorized project records with available pending or recently decided governance records. Each listed record maps to one architectural structure; its exact title and backend status remain visible in the accessible record selector and selected-record caption. Selecting a record moves the camera focus and emphasizes its structure. Status material accents are derived from returned status strings, while the text remains the authoritative state. No progress values, extra counts, activity or society data are generated.
- The scene uses Three.js already in the project. It renders on fine-pointer desktop when reduced motion is not requested, caps pixel ratio at 1.25, bounds shadow-map resolution at 512, uses a demand-driven pointer/selection settling loop, and disposes renderer resources when it unmounts. Narrow/touch layouts, reduced-motion settings and scene/import/context failures use a lightweight SVG architectural view with the same real record controls.
- The dashboard keeps role-filtered API calls and existing loading/error/empty states. Platform Admin remains on platform society/account summaries; residents and members only see records returned by their existing role-scoped endpoints. No API, backend, authentication, permission or governance logic changed.
- Budget continues to use the existing real-allocation `ProgressTrack`. Projects now presents its API-ordered immutable progress updates as a chronological timeline. Voting results add a compact segmented track sized only from the returned YES/NO/ABSTAIN counts. Blockchain proof details add a three-checkpoint view for record integrity, registry proof and transaction receipt; each checkpoint displays only fields returned by the selected record's verification response. The audit selector remains the interaction that changes the proof view. No additional Three.js scenes were added to Projects, Voting, Budget or Blockchain because their actual timelines, counts and proof fields are clearer as compact spatial data views.

### Verification actually run

- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd test --workspace=@nivaas/frontend` — passed, 33 files / 93 tests. Added checks for dashboard record accuracy, keyboard-operable selection and reduced-motion fallback, plus recorded vote-distribution and proof-checkpoint accuracy.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Main entry: 570.16 kB minified / 165.33 kB gzip; stylesheet: 58.10 kB / 11.48 kB gzip; dashboard scene module: 4.35 kB / 2.14 kB gzip; shared Three.js runtime: 547.58 kB / 138.27 kB gzip; login scene: 7.01 kB / 2.93 kB gzip. The dashboard scene and Three runtime are separate from the initial entry and load lazily. Relative to the previously recorded authenticated-motion build, the entry grew by 5.18 kB minified / 1.21 kB gzip and CSS by 5.20 kB / 0.96 kB gzip. Vite continues to warn that the main and Three.js chunks exceed 500 kB minified; Three.js transfers at 138.27 kB gzip when loaded.
- `git diff --check` — passed; Git showed existing line-ending notices only.
- The local browser opened the running application successfully at the login route. I did not authenticate, so the authenticated dashboard and its live WebGL rendering were not visually exercised in a browser. The reduced-motion scene fallback and record selection were exercised in Vitest; browser layout, pointer response, WebGL failure handling and device performance remain unverified.

### Remaining work

- Visually inspect the authenticated 3D dashboard with authorized test data in desktop and mobile browsers, including a WebGL-disabled device and reduced-motion preference.
- Consider a later bundle optimization for the shared Three.js runtime, which remains the largest lazy download. Do not load this runtime on the initial auth or app entry.
- Visually inspect the authenticated dashboard and workflow treatments with authorized test data at desktop and mobile widths. No authenticated browser walkthrough occurred in this run.
- The 3D architecture view is currently dashboard-only. Continue to add 3D to another workflow only if an authenticated browser walkthrough identifies a clear spatial interaction that improves its real task.

## Dashboard visualization rollback — 24 October 2026

- Per the follow-up request, removed only the dashboard's architectural 3D visualization and its dashboard-specific styles. Restored the prior dashboard composition: recent API-backed project records as a list, followed by the committee decision section when authorized and the existing governance, approved-budget, open-complaint, published-notice and manager-meeting summaries in their previous two-column layout and spacing.
- Removed the dashboard-only 3D component, lazy scene and scene test. Kept the login architectural experience and transparent branding, shared shell and navigation-motion stabilization, and the distinct Projects lifecycle, Voting outcome and Blockchain proof presentations. No other pages were changed as part of this rollback.
- Dashboard API calls, role scoping, permissions, metrics, loading/error/empty states and business logic are unchanged. No data or governance behavior was introduced.
- This note supersedes the preceding dashboard-scene implementation entry: the authenticated dashboard no longer contains the 3D scene.

### Verification for the rollback

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 32 files / 92 tests.
- `npm.cmd run typecheck --workspace=@nivaas/frontend` — passed.
- `npm.cmd run build --workspace=@nivaas/frontend` — passed. Main entry: 565.22 kB minified / 164.12 kB gzip; stylesheet: 55.43 kB / 11.02 kB gzip; lazy login `ArchitectureScene`: 554.85 kB / 141.50 kB gzip. The dashboard scene chunk is absent. Vite still warns that the main entry and lazy login scene exceed 500 kB minified.
- `git diff --check` — passed (result recorded after the focused review below).
- The dashboard was not visually exercised in an authenticated browser during this rollback; the local browser walkthrough remains a follow-up limitation.

## Deployment preparation — 24 October 2026

- Added `docs/DEPLOYMENT.md`, a frontend public-variable template at
  `deployment/frontend.env.example`, a server-only template at
  `deployment/backend.env.example`, and root `vercel.json`. Vercel is
  configured to install from the monorepo lockfile, build only
  `@nivaas/frontend`, publish `frontend/dist`, and fall back to the SPA entry
  point. The backend's existing workspace build/start commands work
  independently from the repository root; the documented Render example
  uses `/api/health` as its readiness check. Nothing was deployed.
- Hardened production backend configuration parsing: with
  `NODE_ENV=production`, startup now requires a named remote MongoDB URI with
  TLS enabled, one exact HTTPS CORS origin, a JWT secret of at least 32 bytes,
  and an explicit positive JWT access-token TTL. Existing local configuration
  remains optional; local bootstrap/setup delivery remains prohibited in
  production. Added production-config regression tests. No auth token format,
  API contract, permission or account behavior was changed.
- Updated `README.md` to describe the implemented workspaces, link the
  deployment guide and correct the local integration-test database instructions.
  Updated `.env.example` with the disposable-database confirmation variable;
  preserved existing local settings.
- Findings/gates: MongoDB transactions require a replica set; schemas declare
  indexes and installed Mongoose reports `autoIndex: true`, but there is no
  versioned production migration runner. The existing building-index migration
  refuses anything except a confirmed loopback disposable database. Production
  initial-System-Admin provisioning and secure setup-credential delivery remain
  unresolved; manager creation/reissue fail closed and System Admin creation
  does not return a setup credential. Evidence uses private local disk and
  requires a durable private storage adapter before an ephemeral host can serve
  real uploads. The proof client and deploy script require localhost chain
  `31337`; they do not support a public testnet. MetaMask is not implemented.
  No database was connected, seeded, migrated, reset or otherwise modified; no
  private key was read or added; no service/contract deployment occurred.
- The guide recommends Cloudflare R2 as a private object-storage adapter
  candidate and Render Free only for non-critical preview; current free-host
  sleep/durability limits do not satisfy production availability. These are
  documented options, not provisioned services. Product/provider limits can
  change; verify them before selection.

### Verification actually run

- `npm.cmd run typecheck` — passed for frontend and backend.
- `npm.cmd test --workspace=@nivaas/frontend` (from the root `npm.cmd test`)
  — passed, 32 files / 92 tests.
- `npm.cmd test --workspace=@nivaas/backend` — passed, 31 files / 237 tests
  when rerun with loopback networking enabled. The initial sandboxed run could
  not connect to ephemeral `127.0.0.1` test servers (`EACCES`) and failed before
  exercising those requests; the backend unit script excludes database
  integration tests.
- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/production-config.test.ts tests/development-blockchain-config.test.ts`
  — passed, 2 files / 6 tests after the final TLS checks.
- `npm.cmd run build` — passed for frontend and backend. Frontend output:
  entry `565.22 kB` minified / `164.12 kB` gzip, CSS `55.43 kB` / `11.02 kB`,
  lazy login scene `554.85 kB` / `141.50 kB`. Vite still warns about JavaScript
  chunks over 500 kB minified.
- `npm.cmd run blockchain:compile` — passed (`Nothing to compile`).
- `npm.cmd test --workspace=@nivaas/blockchain` — passed, 8 Hardhat contract
  tests on the local test network only.
- Vercel JSON parsing and deployment-template credential-pattern scan passed.
  `git diff --check` passed (result recorded after the final review).

No hosting dashboard, Atlas connection, authenticated production smoke test,
cloud evidence adapter, public-testnet deployment or production restore test was
performed. Complete the gates in `docs/DEPLOYMENT.md` before real-user launch.

## Authentication session renewal and tab isolation — 26 October 2026

### Findings and implementation

- The observed timeout was real access-JWT expiry: local configuration sets
  `JWT_ACCESS_TOKEN_TTL_SECONDS=900` (15 minutes), the backend validates JWT
  expiry, and no refresh-session endpoint or credential existed. The frontend
  already used `sessionStorage`, so ordinary separately opened tabs did not
  overwrite one another. However, the global 401 handler immediately cleared
  the current tab's session, and startup user revalidation also discarded a
  stored session on any failure, including a transient network outage.
- Added one opaque random refresh credential per successful login and a
  persisted `AuthSession` record containing only the SHA-256 hash, user ID,
  non-secret session ID, creation/expiry times and optional revocation time.
  The credential is stored with the access token in that tab's existing
  `sessionStorage`; no shared cookie, localStorage token or cross-tab token
  synchronization was added. A `BroadcastChannel` duplicate-tab check uses
  only the non-secret session ID and clears a cloned tab if its source tab is
  still live. Browsers without `BroadcastChannel` cannot detect a clone.
- `POST /api/auth/refresh` validates hash, absolute expiry and revocation,
  reloads the persisted active User, and issues a new access JWT without
  trusting submitted role/society data. The stable refresh credential is not
  rotated: concurrent refresh requests are safe and a lost successful response
  does not strand the session. This means a stolen refresh credential remains
  usable until the configured absolute expiry or logout revocation. MongoDB
  stores no raw refresh secret.
- Access JWTs keep the configured short TTL (local template: 900 seconds).
  `AUTH_REFRESH_SESSION_TTL_SECONDS` defaults to 2,592,000 seconds (30 days)
  for local use and is required explicitly in production. It is an absolute
  maximum, not a sliding idle timeout. Explicit logout clears the current tab
  immediately and best-effort revokes only that refresh session; already
  issued access JWTs remain valid until their short expiry. An inactive tab
  can renew on its first protected request after returning, while its refresh
  session remains valid.
- The API client shares concurrent renewal attempts within one tab, retries
  an original protected request at most once, and does not clear stored auth
  state on temporary network failures. An authoritative invalid/expired/
  revoked refresh response clears that tab. Backend persisted-user and
  society/role authorization middleware remains the source of authority.
- Updated `docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`,
  `docs/SRS.md`, `docs/IMPLEMENTATION_DECISIONS.md`, the deployment variable
  checklist and local environment template to document the session contract.
  Existing root `.env.example` and deployment templates remain uncommitted
  samples only; no secret was added.

### Verification actually run

- `npm.cmd test --workspace=@nivaas/frontend` — passed, 32 files / 97 tests.
  The focused auth regression rerun
  (`npm.cmd exec --workspace=@nivaas/frontend -- vitest run src/lib/session.test.ts src/lib/api.test.ts src/contexts/AuthContext.test.tsx`)
  passed, 3 files / 14 tests, including session storage, one-retry behavior,
  single-flight renewal and temporary network failure preservation.
- `npm.cmd test --workspace=@nivaas/backend` — passed, 31 files / 242 tests.
  This workspace command excludes every database integration test. New auth
  coverage uses in-memory user/session repositories and temporary loopback
  HTTP servers; it covers four concurrent role sessions, isolation on logout,
  expiry/revocation/disabled users, parallel renewal, endpoint behavior and
  persisted-user role/society continuity. The command required loopback test
  permission; no database was connected.
- `npm.cmd run typecheck` — passed for frontend and backend.
- `npm.cmd run build` — passed for frontend and backend. Frontend output:
  entry `567.50 kB` minified / `164.76 kB` gzip; CSS `55.43 kB` / `11.02 kB`;
  lazy login architecture scene `554.85 kB` / `141.50 kB`. Vite retains its
  existing warnings for JavaScript chunks above 500 kB; auth changes add no new
  frontend dependency or 3D runtime. Backend TypeScript production build passed.
- `git diff --check` — passed; Git printed only existing LF-to-CRLF notices.
- `npm.cmd run test:e2e -- --grep "four authenticated tabs"` — not executed by
  the browser because Playwright's Chromium headless executable is absent at
  the configured local path. The test is present and uses mocked API
  responses, but there is no verified browser-level four-tab result. No
  browser was downloaded for this task.
- No MongoDB/Atlas connection, database integration suite, migration, seed or
  deployment was run. An existing pre-upgrade `sessionStorage` value has no
  refresh credential; such a tab must sign in once after this frontend update
  to receive an independently revocable refresh session.
# College demo provisioning and private evidence storage — 26 October 2026

## Implemented

- Added a one-time production first-System-Admin bootstrap CLI:
  `npm.cmd run bootstrap:initial-admin --workspace=@nivaas/backend`. It is
  explicitly gated by server-side `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_ENABLED`
  and a 32-byte minimum `NIVAAS_INITIAL_ADMIN_BOOTSTRAP_SECRET`, accepts
  authorization input only from a trusted interactive TTY without echo,
  validates that secret before connecting to MongoDB, and requires an explicit
  typed confirmation. The API process refuses to start while this CLI-only
  flag is enabled.
- Bootstrap creates a pending platform administrator and setup credential
  within the existing MongoDB transaction pattern. Only the credential hash
  is persisted. A singleton `LocalBootstrapClaim` plus a check for any
  existing `SYSTEM_ADMIN` prevents reuse, duplicate admins and concurrent
  duplicate provisioning. A unique claim conflict fails closed. The one-time
  setup credential is printed only to the operator's interactive terminal for
  private hand delivery; no HTTP endpoint returns it. The operator must remove
  the temporary bootstrap variables and protect the terminal session/output.
- Corrected production `/users` provisioning to return `503` before creating a
  pending account when setup-credential delivery is unavailable. Routine
  Society Manager/member credential delivery and reissue remain fail-closed;
  no email/SMS provider or undocumented delivery service was added.
- Introduced an `EvidenceStorage` interface and a configured adapter shared by
  complaint, notice and project evidence services. Non-production defaults to
  private `LocalEvidenceStorage`; production requires `S3EvidenceStorage` with
  server-only `EVIDENCE_S3_*` configuration. The adapter uses the official
  `@aws-sdk/client-s3` dependency for custom-endpoint S3-compatible storage
  such as Cloudflare R2, UUID `.bin` keys, bounded streaming reads and
  Put/Get/Delete operations. It does not set object ACLs or expose public URLs.
- Existing upload validation, 5 MiB bound, Mongo metadata, SHA-256 integrity
  checks, authorization-before-download, transaction cleanup and ambiguous
  commit retention remain in the existing services. A bucket must stay
  private. Local files are not migrated automatically to object storage.
- Updated the production backend template and deployment guide with the new
  private storage variables, CLI usage, credential handling, demo blockers and
  existing-local-file migration limitation.

## Verification actually run

- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/initial-admin-bootstrap.test.ts tests/s3-evidence-storage.test.ts tests/production-config.test.ts tests/local-onboarding.test.ts tests/user-administration.test.ts tests/evidence.test.ts` — passed, 6 files / 49 tests. This includes rejected/incorrect bootstrap authorization, production-only/enabled configuration, hashed-only credential persistence in the injected repository, one-time claim reuse, existing-admin rejection, concurrent-claim conflict handling, S3 command behavior/private ACL defaults/bounds, production environment validation, account-delivery fail-closed behavior and local evidence key validation. The HTTP route suite required local loopback permission; the first sandboxed attempt was blocked with `EACCES`, then it passed with the local listener permission.
- `npm.cmd run typecheck` — passed for frontend and backend.
- `npm.cmd run build` — passed for frontend and backend. Existing Vite size advisory remains: main bundle `567.50 kB` minified (`164.76 kB` gzip) and lazy ArchitectureScene `554.85 kB` (`141.50 kB` gzip). No frontend code changed in this task.
- `git diff --check` — passed (Git reported existing LF-to-CRLF notices).
- No database connection, Atlas/R2 connection, migration, seed, cleanup, deployment, or browser test was run. Mongo-backed provisioning and provider interoperability still require a controlled deployment/staging verification.
- The official S3 SDK install reported six npm audit findings in the dependency tree (1 moderate, 3 high, 2 critical). No automatic audit fix was run; review the full dependency paths before deployment.

## Remaining blockers and deployment actions

- The college demo may provision its first System Admin after the approved fresh database is migrated, but additional manager/member accounts cannot complete setup until an approved secure delivery mechanism or controlled operator workflow is selected and implemented.
- Create/configure a private R2 bucket, least-privilege key pair and HTTPS endpoint in the backend host secret store. Never enable public access or `r2.dev`; run upload/download, cross-society authorization, failure and integrity checks against a staging bucket before use. No provider credentials are present and no provider connection was made.
- For existing local-disk evidence, a reviewed copy/verification and metadata path transition is still needed. The proposed fresh synthetic database avoids existing references only if no evidence is uploaded before S3 configuration.
- For first-admin CLI operation, apply the explicit production index migration first so `connectDatabase` passes the startup readiness check. This task did not perform that migration.

# Cloudinary private evidence provider — 11 November 2026

This checkpoint supersedes the earlier R2 recommendation for new production
deployments. S3/R2 remains only as an existing-provider compatibility option.

## Implemented

- Added `CloudinaryEvidenceStorage` using the official `cloudinary` Node SDK.
  Uploads are authenticated server-side image uploads, restricted to bytes
  validated as JPEG or PNG and the existing 5 MiB limit. No unsigned preset is
  used. Downloads use an internally generated short-lived signed URL and are
  streamed only through the existing authenticated backend route. The browser
  never receives a Cloudinary URL.
- Added hidden Evidence fields for provider, Cloudinary asset ID, resource type,
  authenticated delivery type, format and version. New local/S3/Cloudinary
  uploads persist a provider discriminator; reads/deletes dispatch to that exact
  provider and Cloudinary deletion targets the exact stored public ID. Existing
  records without a discriminator use the configured legacy fallback.
- Production config accepts Cloudinary as an evidence provider and requires all
  three `EVIDENCE_CLOUDINARY_*` variables. S3 credentials remain required only
  for active or explicitly configured legacy S3 access. Updated backend/root
  environment templates, deployment docs and implementation decisions.
- Existing upload validation, authorization-before-download, 5 MiB size and
  SHA-256 checks, private/no-store responses and known/ambiguous transaction
  cleanup behavior remain in the evidence services.

## Verification actually run

- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/cloudinary-evidence-storage.test.ts tests/evidence-storage-service.test.ts tests/production-config.test.ts tests/s3-evidence-storage.test.ts tests/evidence.test.ts` — passed, 5 files / 30 tests. Covers authenticated server upload options, invalid/oversized uploads, short-lived authenticated download, bounded response size, exact asset deletion, provider config requirements, authorization before storage reads, integrity/size checks, hidden Mongoose/API storage references, known-failure cleanup, ambiguous-commit retention and local/S3 compatibility tests.
- `npm.cmd run typecheck --workspace=@nivaas/backend` — passed.
- `npm.cmd run build --workspace=@nivaas/backend` — passed.
- `git diff --check` — passed; Git emitted only line-ending conversion notices for existing LF working copies.
- No Cloudinary connection, credential access, database connection, migration,
  seed or deployment was performed. Provider interoperability still requires a
  controlled staging smoke test after credentials are configured.

## Deployment notes and limitations

- Configure `EVIDENCE_STORAGE_PROVIDER=cloudinary` and
  `EVIDENCE_CLOUDINARY_CLOUD_NAME`, `EVIDENCE_CLOUDINARY_API_KEY`, and
  `EVIDENCE_CLOUDINARY_API_SECRET` in the backend host's secret store only.
- For a database with untagged legacy S3 records, keep
  `EVIDENCE_LEGACY_STORAGE_PROVIDER=s3` and all S3 credentials. A single legacy
  fallback cannot infer provider for a database that mixes untagged local and
  S3 records; inventory and migrate those references first.
- Cloudinary's free tier shares 25 credits across storage, image bandwidth and
  transformations; individual images are limited to 10 MB and 25 megapixels.
  Nivaas enforces a 5 MiB and 25 MP limit. Time-limited authenticated delivery
  uses the secure API path without CDN caching; Cloudinary warns it can use
  twice the bandwidth compared with ordinary CDN delivery. Nivaas also proxies
  bytes through the backend, adding backend egress/latency. Confirm current
  plan limits and usage before a public demo.

# Cloudinary compatibility and dependency security review — 12 November 2026

## Image compatibility change

- Reduced the shared signature-validated JPEG/PNG image dimension maximum from
  40,000,000 to 25,000,000 pixels. The existing 5 MiB byte limit and JPEG/PNG
  support are unchanged. Oversized dimensions fail with HTTP 413,
  `IMAGE_DIMENSIONS_TOO_LARGE`, and a clear 25-megapixel message before any
  evidence storage adapter is called.
- Added exact-boundary (25,000,000 pixel) and over-boundary tests for PNG and
  JPEG, plus a Cloudinary test proving over-limit bytes do not open an upload
  stream. Updated the API and deployment limits documentation.

## Backend workspace audit findings

Read-only `npm audit --workspace=@nivaas/backend --json` on 12 November 2026
reproduced 8 vulnerable package entries: 2 moderate, 4 high, 2 critical. The
locked dependency paths and available patched releases are:

| Package (locked version) | Severity | Dependency path / exposure | Patched release indicated by audit/registry |
| --- | --- | --- | --- |
| `@vitest/mocker` 3.2.7 | Moderate | `vitest` test runner; development only | 4.1.12 |
| `body-parser` 2.3.0 | High | `express` 5.2.1 → `body-parser`; backend production runtime | 2.4.0 |
| `mongoose` 8.24.4 | High | Direct backend dependency; production runtime | 8.24.7 (same major) |
| `qs` 6.16.0 | Moderate | `express` and `express` → `body-parser`; backend production runtime | 6.16.1 |
| `source-map-js` 1.2.1 | High | `postcss` under Vite/Vitest tooling; build/test time, not backend runtime | 1.2.2 |
| `tinypool` 1.1.1 | Critical | `vitest` worker pool; development/test only | 2.1.2 |
| `vite` 7.3.6 | High | Frontend dev dependency and Vitest's Vite integration; build/dev server, not deployed static frontend runtime | 7.3.7 |
| `vitest` 3.2.7 | Critical | Direct backend test dependency (also used by frontend); development/test only | 4.1.12 is patched and accepts Vite 7; audit's automatic suggestion is 5.1.0 |

The Mongoose issues concern filter sanitization, discriminator casting and
prototype-pollution paths. `body-parser` has a compressed-request trailing-byte
DoS. `qs` has an exception/DoS case. Vite advisories concern development
server/editor and middleware behavior. Vitest/tinypool advisories concern
mock registration/path traversal and worker-option prototype-pollution/RCE
gadgets; keep tests and dev servers restricted to trusted code/users.

`npm.cmd ls --omit=dev --workspace=@nivaas/backend body-parser qs mongoose source-map-js vite vitest @vitest/mocker tinypool`
showed only `express → body-parser → qs` and direct `mongoose` in the backend
production dependency tree. Thus three of the eight package entries are in the
backend production runtime. Vite/source-map-js are build-time dependencies;
Vitest, `@vitest/mocker` and tinypool are development/test dependencies.

The broader root `npm audit --json` reported 30 vulnerable package entries
(11 low, 6 moderate, 11 high, 2 critical) across the entire monorepo, including
blockchain/tooling dependencies. That aggregate is distinct from the eight
backend-workspace entries above and needs its own dependency-by-dependency
remediation before treating the whole repository as audit-clean.

## Recommended remediation; no dependency updates applied

- Patch runtime dependencies first without crossing majors: update Mongoose to
  8.24.7, and refresh the lockfile so Express's semver-compatible transitive
  dependencies resolve `body-parser` 2.4.0 and `qs` 6.16.1. Run backend unit,
  integration and auth tests and verify Express/Mongoose behavior before release.
- Update Vite to 7.3.7 within its existing major range and resolve
  `source-map-js` 1.2.2 through its parent dependency range; run frontend tests,
  typecheck and build, then re-audit.
- Upgrade Vitest from 3 to at least 4.1.12 (which supports Vite 7), updating
  `@vitest/mocker` and tinypool with it. This is a major dev-tool upgrade and
  needs a full frontend/backend test run. Do not accept `npm audit fix --force`
  selecting Vitest 5.1.0 without compatibility validation.
- Do not use overrides until confirming each parent semver range and testing
  the resulting lock. Re-run backend and root audits after the staged updates.

## Verification actually run

- `npm.cmd exec --workspace=@nivaas/backend -- vitest run tests/evidence.test.ts tests/cloudinary-evidence-storage.test.ts tests/evidence-storage-service.test.ts tests/production-config.test.ts tests/s3-evidence-storage.test.ts` — passed, 5 files / 32 tests.
- `npm.cmd run typecheck --workspace=@nivaas/backend` — passed.
- `npm.cmd run build --workspace=@nivaas/backend` — passed.
- `git diff --check` — passed with only pre-existing LF-to-CRLF notices.
- Backend audit, production-tree `npm ls`, and registry version lookups were
  read-only. No dependencies were upgraded, no Cloudinary/MongoDB connection,
  migration, seed, deployment or commit occurred.
