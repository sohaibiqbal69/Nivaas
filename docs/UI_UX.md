# UI_UX.md

**Document:** `UI_UX.md`  
**Version:** 1.2
**Status:** Active Planning Document — Visual System, Typography & Motion Added  
**Scope:** User interface, navigation, screens, role-based experience, workflows, states, and usability requirements

---

# 1. PURPOSE

This document defines the UI/UX structure of Nivaas.

The UI must present the governance, transparency, project, complaint, notice, budget, payment, audit, and blockchain workflows defined by the other specifications.

The UI must not invent or enforce business rules independently.

The backend remains authoritative for:

- Authentication
- Authorization
- Eligibility
- Approval requirements
- Voting state
- Project state
- Payment state
- Blockchain state

---

# 2. UI/UX PRINCIPLES

Nivaas should feel like a modern society management platform rather than a generic blockchain demo.

The interface should prioritize:

- Transparency
- Clear status
- Traceability
- Simple navigation
- Role-appropriate actions
- Historical timelines
- Clear approval requirements
- Understandable blockchain verification
- Responsive design

Blockchain should appear where it adds trust or verification value.

It should not dominate every screen.

---

# 3. ROLE-BASED EXPERIENCE

Primary roles:

```text
System Administrator
Society Manager
Committee Member
Owner
Resident
```

The UI may show different navigation and actions depending on the authenticated role.

However:

> **Role-based UI visibility is not authorization.**

The backend must independently enforce permissions.

---

# 4. GLOBAL APPLICATION LAYOUT

Recommended desktop layout:

```text
┌──────────────────────────────────────────────────────┐
│ Logo / Society Name          Search   Notifications  │
├───────────────┬──────────────────────────────────────┤
│ Dashboard     │                                      │
│ Projects      │                                      │
│ Budget        │           Main Content               │
│ Quotations    │                                      │
│ Meetings      │                                      │
│ Voting        │                                      │
│ Complaints    │                                      │
│ Notice Board  │                                      │
│ Payments      │                                      │
│ Audit Trail   │                                      │
│ Blockchain    │                                      │
│ Users/Admin   │                                      │
└───────────────┴──────────────────────────────────────┘
```

Navigation items must be filtered by role.

---

# 5. GLOBAL UI COMPONENTS

Reusable components should include:

- App shell
- Sidebar
- Top navigation
- Breadcrumbs
- Page header
- Status badge
- Role badge
- Approval status
- Blockchain status
- Timeline
- Data table
- Search
- Filters
- Pagination
- Modal
- Confirmation dialog
- Toast notification
- Empty state
- Error state
- Loading skeleton
- File uploader
- Evidence gallery
- Activity timeline
- Audit entry
- Wallet status
- Verification panel

---

# 6. STATUS DESIGN

Statuses should use consistent labels throughout the application.

Examples:

```text
DRAFT
PENDING
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
IN_PROGRESS
COMPLETED
CANCELLED
RESOLVED
CLOSED
REOPENED
```

Blockchain states:

```text
NOT_RECORDED
PENDING
CONFIRMED
FAILED
MISMATCH
```

The interface should use text plus visual indicators rather than color alone.

---

# 7. DASHBOARD

The dashboard is role-specific.

## Owner / Resident

Potential cards:

```text
Maintenance Due
Open Complaints
Recent Notices
Upcoming Meetings
Active Votes
Recent Projects
Recent Payments
```

## Committee Member

Potential cards:

```text
Pending Decisions
Projects Awaiting Review
Upcoming Meetings
Active Resolutions
Budget Status
Recent Governance Activity
```

## Society Manager

Potential cards:

```text
Projects
Pending Approvals
Quotation Changes
Open Complaints
Upcoming Meetings
Notices
Budget Utilization
Payments
```

## System Administrator

Potential cards:

```text
Users
System Health
Blockchain Status
Audit Activity
Configuration
```

The dashboard must not become a separate source of business logic.

---

# 8. PROJECTS MODULE

## Project List

Display:

- Project name
- Category
- Amount
- Current status
- Approval requirement
- Approval status
- Vendor
- Progress
- Last update
- Blockchain verification status where applicable

Filters:

```text
Status
Category
Amount
Approval Type
Date
```

---

# 9. PROJECT CREATION

Project creation form may include:

- Project title
- Description
- Category
- Estimated amount
- Budget category
- Reason
- Expected timeline
- Supporting documents
- Initial quotation where available

After submission:

```text
Draft
 ↓
Submitted
 ↓
Approval Engine
 ↓
Committee / SGM / Other required workflow
```

The UI should display the backend's calculated approval requirement.

---

# 10. PROJECT DETAIL PAGE

The project detail page is a major transparency screen.

Recommended structure:

```text
Project Header
       ↓
Status / Approval
       ↓
Summary
       ↓
Quotation
       ↓
Approval
       ↓
Meetings / Resolutions
       ↓
Progress
       ↓
Evidence
       ↓
Invoices / Payments
       ↓
Audit Timeline
       ↓
Blockchain Verification
```

---

# 11. PROJECT STATUS TIMELINE

Example:

```text
✓ Created
│
✓ Submitted
│
✓ Quotation Added
│
✓ SGM Required
│
✓ SGM Conducted
│
✓ Approved
│
● Work In Progress
│
○ Completion
│
○ Payment
│
○ Closed
```

The timeline should use actual backend state/history.

---

# 12. APPROVAL PANEL

Display:

```text
Project Amount
₹3,50,000

Effective Rule Version
<rule-version>

Required Process
<backend result>

Current Status
Approved
```

The UI must display the approval requirement returned by the Approval Engine. It must not hard-code a universal ₹1 lakh threshold or independently determine whether committee approval or another governance process is required.

The frontend displays the result returned by the Approval Engine.

It does not calculate the authoritative requirement itself.

---

# 13. QUOTATIONS MODULE

## Quotation List

Display:

- Vendor
- Version
- Amount
- Date
- Status
- Selected/not selected
- Approval status

---

# 14. QUOTATION VERSION TIMELINE

Example:

```text
Quotation V1
₹3,50,000
     │
     ▼
Change Request #1
+₹30,000
     │
     ▼
Quotation V2
₹3,80,000
     │
     ▼
Re-evaluation
     │
     ▼
Re-approval
```

The UI must make it impossible to confuse a revised quotation with the original version.

---

# 15. CHANGE REQUEST UI

Display:

```text
Original Amount     ₹3,50,000
Additional Amount   ₹30,000
New Amount          ₹3,80,000
Reason              Additional electrical work
Status              Under Review
```

The new amount must come from the backend.

The frontend must not be the authoritative calculator.

---

# 16. MEETINGS MODULE

Meeting list should display:

- Meeting type
- Date
- Status
- Related project
- Agenda
- Notice status
- Resolution status

Meeting types:

```text
AGM
SGM
COMMITTEE_MEETING
```

---

# 17. MEETING DETAIL PAGE

Recommended sections:

```text
Meeting Header
Agenda
Notice
Supporting Documents
Related Projects
Proposals
Governance Resolutions
Voting
Results
Minutes / Record
Audit History
```

---

# 18. GOVERNANCE RESOLUTION UI

A resolution page should display:

```text
Resolution Title
Resolution Type
Description
Related Project
Amount
Meeting
Voting Method
Voting Period
Eligibility
Current Status
Result
Blockchain Status
```

Possible resolution types:

```text
PROJECT_APPROVAL
BUDGET_APPROVAL
VENDOR_APPROVAL
QUOTATION_APPROVAL
OTHER
```

---

# 19. GOVERNANCE VOTING UI

The voting screen should clearly state:

```text
Resolution:
Lift Modernization Approval

Voting Method:
Configured Method

Voting Opens:
<date/time>

Voting Closes:
<date/time>

Your Eligibility:
Eligible / Not Eligible

Your Vote:
Not Yet Cast
```

For eligible users:

```text
[ YES ]
[ NO ]
[ ABSTAIN ]
```

