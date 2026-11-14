## REST API Specification

**Document:** `API.md` **Version:** 1.16 **Base URL:** `/api` **Status:**
Active Planning Document — Revised Membership, Rule Configuration,
Approval & Governance APIs

------------------------------------------------------------------------

# 1. API PURPOSE

The API provides controlled communication between the React frontend and
the backend. The API is responsible for:

-   Authentication
-   Authorization
-   Data retrieval
-   Data creation
-   Business-rule enforcement
-   State transitions
-   Blockchain coordination

------------------------------------------------------------------------

# 2. API DESIGN PRINCIPLES

1.  API endpoints must follow consistent naming.
2.  Protected endpoints require authentication.
3.  Authorization is enforced server-side.
4.  Business rules are enforced server-side.
5.  Frontend must not directly modify database data.
6.  State transitions use dedicated actions where appropriate.
7.  Blockchain operations return transaction status.
8.  API responses use consistent structures.
9.  Governance eligibility is calculated server-side from membership and the
    applicable resolution rules.
10. Rule/configuration changes must preserve the version/snapshot used by
    historical decisions.
11. Client-supplied amounts, voter IDs, approval results, permissions and
    state values are never authoritative.
12. Workflow actions are preferred over generic state-changing PATCH
    requests for governed entities.

## Authorization Scope

`SYSTEM_ADMIN` is a platform-wide technical role. Cross-society access is
permitted only on an administrative endpoint whose authorization explicitly
allows that capability. Platform scope is not implemented as an exception in
generic same-society checks.

All other application roles are society-scoped. Their society context comes
from the authenticated user's persisted `societyId`, and access to a
society-associated resource must be checked against that context. Client-
supplied identity or society fields do not establish authorization.

`SYSTEM_ADMIN` does not gain society membership, ownership, residence,
committee membership, governance eligibility, or governance authority from
the platform role. Administrative access must not bypass a society's
governance process or alter protected governance history.

------------------------------------------------------------------------

# 3. RESPONSE FORMAT

Successful response:

    {
      "success": true,
      "data": {}
    }

Error response:

    {
      "success": false,
      "error": {
        "code": "ERROR_CODE",
        "message": "Human-readable message"
      }
    }

------------------------------------------------------------------------

# 4. COMMON REQUEST / RESPONSE CONVENTIONS

## Pagination

Collection endpoints should support a consistent pagination model where
needed:

```text
?page=1&limit=20
```

