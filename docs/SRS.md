# Software Requirements Specification

**Document:** `SRS.md`\
**Version:** 1.5\
**Status:** Active Planning Specification\
**Project:** Nivaas --- Blockchain-Based Apartment Society
Governance System

------------------------------------------------------------------------

# 1. PURPOSE

This document defines what the Nivaas software must provide.

It translates the approved business rules into functional and
non-functional software requirements.

Each requirement has an ID so that it can later be traced to:

-   Database design
-   API
-   Frontend
-   Smart contracts
-   Tests
-   Demonstration

The SRS describes software behavior. Legal and society-specific
governance rules are represented through configurable rules where
appropriate.

------------------------------------------------------------------------

# 2. SYSTEM OBJECTIVE

The system shall provide a web-based platform for apartment society
governance, transparency and operations.

It shall support:

-   User authentication
-   Role-based access
-   Society management
-   Buildings and flats
-   Ownership and society membership
-   Resident/occupancy information
-   Committee management
-   Annual budgeting
-   Expenses
-   Maintenance payments
-   Projects
-   Quotations
-   Quotation revisions
-   Configurable approval workflows
-   AGM
-   SGM
-   Meeting quorum
-   Governance resolutions
-   Voting
-   Complaints
-   Notices
-   Evidence/photos
-   Project progress
-   Audit history
-   Blockchain-backed records
-   Blockchain verification

------------------------------------------------------------------------

# 3. USER AND GOVERNANCE ROLES

## FR-ROLE-001

The system shall support the following primary application roles:

``` text
SYSTEM_ADMIN
SOCIETY_MANAGER
COMMITTEE_MEMBER
OWNER_MEMBER
RESIDENT
```

`SYSTEM_ADMIN` is a platform-wide technical role, not a society-scoped
account. It may act across societies only through administrative APIs that
explicitly permit the operation. It does not make its holder a society
member or confer ownership, residence, committee membership, governance
eligibility, or governance authority. Society-scoped roles use their
persisted society association for resource isolation.

## FR-ROLE-002

The application shall distinguish an application role from society
membership status.

A person's:

-   application role
-   ownership relationship
-   residence/occupancy
-   society membership
-   governance eligibility

shall not be treated as the same attribute.

## FR-ROLE-003

The system shall allow governance eligibility to be determined from
society membership and applicable governance rules rather than simply
from residence.

------------------------------------------------------------------------

# 4. AUTHENTICATION REQUIREMENTS

## FR-AUTH-001

The system shall allow registered users to log in.

## FR-AUTH-002

The system shall reject invalid credentials.

## FR-AUTH-003

The system shall maintain a user session after successful login.

## FR-AUTH-004

The system shall prevent unauthenticated users from accessing protected
application pages.

## FR-AUTH-005

The system shall support logout.

## FR-AUTH-006

The system shall associate a user account with its application role.

## FR-AUTH-007

The system shall support wallet addresses for users participating in
blockchain functionality.

------------------------------------------------------------------------

# 5. AUTHORIZATION REQUIREMENTS

## FR-AUTHZ-001

The backend shall enforce role-based authorization.

Platform-wide administrative scope and society-scoped access shall be
separate authorization capabilities. Cross-society access shall be granted
only where the applicable API explicitly permits platform administration;
it shall not be a hidden exception in generic society-isolation checks.

## FR-AUTHZ-002

The frontend shall display functionality relevant to the user's role and
permissions.

## FR-AUTHZ-003

Hiding a button shall not be considered sufficient authorization.

## FR-AUTHZ-004

Unauthorized API requests shall be rejected by the backend.

## FR-AUTHZ-005

Users shall not be able to change their own application role unless
explicitly permitted by the administrative workflow.

## FR-AUTHZ-006

The system shall prevent technical administrative permissions from
bypassing governance requirements.

`SYSTEM_ADMIN` technical scope shall not grant society governance authority
or alter governance history.

------------------------------------------------------------------------

# 6. SOCIETY MANAGEMENT AND CONFIGURATION

## FR-SOC-001

The system shall allow authorized administrators to create a society.

## FR-SOC-002

The system shall store society information.

## FR-SOC-003

The system shall support configurable society and governance settings.

## FR-SOC-004

The system shall store the configured project approval threshold/rule.

## FR-SOC-005

The initial prototype configuration shall use:

``` text
Amount ≤ ₹1,00,000
→ Committee approval path

Amount > ₹1,00,000
→ General Body / SGM approval path
```

This is a configurable prototype rule, not a hard-coded universal legal
requirement.

## FR-SOC-006

The system shall allow authorized administrators to change permitted
configurable governance rules.

## FR-SOC-007

Configurable rules may include:

-   project approval threshold
-   approval decision body
-   voting method
-   majority rule
-   quorum rule
-   notice period
-   financial visibility
-   complaint reopening workflow
-   project completion authority
-   procurement/tender requirements

## FR-SOC-008

Changes to governance configuration shall create an audit record.

## FR-SOC-009

Historical governance decisions shall retain the rule configuration that
was applied when the decision occurred.

------------------------------------------------------------------------

# 7. BUILDINGS AND FLATS

## FR-BUILD-001

The system shall allow authorized users to create buildings.

## FR-BUILD-002

The system shall allow authorized users to create flats.

## FR-BUILD-003

Each flat shall belong to a building.

## FR-BUILD-004

Each building shall belong to a society.

## FR-BUILD-005

A flat may have one or more ownership/member relationships.

## FR-BUILD-006

