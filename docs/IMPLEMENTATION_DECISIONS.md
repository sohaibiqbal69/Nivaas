\# Nivaas — Implementation Decisions



Version: 1.5

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

The existing AuditLog fields remain the documented structure; no
actor-role, outcome, request-ID, or correlation-ID fields are added. State
payloads contain only event-relevant state and exclude credentials, secrets,
complete personal profiles, and unnecessary sensitive personal
information. The event's society scope follows the target resource/action;
a genuinely platform-wide event with no society target may have no society
ID. Platform-wide `SYSTEM_ADMIN` scope does not confer society membership
or governance authority.

AuditLog and complete audit history remain off-chain. Selected high-value
audit-event hashes/references may be anchored on-chain. No existing
AuditLog record may be mutated solely to attach or update blockchain proof
information. The existing `blockchainTransactionHash` field is retained,
but how a transaction hash produced after event creation is associated
with that event remains unspecified.

Audit visibility retains the existing high-level role matrix. Actual access
is server-authorized and subject to authentication, role authorization,
society/resource isolation, and applicable business rules. The matrix does
not define detailed endpoint permissions.

The following AuditLog questions remain unresolved:

- Whether a single atomic action affecting multiple societies produces
  multiple audit events or another representation
- How security-event logging for failed/denied attempts is handled
- How a transaction hash produced after AuditLog event creation is
  associated with the immutable event
- How system-generated events without a human actor are represented