A paginated response may use:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 125,
    "totalPages": 7
  }
}
```

The exact implementation may use cursor pagination later if required, but
the API contract must remain consistent.

## Filtering and Sorting

List endpoints may expose documented filters and sorting parameters. Unknown
filters must not silently change query behavior.

## Request Identity

For protected actions, the authenticated session/token is authoritative for
the current user. Clients must not be allowed to impersonate another user by
supplying `userId`, `voterId`, `approvedBy`, or similar identity fields in
the request body.

------------------------------------------------------------------------

# 5. AUTHENTICATION

## POST `/auth/login`

Authenticate a user.

Only a user whose persisted account status is `ACTIVE` may authenticate.
`PENDING_SETUP` accounts cannot authenticate with a normal password, and
`DISABLED` accounts cannot authenticate. A previously issued JWT does not
override a persisted `PENDING_SETUP` or `DISABLED` status when accessing a
protected API.

### Request

    {
      "email": "user@example.com",
      "password": "password"
    }

### Response

    {
      "success": true,
      "data": {
        "user": {},
        "token": "...",
        "refreshToken": "...",
        "refreshSessionId": "...",
        "refreshTokenExpiresAt": "..."
      }
    }

The raw refresh token is a 256-bit random opaque credential tied to one
login session. The browser stores it in that tab's `sessionStorage`; the
server stores only its SHA-256 hash. `refreshSessionId` is a non-secret
identifier used to distinguish duplicated tabs. The absolute session expiry
is `AUTH_REFRESH_SESSION_TTL_SECONDS` after login; refresh does not extend it.

------------------------------------------------------------------------

## POST `/auth/refresh`

Exchange a valid per-login refresh token for a new short-lived access token.
The backend validates the token hash, revocation and absolute expiry, then
loads the associated persisted User. Only an existing `ACTIVE` account can
renew. The returned safe profile, role and society association come from that
persisted User, never from request data.

### Request

    { "refreshToken": "..." }

### Response

The response has the same fields as the login response. The refresh token,
session identifier and absolute expiry remain unchanged. Invalid, expired or
revoked tokens return HTTP 401 `UNAUTHORIZED`; malformed payloads return HTTP
400 `VALIDATION_ERROR`.

------------------------------------------------------------------------

## POST `/auth/setup`

Complete initial setup for a `PENDING_SETUP` account. This endpoint uses
the one-time setup credential, not a normal login or bearer JWT. Only a
user whose persisted status is `PENDING_SETUP` may complete setup. `ACTIVE`
and `DISABLED` accounts are not eligible.

### Request

    {
      "credential": "<one-time setup credential>",
      "newPassword": "<password of at least 8 characters>"
    }

The backend-generated credential consists of 32 cryptographically random
bytes represented using URL-safe base64. It is single-use and expires 24
hours after generation. The backend stores only a cryptographic hash of the
credential, associated with its intended User; it never stores the raw
credential. Credential delivery is implementation-specific and no email or
SMS provider is selected.

The new password must contain at least 8 characters and is stored using the
existing scrypt password-hashing mechanism. No additional password
complexity requirement is imposed by this checkpoint. The request must not
accept a `passwordHash`.

### Success response

HTTP 200:

    {
      "success": true,
      "data": {}
    }

The response contains no credential, password hash, secret, or
authentication token. The user may authenticate through `POST /auth/login`
after setup succeeds.

Successful setup atomically establishes the password hash, consumes the
credential, changes status from `PENDING_SETUP` to `ACTIVE`, and creates
the mandatory AuditLog event for that status transition. These changes must
not partially succeed.

### Errors

- Missing or malformed request fields, or a password shorter than 8
  characters: HTTP 400 `VALIDATION_ERROR`.
- Invalid, expired, consumed/replayed credential, or an account status that
  is not eligible for setup: HTTP 401 `UNAUTHORIZED` with the same generic
  response for all these cases. The response must not reveal whether a User,
  credential, or particular credential state exists.

Initial credential generation, credential consumption by itself, and failed
setup attempts do not create separate AuditLog events under this contract.
The separately authorized administrative reissue action is audited as
described below.

Credential regeneration/resend is separate from this public initial setup
endpoint and is controlled by the authenticated administration route below.

### Local-development credential delivery

Only when `NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED=true` is configured in a
non-production backend that targets loopback MongoDB database `nivaas_demo`,
an authenticated `SYSTEM_ADMIN` request to `POST /users` from a loopback
connection receives `setupCredential` and `setupCredentialExpiresAt` in the
success data. This is a one-time, 24-hour setup credential. The backend does
not persist the raw value or log it; it is returned only in this local API
response. The response must be handled as a secret and must not be captured in
shell transcripts, screenshots, or ordinary application logs. With the flag
disabled, the normal safe user response is unchanged. The feature cannot be
enabled in production or for `nivaas` / `nivaas_test` databases.

### `POST /users/:id/setup-credential`

Reissue the one-time setup credential for an existing account that remains
`PENDING_SETUP`. The route requires an authenticated `SYSTEM_ADMIN` and is
available only when local setup delivery is enabled for the loopback
`nivaas_demo` deployment and the request itself arrives over loopback. The
request has no body. Missing users return `404`; accounts that are no longer
pending return `409`. The operation transactionally invalidates prior
unconsumed credentials, stores only the replacement hash and 24-hour expiry,
and appends a secret-free `USER_SETUP_CREDENTIAL_REISSUED` AuditLog event.

The success response uses the standard envelope and returns the safe User
representation plus `setupCredential` and `setupCredentialExpiresAt`. The raw
credential is returned once in this authorized local response only; it is not
stored or logged. Handle it privately and give it to the account holder, who
completes setup with `POST /auth/setup`. Production reissue is unavailable
until a secure credential-delivery provider is configured; the route fails
before changing persistence when local delivery is disabled. It never falls
back to returning a raw credential remotely.

The initial local first-administrator bootstrap is a CLI operation rather
than a public HTTP endpoint. It is guarded by
`NIVAAS_LOCAL_BOOTSTRAP_ENABLED`, a hidden interactive secret prompt,
loopback `nivaas_demo`, and an explicit confirmation phrase. In local
`NODE_ENV=development` only, the starter secret `1234` is accepted; other
configured bootstrap secrets must contain at least 32 characters. Production
always rejects bootstrap. A unique database claim and transaction make it
one-time and prevent concurrent bootstrap. It creates a `PENDING_SETUP`
account and emits the initial credential once in the invoking local terminal.
Disable bootstrap after success; use the normal authenticated account-creation
flow thereafter.

------------------------------------------------------------------------

## POST `/auth/logout`

Revoke the supplied per-login refresh session. Request body:

    { "refreshToken": "..." }

Logout is idempotent and returns HTTP 200 with empty data for a well-formed
credential, including an unknown or already-revoked session. The browser
clears its tab-local session immediately and sends this best-effort request;
API access tokens already issued remain valid until their short expiry, while
the revoked refresh credential cannot create more tokens.

------------------------------------------------------------------------

## GET `/auth/me`

Return the currently authenticated user.

------------------------------------------------------------------------

# 6. USER APIs

## GET `/users`

`SYSTEM_ADMIN` only. This is the generic platform-wide user administration
and listing endpoint. No society-scoped role may use this endpoint. Its
explicit platform scope does not establish platform scope for other routes.
User-related information needed by society-scoped users must be exposed
through purpose-specific endpoints or permitted resource APIs; the generic
user-list endpoint does not provide that access.

## GET `/users/society`

`SOCIETY_MANAGER` only. Returns safe user profiles assigned to the
authenticated manager's persisted society. An optional `search` query filters
name or email (maximum 100 characters). The endpoint has a bounded response
and never accepts a client-selected society ID. It is for choosing existing
accounts during membership/flat onboarding. A manager cannot add their own
membership or flat relationship through these routes.

Each returned user uses the safe user representation defined below. The
endpoint does not return raw Mongoose User documents.

------------------------------------------------------------------------

## GET `/users/:id`

Returns the requested user's account/profile representation subject to
these permissions:

- `SYSTEM_ADMIN` may retrieve a user across the platform.
- `SOCIETY_MANAGER` may retrieve permitted user profiles belonging to the
  manager's society.
- `COMMITTEE_MEMBER` may retrieve permitted user profiles belonging to the
  committee member's society.
- `OWNER_MEMBER` may retrieve only their own profile through this endpoint.
- `RESIDENT` may retrieve only their own profile through this endpoint.

Society-scoped roles may not retrieve a user from another society. The
authenticated user's identity and society scope come from the verified
token and persisted user record; request-supplied identity or society values
do not establish access. Application roles do not imply ownership,
residence, membership, committee membership, or governance/voting
eligibility.

The response uses the safe user representation below and is not a raw
Mongoose User document.

### Safe user representation

The user representation returned by the user list and profile APIs is
limited to these User fields:

- `_id`
- `societyId`
- `name`
- `email`
- `phone`
- `role`
- `walletAddress`
- `status`
- `createdAt`
- `updatedAt`

`societyId` may be null for a platform-wide `SYSTEM_ADMIN` account. Access
to society-scoped user profiles remains subject to the authorization above.
Responses must never expose `passwordHash`, passwords, account-setup
credentials/tokens, JWTs, secrets, or internal authentication material.

------------------------------------------------------------------------

## POST `/users`

Create a user. Allowed:

-   System Admin

The System Admin's platform scope applies only because this endpoint
explicitly permits that role. Account creation must not accept a permanent
password or `passwordHash` from the administrator. A newly created account
enters pending setup, and the backend generates a single-use account-setup
credential that the user consumes to establish their own password. The
credential expires 24 hours after generation and cannot be reused after
successful consumption or expiry.
The newly created `PENDING_SETUP` User has no password hash until setup
succeeds. The administrator must never receive or set the user's permanent
password.

Credential delivery is implementation-specific and is not part of this
core user API; no delivery provider or service is required by this contract.
The setup API contract is defined by `POST /auth/setup` above. The existing
scrypt password-hashing mechanism is used when the user establishes a
password, which must be at least 8 characters for this setup flow. Account
setup is separate from society membership, ownership, residence/occupancy,
committee membership, and governance/voting eligibility.

### POST `/users/society`

Create a pending society account as the authenticated `SOCIETY_MANAGER`.
The society is taken only from the manager's persisted authenticated account;
the request cannot supply or override `societyId`. The assigned society must
exist and be active. The request accepts `name`, `email`, optional `phone`,
and `role`; the role must be `OWNER_MEMBER`, `RESIDENT`, or
`COMMITTEE_MEMBER`. `SYSTEM_ADMIN` and `SOCIETY_MANAGER` cannot be created or
assigned through this endpoint. A duplicate platform email returns `409`.

The endpoint reuses the account setup credential service. It is available
only when `NIVAAS_LOCAL_SETUP_DELIVERY_ENABLED=true` is valid for the
isolated local `nivaas_demo` configuration, and the request arrives over
loopback. Otherwise it fails before creating the User or credential. When
enabled, the response contains the safe User representation plus the raw
one-time setup credential and its expiry, for private delivery by the local
manager. The credential is not stored raw or logged; it expires after 24
hours and is consumed once by `POST /auth/setup`. No production mail or other
secure delivery provider currently exists.

This endpoint creates only an application account role. It does not create
Membership, Ownership, Residence, Committee, or CommitteeMember records and
does not grant governance eligibility. Use the existing membership and flat
relationship APIs separately. Committee administration has schemas but no
registered API in this MVP; a `COMMITTEE_MEMBER` role alone is not evidence
of committee assignment or voting eligibility.

------------------------------------------------------------------------

## PATCH `/users/:id`

Update permitted user profile/account information only. The editable fields
are exactly:

- `name`
- `email`
- `phone`
- `walletAddress`

This endpoint must not modify `_id`, `societyId`, `role`, `status`,
`passwordHash`, `createdAt`, or `updatedAt`. Role changes use
`PATCH /users/:id/role`; account status changes use
`PATCH /users/:id/status`. Password changes are not performed through this
endpoint. System-managed identifiers and timestamps are not client-
controlled.

The backend must enforce the existing account identity uniqueness
requirement when an email is changed and must not allow two accounts to use
the same login email. An email change does not change the user's role,
society, membership, ownership, residence, committee membership, or
governance eligibility. Editing `walletAddress` does not grant governance
or voting rights. This policy does not define email verification,
reauthentication, password reset, or notification behavior.

------------------------------------------------------------------------

## PATCH `/users/:id/status`

Change a user's account status. Only `SYSTEM_ADMIN` is authorized to
administer account status. The permitted status values and lifecycle are
defined in the User Account Status Policy in `BUSINESS_RULES.md` and the
User entity in `DATABASE.md`. No request or response schema is defined here.

The platform-wide System Administrator may administer account status
across societies. A System Administrator cannot disable their own account
or disable the last `ACTIVE` System Administrator account. Status changes
do not themselves change society membership, ownership, residence/
occupancy, committee membership, or governance/voting eligibility. A
disabled account and its historical/domain relationships are retained.
Every successful status transition must create an AuditLog event.

------------------------------------------------------------------------

## PATCH `/users/:id/role`

Change user role. Allowed:

-   System Admin

Must create an audit record.

The explicitly permitted System Administrator may administer user roles
across societies. Role changes do not grant the target user society
membership or governance eligibility. The audit requirement remains in
force.

------------------------------------------------------------------------

# 7. SOCIETY APIs

## GET `/society`

Return current society information.

For a society-scoped user, the current society is derived from the persisted
authenticated user's `societyId`. A System Administrator has no current
society by virtue of the platform role. The target-selection contract for
platform-wide access through this singular route is unresolved; a
client-supplied `societyId` must not be treated as authorization.

------------------------------------------------------------------------

## PATCH `/society`

Update society configuration. Allowed:

-   System Admin

The target-selection contract for a platform-wide System Administrator on
this singular route is unresolved. The role permission does not make a
client-supplied `societyId` authoritative, and this endpoint does not grant
authority to bypass governance or change governance-rule versions without
the separately applicable authorization.

------------------------------------------------------------------------

## GET `/society/settings`

Return relevant configuration.

------------------------------------------------------------------------

## PATCH `/society/settings`

Update configurable settings. Important changes must be audited.

Governance-affecting settings must create a new rule/configuration version
rather than silently rewriting the configuration that was used by a previous
decision.

------------------------------------------------------------------------

# 8. GOVERNANCE RULE / CONFIGURATION APIs

## GET `/society/rules`

Return the currently effective configurable governance rules permitted to
the current user.

Examples include:

- Project approval policy/threshold
- Required decision body
- Majority rule
- Quorum rule
- Notice period
- Voting method
- Procurement/tender requirements
- Financial visibility
- Complaint reopening authority
- Project completion authority

The response may also include the optional typed `governancePolicy`
configuration envelope (`schemaVersion`, confirmation state, and explicit
decision-policy dimensions). Legacy rule versions may omit it. Rule versions
created by the threshold endpoint also expose their immutable rationale,
supporting reference, and linked policy-change AuditLog ID.

## GET `/society/rules/history`

Return historical rule/configuration versions according to permission.

## POST `/society/rules/versions`

Create a new effective rule/configuration version.

The request must identify only the settings being changed. The backend must
validate the configuration and create an audit record.

## GET `/society/rules/versions/:versionId`

Return a specific rule/configuration snapshot.

Historical versions are read-only.

## POST `/society/rules/approval-threshold`

Available only to the authenticated `SOCIETY_MANAGER` for that user's own
society. The request accepts an exact decimal-string `threshold` plus at least
one of `reason` or `supportingDocumentReference`. It creates a new immutable
`SocietyRuleVersion`, copies unchanged rule configuration, activates the new
version transactionally, and records the previous/new values in an append-only
AuditLog event. The event's metadata carries a domain-separated canonical
commitment over society ID, policy type, version number, and configuration
hash. The existing AuditLog proof service is attempted after activation;
blockchain status is reported separately and does not block MongoDB policy
activation. A confirmed state requires successful receipt and registry
read-back verification. Existing `ApprovalDecision` snapshots are not
rewritten.

------------------------------------------------------------------------

# 9. BUILDING APIs

## GET `/buildings`

Return society buildings. `SYSTEM_ADMIN` may supply the society filter;
`SOCIETY_MANAGER` is restricted to the manager's assigned society. A manager
cannot use a request filter to select another society.

------------------------------------------------------------------------

## GET `/buildings/:id`

Return building details. A manager may read only a building belonging to the
manager's assigned society.

------------------------------------------------------------------------

## POST `/buildings`

Create building. Allowed:

-   System Admin

`buildingCode` is optional. When supplied, it must be unique within its
society. Buildings without a code do not participate in that uniqueness check,
so a society may have multiple code-less buildings. The database enforces
this with a partial unique compound index on `(societyId, buildingCode)` for
string-valued codes. Duplicate supplied codes return HTTP 409 with
`BUILDING_CODE_ALREADY_EXISTS`.
If a legacy index rejects a code-less create, the API returns HTTP 409 with
`BUILDING_CODE_INDEX_MIGRATION_REQUIRED` instead of misreporting a duplicate
code.

Existing databases with the former unique sparse compound index require the
guarded migration before they can accept multiple code-less buildings. The
migration checks duplicate code values and the current index definition before
changing an index, preserves all documents, and refuses protected databases;
see the property-management continuation in `NIVAAS_AI_HANDOFF.md` for the
disposable-database verification command. Do not drop the old index manually.

------------------------------------------------------------------------

## PATCH `/buildings/:id`

Update building. Allowed:

-   System Admin

------------------------------------------------------------------------

# 9. FLAT APIs

## GET `/flats`

Return flats. Supports filters such as:

    buildingId
    flatNumber

------------------------------------------------------------------------

## GET `/flats/:id`

Return flat details.

------------------------------------------------------------------------

## POST `/flats`

Create a flat using `{ buildingId, flatNumber, status, ... }`. `status` is
required and uses the property model's `ACTIVE` or `INACTIVE` value. `flatNumber` is
required text (for example `002`, `0101`, or `1313`); leading zeroes are
preserved. A `SYSTEM_ADMIN` supplies `societyId`. A `SOCIETY_MANAGER` creates
only inside the assigned society; the backend derives that society from the
authenticated account and verifies that the selected building belongs to it.
The database's unique `(buildingId, flatNumber)` index is authoritative against
concurrent duplicates. A duplicate returns HTTP 409 so the caller can select
the existing flat. The same flat number is permitted in a different building.
Creating a flat does not create ownership, residence, membership, or voting
eligibility records.

------------------------------------------------------------------------

## PATCH `/flats/:id`

Update flat.

------------------------------------------------------------------------

# 10. OWNERSHIP, RESIDENCE & MEMBERSHIP APIs

The API must keep ownership, residence and society membership separate.
Residence alone does not establish governance voting eligibility.

## GET `/flats/:flatId/ownerships`

Return ownership relationships for the flat, subject to permission.

## POST `/flats/:flatId/ownerships`

Create an ownership relationship. System Admin or the Society Manager assigned
to the flat's society may perform this action. The referenced user must
already be assigned to the same society. The authenticated manager's society
is checked against the flat on the server; request-supplied society IDs are
not authorization evidence.

## PATCH `/ownerships/:id`

Update an ownership relationship while permitted.

## GET `/flats/:flatId/residents`

Return resident/occupancy relationships for the flat.

## POST `/flats/:flatId/residents`

Create a residence/occupancy relationship under the same scope and reference
checks as ownership. Residence alone does not establish membership or voting
eligibility.

## PATCH `/residences/:id`

Update an occupancy relationship while permitted.

## GET `/memberships`

List society membership records according to permission. A Society Manager is
always scoped to their persisted society; a supplied different `societyId` is
rejected. The System Admin's existing platform list access remains subject to
explicit filters.

Filters may include:

```text
status
membershipType
flatId
userId
```

## GET `/memberships/:id`

Return a membership record.

## POST `/memberships`

Create a membership record. A Society Manager may add an existing account
already assigned to the same society to a same-society flat. A supplied
society must match the authenticated manager's society. Account creation,
application-role assignment, and manager assignment remain System Admin
operations. Membership, ownership, residence, application role, and voting
eligibility are separate; residence or application role alone grants no vote.

## PATCH `/memberships/:id`

Update membership while permitted.

Important membership changes must be audited because they can affect future
governance eligibility.

## GET `/users/:userId/memberships`

Return permitted society memberships for the user.

------------------------------------------------------------------------

# 11. COMMITTEE APIs

## GET `/committee`

Return current committee.

------------------------------------------------------------------------

## GET `/committee/members`

Return committee members.

------------------------------------------------------------------------

## POST `/committee/members`

Add committee member.

------------------------------------------------------------------------

## PATCH `/committee/members/:id`

Update committee membership.

------------------------------------------------------------------------

# 11. BUDGET APIs

## GET `/budgets`

Return budgets.

------------------------------------------------------------------------

## GET `/budgets/:id`

Return budget details including categories.

------------------------------------------------------------------------

## POST `/budgets`

Create annual budget. Allowed:

-   Society Manager

------------------------------------------------------------------------

## PATCH `/budgets/:id`

Update budget while it remains editable.

------------------------------------------------------------------------

## POST `/budgets/:id/submit`

Submit budget for approval.

------------------------------------------------------------------------

## POST `/budgets/:id/approve`

Approve budget through the applicable governance process. Direct manager
approval must not bypass the configured process.

------------------------------------------------------------------------

# 12. BUDGET CATEGORY APIs

## POST `/budgets/:budgetId/categories`

Create category.

------------------------------------------------------------------------

## PATCH `/budget-categories/:id`

Update category while permitted.

------------------------------------------------------------------------

## GET `/budgets/:budgetId/categories`

List categories.

------------------------------------------------------------------------

# 13. EXPENSE APIs

## GET `/expenses`

List expense entries for the authenticated scope. Filters:

    projectId
    societyId (SYSTEM_ADMIN only)

The current project-finance read is `GET /expenses?projectId=<id>` and returns
`{ items, projects }`. `projects` contains the approved amount, recorded total,
remaining amount and an overrun flag calculated from persisted expense entries.
Managers and committee members can read full invoice-reference and description
fields. Owners require a currently effective same-society Ownership record and
receive public financial fields only. Residents have no expense endpoint
access. A platform administrator must provide `projectId` or `societyId`.

------------------------------------------------------------------------

## GET `/expenses/:id`

Get expense.

------------------------------------------------------------------------

## POST `/expenses`

Record an immutable project expense. Request fields are `projectId`,
`budgetCategoryId`, `title`, `amount`, `expenseDate`, and optional `vendorId`,
`description`, and `invoiceReference`. The authenticated Society Manager is
the actor; society scope is taken from the project. The project must be
APPROVED or IN_PROGRESS, have a persisted approved amount, and link to an
APPROVED society budget. The category must belong to that budget. In one
MongoDB transaction the server rechecks the project amount and category
allocation, records the expense and audit event, then recalculates category and
budget spending totals. `409 EXPENSE_LIMIT_EXCEEDED` leaves no expense or
counter update. Project-amount increases must follow the existing quotation
change-request and approval workflow. No budget-category revision approval
route is configured; the server fails closed for that limit until a society's
authorized amendment is approved and recorded. This is an application safety
boundary, not a legal approval rule.

------------------------------------------------------------------------

## PATCH `/expenses/:id`

Expense records are immutable in this MVP; `PATCH /expenses/:id` is not
implemented. Corrections require a later explicitly specified reversal or
correction record and must not rewrite this history.

------------------------------------------------------------------------

# 14. PROJECT APIs

## GET `/projects`

List projects. Filters:

    status
    category
    vendorId

`SYSTEM_ADMIN`, `SOCIETY_MANAGER`, and `COMMITTEE_MEMBER` receive the
existing project-list representation. `OWNER_MEMBER` and `RESIDENT` may use
this endpoint only for their persisted society and receive a discovery
summary containing `_id`, `title`, `category`, `status`, `createdAt`, and
`updatedAt`. This summary excludes project costs, proposer identity,
approval details, vendor/budget references, and quotation data. It supports
project discovery without resolving the society-specific financial
visibility rules. The response never accepts a client-supplied society as
the authorization scope for these roles.

------------------------------------------------------------------------

## GET `/projects/:id`

Get complete project details. Should include:

-   Project
-   Quotations
-   Change requests
-   Approval status
-   Progress
-   Evidence
-   Vendor
-   Financial information
-   Meeting
-   Proposal
-   Governance resolution
-   Governance voting status/result
-   Audit information where permitted

------------------------------------------------------------------------

## POST `/projects`

Create project. Allowed:

-   Society Manager
-   Authorized Committee Member

------------------------------------------------------------------------

## PATCH `/projects/:id`

Update editable project information only.

The request must not be able to directly set governed fields such as:

```text
status
approvalStatus
approvalType
approvedAt
finalApprovalResult
```

Those values are changed through workflow actions.

------------------------------------------------------------------------

## POST `/projects/:id/submit`

Submit project for review.

------------------------------------------------------------------------

## POST `/projects/:id/start`

Start approved project. Requirements:

-   Project approved
-   Required conditions satisfied

------------------------------------------------------------------------

## POST `/projects/:id/complete`

Complete an IN_PROGRESS project. Society Manager only. Request body requires
`completionUpdateId` and `finalCost`. The update must be an immutable
COMPLETION record for this project with a final invoice reference, and at
least one private AFTER_PHOTO must be attached. Final cost cannot exceed the
current approved project amount or be lower than recorded project expenses.
The transition and immutable audit event are transactional. No completion
blockchain proof is generated by this endpoint. PDF/file invoice upload is not
supported; the MVP stores a society-supplied invoice reference.

------------------------------------------------------------------------

## POST `/projects/:id/cancel`

Cancel project.

------------------------------------------------------------------------

# 15. APPROVAL API

## GET `/projects/:id/approval`

Return approval analysis. Example:

    {
      "projectAmount": 350000,
      "approvalType": "SGM_REQUIRED",
      "status": "REQUIRED",
      "ruleVersionId": "RULE-V12"
    }

------------------------------------------------------------------------

## POST `/projects/:id/submit-for-approval`

Submit project to its required approval workflow.

The backend runs the Approval Engine using the effective society rule
configuration and records the resulting approval requirement.

------------------------------------------------------------------------

## POST `/projects/:id/re-evaluate-approval`

Re-run approval evaluation after a material project/quotation change.

This endpoint must create a new approval evaluation/history record rather
than overwrite the previous decision.

------------------------------------------------------------------------

## GET `/projects/:id/approval-history`

Return approval history.

------------------------------------------------------------------------

# 16. QUOTATION APIs

## GET `/projects/:projectId/quotations`

List quotations.

------------------------------------------------------------------------

## GET `/quotations/:id`

Return quotation.

------------------------------------------------------------------------

## POST `/projects/:projectId/quotations`

Create quotation.

------------------------------------------------------------------------

## POST `/quotations/:id/select`

Select quotation where permitted. The backend verifies the persisted
quotation-to-project relationship, sets `Project.currentQuotationId`, marks
the quotation `SELECTED`, and supersedes a prior selected quotation. This
does not approve the project.

------------------------------------------------------------------------

# 17. CHANGE REQUEST APIs

## GET `/projects/:projectId/change-requests`

List change requests.

------------------------------------------------------------------------

## POST `/quotations/:quotationId/change-requests`

Create change request. Request:

    {
      "additionalAmount": 30000,
      "reason": "Additional electrical work required"
    }

The backend calculates:

    newAmount
    =
    originalAmount + additionalAmount

The frontend must not be trusted to provide the authoritative new
amount.

## POST `/change-requests/:id/submit`

Submit a change request for the currently selected quotation. The operation
stores the submitted state and runs the Approval Engine against the
persisted `newAmount` in one transaction. The project enters `RE_APPROVAL`;
this endpoint does not accept the change or create a resulting quotation
version.

------------------------------------------------------------------------

## GET `/change-requests/:id`

Get change request.

------------------------------------------------------------------------

## POST `/change-requests/:id/submit`

Submit change request.

------------------------------------------------------------------------

## POST `/change-requests/:id/approve`

Approve the change request through the applicable workflow.

The backend must evaluate the resulting total amount and create/update the
required re-approval process. It must not rely on the client-supplied
`newAmount`.

------------------------------------------------------------------------

## POST `/change-requests/:id/reject`

Reject change request.

------------------------------------------------------------------------

# 18. PROJECT PROGRESS APIs

## GET `/projects/:projectId/updates`

List append-only progress and completion records chronologically, including
authorized private photo metadata. Managers and committee members receive the
recording actor and invoice reference; verified owners receive the public
project record without those fields. Residence does not grant access. Only
SOCIETY_MANAGER, COMMITTEE_MEMBER, OWNER_MEMBER, and explicitly scoped
SYSTEM_ADMIN can read these records.

------------------------------------------------------------------------

## POST `/projects/:projectId/updates`

Create an immutable progress/completion record while the project is
IN_PROGRESS. Body: `kind` (`PROGRESS` or `COMPLETION`), `title`, `description`,
and optional `invoiceReference`; completion requires the invoice reference.
Society Manager only. This saves the timeline entry, not the project status.

------------------------------------------------------------------------

## GET `/project-updates/:id`

Retrieve one authorized progress/completion record and photo metadata.

## POST `/evidence/upload?projectUpdateId=<id>&category=PROGRESS_PHOTO|AFTER_PHOTO`

Attach one privately stored JPEG/PNG photo (5 MiB maximum) to a project update.
Only the assigned Society Manager can upload while the project is IN_PROGRESS.
Category must match the update kind. Downloads use the existing authenticated
`GET /evidence/:id`, verify the stored SHA-256 hash, and permit only managers,
committee members, or verified same-society owners. RESIDENT access is denied.

------------------------------------------------------------------------

# 19. VENDOR APIs

## GET `/vendors`

List active vendors for the authenticated user's society. `SYSTEM_ADMIN` must
provide `societyId`; society users are always scoped to their authenticated
society. A verified owner may use this read for comparison, but receives only
vendor name/company name and not direct contact or registration fields. The
response uses the persisted vendor `_id`, which quotation creation accepts as
`vendorId`.

------------------------------------------------------------------------

## GET `/vendors/:id`

Get vendor.

------------------------------------------------------------------------

## POST `/vendors`

Create a vendor with a required `name` and optional contact/company fields.
`SOCIETY_MANAGER` creates only within their own society; `SYSTEM_ADMIN` must
provide `societyId`. Creation is audited and returns the persisted `_id`.
New records are created as `ACTIVE` so they can be selected for quotations.

------------------------------------------------------------------------

## PATCH `/vendors/:id`

Update vendor.

------------------------------------------------------------------------

# 20. MEETING APIs

## GET `/meetings`

List meetings. Filters:

    type
    status
    date

------------------------------------------------------------------------

## GET `/meetings/:id`

Get meeting.

------------------------------------------------------------------------

## POST `/meetings`

Create meeting.

------------------------------------------------------------------------

## PATCH `/meetings/:id`

Update meeting while editable.

------------------------------------------------------------------------

## POST `/meetings/:id/publish`

Publish meeting/associated notice where applicable.

Before publication, the backend validates the configured notice-period
requirements.

------------------------------------------------------------------------

## GET `/meetings/:id/attendance`

Return permitted attendance information.

------------------------------------------------------------------------

## POST `/meetings/:id/attendance`

Record attendance for an eligible participant.

------------------------------------------------------------------------

## GET `/meetings/:id/quorum`

Return the quorum calculation for the meeting.

The backend calculates quorum from the applicable membership population and
configured meeting rule.

------------------------------------------------------------------------

## POST `/meetings/:id/adjourn`

Record an adjournment while preserving the original meeting, agenda and
history.

------------------------------------------------------------------------

## POST `/meetings/requisitions`

Create an SGM requisition where permitted.

The backend validates the applicable requisition threshold and requesting
membership records.

------------------------------------------------------------------------

# 21. PROPOSAL APIs

## GET `/proposals`

List proposals.

------------------------------------------------------------------------

## GET `/proposals/:id`

Get proposal details.

------------------------------------------------------------------------

## POST `/proposals`

Create proposal.

------------------------------------------------------------------------

## PATCH `/proposals/:id`

Update proposal before a governance resolution is opened.

------------------------------------------------------------------------

## POST `/proposals/:id/create-resolution`

Create a formal Governance Resolution from the proposal when a decision
is required.

The backend must validate:

-   Proposal exists
-   Proposal is in a valid state
-   Related meeting exists where required
-   User has permission to create the resolution
-   Required project/approval information is present
-   The applicable decision body/rule can be determined

------------------------------------------------------------------------

# 22. GOVERNANCE RESOLUTION APIs

### Current implementation boundary

The backend exposes authenticated, society-scoped meeting and ordinary
general-body resolution workflows using the standard `{ success, data }` API
envelope. Society members may read their society records. Meeting/resolution
administration endpoints are limited to `SYSTEM_ADMIN`, `SOCIETY_MANAGER`, and
`COMMITTEE_MEMBER`; a platform administrator must provide an explicit
`societyId`. Vote submission uses the authenticated user and the private
eligibility snapshot, not the caller's application role.

Implemented routes:

- `GET /meetings`, `GET /meetings/:meetingId`, `POST /meetings`, and
  `POST /meetings/:meetingId/publish`. Only AGM/SGM publication is enabled.
  Publication requires an agenda, a society-provided notice reference and
  issue date, and the configured clear-notice interval. The API records that
  reference; it does not verify a notice document or legal adoption.
  Insufficient clear days return `409 NOTICE_PERIOD_INSUFFICIENT` with the
  actual versus required count and a corrective action (issue notice earlier
  or select a later meeting date). The draft remains unpublished. The browser
  displays this server explanation; it does not bypass the active rule.
- `POST /society/rules/governance` creates and activates a new immutable
  society rule version. A manager may submit `starterPolicy: true` or a full
  validated `governancePolicy` object plus `confirmedDocumentReference`.
  Confirmation records the manager's assertion and reference; Nivaas does not
  certify legal applicability.
- `GET /resolutions`, `GET /resolutions/:resolutionId`, and
  `POST /resolutions`. Creation requires a published same-society AGM/SGM,
  applicable rule version, and configured decision type/body/method. Project
  approval additionally requires a current SGM-required `ApprovalDecision`,
  its matching rule version, project, amount/quotation revision and linked SGM.
- `POST /resolutions/:resolutionId/eligibility-snapshot` derives one private,
  immutable electorate snapshot from configured membership type/status,
  membership validity dates, same-society membership and active User evidence.
  The starter policy includes only active `PRIMARY` memberships. Snapshot
  creation fails closed if current `JOINT`, `ASSOCIATE`, or `PROVISIONAL`
  memberships exist because the current schema cannot verify their required
  ordering/consent/basis evidence; such members are not silently omitted.
  Responses expose the eligible count, not voter IDs.
- `POST /resolutions/:resolutionId/open` opens voting only with the confirmed
  matching policy and non-empty eligibility snapshot.
- `GET /resolutions/:resolutionId/my-vote` returns only the authenticated
  member's own recorded vote (when eligible); `POST
  /resolutions/:resolutionId/votes` accepts one immutable YES, NO, or ABSTAIN
  vote per eligible member.
- `POST /resolutions/:resolutionId/close` closes after the voting end and
  calculates counts/outcome on the server. `POST
  /resolutions/:resolutionId/finalize` revalidates the result and meeting,
  finalizes idempotently, and changes a project to `APPROVED` only for a
  passing configured project resolution that still matches the current
  `ApprovalDecision` and quotation/change-request context.
- `POST /resolutions/:resolutionId/proof` retries proof submission only after
  finalization; `GET /resolutions/:resolutionId/proof` reports status. A proof
  is confirmed only by the blockchain proof service's successful receipt and
  contract read-back.

The starter policy is a configurable Nivaas product default, not a universal
legal rule: eligible denominator is the snapshotted eligible-member
population; required quorum is `min(ceil(2 * eligible / 3), 20)`; YES must be
strictly greater than NO; abstentions count toward attendance/quorum and are
excluded from the YES/NO denominator; ties and unmet quorum yield
`NO_DECISION`. Committee-type `GovernanceResolution` records and special decisions remain disabled; committee project approval uses the separate Approval API. Project
approval mapping is deliberately limited to an SGM-required `ApprovalDecision`
whose body is `GENERAL_BODY_OR_SGM`; it does not authorize any other approval
route.

## GET `/resolutions`

List governance resolutions scoped to the authenticated user's society.

Supported filters may include:

``` text
meetingId
projectId
resolutionType
status
votingMethod
```

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId`

