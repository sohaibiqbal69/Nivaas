# BLOCKCHAIN.md

**Version:** 1.2\
**Status:** Active Planning Document --- Revised Governance & Integrity
Architecture

------------------------------------------------------------------------

# 1. PURPOSE

This document defines how blockchain is used inside **Nivaas**.

Nivaas is a **hybrid blockchain application**, not a fully
on-chain society-management system.

MongoDB and off-chain file storage remain responsible for normal
application data. Blockchain is used selectively where an independently
verifiable, tamper-resistant commitment provides meaningful value.

The blockchain layer must remain consistent with `BUSINESS_RULES.md`,
`SRS.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, and
`VERSIONING.md`.

------------------------------------------------------------------------

# 2. CORE BLOCKCHAIN PRINCIPLE

> **Blockchain provides independently verifiable proof of selected
> important governance, approval, payment-reference, evidence, and audit
> events. It does not replace the application's governance engine or
> database.**

Blockchain does not replace authentication, authorization, membership
management, governance eligibility, society-rule configuration, approval
evaluation, meetings, voting logic, file storage, or application
business logic.

The backend remains responsible for evaluating the effective society
rules before a blockchain-backed record is submitted.

------------------------------------------------------------------------

# 3. BLOCKCHAIN'S ROLE

``` text
APPLICATION / MONGODB
├── Users and authentication references
├── Societies / buildings / flats
├── Ownership / residence / membership
├── Society rule versions
├── Budgets / expenses
├── Projects
├── Quotations / versions / change requests
├── Complaints / notices
├── Meetings / attendance
├── Proposals / resolutions
├── Individual vote records
├── Evidence / documents
├── Payments
└── Complete audit history

                +

BLOCKCHAIN TRUST LAYER
├── Selected resolution commitments
├── Final governance-result proofs
├── Approval decision proofs
├── Selected quotation/change proofs
├── Selected payment-reference proofs
├── Evidence/document hashes
├── Important audit-event hashes
└── Rule/eligibility snapshot hashes
```

Blockchain is a **trust and verification layer**, not the primary
application database.

------------------------------------------------------------------------

# 4. WHAT BLOCKCHAIN PROVES

Blockchain can prove that a commitment was submitted to the configured
network, accepted by the smart contract, included in a confirmed
transaction, and has not been silently changed on-chain.

It does **not** independently prove that the underlying real-world event
was truthful or legally valid.

For example:

``` text
MongoDB:
Quotation V2 = ₹3,80,000
        ↓
Canonical snapshot
        ↓
Hash = 0xABC...
        ↓
Blockchain commitment = 0xABC...
```

A match supports integrity of the recorded snapshot. It does not prove
that the vendor actually quoted that amount or that the quotation was
legally valid.

------------------------------------------------------------------------

# 5. TRUST MODEL

``` text
User
 ↓
React Frontend
 ↓
Authentication
 ↓
Authorization
 ↓
Membership / Eligibility
 ↓
Effective Rule Version
 ↓
Business / Approval Validation
 ↓
Immutable Application Snapshot
 ↓
Canonical Payload
 ↓
Blockchain Service
 ↓
Authorized Signer
 ↓
Smart Contract
 ↓
Blockchain Network
 ↓
Confirmation
 ↓
Blockchain Reference
 ↓
MongoDB
```

Eligibility and governance decisions are established before blockchain
recording. The blockchain preserves proof of the resulting state; it
does not independently determine who was eligible to vote.

------------------------------------------------------------------------

# 6. MVP BLOCKCHAIN USE CASES

## 6.1 Governance Resolution Proof

A finalized resolution may commit:

-   resolution reference hash;
-   society/project reference hash;
-   resolution type;
-   effective rule-version hash;
-   eligibility-snapshot hash;
-   resolution snapshot hash;
-   final outcome;
-   aggregate vote totals where appropriate;
-   timestamp.

Complete meeting and voter records remain off-chain.

## 6.2 Governance Result Proof

``` text
Eligibility snapshot
        ↓
