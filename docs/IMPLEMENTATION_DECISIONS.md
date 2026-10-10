\# Nivaas — Implementation Decisions



Version: 1.10

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

## 7. Approval Engine Foundation

The initial approval policy is stored in each society's immutable
`SocietyRuleVersion` configuration. Its approval threshold is an exact
decimal string and defaults to `100000` when an initial rule version omits
the policy value. Approval evaluations create immutable `ApprovalDecision`
snapshots containing the rule version, threshold, evaluated amount, route
and decision context.

The authority allowed to create or activate a new society rule version
remains unresolved. Therefore, this checkpoint exposes rule retrieval and
approval evaluation only; it does not grant a Society Manager or
`SYSTEM_ADMIN` an API to change governance rules. Historical rule versions
remain read-only configuration records, and approval evaluation fails
explicitly when a society has no valid active rule version.

Cross-society access is a separate platform-administration capability and
must be explicitly permitted by the relevant API. Generic same-society
authorization must not contain a hidden `SYSTEM_ADMIN` bypass.

The `SYSTEM_ADMIN` role does not confer ownership, residence, society
membership, committee membership, governance eligibility, or governance
authority. It does not permit bypassing governance, changing votes,
fabricating approvals, bypassing required meetings/SGM processes, altering
completed governance results, rewriting historical payments, or modifying
other protected governance history.

New societies are provisioned with exactly one active version (version 1)
using the configurable prototype threshold of `100000`. Society creation,
rule creation, and the `Society.activeRuleVersionId` reference are written
in one MongoDB transaction. This is initial platform provisioning only; it
does not resolve or grant authority to create or activate later governance
versions. A failed provisioning transaction creates neither the society nor
its initial rule.

Quotation selection is a separate transactional transition. It derives the
project and society from persisted relationships, sets
`Project.currentQuotationId`, marks the selected quotation `SELECTED`, and
supersedes the previous selected quotation without changing project approval
to approved. Submitting a change request for the currently selected
quotation atomically records the request and evaluates its persisted
`newAmount`; the project enters `RE_APPROVAL`. Final approval and resulting
quotation-version acceptance remain unavailable until their governing
authority is specified.

## 7. User Creation and Initial Credential

`POST /users` creates an account without accepting a permanent password or
`passwordHash` from the administrator. A new account enters `PENDING_SETUP`
without a password hash until setup succeeds.
The backend generates a single-use account-setup credential consisting of
32 cryptographically random bytes represented using URL-safe base64. It is
associated with the intended User, expires 24 hours after generation, and
only its cryptographic hash is stored. The raw credential is never
persisted. `POST /auth/setup` accepts `credential` and `newPassword`; only
`PENDING_SETUP` accounts may use it. The password must be at least 8
characters and is stored using the existing scrypt password-hashing
mechanism. The administrator never receives or sets the permanent password.

Successful setup atomically stores the password hash, consumes the
credential, transitions the User to `ACTIVE`, and creates the mandatory
AuditLog event for that successful status transition. Invalid, expired,
consumed/replayed credentials and ineligible account statuses receive the
same generic 401 response. The success response uses the API success
envelope with empty `data` and includes no credential, secret, password
hash, or authentication token. Credential generation, consumption alone,
and failed setup attempts do not create separate AuditLog events.

The initial setup flow does not include credential regeneration or resend;
any reissue is a future administration capability. Credential delivery is
implementation-specific, and no provider is selected. Account setup remains
separate from society membership, ownership, residence/occupancy, committee
membership, and governance/voting eligibility.

The following decisions remain unresolved and must not be inferred during
implementation:

- The credential-hash algorithm and encoded representation
- Credential retention/cleanup after expiry or consumption
- Whether disabling a pending account invalidates its unexpired credential
  and whether that requires reissue after reactivation
- The future administration API/process for credential regeneration/resend
- Forgot-password flow
- Email provider or delivery implementation
- Email identity case/normalization policy
- Email verification, reauthentication, or notification behavior
- Password requirements beyond the approved 8-character minimum

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
`PENDING_SETUP` to `DISABLED`, `ACTIVE` to `DISABLED`, `DISABLED` entered
from `ACTIVE` to `ACTIVE`, and `DISABLED` entered from `PENDING_SETUP` to
`PENDING_SETUP`. The required status-transition AuditLog state records the
previous and resulting statuses to preserve which lifecycle state is
restored. A pending account cannot become active through administrator
reactivation; setup remains required.

`PENDING_SETUP` accounts cannot authenticate with a normal password or
access protected application APIs; they may use only `POST /auth/setup`,
and become `ACTIVE` only after successful account setup. `DISABLED` accounts cannot authenticate or access
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
a lowercase `0x`-prefixed 32-byte hexadecimal string compatible with
`bytes32`. The required immutable BSON Int32 `hashVersion` is `1` for the
initial Nivaas AuditLog hashing/serialization protocol. It participates in
the record hash and is distinct from society `ruleVersionId`; it preserves
historical verifiability if the hashing protocol changes.