Get a governance resolution scoped to the authenticated user's society.

Response should include, where permitted:

``` text
Resolution
Meeting
Proposal
Related project
Voting method
Voting period
Eligibility information
Current status
Voting status
Result when available
```

------------------------------------------------------------------------

## POST `/resolutions`

Create a draft governance resolution. Request fields include `meetingId`,
`ruleVersionId`, `resolutionType`, `decisionBody`, `votingMethod`, `title`,
`votingStart`, and `votingEnd` (plus optional `description`; platform admins
also provide `societyId`). The meeting and rule version must be society
scoped, and the selected rule version must apply on the meeting's scheduled
date.

The backend must validate:

- User permission
- Required meeting/proposal information
- Applicable decision body
- Voting method
- Majority rule
- Quorum rule
- Eligibility rule
- Voting period

The effective governance rule/configuration version must be attached to the
resolution.

The resolution becomes the historical container for the confirmed typed
policy and rule-version snapshot used by that draft. This operation does not
create an eligibility snapshot or open voting.

`PROJECT_APPROVAL` is enabled only when the selected `ApprovalDecision` is
current, same-society, `SGM_REQUIRED`, has decision body
`GENERAL_BODY_OR_SGM`, uses the same rule version, matches the project's
current amount/quotation or change-request revision, and is attached to a
published SGM linked to that project. Other approval routes remain disabled.