where applicable to the configured governance method.

---

# 20. VOTE CONFIRMATION

Before submission:

```text
Confirm your vote

Resolution:
Lift Modernization Approval

Selected:
YES

Your vote cannot be edited after recording.

[Cancel]
[Confirm Vote]
```

The exact immutability message should match the applicable governance rules.

---

# 21. VOTING RESULT

After voting closes, display calculated information permitted by the governance rules:

```text
Total Eligible
Total Votes
Yes
No
Abstain
Quorum
Passed / Rejected
```

Do not allow an administrator to type the final percentage manually.

---

# 22. ELECTION BOUNDARY IN UI

Elections are not part of the semester MVP.

The UI architecture may reserve a future route/module:

```text
/elections
```

but should not implement election functionality during MVP unless the project scope is explicitly changed.

Future election UI must support secret-ballot privacy requirements and must not expose:

```text
Voter → Candidate Choice
```

for secret elections.

---

# 23. BUDGET MODULE

## Budget Dashboard

Display:

```text
Annual Budget
₹XX,XX,XXX

Spent
₹XX,XX,XXX

Remaining
₹XX,XX,XXX
```

Category table:

| Category | Allocated | Spent | Remaining |
|---|---:|---:|---:|
| Maintenance | — | — | — |
| Water Tankers | — | — | — |
| Repairs | — | — | — |
| Housekeeping | — | — | — |
| Security | — | — | — |
| Gardening | — | — | — |

Additional categories must be supported.

---

# 24. BUDGET CATEGORY DETAIL

Display:

- Allocated amount
- Spent amount
- Remaining amount
- Related expenses
- Related projects
- Audit history

---

# 25. COMPLAINTS MODULE

## Complaint List

Display:

- Complaint title
- Category
- Priority
- Status
- Created date
- Assigned person
- Last update

Filters:

```text
Status
Priority
Category
Date
```

---

# 26. CREATE COMPLAINT

Form:

```text
Category
Title
Description
Priority
Photos / Attachments
```

After submission:

```text
OPEN
```

---

# 27. COMPLAINT DETAIL

Recommended layout:

```text
Complaint Header
Description
Original Evidence
Assignment
Progress Timeline
Repair Evidence
Resolution
Resident Confirmation
Audit History
```

---

# 28. COMPLAINT TIMELINE

Example:

```text
✓ Complaint Created
│
✓ Acknowledged
│
✓ Assigned
│
✓ Work Started
│
✓ Repair Evidence Added
│
● Resolved
│
○ Resident Confirmation
│
○ Closed
```

If reopened:

```text
Closed
  ↓
Reopened
  ↓
In Progress
```

---

# 29. NOTICE BOARD

Notice Board is a required MVP module.

The main screen should show:

```text
Notice Board

[Priority Notice]
SGM — Lift Modernization

Date
Audience
Category

[View Notice]
```

Filters:

```text
Category
Priority
Date
Status
```

---

# 30. NOTICE DETAIL

Display:

- Title
- Notice type
- Date
- Published by
- Audience
- Related meeting/project
- Content
- Attachments
- Publication status

Official published notices should not be editable by ordinary owners/residents.

---

# 31. PAYMENTS MODULE

## Resident / Owner

Display:

```text
Current Maintenance Due
Payment Status
Payment History
```

Payment detail:

```text
Amount
Billing Period
Status
Payment Date
Wallet
Transaction Hash
```

---

# 32. PAYMENT STATUS

Application payment states should be distinguishable from blockchain states.

Example:

```text
Payment:
SUCCESS

Blockchain:
CONFIRMED
```

or:

```text
Payment:
PENDING

Blockchain:
PENDING
```

Do not assume that every application payment must be a blockchain transaction unless the final payment implementation specifies it.

---

# 33. EVIDENCE GALLERY

Evidence should be displayed contextually.

Project evidence:

```text
Before
Work In Progress
Completion
```

Complaint evidence:

```text
Original Issue
Repair Progress
After Repair
```

Each evidence item should show:

- Preview
- File type
- Uploaded by
- Timestamp
- Related entity
- Verification status where applicable

---

# 34. AUDIT TRAIL

The audit screen should show chronological activity.

Example:

```text
29 Sep 10:30
Project Created
by Society Manager

29 Sep 11:10
Quotation V1 Added
by Society Manager

30 Sep 09:00
SGM Created
by Society Manager

02 Oct 18:00
Governance Resolution Approved
Blockchain: Confirmed

03 Oct 09:30
Project Started
by Society Manager
```

Important historical records should not silently disappear.

---

# 35. AUDIT DETAIL

Each audit entry may show:

```text
Action
Actor
Role
Timestamp
Entity
Previous State
New State
Reason
Blockchain Reference
```

Sensitive information should only be shown to permitted users.

---

# 36. BLOCKCHAIN VERIFICATION SCREEN

A dedicated verification screen may display:

```text
Blockchain Verification

Record
Project Approval #P001

Application Status
Approved

Blockchain Status
CONFIRMED

Transaction Hash
0x....

Contract
0x....

Network
Hardhat Local

Integrity
MATCH
```

Include explanatory text:

> Blockchain verification confirms that the application committed the displayed reference/proof to the blockchain. It does not independently prove that the underlying real-world event was truthful.

---

# 37. WALLET UI

When a wallet is required:

```text
Wallet

Not Connected
[Connect MetaMask]
```

Connected:

```text
Wallet Connected
0x1234...ABCD
```

The UI should never request or display a private key or seed phrase.

---

# 38. BLOCKCHAIN TRANSACTION UI

During a transaction:

```text
Preparing
   ↓
Waiting for wallet
   ↓
Submitted
   ↓
Confirming
   ↓
Confirmed
```

Failure:

```text
Transaction Failed
Reason:
<readable message>

[Retry]
```

Retry must not create a duplicate logical application action.

---

# 39. SYSTEM ADMIN UI

System Administrator screens may include:

```text
Users
Roles
Society Configuration
System Status
Blockchain Status
Audit
```

The System Administrator must not receive a generic “override governance” capability.

---

# 40. SOCIETY MANAGER UI

Manager screens should emphasize operations:

```text
Dashboard
Projects
Quotations
Change Requests
Meetings
Resolutions
Complaints
Notices
Budget
Payments
Audit
```

Manager actions must still be constrained by backend governance rules.

---

# 41. COMMITTEE MEMBER UI

Committee members should see:

```text
Dashboard
Pending Committee Decisions
Projects
Quotations
Meetings
Resolutions
Budget
Audit
```

Actions depend on the configured permissions and governance rules.

---

# 42. OWNER UI

Owners should see:

```text
Dashboard
Projects
Budgets
Meetings
Voting
Complaints
Notice Board
Payments
Audit
```

Owners can participate in eligible governance votes.

Voting eligibility is determined by the backend.

---

# 43. RESIDENT UI

Residents should see:

```text
Dashboard
Notice Board
Complaints
Permitted Projects
Applicable Payments
```

Resident voting rights remain configurable/TBC according to the business rules.

---

# 44. RESPONSIVE DESIGN

The application should support:

- Desktop
- Laptop
- Tablet
- Mobile-width layouts

On smaller screens:

```text
Sidebar
   ↓
Collapsible navigation
```

Tables should become:

- horizontally scrollable
- card-based
- or otherwise readable without losing important information

---

# 45. ACCESSIBILITY

The UI should provide:

- Keyboard navigation
- Visible focus states
- Form labels
- Accessible buttons
- Sufficient contrast
- Meaningful error messages
- Text alternatives for meaningful images
- Do not rely on color alone
- Logical heading hierarchy

Accessibility improvements should be implemented without changing business rules.

---

# 46. FORM DESIGN

Forms should:

- Clearly label required fields
- Validate input
- Explain errors next to the relevant field
- Preserve user input where possible
- Confirm destructive actions
- Avoid ambiguous terminology

Example:

```text
Estimated Project Amount
₹ [________]

This amount is used by the Approval Engine to determine
the required approval workflow.
```

