## Database Specification

**Document:** `DATABASE.md` **Version:** 1.17 **Database:** MongoDB
**Status:** Active Planning Document --- Revised Governance, Membership & Rule Versioning Schema

------------------------------------------------------------------------

# 1. DATABASE PURPOSE

MongoDB stores the normal application data of Nivaas. Blockchain
is not the primary database. The database stores detailed information
required by the application, while selected important records may
additionally have blockchain references.

------------------------------------------------------------------------

# 2. DATABASE DESIGN PRINCIPLES

1.  Do not store large files directly in MongoDB where unnecessary.
2.  Do not duplicate information unnecessarily.
3.  Preserve historical records where immutability is required.
4.  Use references between major entities.
5.  Store timestamps on important records.
6.  Store creator/updater information where appropriate.
7.  Never use frontend data as the source of authorization truth.
8.  Keep blockchain transaction references separate from normal business
    data where appropriate.

------------------------------------------------------------------------

# 3. ENTITY OVERVIEW

The primary entities are:

    Society
    User
    Building
    Flat
    Committee
    CommitteeMember

    Budget
    BudgetCategory
    Expense

    Project
    Quotation
    ChangeRequest
    Vendor
    ProjectUpdate

    Meeting
    Proposal
    GovernanceResolution
    GovernanceVote

    # Future election architecture
    Election
    ElectionEligibleVoter
    AnonymousBallot
    ElectionResult

    Payment

    Complaint
    Notice

    Evidence
    AuditLog

------------------------------------------------------------------------

# 4. SOCIETY

## Collection

    societies

## Purpose

Represents an apartment society.

## Fields

    _id
    name
    registrationNumber
    address
    contactEmail
    contactPhone
    configurationVersion
    activeRuleVersionId
    financialYearStart
    financialYearEnd
    status
    createdAt
    updatedAt

## Relationships

    Society
     ├── Buildings
     ├── Users
     ├── Committee
     ├── Budgets
     ├── Projects
     ├── Meetings
     ├── Complaints
     ├── Notices
     └── Payments

------------------------------------------------------------------------

# 5. SOCIETY RULE CONFIGURATION

## Collection

    societyRuleVersions

## Purpose

Stores versioned governance and operational configuration used by the
Approval Engine and governance services.

## Fields

    _id
    societyId
    versionNumber
    status
    effectiveFrom
    effectiveTo
    changeReason
    supportingDocumentReference
    policyChangeAuditLogId
    approvalPolicy
    majorityRules
    quorumRules
    noticeRules
    votingRules
    procurementRules
    financialVisibilityRules
    complaintRules
    completionRules
    createdBy
    createdAt
    updatedAt

The exact configuration object may evolve, but historical decisions must
retain a reference to the rule version that was applied.

Approval-threshold changes create a new rule version. `changeReason`,
`supportingDocumentReference`, and `policyChangeAuditLogId` are immutable on
that version; the prior threshold is preserved in the linked append-only
AuditLog event. `effectiveTo` and the superseded status are the lifecycle
closure changes to the previous active version. The audit metadata contains a
domain-separated canonical configuration commitment over society ID, policy
type, rule-version number, and threshold. The blockchain proof, when available,
proves the AuditLog hash that contains that commitment; MongoDB remains the
authoritative configuration store.

------------------------------------------------------------------------

# 6. USER

## Collection

    users

## Purpose

Represents a person using the system.

## Fields

    _id
    societyId
    name
    email
    phone
    passwordHash
    role
    walletAddress
    status
    createdAt
    updatedAt

`societyId` may be null for a platform-wide `SYSTEM_ADMIN` account and is
required and non-null for every society-scoped role. The platform-wide
`SYSTEM_ADMIN` role does not itself establish a society association or
membership; a fake or synthetic society must not be assigned merely to
satisfy an account schema. Any society association recorded for a user does
not change the `SYSTEM_ADMIN` role's platform scope or create society
membership.

The only `status` values for User accounts are `PENDING_SETUP`, `ACTIVE`,
and `DISABLED`. The permitted lifecycle transitions are:

```text
PENDING_SETUP -> ACTIVE
PENDING_SETUP -> DISABLED
ACTIVE -> DISABLED
DISABLED (entered from ACTIVE) -> ACTIVE
DISABLED (entered from PENDING_SETUP) -> PENDING_SETUP
```

`PENDING_SETUP` means the newly created account has not completed account/
password setup. Such an account cannot authenticate with a normal password
or access protected application APIs; it may use `POST /auth/setup`. It
becomes `ACTIVE` only after successful account setup. A `DISABLED` account
cannot authenticate or access protected application APIs, and JWT
possession does not override persisted status. Reactivation restores the
status from which the user entered `DISABLED`; a user disabled from
`PENDING_SETUP` returns to that state and still requires setup. Required
status-transition AuditLog events record `previousState.status` and
`newState.status` so the lifecycle origin is retained.

Account setup and status are separate from ownership, residence/occupancy,
society membership, committee membership, and governance/voting eligibility.
Disabling a User does not delete the User or the historical/domain
relationships associated with that User.

The backend generates a single-use account-setup credential so the user can
establish a password. It cannot be reused after successful consumption or
expiry, and the administrator does not receive or set the permanent
password. The raw credential is never stored. Its dedicated persistence is
defined below; delivery remains implementation-specific.

`passwordHash` is absent while a user is `PENDING_SETUP` and is populated
only when the user successfully establishes a password through setup. A
user disabled from `PENDING_SETUP` remains without a password hash and
returns to `PENDING_SETUP` when reactivated. A user disabled from `ACTIVE`
retains their established password hash and returns to `ACTIVE` when
reactivated. No placeholder or administrator-supplied password hash is
used for pending setup.

## AccountSetupCredential

### Collection

    accountSetupCredentials

### Purpose

Stores only the hash and lifecycle information for a one-time initial
account-setup credential. It is not a generic token framework.

### Fields

    _id
    userId
    credentialHash
    createdAt
    expiresAt
    consumedAt
    revokedAt

- `_id` is a generated MongoDB ObjectId.
- `userId` is a required ObjectId reference to the intended `User`.
- `credentialHash` is a required String containing a cryptographic hash of
  the raw credential;
  raw credential material must never be persisted. Its hash algorithm and
  encoded representation remain an implementation decision.
- `createdAt` is a required MongoDB Date generation timestamp. `expiresAt`
  is a required MongoDB Date exactly 24 hours after generation.
- `consumedAt` is an optional MongoDB Date, absent or null until successful
  setup, then records
  consumption. A consumed credential cannot be used again.
- `revokedAt` is an optional MongoDB Date, absent or null until an authorized
  local credential reissue invalidates the credential. A revoked credential
  cannot be used even if it has not expired or been consumed.
- The credential is usable only while unconsumed, unrevoked, unexpired, and associated
  with a User currently in `PENDING_SETUP` status.