## POST `/resolutions/:resolutionId/eligibility-snapshot`

Create the single immutable eligibility snapshot for a draft resolution.
Membership rows are filtered by the configured membership types/statuses,
their valid date range, and same-society active user accounts. If the policy
requires evidence not represented by a verified source, the request fails
closed. It also fails if current joint, associate, or provisional memberships
exist because their relevant evidence cannot be verified. The response exposes
only the snapshot ID and eligible count.

## POST `/resolutions/:resolutionId/open`

The route transitions a draft to `OPEN` only when its confirmed supported
policy, immutable non-empty eligibility snapshot, and rule-version identity
match. Committee-type `GovernanceResolution` records, special decisions, unsupported membership evidence, and
unsupported policy formulas fail closed.

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId/my-vote`

Returns only the authenticated member's recorded vote when eligible. It never
returns another member's vote.

------------------------------------------------------------------------

## POST `/resolutions/:resolutionId/close`

Closes voting only after `votingEnd` and calculates counts/outcome from
persisted votes and the snapshotted policy. The result is `APPROVED`,
`REJECTED`, or `NO_DECISION`; unmet quorum and ties produce `NO_DECISION`
under the starter policy. Closing does not itself approve a project.

After voting is closed:

-   New votes must not be accepted.
-   Existing votes must remain immutable.
-   The result must be calculated according to the configured governance
    rules.

------------------------------------------------------------------------

## POST `/resolutions/:resolutionId/finalize`

Finalize the calculated governance result after the resolution's voting
conditions have been satisfied.

The backend verifies stored counts against immutable votes, validates the
published meeting and current decision context, and finalizes idempotently.
Only a passing project resolution matching the current SGM `ApprovalDecision`
can transition its project to `APPROVED`. Rejected and inconclusive outcomes
cannot do so. Successful finalization writes append-only audit evidence and
then submits that AuditLog record to the configured proof service.

------------------------------------------------------------------------

# 23. GOVERNANCE VOTING APIs

## POST `/resolutions/:resolutionId/votes`

Submit a governance vote.

### Request

Example:

``` text
{
  "vote": "YES"
}
```

The authoritative voter identity comes from the authenticated
session/token. The client must not be trusted to supply another user's
identity.

The client also must not submit authoritative eligibility, voting weight,
result, blockchain status or timestamp values.

### Backend validation sequence

Before accepting the vote, the backend must perform the following
checks:

``` text
Is resolution open?
        ↓
