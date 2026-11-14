# Local MVP Demonstration

This procedure uses the local MongoDB application database and local Hardhat
chain only. It does not create a production wallet, change governance policy,
or clear application data. Keep `.env` and `backend/.env` private and ignored.

## Enable isolated local onboarding

The local bootstrap and credential-delivery controls are deliberately opt-in.
They are rejected in production and require `MONGODB_URI` to point to the
loopback `nivaas_demo` database. The backend loads the repository root `.env`
and `backend/.env`; existing process environment values take precedence. Keep
the bootstrap controls temporary in the PowerShell process rather than saving
the starter secret in `.env`:

The starter secret `1234` is accepted only with development mode, the explicit
enable flag, and loopback `nivaas_demo`. Production remains rejected. From a
private local PowerShell terminal at the repository root, run:

```powershell
$env:NODE_ENV = 'development'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/nivaas_demo?replicaSet=rs0'
$env:NIVAAS_LOCAL_BOOTSTRAP_ENABLED = 'true'
$env:NIVAAS_LOCAL_BOOTSTRAP_SECRET = '1234'
try {
    npm.cmd run bootstrap:local-admin --workspace=@nivaas/backend
}
finally {
    Remove-Item Env:NIVAAS_LOCAL_BOOTSTRAP_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:NIVAAS_LOCAL_BOOTSTRAP_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
}
```

The CLI requires a TTY, reads the authorization secret without echo, asks for
the administrator's name/email, and requires typing `BOOTSTRAP FIRST ADMIN`.
It refuses a production environment, a non-loopback/non-`nivaas_demo` URI, an
existing system administrator, or an existing bootstrap claim. The pending
administrator's one-time setup credential is emitted once in that terminal;
use it immediately on the frontend `/setup` page. Do not enable PowerShell
transcription or redirect the output. It expires after 24 hours and is stored
only as a hash in MongoDB.

After the first administrator is active, set
`NIVAAS_LOCAL_BOOTSTRAP_ENABLED=false` and remove any saved
`NIVAAS_LOCAL_BOOTSTRAP_SECRET` if one exists. Keep
`NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED=true` only while locally creating demo
accounts. As the administrator, create a society-scoped `SOCIETY_MANAGER`
and `OWNER_MEMBER` through `POST /users`; its one-time setup credential is
included only in the authenticated loopback response while local delivery is
enabled. Keep that response in memory and submit its credential and a chosen
password to `POST /auth/setup`; never print or save the response. Activate
accounts through setup, then use their own credentials to sign in. Disable
local credential delivery after provisioning.

The setup credential remains single-use and expires in 24 hours. Production
never returns it from `POST /users`; no unauthenticated bootstrap endpoint
exists. This delivery mode is intended only for a developer's private local
machine, not shared networks or production deployments.

Integration tests require a loopback `rs0` URI whose database name starts with
`nivaas_disposable_`, plus `NIVAAS_DISPOSABLE_DATABASE` set to that exact name.
The helper rejects `nivaas`, `nivaas_test`, and `nivaas_demo`, and checks the
connected database identity again before collection cleanup. Normal `npm run
test` excludes integration tests. Never point a cleanup suite at retained data.

### Isolated onboarding verification

Choose a fresh database name for each run and first confirm it does not exist.
From the repository root, set these process-only variables (do not edit `.env`):

```powershell
$testName = 'nivaas_disposable_onboarding_' + [guid]::NewGuid().ToString('N')
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/${testName}?replicaSet=rs0"
$env:NIVAAS_DISPOSABLE_DATABASE = $testName
$env:NIVAAS_ONBOARDING_BROWSER = 'true'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd exec --workspace=@nivaas/backend -- vitest run --no-file-parallelism tests/integration/manager-onboarding.integration.test.ts
```

The onboarding suite refuses existing populated targets and never clears them.
It creates an isolated administrator through the existing provisioning service,
consumes setup credentials, and uses real password login and MongoDB repositories.
Credentials are random, held in memory, and never printed. Its test-only router
injects local delivery configuration; the application restriction to loopback
`nivaas_demo` is unchanged. The browser uses temporary API/frontend ports and
closes both servers afterward. Test records are retained only in the disposable
database; do not reuse it as a development or demo database.

## Start and stop development

Normal development uses the MongoDB Atlas URI in the ignored root `.env`.
Copy `.env.example` to `.env` once, then set `MONGODB_URI` and `JWT_SECRET`
locally. The project never starts MongoDB itself. Developers who explicitly
need a local database can set `MONGODB_URI` to a local MongoDB replica-set
URI; Docker is optional and is not part of the normal workflow. Do not point
the application at `nivaas_test` or clear any database.