The credential lookup requires a unique index on `credentialHash`. Expired
and consumed credential retention/cleanup remains unspecified. Reissue revokes
outstanding credentials and creates the new hash and expiry in the same
transaction as a secret-free AuditLog event. Reissue delivery is local-only
until a secure production delivery provider is configured.

Successful account setup must atomically persist the new User password hash,
consume the credential, change User status from `PENDING_SETUP` to `ACTIVE`,
and append the mandatory AuditLog status-transition event. The deployment
must support the MongoDB transaction needed to prevent partial completion.
The AuditLog transition records `previousState.status` and `newState.status`
so a later reactivation can restore the account's lifecycle state. No
No separate AuditLog event is required for initial credential generation,
consumption alone, or failed setup attempts. Administrative reissue writes its
own secret-free AuditLog event in the same transaction.

`email` is a unique login identity across user accounts. The case and
normalization policy used to determine email identity is not specified.
The permitted profile/account-information update fields are `name`,
`email`, `phone`, and `walletAddress`; this does not add fields to the User
entity. The API/business rules define that `_id`, `societyId`, `role`,
`status`, `passwordHash`, `createdAt`, and `updatedAt` are not editable
through `PATCH /users/:id`.

## AuthSession

### Collection

    authSessions

### Purpose

Stores one revocable refresh session for each successful login. A session is
per login/tab, not one shared browser cookie. The raw refresh token is never
persisted; only its SHA-256 hash is stored.

### Fields

    _id
    sessionId
    userId
    tokenHash
    createdAt
    expiresAt
    revokedAt

- `sessionId` is a random, non-secret identifier and is unique.
- `userId` references the persisted User whose credentials authenticated.
- `tokenHash` is a unique SHA-256 hash of a 256-bit random base64url token.
- `createdAt` is the login time. `expiresAt` is an absolute expiry set from
  `AUTH_REFRESH_SESSION_TTL_SECONDS`; access-token renewal does not extend it.
- `revokedAt` is absent until explicit logout or an authoritative inactive-
  user check revokes the session.
- An expiry TTL index may remove expired sessions. Expiry is checked directly
  by the refresh operation and does not depend on TTL cleanup timing.

Refresh sessions are separate from one-time `AccountSetupCredential` records.
No society, role, membership or governance authority is copied into the
session record. Renewal reloads the active User; normal request authorization
continues to use the existing persisted-user and society-scoped middleware.

## Role

One of:

    SYSTEM_ADMIN
    SOCIETY_MANAGER
    COMMITTEE_MEMBER
    OWNER_MEMBER
    RESIDENT

## Relationships

A User with a society-scoped role must belong to one Society through
`societyId`. A `SYSTEM_ADMIN` is platform-wide; its role does not by itself
establish society membership.

A society-scoped User may also have:

-   one or more ownership relationships
-   one or more residence/occupancy relationships
-   one or more membership records
-   one or more committee memberships

------------------------------------------------------------------------

# 7. BUILDING

## Collection

    buildings

## Fields

    _id
    societyId
    name
    buildingCode
    address
    numberOfFloors
    status
    createdAt
    updatedAt

## Relationship

    Society
       ↓
    Buildings

`buildingCode` is optional. The unique compound index
`(societyId, buildingCode)` uses a partial filter for string-valued codes so
omitted codes do not collide. This preserves per-society uniqueness for codes
that are present. Existing legacy sparse indexes require the guarded
`migrate:building-code-index` operation after checking the target database;
the migration never rewrites building records and refuses protected database
names.

------------------------------------------------------------------------

# 8. FLAT

## Collection

    flats

## Fields

    _id
    societyId
    buildingId
    flatNumber
    floor
    type
    status
    createdAt
    updatedAt

Ownership is represented by the `ownerships` collection, and
residence/occupancy is represented by the `residences` collection. These
relationship collections are authoritative. Owner and resident ID arrays
are intentionally not duplicated on Flat. A flat may have multiple owners
and multiple residents through these relationships.

`flatNumber` is stored as text so values such as `002` retain leading zeroes.
The unique database index `(buildingId, flatNumber)` prevents duplicate flat
numbers inside one building, including concurrent inserts; the same number may
be used in another building. A building's society relationship is validated
when a flat is created. Existing duplicate data is not rewritten automatically;
index creation must be investigated and remediated explicitly if legacy
duplicates prevent the unique index from being established.

------------------------------------------------------------------------

# 9. OWNERSHIP RELATIONSHIP

## Collection

    ownerships

## Purpose

Represents the relationship between a user and a flat for ownership
purposes. Ownership is intentionally separate from society membership and
residence.

## Fields

    _id
    societyId
    flatId
    userId
    ownershipType
    ownershipOrder
    status
    startDate
    endDate
    createdAt
    updatedAt

Multiple owners may be associated with one flat. Ownership does not by itself
grant multiple governance votes.

Read-only owner transparency authorization also queries this collection for
the authenticated owner, target society, `status: ACTIVE`, and currently
effective `startDate`/`endDate`. Residence and Membership are deliberately not
used as substitutes. Ending a Residence does not alter Ownership and
therefore does not revoke owner transparency; ending Ownership or its
effective period does. This authorization adds no schema/index change.

------------------------------------------------------------------------

# 10. RESIDENCE / OCCUPANCY

## Collection

    residences

## Fields

    _id
    societyId
    flatId
    userId
    occupancyType
    status
    startDate
    endDate
    createdAt
    updatedAt

Residence is separate from ownership and membership. A resident who is not
an eligible society member does not automatically receive governance voting
rights.

------------------------------------------------------------------------

# 11. MEMBERSHIP

## Collection

    memberships

## Purpose

Represents the user's society membership and the information required to
determine governance eligibility.

## Fields

    _id
    societyId
    userId
    membershipType
    membershipStatus
    membershipNumber
    primaryMemberOrder
    associatedFlatIds
    validFrom
    validTo
    createdAt
    updatedAt

## Membership Types

    PRIMARY
    JOINT
    ASSOCIATE
    PROVISIONAL

Membership status is separate from financial default status.

The system must be able to determine the applicable member for a specific
governance resolution without inferring eligibility from the number of flats
owned.

------------------------------------------------------------------------

# 12. COMMITTEE

## Collection

    committees

## Fields

    _id
    societyId
    name
    termStart
    termEnd
    status
    createdAt
    updatedAt

------------------------------------------------------------------------

# 13. COMMITTEE MEMBER

## Collection

    committeeMembers

## Fields

    _id
    committeeId
    userId
    position
    startDate
    endDate
    status
    createdAt
    updatedAt

------------------------------------------------------------------------

# 14. BUDGET

## Collection

    budgets

## Fields

    _id
    societyId
    financialYear
    title
    description
    status
    totalAllocated
    totalSpent
    totalRemaining
    approvedAt
    approvedBy
    createdAt
    updatedAt

