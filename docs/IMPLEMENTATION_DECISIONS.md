\# Nivaas — Implementation Decisions



Version: 1.13

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

The project-spending threshold can be changed only by the authenticated
`SOCIETY_MANAGER` associated with that society. A change creates a new
immutable rule version, records its effective time, actor, rationale or
supporting reference, and append-only audit event. The society's active rule
pointer is updated transactionally. Broader authority to activate unrelated
governance rule dimensions remains unresolved; this endpoint changes only the
project-spending threshold. Historical rule versions remain read-only
configuration records, and approval evaluation fails explicitly when a
society has no valid active rule version.

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

Authenticated `SYSTEM_ADMIN` users may reissue a setup credential only for an
existing `PENDING_SETUP` account through the loopback-only local delivery
route. Reissue invalidates prior outstanding credentials and is audited in
the same MongoDB transaction. Production credential delivery remains
unconfigured, so production reissue fails closed before persistence changes.
Local development may enable authenticated loopback-only credential delivery
for initial creation (`POST /users`) and reissue (`POST /users/:id/setup-credential`)
while the backend targets the dedicated `nivaas_demo` database; the raw
credential is returned once in that API response, never persisted or logged.
A CLI-only, one-time local bootstrap
may create the first pending `SYSTEM_ADMIN` under an explicit secret and
transactional database claim. Local onboarding flags are unavailable in
production and must be disabled/removed after setup. Account setup remains
separate from society membership, ownership, residence/occupancy, committee
membership, and governance/voting eligibility.

The following decisions remain unresolved and must not be inferred during
implementation:

- The credential-hash algorithm and encoded representation
- Credential retention/cleanup after expiry or consumption
- Whether disabling a pending account invalidates its unexpired credential
  and whether that requires reissue after reactivation
- The secure production delivery provider and authorization/notification
  process for credential regeneration/resend
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
available after the immutable event is created. Its legacy/use semantics
remain unresolved. AuditLog proofs use a separate `BlockchainProofOperation`
logical-operation record. Its unique identity is the AuditLog record ID,
proof version, chain ID, contract address, and deployment transaction hash;
the deployment hash distinguishes local-chain resets. It stores the record
reference/hash, AuditLog hash version, reference-derivation version,
deployment identity, status, timestamps, and append-only transaction-attempt
metadata, never private keys or AuditLog payloads.

The version-1 reference derivation is:

```text
keccak256(abi.encode(
  keccak256(utf8("NIVAAS:AUDIT_LOG:REFERENCE")),
  uint256(1),
  bytes32(uint160(societyObjectId)),
  bytes32(uint160(auditLogObjectId))
))
```

ObjectId's 12 bytes are left-zero-padded to bytes32 (equivalent to
`bytes32(uint256(uint96(objectId)))`). This domain separates record type;
including society and AuditLog IDs prevents cross-society/reference
collisions. Reference derivation version `1`, registry proof version `1`,
and AuditLog `hashVersion` `1` are distinct values. Proof submission first
recomputes the persisted event using the existing `hashAuditLog()` and
rejects a mismatch. It submits only `recordReference`, proof version, and
that stored canonical `recordHash`.

The registry permits one proof per `(recordReference, proofVersion)` and
does not permit overwrite. The backend persists a PENDING operation before
broadcast, records transaction attempts, waits for a successful receipt,
then reads the proof back and requires an exact reference/version/hash
match before marking CONFIRMED. Before retrying or recovering after an
ambiguous database/network failure, it reads the contract and reconciles
registration events from the configured deployment. Matching proof is
recovered; a different hash is a conflict and is never overwritten. A
failed/reverted or ambiguous transaction is not confirmation. The operation
remains retryable/reconcilable without changing the AuditLog event.

Only `SYSTEM_ADMIN`, `SOCIETY_MANAGER`, and `COMMITTEE_MEMBER` may call the
proof endpoints, following the existing audit-history reader role set.
Society-scoped roles are restricted to their own society. `SYSTEM_ADMIN`
may inspect across societies only under this explicit endpoint policy; this
does not grant governance authority. Local development uses the configured
first Hardhat account signer only; its secret is backend-only and this is
not a production authorization/custody model.

Three AuditLog-specific endpoints expose submit, operation status, and
independent verification. Responses contain proof metadata and integrity
results, never the complete AuditLog payload or signer secret. A proof only
establishes integrity/existence of the committed reference/hash; for
example, proving a project-submission audit event does not prove project
approval.

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
- Which blockchain networks and contract deployments are approved beyond
  the local Hardhat development deployment
