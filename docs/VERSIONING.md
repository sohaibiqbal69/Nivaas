# VERSIONING.md

**Document:** `VERSIONING.md`\
**Version:** 1.0\
**Status:** Active Planning Document\
**Purpose:** Specification, implementation, testing, traceability, and
AI development control

------------------------------------------------------------------------

# 1. PURPOSE

This document defines how Nivaas will control changes while the
project is being developed with AI coding assistance.

The primary goal is to prevent uncontrolled AI-generated changes from
introducing inconsistencies between:

-   Business rules
-   Functional requirements
-   Database design
-   API design
-   System architecture
-   Blockchain design
-   UI/UX design
-   Source code
-   Tests
-   Git history

Nivaas must be developed through a controlled cycle:

``` text
Specification
      ↓
Implementation
      ↓
Tests
      ↓
Git Commit
```

A coding AI must not be treated as the source of truth.

The specifications are the source of truth.

------------------------------------------------------------------------

# 2. CORE VERSIONING PRINCIPLE

> **Documentation defines what the system must do. Code implements the
> documentation. Tests verify the implementation. Git records the
> approved change.**

The preferred order for an important change is:

``` text
Requirement / Rule Change
          ↓
Update Specification
          ↓
Review Impact
          ↓
Update Implementation
          ↓
Update / Add Tests
          ↓
Run Tests
          ↓
Review Diff
          ↓
Git Commit
```

The coding AI must not be instructed to modify the implementation first
and then update the specification afterward.

------------------------------------------------------------------------

# 3. SOURCE OF TRUTH HIERARCHY

When documents or implementation appear to disagree, use the following
hierarchy:

``` text
1. Current approved Business Rules
2. Current approved SRS / Functional Requirements
3. Current Architecture
4. Current Database Specification
5. Current API Specification
6. Current Blockchain Specification
7. Current UI/UX Specification
8. Source Code
9. Tests
10. AI-generated assumptions
```

This hierarchy does not mean tests are unimportant.

Tests are evidence of whether the implementation satisfies the
specification. If a test conflicts with an approved requirement, the
requirement must be reviewed and the test corrected if necessary.

------------------------------------------------------------------------

# 4. REQUIREMENT AND RULE IDENTIFIERS

Every important requirement or rule should have a stable identifier.

Identifiers allow the team and coding AI to trace a behavior across
documentation, code, tests, and Git commits.

## 4.1 Business Rules

Business rules use:

``` text
BR-<CATEGORY>-<NUMBER>
```

Examples:

``` text
BR-APPROVAL-001
BR-QUOTATION-001
BR-VOTE-001
BR-PAYMENT-001
BR-COMPLAINT-001
```

Examples already established for Nivaas include:

``` text
BR-APPROVAL-001
BR-QUOTATION-001
BR-VOTE-001
```

The exact meaning of an identifier must be defined in the relevant
specification.

------------------------------------------------------------------------

## 4.2 Functional Requirements

Functional requirements use:

``` text
FR-<MODULE>-<NUMBER>
```

Examples:

``` text
FR-PROJECT-001
FR-COMPLAINT-001
FR-NOTICE-001
FR-VOTING-001
FR-AUDIT-001
```

------------------------------------------------------------------------

## 4.3 API Requirements

API requirements use:

``` text
API-<MODULE>-<NUMBER>
```

Examples:

``` text
API-PROJECT-001
API-VOTING-001
API-COMPLAINT-001
API-NOTICE-001
```

The identifier refers to the required API behavior, not merely the URL.

------------------------------------------------------------------------

## 4.4 Database Requirements

Database-specific requirements may use:

``` text
DB-<MODULE>-<NUMBER>
```

Examples:

``` text
DB-PROJECT-001
DB-QUOTATION-001
DB-VOTING-001
```

------------------------------------------------------------------------

## 4.5 Blockchain Requirements

Blockchain-specific requirements use:

``` text
BC-<CATEGORY>-<NUMBER>
```

Examples:

``` text
BC-GOVERNANCE-001
BC-AUDIT-001
BC-PAYMENT-001
```

------------------------------------------------------------------------

## 4.6 UI/UX Requirements

UI/UX requirements use:

``` text
UI-<MODULE>-<NUMBER>
```

Examples:

``` text
UI-PROJECT-001
UI-VOTING-001
UI-DASHBOARD-001
```

------------------------------------------------------------------------

# 5. IDENTIFIER RULES

Identifiers must be:

-   Unique
-   Stable
-   Never silently reused
-   Meaningful enough to identify their module/category
-   Referenced when implementing important behavior

An identifier should not be changed simply because the wording of a
requirement changes.

For example:

``` text
BR-APPROVAL-001
```

should continue to represent the same logical rule even if its wording
is refined.

If the underlying requirement becomes a fundamentally different rule,
create a new identifier and mark the previous rule as superseded.

------------------------------------------------------------------------

# 6. REQUIREMENT LIFECYCLE

Each important requirement follows a lifecycle.

``` text
DRAFT
  ↓
REVIEWED
  ↓
APPROVED
  ↓
IMPLEMENTED
  ↓
TESTED
  ↓
COMMITTED
```

Possible additional states:

``` text
CHANGED
DEPRECATED
SUPERSEDED
REJECTED
```

A requirement should not be considered complete merely because code
exists.

------------------------------------------------------------------------

# 7. SPECIFICATION-FIRST CHANGE PROCESS

When a business or technical rule changes:

## Step 1 --- Identify the affected rule

Example:

``` text
BR-APPROVAL-001
```

## Step 2 --- Identify affected specifications

For example:

``` text
BUSINESS_RULES.md
DATABASE.md
API.md
ARCHITECTURE.md
```

## Step 3 --- Update specifications

The new behavior must be documented before implementation begins.

## Step 4 --- Perform impact analysis

Identify affected:

-   Backend services
-   API endpoints
-   Database entities
-   Frontend screens
-   Smart contracts
-   Tests
-   Existing workflows

## Step 5 --- Ask the coding AI to implement the approved change

The AI receives the updated specifications as its source of truth.

## Step 6 --- Update tests

Existing tests must be reviewed.

New tests must be added where required.

## Step 7 --- Run the affected test suite

Do not rely only on the newly created test.

Run:

-   New tests
-   Affected module tests
-   Relevant integration tests
-   Build/lint checks where applicable

## Step 8 --- Review the diff

Check:

-   Files changed
-   Unexpected files changed
-   Business logic changes
-   Database changes
-   API changes
-   Dependency changes
-   Contract changes

## Step 9 --- Commit

Only after the change passes review and tests.

------------------------------------------------------------------------

# 8. THE AI DEVELOPMENT LOOP

Every meaningful coding task should follow:

``` text
READ SPECIFICATION
       ↓
IDENTIFY REQUIREMENTS
       ↓
PROPOSE IMPLEMENTATION
       ↓
IMPLEMENT
       ↓
RUN TESTS
       ↓
FIX FAILURES
       ↓
REPORT CHANGES
       ↓
HUMAN REVIEW
       ↓
GIT COMMIT
```

The coding AI should not automatically continue into unrelated features.

------------------------------------------------------------------------

# 9. AI CHANGE BOUNDARY

For every implementation task, the coding AI should be given a defined
scope.

Example:

``` text
Implement:
BR-QUOTATION-001
API-QUOTATION-002
FR-PROJECT-004
```

The AI should modify only the modules necessary to satisfy those
requirements.

If the AI discovers that another specification must change, it must stop
and report the dependency rather than silently changing the requirement.

------------------------------------------------------------------------

# 10. NO SILENT SPECIFICATION CHANGES

The coding AI must never silently:

-   Change a business rule
-   Change an approval threshold
-   Change voting behavior
-   Change database semantics
-   Change API contracts
-   Change role permissions
-   Change blockchain responsibilities
-   Change an existing workflow
-   Remove a validation
-   Change an entity relationship

