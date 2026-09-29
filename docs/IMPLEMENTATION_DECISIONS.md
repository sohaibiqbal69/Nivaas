\# Nivaas — Implementation Decisions



Version: 1.0

Status: Implementation Baseline

Date: 2026-09-30



This document records implementation decisions that supplement the

Nivaas project specifications.



It must not override established business rules or governance

requirements in the controlled specification set.



\---



\## 1. Technology Decisions



\### Language



Use TypeScript for both frontend and backend.



Reason:

Nivaas has significant contracts between frontend, API, business logic,

database models, governance workflows and blockchain services.

Type safety is valuable for maintaining those boundaries.



\### Frontend



React + Vite.



\### Styling



Tailwind CSS.



\### Component System



shadcn/ui.



Do not introduce another UI component framework.



\### Routing



React Router.



\### HTTP Client



Use the native Fetch API.



Do not add Axios unless a concrete project requirement demonstrates

that Fetch is insufficient.



\### Backend



Node.js + Express.



\### Database



MongoDB with Mongoose.



MongoDB remains the primary application database.



\### Authentication



Use JWT-based authentication.



Authentication and authorization must remain separate concepts.



The backend remains authoritative for authorization.



\### Blockchain



Use Solidity + Hardhat + ethers.js.



Begin with a local Hardhat network.



Do not introduce public blockchain deployment during initial

application development.



\### Wallet



MetaMask for wallet interaction where required.



\### Animation



Anime.js is the only animation library.



Do not introduce Framer Motion, GSAP, or another animation library

without explicit approval.



\### Testing



Use Vitest for unit/integration-oriented JavaScript/TypeScript tests

where appropriate.



Use Playwright for browser-level end-to-end testing.



\---



\## 2. Governance Decisions Still Requiring Finalization



The following must NOT be invented by the coding agent:



\- committee majority formula

\- special-resolution majority formula

\- special quorum formula

\- detailed eligibility outcomes for joint members

\- detailed eligibility outcomes for associate members

\- detailed eligibility outcomes for provisional members

\- authority required to change governance-rule versions

\- exact relationship between General Body and SGM terminology in each

&#x20; approval route

\- project-completion authority

\- budget-overrun approval workflow



Until finalized, these are configuration/specification questions.



\---



\## 3. Approval Threshold



The ₹1,00,000 threshold is treated as a configurable prototype

society rule.



It must NOT be represented as a universal Maharashtra statutory rule.



The effective society rule version determines the applicable approval

route.



\---



\## 4. Blockchain Principle



Blockchain is an integrity/proof layer.



MongoDB remains the authoritative application data store.



Do not move the application into a blockchain-first architecture.



Do not put personal information, complete application records,

document contents or individual votes on-chain merely for the sake of

using blockchain.



\---



\## 5. Development Principle



Meaningful domain complexity must be preserved.



Do not remove:



\- rule versioning

\- governance eligibility

\- approval evaluation

\- quotation versioning

\- change requests

\- historical snapshots

\- auditability

\- blockchain integrity proofs



merely because implementation is more difficult.



Avoid unnecessary technical complexity that does not contribute to the

specified system.

