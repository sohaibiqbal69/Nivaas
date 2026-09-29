# Nivaas — Codex Development Instructions

## 1. Project Identity

Project name: Nivaas.

Nivaas is a blockchain-assisted digital governance and transparency
platform for housing societies.

Blockchain is an integrity/proof layer. It is not the primary
application database and must not become the application's governance
engine.

---

## 2. Source of Truth

Before making implementation decisions, read the relevant documents
inside `/docs`.

The controlled specification set is:

- `docs/BUSINESS_RULES.md`
- `docs/SRS.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/BLOCKCHAIN.md`
- `docs/UI_UX.md`
- `docs/VERSIONING.md`

These documents define what Nivaas is supposed to do.

Do not invent business rules, governance rules, database entities,
API contracts, approval thresholds, voting rules, or blockchain
behavior.

If requirements conflict or appear incomplete in a way that affects
implementation, STOP and report the conflict instead of silently
choosing a solution.

---

## 3. Specification Hierarchy

When implementation and documentation disagree, do not silently change
the documentation or implementation.

Use the hierarchy defined by `docs/VERSIONING.md`.

The coding agent must treat AI-generated assumptions as the lowest
authority.

---

## 4. Development Philosophy

Nivaas must be developed incrementally.

Prefer:

- small changes
- reusable existing code
- simple implementations
- clear module boundaries
- meaningful complexity
- reversible changes
- explicit validation
- tests before declaring work complete

Avoid:

- unnecessary abstractions
- duplicate components
- duplicate utilities
- unnecessary dependencies
- premature microservices
- unnecessary blockchain complexity
- rewriting unrelated code
- speculative features
- "improvements" not requested by the specification

Do not remove meaningful complexity merely because it is difficult.

Features such as rule versioning, historical records, eligibility
snapshots, approval evaluation, quotation versioning, auditability and
blockchain verification are intentional parts of the system.

---

## 5. Existing Code First

Before creating a new component, service, utility, hook, model,
middleware or abstraction:

1. Inspect the existing code.
2. Search for something that already performs the required function.
3. Reuse or extend it when appropriate.
4. Create something new only when necessary.

Do not create multiple implementations of the same concept.

---

## 6. Architecture

Follow `docs/ARCHITECTURE.md`.

The intended architecture separates:

- Frontend
- API layer
- Business logic
- Data access
- Blockchain integration
- File/storage handling

Do not move business rules into React merely for convenience.

Do not put large amounts of business logic inside Express route
handlers.

Do not allow frontend state to become the authoritative source for
authorization, governance eligibility, approval requirements, voting
state, payment state or blockchain state.

---

## 7. Backend Authority

The backend is authoritative for:

- authentication
- authorization
- membership
- governance eligibility
- approval requirements
- project state
- quotation state
- voting state
- payment state
- blockchain state

Frontend validation improves user experience but does not replace
backend validation.

---

## 8. Governance

Do not assume that a user's application role alone determines
governance eligibility.

Nivaas separates:

- User
- Ownership
- Residence/Occupancy
- Society Membership
- Governance Eligibility

Follow the effective society rule version when evaluating governance
behavior.

Do not hard-code governance thresholds that are defined as
configurable.

Historical governance decisions must retain the relevant rule/configuration
context defined by the specifications.

Do not allow technical administrators to bypass governance.

---

## 9. Voting

Follow the governance and voting architecture in the specification.

Do not convert ordinary governance resolutions into a separate
election system.

Maintain the one-member-one-vote model where applicable.

Do not allow duplicate votes.

Do not allow frontend state to determine voting eligibility.

Do not alter completed voting results through normal CRUD operations.

---

## 10. Quotations and Projects

Quotation revisions must preserve historical versions.

Do not overwrite an important quotation version when the specification
requires a revision.

If a quotation or project amount changes in a way that affects approval,
the approval requirement must be re-evaluated according to the
applicable rule version.

Do not bypass the approval workflow by directly changing a governed
status field.

---

## 11. Blockchain

Follow `docs/BLOCKCHAIN.md`.

Blockchain is an integrity/proof layer.

MongoDB remains the primary application database.

Do not put unnecessary personal information, large files or complete
application records on-chain.

Individual governance votes remain off-chain unless the approved
blockchain specification explicitly changes this.

Use deterministic canonical hashing where specified.

Never fake blockchain confirmation or blockchain transaction status.

A blockchain proof establishes the integrity of the committed reference;
it does not automatically establish the truth or legal validity of the
underlying real-world event.

---

## 12. UI/UX

Follow `docs/UI_UX.md`.

The UI must use the approved Nivaas visual system.

Do not introduce:

- another design system
- another UI framework
- another font system
- another color palette
- another animation library

without explicit approval.

Anime.js is the selected animation library.

Do not introduce Framer Motion or GSAP.

Animation is presentation only and must not control business state,
API behavior, governance logic or blockchain state.

Respect reduced-motion preferences.

Accessibility is a requirement, not optional polish.

---

## 13. Dependencies

Do not add a dependency simply because it is convenient.

Before adding a dependency:

1. Check whether the existing stack already provides the capability.
2. Check whether an existing project dependency can provide it.
3. Determine whether the dependency materially improves the project.
4. Prefer established, appropriate dependencies when one is genuinely
   required.

Report significant new dependencies before introducing them.

---

## 14. API and Database Contracts

Follow `docs/API.md` and `docs/DATABASE.md`.

Do not silently:

- rename API endpoints
- change request/response contracts
- rename database fields
- remove entities
- change relationships
- change status meanings
- change business rules

If a schema or API change is genuinely required, identify the affected
specifications and update them through the controlled change process.

---

## 15. Change Control

For meaningful changes:

1. Identify the affected requirement/rule.
2. Identify affected specifications.
3. Implement the smallest appropriate change.
4. Run relevant tests/checks.
5. Review the resulting diff.
6. Update documentation if required.
7. Report what changed.

Follow `docs/VERSIONING.md`.

---

## 16. Testing

Do not declare a feature complete merely because the code was written.

Run appropriate:

- unit tests
- integration tests
- API tests
- frontend tests
- end-to-end tests
- build/type checks

depending on the affected area.

When possible, test both successful and rejected/unauthorized paths.

---

## 17. Git Discipline

Use Git throughout development.

Prefer focused commits corresponding to meaningful completed changes.

Do not mix unrelated changes into a feature.

Never commit:

- passwords
- private keys
- API secrets
- `.env` secrets
- wallet private keys

---

## 18. AI Development Rules

The coding agent must:

- read relevant documentation before coding
- inspect existing code before creating new code
- follow the specifications
- reuse existing implementations where appropriate
- avoid unnecessary complexity
- avoid unrelated rewrites
- report contradictions
- report important assumptions
- report changed files
- report tests/checks performed

The coding agent must NOT:

- invent requirements
- silently change requirements
- silently change architecture
- silently change API contracts
- silently change database design
- fabricate blockchain activity
- remove meaningful project complexity merely to make implementation easier

If the agent believes the specification should change, explain why and
ask for approval rather than silently changing it.

---

## 19. Working Style

Work in small, understandable stages.

Before large implementation tasks, explain:

- what will be changed
- which files will be affected
- why the change is needed
- which specifications govern it

Then implement only the approved scope.

After implementation, report:

- files changed
- functionality implemented
- tests/checks run
- remaining issues
- any specification questions

Do not continue into unrelated work automatically.