Voting
        ↓
Voting closes
        ↓
Quorum / majority evaluation
        ↓
Result finalized
        ↓
Canonical vote/result snapshot
        ↓
Blockchain commitment
```

## 6.3 Approval Decision Proof

Important project approvals can commit the project, approval decision,
quotation version, effective rule version, approval type, outcome, and
relevant resolution reference.

Each re-approval is a new historical decision.

## 6.4 Quotation / Change-Request Proof

``` text
Quotation V1
    ↓
Change Request
    ↓
Quotation V2
    ↓
Rule-version-aware re-evaluation
    ↓
New approval decision
    ↓
Blockchain proof where applicable
```

Quotation history remains in MongoDB.

## 6.5 Payment Reference Proof

Blockchain may commit the integrity of a selected payment record. It
does not replace the application's payment ledger or prove that an
external bank settlement occurred merely because a blockchain
transaction succeeded.

## 6.6 Evidence / Document Integrity

``` text
Photo / PDF
    ↓
Off-chain storage
    ↓
SHA-256 hash
    ↓
MongoDB evidence metadata
    ↓
Optional blockchain commitment
```

## 6.7 Audit Proof

Selected high-value events may be committed:

``` text
PROJECT_CREATED
QUOTATION_REVISED
APPROVAL_DECIDED
GOVERNANCE_RESULT_FINALIZED
PAYMENT_RECORDED
PROJECT_COMPLETED
```

Not every CRUD event should become a blockchain transaction.

AuditLog and complete audit history remain off-chain. Only selected
high-value audit-event hashes/references may be anchored on-chain; complete
audit records and personal information must not be stored on-chain.
Blockchain anchoring supports integrity/existence verification of the
recorded commitment. It does not prove the underlying event's truth, legal
validity, or correctness beyond the committed data.

An existing AuditLog record must not be mutated solely to attach or update
blockchain proof information. The original event remains unchanged. The
documented `blockchainTransactionHash` field is retained; association of a
transaction hash produced after event creation is not defined by this
foundation.

------------------------------------------------------------------------

# 7. ON-CHAIN VS OFF-CHAIN

## Off-chain

-   personal information;
-   authentication data;
-   ownership, residence, membership;
-   society rule configuration;
-   budgets and expenses;
-   complaints and notices;
-   quotation files and descriptions;
-   vendor details;
-   projects;
-   meetings and attendance;
-   individual votes;
-   photos and PDFs;
-   invoices;
-   complete payment details;
-   complete audit history.

## On-chain

-   record identifier hashes;
-   canonical record hashes;
-   rule-version hashes;
-   eligibility-snapshot hashes;
-   governance-result hashes;
-   approval decision hashes;
-   selected quotation-version hashes;
-   payment-reference hashes;
-   evidence/document hashes;
-   selected audit-event hashes;
-   final aggregate governance result where appropriate.

No personal profile, phone number, email, document contents, or large
text field should be stored directly.

------------------------------------------------------------------------

# 8. GOVERNANCE RECORD MODEL

``` text
Membership
    ↓
Governance Eligibility
    ↓
Eligibility Snapshot
    ↓
Governance Resolution
    ↓
Voting
    ↓
Final Result
    ↓
Approval Decision
    ↓
Blockchain Proof
```

The smart contract should not be asked whether someone is a valid
member. That is an application-level determination.

------------------------------------------------------------------------

# 9. RULE-VERSION COMMITMENT

Governance decisions must reference the effective rule version used for
the decision.

``` text
Project Amount
      ↓
Effective Rule Version V7
      ↓
Approval Evaluation
      ↓
Required Governance
      ↓
Resolution
      ↓
Final Result
      ↓
Blockchain Commitment
```

A rule-version hash prevents later configuration changes from making an
old decision appear to have used different rules.

------------------------------------------------------------------------

# 10. ELIGIBILITY SNAPSHOT

Eligibility can change over time. Therefore each governance resolution
should have an immutable eligibility snapshot.

``` text
Membership Data
      ↓