The system shall store occupancy information where required.

## FR-BUILD-007

The system shall distinguish ownership from society membership.

------------------------------------------------------------------------

# 8. MEMBERSHIP AND OWNERSHIP

## FR-MEMBER-001

The system shall maintain society membership records separately from
user accounts and flat ownership records.

## FR-MEMBER-002

A membership record shall be associated with the relevant society and
member.

## FR-MEMBER-003

The system shall support membership status/type information where
required for governance eligibility.

Examples may include:

-   Member
-   Joint Member
-   Associate Member
-   Provisional Member
-   Other configured status

## FR-MEMBER-004

The system shall support joint-member ordering/status where applicable.

## FR-MEMBER-005

The system shall not automatically grant additional General Body votes
merely because a person owns multiple flats.

## FR-MEMBER-006

The system shall not automatically grant General Body voting rights to a
resident/occupant who is not an eligible society member.

## FR-MEMBER-007

The backend shall determine membership-based governance eligibility for
each applicable resolution.

------------------------------------------------------------------------

# 9. USER MANAGEMENT

## FR-USER-001

The System Administrator shall be able to create user accounts.

## FR-USER-002

The System Administrator shall be able to assign application roles.

## FR-USER-003

The System Administrator shall be able to disable accounts.

## FR-USER-004

The system shall maintain an audit record of important role and
permission changes.

## FR-USER-005

When the System Administrator creates an account, the request shall not
accept a permanent password or `passwordHash`. A newly created account
shall enter `PENDING_SETUP`. User account status shall have exactly these
values: `PENDING_SETUP`, `ACTIVE`, and `DISABLED`. The permitted lifecycle
transitions are `PENDING_SETUP` to `ACTIVE`, `PENDING_SETUP` to `DISABLED`,
`ACTIVE` to `DISABLED`, and `DISABLED` to `ACTIVE`.

## FR-USER-006

The backend shall generate a single-use account-setup credential that
allows the user to establish their own password. The credential shall not
be reusable after successful consumption or invalidation. The administrator
shall never receive or set the user's permanent password. The existing
authentication/password-hashing mechanism shall be used when the user
establishes the password.

## FR-USER-007

Account setup shall remain separate from ownership, residence/occupancy,
society membership, committee membership, and governance/voting eligibility.
Credential delivery is implementation-specific and is not defined by the
core user API.

## FR-USER-008

`PATCH /users/:id` shall permit updates only to `name`, `email`, `phone`,
and `walletAddress`. It shall not permit modification of `_id`, `societyId`,
`role`, `status`, `passwordHash`, `createdAt`, or `updatedAt`. Role and
status changes shall use their dedicated endpoints; password changes shall
not use this endpoint.

## FR-USER-009

The backend shall prevent two user accounts from using the same login
email. An email change shall not itself change role, society, membership,
ownership, residence/occupancy, committee membership, or governance
eligibility. Editing `walletAddress` shall not grant governance or voting
rights. Email verification, reauthentication, password reset, and
notification behavior are not defined by this requirement.

## FR-USER-010

An account in `PENDING_SETUP` shall not authenticate with a normal password
or access protected application APIs. It may use only the future account-
setup mechanism once that API is specified, and shall become `ACTIVE` only
after successful account setup.

## FR-USER-011

A `DISABLED` account shall not authenticate or access protected application
APIs. Persisted `User.status` shall be authoritative; possession of a JWT
shall not override `PENDING_SETUP` or `DISABLED` status.

## FR-USER-012

Only `SYSTEM_ADMIN` shall administer account status. A System Administrator
shall not disable their own account or the last `ACTIVE` System
Administrator account. Status changes shall not themselves grant or revoke
society membership, ownership, residence/occupancy, committee membership,
or governance/voting eligibility. Disabling an account shall not delete the
User or associated historical/domain relationships. No account status
values beyond those defined in FR-USER-005 are permitted.

------------------------------------------------------------------------

# 10. COMMITTEE MANAGEMENT

## FR-COMMITTEE-001

The system shall allow authorized users to create a committee record.

## FR-COMMITTEE-002

The system shall allow authorized users to add committee members.

## FR-COMMITTEE-003

The system shall record committee member positions.

## FR-COMMITTEE-004

The system shall track committee membership periods.

## FR-COMMITTEE-005

Inactive committee members shall not automatically retain active
committee permissions.

## FR-COMMITTEE-006

The system shall support committee decision participation separately
from General Body voting.

## FR-COMMITTEE-007

The system shall support conflict-of-interest recording for committee
decisions.

## FR-COMMITTEE-008

Where a committee member is excluded from a decision because of a
recorded conflict of interest, the system shall prevent that member from
participating in that decision and shall preserve the exclusion in the
audit history.

------------------------------------------------------------------------

# 11. ANNUAL BUDGET

## FR-BUDGET-001

The system shall allow an authorized Society Manager to prepare an
annual budget.

## FR-BUDGET-002

A budget shall be associated with a financial year.

## FR-BUDGET-003

The prototype financial year shall follow:

``` text
1 April → 31 March
```

## FR-BUDGET-004

A budget shall contain multiple categories.

## FR-BUDGET-005

The system shall support categories including:

-   Security
-   Housekeeping
-   Water tankers
-   Repairs and maintenance
-   Gardening
-   Pest control
-   Tank cleaning
-   Sewerage cleaning
-   Parking-area cleaning
-   Managerial
-   Administrative
-   Training
-   Maintenance
-   Other

## FR-BUDGET-006

