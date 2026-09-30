## REST API Specification

**Document:** `API.md` **Version:** 1.7 **Base URL:** `/api` **Status:**
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
        "token": "..."
      }
    }

------------------------------------------------------------------------

## POST `/auth/logout`

Log out the current user.

------------------------------------------------------------------------

## GET `/auth/me`

Return the currently authenticated user.

------------------------------------------------------------------------

# 6. USER APIs

## GET `/users`

System Admin only. This is a platform-scoped administrative endpoint and may
return users across societies according to permitted filters. The endpoint's
explicit platform scope does not establish platform scope for other routes.

------------------------------------------------------------------------

## GET `/users/:id`

Returns a user profile according to permission.

Any cross-society access must be explicitly permitted for this endpoint.
Other access remains subject to the target user's society scope and the
applicable self/profile permissions.

------------------------------------------------------------------------

## POST `/users`

Create a user. Allowed:

-   System Admin

The System Admin's platform scope applies only because this endpoint
explicitly permits that role. Account creation must not accept a permanent
password or `passwordHash` from the administrator. A newly created account
enters pending setup, and the backend generates a single-use account-setup
credential that the user consumes to establish their own password. The
credential cannot be reused after successful consumption or invalidation.
The administrator must never receive or set the user's permanent password.

Credential delivery is implementation-specific and is not part of this
core user API; no delivery provider or service is required by this contract.
This decision does not define setup-token expiry, password complexity, or
the account-setup API contract. The existing authentication/password-hashing
mechanism is the basis when the user establishes a password. Account setup
is separate from society membership, ownership, residence/occupancy,
committee membership, and governance/voting eligibility.

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

## GET `/society/rules/history`

Return historical rule/configuration versions according to permission.

## POST `/society/rules/versions`

Create a new effective rule/configuration version.

The request must identify only the settings being changed. The backend must
validate the configuration and create an audit record.

## GET `/society/rules/versions/:versionId`

Return a specific rule/configuration snapshot.

Historical versions are read-only.

------------------------------------------------------------------------

# 9. BUILDING APIs

## GET `/buildings`

Return society buildings.

------------------------------------------------------------------------

## GET `/buildings/:id`

Return building details.

------------------------------------------------------------------------

## POST `/buildings`

Create building. Allowed:

-   System Admin

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

Create flat.

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

Create an ownership relationship.

## PATCH `/ownerships/:id`

Update an ownership relationship while permitted.

## GET `/flats/:flatId/residents`

Return resident/occupancy relationships for the flat.

## POST `/flats/:flatId/residents`

Create a residence/occupancy relationship.

## PATCH `/residences/:id`

Update an occupancy relationship while permitted.

## GET `/memberships`

List society membership records according to permission.

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

Create a membership record.

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

List expenses. Filters:

    budgetId
    categoryId
    projectId
    vendorId
    date

------------------------------------------------------------------------

## GET `/expenses/:id`

Get expense.

------------------------------------------------------------------------

## POST `/expenses`

Create expense.

------------------------------------------------------------------------

## PATCH `/expenses/:id`

Update an editable expense. Historical/confirmed financial records must
not be silently overwritten.

------------------------------------------------------------------------

# 14. PROJECT APIs

## GET `/projects`

List projects. Filters:

    status
    category
    vendorId

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

Submit project for completion. Requirements may include:

-   Completion evidence
-   Final cost
-   Final invoice

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

Select quotation where permitted.

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

List progress updates.

------------------------------------------------------------------------

## POST `/projects/:projectId/updates`

Create progress update. Allowed:

-   Society Manager
-   Authorized staff

------------------------------------------------------------------------

## GET `/project-updates/:id`

Get progress update.

------------------------------------------------------------------------

# 19. VENDOR APIs

## GET `/vendors`

List vendors.

------------------------------------------------------------------------

## GET `/vendors/:id`

Get vendor.

------------------------------------------------------------------------

## POST `/vendors`

Create vendor.

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

## GET `/resolutions`

List governance resolutions.

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

Get governance resolution details.

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

Create a governance resolution directly where the workflow permits it.

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