## Status

    DRAFT
    SUBMITTED
    UNDER_REVIEW
    APPROVED
    REJECTED
    CLOSED

------------------------------------------------------------------------

# 15. BUDGET CATEGORY

## Collection

    budgetCategories

## Fields

    _id
    budgetId
    name
    description
    allocatedAmount
    spentAmount
    remainingAmount
    createdAt
    updatedAt

## Example Categories

    Maintenance
    Water Tankers
    Repairs & Maintenance
    Housekeeping
    Security
    Managerial
    Administrative
    Training
    Sewerage Cleaning
    Tank Cleaning
    Pest Control
    Gardening
    Parking Area Cleaning
    Other

------------------------------------------------------------------------

# 16. EXPENSE

## Collection

    expenses

## Fields

    _id
    societyId
    budgetId
    budgetCategoryId
    projectId
    vendorId
    title
    description
    amount
    invoiceReference
    status
    expenseDate
    createdBy
    createdAt

The current MVP permits only append-only `RECORDED` expenses. Each expense is
bound to a project, its society, an APPROVED budget and a category in that
budget. It stores an optional society-supplied invoice reference; invoice-file
upload is not implemented. Budget/category `spentAmount`, `remainingAmount`,
and budget totals are recalculated in the same transaction as the expense and
audit event. Project approved-cost and category allocation caps are enforced
before insertion. The model has no `updatedAt` because financial entries are
immutable. No overrun approval route is modeled while that rule remains TBC.

## Project Updates

Collection: `projectUpdates`

Fields: `_id`, `societyId`, `projectId`, `kind` (`PROGRESS` or `COMPLETION`),
`title`, `description`, optional `invoiceReference`, `createdBy`, `createdAt`.
Records are append-only. Photo metadata is stored as an Evidence record
related to this update; evidence IDs and hashes are queried through the
immutable Evidence collection rather than modifying the update.

Index: `(societyId, projectId, createdAt)`.

## Project Update Evidence

Evidence may reference `relatedEntityType: ProjectUpdate` and use
`PROGRESS_PHOTO` or `AFTER_PHOTO`. Bytes remain in private local evidence
storage; only metadata and SHA-256 are stored in MongoDB. `AFTER_PHOTO` on a
COMPLETION update is a prerequisite for the current manager completion route.
No private photo, invoice, or personal data is placed on-chain by this
workflow.

------------------------------------------------------------------------

# 17. PROJECT

## Collection

    projects

## Fields

    _id
    societyId
    title
    description
    category
    estimatedCost
    approvedCost
    finalCost
    status
    proposedBy
    approvalType
    approvalStatus
    meetingId
    vendorId
    budgetId
    currentQuotationId
    governanceResolutionId
    activeRuleVersionId
    createdAt
    updatedAt

`currentQuotationId` is maintained only by the transactional quotation
selection transition. Generic project edits must not accept this field.

## Status

    DRAFT
    SUBMITTED
    UNDER_REVIEW
    QUOTATION_ADDED
    APPROVAL_REQUIRED
    COMMITTEE_APPROVAL
    SGM_REQUIRED
    APPROVED
    VENDOR_SELECTED
    IN_PROGRESS
    CHANGE_REQUESTED
    RE_APPROVAL
    COMPLETED
    FINAL_INVOICE
    CLOSED
    CANCELLED
    REJECTED

------------------------------------------------------------------------

# 18. APPROVAL DECISION / EVALUATION

## Collection

    approvalDecisions

## Purpose

Represents an Approval Engine evaluation and the governance requirement it
produced. Keeping this separate from the Project makes approval evaluation
history auditable and supports re-approval after quotation changes.

## Fields

    _id
    societyId
    projectId
    quotationVersionId
    changeRequestId
    ruleVersionId
    evaluatedAmount
    approvalType
    requiredDecisionBody
    status
    reason
    meetingId
    governanceResolutionId
    evaluatedAt
    evaluatedBy
    createdAt

Possible approval types include:

    COMMITTEE_APPROVAL
    GENERAL_BODY_APPROVAL
    SGM_REQUIRED
    RE_APPROVAL_REQUIRED
    ADDITIONAL_APPROVAL_REQUIRED
    NOT_READY_FOR_APPROVAL

An approval decision is never treated as historical truth solely from the
current society configuration; it must reference the rule version used at
the time of evaluation.

------------------------------------------------------------------------

# 19. PROJECT APPROVAL DATA

Approval-related data should reference:

    projectId
    approvalType
    requiredThreshold
    meetingId
    proposalId
    approvalStatus
    approvedAt
    approvedBy
    blockchainTransactionHash

The exact schema may be separated into a dedicated Approval collection
if the final implementation requires it.

------------------------------------------------------------------------

# 20. VENDOR

## Collection

    vendors

## Fields

    _id
    societyId
    name
    companyName
    contactPerson
    phone
    email
    address
    registrationDetails
    status
    createdAt
    updatedAt

------------------------------------------------------------------------

# 21. QUOTATION

## Collection

    quotations

## Fields

    _id
    projectId
    vendorId
    versionNumber
    amount
    description
    documentEvidenceId
    status
    previousQuotationId
    supersededAt
    submittedBy
    submittedAt
    createdAt
    updatedAt

## Status

    DRAFT
    SUBMITTED
    UNDER_REVIEW
    SELECTED
    SUPERSEDED
    REJECTED

------------------------------------------------------------------------

# 22. QUOTATION VERSIONING

Example:

    Project P001

    Quotation Q001
    versionNumber = 1
    amount = ₹2,00,000

    Quotation Q002
    versionNumber = 2
    amount = ₹2,30,000
    previousQuotationId = Q001

Q001 remains in the database.

Selection marks one quotation `SELECTED`, supersedes the previously
selected quotation when present, and updates the owning project's
`currentQuotationId` atomically. Selection does not represent project
approval.

------------------------------------------------------------------------

# 23. CHANGE REQUEST

## Collection

    changeRequests

## Fields

    _id
    projectId
    quotationId
    originalAmount
    additionalAmount
    newAmount
    reason
    supportingEvidenceIds
    requestedBy
    status
    requiredApprovalType
    approvalMeetingId
    approvalDecisionId
    resultingQuotationId
    createdAt
    updatedAt

When a submitted change request belongs to the currently selected
quotation, its persisted `newAmount` is evaluated by the Approval Engine
and the project moves to `RE_APPROVAL` in the same transaction. The
resulting quotation version is created only by a future approved workflow.

## Status

    DRAFT
    SUBMITTED
    UNDER_REVIEW
    APPROVED
    REJECTED
    REQUIRES_SGM

------------------------------------------------------------------------

# 24. PROJECT UPDATE

## Collection

    projectUpdates

## Fields

    _id
    projectId
    title
    description
    statusAtUpdate
    createdBy
    evidenceIds
    createdAt

Project updates are chronological and should not be silently deleted.

------------------------------------------------------------------------

# 25. MEETING

## Collection

