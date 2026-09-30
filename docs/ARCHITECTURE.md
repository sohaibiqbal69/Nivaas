## System Architecture Specification

**Document:** `ARCHITECTURE.md`
**Version:** 1.4
**Status:** Active Planning Document — Revised Governance, Rule Engine & Blockchain Architecture

---

# 1. PURPOSE

This document defines the technical architecture of Nivaas.
It specifies:

- Application layers
- Technologies
- Responsibilities of each component
- Communication between components
- Authentication
- Authorization
- Database interaction
- Blockchain interaction
- File handling
- Security boundaries
- Development structure

The architecture must remain consistent with `BUSINESS_RULES.md` and `SRS.md`.

---

# 2. ARCHITECTURAL PRINCIPLE

Nivaas is a **hybrid blockchain application**.
Blockchain is not used as the entire application's database.
Instead:

```
Traditional Application Layer
        +
Blockchain Trust Layer
        =
Nivaas
```

The traditional application handles normal application data.
Blockchain handles selected records where immutability and independent verification provide value.

---

# 3. HIGH-LEVEL ARCHITECTURE

```
                         USER
                           │
                           ▼
                  ┌─────────────────┐
                  │  React Frontend │
                  │     + Vite      │
                  └────────┬────────┘
                           │
                  HTTP / REST API
                           │
                           ▼
                  ┌─────────────────┐
                  │  Node.js +      │
                  │    Express      │
                  └───────┬─┬───────┘
                          │ │
                ┌─────────┘ └──────────┐
                ▼                      ▼
        ┌──────────────┐       ┌───────────────┐
        │   MongoDB    │       │ Blockchain    │
        │   Database   │       │ Smart         │
        │              │       │ Contracts     │
        └──────────────┘       └───────┬───────┘
                                       │
                                       ▼
                                  Hardhat Network
                                  / Test Network

                    ┌────────────────────────┐
                    │ Off-chain File Storage │
                    │ Photos / PDFs / Docs   │
                    └────────────────────────┘
```

---

# 4. TECHNOLOGY STACK

## Frontend

- React
- Vite
- JavaScript/TypeScript
- Tailwind CSS
- shadcn/ui
- React Router
- Axios or Fetch
- ethers.js

---

## Backend

- Node.js
- Express
- JavaScript/TypeScript
- JWT/session-based authentication
- Mongoose
- ethers.js

---

## Database

MongoDB.
MongoDB stores application-level information that does not need to live on blockchain.

---

## Blockchain

- Solidity
- Hardhat
- ethers.js
- MetaMask
- Local Hardhat network during development

A public test network may be used later if required.

---

## Version Control

- Git
- GitHub

---

# 5. ARCHITECTURAL LAYERS

The system is divided into five logical layers.

```
Presentation Layer
       ↓
API Layer
       ↓
Business Logic Layer
       ↓
Data Layer
       ↓
Blockchain Integration Layer
```

---

# 6. PRESENTATION LAYER

The React frontend is responsible for:

- Displaying information
- Forms
- Navigation
- Dashboards
- Tables
- Timelines
- Voting interface
- Wallet connection
- File upload interface
- Notifications
- Error messages

The frontend must not be trusted to enforce authorization.
Example:
Hiding an "Approve" button is not security.
The backend must independently verify whether the user is authorized.

---

# 7. API LAYER

The Express backend exposes REST APIs.
Responsibilities:

- Authentication
- Authorization
- Request validation
- Response formatting
- Calling business services
- Calling database services
- Calling blockchain services where appropriate

The API should not contain large amounts of business logic directly inside route handlers.

---

# 8. BUSINESS LOGIC LAYER

Business logic contains rules such as:

```
Project amount > ₹1,00,000
        ↓
SGM required
```

and:

```
Quotation changed
        ↓
Create revision
        ↓
Re-evaluate approval
```

The business logic must be independent from the React interface.

---

# 9. DATA ACCESS LAYER

The data layer is responsible for:

- MongoDB queries
- Creating records
- Updating records
- Retrieving records
- Relationships/references
- Database validation

The rest of the application should not contain random MongoDB queries everywhere.

---

# 10. BLOCKCHAIN INTEGRATION LAYER

Blockchain interaction must be isolated into dedicated services.
Examples:

