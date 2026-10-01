\# Nivaas — Implementation Decisions



Version: 1.7

Status: Implementation Baseline

Date: 2026-09-30



This document records implementation decisions that supplement the

Nivaas project specifications.



It must not override established business rules or governance

requirements in the controlled specification set.



\---



\## 1. Technology Decisions



\### Language



Use TypeScript for both frontend and backend.



Reason:

Nivaas has significant contracts between frontend, API, business logic,

database models, governance workflows and blockchain services.

Type safety is valuable for maintaining those boundaries.



\### Frontend



React + Vite.



\### Styling



Tailwind CSS.



\### Component System



shadcn/ui.



Do not introduce another UI component framework.



\### Routing



React Router.



\### HTTP Client



Use the native Fetch API.



Do not add Axios unless a concrete project requirement demonstrates

that Fetch is insufficient.



\### Backend



Node.js + Express.



\### Database



MongoDB with Mongoose.



MongoDB remains the primary application database.



\### Authentication



Use JWT-based authentication.



Authentication and authorization must remain separate concepts.



The backend remains authoritative for authorization.



\### Blockchain



Use Solidity + Hardhat + ethers.js.



Begin with a local Hardhat network.



Do not introduce public blockchain deployment during initial

application development.



\### Wallet



MetaMask for wallet interaction where required.



\### Animation



Anime.js is the only animation library.



Do not introduce Framer Motion, GSAP, or another animation library

without explicit approval.



\### Testing



Use Vitest for unit/integration-oriented JavaScript/TypeScript tests

where appropriate.



Use Playwright for browser-level end-to-end testing.



\---



\## 2. Governance Decisions Still Requiring Finalization



The following must NOT be invented by the coding agent:



\- committee majority formula

\- special-resolution majority formula

\- special quorum formula

\- detailed eligibility outcomes for joint members

\- detailed eligibility outcomes for associate members

\- detailed eligibility outcomes for provisional members

\- authority required to change governance-rule versions

\- exact relationship between General Body and SGM terminology in each

&#x20; approval route

\- project-completion authority

\- budget-overrun approval workflow



Until finalized, these are configuration/specification questions.



\---



\## 3. Approval Threshold



The ₹1,00,000 threshold is treated as a configurable prototype

society rule.



It must NOT be represented as a universal Maharashtra statutory rule.



The effective society rule version determines the applicable approval

route.



\---



\## 4. Blockchain Principle



Blockchain is an integrity/proof layer.



MongoDB remains the authoritative application data store.



Do not move the application into a blockchain-first architecture.



Do not put personal information, complete application records,

document contents or individual votes on-chain merely for the sake of

using blockchain.



\---



\## 5. Development Principle



Meaningful domain complexity must be preserved.



Do not remove:



\- rule versioning

\- governance eligibility

\- approval evaluation

\- quotation versioning

\- change requests

\- historical snapshots

\- auditability

\- blockchain integrity proofs



merely because implementation is more difficult.



Avoid unnecessary technical complexity that does not contribute to the

specified system.


## 6. Platform and Society Authorization Scope

`SYSTEM_ADMIN` is a platform-wide technical role. It is not a society
member merely because its holder administers Nivaas. `User.societyId` is
nullable only for `SYSTEM_ADMIN` and required for all society-scoped roles.

Cross-society access is a separate platform-administration capability and
must be explicitly permitted by the relevant API. Generic same-society
authorization must not contain a hidden `SYSTEM_ADMIN` bypass.

The `SYSTEM_ADMIN` role does not confer ownership, residence, society
membership, committee membership, governance eligibility, or governance
authority. It does not permit bypassing governance, changing votes,
fabricating approvals, bypassing required meetings/SGM processes, altering
completed governance results, rewriting historical payments, or modifying
other protected governance history.

## 7. User Creation and Initial Credential

`POST /users` creates an account without accepting a permanent password or
`passwordHash` from the administrator. A new account enters pending setup.
The backend generates a single-use account-setup credential; the user
establishes their own password through the account-setup flow. The
credential cannot be reused after successful consumption or invalidation.
The administrator never receives or sets the permanent password. The
existing authentication/password-hashing mechanism is the implementation
basis when the user establishes the password.

Credential delivery is implementation-specific and is not part of the core
user API contract. Account setup is separate from society membership,
ownership, residence/occupancy, committee membership, and governance/voting
eligibility. This decision does not define a setup endpoint or request/
response fields.

The following decisions remain unresolved and must not be inferred during
implementation:

- Setup-token expiry
- Password complexity requirements
- Forgot-password flow
- Email provider or delivery implementation
- Email identity case/normalization policy
- Email verification, reauthentication, or notification behavior

## 8. User Profile and Account-Information Update Fields

`PATCH /users/:id` is limited to these fields: `name`, `email`, `phone`,
and `walletAddress`. It must not modify `_id`, `societyId`, `role`, `status`,
`passwordHash`, `createdAt`, or `updatedAt`. Role and status changes use
their dedicated endpoints; password changes are outside this endpoint.

Login email must be unique across user accounts. Changing email does not
change role, society, membership, ownership, residence/occupancy, committee
membership, or governance eligibility. Editing `walletAddress` does not
grant governance or voting rights. This decision does not define email
verification, reauthentication, password reset, or notification behavior.

## 9. User Account Status Policy

The only User account status values are `PENDING_SETUP`, `ACTIVE`, and
`DISABLED`. The permitted transitions are `PENDING_SETUP` to `ACTIVE`,
`PENDING_SETUP` to `DISABLED`, `ACTIVE` to `DISABLED`, and `DISABLED` to
`ACTIVE`.