From one PowerShell terminal at the repository root:

```powershell
npm.cmd run dev:check
npm.cmd run dev
```

`dev:check` reports configuration presence/status without printing URI,
JWT, signer, or other secret values. `dev` starts the backend and frontend,
waits for the database-backed API health endpoint and frontend, and prints
the URLs. Existing healthy services are reused rather than duplicated. Use
`Ctrl+C` in that terminal or run `npm.cmd run dev:stop` from another root
terminal. The stop command targets only verified process IDs recorded by
this workflow; services that were already running are left alone.

For debugging, the existing single-service commands remain available from
the repository root: `npm.cmd run dev:backend` and
`npm.cmd run dev:frontend`. MongoDB remains an external service in both
modes.

### Optional local blockchain

Ordinary frontend/backend work does not need Hardhat. Keep
`NIVAAS_DEV_BLOCKCHAIN_ENABLED=false` in the root `.env` for that mode. To
enable local proof development, set it to `true` and configure the existing
`BLOCKCHAIN_SIGNER_PRIVATE_KEY` in ignored `backend/.env` to the first local
Hardhat development account. Do not use that key on another network. Never
put it in a `VITE_` variable or tracked file.

With that flag enabled, `npm.cmd run dev` starts a Hardhat node on
`http://127.0.0.1:8545` only when one is not already available. It checks the
local signer against the first local account, compiles and deploys the
registry when the chain is empty, then passes the deployment record's chain,
contract, transaction, and block identity to the backend process without
rewriting `.env`. It reuses a deployment only when the recorded transaction
has a successful receipt, the block matches, and contract code is present.
If a running chain has activity but no matching deployment, startup stops
safely instead of deploying over an unverified state. Account private-key
output from the Hardhat node is suppressed by the workflow.

A fresh Hardhat node resets local chain state. Proofs confirmed against the
previous deployment are not valid against the new chain/deployment; verify
them only against the current registry and deployment identity. The ignored
`blockchain/deployments/localhost.json` is local metadata, not a guarantee
that a deployment still exists.

## Prepare and run the browser demonstration

After the administrator/account onboarding prerequisite above has been
resolved through an authorized mechanism:

1. Sign in with an activated demo account and verify the displayed society.
2. In Meetings, create and publish a meeting with the required meeting
   reference/date and general-body context.
3. Ensure that the society has an explicitly activated supported ordinary
   general-body policy and validated membership evidence for the intended
   eligible voters. The server-generated eligibility snapshot is the source
   of voter eligibility; application role, residence, or ownership alone
   does not establish it.
4. Create the supported resolution. For a project approval demonstration,
   use a project with its current quotation revision and a current
   `ApprovalDecision` matching the required decision body, evaluated amount,
   and quotation revision.
5. Open voting only after the backend accepts the meeting, policy, approval
   context (when applicable), and eligibility snapshot. Sign in as each
   eligible member and submit that member's own vote.
6. Close voting and inspect the server-calculated outcome. Finalize once.
   Only a valid finalized project outcome can transition the project to
   `APPROVED`; rejected and inconclusive outcomes do not.
7. Inspect the resolution's proof status. `CONFIRMED` requires a successful
   chain receipt and matching registry read-back. Use the verification action
   and confirm it reports verified against the configured local deployment.
   A pending, failed, conflicting, or unverified proof is not confirmed.
8. Review the governance result and audit history. Do not show individual
   vote choices as blockchain data; votes remain off-chain.

The ordinary general-body policy settings are configurable product defaults
for this MVP. They are not a certification of legal compliance for every
society. Committee and special-resolution finalization remain unsupported
unless their own policy is explicitly configured and validated.

## Data handling

Use the dedicated `nivaas_demo` database and the authorized account setup
above. The setup endpoints support creating societies, users, property, and
membership through the application API; create the general-body policy from
the manager's governance screen and create/submit the project and quotation
through their existing screens. Set the project amount above the society's
configured approval threshold, select a current quotation, and submit it for
approval before creating the project-linked SGM resolution. Do not point the
demo at `nivaas_test`, which is protected from integration cleanup, and do not
clear the main `nivaas` database. No collection-wide cleanup command is
provided; retain demo records or remove only individually reviewed records
through authorized application operations.

## Current repeatability limitation

The repository has no dedicated demo seed script. Playwright includes small
browser smoke checks for sign-in rendering and the unauthenticated Meetings
redirect; they do not replace the authenticated browser demonstration. The
full governance-to-proof browser scenario still requires a prepared `nivaas_demo`
society, active accounts, MongoDB, and the local Hardhat deployment.
