# Business Rules Specification

**Version:** 1.11 
**Status:** Active — Planning Baseline
**Planning Document** --- Revised Governance, Voting & Approval Rules 
**Project:** Blockchain-Based Apartment Society Governance System

# 1. PURPOSE

This document defines the business rules that govern how Nivaas
operates. These rules describe:

- Who can perform actions
- What approvals are required
- How projects move through their lifecycle
- How budgets work
- How quotations are handled
- How quotation changes are handled
- How AGM and SGM processes work
- How voting works
- How complaints work
- How notices work
- How project and repair evidence is handled
- How historical records are protected

These rules are independent of the programming language, database,
frontend framework, or blockchain implementation. The application must
enforce these rules regardless of which interface is used.

### Academic Prototype / Legal Scope

Nivaas is an academic prototype inspired by cooperative housing
society governance workflows. Approval, voting, quorum, eligibility,
election, and related governance rules are configurable and must be
aligned with the applicable society bye-laws and current legal
requirements before any real-world deployment.
The rules in this document represent the project's current prototype
assumptions unless explicitly marked as TBC or configurable.

---

# 2. CORE PRINCIPLE

Nivaas is based on the following principle:

> **A user should only be able to perform an action when their role,**
> **permission, the current state of the record, and the applicable**
> **Society rules allow that action.**

Therefore:

```
Role
+
Permission
+
Current State
+
Business Rule
=
Allowed / Rejected Action
```

---

# 3. SOCIETY STRUCTURE

The system models an apartment society containing:

- Buildings
- Flats
- Owners
- Residents
- Committee Members
- Society Manager/Secretary
- Society-level budgets
- Projects
- Expenses
- Meetings
- Notices
- Complaints
- Vendors

A single society may contain multiple buildings and flats. The
architecture should also allow support for multiple societies in the
future.

---

# 4. USER ROLES

The system has five primary roles.

## BR-ROLE-001 --- System Administrator

The System Administrator manages the software/platform and has a
platform-wide technical scope. The role is not a society-scoped account or
society membership. The System Administrator may, through administrative
APIs that explicitly permit the operation:

- Create/manage society records across the platform
- Manage buildings and flats across the platform
- Manage user accounts across the platform
- Assign roles
- Administer user account status under the User Account Status Policy
- Configure platform-level system settings
- View system-level audit records
- Resolve technical/system issues

The other primary application roles are society-scoped and use their
persisted society association for access isolation. Their application role
does not replace ownership, residence, membership, committee membership,
or governance-eligibility records.

`SYSTEM_ADMIN` is platform-wide and may have a null `societyId`. Every
society-scoped role requires a non-null society association. A platform
administrator is not made a society member or given governance rights by
the platform role or by user administration.

The `SYSTEM_ADMIN` role alone does not grant society membership, ownership,
residence, committee membership, governance eligibility, or authority to
change a society's governance-rule version. Authority to change
governance-rule versions remains unresolved as recorded in
`IMPLEMENTATION_DECISIONS.md`.

The System Administrator must not have the ability to:

- Change an owner's vote
- Change a completed voting result
- Fabricate an approval
- Change an approved quotation without a revision
- Modify historical payment records
- Approve a project that requires society approval
- Bypass an SGM requirement
- Delete important governance history

## User Creation and Initial Credential

When the System Administrator creates a user account, the administrator
must not provide or receive the user's permanent password. The account
enters pending setup, and the backend generates a single-use account-setup
credential for the user to establish their own password. The credential
cannot be reused after successful consumption or expiry. The existing
authentication/password-hashing mechanism is used when the user establishes
the password. A `PENDING_SETUP` User has no password hash until successful
setup establishes one.

Credential delivery is implementation-specific; no delivery provider or
service is mandated by this business rule. Account setup is distinct from
ownership, residence/occupancy, society membership, committee membership,
and governance/voting eligibility. Account status values and permitted
lifecycle transitions are defined in the User Account Status Policy below.

A Society Manager may create pending `OWNER_MEMBER`, `RESIDENT`, and
`COMMITTEE_MEMBER` accounts only for the manager's persisted active society.
This does not permit platform-wide account management, assignment of
`SYSTEM_ADMIN` or another `SOCIETY_MANAGER`, or reassignment of an account
from another society. The same one-time setup credential rules apply. In the
current local MVP, manager-created accounts are available only when the
isolated loopback setup-delivery configuration is enabled; no production
credential-delivery provider is implemented, so the backend rejects account
creation before persistence when that secure delivery path is unavailable.
Creating an application role does not create a Membership, Ownership,
Residence, CommitteeMember, or governance-eligibility record.

Password requirements beyond the 8-character minimum, the setup-credential
hash algorithm, forgot-password behavior, and credential retention/cleanup
remain unspecified. Audit requirements for setup are limited to the
mandatory successful User status-transition event described below; separate
credential-generation, credential-consumption, and failed-attempt events
are not required.

Initial account setup is completed through `POST /auth/setup` as defined in
`API.md`. The setup credential is 32 cryptographically random bytes in
URL-safe base64 form. Only its cryptographic hash is stored, with its
intended User, and it expires 24 hours after generation. It is single-use;
invalid, expired, consumed/replayed credentials and ineligible account
statuses receive the same generic 401 response. The setup request accepts
the credential and a new password of at least 8 characters. Passwords use
the existing scrypt hashing mechanism. Credential delivery remains
implementation-specific; no provider is selected. Credential regeneration
or resend is outside the initial setup flow and is a future administration
capability. Expiry does not itself change User status; an expired account
remains `PENDING_SETUP` pending a permitted status transition or future
credential reissue.

Successful setup atomically stores the password hash, consumes the
credential, transitions `PENDING_SETUP` to `ACTIVE`, and creates the
mandatory AuditLog event for that successful status transition. Credential
generation, consumption by itself, and failed setup attempts do not create
separate AuditLog events under the current rules.