Is user authenticated?
        ↓
Is user eligible?
        ↓
Is voting method valid?
        ↓
Is voting period active?
        ↓
Has user already voted?
        ↓
Accept vote
        ↓
Record GovernanceVote
Return response
```

The backend is authoritative for every step.

The frontend must never be trusted to decide:

-   Whether voting is open
-   Whether a user is eligible
-   Whether a duplicate vote exists
-   Whether a vote is valid
-   Whether the resolution passed
-   Whether blockchain recording is required

### Important voting distinction

This endpoint is for **governance resolutions**, not secret-ballot
elections.

The implemented starter method is recorded show of hands. Other methods and
secret-ballot behavior require their own confirmed policy and implementation.

The calculated result is included in the resolution response after close; no
separate result or voting-status endpoint is implemented. No authorized user
can submit or overwrite the final result.

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId/proof`

Return the status of the finalized resolution's AuditLog proof. The backend
reports `CONFIRMED` only after receipt and registry read-back verification.

Possible statuses:

``` text
PENDING
CONFIRMED
FAILED
UNAVAILABLE
UNKNOWN
CONFLICT
```

The response may include:

``` text
transactionHash
blockNumber
confirmedAt
```

## POST `/resolutions/:resolutionId/proof`

Retry/reconcile proof submission for a finalized resolution only. The request
does not accept a client-provided hash. `CONFIRMED` is returned only after the
proof service verifies the successful chain receipt and registry read-back.