The system shall allow additional categories.

## FR-BUDGET-007

Each category shall have an allocated amount.

## FR-BUDGET-008

The system shall calculate spending against each category.

## FR-BUDGET-009

The system shall calculate remaining budget.

## FR-BUDGET-010

The system shall support budget approval through the applicable General
Body/AGM governance process.

## FR-BUDGET-011

The Manager shall not be able to manually mark the budget as approved
without the applicable governance decision.

## FR-BUDGET-012

The system shall support budget versions or auditable revisions.

## FR-BUDGET-013

The system shall display budget overruns.

## FR-BUDGET-014

The system shall not silently increase an allocated budget to hide an
overrun.

## FR-BUDGET-015

The system shall not assume that a particular budget-overrun percentage
automatically requires an SGM unless such a rule is configured.

## FR-BUDGET-016

Budget status shall be visible only to users permitted by the society's
financial-visibility rules.

------------------------------------------------------------------------

# 12. EXPENSE MANAGEMENT

## FR-EXP-001

Authorized users shall be able to record expenses.

## FR-EXP-002

An expense may be linked to a budget category.

## FR-EXP-003

An expense may be linked to a project.

## FR-EXP-004

An expense may be linked to a vendor.

## FR-EXP-005

The system shall update applicable budget spending when an expense is
recorded.

## FR-EXP-006

The system shall display budget overruns.

## FR-EXP-007

The system shall not silently modify historical expense records.

------------------------------------------------------------------------

# 13. PROJECT MANAGEMENT

## FR-PROJECT-001

Authorized users shall be able to create project proposals.

## FR-PROJECT-002

A project shall contain a title.

## FR-PROJECT-003

A project shall contain a description.

## FR-PROJECT-004

A project shall contain a category.

## FR-PROJECT-005

A project shall contain an estimated cost.

## FR-PROJECT-006

The system shall record who proposed the project.

## FR-PROJECT-007

The system shall maintain a controlled project status.

## FR-PROJECT-008

The system shall prevent invalid project state transitions.

## FR-PROJECT-009

The system shall support project states including:

``` text
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

Not every project must use every state.

------------------------------------------------------------------------

# 14. APPROVAL ENGINE

## FR-APPROVAL-001

The system shall evaluate a project's required cost against the
configured approval rules.

## FR-APPROVAL-002

The approval engine shall use the configured rule rather than
hard-coding ₹1,00,000 throughout the application.

## FR-APPROVAL-003

The initial prototype configuration shall identify:

``` text
≤ ₹1,00,000 → Committee approval path
> ₹1,00,000 → General Body / SGM approval path
```

## FR-APPROVAL-004

The approval engine shall be able to return at least:

``` text
COMMITTEE_APPROVAL
GENERAL_BODY_APPROVAL
SGM_REQUIRED
RE_APPROVAL_REQUIRED
ADDITIONAL_APPROVAL_REQUIRED
NOT_READY_FOR_APPROVAL
```

## FR-APPROVAL-005

The system shall not allow an authorized Manager or System Administrator
to bypass a required governance approval.

## FR-APPROVAL-006

The system shall re-evaluate approval requirements when the relevant
project cost changes.

## FR-APPROVAL-007

The approval engine shall be implemented separately from the frontend.

## FR-APPROVAL-008

The same approval rules shall apply regardless of whether a request
originates from the frontend, API, or another future interface.

## FR-APPROVAL-009

The approval engine shall record the rule/configuration used for each
approval evaluation.

------------------------------------------------------------------------

# 15. COMMITTEE APPROVAL

## FR-COMMITTEE-APPROVAL-001

The system shall identify projects requiring committee approval.

## FR-COMMITTEE-APPROVAL-002

Only eligible active committee members shall participate in committee
decisions.

## FR-COMMITTEE-APPROVAL-003

The system shall support recording committee decisions/votes where
applicable.

## FR-COMMITTEE-APPROVAL-004

The system shall calculate committee results according to the configured
majority rule.

## FR-COMMITTEE-APPROVAL-005

The result shall not be manually editable.

## FR-COMMITTEE-APPROVAL-006

The system shall account for applicable committee conflict-of-interest
exclusions when determining eligible participants.

------------------------------------------------------------------------

# 16. AGM

## FR-AGM-001

The system shall support AGM records.

## FR-AGM-002

An AGM shall contain meeting details.

## FR-AGM-003

An AGM shall support an agenda.

## FR-AGM-004

An AGM shall support an annual budget reference.

## FR-AGM-005

An AGM shall support supporting documents.

## FR-AGM-006

An AGM shall support attendance records.

## FR-AGM-007

An AGM shall support quorum calculation/status where applicable.

## FR-AGM-008

An AGM shall support governance resolutions and decisions.

## FR-AGM-009

The system shall preserve AGM history.

------------------------------------------------------------------------

# 17. SGM

## FR-SGM-001

The system shall allow an authorized Society Manager to create an SGM.

## FR-SGM-002

An SGM shall be linked to the relevant project/proposal where
applicable.

## FR-SGM-003

An SGM shall contain an agenda.

## FR-SGM-004

An SGM shall contain meeting information.

## FR-SGM-005

The system shall allow an official notice to be associated with the SGM.

## FR-SGM-006

The system shall record attendance/eligible members.

## FR-SGM-007

The system shall calculate or record applicable quorum.

## FR-SGM-008

The system shall allow eligible members to participate in applicable
governance voting.

## FR-SGM-009

The system shall store governance resolutions and their results.

## FR-SGM-010

The system shall preserve SGM decision history.

## FR-SGM-011

The system shall record the date/time the official SGM notice was
issued.

## FR-SGM-012

The system shall validate the configured notice-period requirement
before the meeting is treated as properly notified.

## FR-SGM-013

The system shall support recording an SGM requisition where the MVP
workflow requires it.

------------------------------------------------------------------------

# 18. MEETING QUORUM

## FR-QUORUM-001

The system shall support quorum rules for applicable General Body
meetings.

## FR-QUORUM-002

The initial prototype General Body quorum rule shall support:

``` text
2/3 of total members
OR
20 members