## User Account Status Policy

The only User account status values are:

- `PENDING_SETUP`
- `ACTIVE`
- `DISABLED`

The permitted lifecycle transitions are:

```text
PENDING_SETUP -> ACTIVE
PENDING_SETUP -> DISABLED
ACTIVE -> DISABLED
DISABLED (entered from ACTIVE) -> ACTIVE
DISABLED (entered from PENDING_SETUP) -> PENDING_SETUP
```

`PENDING_SETUP` identifies a newly created account whose user has not
completed account/password setup. It cannot authenticate with a normal
password or access protected application APIs. It may use `POST /auth/setup`
to complete initial setup, and becomes `ACTIVE` only after
successful account setup.

Reactivating an account disabled from `ACTIVE` restores `ACTIVE`. Reactivating
an account disabled from `PENDING_SETUP` restores `PENDING_SETUP`; it remains
unable to authenticate or access protected APIs until setup succeeds. Every
successful status transition is audited. The transition event's
`previousState.status` and `newState.status` record the status values needed
to preserve this lifecycle; no additional User status is introduced.
The setup credential is unusable while the User is `DISABLED`. Whether
disabling a pending account also invalidates its still-unexpired setup
credential, and whether reactivation therefore requires a newly issued
credential, remains unresolved.

`DISABLED` accounts cannot authenticate or access protected application
APIs. A JWT does not override the persisted account status. Only
`SYSTEM_ADMIN` may administer account status. A System Administrator
cannot disable their own account or disable the last `ACTIVE`
`SYSTEM_ADMIN` account.

A status change does not itself grant or revoke society membership,
ownership, residence/occupancy, committee membership, or governance/voting
eligibility. Disabling an account does not delete the User or historical
or domain relationships associated with that User. No additional account
status values are permitted.

## User Profile and Account-Information Updates

`PATCH /users/:id` is limited to profile/account-information updates. The
only editable fields are `name`, `email`, `phone`, and `walletAddress`.
Changing role, status, password, or society association through this
endpoint is not permitted; the dedicated role and status endpoints are used
for their respective changes. Identifiers and system-managed timestamps
are not client-controlled.

Login email is an account identity and must remain unique across user
accounts. Changing it does not itself change a user's role, society,
membership, ownership, residence/occupancy, committee membership, or
governance eligibility. Editing a wallet address does not grant governance
or voting rights. Email verification, reauthentication, password reset, and
notification behavior are not defined by this rule.

## User Account Read Access

The generic `GET /users` endpoint is a platform-wide administrative listing
available only to `SYSTEM_ADMIN`. Society-scoped roles do not use this
generic endpoint. User-related information needed in a society workflow is
provided through purpose-specific endpoints or permitted resource APIs.

For `GET /users/:id`, `SYSTEM_ADMIN` may retrieve a user across the
platform. `SOCIETY_MANAGER` and `COMMITTEE_MEMBER` may retrieve permitted
user profiles belonging to their society. `OWNER_MEMBER` and `RESIDENT` may
retrieve only their own profile through this endpoint. Society-scoped roles
cannot retrieve profiles belonging to another society. These account/profile
permissions do not establish ownership, residence, membership, committee
membership, or governance/voting eligibility.

User list/profile API representations are limited to the User fields
specified as safe in `API.md`. Password hashes, passwords, setup
credentials/tokens, JWTs, secrets, and internal authentication material
must not be returned. User API responses must not expose raw database
documents.

---

# 5. SOCIETY MANAGER / SECRETARY

## BR-ROLE-002

The Society Manager/Secretary is responsible for day-to-day operation of
the society system. The Society Manager may:

- Manage routine society operations
- Create maintenance charges
- Record routine expenses
- Create project proposals
- Upload quotations
- Manage quotation revisions
- Create meetings
- Create AGM/SGM records
- Publish notices
- Manage complaints
- Assign complaints
- Update complaint progress
- Update project progress
- Upload project evidence
- Upload repair evidence
- Upload supporting documents
- Record invoices
- Submit projects for approval
- Manage vendors
- Onboard pending owner, resident, and committee-member accounts within the
  manager's own active society, subject to the secure account-setup flow
- Create separate membership, ownership, and residence records through the
  authorized society APIs
- Record authorized operational activities

The Society Manager cannot bypass governance requirements. Example:

```
Project = ₹2,50,000

System:
SGM REQUIRED

Manager:
Cannot directly approve.
```

---

# 6. COMMITTEE MEMBER

## BR-ROLE-003

Committee Members participate in committee-level decision making. They
may:

- Review projects
- Review quotations
- Compare quotations
- Review budgets
- Review expenses
- Participate in committee meetings
- Vote on applicable committee decisions
- Review project progress
- Review complaints where authorized

They may not:

- Modify another person's vote
- Manually change a voting result
- Bypass the approval workflow
- Approve an SGM-required project without the required process
- Overwrite quotation history

---

# 7. OWNER

## BR-ROLE-004

**Owner Member** is the application role used for a user who is both an owner and an eligible society member. Ownership and membership are separate records; owning a flat does not by itself create unlimited voting rights.

Owner Members are the primary society governance participants. Owners may:

- View society information permitted to owners
- View notices
- View approved budgets
- View projects
- View quotations
- View project progress
- View public financial information
- Pay maintenance
- Raise complaints
- View complaint progress
- Participate in eligible votes
- View their voting history
- View public audit history

Voting eligibility must follow the society's confirmed governance rules.

For the current MVP's read-only transparency APIs, `OWNER_MEMBER` access to
projects, quotations, vendor comparison labels, approval records, approved
budgets, public audit events, and proof status requires a persisted, currently
active Ownership relationship for the same society. Ownership is checked
independently of Residence and Membership. An owner who has ended residence
or tenancy but retains active ownership keeps this read access; ending
Ownership (or its effective date range) revokes it. Application role alone is
insufficient, and this read access grants no operational write permission.