------------------------------------------------------------------------

# 24. FUTURE ELECTION APIs

Committee/election voting is **not part of the semester MVP**.

A future election module may use endpoints conceptually such as:

``` text
GET  /elections
GET  /elections/:electionId
GET  /elections/:electionId/eligibility
POST /elections/:electionId/cast-ballot
GET  /elections/:electionId/result
```

A future election endpoint must **not** simply reuse:

``` text
POST /resolutions/:resolutionId/votes
```

and must not expose a public relationship between:

``` text
Voter Identity → Candidate Chosen
```

The final election API would require an anonymous-ballot architecture
involving eligibility verification, anonymous credentials/ballots,
secure ballot storage, counting, and result verification.

No election-voting implementation should be started in the MVP until
that architecture is separately specified and approved.

------------------------------------------------------------------------

# 25. PAYMENT APIs

## GET `/payments`

List permitted payments.

------------------------------------------------------------------------

## GET `/payments/:id`

Get payment.

------------------------------------------------------------------------

## POST `/payments`

Create/initiate payment.

The backend records the payment lifecycle. A blockchain transaction hash
confirms a blockchain transaction; it does not by itself prove that an
off-chain bank/payment settlement has completed.

------------------------------------------------------------------------

## GET `/payments/:id/status`

Get payment status.

------------------------------------------------------------------------

## GET `/payments/:id/blockchain`

Return blockchain transaction information.

------------------------------------------------------------------------

# 26. COMPLAINT APIs

Implemented browser/API slice (BR-COMPLAINT-001–003): authenticated owners
and residents create and read their own complaints; the assigned Society
Manager reads and manages complaints in that society. Scope and creator are
derived from the persisted authenticated account. Other residents cannot read
another creator's complaint. Committee oversight requires an explicit policy
and is not enabled by the committee application role. Platform operational
actions are not enabled.

`POST /complaints` accepts only `{title, description, category, priority}`.
Only title is required and nonempty. Description, category and priority are
optional; omitted or blank values are stored as empty strings. Maximum lengths
are 160, 10000, 80 and 40 respectively. Non-text values remain invalid.
Category and priority are descriptive text, not invented governance enums.
The server creates `OPEN` and an initial timeline/audit event transactionally.
Client-supplied society, creator, status, flat and evidence fields are rejected.

`GET /complaints?page=1&status=OPEN` returns `{items, total, page, limit:20}`
inside the standard envelope; status is optional. `GET /complaints/:id`
returns the complaint plus chronological `updates`. Inaccessible IDs return
404. Caller-selected society filters are rejected.

Manager actions accept `{description}` (required, maximum 10000 characters):
`acknowledge`: OPEN → ACKNOWLEDGED; `update`: ACKNOWLEDGED/IN_PROGRESS →
IN_PROGRESS; `resolve`: IN_PROGRESS → RESOLVED. Each operation atomically
writes the state, append-only timeline entry and AuditLog. Invalid/stale
transitions return 409. RESOLVED does not imply resident confirmation or CLOSED.

Complaint detail now also returns safe `evidence` metadata and each photo
timeline event contains `evidenceIds`. See the evidence API below.
Assignment, confirmation and reopening endpoints below
remain specified but unimplemented. Confirmation/reopening authority remains
unresolved; no automatic closure is supplied.

## GET `/complaints`

List complaints according to role.

------------------------------------------------------------------------

## GET `/complaints/:id`

Get complaint details.

------------------------------------------------------------------------

## POST `/complaints`

Create complaint. Allowed:

-   Owner
-   Resident

------------------------------------------------------------------------

## POST `/complaints/:id/acknowledge`

Acknowledge complaint.

------------------------------------------------------------------------

## POST `/complaints/:id/assign`

Assign complaint.

------------------------------------------------------------------------

## POST `/complaints/:id/update`

Add progress update.

------------------------------------------------------------------------

## POST `/complaints/:id/resolve`

Mark complaint resolved.

------------------------------------------------------------------------

## POST `/complaints/:id/confirm`

Resident confirms resolution.

------------------------------------------------------------------------

## POST `/complaints/:id/reopen`

Reopen complaint where permitted.

------------------------------------------------------------------------

# 27. NOTICE APIs

## GET `/notices`

List society-scoped notices. Owners, residents, and committee members receive
published, unexpired notices only. The authenticated Society Manager may
filter the society's `DRAFT`, `PUBLISHED`, or `ARCHIVED` records. A
`SYSTEM_ADMIN` must provide an explicit `societyId` and receives published
notices only; platform role does not grant notice-management authority.
Filters:

    category
    priority
    status
    page
    limit

------------------------------------------------------------------------

## GET `/notices/:id`

Get notice.

------------------------------------------------------------------------

## POST `/notices`

Create a draft notice. The authenticated Society Manager may create notices
only in their own society. Input uses the documented title, description,
category, priority, optional expiry, and same-society meeting/project links.
Priority is a society-supplied label; the specification does not define a
fixed priority vocabulary. Create, draft edit, publish, and archive actions
write append-only AuditLog events in the same database transaction.

Committee draft creation is not enabled because no society-specific notice
permission setting is currently implemented. The browser supports immediate
publication and private JPEG/PNG document-scan attachments through the existing
evidence API. Save a draft, attach scans, then publish. Scheduled publication,
PDF and Office attachments remain unsupported.

Allowed:

-   Society Manager

------------------------------------------------------------------------

## PATCH `/notices/:id`

Edit draft notice.

------------------------------------------------------------------------

## POST `/notices/:id/publish`

Publish notice.

------------------------------------------------------------------------

## POST `/notices/:id/archive`

Archive notice.

------------------------------------------------------------------------

# 28. EVIDENCE APIs

## POST `/evidence/upload`

Implemented for complaint photos: send raw bytes with
`Content-Type: application/octet-stream` and query parameters `complaintId`
and `category`. No multipart parser, client filename or storage path is used.
Only authenticated complaint creators and their society manager have access.
Owners/residents may attach `COMPLAINT_PHOTO` while their complaint is OPEN.
Managers may attach `PROGRESS_PHOTO` in ACKNOWLEDGED/IN_PROGRESS, and
`AFTER_PHOTO` in IN_PROGRESS/RESOLVED. Uploads do not resolve or close a complaint.

For notice scans, use `noticeId` instead of `complaintId` and category
`NOTICE_ATTACHMENT`. Exactly one target is accepted. Only the assigned society
manager may upload, and only while the notice is DRAFT. Publication locks its
attachments. Evidence metadata, notice attachmentIds and NOTICE_ATTACHMENT_UPLOADED
audit event commit atomically. The same image validation, size limits and private
storage apply; no arbitrary attachment IDs or external file URLs are accepted.
Downloads follow notice access: the same-society manager may read drafts/archives;
other permitted readers (including platform oversight) may read only published,
unexpired notices. Cross-society users are denied. Downloads recheck linkage,
size and SHA-256 and use the same private headers as complaint evidence.