---

# 47. DESTRUCTIVE ACTIONS

Actions such as:

- Cancel project
- Reject quotation
- Reject resolution
- Archive notice
- Reopen complaint

should require appropriate confirmation.

The confirmation should state:

- What will happen
- Whether the action can be reversed
- Who is performing it

The backend remains authoritative.

---

# 48. LOADING STATES

Every network-dependent screen should support loading states.

Examples:

```text
Loading projects...
Loading voting status...
Checking blockchain status...
Uploading evidence...
```

Avoid blank screens while requests are pending.

---

# 49. ERROR STATES

Errors should be understandable.

Example:

```text
SGM Required

This project cannot be approved through the committee
workflow because its amount exceeds the configured threshold.

View Approval Requirements
```

Blockchain error:

```text
Blockchain Transaction Failed

The governance record was not confirmed on-chain.

Application status:
Pending blockchain confirmation

Transaction:
0x....
```

---

# 50. EMPTY STATES

Examples:

```text
No active projects
No complaints
No published notices
No active votes
No payment history
No audit records
```

Empty states should explain what the user can do next where appropriate.

---

# 51. NOTIFICATION CENTER

Potential notifications:

```text
New Notice
SGM Scheduled
Voting Opened
Voting Closing Soon
Project Approved
Project Progress Updated
Quotation Revised
Complaint Updated
Payment Successful
Blockchain Confirmed
```

Exact notification channels remain configurable/TBC.

---

# 52. SEARCH AND FILTERING

Major list screens should support search/filtering where useful.

Examples:

Projects:

```text
Search
Status
Category
Amount
Date
```

Complaints:

```text
Search
Status
Priority
Category
```

Notices:

```text
Search
Category
Priority
Date
```

Audit:

```text
Search
Entity
Action
Actor
Date
```

---

# 53. DATA VISIBILITY

The UI must respect role-based visibility.

Examples:

```text
Owner
→ permitted financial/project information

Resident
→ permitted society information

Manager
→ operational information

Administrator
→ system administration
```

Personal information should not be exposed unnecessarily.

---

# 54. BLOCKCHAIN SHOULD NOT DOMINATE THE UI

The application should not put a blockchain badge beside every field.

Use blockchain indicators where verification adds meaningful value:

```text
Approved
✓ Blockchain Confirmed
```

or:

```text
Audit Record
Blockchain proof available
```

The primary user experience should remain understandable to users who know nothing about blockchain.

---

# 55. DEMO MODE EXPERIENCE

The MVP should support a clear demonstration flow.

Recommended demo:

```text
1. Manager creates Lift Modernization project
2. ₹3,50,000 amount entered
3. Approval Engine shows SGM required
4. SGM created
5. Notice published
6. Governance resolution opened
7. Owner votes
8. Voting closes
9. Result calculated
10. Blockchain record confirmed
11. Project approved
12. Work begins
13. Progress photos added
14. Quotation revised
15. Re-approval required
16. Final evidence added
17. Payment recorded
18. Audit history displayed
19. Blockchain verification displayed
```

This should demonstrate the complete value proposition rather than isolated screens.

---

# 56. UI TRACEABILITY

Important UI behaviors should reference requirement IDs.

Examples:

```text
UI-PROJECT-001
→ Project list

UI-PROJECT-002
→ Approval status panel

UI-QUOTATION-001
→ Quotation version timeline

UI-VOTING-001
→ Governance voting screen

UI-NOTICE-001
→ Notice Board

UI-AUDIT-001
→ Audit timeline

UI-BLOCKCHAIN-001
→ Verification panel
```

The exact IDs may be expanded during implementation.

---

# 57. FRONTEND MODULE STRUCTURE

Suggested structure:

```text
src/
├── components/
├── layouts/
├── pages/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── projects/
│   ├── quotations/
│   ├── meetings/
│   ├── resolutions/
│   ├── voting/
│   ├── complaints/
│   ├── notices/
│   ├── budgets/
│   ├── payments/
│   ├── audit/
│   └── blockchain/
├── services/
├── hooks/
├── utils/
└── routes/
```