`PENDING_SETUP` accounts cannot authenticate with a normal password or
access protected application APIs; they may use only the future account-
setup mechanism once its API is specified, and become `ACTIVE` only after
successful account setup. `DISABLED` accounts cannot authenticate or access
protected APIs. Persisted User status is authoritative, and JWT possession
does not override `PENDING_SETUP` or `DISABLED` status.

Only `SYSTEM_ADMIN` may administer account status. A System Administrator
cannot disable their own account or the last `ACTIVE` System Administrator
account. Status changes do not themselves grant or revoke society
membership, ownership, residence/occupancy, committee membership, or
governance/voting eligibility. Disabling an account does not delete the User
or its historical/domain relationships. No additional status values are
permitted.

The target-selection contract for platform-wide access through the
singular `/society` routes is also unspecified. Do not infer a target from a
client-supplied `societyId`.

## 10. AuditLog Foundation

AuditLog is durable business/security history for selected important
actions and state changes. It does not replace domain records, determine
governance outcomes, act as the governance engine, or replace operational
application/server logs.

Existing AuditLog events are append-only and immutable. Corrections are
new append-only events that identify/reference the original and explain
the correction. The original event is preserved. Every successful User
account status transition is audited. Existing mandatory audit events
remain in force. Failed/denied attempts are not made mandatory AuditLog
events by this decision, and not every user profile edit is required to be
audited.

The AuditLog model uses MongoDB ObjectIds for `_id` and documented entity
references. `societyId` is required for society-scoped events and explicitly
null for genuinely platform-wide events without a society target. `actorId`
references `User` for a human actor and may be omitted or null for a
system-generated event; no synthetic user or separate actor model is
introduced. Detailed system-generated event semantics remain unresolved.
`action` is a required string/action code without a closed enum. `entityType`
identifies an affected resource type when applicable, and `entityId` is an
optional MongoDB ObjectId using the referenced domain entity's existing
`_id` convention when there is a single affected entity; neither vocabulary
is an exhaustive enum. `previousState`, `newState`, and `metadata` are optional
BSON objects subject to the approved audit payload privacy restrictions.
`ruleVersionId` is an optional reference to `SocietyRuleVersion` when that
version is used by the action. A correction event references its original
through the optional self-reference `correctsAuditLogId`.

`recordHash` is required for each persisted event, immutable, and stored as
a `0x`-prefixed 32-byte hexadecimal string compatible with `bytes32`. It
excludes itself and later blockchain transaction/proof association. Its
exact canonical payload fields and serialization remain unresolved.
`blockchainTransactionHash` remains an optional compatibility field, is not
authoritative for asynchronous proof, and must not be modified after event
creation; its legacy/use semantics remain unresolved. `createdAt` is a
required immutable MongoDB Date generated at creation. AuditLog has no
`updatedAt`. No actor-role, outcome, request-ID,
correlation-ID, or other unapproved fields are added. Audit payloads contain
only event-relevant state and exclude credentials, secrets, complete personal
profiles, and unnecessary sensitive personal information. The event's
society scope follows the target resource/action; a genuinely platform-wide
event with no society target may have no society ID. Platform-wide
`SYSTEM_ADMIN` scope does not confer society membership or governance
authority.

The required AuditLog indexes are non-unique `societyId` and compound
`entityType + entityId`, supporting the documented society-filtered listing
and entity-specific history query. No other AuditLog indexes or uniqueness
constraints are approved.

AuditLog and complete audit history remain off-chain. An immutable AuditLog
event is persisted with its fixed `recordHash`; selected proof submission
may happen asynchronously afterward. The blockchain logical-operation/
transaction-tracking layer associates the operation and its transaction
attempts with the AuditLog event and its fixed hash. Transaction hashes and
lifecycle states belong to that tracking layer. Retries or replacements
remain associated with the same logical operation and original event.
Failures do not modify the AuditLog event and are not confirmations. The
original event is never updated to attach, replace, or confirm proof
information, and blockchain-lifecycle states do not create AuditLog events.
Only selected hashes/references may be anchored; complete audit records
remain off-chain.

The existing AuditLog `blockchainTransactionHash` field is retained, but it
must not be treated as the authoritative location for a hash that becomes
available after the immutable event is created. Its exact persistence and
use semantics remain unresolved. No dedicated proof entity is introduced
by this decision. The exact AuditLog canonical payload fields, blockchain
tracking persistence schema, which network/contract metadata must be retained
with an event-level proof association, and API exposure of pending/failed
proof state remain unresolved.

Audit visibility retains the existing high-level role matrix. Actual access
is server-authorized and subject to authentication, role authorization,
society/resource isolation, and applicable business rules. The matrix does
not define detailed endpoint permissions.

The following AuditLog questions remain unresolved:

- Whether a single atomic action affecting multiple societies produces
  multiple audit events or another representation
- How security-event logging for failed/denied attempts is handled
- The exact AuditLog canonical payload fields, hash algorithm choice, and
  serialization for `recordHash`
- The exact action-code and entity-type vocabularies
- The exact permitted key vocabulary for `metadata`
- Detailed semantics for system-generated AuditLog events
- Exact legacy/compatibility semantics for `blockchainTransactionHash`
- The exact blockchain operation/transaction-tracking persistence schema
- Which network/contract metadata must be retained with an event-level
  proof association
- The exact API exposure of pending/failed proof state