whichever is lower
```

## FR-QUORUM-003

The quorum rule shall be configurable for special meeting types where
applicable.

## FR-QUORUM-004

The system shall calculate and display:

-   total eligible members
-   required quorum
-   members present
-   quorum status

## FR-QUORUM-005

If a meeting is adjourned, the system shall preserve the original
meeting record and associate the adjourned meeting with it.

------------------------------------------------------------------------

# 19. PROPOSALS AND GOVERNANCE RESOLUTIONS

## FR-PROPOSAL-001

The system shall support proposals related to projects and governance
decisions.

## FR-PROPOSAL-002

A proposal shall contain:

-   Title
-   Description
-   Amount where applicable
-   Proposal type
-   Approval type
-   Status

## FR-PROPOSAL-003

A proposal may be associated with a meeting.

## FR-PROPOSAL-004

A proposal may be associated with a governance resolution.

## FR-PROPOSAL-005

A governance resolution shall identify:

-   resolution type
-   title
-   description
-   related meeting
-   related project/proposal where applicable
-   voting method
-   majority rule
-   quorum rule
-   eligibility rule
-   voting period where applicable
-   status
-   result

------------------------------------------------------------------------

# 20. VOTING

## FR-VOTE-001

The system shall identify eligible voters for each governance
resolution.

## FR-VOTE-002

The backend shall prevent ineligible users from voting.

## FR-VOTE-003

For applicable General Body decisions, the system shall implement
one-member-one-vote unless a specifically configured rule requires
otherwise.

## FR-VOTE-004

The system shall not assign additional General Body votes solely because
a person owns multiple flats.

## FR-VOTE-005

The system shall not treat physical residence as a substitute for
society membership eligibility.

## FR-VOTE-006

The system shall prevent duplicate votes where only one vote is
permitted.

## FR-VOTE-007

The system shall record each accepted digital vote.

## FR-VOTE-008

For individually recorded digital votes, the system shall record the
eligible voter and time of voting.

## FR-VOTE-009

The system shall calculate the final result.

## FR-VOTE-010

The final result shall not be manually editable.

## FR-VOTE-011

The system shall support the following governance voting methods:

``` text
SHOW_OF_HANDS
DIGITAL_VOTE
```

## FR-VOTE-012

For `SHOW_OF_HANDS`, the system shall record the meeting decision/result
and relevant meeting/attendance information rather than pretending that
a secret individual ballot was cast.

## FR-VOTE-013

The voting method, eligibility rule, majority rule and quorum rule shall
be stored with the governance resolution.

## FR-VOTE-014

The system shall support blockchain-backed records for applicable
governance results/votes.

## FR-VOTE-015

The system shall not expose a secret-election voter-to-candidate
relationship.

------------------------------------------------------------------------

# 21. ELECTIONS --- FUTURE MODULE

## FR-ELECTION-001

Secret-ballot committee elections are outside the semester MVP.

## FR-ELECTION-002

The architecture shall allow future election functionality to separate:

``` text
Voter eligibility/authentication
        ↓
Anonymous ballot
        ↓