---

# 58. FRONTEND API BOUNDARY

Frontend services should communicate with the documented backend APIs.

The frontend must not:

- Directly query MongoDB
- Reimplement backend business rules
- Assume approval eligibility
- Assume voting eligibility
- Modify official historical records
- Fake blockchain confirmation

---

# 59. UI TESTING

Important screens should have tests for:

- Rendering
- Role-based visibility
- Form validation
- Loading states
- Error states
- Approval status display
- Voting states
- Blockchain states
- Evidence upload states
- Responsive behavior where practical

End-to-end tests should cover the main demo workflow.

---

# 60. UI CHANGE CONTROL

UI changes that alter behavior must follow `VERSIONING.md`.

Examples requiring specification review:

- New workflow
- New role action
- New status
- New approval behavior
- New voting behavior
- New data visibility
- New blockchain interaction

Purely visual changes that do not alter behavior may be handled as implementation changes while preserving the requirements.

---

# 61. UI/UX CORE RULE

> **The interface should make the society's decision-making process visible and understandable without becoming the authority that decides whether an action is permitted.**


---

# 62. VISUAL DESIGN SYSTEM

Nivaas should use a distinctive, warm civic-tech visual language rather than a generic SaaS dashboard.

Core palette:

```text
Text        #091120
Background  #FFF8DB
Primary     #E03B29
Secondary   #1D5287
Accent      #F6E7A7
```

The core brand palette should remain stable. Additional semantic colors may be used only for state communication.

Recommended semantic extensions:

```text
Success  #177245
Warning  #A15C00
Danger   #B42318
Info     #1D5287
Neutral  #5F6470
```

These semantic colors support the brand palette; they do not replace it.

---

# 63. COLOR USAGE

## Text

```text
#091120
```

Use for primary text, headings, navigation and important values.

## Background

```text
#FFF8DB
```

Use as the main application canvas.

## Primary

```text
#E03B29
```

Use for primary actions, important emphasis and appropriate destructive actions.

## Secondary

```text
#1D5287
```

Use for information, secondary actions, links, governance information and technical emphasis.

## Accent

```text
#F6E7A7
```

Use mainly as a surface/highlight rather than small body text.

Do not use every brand color on every screen.

---

# 64. COLOR ACCESSIBILITY

Color must never be the only indicator of meaning.

Prefer:

```text
✓ APPROVED
✕ REJECTED
◷ PENDING
! MISMATCH
```

with color used as supporting information.

The implementation must verify contrast for body text, buttons, links, status badges, errors, focus states and accent surfaces.

---

# 65. TYPOGRAPHY SYSTEM

Nivaas uses three primary typefaces.

## Headlines — Space Grotesk Bold

```text
Space Grotesk / 700
```

Use for page titles, major headings, section headings and strong dashboard headings.

## Body / UI — Syne

```text
Syne
```

Use for body copy, navigation, labels, descriptions, notices and general interface text.

Syne is preferred over `M PLUS 1 Code` for normal body content because M PLUS 1 Code is monospaced and is better reserved for technical information.

## Technical / Data — JetBrains Mono

```text
JetBrains Mono
```

Use for:

- vote counts;
- wallet addresses;
- transaction hashes;
- token balances;
- flat/room numbers;
- project IDs;
- resolution IDs;
- contract addresses;
- block numbers;
- technical references;
- tabular monetary values where alignment helps.

JetBrains Mono is preferred over Space Mono because technical identifiers and numbers are a frequent part of the application and readability is the priority.

---

# 66. TYPOGRAPHY HIERARCHY

Suggested starting scale:

```text
Hero             Space Grotesk Bold   48–64px
Page Heading     Space Grotesk Bold   32–40px
Section Heading  Space Grotesk Bold   22–28px
Card Heading     Space Grotesk Bold   18–22px
Body             Syne                 14–16px
Supporting       Syne                 12–14px
Technical/Data   JetBrains Mono       12–16px
```