Eligibility Calculation
      ↓
Eligibility Snapshot
      ↓
Snapshot Hash
      ↓
Governance Resolution
      ↓
Blockchain Commitment
```

Personal membership details remain off-chain.

------------------------------------------------------------------------

# 11. VOTING PRIVACY

The MVP distinguishes:

``` text
Governance Result
```

from:

``` text
Individual Voter Choice
```

Recommended MVP approach:

``` text
Individual vote records
        ↓
MongoDB
        ↓
Canonical vote-ledger snapshot
        ↓
Vote-ledger hash
        ↓
Blockchain
```

This provides integrity verification without unnecessarily publishing
voter identities and choices.

Future secret-ballot elections must never expose:

``` text
Voter Identity → Candidate Choice
```

------------------------------------------------------------------------

# 12. CANONICAL HASHING

Any record committed to blockchain must first become a deterministic
canonical representation.

``` text
Application Snapshot
       ↓
Canonical serialization
       ↓
Cryptographic hash
       ↓
Blockchain commitment
```

Canonicalization must define field ordering, types, dates/times,
monetary representation, null handling, identifier representation, and
excluded volatile fields.

Arbitrary JavaScript object serialization must not be treated as the
canonical method.

------------------------------------------------------------------------

# 13. HASHING STANDARD

For structured application records, the implementation may use:

``` text
keccak256(canonical payload)
```

For files:

``` text
SHA-256(file bytes)
```

The final implementation must document one consistent convention so
backend, verification service, and Solidity agree on the resulting
`bytes32` value.

------------------------------------------------------------------------

# 14. SMART CONTRACT RESPONSIBILITIES

The contract should:

-   accept selected commitments;
-   store immutable records;
-   record selected governance outcomes;
-   record selected approval proofs;
-   record selected payment/evidence references;
-   emit events;
-   enforce contract-level access control;
-   prevent duplicate logical records where required;
-   prevent modification of confirmed records;
-   expose read/verification functions.

It must not reproduce the entire backend.

------------------------------------------------------------------------

# 15. BACKEND RESPONSIBILITIES

The backend remains responsible for:

-   authentication and authorization;
-   membership;
-   ownership/residence relationships;
-   governance eligibility;
-   rule-version selection;
-   approval engine;
-   project workflow;
-   quotation versioning;
-   meetings;
-   quorum;
-   voting periods;
-   duplicate-vote prevention;
-   result finalization;
-   audit records;
-   file metadata;
-   canonical snapshot generation;
-   blockchain payload preparation;
-   transaction tracking;
-   blockchain-reference linking;
-   verification orchestration.

------------------------------------------------------------------------

# 16. SMART CONTRACT DESIGN

The MVP should prefer a small number of understandable contracts.

Initial design:

``` text
contracts/
└── NivaasGovernance.sol
```

Logical record types may include:

``` text
Governance Resolution
Approval Decision
Quotation Proof
Payment Reference
Evidence Proof
Audit Proof
```

Separate contracts should only be introduced when there is a meaningful
technical reason.

------------------------------------------------------------------------

# 17. CONCEPTUAL ON-CHAIN RECORD

A governance record may contain:

``` text
recordIdHash
recordType
societyIdHash
entityIdHash
dataHash
ruleVersionHash
eligibilitySnapshotHash
result / outcome
recordedAt
```

A governance-result record may additionally contain:

``` text
yesCount
noCount
abstainCount
quorumMet
passed
voteLedgerHash
```

Exact Solidity types and fields must be frozen before contract
implementation.

------------------------------------------------------------------------

# 18. CONTRACT EVENTS

Conceptual events:

``` text
ResolutionRecorded
GovernanceResultRecorded
ApprovalRecorded
QuotationProofRecorded
PaymentReferenceRecorded
EvidenceProofRecorded
AuditProofRecorded
```

Events should contain only the information necessary for indexing and
verification.

------------------------------------------------------------------------

# 19. CONTRACT ACCESS CONTROL

Use explicit roles such as:

``` text
DEFAULT_ADMIN_ROLE
BACKEND_OPERATOR_ROLE
```

The frontend user must never automatically receive unrestricted contract
privileges.

Blockchain access must not become an administrative bypass.

------------------------------------------------------------------------

# 20. WALLET / SIGNER ARCHITECTURE

MetaMask remains part of the planned technology stack.

For the MVP, a controlled backend blockchain service may submit
application commitments:

``` text
JWT-authenticated action
        ↓