The resolution becomes the historical container for the rules used by that
decision.

------------------------------------------------------------------------

## PATCH `/resolutions/:resolutionId`

Update a resolution only while it remains editable.

Once voting has opened, the core resolution content and voting
configuration must not be silently changed.

If a material change is required before voting opens, the system must record
the change in the audit history.

------------------------------------------------------------------------

## POST `/resolutions/:resolutionId/open-voting`

Open voting for the resolution.

Before opening voting, the backend must validate:

-   Resolution exists
-   Resolution is in an openable state
-   Required meeting information exists
-   Voting method is configured
-   Voting eligibility rules are configured
-   Voting period is valid
-   Required proposal/project information is complete

------------------------------------------------------------------------

## POST `/resolutions/:resolutionId/close-voting`

Close voting.

After voting is closed:

-   New votes must not be accepted.
-   Existing votes must remain immutable.
-   The result must be calculated according to the configured governance
    rules.

------------------------------------------------------------------------

## POST `/resolutions/:resolutionId/finalize-result`

Finalize the calculated governance result after the resolution's voting
conditions have been satisfied.

The backend calculates the result from recorded votes, quorum, majority and
other stored resolution rules. The client cannot submit the final result.

------------------------------------------------------------------------

# 23. GOVERNANCE VOTING APIs

## GET `/resolutions/:resolutionId/eligibility`

Check whether the current authenticated user is eligible to participate
in the resolution.

The response should indicate eligibility without exposing information
that the user is not permitted to see.

The Eligibility Service evaluates the user's membership and the resolution's
configured eligibility rule. Owning multiple flats does not automatically
produce multiple votes.

When voting opens, the backend should persist the effective eligibility
basis/snapshot needed to reproduce the historical decision.

------------------------------------------------------------------------

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
        ↓
Calculate/update result
        ↓
Create blockchain proof/transaction if applicable
        ↓
Record blockchain status
        ↓
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

Governance voting may use the configured method:

``` text
SHOW_OF_HANDS
BALLOT
POLL
```

depending on the applicable governance procedure.

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId/voting-status`

Return the current user's permitted voting status and the resolution's
current voting state.

Possible information:

``` text
resolutionStatus
votingMethod
votingStart
votingEnd
userEligible
userHasVoted
votingOpen
```

The endpoint must not expose another participant's individual vote
unless the configured governance procedure explicitly permits that
information.

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId/result`

Return the calculated governance result when the current user is
permitted to view it.

Example:

``` text
{
  "totalEligible": 40,
  "totalVotes": 32,
  "yesCount": 22,
  "noCount": 8,
  "abstainCount": 2,
  "quorumMet": true,
  "passed": true
}
```

The result must be calculated from recorded GovernanceVote records and
the configured governance rules.

No authorized user should manually enter or overwrite the final result.

------------------------------------------------------------------------

## GET `/resolutions/:resolutionId/blockchain-status`

Return blockchain status for the resolution's applicable governance
records.

Possible statuses:

``` text
PENDING
CONFIRMED
FAILED
```

The response may include:

``` text
transactionHash
blockchainRecordId
confirmedAt
```

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

List published notices. Filters:

    category
    priority
    status

------------------------------------------------------------------------

## GET `/notices/:id`

Get notice.

------------------------------------------------------------------------

## POST `/notices`

Create notice. Allowed:

-   Society Manager
-   Authorized Committee Member where configured

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

Upload file. The backend shall:

-   Validate file type
-   Validate size
-   Store file
-   Generate hash
-   Store metadata

------------------------------------------------------------------------

## GET `/evidence/:id`

Return permitted evidence.

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

Version 1.7 — Active Planning Document.

Revised to align with SRS v1.6, Business Rules v1.7, Architecture v1.6 and
Database v1.7. The API now explicitly supports the membership/eligibility
layer, versioned governance configuration, approval re-evaluation,
meeting/quorum workflows, governance-result finalization and retry-safe
critical operations.

The API is the contract between the frontend and backend. No AI coding
agent should invent or silently change API behavior.