``` text
meetings
```

## Purpose

Represents an AGM, SGM, or committee meeting.

A meeting is the container for one or more agenda items and governance
decisions. A meeting is not itself a vote.

## Fields

``` text
_id
societyId
type
title
description
scheduledAt
location
agenda
status
noticeId
noticeIssuedAt
noticePeriodDays
requisitionId
quorumRuleVersionId
attendanceCount
quorumStatus
createdBy
createdAt
updatedAt
```

## Types

``` text
AGM
SGM
COMMITTEE
```

## Relationship

``` text
Meeting
   ↓
Proposal / Resolution
   ↓
Voting
   ↓
Result
   ↓
Approval / Rejection
```

------------------------------------------------------------------------

# 26. PROPOSAL

## Collection

``` text
proposals
```

## Purpose

A Proposal represents the subject or agenda item presented for
consideration at a meeting.

A proposal may be associated with:

-   A project
-   A budget
-   A vendor
-   A quotation
-   Another governance matter

A Proposal may result in a Governance Resolution when a formal decision
is required.

## Fields

``` text
_id
societyId
projectId
meetingId
title
description
amount
proposalType
status
governanceResolutionId
createdBy
createdAt
updatedAt
```

The proposal should not itself contain individual votes.

------------------------------------------------------------------------

# 27. GOVERNANCE RESOLUTION

## Collection

``` text
governanceResolutions
```

## Purpose

Represents the formal decision that participants are asked to make.

This separates the meeting/agenda item from the actual decision and from
the individual votes.

## Fields

``` text
_id
societyId
meetingId
proposalId
projectId
resolutionType
title
description
amount
votingMethod
votingStart
votingEnd
eligibilityRule
majorityRule
quorumRequired
ruleVersionId
eligibilitySnapshotId
status
result
approvedAt
createdBy
createdAt
updatedAt
```

## Resolution Types

``` text
PROJECT_APPROVAL
BUDGET_APPROVAL
VENDOR_APPROVAL
QUOTATION_APPROVAL
OTHER
```

## Voting Methods

``` text
SHOW_OF_HANDS
BALLOT
POLL
```

The available voting methods are configurable according to the
applicable society rules and the specific governance decision.

The database must not assume that every governance resolution is a
secret ballot.

## Status

``` text
DRAFT
OPEN
CLOSED
APPROVED
REJECTED
CANCELLED
```

## Result

The result should be derived from the recorded GovernanceVote records
and configured governance rules rather than manually typed by an
administrator.

The result may contain derived information such as:

``` text
totalEligible
totalVotes
yesCount
noCount
abstainCount
quorumMet
passed
calculatedAt
```

------------------------------------------------------------------------

# 28. GOVERNANCE ELIGIBILITY SNAPSHOT

## Collection

    governanceEligibilitySnapshots

## Purpose

Stores the eligibility basis used when a governance resolution is opened.
This prevents later membership/configuration changes from silently rewriting
a historical decision.

## Fields

    _id
    resolutionId
    societyId
    ruleVersionId
    eligibilityRule
    eligibleMemberIds
    eligibleCount
    generatedAt
    generatedBy

For sensitive future election workflows, eligibility data must be separated
from anonymous ballots.

------------------------------------------------------------------------

# 29. GOVERNANCE VOTE

## Collection

``` text
governanceVotes
```

## Purpose

Stores an individual vote for a governance resolution in the semester
MVP.

This collection is intended for governance resolutions such as:

-   AGM decisions
-   SGM project approvals
-   Budget decisions
-   Vendor decisions
-   Quotation decisions
-   Other configured governance resolutions

It is **not** the database model for future secret-ballot elections.

## Fields

``` text
_id
resolutionId
voterId
vote
walletAddress
blockchainStatus
blockchainTransactionHash
castAt
createdAt
```

## Vote Values

``` text
YES
NO
ABSTAIN
```

Whether `ABSTAIN` participates in the final decision calculation remains
configurable/TBC.

## Voting Rules

The backend must validate:

-   Resolution is open
-   Voter is authenticated
-   Voter is eligible
-   Voting period is active
-   Voting method permits the operation
-   Voter has not already voted where only one vote is permitted
-   Any configured voting weight/eligibility rule

The final result must be calculated from the recorded votes.

## Vote Immutability

Once recorded, a GovernanceVote must not be silently edited or deleted.

If a correction process is required, it must create a separate auditable
event rather than overwrite the original vote.

## Vote Uniqueness

For resolutions where one vote per eligible participant is required, the
database should enforce:

``` text
unique:
resolutionId + voterId
```

The smart contract must independently prevent duplicate governance
voting where blockchain voting is implemented.

## Governance ordinary general-body workflow

`SocietyRuleVersion` carries a typed, versioned `governancePolicy` envelope.
Its `schemaVersion` is distinct from the society's `versionNumber`. The
envelope stores explicit per-decision eligibility, quorum, majority, voting,
vote-change and ballot-privacy rules. Legacy `majorityRules`, `quorumRules`,
and `votingRules` `Mixed` values remain readable but are not silently
migrated. Once activated, a typed policy is immutable within that rule
version; edits create a new version. Activation validates the complete
configuration. The manager-supplied document reference is recorded as an
assertion, not legal certification by Nivaas.

The starter ordinary general-body policy is a configurable product default:
eligible population is the immutable eligible-member snapshot; quorum is
`min(ceil(2 * eligibleCount / 3), 20)`; YES must be strictly greater than NO;
ABSTAIN counts toward attendance/quorum and is excluded from the YES/NO
denominator; tie or unmet quorum yields `NO_DECISION`. The configuration
selects only `PRIMARY` and `ACTIVE` membership records with valid dates and
active same-society users. Snapshot creation fails closed when it finds any
current active `JOINT`, `ASSOCIATE`, or `PROVISIONAL` memberships, because the
current model cannot validate the statutory ordering, consent, and provisional
basis evidence needed to decide their rights. They are not silently omitted.

The `meetings`, `governanceResolutions`, `governanceEligibilitySnapshots`,
and `governanceVotes` collections are society-scoped. A resolution stores the
rule/policy and eligibility snapshots. The eligibility snapshot is unique per
resolution and contains private voter IDs; API responses expose only its
count. Votes are append-only and indexed uniquely by `(societyId,
resolutionId, voterId)`. Result counts, quorum and outcome are persisted and
immutable after calculation. Transactions guard votes against concurrent
closure/finalization. The focused integration suite creates and verifies the
snapshot and vote uniqueness indexes and exercises concurrent finalization
against the configured `nivaas_test` `rs0` replica set. Deployment-specific
index creation and transaction behavior still require verification in each
target environment.

Meeting publication and each resolution lifecycle transition write append-only
AuditLog events. A project can be approved only by finalizing an APPROVED
project resolution whose current same-society `ApprovalDecision`, SGM meeting,
rule version, amount and quotation revision/change-request context all still
match. REJECTED and `NO_DECISION` outcomes do not update project approval.
After successful finalization, the canonical AuditLog proof service is called;
the proof status is confirmed only after a successful chain receipt and
matching registry read-back.