- Production signer custody and the mapping between application roles and
  authorized on-chain submitters
- Whether and how the legacy `blockchainTransactionHash` compatibility
  field is used by older records/consumers

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

## 44. Ordinary General-Body Governance Starter (Product Default)

The active implementation supports ordinary recorded general-body
resolutions only. The starter is versioned inside `SocietyRuleVersion` and
snapshotted into each resolution. The society-specific initial values are:

- eligible population: valid, same-society, `PRIMARY` + `ACTIVE` memberships
  whose linked User is active; ownership/residence/application role alone do
  not establish eligibility;
- quorum denominator: the snapshotted eligible-member population;
- quorum: `min(ceil(2 * eligibleMembers / 3), 20)`;
- majority: `YES > NO`; abstentions count toward quorum and not the YES/NO
  denominator;
- tie or unmet quorum: `NO_DECISION`;
- recorded, immutable, one-member-one-vote ballot; the starter method is show
  of hands.

These are configurable MVP product defaults, not a conclusion that every
Maharashtra society uses these rules. The official Maharashtra Co-operative
Societies Act, 1960, section 154B-11, establishes member voting rights and
includes an associate-member consent condition, provisional-member voting
rights, joint-member ordering, and a chairperson casting vote on equality. The
official Maharashtra Co-operative Societies Rules, 1961, Rule 60(2)-(5), says
general-meeting quorum is specified in society bye-laws and describes a
majority-of-members-present rule, a President casting vote, and show-of-hands
or ballot methods (subject to the Act, Rules, and bye-laws). The MVP does not
implement that chair procedure or establish that its YES/NO denominator
satisfies the applicable Rule 60 and registered bye-laws. Its simple-majority
and no-decision tie behavior is a configurable product default only, not a
claim of statutory compliance. Before real use, verify current amendments and
the society's registered bye-laws; keep the workflow disabled if its policy
differs. The MVP also blocks snapshot creation when current joint, associate,
or provisional membership records exist because its data model cannot verify
their relevant evidence. Registrar-issued model bye-laws are guidance and do
not replace a society's registered rules.

The manager activation endpoint records a society-provided document reference
as an assertion and creates a new immutable rule version; it does not verify
the document, adoption, legal applicability, or notice delivery. Policy
version-change authority and formal society approval evidence remain open
product/legal decisions. The MVP's supported project mapping is limited to a
passing general-body project resolution attached to the current SGM-required
`ApprovalDecision`, an SGM linked to that project, the same rule version,
amount, and quotation/change-request revision.

Committee-type general-body resolutions, special resolutions, elections, secret ballots, joint,
associate, and provisional membership eligibility, chairperson casting-vote
procedure, and other approval routes remain disabled. If current active joint,
associate, or provisional memberships exist in a society, eligibility
snapshot creation fails closed rather than silently excluding them. No
default is inferred for these cases.