Result
```

## FR-ELECTION-003

A future secret-ballot election shall not expose a public or directly
queryable:

``` text
voterId → candidateChoice
```

relationship.

------------------------------------------------------------------------

# 22. QUOTATIONS

## FR-QUOTE-001

The system shall allow authorized users to upload quotations.

## FR-QUOTE-002

A quotation shall be linked to a project.

## FR-QUOTE-003

A quotation shall identify its vendor.

## FR-QUOTE-004

A quotation shall contain an amount.

## FR-QUOTE-005

The system shall assign a version number to quotations.

## FR-QUOTE-006

The system shall preserve previous quotation versions.

## FR-QUOTE-007

The system shall display quotation history.

## FR-QUOTE-008

The system shall record the rule/approval state applicable to the
quotation version where required for auditability.

------------------------------------------------------------------------

# 23. QUOTATION REVISIONS

## FR-REVISION-001

The system shall allow an authorized user to create a quotation Change
Request.

## FR-REVISION-002

A Change Request shall contain the previous amount.

## FR-REVISION-003

A Change Request shall contain the additional amount.

## FR-REVISION-004

A Change Request shall contain the new amount.

## FR-REVISION-005

A Change Request shall contain a reason.

## FR-REVISION-006

A Change Request may contain supporting evidence.

## FR-REVISION-007

The system shall create a new quotation version after an accepted
revision.

## FR-REVISION-008

The previous quotation shall remain accessible.

## FR-REVISION-009

The system shall re-evaluate approval requirements after a cost change.

## FR-REVISION-010

If a cost change causes the applicable approval rule to change, the
project shall enter the required re-approval workflow before continuing
as fully approved.

------------------------------------------------------------------------

# 24. PROCUREMENT AND VENDOR MANAGEMENT

## FR-VENDOR-001

The system shall allow authorized users to create vendors.

## FR-VENDOR-002

The system shall store vendor contact information.

## FR-VENDOR-003

A project may be linked to a vendor.

## FR-VENDOR-004

A quotation shall be linked to a vendor.

## FR-VENDOR-005

The system shall allow authorized users to view a vendor's associated
projects and quotations.

## FR-VENDOR-006

The MVP shall not require vendors to have application login accounts.

## FR-VENDOR-007

The system shall support configurable procurement/tender requirements
without assuming a universal quotation-count threshold.

------------------------------------------------------------------------

# 25. PROJECT PROGRESS

## FR-PROGRESS-001

The system shall support project progress updates.

## FR-PROGRESS-002

Each progress update shall contain a timestamp.

## FR-PROGRESS-003

Each progress update shall identify its creator.

## FR-PROGRESS-004

Each progress update shall contain a description.

## FR-PROGRESS-005

Progress updates may contain photographs.

## FR-PROGRESS-006

Progress updates may contain documents.

## FR-PROGRESS-007

The system shall display progress updates chronologically.

## FR-PROGRESS-008

The system shall record project completion information, including who
performed the completion action and when.

------------------------------------------------------------------------

# 26. PROJECT PHOTOGRAPHS AND EVIDENCE

## FR-PHOTO-001

The system shall allow authorized users to upload project photographs.

## FR-PHOTO-002

The system shall support before photographs.

## FR-PHOTO-003

The system shall support progress photographs.

## FR-PHOTO-004

The system shall support completion photographs.

## FR-PHOTO-005

Each photograph shall be associated with its project or project update.

## FR-PHOTO-006

The system shall record who uploaded the photograph.

## FR-PHOTO-007

The system shall record upload time.

## FR-EVIDENCE-001

The system shall support evidence files.

## FR-EVIDENCE-002

Evidence may include:

-   Photos
-   PDFs
-   Quotations
-   Invoices
-   Meeting documents
-   Completion documents

## FR-EVIDENCE-003

The system shall record the uploader.

## FR-EVIDENCE-004

The system shall record the related entity.

## FR-EVIDENCE-005

The system should generate/store a cryptographic file hash where
appropriate.

------------------------------------------------------------------------

# 27. COMPLAINTS

## FR-COMPLAINT-001

Owners/Residents shall be able to create complaints.

## FR-COMPLAINT-002

A complaint shall contain a title.

## FR-COMPLAINT-003

A complaint shall contain a description.

## FR-COMPLAINT-004

A complaint shall contain a category.

## FR-COMPLAINT-005

A complaint shall support priority.

## FR-COMPLAINT-006

A complaint shall support evidence/photos.

## FR-COMPLAINT-007

The system shall maintain a complaint status.

------------------------------------------------------------------------

# 28. COMPLAINT WORKFLOW

## FR-COMPLAINT-008

The complaint workflow shall support:

``` text
OPEN
ACKNOWLEDGED
ASSIGNED
IN_PROGRESS
RESOLVED
CLOSED
REOPENED
```

## FR-COMPLAINT-009

Authorized Society Managers shall be able to acknowledge complaints.

## FR-COMPLAINT-010

Authorized Society Managers shall be able to assign complaints.

## FR-COMPLAINT-011

Authorized Society Managers shall be able to update progress.

## FR-COMPLAINT-012

Authorized Society Managers shall be able to mark complaints resolved.

## FR-COMPLAINT-013

The system shall allow resident confirmation of resolution where the
feature is enabled.

## FR-COMPLAINT-014

The system shall support reopening where the configured workflow allows
it.

## FR-COMPLAINT-015

The system shall preserve the complaint status history.

------------------------------------------------------------------------

# 29. COMPLAINT PHOTOGRAPHS

## FR-COMPLAINT-PHOTO-001

Residents shall be able to upload photographs showing the original
issue.

## FR-COMPLAINT-PHOTO-002

Authorized staff shall be able to upload repair-progress photographs.

## FR-COMPLAINT-PHOTO-003

Authorized staff shall be able to upload resolution photographs.

## FR-COMPLAINT-PHOTO-004

The system shall display these photographs in the complaint timeline.

------------------------------------------------------------------------

# 30. NOTICE BOARD

## FR-NOTICE-001

The system shall provide a dedicated digital Notice Board.

## FR-NOTICE-002

The Notice Board shall be treated as a digital society communication
channel and shall not automatically be considered a replacement for any
physical/statutory notice requirement.

## FR-NOTICE-003

Authorized Society Managers shall be able to create notices.

## FR-NOTICE-004

Managers shall be able to publish notices.

## FR-NOTICE-005

Published notices shall be visible to their intended audience.

## FR-NOTICE-006

The Notice Board shall support categories.

## FR-NOTICE-007

The Notice Board shall support priority.

## FR-NOTICE-008

Notices may contain attachments.

## FR-NOTICE-009

Notices may be linked to meetings.

## FR-NOTICE-010

Notices may be linked to projects.

## FR-NOTICE-011

Users shall be able to search/filter notices.

------------------------------------------------------------------------

# 31. NOTICE CATEGORIES

The system shall support:

``` text
AGM
SGM
MAINTENANCE
EMERGENCY
WATER
SECURITY
REPAIRS
GENERAL
OTHER
```

------------------------------------------------------------------------

# 32. MAINTENANCE PAYMENTS

## FR-PAYMENT-001

Owners/Residents shall be able to view applicable maintenance charges.

## FR-PAYMENT-002

A maintenance charge shall identify the relevant flat.

## FR-PAYMENT-003

A maintenance charge shall identify the billing period.

## FR-PAYMENT-004

A maintenance charge shall have an amount.

## FR-PAYMENT-005

The system shall display payment status.

## FR-PAYMENT-006

The system shall support wallet-based payment where configured.

## FR-PAYMENT-007

The system shall store the blockchain transaction hash where applicable.

------------------------------------------------------------------------

# 33. PAYMENT HISTORY

## FR-PAYMENT-008

Users shall be able to view their payment history.

## FR-PAYMENT-009

Successful blockchain payments shall have a transaction reference.

## FR-PAYMENT-010

Payment history shall not be silently overwritten.

------------------------------------------------------------------------

# 34. AUDIT LOGGING

## FR-AUDIT-001

The system shall maintain an audit trail of important system actions.

## FR-AUDIT-002

Audit entries shall identify the user responsible for an action.

## FR-AUDIT-003

Audit entries shall identify the affected entity.

## FR-AUDIT-004

Audit entries shall include timestamps.

## FR-AUDIT-005

Important audit records shall be protected from silent modification.

## FR-AUDIT-006

The system shall support blockchain transaction references in audit
records.

## FR-AUDIT-007

Governance configuration changes shall be auditable.

------------------------------------------------------------------------

# 35. DASHBOARD REQUIREMENTS

## FR-DASH-001 --- Resident/Owner Dashboard

The dashboard shall display, according to the user's permissions:

-   Maintenance due
-   Payment status
-   Important notices
-   Active proposals
-   Voting deadlines
-   Open complaints
-   Major projects
-   Recent activity

## FR-DASH-002 --- Society Manager Dashboard

The Manager dashboard shall display:

-   Pending actions
-   Projects
-   Pending approvals
-   Complaints
-   Notices
-   Budget status
-   Expenses
-   Meetings
-   Quotations
-   Change Requests

## FR-DASH-003 --- Committee Dashboard

The Committee dashboard shall display:

-   Pending approvals
-   Projects
-   Quotations
-   Committee decisions
-   Meetings
-   Budget review
-   Complaints
-   Project progress

## FR-DASH-004 --- System Admin Dashboard

The System Admin dashboard shall display:

-   Users
-   Societies
-   Buildings
-   Flats
-   Governance configuration
-   System audit information

------------------------------------------------------------------------

# 36. PROJECT DETAILS PAGE

## FR-UI-PROJECT-001

The Project Details page shall display:

-   Project name
-   Description
-   Category
-   Current status
-   Estimated cost
-   Approved cost
-   Final cost
-   Approval type
-   Vendor

It shall also display:

-   Approval History
-   Governance Resolution
-   Quotation History
-   Change Requests
-   Progress Timeline
-   Photos
-   Documents
-   Financial Information according to permissions
-   Audit History
-   Blockchain verification/status where applicable

------------------------------------------------------------------------

# 37. COMPLAINT DETAILS PAGE

## FR-UI-COMPLAINT-001

The Complaint Details page shall display:

-   Title
-   Category
-   Priority
-   Status
-   Description
-   Assigned person
-   Timeline
-   Photos
-   Evidence
-   Updates

------------------------------------------------------------------------

# 38. NOTICE DETAILS

## FR-UI-NOTICE-001

The Notice Details page shall display:

-   Title
-   Description
-   Category
-   Priority
-   Date
-   Publisher
-   Attachments
-   Related meeting/project where applicable

------------------------------------------------------------------------

# 39. BUDGET TRANSPARENCY

## FR-TRANSPARENCY-001

Authorized members shall be able to view approved budget information
where permitted.

## FR-TRANSPARENCY-002

The system shall display:

-   Allocated amount
-   Spent amount
-   Remaining amount

## FR-TRANSPARENCY-003

Members shall be able to view permitted project financial information.

## FR-TRANSPARENCY-004

The system shall apply the configured financial-visibility rules before
displaying financial information.

------------------------------------------------------------------------

# 40. BLOCKCHAIN REQUIREMENTS

## FR-BLOCK-001

The system shall support a blockchain network for selected governance
and financial operations.

## FR-BLOCK-002

The system shall support wallet connection.

## FR-BLOCK-003

The system shall display relevant blockchain transaction status.

## FR-BLOCK-004

The system shall store relevant transaction hashes in the application
database.

## FR-BLOCK-005

The system shall allow users to verify relevant blockchain-backed
records.

## FR-BLOCK-006

The system shall not require all application data to be stored on
blockchain.

## FR-BLOCK-007

Blockchain-backed records shall represent selected trust-critical events
rather than replacing the application database.

## FR-BLOCK-008

The system shall distinguish between:

-   application record
-   blockchain submission
-   blockchain confirmation
-   blockchain verification

------------------------------------------------------------------------

# 41. BLOCKCHAIN VOTING / GOVERNANCE RECORDS

## FR-BLOCK-VOTE-001

The system shall submit applicable governance records to the smart
contract according to the blockchain design.

## FR-BLOCK-VOTE-002

The system shall wait for blockchain transaction confirmation where
required.

## FR-BLOCK-VOTE-003

The system shall associate the blockchain transaction with the
corresponding application governance record.

## FR-BLOCK-VOTE-004

The system shall handle failed blockchain transactions without falsely
marking the governance record as blockchain-confirmed.

## FR-BLOCK-VOTE-005

The system shall not put a secret-election voter-to-candidate
relationship into a publicly traceable blockchain record.

------------------------------------------------------------------------

# 42. BLOCKCHAIN APPROVALS AND AUDIT REFERENCES

## FR-BLOCK-APPROVAL-001

Important governance approvals should have blockchain-backed records or
verifiable blockchain references where applicable.

## FR-BLOCK-APPROVAL-002

The application shall associate an approval record with its blockchain
transaction/reference.

## FR-BLOCK-APPROVAL-003

The system shall not claim an approval is blockchain-confirmed before
confirmation is received.

## FR-BLOCK-APPROVAL-004

Blockchain verification shall allow a user to compare the application
record/reference with the corresponding on-chain record.

------------------------------------------------------------------------

# 43. FILE STORAGE

## FR-FILE-001

The system shall store uploaded files outside the blockchain.

## FR-FILE-002

The system shall store metadata about uploaded files.

## FR-FILE-003

The system shall record uploader and upload timestamp.

## FR-FILE-004

The system should generate/store a cryptographic hash for important
files.

## FR-FILE-005

The system shall validate permitted file types.

## FR-FILE-006

The system shall enforce reasonable file-size limits.

------------------------------------------------------------------------

# 44. NOTIFICATION REQUIREMENTS

## FR-NOTIFY-001

The system should notify relevant users about important events.

Potential notifications include:

-   New notice
-   New SGM
-   Voting opened
-   Voting deadline
-   Project approval
-   Project update
-   Quotation revision
-   Complaint update
-   Maintenance due
-   Payment confirmation

## FR-NOTIFY-002

The initial implementation may use in-app notifications.

External channels such as email/SMS/push may be added later.

------------------------------------------------------------------------

# 45. SEARCH AND FILTERING

## FR-SEARCH-001

The Notice Board shall support searching.

## FR-SEARCH-002

The Notice Board shall support filtering by category.

## FR-SEARCH-003

Projects shall support filtering by status.

## FR-SEARCH-004

Complaints shall support filtering by status.

## FR-SEARCH-005

Quotations shall be searchable within their associated project.

## FR-SEARCH-006

The project list shall support filtering by approval state where
applicable.

------------------------------------------------------------------------

# 46. SECURITY REQUIREMENTS

## NFR-SEC-001

Passwords shall never be stored in plain text.

## NFR-SEC-002

Private blockchain keys shall never be stored in source code.

## NFR-SEC-003

Sensitive credentials shall be stored using environment configuration.

## NFR-SEC-004

Backend endpoints shall validate authorization.

## NFR-SEC-005

User input shall be validated.

## NFR-SEC-006

Smart contracts shall enforce their own relevant access controls.

## NFR-SEC-007

The system shall prevent duplicate voting.

## NFR-SEC-008

The system shall not provide a general-purpose administrative override
that bypasses governance.

------------------------------------------------------------------------

# 47. DATA INTEGRITY

## NFR-DATA-001

Important historical records shall not be silently overwritten.

## NFR-DATA-002

Quotation revisions shall preserve previous versions.

## NFR-DATA-003

Voting records shall preserve the original accepted vote.

## NFR-DATA-004

Payment records shall preserve transaction history.

## NFR-DATA-005

Audit records shall preserve historical actions.

## NFR-DATA-006

Governance configuration changes shall preserve historical rule context.

------------------------------------------------------------------------

# 48. USABILITY

## NFR-UX-001

The interface shall be understandable to a normal apartment resident.

## NFR-UX-002

The application shall avoid unnecessary technical blockchain
terminology.

## NFR-UX-003

Important actions shall provide clear confirmation messages.

## NFR-UX-004

Errors shall explain what went wrong in understandable language.

## NFR-UX-005

The dashboard shall prioritize important actions and information.

------------------------------------------------------------------------

# 49. PERFORMANCE

## NFR-PERF-001

Normal database operations should not require blockchain confirmation
unless blockchain functionality is specifically required.

## NFR-PERF-002

Large files should not be stored directly in the database when
avoidable.

## NFR-PERF-003

Blockchain operations should display a pending state while confirmation
is occurring.

------------------------------------------------------------------------

# 50. RELIABILITY

## NFR-REL-001

A failed blockchain transaction must not be represented as successful.

## NFR-REL-002

A failed database operation must not leave the application in an invalid
state.

## NFR-REL-003

The system shall handle temporary blockchain unavailability.

## NFR-REL-004

Blockchain-dependent actions may remain pending until confirmation.

## NFR-REL-005

If blockchain confirmation fails after the application has created an
off-chain governance record, the record shall remain clearly marked as
pending/failed rather than being falsely treated as confirmed.

------------------------------------------------------------------------

# 51. FUTURE EXTENSIBILITY

## NFR-EXT-001

The architecture shall allow additional modules to be added.

Potential future modules include:

-   Elections
-   Parking
-   Visitor management
-   Vendor marketplace
-   Mobile app
-   Analytics
-   AI-assisted features
-   Multi-society management

## NFR-EXT-002

Adding a future module should not require rewriting unrelated existing
modules.

------------------------------------------------------------------------

# 52. PRIMARY USER JOURNEYS

## USER JOURNEY 1 --- Maintenance

``` text
Login
 ↓