```
blockchain/
├── contracts/
├── services/
├── abi/
└── config/
```

The rest of the application should call blockchain services rather than directly interacting with smart contracts everywhere.

---

# 11. FRONTEND RESPONSIBILITIES

The frontend shall:

- Authenticate users
- Display role-specific UI
- Display projects
- Display quotations
- Display meetings
- Display voting
- Display complaints
- Display notices
- Display budgets
- Display payments
- Display audit history
- Connect to wallet when required

The frontend shall not determine whether a user is actually authorized.

---

# 12. BACKEND RESPONSIBILITIES

The backend shall:

- Authenticate users
- Authorize requests
- Validate input
- Apply business rules
- Manage database operations
- Manage file metadata
- Manage project state transitions
- Manage quotation revisions
- Determine approval requirements
- Manage complaints
- Manage notices
- Create meetings
- Coordinate voting
- Coordinate blockchain operations
- Maintain audit records

---

# 13. DATABASE RESPONSIBILITIES

MongoDB is the authoritative application database for normal Nivaas
data.

Core domain data includes:

- Users and authentication metadata
- Societies
- Buildings
- Flats
- Ownership records
- Residence/occupancy records
- Membership records
- Committee memberships
- Society configuration and rule versions
- Budgets and budget categories
- Expenses
- Projects and project state history
- Quotations and quotation versions
- Change requests
- Vendors
- Meetings, agendas and notices
- Governance resolutions
- Governance eligibility snapshots
- Governance votes/results
- Payments
- Complaints and complaint history
- Evidence/file metadata
- Notifications
- Audit records
- Blockchain transaction references

Historical governance decisions must retain the rule/configuration snapshot
that was used to evaluate them.

MongoDB stores the application representation of a record; a blockchain
reference is stored alongside it where the record has an on-chain proof or
transaction.

---

# 14. BLOCKCHAIN RESPONSIBILITIES

Blockchain is **not the society's database**.

Blockchain provides an independently verifiable record of selected governance events and their integrity. Only information that benefits from immutability, independent verification, or tamper-evident proof should be recorded on-chain.

Examples of blockchain-backed events include:

- Governance resolution creation/reference
- Important approval records
- Governance vote/result proof
- Quotation revision approval
- Payment references
- Important audit-event hashes/references

The blockchain record should normally contain a compact identifier, reference, hash, result/proof, timestamp, or other verification data rather than the complete application record.

The authoritative application data remains in MongoDB. Blockchain provides an independent verification layer for selected important records.

The exact smart-contract design will be defined in `BLOCKCHAIN.md`.

---

# 15. WHAT MUST NOT GO ON BLOCKCHAIN

The system should not store large files directly on blockchain.
This includes:

- Photographs
- PDFs
- Full quotations
- Invoices
- Resident profiles
- Complaint descriptions
- Notice content
- Large application records

Instead:

```
File
 ↓
Off-chain storage
 ↓
Hash
 ↓
Blockchain reference
```

---

# 16. AUTHENTICATION FLOW

When a user account is created, the backend generates a single-use
account-setup credential. The user uses the account-setup flow to establish
their own password, which uses the existing authentication/password-hashing
mechanism. Successful consumption or invalidation prevents reuse. The
credential's delivery is implementation-specific; this architecture does
not select a delivery provider or define a setup endpoint/API contract,
token expiry, or password complexity requirement. Account setup does not
establish society membership, ownership, residence/occupancy, committee
membership, or governance/voting eligibility. The administrator does not
receive or set a user's permanent password.

The basic authentication flow is:

```
User
 ↓
Login
 ↓
Backend validates credentials
 ↓
Authentication token/session issued
 ↓
Frontend stores authentication state
 ↓
Protected API requests
 ↓
Backend validates authentication
```

---

# 17. AUTHORIZATION FLOW

Every protected operation follows:

```
Request
 ↓
Authentication check
 ↓
Identify user
 ↓
Identify role
 ↓
Check permission
 ↓
Check entity state
 ↓
Check business rule
 ↓
Allow / Reject
```

## Authorization Scope

`SYSTEM_ADMIN` has platform-wide technical scope. Society-scoped roles use
the society association loaded from the authenticated user's persisted
record. A request-supplied `societyId` or `userId` is not proof of identity
or access.