The server accepts bounded JPEG/PNG photo structures (maximum 5 MiB and
25 million pixels), checks bytes rather than declared MIME/name, and rejects
SVG, executables, unsupported formats, truncation and trailing data. PNG chunk
CRCs are validated. No image decoder executes on the server. This is not an
antivirus scan or a promise that every accepted image decoder will render it.
Oversize bytes or dimensions return 413 (`FILE_TOO_LARGE` or
`IMAGE_DIMENSIONS_TOO_LARGE` with a 25-megapixel explanation); unsupported
content returns 415; forbidden state/category returns 409.

Successful 201 responses use the standard envelope and return generated
filename, detected type, size, SHA-256, uploader, complaint reference, category
and ID, never a storage path. Evidence metadata, a timeline link and audit
event commit together. Failed persistence does not publish a timeline entry.
An ambiguous commit returns 503; refresh the timeline before retrying.

Upload file. The backend shall:

-   Validate file type
-   Validate size
-   Store file
-   Generate hash
-   Store metadata

------------------------------------------------------------------------

## GET `/evidence/:id`

Return permitted evidence.

For complaint evidence this is an authenticated binary download. Authorization
is rechecked against the current user and complaint on every request; unrelated
residents and other societies receive 404. The file size/hash must match stored
metadata or retrieval returns 409. Missing storage returns 503. Responses use
generated attachment filenames, application/octet-stream, nosniff, sandbox CSP
and private/no-store caching. The frontend fetches with its bearer token and
uses a temporary blob URL; credentials are never put into URLs.

------------------------------------------------------------------------

## DELETE `/evidence/:id`

Deletion must be restricted and should not be available for important
historical evidence after it becomes part of an official record.

Where an ordinary draft file must be removed, the action should be audited.
Official evidence should normally be archived/invalidated rather than
destructively deleted.

------------------------------------------------------------------------

# 29. AUDIT APIs

## GET `/audit`

Return audit records permitted to the current user.

Supports `page`, `pageSize`, `from`, `to`, and one `search` text filter.
Search is case-insensitive and partial, includes human-readable event names,
allowlisted non-sensitive event text, and names from actual same-society
project, quotation, and vendor relationships. Related records are scoped
through their owning project before their text is considered. Search is applied
before pagination. The frontend provides exactly one text-search field plus
the two date filters; legacy action/entity-type query filters are rejected.

Audit access is server-authorized and subject to society/resource
isolation and applicable business rules. The high-level role visibility
baseline appears in the authorization matrix below; it does not define
detailed endpoint permissions. Audit records are read-only. Corrections are
represented by a new audit event that identifies the original event; the
original event is not modified or deleted. No audit-write or correction
request schema is defined here.

------------------------------------------------------------------------

## GET `/audit/:entityType/:entityId`

Return history for a specific entity. Example:

    GET /audit/project/P001

The same authorization, isolation, and immutability requirements apply.

------------------------------------------------------------------------

# 30. BLOCKCHAIN APIs

Blockchain interaction should be isolated.

## GET `/blockchain/status`

Return blockchain network status.

------------------------------------------------------------------------

## GET `/blockchain/transactions/:hash`

Return transaction information.

------------------------------------------------------------------------

## GET `/blockchain/verify/:recordId`

Verify a blockchain-backed record.

## AuditLog proof endpoints

These endpoints operate on an existing immutable AuditLog event. They do not
create or modify the event and do not imply that its underlying real-world
event was true or legally valid. In particular, proving an AuditLog event
that records project submission for approval does not prove project
approval.

All three endpoints require a bearer token and the existing audit-reader
roles: `SYSTEM_ADMIN`, `SOCIETY_MANAGER`, or `COMMITTEE_MEMBER`. A society
scoped caller may access only an event belonging to their own society.
`SYSTEM_ADMIN` may access across societies under this explicit policy, which
does not grant governance authority. Responses contain identifiers, hashes,
network/deployment and transaction metadata, and verification status; they
never contain the complete AuditLog payload or signer secret.

### GET `/audit/events/:auditLogId`

Retrieve one authorized AuditLog event directly by its immutable ID. This
supports deep links to older events independently of the paginated audit
list. Society-scoped users receive 404 for events outside their society.

### POST `/blockchain/audit-logs/:auditLogId/proof`

Submit or safely retry the proof for the identified AuditLog event. The
backend recomputes `hashAuditLog()` from the persisted event and rejects a
stored-hash mismatch. The operation is idempotent for the same record,
proof version, chain, contract, and deployment. It reconciles on-chain
state before any retry and never overwrites a conflicting registry proof.

Successful submission returns the logical operation and its current
`PENDING`, `CONFIRMED`, or `FAILED` status. `CONFIRMED` requires a successful
receipt and matching registry read-back. A proof conflict is returned as
`409 BLOCKCHAIN_PROOF_CONFLICT`; network/configuration failures do not
fabricate confirmation.

### GET `/blockchain/audit-logs/:auditLogId/proof`

Return the persisted proof operation and transaction-attempt metadata for
this configured deployment, or `data: null` when no operation exists.
If only an operation for a different deployment exists, the response uses
`status: "STALE_DEPLOYMENT"` and includes the active deployment identity.
This is operation status, not an independent chain verification; only the
verification endpoint can establish a confirmed proof on the active registry.

### GET `/blockchain/verify/audit-logs/:auditLogId`

Recompute the persisted AuditLog hash, read the configured registry proof,
and require a matching registration event, successful transaction receipt,
and matching contract verification before reporting `CONFIRMED`. It reports
whether the record is intact and the on-chain reference, version, and hash
match. Unknown proofs return a successful verification
response with `proofStatus: "UNKNOWN"`; altered local record content,
conflicting on-chain hashes, and incorrect chain/contract configuration are
reported as non-matching or explicit configuration/integrity errors, never
as verified.

The `recordReference` uses derivation version 1: Keccak-256 of Solidity
`abi.encode(bytes32 domainHash, uint256 version, bytes32 societyId,
bytes32 auditLogId)`, where the domain hash is
`keccak256(utf8("NIVAAS:AUDIT_LOG:REFERENCE"))` and each ObjectId is
left-zero-padded to bytes32. This reference-derivation version is distinct
from the registry proof version and AuditLog `hashVersion`.

------------------------------------------------------------------------

# 31. API AUTHORIZATION MATRIX

Simplified permissions:

  ------------------------------------------------------------------------------------------
  **Module**   **Admin**   **Manager**   **Committee**         **Owner**     **Resident**
  ------------ ----------- ------------- --------------------- ------------- ---------------
  Users        Full        Limited       View                  Self          Self

  Society      Full        View          View                  View          View

  Budget       Full        Manage        Review                View          Limited

  Expenses     Full        Manage        Review                View          Limited

  Projects     Full        Manage        Review/Approve        View          View

  Quotations   Full        Manage        Review                View          View

  Meetings     Full        Manage        Participate           Participate   Limited

  Governance   None        Manage       Participate           Vote if       No automatic
  Voting                                                       eligible      vote

  Complaints   Full        Manage        Review                Create        Create

  Notices      Full        Manage        Request/Create where  View          View
                                         allowed                             

  Payments     Full        Manage        Review                Own           Own where
                                                                             applicable

  Audit        Full        Operational   Review                Permitted     Limited
  ------------------------------------------------------------------------------------------

This matrix is a baseline. Specific endpoint authorization must still be
checked against entity state, membership, resolution eligibility, conflict
of interest and the applicable society rule configuration.

For the Users row, endpoint-specific rules take precedence. In particular,
`GET /users` is `SYSTEM_ADMIN` only; the Manager `Limited` and Committee
`View` labels do not grant access to that generic list endpoint.
`GET /users/:id` follows the explicit per-role profile permissions defined in
Section 6. The matrix does not define additional user-management endpoints
or permissions.

In this matrix, the Admin column denotes `SYSTEM_ADMIN`'s platform-level
technical scope. In the Society row, Full refers to platform-level access
only on explicitly permitted society-administration endpoints; it does not
resolve authority to change governance-rule versions. For the
Governance/Voting row, `SYSTEM_ADMIN` has no governance authority; platform
administration must not bypass the society governance process.
Cross-society administrative scope applies only where a specific endpoint
explicitly permits it. Generic society-isolation checks must not embed a
platform-admin bypass.

------------------------------------------------------------------------

# 32. STATE TRANSITION RULE

APIs must not allow arbitrary status modification. Bad:

    PATCH /projects/:id
    {
      "status": "APPROVED"
    }

Instead:

    POST /projects/:id/approve

or the appropriate workflow endpoint. This ensures the backend can
validate the conditions for the transition.

------------------------------------------------------------------------

# 33. BUSINESS RULE ENFORCEMENT

The backend must enforce:

``` text
Project / Quotation Amount
      ↓
Effective Society Rule Version
      ↓
Approval Engine
      ↓
Approval Type
      ↓
Approval / Governance Resolution
```