Residents may view published notices, use the supported complaint workflow,
and discover project summaries. A resident/tenant does not receive quotations,
vendor details, financial records, audit history, or proof access from
occupancy or application role alone. Expanding that visibility requires an
explicit product decision. Voting eligibility remains governed by separate
Membership and governance-evidence rules; neither Ownership nor Residence is
sufficient by itself.

---

# 8. RESIDENT

## BR-ROLE-005

Residents may:

- View permitted notices
- View permitted society information
- Raise complaints
- Track complaints
- Upload complaint evidence
- View permitted project information
- Make applicable payments

Residents who are not eligible society members do not automatically receive governance voting rights. Voting eligibility is determined by the membership/eligibility rules for the specific resolution.

---

# 9. APPROVAL THRESHOLD

## BR-APPROVAL-001

Nivaas uses a **configurable project-approval policy** rather than a
hard-coded legal threshold.

For the semester prototype, the initial configured policy is:

- **Amount ≤ ₹1,00,000:** committee approval process
- **Amount > ₹1,00,000:** SGM/general-body approval process, subject to the
  configured governance rule

This ₹1,00,000 value is a **prototype configuration**, not a claim that every
Maharashtra cooperative housing society is legally governed by the same
threshold. The applicable society bye-laws and current legal requirements must
determine the production configuration.

The threshold/policy configuration must be versioned. A later configuration
change must not retroactively change the rule that was applied to a historical
decision.

## BR-APPROVAL-002 — Exact Threshold Boundary

The initial prototype interprets the configured boundary as:

```text
₹1,00,000
→ Committee process

₹1,00,000.01
→ General-body/SGM process
```

The boundary itself must be stored in configuration and evaluated centrally.
Project creation, quotation revisions, change requests, and re-approval must
all use the same Approval Engine.

## BR-APPROVAL-003 — Approval Engine

Every project must pass through the Approval Engine before approval.

The Approval Engine evaluates at minimum:

- Project amount
- Applicable budget/funding source
- Current project state
- Configured approval policy
- Required decision body
- Existing approvals
- Meeting/resolution requirements
- Whether the amount has changed
- Whether a quotation revision invalidates an earlier approval
- Whether additional approval is required

Possible results include:

```text
COMMITTEE_APPROVAL
GENERAL_BODY_APPROVAL
SGM_REQUIRED
RE_APPROVAL_REQUIRED
ADDITIONAL_APPROVAL_REQUIRED
NOT_READY_FOR_APPROVAL
```

The frontend must never be the authority that decides the approval route.

## BR-APPROVAL-004 — Approval Rule Snapshot

When an approval decision is created, the system must record the effective
rule/configuration used to reach that decision, including the configured
threshold/policy version.

Later configuration changes must not rewrite the historical decision.

## BR-APPROVAL-005 — No Governance Bypass

A project cannot become APPROVED merely because a user has administrative
permissions. The required governance process must be completed and recorded.

# 12. ANNUAL BUDGET

## BR-BUDGET-001

The society prepares an annual budget through the AGM process. The prototype
uses an accounting year of **1 April to 31 March**. The
annual budget may contain categories including:

- Maintenance
- Water tankers
- Repairs and maintenance
- Housekeeping
- Security
- Managerial expenses
- Administrative expenses
- Training
- Sewerage cleaning
- Tank cleaning
- Pest control
- Gardening
- Parking-area cleaning
- Other society expenses

Additional categories must be supported.

---

# 13. BUDGET CATEGORIES

## BR-BUDGET-002

Each budget category contains:

- Allocated amount
- Amount spent
- Remaining amount
- Related expenses

The system calculates:

```
Remaining Amount
=
Allocated Amount - Amount Spent
```

---

# 14. ANNUAL BUDGET APPROVAL

## BR-BUDGET-003

The annual budget is prepared before/during the AGM and is approved
through the applicable AGM decision process. The Society Manager may
prepare the budget. The Manager cannot falsely mark the budget as
approved. The final approval must come through the applicable governance
process. The exact voting/majority mechanism is **TBC**.

---

# 15. ROUTINE EXPENSES

## BR-EXPENSE-001

Routine expenses can be associated with an approved annual budget
category. Example:

```
Security Budget:
₹12,00,000

Security Expense:
₹1,00,000

Remaining:
₹11,00,000
```

The system should track cumulative spending.

---

# 16. BUDGET OVERRUN

## BR-EXPENSE-002

If spending exceeds the allocated amount, the system must clearly
indicate the overrun. The system must not silently increase the budget
to hide the overrun. The exact approval process for increasing an annual
budget is **TBC**.

---

# 17. NEW PROJECT

## BR-PROJECT-001

A new project must contain at minimum:

- Project title
- Description
- Category
- Estimated cost
- Proposer
- Date
- Current status

A project may subsequently contain:

- Quotations
- Vendor
- Meeting
- Proposal
- Votes
- Expenses
- Progress updates
- Photos
- Documents
- Change requests
- Final invoice
- Payment

---

# 18. PROJECT APPROVAL

## BR-PROJECT-002

A project cannot enter the approved state until the required approval
has occurred. The required approval is determined by the Approval
Engine.

---

# 19. PROJECT STATES

## BR-PROJECT-003

The project uses controlled states:

```
DRAFT
SUBMITTED
UNDER_REVIEW
QUOTATION_ADDED
APPROVAL_REQUIRED
COMMITTEE_APPROVAL
GENERAL_BODY_APPROVAL
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
```

Not every project will use every state.

---

# 20. STATE TRANSITIONS

## BR-PROJECT-004

A user cannot arbitrarily select any project state. Every transition
must be validated. Example:

```
SGM_REQUIRED
→
APPROVED
```

is only allowed after the required SGM decision has passed. A Society
Manager cannot manually force this transition.

---

# 21. PROJECT CREATION

## BR-PROJECT-005

Authorized Society Managers and authorized Committee Members may create
project proposals. Owners/Residents may be allowed to submit project
requests in a future or configurable workflow.

---

# 22. PROJECT PROGRESS

## BR-PROJECT-006

Authorized operational users may add project progress updates. A
progress update contains:

- Project
- Status/milestone
- Title
- Description
- Date/time
- User who created it
- Supporting evidence

---

# 23. PROJECT PHOTOGRAPHS

## BR-EVIDENCE-001

Projects must support photographs. Photographs may represent:

- Before condition
- Work in progress
- Milestone completion
- Final condition

Photos must be associated with a specific project or project update.

---

# 24. PROJECT EVIDENCE

## BR-EVIDENCE-002

Projects may contain:

- Photos
- Quotations
- Revised quotations
- Invoices
- Meeting documents
- Completion documents
- Other supporting files

Every evidence record must contain:

- Uploader
- Timestamp
- Related entity
- File reference
- File hash where applicable

---

# 25. PROJECT COMPLETION

## BR-PROJECT-007

A project should not simply become CLOSED because a user clicks
"Complete". The completion workflow should support:

- Completion description
- Completion evidence
- Completion photographs
- Final invoice
- Final cost
- Applicable payment
- Final audit entry

The exact requirement for committee confirmation of completion is
**TBC**.

---

# 26. QUOTATIONS

## BR-QUOTE-001

A project may contain one or more quotations. Each quotation must have a
version. Example:

```
Quotation V1
₹2,00,000
```

---

# 27. QUOTATION IMMUTABILITY

## BR-QUOTE-002

An approved quotation must not be silently overwritten. If the amount or
important terms change:

```
Change Request
      ↓
Quotation V2
```

must be created.

---

# 28. QUOTATION VERSIONING

## BR-QUOTE-003

Each quotation version contains:

- Version number
- Amount
- Vendor
- Description
- Document
- Submission date
- Submitted by
- Status
- Previous quotation reference

---

# 29. CHANGE REQUEST

## BR-QUOTE-004

A quotation change must create a Change Request. The Change Request
contains:

- Original amount
- Additional amount
- New amount
- Reason
- Supporting evidence
- Requester
- Date
- Approval requirement
- Status

---

# 30. CHANGE REQUEST APPROVAL

## BR-QUOTE-005

A change request must be evaluated according to the applicable approval
rules.
The system must evaluate the **new total amount**, not only the original
approved amount.
Example:

```
Original approved amount:
₹90,000

Additional amount:
₹20,000

New total amount:
₹1,10,000
```

The system must recognize that the new total amount exceeds the
configured ₹1,00,000 prototype threshold.
The quotation must not be silently changed. The system must:

```
Original quotation
      ↓
Change Request
      ↓
New quotation/version
      ↓
Recalculate approval requirement
      ↓
RE_APPROVAL
      ↓
Required approval process
```

Submitting a change request for the currently selected quotation creates a
new approval evaluation for the persisted new total and moves the project
to `RE_APPROVAL` in the same transaction. Earlier approval evaluations and
their rule snapshots remain historical records and are not overwritten.
Selecting a quotation only establishes the current quotation relationship;
it does not establish final project approval.

If a different quotation is selected after an approval evaluation exists,
the prior evaluations remain historical but are marked `INVALIDATED`, and
the newly selected quotation is evaluated again in the same transaction.
The project enters `RE_APPROVAL`; selection never grants final approval.

For the example above:

```
₹90,000 approved
      ↓
+ ₹20,000 change request
      ↓
₹1,10,000 new total
      ↓
Approval requirement recalculated
      ↓
RE_APPROVAL
      ↓
Appropriate approval process
```

A project must not remain considered fully approved merely because its
original amount was below the threshold.
Whether crossing the threshold automatically requires another SGM, and
whether any additional conditions apply, must be confirmed with the
faculty/society before final smart-contract implementation. Until
confirmed, the application must treat the new amount as requiring
re-evaluation and must not silently preserve the previous approval.

---



---

# 31. QUOTATION HISTORY

## BR-QUOTE-006

All previous quotation versions must remain accessible to authorized
users. The system should clearly show:

```
V1 → V2 → V3
```

and explain why each revision occurred.

---

# 32. MEMBERSHIP AND GOVERNANCE ELIGIBILITY

## BR-GOV-001 — Membership Is Separate From Ownership and Residence

A User, Flat Ownership record, Residence/Occupancy record, and Society
Membership record are separate concepts.

The system must not infer governance eligibility from residence alone.

## BR-GOV-002 — One-Member-One-Vote Baseline

For ordinary governance resolutions, the prototype uses a **one eligible
member, one vote** baseline.

Owning multiple flats does not automatically grant multiple votes.

Any different voting weight must be explicitly configured for the applicable
resolution type and must not be inferred from the number of flats owned.

## BR-GOV-003 — Joint / Associate / Provisional Membership

The membership model must be capable of representing:

- Primary/joint member ordering
- Associate membership
- Provisional membership
- Membership status

Eligibility must be calculated from the membership record and the applicable
governance rule rather than from a flat's owner list alone.

## BR-GOV-004 — Defaulter Status Is Not Automatically Vote Deletion

Financial default status must be stored separately from governance eligibility.
The application must not automatically remove all voting rights merely because
a person has a payment/default status.

If applicable rules restrict participation for a specific decision, that
restriction must be represented explicitly in the resolution eligibility
policy.

## BR-GOV-005 — No Proxy Voting in MVP

The semester MVP does not support proxy/letter-of-authority voting. A user
cannot cast a governance vote on behalf of another member through the normal
application workflow.