Cross-society access for `SYSTEM_ADMIN` is an explicit platform-admin
capability that must be granted by the relevant API authorization. It must
not be implemented as an implicit exception inside generic same-society
checks. A platform-admin role does not make the user a society member and
does not grant ownership, residence, committee membership, governance
eligibility, or governance authority. It cannot bypass society governance
or alter protected governance history.

Society-scoped endpoint access is evaluated against the society associated
with the server-loaded resource. The exact target-selection contract for a
platform administrator using the singular current-society API routes remains
unspecified in `API.md`.

Example:

```
Manager attempts project approval
        ↓
Authenticated?
        ↓
Yes
        ↓
Authorized to approve?
        ↓
Check project
        ↓
₹3,00,000
        ↓
SGM required
        ↓
Manager cannot bypass
        ↓
REJECT
```

---

# 18. PROJECT WORKFLOW ARCHITECTURE

```
Project Creation
       ↓
Quotation
       ↓
Approval Engine
       ↓
┌───────────────────┐
│                       │
≤ ₹1L                 > ₹1L
│                       │
▼                      ▼
Committee             SGM
Approval              Workflow
│                      │
└─────────┬─────────┘
          ▼
       Approved
          ↓
     Vendor/Work
          ↓
      Progress
          ↓
       Evidence
          ↓
   Final Invoice
          ↓
       Payment
          ↓
       Closed
```

---

# 19. QUOTATION ARCHITECTURE

Quotations use versioning.

```
Project
 │
 ├── Quotation V1
 │
 ├── Change Request
 │       │
 │       ▼
 │   Quotation V2
 │
 └── Change Request
         │
         ▼
     Quotation V3
```

Previous versions are never silently overwritten.

---

# 20. COMPLAINT ARCHITECTURE

```
Resident
   ↓
Complaint
   ↓
Evidence
   ↓
Manager
   ↓
Assignment
   ↓
Progress
   ↓
Repair Evidence
   ↓
Resolved
   ↓
Resident Confirmation
   ↓
Closed / Reopened
```

---

# 21. MEETING ARCHITECTURE

Meetings are associated with governance decisions.

```
Meeting
   │
   ├── Agenda
   ├── Notice
   ├── Proposal
   ├── Supporting Documents
   ├── Voting
   ├── Result
   └── Minutes/Record
```

A meeting may be:

```text
AGM
SGM
Committee Meeting
```

---

# 22. GOVERNANCE RESOLUTION ARCHITECTURE

Governance decisions are represented explicitly rather than treating every
meeting as a vote.

```text
Meeting
   ↓
Agenda / Proposal
   ↓
Governance Resolution
   ├── Decision Type
   ├── Required Body
   ├── Voting Method
   ├── Majority Rule
   ├── Quorum Rule
   ├── Eligibility Rule
   ├── Voting Period
   └── Rule/Configuration Snapshot
           ↓
     Eligibility Calculation
           ↓
        Voting / Decision
           ↓
        Result
           ↓
      Audit / Blockchain
```

This allows the same governance infrastructure to support:

- Project approval
- Budget approval
- Vendor approval
- Quotation-related decisions
- Other configured AGM/SGM resolutions

A governance resolution stores the effective rules used for that particular
decision so that the historical result remains reproducible even if society
configuration changes later.

---

# 23. MEMBERSHIP AND ELIGIBILITY ARCHITECTURE

Ownership, residence and membership are deliberately separate.

```text
User
 ├── Ownership Relationship ──→ Flat
 ├── Residence Relationship ──→ Flat
 └── Membership Relationship → Society
                                  ↓
                         Governance Eligibility
                                  ↓
                         Resolution Eligibility
```

The Eligibility Service determines whether a participant may vote in a
specific resolution.

The architecture supports:

- Primary/joint member ordering
- Associate membership
- Provisional membership
- Membership status
- Resolution-specific eligibility
- One-member-one-vote baseline
- Configurable special eligibility rules

Owning multiple flats must not automatically create multiple governance votes.

---

# 24. RULE CONFIGURATION AND APPROVAL ENGINE

Society governance rules are configuration data, not scattered constants.

The architecture must provide a rule/configuration layer capable of storing
versioned settings such as:

- Project approval threshold/policy
- Required decision body
- Majority rule
- Quorum rule
- Notice period
- Voting method
- Financial visibility
- Procurement/tender requirements
- Complaint reopening authority
- Project completion authority

The Approval Engine consumes the effective configuration.

```text
Project / Quotation
       ↓
Effective Society Rule
       ↓
Approval Engine
       ↓
Required Approval Type
       ↓
Governance Resolution
```

When a decision is finalized, the applicable rule version/snapshot is stored
with the decision. A later configuration change must not rewrite history.

The system remains a modular monolith; this does **not** require a separate
microservice for every rule.

# 25. ELECTION ≠ GOVERNANCE VOTE

Nivaas has two distinct voting domains. They must not be implemented as the same feature.

```
                Nivaas Voting
                       │
             ┌─────────┴─────────┐
             │                   │
     Governance Resolution    Elections
             │                   │
       MVP implementation    Future module
             │                   │
   Configurable method       Secret ballot
             │                   │
  Blockchain audit trail     Anonymous ballot
```

## Governance Resolution Voting — MVP

Governance voting is used for decisions such as:

- Project approvals
- Budget approvals
- Vendor approvals
- Quotation approvals
- Other configured AGM/SGM governance resolutions

The voting method is configurable and may include:

- `SHOW_OF_HANDS`
- `BALLOT`
- `POLL`

The application records the governance vote and calculates the configured result. Important governance results may receive a blockchain-backed audit/proof record.

## Elections — Future Module

Society/committee elections are a separate future module.

The future election architecture must support secret-ballot requirements where applicable and must not expose a public or ordinary application query that maps:

`Voter Identity → Candidate Chosen`

Election ballots must use an anonymous/secret-ballot design rather than reusing the ordinary `GovernanceVote` model.

Election implementation is outside the semester MVP.

## Architectural Constraint

AI coding tools must never infer that "voting" means elections. The current MVP implements **Governance Resolution Voting**, not society elections.

The future election module may introduce separate entities and services such as:

- Election
- Eligible Voter
- Anonymous Ballot
- Election Result

These must remain architecturally separate from `GovernanceResolution` and `GovernanceVote`.


# 26. BLOCKCHAIN TRANSACTION FLOW

When a blockchain-backed operation occurs:

```
Frontend
   ↓
Backend validates operation
   ↓
Blockchain service prepares transaction
   ↓
Wallet signs transaction
   ↓
Smart contract receives transaction
   ↓
Transaction confirmed
   ↓
Transaction hash returned
   ↓
Backend stores blockchain reference
   ↓
Frontend displays confirmation
```

The system must distinguish:

```
PENDING
CONFIRMED
FAILED
```

---

# 27. WALLET ARCHITECTURE

Users participating in blockchain operations may connect a wallet such as MetaMask.
The application should store the user's public wallet address.
Private keys must never be stored by Nivaas.

---

# 28. FILE ARCHITECTURE

During initial development:

```
Frontend
    ↓
Backend upload endpoint
    ↓
File storage
    ↓
Metadata stored in MongoDB
```

The database stores:

- Filename
- File type
- Size
- Storage reference
- Hash
- Uploader
- Timestamp
- Related entity

Actual file storage can initially be local for development.
Cloud/object storage can be introduced later without changing the application's core business logic.

---

# 29. AUDIT ARCHITECTURE

Important actions generate audit records.

```
Action
 ↓
Business Service
 ↓
Database Audit Record
 ↓
Optional Blockchain Proof
```

Example:

```
Project Approved
 ↓
Audit Record
 ↓
Blockchain Transaction
 ↓
Transaction Hash
 ↓
Audit Record Updated
```

---

# 30. ERROR HANDLING

Errors must be handled at each layer.
Example:

```
Frontend
 ↓
API error
 ↓
Readable message
```

Backend errors should use structured responses.
Example:

```
{
  "success": false,
  "error": {
    "code": "SGM_REQUIRED",
    "message": "This project requires an SGM before approval."
  }
}
```

The frontend should display understandable messages.

---

# 31. TRANSACTION CONSISTENCY

Blockchain and database operations cannot always be treated as one atomic transaction.
Therefore blockchain-backed operations should use explicit states.
Example:

```
VOTE_CREATED
      ↓
BLOCKCHAIN_PENDING
      ↓
BLOCKCHAIN_CONFIRMED
```