Backend validates state
        ↓
Canonical payload
        ↓
Authorized blockchain signer
        ↓
Smart contract
```

If direct user signing is introduced later, its identity, signature
payload, verification method, and privacy implications must be
explicitly specified.

Private keys and seed phrases must never be stored by Nivaas.

------------------------------------------------------------------------

# 21. TRANSACTION LIFECYCLE

``` text
NOT_STARTED
     ↓
PREPARED
     ↓
SUBMITTED
     ↓
PENDING
     ↓
CONFIRMED
     ↓
VERIFIED
```

Failure:

``` text
SUBMITTED / PENDING
        ↓
FAILED
```

Verification mismatch:

``` text
CONFIRMED
    ↓
Historical snapshot rechecked
    ↓
MISMATCH
```

A failed transaction must never be displayed as confirmed.

------------------------------------------------------------------------

# 22. LOGICAL OPERATION VS TRANSACTION

A logical operation and a blockchain transaction are separate.

``` text
Logical Approval A001
        │
        ├── Attempt 1 → FAILED
        │
        └── Attempt 2 → CONFIRMED
```

Store both:

``` text
logicalOperationId
transactionHash
```

This supports safe retries.

------------------------------------------------------------------------

# 23. IDEMPOTENCY

Before submitting:

``` text
logicalOperationId + payloadHash
```

must be checked.

If already confirmed:

``` text
Do not submit again.
```

If pending:

``` text
Track the existing transaction.
```

If failed:

``` text
Controlled retry is allowed.
```

A changed payload must receive a new logical operation identity.

------------------------------------------------------------------------

# 24. DATABASE + BLOCKCHAIN CONSISTENCY

MongoDB and blockchain are not one atomic transaction.

``` text
Finalize application snapshot
        ↓
Create blockchain operation
        ↓
Submit transaction
        ↓
PENDING
        ↓
CONFIRMED
        ↓
Store blockchain reference
```

If submission fails, the application must retain the failure state and
must not display the record as blockchain-confirmed.

------------------------------------------------------------------------

# 25. RECONCILIATION

The system should be able to compare:

``` text
MongoDB blockchain reference
        ↕
Transaction
        ↕
Smart-contract record
        ↕
Expected payload hash
```

Useful outcomes:

``` text
REFERENCE_NOT_FOUND
TRANSACTION_FAILED
CONTRACT_RECORD_NOT_FOUND
HASH_MISMATCH
RECORD_VERIFIED
```

------------------------------------------------------------------------

# 26. VERIFICATION

``` text
Historical application snapshot
        ↓
Canonical reconstruction
        ↓
Expected hash
        ↓
Read blockchain commitment
        ↓
Compare
        ↓
MATCH / MISMATCH
```

A successful verification means the application snapshot matches the
blockchain commitment. It does not prove the real-world event was
truthful.

------------------------------------------------------------------------

# 27. DEPLOYMENT NETWORK

Initial development:

``` text
Hardhat Local Network
```

This provides:

-   no real cryptocurrency;
-   fast testing;
-   deterministic development;
-   easy contract redeployment;
-   suitable semester demonstration.

A public testnet is optional and must not be required for the core
demonstration.

------------------------------------------------------------------------

# 28. CONTRACT DEPLOYMENT RECORD

Record:

``` text
Network
Chain ID
Contract name
Contract address
Deployment transaction hash
Deployment block
Contract version
ABI version/reference
Deployment timestamp
```

Network configuration must be centralized rather than scattered through
frontend components.

------------------------------------------------------------------------

# 29. CONTRACT VERSIONING

``` text
BLOCKCHAIN.md update
        ↓