## BR-GOV-006 — Committee Conflict of Interest

Where a committee member has a direct or indirect interest in a matter, the
system must be able to record the conflict and prevent that person from
participating in the affected committee decision where the applicable rule
requires exclusion.

This does not automatically remove the person's separate membership rights
for unrelated general-body matters.

## BR-GOV-007 — Eligibility Is Resolution-Specific

Before a vote opens, the backend must calculate and persist the eligibility
basis for that resolution, including the applicable membership/rule version.

A later change to a user's role or membership must not silently rewrite a
completed historical result.

---

# 33. AGM


## BR-MEETING-001

AGM represents the Annual General Meeting. The system should support:

- AGM creation
- Agenda
- Annual budget
- Supporting documents
- Meeting information
- Decision
- Meeting minutes/reference
- Audit history

---

# 34. SGM

## BR-MEETING-002

SGM represents the Special General Meeting. An SGM can be created for
projects requiring owner/general-body approval. The SGM contains:

- Meeting details
- Agenda
- Related project
- Related proposal
- Supporting quotations
- Notice
- Eligible voters
- Voting period
- Result
- Meeting record/minutes

---

# 35. SGM NOTICE

## BR-MEETING-003

An SGM should have an associated official notice. The notice must be
visible through the Notice Board to the intended audience.

## BR-MEETING-004 — Meeting Notice Validation

The system must validate the configured notice period before a governance
meeting is treated as valid for the applicable decision.

The prototype should support the reviewed baseline of:

- AGM: 14 clear days
- Ordinary SGM: 5 clear days

These values must remain configurable because the applicable bye-laws/rules
may differ for particular meeting types.

## BR-MEETING-005 — SGM Requisition

The system should support an SGM requisition workflow. The prototype may use
**one-fifth of members** as the initial requisition threshold, subject to the
applicable bye-laws and configuration.

The requisition record must preserve:

- Requesting members
- Request date
- Subject/reason
- Validation result
- Meeting created from the requisition

## BR-MEETING-006 — General-Body Quorum

For the ordinary general-body prototype, the initial quorum configuration is:

**two-thirds of the configured society-member population or 20 members,
whichever is less.** The configured population and integer rounding method
must be stored in the versioned rule policy. Nivaas's current starter selects
active primary members with valid membership records; it uses the eligible
snapshot as the denominator and rounds upward. These are configurable product
defaults, not a claim that every society's registered rules use this exact
population or formula.

Quorum must be calculated from the applicable membership population, not from
the number of flats or residents.

For the current ordinary general-body starter, a simple majority means YES
votes strictly greater than NO votes. Abstentions count toward attendance and
quorum but are excluded from the YES/NO comparison. A tie or unmet quorum
produces `NO_DECISION`; a chairperson casting vote is not enabled unless an
approved procedure is configured and recorded.

These are configurable Nivaas product defaults, not a claim of legal
compliance. Maharashtra Co-operative Societies Rules, 1961, Rule 60 describes
quorum as specified in the society's bye-laws and a majority-of-members-present
and President casting-vote procedure, subject to the Act, Rules, and bye-laws.
The product workflow must not be used as a real-society legal decision process
until the current applicable rules and that society's registered bye-laws are
verified against its configured policy.

The quorum and majority rules must be configurable and versioned. Committee
and special-resolution formulas remain separately unresolved.

### Offline recorded general-body decisions — MVP product assumption

For this milestone, general-body meeting decisions may be recorded after an
in-person meeting. Nivaas does not collect live ballots. The authenticated
Society Manager is the MVP confirming operator; this records who entered and
confirmed the result and does not establish legal authority. Attendance is
validated against the resolution's immutable eligible-member snapshot. The
record stores attendance member IDs, the method, aggregate YES/NO/ABSTAIN
counts, minutes reference, supporting-evidence references, confirmation actor
and time, and the exact policy snapshot. Recorded vote counts cannot exceed attendance; present members who do not cast a vote remain included in the quorum attendance count.
Unanimity is represented as YES equal to attendance and NO/ABSTAIN equal to
zero; attendance and counts remain recorded.

An offline result can approve a project only when the configured meeting
quorum is met, the configured majority produces APPROVED, the meeting and
rule-version/project/quotation context match, and the authenticated operator
confirms the complete record. Insufficient quorum yields NO_DECISION and
leaves the project pending. The recorded evidence is immutable. This is an
MVP product workflow, not a legal guarantee. Notice periods, eligible-member
rules, quorum, majority, chair procedure, officer authority, and admissible
minutes/evidence must be verified against the exact applicable 2026 Gazette
text and the society's registered bye-laws before real use.

### Committee project decisions — MVP product assumption

For a project routed to the committee by the effective configured approval
policy, a current active CommitteeMember appointment and active same-society
User account are both required. Each member may record one immutable
APPROVE or REJECT decision per ApprovalDecision/proposal revision. The record
includes the member, timestamp, rationale when supplied, committee, proposal
revision and applicable rule snapshot. Ownership, residence, formal
membership and application role do not establish committee appointment.

The initial configurable product defaults are quorum of two-thirds of the
active committee (rounded up) and approval by strictly more than half of
decisions cast. Quorum and majority are separate checks. Ties or a result that
does not meet the configured majority do not approve. A Society Manager may
finalize only after quorum and an unambiguous configured outcome; this
operator action cannot manufacture member decisions. These are MVP product
assumptions, not statutory thresholds or legal authority. Committee powers,
appointment evidence, decision categories, budget routing, majority and
quorum require confirmation from current applicable law and registered
bye-laws.

## BR-MEETING-007 — Adjourned Meeting

If an applicable meeting is adjourned under the configured meeting rules,
the system must preserve the original agenda, notice, attendance and
adjournment history. It must not silently create a new unrelated meeting.


---

