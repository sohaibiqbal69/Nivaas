# Nivaas — AI Engineering Handoff

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

**End of handoff.**