Exact responsive values may be refined during implementation.

Do not use all three fonts randomly. The intended relationship is:

```text
Space Grotesk → hierarchy
Syne          → communication
JetBrains Mono → data / technical identity
```

---

# 67. DATA PRESENTATION

Financial and governance numbers should be visually prominent without becoming oversized.

Example:

```text
Project Cost
₹3,80,000
```

Vote counts should use JetBrains Mono:

```text
YES       128
NO         42
ABSTAIN     7
```

The frontend must display authoritative values returned by the backend.

---

# 68. COMPONENT VISUAL LANGUAGE

Use a restrained component system:

```text
Small radius   6px
Medium         10px
Large          14px
Pill           999px
```

Most cards should rely on borders, spacing and typography rather than heavy shadows.

Shadows should mainly communicate elevation for modals, dropdowns and overlays.

Suggested spacing scale:

```text
4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80
```

---

# 69. ANIMATION LIBRARY

Nivaas will use **Anime.js** as its single dedicated animation library.

Anime.js is a presentation-layer dependency. It must not control application state, API calls, governance logic, voting eligibility, approval decisions, blockchain confirmation or database state.

The official Anime.js documentation provides animation, timelines, scopes, SVG, text and related capabilities. The implementation should use the library directly rather than adding an unnecessary React wrapper layer. urlAnime.js Documentationhttps://animejs.com/documentation

No second animation framework should be introduced without explicit approval.

---

# 70. ANIME.JS USAGE RULES

Use Anime.js for purposeful presentation such as:

- page entrance;
- card staggering;
- sidebar transitions;
- modal transitions;
- timeline progression;
- vote confirmation;
- status transitions;
- blockchain progress;
- verification success;
- subtle notification movement;
- evidence gallery transitions.

Prefer opacity and transforms for smooth motion rather than repeatedly animating layout-heavy properties. citeturn0search3

Do not use Anime.js for business logic, calculations, API state, governance deadlines, vote counting or blockchain confirmation.

---

# 71. MOTION LANGUAGE

Motion should feel:

```text
Quick
Controlled
Confident
Physical
Not distracting
```

Suggested starting timings:

```text
Micro interaction       120–180ms
Standard transition     200–350ms
Major state transition  350–600ms
Large workflow          500–800ms
```

These are presentation guidelines, not business-rule timers.

Avoid long animations for ordinary navigation.

---

# 72. MOTION STATE BOUNDARY

The correct architecture is:

```text
Backend state
      ↓
React reads state
      ↓
React renders correct UI
      ↓
Anime.js animates presentation
```

Never:

```text
Anime.js animation
      ↓
determines application state
```

For example:

```text
Backend:
BLOCKCHAIN_CONFIRMED

React:
status === CONFIRMED

Anime.js:
animate transition to confirmed visual
```

This keeps the UI deterministic and maintainable by AI-assisted development.

---

# 73. REDUCED MOTION

Anime.js animations must respect the user's reduced-motion preference.

When `prefers-reduced-motion: reduce` is active:

- avoid decorative movement;
- minimize transitions;
- remove large transforms;
- avoid looping animation;
- retain important state changes through text, icons and status labels.

The application must remain fully understandable without animation.

---

# 74. GOVERNANCE MOTION

Motion should emphasize state progression:

```text
Eligibility
    ↓
Voting Open
    ↓
Voting Closed
    ↓
Result
    ↓
Approval
```

Animation must never imply that a result exists before the backend reports it.

---

# 75. BLOCKCHAIN MOTION

Blockchain animation should communicate actual application progress.

Good:

```text
Preparing
   ↓
Submitted
   ↓
Confirming
   ↓
Confirmed
```

Bad:

```text
Fake mining animation
```

Do not simulate blockchain confirmation for visual effect.

---

# 76. LOADING / ERROR / EMPTY STATES

Every network-dependent screen should support a visible loading state.

Examples:

```text
Loading projects...
Loading voting status...
Checking blockchain status...
Uploading evidence...
```

Errors should be understandable and should not expose raw stack traces.