# 36. VOTING

## BR-VOTE-001 --- Voting Types

Nivaas distinguishes between different types of voting because
they may have different procedures and secrecy requirements.
The supported voting types are:

1. **GENERAL_BODY_RESOLUTION**
2. **COMMITTEE_DECISION**
3. **ELECTION**

The voting method must be determined by the decision type and the
applicable society rules.

### A. Governance Resolution Voting

Governance resolution voting covers decisions such as:

- AGM decisions
- SGM decisions
- Project approvals
- Budget approvals
- Vendor approvals
- Quotation-related decisions
- Other society resolutions

For these decisions, the voting method is configurable according to the
applicable society bye-laws/rules and the procedure selected for the
meeting or resolution.
Possible methods include:

- Show of hands
- Poll
- Ballot

The application must not assume that every governance resolution is a
secret ballot.
The prototype must store the voting method, eligibility rule, majority rule,
quorum rule and voting period as explicit resolution configuration. The
baseline governance model is one eligible member, one vote; the applicable
resolution may override the method where the society rules require it.

### B. Committee / Election Voting

Committee election voting is a separate governance module.
Where an election requires a secret ballot, the system must preserve
ballot secrecy. The system must never expose a public or directly
queryable relationship:

```
Voter Identity
      ↓
Candidate Chosen
```

The election architecture must therefore separate voter
eligibility/authentication from the anonymous ballot and result.
Actual committee/election voting is **not part of the semester MVP**.
The semester MVP focuses on:

- Governance resolutions
- AGM/SGM decisions
- Project approvals
- Budget/vendor decisions where applicable
- Transparent and auditable governance records

Election voting may be implemented as a future module once an
appropriate anonymous-ballot architecture and applicable rules have been
confirmed.

---

# 37. DUPLICATE VOTING

## BR-VOTE-002

For governance resolution voting, the system must prevent an eligible
participant from casting more votes than permitted by the configured
voting rules.
The backend must verify:

- Voter authentication
- Voting eligibility
- Voting period
- Resolution status
- Voting method
- Whether the participant has already voted, where applicable
- Any configured voting weight or eligibility rules

For secret-ballot elections, duplicate-vote prevention must be
implemented without exposing the voter's candidate choice.
The system must not use a publicly visible `voterId → candidateChoice`
record for a secret election.

---

# 38. VOTE IMMUTABILITY

## BR-VOTE-003

Once a vote has been recorded according to the configured voting rules:

- The voter cannot simply edit it.
- An administrator cannot edit it.
- A manager cannot edit it.
- A committee member cannot edit it.

The final result must be calculated from the recorded votes or ballots.
If a correction or exceptional administrative process is ever required,
it must create a separate auditable event rather than silently modifying
the original record.

---

# 39. VOTING RESULT

## BR-VOTE-004

The system calculates the voting result according to the configured
governance rules.
No authorized user should manually type or overwrite the final
percentage/result.
The result calculation must use the recorded votes/ballots and the
configured:

- Voting method
- Eligibility rules
- Majority rule
- Voting weight, if applicable
- Quorum requirement, if applicable
- Voting period

The exact majority formula and any special voting weight remain
configurable by resolution type. They must be stored with the resolution so
the result can be reproduced and audited.
For secret-ballot elections, the system must be able to calculate and
publish the result without revealing the relationship between an
individual voter and their candidate choice.

---

# 40. BLOCKCHAIN VOTING

## BR-VOTE-005

Important governance voting records should be recorded or verifiably
represented on blockchain where appropriate.
For **governance resolutions**, the blockchain record may contain a
verifiable representation of:

- Resolution/proposal reference
- Voting result or approved outcome
- Relevant governance event
- Timestamp
- Transaction hash
- Cryptographic proof/reference

The final blockchain design will be specified in `BLOCKCHAIN.md`.
The MVP must **not** place secret election voter-to-candidate
relationships on a publicly traceable blockchain record.
For future secret-ballot elections, blockchain may be used for
verifiable election state, ballot/result integrity, or cryptographic
commitments, but the final design must preserve ballot secrecy.

---

# 41. MAINTENANCE PAYMENTS

## BR-PAYMENT-001

Residents/owners can view their maintenance dues. A maintenance record
should contain:

- Flat
- Resident/owner
- Billing period
- Amount
- Status
- Payment information

---

# 42. PAYMENT

## BR-PAYMENT-002

A user can initiate an eligible maintenance payment. The application records
the payment lifecycle and, where blockchain payment integration is used, the
corresponding blockchain transaction reference. A blockchain transaction hash
does not by itself mean that an off-chain bank/payment settlement has
successfully completed.

- Amount
- Wallet
- Transaction
- Date
- Status
- Blockchain transaction hash where applicable

---

# 43. PAYMENT HISTORY

## BR-PAYMENT-003

Residents should be able to view their previous payment history.
Important payment records should be protected from silent modification.

---

# 44. PROCUREMENT AND VENDOR RULES

## BR-PROC-001 — Vendor Records

The system may maintain vendor records containing identity, contact,
quotation/project relationships and supporting documents.

## BR-PROC-002 — Vendor Login

Vendor self-service login/upload is **not part of the semester MVP**.
Authorized society users upload and manage vendor quotations/documents.

## BR-PROC-003 — Tender / Procurement Threshold

The system must support a configurable tender/procurement requirement rather
than inventing a universal quotation count.

Where the applicable society rule requires tenders or additional quotation
procedures above a configured limit, the Approval/Procurement workflow must
enforce that requirement before the project can proceed.

# 44. COMPLAINTS

## BR-COMPLAINT-001

Owners/Residents can create complaints. A complaint may contain:

- Category
- Title
- Description
- Priority
- Photos
- Other attachments

---

# 45. COMPLAINT STATES

## BR-COMPLAINT-002

Complaints use controlled states:

```
OPEN
ACKNOWLEDGED
ASSIGNED
IN_PROGRESS
RESOLVED
CLOSED
REOPENED
```

---

# 46. COMPLAINT MANAGEMENT

## BR-COMPLAINT-003

The Society Manager may:

- Acknowledge
- Assign
- Update progress
- Add notes
- Upload evidence
- Mark resolved

Authorized staff may receive similar permissions if configured.

---

# 47. COMPLAINT EVIDENCE

## BR-COMPLAINT-004

A complaint can contain:

### Initial evidence

Uploaded by the resident.

### Work evidence

Uploaded by the Manager/authorized staff.

### Resolution evidence

Uploaded after the repair. Example:

```
Complaint
 ↓
Before Photo
 ↓
Repair Photo
 ↓
After Photo
```

---

# 48. COMPLAINT RESOLUTION

## BR-COMPLAINT-005

When the Manager marks a complaint as RESOLVED, the resident should be
given an opportunity to confirm the resolution. Possible outcome:

```
RESOLVED
   ↓
Resident confirms
   ↓
CLOSED
```

or:

```
RESOLVED
   ↓
Resident rejects
   ↓
REOPENED
```

The exact reopening authority is **TBC**.

---

# 49. NOTICE BOARD

## BR-NOTICE-001

The system must provide a dedicated Notice Board. The Notice Board is an
official society communication area.

---

# 50. NOTICE TYPES

The Notice Board supports categories including:

- AGM
- SGM
- Maintenance
- Emergency
- Water
- Security
- Repairs
- General
- Other

---

# 51. NOTICE CONTENT

A notice contains:

- Title
- Description
- Category
- Priority
- Posted by
- Published date
- Expiry date where applicable
- Attachments
- Related meeting where applicable
- Related project where applicable
- Status

---

# 52. NOTICE PERMISSIONS

## BR-NOTICE-002

The Society Manager can:

- Create notices
- Edit drafts
- Publish notices
- Schedule notices
- Attach documents
- Mark priority
- Link notices to meetings/projects

Committee members may create drafts or requests depending on configured
permissions. Owners/Residents can view published notices.
Owners/Residents cannot modify official notices.

---

# 53. AUDIT TRAIL

## BR-AUDIT-001

Important system actions must create an audit record. Examples:

- User role changes
- Important society setting changes
- Governance-rule version creation
- Important membership changes
- Material governance-resolution edits
- Applicable evidence deletions
- Project created
- Project submitted
- Quotation uploaded
- Quotation revised
- SGM created
- Vote cast
- Project approved
- Project started
- Progress updated
- Complaint created
- Complaint resolved
- Notice published
- Payment recorded

Every successful User account status transition must create an AuditLog
event, including each transition permitted by the User Account Status
Policy. This requirement does not require every user profile edit to be
audited. Failed or denied attempts are not mandatory AuditLog events under
this rule; security-event logging for those attempts remains unresolved.

---

# 54. AUDIT IMMUTABILITY

## BR-AUDIT-002

AuditLog events are append-only and immutable. An existing event must not
be edited, silently deleted, or mutated merely because later information
becomes available. If an event is incorrect, a new append-only correction
event must identify/reference the original and explain the correction; the
original event must be preserved. Where appropriate, blockchain
hashes/references provide additional verification without mutating the
existing event.

## BR-AUDIT-003 — Audit Payload, Scope, and Operational Logs

Audit state payloads contain only state relevant to the event, not
automatically complete entity snapshots. They must not contain passwords,
password hashes, account-setup credentials/tokens, JWTs, secrets, complete
personal profiles, or unnecessary sensitive personal information. Audit
events do not add actor-role, outcome, request-ID, or correlation-ID fields
unless a later specification explicitly requires them.

The audit event's `societyId` follows the target resource/action. It is the
target society for society-scoped actions and may be null for a genuinely
platform-wide action with no society target. A platform administrator's
role does not make them a society member. A cross-society administrative
action records each target society on its society-scoped event. A single
atomic action affecting multiple societies is not defined here.

AuditLog is durable business/security history for selected important
actions. Application/server logs contain operational diagnostics,
debugging, and request/runtime information; they are not authoritative
business history and do not replace AuditLog.

---

# 55. DATABASE VS BLOCKCHAIN

## BR-CHAIN-001

The system must use both off-chain and on-chain storage.

### Off-chain

Suitable for:

- Resident information
- User information
- Complaints
- Photos
- PDFs
- Notices
- Quotations
- Descriptions
- Normal application data

### Blockchain

Suitable for:

- Important votes
- Governance approvals
- Payment verification/reference
- Important audit events
- Cryptographic references/hashes

---

# 56. EVIDENCE STORAGE

## BR-CHAIN-002

Actual photographs and documents should not normally be stored directly
on blockchain. The system may:

```
File
 ↓
Off-chain storage
 ↓
Cryptographic hash
 ↓
Blockchain record/reference
```

---

# 57. ROLE SECURITY

## BR-SECURITY-001

A user's role must never be trusted solely because the frontend displays
a particular page. Permissions must also be enforced by the backend.
Blockchain-specific permissions must additionally be enforced by smart
contracts.

---

# 58. ADMINISTRATIVE OVERRIDE

## BR-SECURITY-002

There must be no general-purpose "override all rules" button. System
administrators cannot bypass governance merely because they are
administrators.

---

# 59. HISTORICAL RECORD PROTECTION

## BR-HISTORY-001

Important historical records must use append-only or update-with-history
patterns rather than destructive overwriting. AuditLog corrections use a
new event and never alter the original. This applies especially
to:

- Quotations
- Votes
- Approvals
- Payments
- Project history
- Audit records

---

# 60. FINANCIAL TRANSPARENCY

## BR-FINANCE-001

Where permitted by the society's privacy rules, residents should be able
to see relevant:

- Approved budgets
- Budget categories
- Project costs
- Approved quotations
- Project spending
- Payment status
- Final project cost

Private personal information must not be exposed unnecessarily.

---

# 61. NOTIFICATION RULES

The system should notify relevant users about important events.
Potential notifications:

- New notice
- SGM scheduled
- Voting opened
- Voting deadline approaching
- Project approved
- Project progress update
- Quotation revision
- Complaint update
- Maintenance due
- Payment successful

Exact notification channels are **TBC**.

---

# 62. FUTURE EXTENSIBILITY

The system must be designed so additional modules can be added without
rewriting the core governance system. Potential future modules:

- Society elections / secret-ballot election module
- Parking
- Visitor management
- Vendor marketplace
- Advanced analytics
- AI-assisted complaint categorization
- AI meeting-minute summarization
- Mobile application
- Multi-society support

These are not mandatory for the initial implementation.

---

# 63. CONFIGURABLE / TO-BE-CONFIRMED RULES

The following remain configurable or require confirmation for the final
prototype/legal configuration:

1. Society-specific committee decision thresholds, category authority, and statutory procedures beyond the configurable MVP product assumptions.
2. Exact majority formula for each special general-body resolution type.
3. Special-purpose quorum rules that differ from ordinary general-body
   meetings.
4. Exact eligibility restrictions for particular resolution types.
5. Joint/associate/provisional member eligibility in each applicable case.
6. Whether a quotation revision crossing the configured threshold requires a
   new SGM/general-body resolution.
7. Whether a post-approval additional expense requires a new governance
   resolution.
8. Emergency expenditure rules.
9. Annual budget revision/overrun approval route.
10. Resident confirmation/reopening authority for complaints.
11. Who can officially mark a project completed.
12. Who can upload official completion evidence.
13. Financial information visibility by role.
14. Which governance resolutions use show of hands, poll, or ballot.
15. Whether any non-election governance resolution requires anonymous voting.
16. Secret-ballot election implementation requirements if elections are added.
17. Society-specific tender/procurement thresholds.
18. Society-specific approval bodies for particular project categories.
19. Exact notification channels.

The following are **not** treated as unresolved design principles:

- Ownership of multiple flats does not automatically create multiple votes.
- Residence alone does not create governance voting rights.
- Historical votes/approvals/payments/quotations are not silently editable.
- Administrative access does not bypass governance.
- Secret election voter-to-candidate relationships must not be publicly exposed.
- The semester MVP does not implement committee elections.

# 64. GOLDEN RULE

The most important business rule in Nivaas is:

> **No user should be able to bypass the society's decision-making**
> **process simply because they have administrative access to the**
> **application.**

The application exists to enforce the process, not to replace it.

---

# 65. CORE GOVERNANCE FLOW

```
Annual Budget
      ↓
AGM
      ↓
Approved Budget
      ↓
New Project
      ↓
Quotation
      ↓
Approval Engine
      ↓
 ┌───────────────┐
 │               │
≤ ₹1 Lakh       > ₹1 Lakh
 │               │
 ↓               ↓
Committee       SGM
Approval        Required
 │               │
 └───────┬───────┘
         ↓
      Approval
         ↓
       Work
         ↓
     Evidence
         ↓
Quotation Revision?
     │          │
    No         Yes
     │          │
     │      New Version
     │          │
     │      Re-approval
     │          │
     └────┬─────┘
          ↓
     Final Invoice
          ↓
        Payment
          ↓
       Closed
          ↓
     Audit History
```

---

# 66. BUSINESS RULE STATUS

**Current status:** Planning baseline, revised to v1.10.

This version separates membership, ownership, residence and governance
eligibility; establishes the platform-wide technical scope of
`SYSTEM_ADMIN`, specifies the one-time account setup flow, permitted user
profile/account-information updates and read access, and the AuditLog
foundation; makes approval and meeting rules configurable/versioned;
defines a concrete prototype governance baseline where the reviewed rules
support it; and preserves historical decision integrity.

Any future business-rule change must first be documented here before being
implemented in code.

---

# Implementation note: project lifecycle and expense MVP

The current implementation extends the project, evidence, and expense baseline
without resolving legal or society-specific policy questions:

- Only a Society Manager can start an approved project, add progress or
  completion records, upload project photos, record expenses, or complete the
  project. This is the current product/API authorization, not a statement of
  statutory authority. Committee completion confirmation remains TBC.
- Completion requires an immutable completion description, an invoice
  reference, a private after-photo, and a final cost no greater than the
  approved project amount and no lower than recorded expenses. Invoice-file
  upload, payment reconciliation, and a completion confirmation route are not
  implemented.
- A project expense must reference an approved project, its approved budget,
  and a category in that budget. The amount must fit both the approved project
  amount remaining and budget-category allocation remaining. Expense history
  is append-only and category/budget totals update transactionally with its
  audit event.
- The backend blocks an expense that would exceed either cap. A project amount
  increase must use the existing quotation change-request and re-approval
  workflow. The annual budget/category amendment approval route remains TBC;
  until an authorized amendment is represented in the system, the expense is
  not recorded. No threshold or overrun authority is inferred here.
- Owners with a currently effective same-society Ownership record can see
  public project-progress and financial summaries. They cannot create project
  updates or expenses. Residence alone does not grant these reads. Private
  invoice references and update actor identity are withheld from owners;
  private photo downloads follow the existing evidence authorization rules.
- Audit events remain in the existing immutable AuditLog. These project and
  expense records do not trigger blockchain proofs; no sensitive project
  evidence or personal information is put on-chain.

These are implementation boundaries and product assumptions, not legal
guarantees. The applicable 2026 Gazette wording and registered society
bye-laws, financial visibility policy, budget-overrun approval process, and
completion authority must be confirmed before enabling broader policies.