Dashboard
 ↓
Maintenance Due
 ↓
Payment
 ↓
Wallet
 ↓
Blockchain Transaction
 ↓
Confirmation
 ↓
Receipt
```

## USER JOURNEY 2 --- Configurable Small Project

Example using the initial prototype configuration:

``` text
Manager
 ↓
Create Project
 ↓
Quotation
 ↓
₹80,000
 ↓
Approval Engine
 ↓
Committee Approval
 ↓
Work
 ↓
Progress Photos
 ↓
Final Invoice
 ↓
Payment
 ↓
Closed
```

The ₹80,000 amount is an example. The actual approval path is determined
by the configured rule.

## USER JOURNEY 3 --- Configurable Large Project

Example using the initial prototype configuration:

``` text
Manager
 ↓
Create Project
 ↓
Quotation
 ↓
₹3,50,000
 ↓
Approval Engine
 ↓
SGM / General Body Required
 ↓
SGM Created
 ↓
Notice Published
 ↓
Eligible Members Participate
 ↓
Governance Result
 ↓
Blockchain Record
 ↓
Approved
 ↓
Work
 ↓
Photos
 ↓
Invoice
 ↓
Payment
 ↓
Audit
```

## USER JOURNEY 4 --- Quotation Revision

``` text
Project
 ↓