Empty states should explain what the user can do next where appropriate.

Skeleton motion must become static or minimal when reduced motion is enabled.

---

# 77. BLOCKCHAIN SHOULD NOT DOMINATE THE UI

Do not put a blockchain badge beside every field.

Use blockchain indicators where verification adds meaningful value:

```text
Approved
✓ Blockchain Verified
```

or:

```text
Audit Record
Blockchain proof available
```

The primary experience should remain understandable to users who know nothing about blockchain.

---

# 78. FRONTEND MODULE STRUCTURE

Suggested structure:

```text
src/
├── components/
├── layouts/
├── pages/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── projects/
│   ├── quotations/
│   ├── meetings/
│   ├── resolutions/
│   ├── voting/
│   ├── complaints/
│   ├── notices/
│   ├── budgets/
│   ├── payments/
│   ├── audit/
│   └── blockchain/
├── services/
├── hooks/
├── utils/
├── motion/
└── routes/
```

The `motion/` directory should contain reusable Anime.js helpers/configuration rather than duplicated animation logic in every component.

---

# 79. AI IMPLEMENTATION RULES

Because Nivaas is being developed with AI-assisted coding:

1. Read `UI_UX.md` before creating new screens.
2. Do not introduce another font without approval.
3. Do not introduce another animation library without approval.
4. Do not introduce another color palette without updating this document.
5. Reuse existing components before creating duplicates.
6. Reuse existing motion helpers before writing new animation logic.
7. Do not place business rules inside visual components.
8. Do not invent API or application states.
9. Do not use animation to hide loading or API delays.
10. Do not fake blockchain states.
11. Preserve accessibility when adding motion.
12. Respect `prefers-reduced-motion`.
13. Run the frontend build and relevant tests after significant UI changes.
14. Report changed files and new dependencies.
15. Stop if a UI requirement conflicts with `SRS.md`, `API.md`, `DATABASE.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md`, or `BLOCKCHAIN.md`.

---

# 80. UI/UX CORE RULE

> **The interface should make the society's decision-making process visible and understandable without becoming the authority that decides whether an action is permitted.**

The visual system should make complex governance workflows easier to understand rather than hiding their complexity.

---

# 81. DESIGN SYSTEM SUMMARY

```text
BRAND
Background   #FFF8DB
Text         #091120
Primary      #E03B29
Secondary    #1D5287
Accent       #F6E7A7

HEADLINES
Space Grotesk Bold

BODY / UI
Syne

DATA / TECHNICAL
JetBrains Mono

ANIMATION
Anime.js

UI FRAMEWORK
Tailwind CSS + shadcn/ui
```

Recommended semantic colors:

```text
Success  #177245
Warning  #A15C00
Danger   #B42318
Info     #1D5287
Neutral  #5F6470
```

The five core brand colors remain the primary visual identity.

---

# 82. UI/UX STATUS

**Version:** 1.2
**Status:** Active Planning Document

This version adds the approved visual system, typography system, Anime.js motion system, reduced-motion requirements, governance-aware animation rules, and AI implementation constraints.

Any significant change to navigation, workflows, role capabilities, voting behavior, data visibility, colors, typography, motion architecture, or blockchain interaction must follow `VERSIONING.md`.

## 83. Committee approval and offline meeting controls

Project cards show the current committee decision counts, quorum state, and configured majority separately. Only a user with the `COMMITTEE_MEMBER` application role can submit an immutable approve/reject choice; the backend also checks the current same-society committee appointment. Society Managers can finalize only when the backend reports quorum and an unambiguous result.

Meeting records support society-provided document references for notices, proposals, quotations and supporting evidence. Draft general-body resolutions with an eligibility snapshot expose a manager-only offline confirmation form. The manager selects eligible attendees, enters aggregate counts and minutes/evidence references, and explicitly confirms authority and accuracy. The UI explains that Nivaas stores attendance and aggregate counts without mapping individual ballots. The browser Voting route remains unavailable; these controls do not add live, anonymous, secret-ballot, or election voting.