Legal sources reviewed (official Maharashtra Registrar/Co-operation
Commissioner): [Maharashtra Co-operative Societies Act, 1960 (English)](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/maharashtra-co-operative-societies-act-1960-%20English%20Edition.pdf),
[Maharashtra Co-operative Societies Rules, 1961 (Government of Maharashtra PDF)](https://cdnbbsr.s3waas.gov.in/s33937230de3c8041e4da6ac3246a888e8/uploads/2023/06/2023062937.pdf),
and [Model Bye-Laws of Housing Co-operative Societies (proposed)](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/Model_ByeLaws_of_Housing_Cooperative_societies.pdf).

### Owner transparency authorization — 24 October 2026

Read-only transparency endpoints for owners require `OWNER_MEMBER` plus a
currently effective, persisted Ownership relationship in the target society.
An ended Residence does not revoke access while Ownership remains active.
This check does not grant voting eligibility or mutation rights. Residents do
not receive quotation, vendor, budget, audit, or proof access in this MVP;
their current scope remains published notices, complaints, and project
discovery summaries.

### Maharashtra approval-rule research — 24 October 2026

The approval engine still uses one configurable society project threshold;
this is an MVP product setting, not statutory advice. The reviewed Act text
(consolidated only through 6 June 2025) places final authority in the general
body subject to the Act, Rules, and registered bye-laws (s.72), and limits
committee management/powers to those legal instruments (s.73). Section
154B-11 is the housing-society membership voting provision; it does not make
application role, residence, or ownership alone a ballot credential.

The Commissioner for Cooperation's site lists a housing-society notification
dated 22 June 2026. The supplied Gazette reproduction identifies Part IV-B,
Extraordinary No.366 and Notification No. Sanini 0321/C.R.41/13-C dated
18 June 2026. The actual Gazette attachment was not retrievable during this
review; the English clause text was available only through third-party
reproductions. Those reproductions describe Rule 106C-13(5)(b) as a narrow
one-time-per-financial-year managing-committee competence for repair and
maintenance of society property, subject to membership-size caps. That text
does not establish that every other project or purchase above a cap
automatically requires an SGM, or that the caps replace registered bye-laws
for all spending categories. The exact provision, complete conditions,
effective date, member-count basis, tender/approval consequences, and
interaction with the Maharashtra Co-operative Societies (Amendment) Act,
2026 remain unverified against the primary Gazette text. Registered society
bye-laws are not present in this repository. Existing configurable routing
was therefore preserved; no new legal default or automated category rule
was added. Before real use, obtain the Gazette text and each society's
registered bye-laws and have the applicable procedures confirmed by a
qualified legal reviewer.

## Complaint intake and manager response slice — 23 October 2026

BR-COMPLAINT-001–003 now have an operational intake → acknowledgement →
progress → manager-resolution path. Owners/residents see their own records;
the society manager sees the society queue. No broader complaint visibility
or committee oversight is inferred from role assignment. Service-layer
transactions preserve state, append-only timeline and canonical AuditLog
events together. This adds no on-chain confirmation claim or new proof type.

BR-COMPLAINT-005 confirmation/reopening authority remains unresolved.
RESOLVED stays distinct from CLOSED. Assignment policy and secure evidence
upload integration are outside this bounded slice; their APIs are not exposed
as working features. Category and priority remain descriptive text because
the specification does not define fixed enumerations.

### Complaint evidence extension — 23 October 2026

The evidence-upload gap above is now implemented for JPEG/PNG complaint photos
using the specified evidence collection and endpoints. Creators upload initial
photos while OPEN; managers upload progress photos while ACKNOWLEDGED or
IN_PROGRESS and resolution photos while IN_PROGRESS or RESOLVED. These are
workflow checks, not a change to confirmation/reopening authority. There are
no public storage URLs or evidence deletion APIs. No paid storage provider or
new runtime dependency was introduced. See API/DATABASE/ARCHITECTURE for the
raw-byte protocol, validation limits, private local storage and failure handling.

### Targeted usability extension — 24 October 2026

Requested scope: complaint intake requires only a title; descriptive fields and
photos remain optional. An omitted description produces a factual initial
timeline entry using the submitted title. State transitions, private evidence,
audit transactions, confirmation/reopening restrictions remain unchanged.

Notice scans reuse Evidence and the existing private local storage adapter,
JPEG/PNG validation and authenticated download endpoint. Attachments are added
only to drafts, transactionally with metadata/audit evidence. Publication locks
attachments; the existing notice audience and expiry restrictions apply on every
download. PDF/Office support is deferred: accepting those formats requires a safe
document-validation/storage decision, not merely trusting a MIME type.

Members & Flats searches persisted flats by building name, flat number and floor.
No flat is selected implicitly. Creation of buildings/flats remains System Admin
only via existing property APIs; the manager is told exactly what to request and
can refresh. Application role, ownership, occupancy and membership stay separate.

The /voting browser route is temporarily unavailable at the owner's request.
Governance APIs, records and audit history are retained. A local Hardhat reset can
reuse deployment addresses/hashes; saved confirmation is historical evidence,
not current verification. See BLOCKCHAIN.md for UNVERIFIABLE display semantics.

## 45. Committee project approval and offline general-body record (24 October 2026)

This approved product milestone supersedes the earlier statement that all committee decisions are disabled, only for proposals already routed to `COMMITTEE_APPROVAL` by the existing configured threshold policy. It enables authenticated committee-member decisions and a separate immutable committee result. It does not grant committee authority over proposals routed to a general body.

MVP committee policy defaults are quorum of two-thirds of active committee members rounded up, and strictly more than half of recorded APPROVE/REJECT decisions. These values, quorum cap, and majority formula are versioned configurable approval-policy fields. The Society Manager is the only MVP finalizing operator. These defaults and operator authority are product assumptions, not statutory determinations.

Offline general-body project decisions use existing `GovernanceResolution` and eligibility snapshots plus a separate immutable `OfflineResolutionRecord`. The Society Manager confirms method, unique eligible attendance, aggregate YES/NO/ABSTAIN counts, minutes/evidence references, result and timestamp. Counts must equal attendance. The configured quorum and majority must produce APPROVED before project state can change; otherwise it remains pending. Unanimous results retain the attendance list and explicit counts. No individual offline ballot is stored or put on-chain.

The active route remains the existing configured threshold route. Category and budget decision-body mappings, exact committee authority categories, appointment evidence standards, officer confirmation authority beyond this MVP, current Gazette wording, registered bye-laws, and statutory quorum/majority/notice requirements are unresolved. Do not infer mappings or legal rules. Existing AuditLog immutability and blockchain proof semantics are unchanged; personal attendance and vote data remain off-chain.

## 46. Project lifecycle and expense tracking (24 October 2026)

Progress/completion updates and expenses are implemented as append-only records
with existing AuditLog transactions. The MVP allows the Society Manager to
record progress, photos, expenses, and completion. Completion requires a
completion update, invoice reference, after-photo, and final cost within the
approved amount and at least recorded expenses. These operational permissions
are product assumptions and do not resolve the business-rule question of
official completion authority.

Expenses are limited by both the approved project amount and the approved
budget-category allocation. A project overrun uses the existing quotation
change-request/re-approval workflow. The budget/category amendment approval
route is unresolved, so an expense over that limit is rejected and no
amendment is implicitly made. No legal threshold or spending authority is
introduced. Expense counters and the audit event are committed transactionally.
Project-owner visibility requires active same-society Ownership; residence is
not sufficient. Evidence and financial entries remain off-chain, and these
actions do not generate blockchain proofs.

## 47. Per-login refresh sessions (26 October 2026)

The requested independent browser-tab sessions use one opaque, 256-bit
refresh credential per successful login. The raw refresh token is held only
in that tab's `sessionStorage`; the backend stores its SHA-256 hash in the
dedicated `AuthSession` collection. Refresh sessions have a configurable
absolute lifetime (`AUTH_REFRESH_SESSION_TTL_SECONDS`, 30 days by default in
local development) and do not slide on renewal. Access JWTs retain their
existing short configured lifetime. Refresh reloads the persisted User and
accepts only an active account; authorization remains unchanged.

Renewal credentials are stable for the lifetime of a session rather than
rotated on each refresh. This avoids invalidating a valid session when a
successful refresh response is lost in transit and makes simultaneous
refreshes safe. The trade-off is that a stolen refresh secret remains useful
until absolute expiry or revocation; TLS, browser XSS protections, tab-local
storage and explicit logout remain important. The collection stores hashes,
not raw credentials. Explicit logout revokes only the matching refresh
session; previously issued access tokens remain usable until their short JWT
expiry. Logout clears the UI immediately and performs server revocation
best-effort if the network is available.

The browser does not synchronize credentials across tabs. A live duplicate
tab with cloned `sessionStorage` is detected with `BroadcastChannel` using a
non-secret session identifier, and the clone clears its local copy. Where the
API is unavailable, the client retains its current session and does not
discard it on a transient network error. Each protected request is retried at
most once after a successful renewal. No governance, permission, API scope or
business-state rule changes.

## 48. Cloudinary evidence delivery (11 November 2026)

New production deployments use the official Cloudinary Node SDK for private
evidence. Nivaas sends validated JPEG/PNG uploads from the backend using
authenticated (`type=authenticated`) image assets; unsigned upload presets and
public delivery are not used. Downloads remain behind the existing backend
authorization and integrity checks. A short-lived signed Cloudinary download
URL is generated only server-side for the fetch and is never persisted or
returned to clients. Delete uses the stored Cloudinary public ID, resource type
and delivery type.

Evidence records store a hidden provider discriminator. Cloudinary records also
store hidden asset ID, resource type, authenticated delivery type, format and
version; credentials and signed URLs are never stored. Local and S3 adapters
remain available. Pre-discriminator records use the configured legacy provider
fallback. If historical records mix untagged local and S3 references, the
fallback cannot determine each record's provider; inventory and perform a
separately reviewed migration before switching that database. MongoDB remains
the metadata, authorization and SHA-256 integrity source of truth.