Committee decisions, special resolutions, elections/secret ballots, chair
casting votes, unsupported membership categories, other approval route
mappings, and legal adoption verification remain disabled or unresolved. A
stored notice reference does not prove delivery or legal sufficiency.

------------------------------------------------------------------------

# 30. FUTURE ELECTION ARCHITECTURE

Committee/election voting is deliberately separated from
GovernanceResolution/GovernanceVote.

Actual committee elections are **not part of the semester MVP**.

The following collections are reserved for a future secret-ballot
implementation:

## 24.1 ELECTION

### Collection

``` text
elections
```

### Purpose

Represents a formal committee/election event.

### Conceptual fields

``` text
_id
societyId
title
description
electionType
votingStart
votingEnd
status
candidateIds
eligibleVoterCount
resultId
createdAt
updatedAt
```

------------------------------------------------------------------------

## 24.2 ELECTION ELIGIBLE VOTER

### Collection

``` text
electionEligibleVoters
```

### Purpose

Stores eligibility information separately from the voter's ballot
choice.

### Conceptual fields

``` text
_id
electionId
voterId
eligibilityStatus
credentialReference
createdAt
```

The final implementation must prevent this collection from providing a
public relationship between a voter and their selected candidate.

------------------------------------------------------------------------

## 24.3 ANONYMOUS BALLOT

### Collection

``` text
anonymousBallots
```

### Purpose

Represents an anonymous election ballot.

### Conceptual fields

``` text
_id
electionId
anonymousCredential
encryptedBallot
ballotCommitment
blockchainTransactionHash
castAt
```

The final implementation must be designed so that a public or ordinary
application query cannot derive:

``` text
Voter Identity → Candidate Chosen
```

The exact cryptographic mechanism is outside the semester MVP and will
be defined only if the election module is implemented later.

------------------------------------------------------------------------

## 24.4 ELECTION RESULT

### Collection

``` text
electionResults
```

### Purpose

Stores the calculated result of an election without exposing individual
voter choices.

### Conceptual fields

``` text
_id
electionId
candidateResults
totalEligible
totalBallots
invalidBallots
countedAt
blockchainTransactionHash
createdAt
```

------------------------------------------------------------------------

# 31. GOVERNANCE VOTING VS ELECTION VOTING

The database must maintain a strict distinction:

``` text
                 Voting
                    │
          ┌─────────┴─────────┐
          │                   │
Governance Resolution      Election
          │                   │
      MVP model           Future model
          │                   │
GovernanceVote          AnonymousBallot
          │                   │
  Configurable method     Secret ballot
```

Governance votes may be associated with an identified voter where the
applicable governance procedure permits it.

Election ballots must not expose the relationship between voter identity
and candidate choice when secret-ballot rules apply.

------------------------------------------------------------------------

# 32. PAYMENT

## Collection

``` text
payments
```

## Fields

``` text
_id
societyId
flatId
userId
type
referenceId
amount
currency
status
paymentMethod
walletAddress
blockchainTransactionHash
paidAt
createdAt
updatedAt
```

## Status

``` text
PENDING
CONFIRMED
FAILED
CANCELLED
```

## Type

Examples:

``` text
MAINTENANCE
PROJECT
OTHER
```

## Collection

    payments

## Fields

    _id
    societyId
    flatId
    userId
    type
    referenceId
    amount
    currency
    status
    paymentMethod
    walletAddress
    blockchainTransactionHash
    paidAt
    createdAt
    updatedAt

## Status

    PENDING
    CONFIRMED
    FAILED
    CANCELLED

## Type

Examples:

    MAINTENANCE
    PROJECT
    OTHER

------------------------------------------------------------------------

# 33. COMPLAINT

Implementation note: the first operational slice persists societyId,
createdBy, title, description, category, priority, status, resolvedAt and
timestamps. Identity and original complaint content are immutable. Optional
flat/assignment/closure fields below are reserved for subsequent supported
workflows and are not accepted by the current creation API. Compound indexes
cover society/creator/date and society/status/date. State updates use version
and status checks inside MongoDB transactions with timeline and audit writes.

## Collection

    complaints

## Fields

    _id
    societyId
    flatId
    createdBy
    title
    description
    category
    priority
    status
    assignedTo
    resolvedAt
    closedAt
    createdAt
    updatedAt

## Status

    OPEN
    ACKNOWLEDGED
    ASSIGNED
    IN_PROGRESS
    RESOLVED
    CLOSED
    REOPENED

------------------------------------------------------------------------

# 34. COMPLAINT UPDATE

Implemented timeline records contain complaintId, status, description,
createdBy and createdAt, indexed by complaint/date. Normal model updates,
deletes, replacements and mutating bulk writes are rejected. No API permits
timeline edits. Photo timeline entries now store immutable `evidenceIds`;
earlier entries without this field remain valid.

Complaint updates should be stored as timeline records. Possible
structure:

    complaintUpdates

Fields:

    _id
    complaintId
    status
    description
    createdBy
    evidenceIds
    createdAt

This prevents the complaint history from becoming one mutable text
field.

------------------------------------------------------------------------

# 35. NOTICE

## Collection

    notices

## Fields

    _id
    societyId
    title
    description
    category
    priority
    status
    publishedAt
    expiresAt
    createdBy
    attachmentIds
    meetingId
    projectId
    createdAt
    updatedAt

## Status

    DRAFT
    PUBLISHED
    ARCHIVED

## Categories

    AGM
    SGM
    MAINTENANCE
    EMERGENCY
    WATER
    SECURITY
    REPAIRS
    GENERAL
    OTHER

------------------------------------------------------------------------

# 36. EVIDENCE

Implemented complaint-photo metadata is immutable and stored in `evidence`.
`fileName` is server-generated; provider references are excluded from normal
queries/API serialization. `storagePath` is an opaque local/S3 key or private
Cloudinary public ID. The provider discriminator and Cloudinary asset ID,
resource type, authenticated delivery type, format and version are internal
metadata only; signed URLs and credentials are never persisted. `fileHash` is
lowercase SHA-256 hex of the stored bytes. Compound index: societyId,
relatedEntityType, relatedEntityId. Metadata, ComplaintUpdate linkage and
AuditLog commit in one transaction. The complaint version is incremented to
serialize uploads with status transitions; uploading evidence never changes
the status itself.

## Collection

    evidence

## Purpose

Stores metadata about uploaded photographs/documents.

## Fields

    _id
    societyId
    fileName
    fileType
    fileSize
    storageProvider (internal, excluded from normal queries)
    storagePath
    storageAssetId (Cloudinary only, internal)
    storageResourceType (Cloudinary only, internal)
    storageDeliveryType (Cloudinary only, internal)
    storageFormat (Cloudinary only, internal)
    storageVersion (Cloudinary only, internal)
    fileHash
    uploadedBy
    relatedEntityType
    relatedEntityId
    category
    createdAt