Quotation V1
₹2,00,000
 ↓
Change Request
+₹30,000
 ↓
Quotation V2
₹2,30,000
 ↓
Approval Re-evaluation
 ↓
Required Approval
 ↓
Re-approval if required
 ↓
Continue Work
```

## USER JOURNEY 5 --- Complaint

``` text
Resident
 ↓
Complaint
 ↓
Photo
 ↓
Manager
 ↓
Assign
 ↓
In Progress
 ↓
Repair Photo
 ↓
Resolved
 ↓
Resident Confirmation
 ↓
Closed / Reopened
```

## USER JOURNEY 6 --- Annual Budget

``` text
Manager
 ↓
Prepare Annual Budget
 ↓
AGM
 ↓
General Body Decision
 ↓
Approved Budget
 ↓
Expenses
 ↓
Budget Tracking
 ↓
Transparency
```

------------------------------------------------------------------------

# 53. DEMONSTRATION REQUIREMENTS

The final system shall be capable of demonstrating at least one complete
project lifecycle.

Recommended demonstration:

``` text
Project:
Lift Modernization

Amount:
₹3,50,000
```

The demonstration should show:

1.  Project creation
2.  Quotation
3.  Approval Engine
4.  Configured approval requirement
5.  Notice
6.  Eligible member participation
7.  Governance result
8.  Blockchain transaction/reference
9.  Approval
10. Work progress
11. Progress photographs
12. Quotation revision
13. Re-evaluation
14. Completion
15. Final invoice
16. Payment
17. Audit history

The demonstration should also show that changing the configured
threshold changes the approval path without rewriting the workflow.

------------------------------------------------------------------------

# 54. REQUIREMENT TRACEABILITY

Every major requirement should eventually map to:

``` text
Requirement
 ↓