For hash version 1, the immutable fields are committed in the exact order
`hashVersion`, `_id`, `societyId`, `actorId`, `action`, `entityType`,
`entityId`, `correctsAuditLogId`, `previousState`, `newState`, `metadata`,
`ruleVersionId`, `createdAt`. The payload is an ordered JSON array of
field/value pairs. Absent optional fields are omitted; explicit null and
empty object, empty array, empty string, false, and zero remain distinct.
Values are mapped using BSON Canonical Extended JSON v2, then serialized
with RFC 8785 JCS, encoded as UTF-8, and hashed with Ethereum Keccak-256
(not FIPS SHA3-256). The digest is stored as lowercase `0x`-prefixed
hexadecimal. ObjectIds, dates, BSON numeric types, nested objects, arrays,
strings, booleans, and null follow the exact canonical mappings and string
handling constraints in `DATABASE.md` and `BLOCKCHAIN.md`; non-finite
numbers are prohibited in hashable state/metadata. No implicit trimming,
case conversion, Unicode normalization, or business-value conversion is
performed.

The hash includes `_id` and `correctsAuditLogId` when present; correction
events commit to the original event ID without recursively hashing it.
`recordHash`, `blockchainTransactionHash`, proof status, transaction
attempts, and all later proof/association information are excluded. An
independent verifier reconstructs the payload using the event's
`hashVersion`, recalculates the hash, and compares it with the stored
`recordHash` and, when proof exists, the corresponding on-chain commitment.
The hash establishes integrity/existence of the committed value, not truth
or legal validity of the event.
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
by this decision. The AuditLog canonical hash protocol is defined in
`DATABASE.md` and `BLOCKCHAIN.md`. The blockchain tracking persistence
schema, which network/contract metadata must be retained with an event-level
proof association, and API exposure of pending/failed proof state remain
unresolved.

Audit visibility retains the existing high-level role matrix. Actual access
is server-authorized and subject to authentication, role authorization,
society/resource isolation, and applicable business rules. The matrix does
not define detailed endpoint permissions.

The following AuditLog questions remain unresolved:

- Whether a single atomic action affecting multiple societies produces
  multiple audit events or another representation
- How security-event logging for failed/denied attempts is handled
- The exact action-code and entity-type vocabularies
- The exact permitted key vocabulary for `metadata`
- Detailed semantics for system-generated AuditLog events
- Exact legacy/compatibility semantics for `blockchainTransactionHash`
- The exact blockchain operation/transaction-tracking persistence schema
- Which network/contract metadata must be retained with an event-level
  proof association
- The exact API exposure of pending/failed proof state

## 11. User Read APIs and Platform-Administrator Society Context

`GET /users` is a generic platform-wide user administration/listing endpoint
available only to `SYSTEM_ADMIN`. No society-scoped role may use it. The
older/general Users authorization-matrix labels do not grant society-scoped
access to this endpoint. User information needed by society-scoped users
belongs in purpose-specific endpoints or permitted resource APIs.

For `GET /users/:id`, `SYSTEM_ADMIN` may retrieve users across the platform.
`SOCIETY_MANAGER` and `COMMITTEE_MEMBER` may retrieve permitted profiles
belonging to their own society. `OWNER_MEMBER` and `RESIDENT` may retrieve
only their own profile through this endpoint. Society-scoped roles may not
retrieve another society's user. The endpoint returns only the safe user
fields specified in `API.md`; it never returns raw User documents or
authentication secrets. Application role remains separate from ownership,
residence, membership, committee membership, and governance/voting
eligibility.

The database invariant is `societyId` nullable for `SYSTEM_ADMIN` and
required/non-null for all society-scoped roles. The current authentication
and authorization implementation must be updated before the User read APIs
are implemented:

- `User.societyId` must support null for `SYSTEM_ADMIN` while remaining
  required for society-scoped roles.
- `CurrentUserContext.societyId` must support null.
- `load-current-user` must preserve null for `SYSTEM_ADMIN` rather than
  dereferencing it or manufacturing a society association.
- Authentication/user response serialization that includes `societyId` must
  preserve null for `SYSTEM_ADMIN` rather than dereferencing it or
  manufacturing a society association.
- Generic same-society isolation must not treat a null society as matching
  any resource; platform-administrator access must remain an explicit
  authorization capability.

This implementation requirement does not make `SYSTEM_ADMIN` a society
member or grant ownership, residence, membership, committee membership,
governance eligibility, or voting rights. It does not create a synthetic
society or society membership for a platform administrator.