If such a change appears necessary, the AI must report:

``` text
CONFLICT / REQUIRED SPECIFICATION CHANGE

Affected rule:
BR-XXXXXXXX-XXX

Reason:
<explanation>

Affected documents:
<list>

Implementation blocked until specification is updated.
```

------------------------------------------------------------------------

# 11. CHANGE IMPACT MATRIX

Important changes should be traced across affected documents.

Example:

  ----------------------------------------------------------------------------------------------
  Change       Business   SRS     Database   API     Architecture   Blockchain   UI/UX   Tests
               Rules                                                                     
  ------------ ---------- ------- ---------- ------- -------------- ------------ ------- -------
  Approval     ✓          ✓                  ✓       ✓              ✓            ✓       ✓
  threshold                                                                              
  changes                                                                                

  Quotation    ✓          ✓       ✓          ✓       ✓              ✓            ✓       ✓
  revision                                                                               
  changes                                                                                

  Governance   ✓          ✓       ✓          ✓       ✓              ✓            ✓       ✓
  voting                                                                                 
  changes                                                                                

  Complaint    ✓          ✓       ✓          ✓       ✓                           ✓       ✓
  workflow                                                                               
  changes                                                                                

  Notice Board ✓          ✓       ✓          ✓                                   ✓       ✓
  changes                                                                                
  ----------------------------------------------------------------------------------------------

The matrix is a guide rather than a claim that every listed document
must always change.

The actual impact must be reviewed for each change.

------------------------------------------------------------------------

# 12. DOCUMENT VERSIONING

Every major specification document should contain:

``` text
Document:
Version:
Status:
```

Example:

``` text
Document: BUSINESS_RULES.md
Version: 1.1
Status: Active Planning Document
```

When a meaningful specification change occurs, increment the document
version.

Minor editorial corrections may use a patch version if the team chooses
to adopt one.

Example:

``` text
1.0 → 1.1
```

for a meaningful rule/schema change.

``` text
1.1 → 1.1.1
```

may be used for a documentation-only correction that does not change
system behavior.

------------------------------------------------------------------------

# 13. VERSIONING DOES NOT MEAN EVERYTHING CHANGES TOGETHER

A document version change does not automatically require every other
document to receive a new version.

Only affected specifications should be changed.

However, the change must be checked for cross-document consistency.

Example:

``` text
BUSINESS_RULES.md
1.1 → 1.2

DATABASE.md
1.1 → 1.2

API.md
1.1 → 1.2

ARCHITECTURE.md
1.1 → 1.1
```

if the architecture remains valid.

------------------------------------------------------------------------

# 14. RULE TRACEABILITY

Important rules should be traceable across the project.

Example:

``` text
BR-APPROVAL-001
      ↓
BUSINESS_RULES.md
      ↓
SRS.md
      ↓
API approval logic
      ↓
Project approval service
      ↓
Frontend approval status
      ↓
Tests
      ↓
Git commit
```

For voting:

``` text
BR-VOTE-001
      ↓
BUSINESS_RULES.md
      ↓
DATABASE.md
      ↓
API.md
      ↓
GovernanceResolution / GovernanceVote
      ↓
Voting service
      ↓
Blockchain proof where applicable
      ↓
Voting UI
      ↓
Tests
```

------------------------------------------------------------------------

# 15. TEST TRACEABILITY

Tests should reference the requirement or rule they verify whenever
practical.

Example:

``` text
Test: project amount exactly ₹1,00,000

Requirement:
BR-APPROVAL-001

Expected:
Committee approval path
```

Another:

``` text
Test: project amount ₹1,00,001

Requirement:
BR-APPROVAL-001

Expected:
SGM path
```

This makes failures easier to understand.

------------------------------------------------------------------------

# 16. REGRESSION PROTECTION

Whenever a bug is found:

``` text
Bug
 ↓
Identify affected requirement
 ↓
Add regression test
 ↓
Fix implementation
 ↓
Run regression suite
 ↓
Commit
```