Solidity implementation
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

Deployed contracts should be treated as historically immutable.

A new contract version means:

``` text
Contract V1
   ↓
Historical records remain on V1

Contract V2
   ↓
New records use V2
```

------------------------------------------------------------------------

# 30. BACKEND BLOCKCHAIN MODULE

Suggested structure:

``` text
backend/src/blockchain/

├── config/
├── contracts/
│   ├── abi/
│   └── deployments/
├── services/
│   ├── governanceService
│   ├── approvalService
│   ├── paymentService
│   └── verificationService
├── canonical/
├── hashing/
├── reconciliation/
└── index
```

The important architectural boundary is:

``` text
Application modules
        ↓
Blockchain service
        ↓
ethers.js
        ↓
Smart contract
```

------------------------------------------------------------------------

# 31. API INTEGRATION

Application-level endpoints include:

``` text
GET /blockchain/status
GET /blockchain/transactions/:hash
GET /blockchain/verify/:recordId
```

Additional endpoints should only be introduced through the normal API
versioning process.

Frontend code should not contain scattered contract addresses or
duplicated business rules.

------------------------------------------------------------------------

# 32. BLOCKCHAIN UI STATES

The UI must distinguish:

``` text
Not Recorded
Preparing
Pending
Confirmed
Failed
Verification Mismatch
Verified
```

Example:

``` text
Project Approval

Blockchain Status: Verified
Network: Hardhat Local Network
Contract: 0x....
Transaction: 0x....
Block: 123
Commitment: 0xABC...
Verification: MATCH
```

The UI must explain what the verification actually proves.

------------------------------------------------------------------------

# 33. END-TO-END GOVERNANCE FLOW

``` text
Project Created
      ↓
Quotation Added
      ↓
Effective Rule Version identified
      ↓
Approval Engine evaluates
      ↓
Required governance action determined
      ↓
Resolution created if required
      ↓
Eligibility snapshot created
      ↓
Eligible members vote
      ↓
Voting closes
      ↓
Quorum / majority evaluated
      ↓
Result finalized
      ↓
Approval Decision created
      ↓
Historical snapshot generated
      ↓
Blockchain proof submitted
      ↓
Transaction confirmed
      ↓
Blockchain reference stored
      ↓
Project approval state updated
```

The blockchain is one stage in the workflow, not the workflow itself.

------------------------------------------------------------------------

# 34. QUOTATION REVISION EXAMPLE

``` text
Quotation V1
₹90,000
      ↓
Change Request
+₹20,000
      ↓
Quotation V2
₹1,10,000
      ↓
Rule-version-aware re-evaluation
      ↓
New approval requirement if applicable
      ↓
New governance / approval decision
      ↓
Blockchain proof
```

Both versions remain available. The old proof is not overwritten.

------------------------------------------------------------------------

# 35. SECURITY REQUIREMENTS

Protect against:

-   unauthorized contract calls;
-   duplicate logical operations;
-   inappropriate replay;
-   malformed payloads;
-   incorrect references;
-   unauthorized signer use;
-   private-key exposure;
-   incorrect network configuration;
-   contract access-control failures;
-   incorrect hash construction;
-   verification against mutable data.

Backend validation is mandatory before blockchain submission.

------------------------------------------------------------------------

# 36. PRIVATE DATA RESTRICTIONS

Avoid storing on-chain:

-   names;
-   phone numbers;
-   emails;
-   residential addresses;
-   complaint descriptions;
-   personal documents;
-   sensitive financial information;
-   authentication data;
-   private credentials.

Prefer IDs, hashes, and snapshot references.

------------------------------------------------------------------------

# 37. TESTING REQUIREMENTS

## Contract tests

-   authorized write;
-   unauthorized write;
-   duplicate record rejection;
-   immutable record behavior;
-   event emission;
-   malformed payload rejection;
-   role enforcement;
-   verification/read functions;
-   result consistency.

## Backend integration tests