If blockchain fails:

```text
BLOCKCHAIN_FAILED
```

The application must not display a failed blockchain transaction as
successful.

The backend should retain enough transaction state to reconcile a pending
operation with its eventual blockchain status rather than creating a second
logical governance decision merely because a network request timed out.

---

# 32. SECURITY BOUNDARIES

## Frontend

Untrusted.

## Backend

Trusted application logic.

## Database

Protected persistence layer.

## Smart Contract

Independent blockchain enforcement for blockchain-backed rules.
This means critical permissions should be enforced at more than one layer where appropriate.

---

# 33. MODULARITY

The project shall be organized into modules.
Suggested backend modules:

```text
auth
users
societies
buildings
flats
ownership
residence
membership
committee
governance
rules
budgets
expenses
projects
quotations
vendors
meetings
voting
payments
complaints
notices
evidence
notifications
audit
blockchain
```

`governance`, `rules`, `membership`, `quotations`, `projects` and
`blockchain` are particularly important domain boundaries. They should
communicate through explicit service interfaces rather than arbitrary
cross-module database access.


Modules should avoid unnecessary direct dependencies on unrelated modules.

---

# 34. FRONTEND MODULE STRUCTURE

Suggested structure:

```
src/
├── components/
├── layouts/
├── pages/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── projects/
│   ├── quotations/
│   ├── meetings/
│   ├── voting/
│   ├── complaints/
│   ├── notices/
│   ├── budgets/
│   ├── payments/
│   └── audit/
├── services/
├── hooks/
├── utils/
└── routes/
```

---

# 35. BACKEND STRUCTURE

Suggested structure:

```
backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── middleware/
│   ├── validators/
│   ├── utils/
│   └── blockchain/
│
├── tests/
└── server.js
```

---

# 36. BLOCKCHAIN STRUCTURE

Suggested structure:

```
blockchain/
├── contracts/
├── scripts/
├── test/
├── deployments/
└── hardhat.config
```

The actual contract count will be determined in `BLOCKCHAIN.md`.

---

# 37. DEVELOPMENT ENVIRONMENT

Initial development should use:

```
React/Vite
+
Node/Express
+
MongoDB
+
Hardhat Local Network
+
MetaMask
```

No real cryptocurrency is required for local development.

---

# 38. ENVIRONMENT VARIABLES

Secrets/configuration must be kept outside source code.
Examples:

```
DATABASE_URL
JWT_SECRET
BLOCKCHAIN_RPC_URL
CONTRACT_ADDRESS
CHAIN_ID
FILE_STORAGE_PATH
```

Private keys must never be committed to Git.

---

# 39. VERSION CONTROL

Git must be used throughout development.
Recommended workflow:

```
main
 │
 ├── feature/auth
 ├── feature/projects
 ├── feature/voting
 ├── feature/complaints
 └── feature/blockchain
```

Features should be merged only after testing.

---

# 40. CHANGE CONTROL

Before changing a major behavior:

1. Identify affected requirement.
2. Update documentation.
3. Explain architectural impact.
4. Implement change.
5. Run affected tests.
6. Update related documentation.

---

# 41. AI DEVELOPMENT CONSTRAINT

AI coding tools must:

- Read documentation before coding.
- Follow existing architecture.
- Avoid rewriting unrelated modules.
- Avoid inventing APIs.
- Avoid inventing database fields.
- Avoid changing business rules.
- Report files changed.
- Report tests performed.
- Stop and ask when requirements conflict.

---

# 42. CORE ARCHITECTURAL RULE

> **The frontend presents the system, the backend enforces application and governance rules, MongoDB/off-chain storage holds normal application data and historical rule snapshots, and blockchain provides an independently verifiable trust layer for selected important governance events and integrity proofs. Governance Resolution Voting and future secret-ballot Elections are separate architectural domains.**

---

# 43. ARCHITECTURE STATUS

Version 1.4 — Active Planning Document. Revised to align with SRS v1.3 and Business Rules v1.4, explicitly introducing the modular-monolith domain structure, membership/eligibility layer, versioned rule configuration, Approval Engine, Governance Resolution architecture, blockchain transaction boundaries, separate platform/society authorization scopes, and user-established initial credentials.
Any major architectural change must update this document and the affected technical specifications.