The fix should not exist only as an undocumented code change.

If the bug reveals that the specification itself was incomplete or
incorrect, update the specification first.

------------------------------------------------------------------------

# 17. GIT COMMIT RULES

Git commits should represent controlled units of work.

Preferred sequence:

``` text
Specification commit
        ↓
Implementation commit
        ↓
Test/fix commit
```

The team may combine implementation and tests into one commit when
appropriate, but the final repository state must remain traceable.

Commit messages should identify the affected requirement where
practical.

Examples:

``` text
docs: define quotation revision rule BR-QUOTATION-001

feat: implement quotation revision BR-QUOTATION-001

test: add quotation revision regression tests

feat: implement governance vote API API-VOTING-001
```

------------------------------------------------------------------------

# 18. GIT COMMIT CHECKLIST

Before committing a meaningful feature:

-   [ ] Relevant specification is current
-   [ ] Requirement/rule IDs are identified
-   [ ] Impacted modules are identified
-   [ ] Implementation is complete
-   [ ] Tests are added/updated
-   [ ] Tests pass
-   [ ] Build/lint checks pass where applicable
-   [ ] No unrelated files were modified
-   [ ] No business rule was silently changed
-   [ ] No API contract was silently changed
-   [ ] No database schema was silently changed
-   [ ] Git diff was reviewed
-   [ ] Commit message identifies the work

------------------------------------------------------------------------

# 19. BRANCHING

Development may use feature branches such as:

``` text
feature/auth
feature/projects
feature/quotations
feature/governance-voting
feature/complaints
feature/blockchain
```

A feature branch should remain focused on a defined scope.

Large cross-module changes should be discussed before implementation.

------------------------------------------------------------------------

# 20. BLOCKCHAIN-SPECIFIC VERSIONING

Smart contracts require additional caution.

A contract change can affect:

-   Contract ABI
-   Contract address
-   Backend blockchain service
-   Frontend wallet interaction
-   Stored transaction references
-   Event handling
-   Tests
-   Deployment configuration

Therefore:

``` text
Blockchain specification
        ↓
Contract implementation
        ↓
Contract tests
        ↓
Deployment
        ↓
ABI/address update
        ↓
Backend integration
        ↓
Frontend integration
        ↓
Integration tests
        ↓
Git commit
```

A deployed contract must not be casually replaced without recording the
change.

------------------------------------------------------------------------

# 21. DATABASE/API COMPATIBILITY

Database and API changes must be considered together.

For example:

``` text
Database field changed
        ↓
Model changed
        ↓
Service changed
        ↓
API response/request changed
        ↓
Frontend integration changed
        ↓
Tests changed
```

The coding AI must not modify a database schema while leaving dependent
APIs or frontend code unknowingly incompatible.

------------------------------------------------------------------------

# 22. AI HANDOFF FORMAT

Before asking the coding AI to implement a task, provide a controlled
task specification.

Recommended format:

``` text
TASK

Goal:
<what must be implemented>

Requirements:
- BR-XXXXXXXX-XXX
- FR-XXXXXXXX-XXX
- API-XXXXXXXX-XXX

Source documents:
- BUSINESS_RULES.md
- SRS.md
- DATABASE.md
- API.md
- ARCHITECTURE.md

Allowed scope:
<modules/files that may need modification>

Do not change:
<protected behavior>

Acceptance criteria:
- <criterion>
- <criterion>
- <criterion>

Testing required:
- <test>
- <test>
```

The AI should read the referenced documents before changing code.

------------------------------------------------------------------------

# 23. AI RESPONSE FORMAT

After implementation, the coding AI should report:

``` text
IMPLEMENTATION REPORT

Requirements implemented:
- BR-XXXXXXXX-XXX
- FR-XXXXXXXX-XXX

Files changed:
- <file>
- <file>

Database changes:
- <changes or none>

API changes:
- <changes or none>

Blockchain changes:
- <changes or none>

Tests added/updated:
- <tests>

Tests run:
- <commands/results>

Unresolved issues:
- <issues or none>
```