Business Rule
 ↓
Database Entity
 ↓
API Endpoint
 ↓
Frontend Page
 ↓
Smart Contract (if applicable)
 ↓
Test
 ↓
Demo
```

Example:

``` text
FR-REVISION-007
        ↓
ChangeRequest
Quotation
        ↓
POST /change-requests
        ↓
Quotation Details UI
        ↓
Blockchain reference if applicable
        ↓
Quotation Revision Test
        ↓
Demo: ₹2L → ₹2.3L
```

For governance:

``` text
FR-VOTE-001
        ↓
Membership + GovernanceResolution
        ↓
Voting API
        ↓
Voting UI
        ↓
Smart Contract / Blockchain Reference
        ↓
Eligibility + Duplicate Vote Test
        ↓
Demo
```

------------------------------------------------------------------------

# 55. OUT-OF-SCOPE FOR INITIAL VERSION

The following are not required for the initial semester implementation:

-   Full banking system
-   Cryptocurrency/token system
-   Complete legal compliance engine
-   Property buying/selling
-   Full accounting software
-   Full visitor-management system
-   Full parking-management system
-   Mobile application
-   AI as a central feature
-   Multi-country governance
-   Large-scale enterprise deployment
-   Full secret-ballot election system

These exclusions do not prevent the architecture from supporting the
features later.

------------------------------------------------------------------------

# 56. DEFINITION OF A COMPLETE SYSTEM

The initial system is considered functionally complete when a user can
successfully demonstrate:

``` text
User Login
 ↓
Society Data
 ↓
Membership
 ↓
Budget
 ↓
Project
 ↓
Quotation
 ↓
Configurable Approval Engine
 ↓
Meeting / Governance Decision
 ↓
Blockchain Record
 ↓
Work Progress
 ↓
Evidence
 ↓
Quotation Revision
 ↓
Re-evaluation
 ↓
Payment
 ↓
Audit History
```

and separately:

``` text
Resident
 ↓
Complaint
 ↓
Photo
 ↓
Manager
 ↓
Repair
 ↓
Progress Photo
 ↓
Resolution
 ↓
Resident Confirmation
```

and:

``` text
Manager
 ↓
Notice
 ↓
Notice Board
 ↓
Resident / Member
```

and:

``` text
Membership
 ↓
Eligibility Check
 ↓
Governance Resolution
 ↓
Voting Method
 ↓
Result
 ↓
Blockchain Verification
```

------------------------------------------------------------------------

# 57. SRS STATUS

**Version:** 1.5\
**Status:** Active Planning Specification

This version incorporates the current approved business-rule decisions
and the governance research used during planning.

The SRS must be updated whenever an approved business-rule change
affects software behavior.

No major implementation should intentionally contradict this document.