## Category Examples

    BEFORE_PHOTO
    PROGRESS_PHOTO
    AFTER_PHOTO
    COMPLAINT_PHOTO
    QUOTATION
    INVOICE
    MEETING_DOCUMENT
    NOTICE_ATTACHMENT
    OTHER

------------------------------------------------------------------------

# 37. AUDIT LOG

## Collection

    auditLogs

## Fields

    _id
    societyId
    actorId
    action
    entityType
    entityId
    correctsAuditLogId
    previousState
    newState
    metadata
    ruleVersionId
    hashVersion
    recordHash
    blockchainTransactionHash
    createdAt

### Field definitions

| Field | Type and reference | Required / nullability | Constraints and meaning |
|---|---|---|---|
| `_id` | MongoDB ObjectId | Required; generated | Identifies the event; immutable. |
| `societyId` | MongoDB ObjectId reference to `Society` | Required for society-scoped events; explicitly null for genuinely platform-wide events with no society target | Scope follows the target resource/action, not the actor's role. A platform-wide `SYSTEM_ADMIN` action on a society resource records that society without making the actor a member. No multi-society event behavior is defined. |
| `actorId` | MongoDB ObjectId reference to `User` | Present for a human actor; may be omitted or null for a genuinely system-generated event | No synthetic `SYSTEM` user or separate actor model is defined. Detailed system-generated event semantics remain unresolved. |
| `action` | String/action code | Required | No closed enum is defined. The exact action vocabulary remains open; examples are not exhaustive. |
| `entityType` | String | Present when an affected entity is identified | Identifies the affected resource type; no exhaustive enum is defined. |
| `entityId` | MongoDB ObjectId using the referenced domain entity's existing `_id` convention | Optional | With `entityType`, identifies a single affected domain entity. It is absent when an event has no single affected entity. No special platform-level IDs or multi-entity representation are defined. |
| `correctsAuditLogId` | MongoDB ObjectId reference to `AuditLog` | Optional; omitted or null for ordinary events | On a correction event, identifies the original event. The original remains unchanged. No larger correction framework is defined. |
| `previousState` | Optional BSON object | Optional; omitted when no prior state applies | Contains only relevant prior state, not automatically a complete entity snapshot. |
| `newState` | Optional BSON object | Optional; omitted when no resulting state applies | Contains only relevant resulting state. |
| `metadata` | Optional BSON object | Optional; omitted when unused | Limited event context not represented by primary fields. It is not an unrestricted request-body dump; its key vocabulary remains open. |
| `ruleVersionId` | MongoDB ObjectId reference to `SocietyRuleVersion` | Optional | Present only when the audited action uses a society rule version. Immutable after event creation. |
| `hashVersion` | BSON Int32 | Required; value `1` for the initial protocol | Immutable. Identifies the Nivaas AuditLog hashing and serialization protocol, not a society governance-rule version. It participates in the canonical payload. Do not use `ruleVersionId` for this purpose. |
| `recordHash` | Required BSON String containing a lowercase `0x`-prefixed 32-byte hexadecimal value (bytes32-compatible) | Required for every persisted event | Fixed and immutable when persisted; Ethereum Keccak-256 commitment to the canonical immutable AuditLog event content defined below. It excludes itself and later blockchain transaction/proof association. |
| `blockchainTransactionHash` | Optional BSON String | Optional; may be omitted | Retained for compatibility. It is not authoritative for asynchronous proof transaction hashes and must not be updated after event creation. Its exact legacy/compatibility semantics and format validation remain unresolved. |
| `createdAt` | MongoDB Date | Required; generated at creation | Records event creation time and is immutable. No separate `occurredAt` field is defined. |

All event fields are immutable after persistence. `updatedAt` is not part of
AuditLog. The canonical hash protocol is versioned by `hashVersion`; version
`1` is defined below. This protocol version is independent of a society's
`SocietyRuleVersion`.

### Canonical AuditLog hash protocol, version 1

The ordered field/value payload consists of the following immutable event
fields in this exact order:

    hashVersion
    _id
    societyId
    actorId
    action
    entityType
    entityId
    correctsAuditLogId
    previousState
    newState
    metadata
    ruleVersionId
    createdAt

Represent the payload as an ordered JSON array of two-element arrays, each
containing the field name and its value, for example
`[["hashVersion", value], ["_id", value], ...]`. The listed sequence is
authoritative; implementations must not derive top-level ordering from
JavaScript, MongoDB, or Mongoose object-property order. Optional fields that
are absent are omitted from the sequence. A field explicitly stored as null
is included with a null value. Omission, null, empty objects, empty arrays,
empty strings, false, and zero remain distinct.

Before JSON canonicalization, map BSON values using BSON Canonical Extended
JSON v2. Then serialize the resulting ordered payload using RFC 8785 JSON
Canonicalization Scheme (JCS), encode the result as UTF-8, and hash those
bytes with Ethereum Keccak-256. Store the 32-byte digest as a lowercase,
`0x`-prefixed hexadecimal string. This is Ethereum Keccak-256, not FIPS
SHA3-256. No insignificant whitespace is emitted by JCS; JSON escaping and
object-key ordering follow RFC 8785. Array order is preserved.

Canonical BSON value representations are:

- ObjectIds use Canonical Extended JSON's `$oid` representation with the
  lowercase 24-character hexadecimal ObjectId string.
- Dates use Canonical Extended JSON's `$date` representation with the
  UTC Unix epoch-millisecond value represented as `$numberLong`; local
  timezone formatting is not used.
- BSON Int32, Int64, Double, and Decimal128 values use their corresponding
  Canonical Extended JSON numeric type tags (`$numberInt`, `$numberLong`,
  `$numberDouble`, and `$numberDecimal`). Their BSON numeric type is
  preserved; a numeric string remains a string and is not converted. Thus
  Int32 `1`, Double `1.0`, and Decimal128 `1.00` have distinct typed
  representations. The original source spelling is not retained by BSON:
  equivalent values of the same BSON type (for example Double `1.0` and
  `1e0`) use that type's Canonical Extended JSON representation. Negative
  zero is preserved in the `$numberDouble` representation as `-0.0`.
- Strings remain the stored strings, encoded as UTF-8 by the canonical JSON
  serialization. Do not trim, lowercase, normalize Unicode, or convert
  business values. Invalid Unicode strings that cannot be represented by
  RFC 8785 must be rejected rather than silently altered.
- Booleans and null use JSON `true`, `false`, and `null` respectively.
- Nested BSON documents map recursively to Canonical Extended JSON and are
  canonicalized with RFC 8785 key ordering. BSON arrays map recursively and
  retain their element order.