This makes AI-generated work reviewable.

------------------------------------------------------------------------

# 24. DEFINITION OF DONE

A feature is considered complete only when:

``` text
Specification
     ✓
Implementation
     ✓
Tests
     ✓
Review
     ✓
Git Commit
     ✓
```

Code existing in the repository is not sufficient by itself.

------------------------------------------------------------------------

# 25. EXAMPLE --- QUOTATION CHANGE

Suppose the original quotation is:

``` text
₹90,000
```

and a change request adds:

``` text
₹20,000
```

New total:

``` text
₹1,10,000
```

The controlled process is:

``` text
BR-QUOTATION-001
        ↓
Specification confirms revision behavior
        ↓
Quotation V2 created
        ↓
Approval requirement recalculated
        ↓
Affected approval/voting workflow updated
        ↓
Tests updated
        ↓
Implementation
        ↓
Tests pass
        ↓
Git commit
```

The AI must not simply modify the original quotation amount in place.

------------------------------------------------------------------------

# 26. EXAMPLE --- GOVERNANCE VOTING

For a governance resolution:

``` text
BR-VOTE-001
FR-VOTING-001
API-VOTING-001
```

The controlled implementation is:

``` text
Specification
      ↓
GovernanceResolution schema
      ↓
Voting API
      ↓
Voting service
      ↓
GovernanceVote
      ↓
Result calculation
      ↓
Blockchain proof where applicable
      ↓
Voting UI
      ↓
Tests
      ↓
Git commit
```

The AI must not convert this into an election system.

Elections are a separate future module as defined by the architecture.

------------------------------------------------------------------------

# 27. SUPERSEDED REQUIREMENTS

When a rule is replaced:

``` text
Old Rule
   ↓
SUPERSEDED
   ↓
New Rule
```

The old identifier should remain documented for historical traceability.

Example:

``` text
BR-APPROVAL-001
Status: SUPERSEDED
Superseded by: BR-APPROVAL-002
```

Never silently delete historical requirements that have already
influenced implementation.

------------------------------------------------------------------------

# 28. CHANGE LOG

Major specification changes should include a short change log.

Example:

  Version   Date      Change                         Affected IDs
  --------- --------- ------------------------------ -----------------
  1.0       Initial   Initial versioning framework   ---
  1.1       TBD       Example future rule change     BR-APPROVAL-001

The actual project change log should be maintained as development
progresses.

------------------------------------------------------------------------

# 29. CURRENT DOCUMENT SET

The controlled specification set currently includes:

``` text
BUSINESS_RULES.md
SRS.md
ARCHITECTURE.md
DATABASE.md
API.md
VERSIONING.md
```

The planned Batch 3 specification set includes:

``` text
BLOCKCHAIN.md
UI_UX.md
```

Additional documents may be added if required.

------------------------------------------------------------------------

# 30. CORE AI DEVELOPMENT RULE

> **No important code change should happen before the corresponding
> specification has been reviewed and approved.**

If the coding AI believes the specification is wrong, incomplete, or
contradictory, it should stop and report the issue.

It must not solve the specification problem by silently changing the
system.

------------------------------------------------------------------------

# 31. FINAL DEVELOPMENT CONTRACT

Nivaas follows this development contract:

``` text
┌─────────────────────────────┐
│       SPECIFICATION         │
│ Rules / Requirements / API  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       IMPLEMENTATION        │
│        Source Code          │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│           TESTS             │
│   Unit / Integration / E2E  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│        HUMAN REVIEW         │
│      Diff / Behavior        │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         GIT COMMIT          │
│       Traceable Change      │
└─────────────────────────────┘
```

This process is mandatory for meaningful changes made during
development.

------------------------------------------------------------------------

# 32. VERSIONING STATUS

**Version:** 1.0\
**Status:** Active Planning Document

Any future change to the development-control process should update this
document before the new process is used.