-   canonical payload generation;
-   deterministic hashing;
-   transaction submission;
-   pending/confirmed/failed states;
-   retries;
-   idempotency;
-   MongoDB reference linking;
-   verification;
-   hash mismatch detection;
-   reconciliation.

## Governance integration test

``` text
Membership
→ Eligibility
→ Rule Version
→ Resolution
→ Vote
→ Result
→ Approval
→ Blockchain Commitment
→ Verification
```

## Frontend tests

-   pending;
-   confirmed;
-   failed;
-   verified;
-   mismatch;
-   transaction details.

------------------------------------------------------------------------

# 38. DEMONSTRATION REQUIREMENT

The strongest demonstration should show:

``` text
Create Project
      ↓
Add Quotation
      ↓
Approval Engine
      ↓
Governance Resolution
      ↓
Eligibility Snapshot
      ↓
Vote
      ↓
Finalize Result
      ↓
Approval Decision
      ↓
Record on Hardhat
      ↓
Show Transaction Hash
      ↓
Verify Hash
      ↓
MATCH
```

A controlled test can then modify a historical off-chain snapshot and
demonstrate:

``` text
Recalculated Hash ≠ Blockchain Commitment
                    ↓
          VERIFICATION MISMATCH
```

This demonstrates the actual value of the blockchain layer.

------------------------------------------------------------------------

# 39. LIMITATIONS

The blockchain layer is an academic prototype component.

Before real-world deployment, independently review:

-   smart-contract security;
-   privacy;
-   wallet/signing architecture;
-   governance implementation;
-   cooperative-society requirements;
-   applicable laws/by-laws;
-   financial integrations;
-   public-chain data exposure.

A blockchain record does not automatically make a society decision
legally valid.

------------------------------------------------------------------------

# 40. FINAL ARCHITECTURAL BOUNDARY

``` text
                 NIVAAS
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
 Application / MongoDB         Blockchain
        │                           │
 Governance Engine            Integrity Layer
 Membership                   Commitments
 Rule Versions                Final Results
 Eligibility                  Approval Proofs
 Meetings                     Evidence Hashes
 Voting                       Audit Proofs
 Projects                     Verification
 Payments
```

The application determines what happened according to the configured
governance model.

The blockchain provides an independently verifiable commitment to
selected historical records.

------------------------------------------------------------------------

# 41. CORE BLOCKCHAIN RULES

1.  Do not store normal application data on-chain merely because
    blockchain is available.
2.  Do not store personal information unnecessarily.
3.  Do not turn the smart contract into a second backend.
4.  Do not allow blockchain access to bypass governance.
5.  Never overwrite a confirmed blockchain record.
6.  Separate logical operations from transaction attempts.
7.  Preserve rule-version and eligibility references.
8.  Use deterministic canonical hashing.
9.  Keep individual governance votes off-chain unless a later
    privacy-reviewed design requires otherwise.
10. Treat blockchain verification as integrity verification, not proof
    of real-world truth.
11. Prefer meaningful complexity---history, versioning, snapshots,
    verification, reconciliation---over unnecessary contract
    fragmentation.

------------------------------------------------------------------------

# 42. CHANGE CONTROL

Changes to on-chain data, smart-contract functions, events, hashing
rules, governance-proof design, voting privacy, wallet architecture,
deployment network, or transaction lifecycle must be reflected through
`VERSIONING.md`.

Dependent documents may include:

``` text
BLOCKCHAIN.md
SRS.md
BUSINESS_RULES.md
ARCHITECTURE.md
DATABASE.md
API.md
Frontend
Backend
Smart Contracts
Tests
```

------------------------------------------------------------------------

# 43. BLOCKCHAIN STATUS

**Version:** 1.2\
**Status:** Active Planning Document

This version aligns the blockchain layer with the revised membership,
eligibility, rule-version, approval, quotation-versioning,
governance-resolution, audit, and historical-integrity architecture.

The exact Solidity interface and on-chain payload schema must be frozen
before smart-contract implementation.