- Non-finite numeric values (NaN and positive or negative Infinity) are
  prohibited in hashable `previousState`, `newState`, and `metadata`.
  Numeric values are not implicitly converted between BSON numeric types.

The MongoDB ObjectId `_id` is generated before hash calculation and
persistence so it can participate in the event commitment. The hash input
includes every immutable event field in the ordered list, including `_id`
and `correctsAuditLogId` when present. A correction therefore
commits to the original event's identifier without recursively hashing the
original event. Absent optional fields are omitted; explicitly stored nulls
are included. `recordHash`, `blockchainTransactionHash`, blockchain proof
status, transaction attempts, and all later blockchain association/proof
information are excluded.

The logical calculation is:

    immutable AuditLog fields
      → ordered field/value payload
      → BSON Canonical Extended JSON v2 value mapping
      → RFC 8785 JCS serialization
      → UTF-8 bytes
      → Ethereum Keccak-256
      → 32-byte digest
      → lowercase 0x-prefixed hexadecimal `recordHash`

An independent verifier reconstructs the payload from the immutable event,
uses that event's `hashVersion` protocol, recalculates the digest, and
compares it with the stored `recordHash`. Where blockchain proof exists,
the verifier also compares the recalculated/stored commitment with the
corresponding on-chain commitment. Transaction hashes and proof lifecycle
state are not hash inputs. Hash versioning preserves the ability to verify
historical events if a future canonicalization protocol changes; no
additional hash-version field is defined.

`previousState` and `newState` represent only state relevant to the
particular audited event, not automatically complete entity snapshots.
Audit payloads must not contain passwords, password hashes, account-setup
credentials/tokens, JWTs, secrets, complete personal profiles, or
unnecessary sensitive personal information. `metadata` is subject to the
same restrictions and must not contain complete request bodies.

AuditLog events are append-only and immutable: an existing event must not
be edited or deleted. A correction is a new audit event that identifies or
references the original event through `correctsAuditLogId` and explains the
correction; the original event is preserved. The original event is persisted
with its fixed `recordHash`. Its blockchain proof may be submitted
asynchronously through the blockchain logical-operation/transaction-tracking
layer. That layer must associate the operation with the AuditLog event and its fixed
`recordHash`; transaction hashes and lifecycle states belong to that
tracking layer. Retries or replacements remain associated with the same
logical operation and original event. A blockchain failure does not change
the AuditLog event or count as confirmation. The complete audit record
remains off-chain; only selected event hashes/references may be anchored.

The documented `blockchainTransactionHash` field is retained, but it must
not be treated as the authoritative location for a transaction hash that
becomes available after the immutable AuditLog event is created. Its legacy
use semantics remain unresolved.

## BlockchainProofOperation

### Collection

    blockchainProofOperations

### Purpose

Tracks one logical proof operation for an immutable AuditLog event and its
transaction attempts. This collection is authoritative for asynchronous
proof state; it does not change the AuditLog event.

### Fields

    _id
    recordType                  // AUDIT_LOG
    recordId                    // AuditLog ObjectId
    societyId                   // society ObjectId
    referenceDerivationVersion  // uint32-compatible integer, initially 1
    proofVersion                // positive registry version, initially 1
    auditLogHashVersion         // AuditLog canonical hash version
    recordReference             // bytes32 hex
    recordHash                  // immutable canonical AuditLog bytes32
    chainId                     // decimal string
    contractAddress             // normalized EVM address
    deploymentTransactionHash   // identifies this deployment/reset
    status                      // PENDING | CONFIRMED | FAILED
    attempts                    // ordered transaction attempt metadata
    confirmedAt                 // optional
    blockNumber                 // optional
    lastError                   // optional safe error code/message
    createdAt
    updatedAt

Each attempt records its sequence, start/broadcast/receipt timestamps,
transaction hash when known, sender, block number, outcome (`PREPARED`,
`BROADCAST`, `CONFIRMED`, `REVERTED`, or `AMBIGUOUS`), and a safe error code.
`PREPARED` is persisted before network broadcast; `BROADCAST` is recorded
only after the RPC returns a transaction hash. It contains no signer key or AuditLog payload. Create a unique index
on `(recordType, recordId, proofVersion, chainId, contractAddress,
deploymentTransactionHash)` to make concurrent requests converge on one
logical operation while keeping separate local deployments distinct.
The operation's `recordReference`, `recordHash`, society, and version
metadata are immutable after creation; attempts and lifecycle metadata are
updated under the operation's retry/reconciliation rules.

Status is CONFIRMED only after a successful transaction receipt and a
matching `getProof` read-back from the configured registry. PENDING includes
an in-flight or ambiguous attempt. FAILED records a known reverted/failed
attempt and remains eligible for reconciliation/retry. Before broadcasting
again, the backend reads the registry and reconciles `ProofRegistered`
events since the configured deployment; a matching on-chain proof is
recovered and confirmed without resubmission, while a conflicting proof is
never overwritten and is reported as an integrity conflict.

AuditLog record reference derivation version 1 hashes ABI encoding of the
domain hash `keccak256("NIVAAS:AUDIT_LOG:REFERENCE")`, uint256 version 1,
and society/AuditLog ObjectIds represented as left-zero-padded bytes32.
This version is independent of `proofVersion` and `auditLogHashVersion`.
The AuditLog's stored hash is verified by recomputing with the existing
canonical hash implementation before creating or retrying an operation.

## Examples

    PROJECT_CREATED
    PROJECT_SUBMITTED
    QUOTATION_CREATED
    QUOTATION_REVISED
    SGM_CREATED
    VOTE_CAST
    PROJECT_APPROVED
    PROJECT_STARTED
    PROJECT_COMPLETED
    COMPLAINT_CREATED
    COMPLAINT_RESOLVED
    NOTICE_CREATED
    NOTICE_UPDATED
    NOTICE_PUBLISHED
    NOTICE_ARCHIVED
    PAYMENT_CONFIRMED

------------------------------------------------------------------------

# 38. RELATIONSHIP MAP

    SOCIETY
    │
    ├── BUILDINGS
    │     └── FLATS
    │           ├── OWNERS
    │           └── RESIDENTS
    │
    ├── COMMITTEE
    │     └── COMMITTEE MEMBERS
    │
    ├── BUDGET
    │     └── BUDGET CATEGORIES
    │           └── EXPENSES
    │
    ├── PROJECTS
    │     ├── QUOTATIONS
    │     │      └── CHANGE REQUESTS
    │     ├── PROJECT UPDATES
    │     ├── VENDOR
    │     ├── MEETINGS
    │     ├── PROPOSALS
    │     │      └── VOTES
    │     ├── EXPENSES
    │     └── EVIDENCE
    │
    ├── COMPLAINTS
    │     ├── COMPLAINT UPDATES
    │     └── EVIDENCE
    │
    ├── NOTICES
    │
    ├── PAYMENTS
    │
    └── AUDIT LOGS

------------------------------------------------------------------------