The frontend may display the result, but cannot determine it
authoritatively.

For governance resolution voting, the backend must additionally enforce:

``` text
Resolution State
      ↓
Authentication
      ↓
Eligibility
      ↓
Voting Method
      ↓
Voting Period
      ↓
Duplicate Vote Check
      ↓
GovernanceVote
      ↓
Result Calculation
      ↓
Blockchain Recording, if applicable
```

The frontend may display eligibility, voting state, and results, but
these values must be determined authoritatively by the backend.

------------------------------------------------------------------------

# 34. BLOCKCHAIN STATUS

Blockchain-backed APIs should expose:

    PENDING
    CONFIRMED
    FAILED

Example:

    {
      "status": "CONFIRMED",
      "transactionHash": "0x..."
    }

------------------------------------------------------------------------

# 35. API ERROR CODES

Initial error codes include:

    UNAUTHORIZED
    FORBIDDEN
    NOT_FOUND
    VALIDATION_ERROR
    INVALID_STATE
    SGM_REQUIRED
    APPROVAL_REQUIRED
    DUPLICATE_VOTE
    VOTING_CLOSED
    RESOLUTION_NOT_OPEN
    INVALID_VOTING_METHOD
    INELIGIBLE_VOTER
    QUOTATION_REVISION_REQUIRED
    BLOCKCHAIN_PENDING
    BLOCKCHAIN_FAILED
    FILE_TOO_LARGE
    INVALID_FILE_TYPE
    MEMBERSHIP_REQUIRED
    MEMBERSHIP_INACTIVE
    QUORUM_NOT_MET
    NOTICE_PERIOD_NOT_MET
    RULE_VERSION_INVALID
    CONFLICT_OF_INTEREST
    APPROVAL_RULE_CHANGED
    PAYMENT_SETTLEMENT_NOT_CONFIRMED
    IDEMPOTENCY_CONFLICT

------------------------------------------------------------------------

# 36. IDEMPOTENCY AND RETRY SAFETY

Operations that can create an irreversible or externally visible event
should be designed to tolerate safe client retries where practical,
especially:

- Governance vote submission
- Payment initiation
- Blockchain transaction submission
- Meeting requisition creation
- Governance result finalization

Where an idempotency key is used, the backend must associate it with the
authenticated user and intended operation and must reject conflicting reuse.

A network timeout must not cause the client to accidentally create two
logical votes or two payment records.

Society creation currently has no idempotency-key contract. If a client
loses the response and retries `POST /societies`, the retry is treated as a
new creation and may create another society with its own atomically
provisioned initial rule. Clients must not assume timeout retries are
deduplicated for this endpoint.

------------------------------------------------------------------------

# 37. API VERSIONING

The initial API may use:

    /api

If breaking changes become necessary, versioning may be introduced:

    /api/v1

AI tools must not introduce versioning unnecessarily.

------------------------------------------------------------------------

# 38. API DOCUMENTATION RULE

Whenever an API changes, the AI developer must update:

1. `API.md`
2. Relevant SRS requirement
3. `BUSINESS_RULES.md`
4. `DATABASE.md`
5. `ARCHITECTURE.md` where the architectural boundary changes
6. Frontend service code
7. Backend implementation
8. Relevant tests

------------------------------------------------------------------------

# 39. API STATUS

Version 1.16 — Active Planning Document.

Version 1.16 documents the authenticated, read-only committee approval inbox
used by a committee member's dashboard. It returns only current same-society
decisions awaiting that member's participation.

Revised to align with SRS v1.10, Business Rules v1.10, Architecture v1.12 and
Database v1.15. Owner read access is authorized by active same-society
ownership for project/quotation/approval/approved-budget/vendor-label/audit/
proof-status endpoints; direct vendor contacts and private audit entities are
excluded. Owner proof submission and operational mutations remain forbidden.
The API now explicitly supports the membership/eligibility
layer, versioned governance configuration, approval re-evaluation,
meeting/quorum workflows, governance-result finalization and retry-safe
critical operations, user-list/profile access and safe user responses, and
the one-time initial account-setup endpoint and contract, AuditLog proof
submission, operation status and independent verification endpoints, and the
society-scoped local member-account onboarding endpoint.

The API is the contract between the frontend and backend. No AI coding
agent should invent or silently change API behavior.

## Owner transparency read access (24 October 2026)

`OWNER_MEMBER` may use the society-scoped read endpoints for projects,
quotations/change-request history, approval evaluations, approved budgets,
vendor comparison labels, permitted audit events, and blockchain proof status
and verification only when the authenticated account has a persisted active
Ownership relationship in the same society. The check uses `ownerships`
(`userId`, `societyId`, `status: ACTIVE`, and effective start/end dates). It
does not depend on a current Residence or confer voting eligibility. Requests
for another society or records not permitted to owners are hidden as
not-found. Owner access is read-only: proof submission and operational
project, quotation, budget, vendor, and governance actions keep their existing
role restrictions.

`GET /vendors` returns active same-society vendor names/company names to a
verified owner for comparison. It omits contact person, phone, email, address,
and registration details. `RESIDENT` does not have quotation, vendor, budget,
audit, or proof access in the current MVP. Residents retain the separately
implemented notice, complaint, and project-summary access.

Project list/detail and existing quotation/change-request GET routes expose
only records tied through persisted project/society IDs. Audit listing and
direct retrieval apply the same owner relationship check plus an allowlist of
public transparency entity types; account, ownership, residence, complaint,
and other private events are excluded. Blockchain status/verification applies
that check to the underlying AuditLog event; owners cannot submit proofs.
Record integrity is independent of proof status, and confirmation still
requires a successful receipt and matching registry verification.
### GET `/audit/events/:auditLogId`

Retrieve one authorized AuditLog event directly by its immutable ID. This is
used for deep links to older events and is independent of the paginated audit
list. Society-scoped users receive 404 for events outside their society.

## Committee approval decisions

`GET /committee-approvals/pending-for-me` is available only to an authenticated `COMMITTEE_MEMBER`. It returns current same-society project approval decisions for which the user has an active appointment in the snapshotted electorate (or an active appointment where the electorate has not yet been initialized) and has not recorded a decision for that ApprovalDecision revision. The endpoint is read-only, returns project titles/statuses plus decision references, and does not initialize an electorate or change approval state. `POST /projects/:id/committee-approval/decisions` accepts `{ decision: "APPROVE" | "REJECT", rationale? }` for a current `COMMITTEE_APPROVAL` only. The authenticated actor must be an active same-society `COMMITTEE_MEMBER` application account and have a current active CommitteeMember appointment under an active same-society Committee. One immutable decision is allowed per actor and ApprovalDecision revision. `GET /projects/:id/committee-approval` returns aggregate counts and policy snapshot. `POST /projects/:id/committee-approval/finalize` is Society Manager only and returns 409 unless quorum and an unambiguous majority are satisfied. Approval updates the project only from its matching pending committee state and active rule version. This does not permit a committee member to directly change project status.

The approval-threshold rule endpoint may also accept `committeeApproval` with quorum numerator/denominator, optional quorum maximum, majority numerator/denominator, and `STRICTLY_GREATER` or `AT_LEAST`. Omitted committee settings preserve the existing version's value; initial default is two-thirds quorum rounded up and strictly more than half of cast decisions. A rule version and audit commitment snapshot the full configured approval policy.

## Offline AGM/SGM decision confirmation

Meeting creation may include `documentReferences`, an array of `{ kind, reference }` for NOTICE, PROPOSAL, QUOTATION, MINUTES, or SUPPORTING_EVIDENCE. References are society assertions and are not verified file uploads. Existing notice and agenda checks remain required at publication.

`POST /resolutions/:resolutionId/record-offline` is available only to the authenticated Society Manager. It requires `confirm: true`, a supported non-secret method, `attendanceMemberIds`, aggregate `yesCount`, `noCount`, `abstainCount`, `minutesReference`, and at least one `supportingEvidenceReferences` item. Attendance IDs must be unique and in the immutable eligibility snapshot; recorded vote counts cannot exceed attendance, and present members who do not vote still count toward quorum. Quorum and outcome are calculated by the resolution's snapshotted rule. A quorum failure records NO_DECISION. A project remains pending unless outcome is APPROVED and the current SGM ApprovalDecision, amount, rule, quotation/change revision and project all match. The response records the confirming actor and time. The offline record and audit event are committed in one transaction. Committee decisions are not governance resolutions.

This milestone adds no live-voting endpoint. The pre-existing `/open`, `/votes`, and `/close` routes remain separate from this offline-record operation; no new secret-ballot or election-voting behavior is introduced, and the browser Voting route remains unavailable.