# 39. IMPORTANT RELATIONSHIPS

    Society 1 → Many Buildings

    Building 1 → Many Flats

    Flat Many ↔ Many Users

    Society 1 → Many Projects

    Project 1 → Many Quotations

    Quotation 1 → Many Change Requests

    Project 1 → Many Project Updates

    Society 1 → Many Meetings

    Meeting 1 → Many Proposals

    Proposal 1 → Many Governance Resolutions

    GovernanceResolution 1 → Many GovernanceVotes

    Project 1 → Many Evidence

    Complaint 1 → Many Complaint Updates

    Complaint 1 → Many Evidence

    Budget 1 → Many Budget Categories

    Budget Category 1 → Many Expenses

------------------------------------------------------------------------

# 40. SOFT DELETION

Important historical records should generally not be physically deleted.
Where deletion is necessary for normal records, the system should
prefer:

    status = ARCHIVED

or:

    deletedAt

rather than permanently removing historical governance information.

------------------------------------------------------------------------

# 41. TIMESTAMPS

Major entities should contain:

    createdAt
    updatedAt

Historical timeline entities should contain:

    createdAt

and should generally be append-only.

------------------------------------------------------------------------

# 42. USER REFERENCES

Actions should reference the user responsible for them. Examples:

    createdBy
    updatedBy
    uploadedBy
    approvedBy
    requestedBy
    assignedTo

This is necessary for accountability.

------------------------------------------------------------------------

# 43. BLOCKCHAIN REFERENCES

Blockchain-enabled entities may contain:

    blockchainStatus
    blockchainNetwork
    blockchainTransactionHash
    blockchainRecordId
    blockchainConfirmedAt

These fields should not be treated as proof until the blockchain
transaction is confirmed.

------------------------------------------------------------------------

# 44. INDEXING

Indexes should be created for frequently queried fields. The following
AuditLog indexes are required by the society-filtered audit listing and
entity-specific audit-history query:

    auditLogs.societyId
    auditLogs.entityType + entityId

These indexes are non-unique. No additional AuditLog indexes or uniqueness
constraints are specified.

Other potential indexes:

    users.email (unique)
    users.societyId

    memberships.societyId + memberships.userId
    memberships.societyId + memberships.membershipStatus

    ownerships.flatId
    ownerships.userId

    residences.flatId
    residences.userId

    societyRuleVersions.societyId + societyRuleVersions.versionNumber
    societyRuleVersions.societyId + societyRuleVersions.status

    projects.societyId
    projects.status

    quotations.projectId

    changeRequests.projectId

    meetings.societyId
    meetings.scheduledAt

    proposals.meetingId

    governanceResolutions.meetingId
    governanceResolutions.proposalId

    governanceVotes.resolutionId
    governanceVotes.resolutionId + voterId

    governanceEligibilitySnapshots.resolutionId
    approvalDecisions.projectId
    approvalDecisions.ruleVersionId

    complaints.societyId
    complaints.status
    complaints.createdBy

    notices.societyId
    notices.status
    notices.publishedAt

    electionEligibleVoters.electionId
    anonymousBallots.electionId
    electionResults.electionId

------------------------------------------------------------------------

# 45. DATABASE CONSTRAINTS AND INTEGRITY

The implementation should enforce important invariants at the database and
service layers where possible. Examples:

- One society rule version number is unique within a society.
- A governance vote cannot be duplicated for the same resolution and
  eligible voter where the resolution uses one-vote-per-member.
- A governance resolution references exactly one eligibility snapshot when
  voting is opened.
- A quotation version belongs to one project and preserves its predecessor.
- A change request references the quotation version it changes and the
  resulting quotation version when approved.
- Historical governance records are not hard-deleted through normal CRUD
  operations.
- Monetary values use a precision-safe representation.

Database constraints complement business-service validation; they do not
replace the Approval Engine or governance authorization logic.

------------------------------------------------------------------------

# 46. DATA VALIDATION

The application must validate:

-   Required fields
-   Amounts
-   Dates
-   Enum values
-   IDs
-   File metadata
-   Role values
-   Status transitions

Database validation must not rely exclusively on frontend validation.

------------------------------------------------------------------------

# 47. FINANCIAL AMOUNTS

Financial amounts should not be stored as floating-point values where
precision can create problems. The implementation should use an
appropriate integer representation, such as the smallest currency unit,
or MongoDB Decimal128 where appropriate. The exact implementation will
be finalized during coding.

------------------------------------------------------------------------

# 48. DATABASE VS BLOCKCHAIN

MongoDB:

    Detailed application data

Blockchain:

    Selected trust-critical records

The two systems should reference each other using stable IDs and
transaction hashes.

------------------------------------------------------------------------

# 49. DATABASE STATUS

Implementation extension (24 October 2026): Complaint.description/category/priority
are optional descriptive text, normalized to empty strings by the creation service.
Existing complaint records are not rewritten. Evidence.relatedEntityType now also
supports Notice, with category NOTICE_ATTACHMENT and an immutable Notice reference.
Notice.attachmentIds is updated in the same transaction as Evidence and its audit
event, and only while DRAFT. File bytes remain off-database in private storage.
No migration or cleanup of existing records is required.

UNVERIFIABLE is a derived blockchain verification response, not a rewrite of a
stored operation's historical CONFIRMED state. Existing attempt history is retained.

Version 1.13 --- Active Planning Document. Revised to align with SRS v1.9, Business Rules v1.9, API v1.10 and Architecture v1.11. In addition to the prior membership, AuditLog, rule-version, approval, and eligibility schema, it defines the AuditLog BlockchainProofOperation collection, deployment-aware uniqueness, immutable proof identity/hash metadata, transaction-attempt history, and retry/reconciliation states. The database schema must not be changed by an AI coding agent without considering the effects on:

-   SRS
-   BUSINESS_RULES.md
-   API
-   Frontend
-   Blockchain integration
-   Tests

## Committee approval and offline meeting records — 24 October 2026

`CommitteeApprovalVote` stores one immutable APPROVE/REJECT action per authenticated active committee appointee and current ApprovalDecision revision. `CommitteeApprovalResult` stores the immutable outcome, counts, active committee population, quorum, rule snapshot, finalizing manager, and time. Defaults are 2/3 quorum rounded up and strictly more than half of cast decisions; the effective approval policy can configure the ratios and optional quorum cap. Decision and result records stay off-chain.

`OfflineResolutionRecord` is separate from committee records. It captures an immutable meeting and rule reference, eligible attendee IDs, method (SHOW_OF_HANDS or non-secret POLL), aggregate YES/NO/ABSTAIN counts, minutes/evidence references, calculated quorum/outcome, and manager confirmation. Attendance is checked against the resolution's private immutable eligibility snapshot. It contains no individual ballot mapping. The current Evidence storage only accepts JPEG/PNG notice/complaint evidence; this record stores document references and does not add general meeting-file upload or broaden file validation.
