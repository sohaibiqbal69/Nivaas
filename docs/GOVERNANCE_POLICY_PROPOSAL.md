# Nivaas Governance Policy Contract — Review Proposal

**Status:** Proposal for project-owner/supervisor review; not an approved specification  
**Prepared:** 18 October 2026  
**Scope:** Ordinary committee and general-body governance resolutions, including project approval. Elections and secret-ballot election infrastructure are out of scope. This document does not change runtime behavior.

This proposal separates (1) existing Nivaas requirements, (2) legal material checked for context, and (3) proposed MVP product decisions. A Maharashtra model bye-law is not automatically the registered bye-law of every society. Before deployment for a society, its registered bye-laws, amendments, applicable Act/Rules and decision-specific requirements must be confirmed. This document is not legal advice.

## 1. Existing Nivaas contract

The controlled project documents already require the following:

- A meeting is context for one or more agenda items and decisions; the meeting itself is not a vote. A proposal may connect the meeting and project to a formal resolution.
- Resolution creation records the applicable decision body, voting method, majority rule, quorum rule, eligibility rule, voting period and effective society-rule version. Before opening, the backend persists resolution-specific eligibility evidence. Votes are authenticated, checked server-side, and cannot be duplicated where the configured rule is one vote per participant. Results are calculated from recorded votes, never supplied by a client.
- Ordinary governance has a one eligible member, one vote baseline. Proxy voting is not supported. Ownership, residence, membership and governance eligibility are distinct. Eligibility must use membership records and the applicable rule; it cannot be inferred from residence or number of flats. Financial default alone does not automatically remove voting rights. Committee conflicts are handled only where the applicable rule requires exclusion.
- The initial general-body quorum is documented as **two-thirds of total members of the Society or 20, whichever is less**. It is configurable and versioned. The docs also say to use the applicable membership population, not flats or residents. They do not define whether “total members” means active members, eligible voters, or all member records at the snapshot date, nor how a fractional two-thirds count is rounded.
- A project cannot be approved by administrative action or merely by an approval-route evaluation. The approval engine creates an immutable `ApprovalDecision`; a project requires the configured governance process to be completed.
- Elections are separate and out of the semester MVP. Governance votes may use show of hands, ballot or poll according to configured rules; the project does not assume all governance votes are secret.
- Important governance outcomes may be represented on-chain, but blockchain is only an integrity/proof layer. It cannot establish the truth or legal validity of a meeting or decision.

Relevant unresolved items already listed in `docs/IMPLEMENTATION_DECISIONS.md` include committee and special-resolution majority formulas, special quorum, eligibility for joint/associate/provisional members, authority to change rule versions, and the exact General Body/SGM relationship in approval routes. `docs/DATABASE.md` additionally leaves abstention treatment configurable/TBC.

## 2. Current implementation evidence

The current backend has membership, committee, project, approval-decision and society-rule-version models. It has no meeting, proposal, governance-resolution, eligibility-snapshot or governance-vote model/routes. The `Voting` frontend route remains a placeholder.

Specific implementation facts relevant to the proposal:

- `Membership` stores society/user/unit, `PRIMARY | JOINT | ASSOCIATE | PROVISIONAL`, `ACTIVE | INACTIVE`, and optional `primaryMemberOrder`. It has no explicit associate-consent evidence, meeting attendance, or eligibility decision field.
- `Committee` stores society, term dates and a free-form status. `CommitteeMember` stores committee/user, position, dates and a free-form status. There is no committee-vote or committee-quorum model.
- `SocietyRuleVersion` validates `approvalPolicy.threshold`; `majorityRules`, `quorumRules`, `noticeRules`, and `votingRules` are immutable `Mixed` values without validated voting schemas.
- `ApprovalDecision` stores the evaluated project, society, rule version, amount, approval type, required decision body, status, and rule snapshot. It has optional meeting and resolution references. The current approval engine emits `COMMITTEE_APPROVAL` / `COMMITTEE` below its configured threshold and `SGM_REQUIRED` / `GENERAL_BODY_OR_SGM` above it.
- Project routes reject direct updates to governed fields. The `/start` transition requires the project already be `APPROVED`; no existing formal resolution workflow can currently authorize that status.

These facts mean implementation must add the absent workflow and must not infer eligibility from application role, committee role alone, ownership, or residence.

## 3. Legal context checked (not a universal per-society rule)

The Maharashtra Co-operative Societies Act, 1960 compilation published by the Maharashtra Co-operation Commissioner/Registrar includes section 72, placing a society's final authority in its general body subject to the Act and Rules. Housing-society section 154B-11 addresses member voting: one vote per member, personal exercise, associate-member voting with prior written consent, provisional-member voting, and joint-member ordering. The Act also contains general voting provisions and exceptions. The exact applicability must be checked against the society's registration, registered bye-laws, amendments and the decision at issue.

The official Registrar-hosted English model housing bye-laws PDF includes clause 102's general-body quorum of two-thirds of the society's members or 20, whichever is less; clauses 108–109 describe one vote (with an associate member in the primary member's absence) and simple majority of those present and voting, with a chairperson casting vote on equality. This is model-bye-law context, not evidence that a particular society adopted these exact clauses. The Registrar's model-bye-law portal now lists newer material, including a 2026 Marathi draft; the 2014 English PDF should not be represented as the latest universal rule.

Primary sources:

- [Maharashtra Co-operative Societies Act, 1960 — official English compilation](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/maharashtra-co-operative-societies-act-1960-%20English%20Edition.pdf), especially sections 72 and 154B-11.
- [Model Bye-Laws of Housing Co-operative Societies — official Registrar-hosted English PDF](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/Model_ByeLaws_of_Housing_Cooperative_societies.pdf), especially clauses 102, 106–109.
- [Commissioner and Registrar of Co-operative Societies — Model Bye-Laws portal](https://sahakarayukta.maharashtra.gov.in/1105/Model-Bye-Laws), for the official document catalogue and its displayed publication dates.

The checked sources demonstrate that voting rights and meeting rules are subject to statutory provisions, exceptions, and registered bye-laws. They do not establish one implementation rule for every society or every project/committee/general-body decision.

## 4. Proposed MVP policy contract

### Decision bodies and approval mapping

Represent **decision body** separately from **meeting type**. Proposed decision bodies are `COMMITTEE` and `GENERAL_BODY`; meeting types remain `COMMITTEE`, `AGM`, and `SGM`. AGM and SGM are meeting types for general-body decisions, not separate electorates. A committee meeting/resolution can satisfy only an `ApprovalDecision` requiring `COMMITTEE`. A general-body resolution can satisfy a general-body requirement. For the current `SGM_REQUIRED` route, require an SGM meeting; do not silently treat an AGM as sufficient. Do not treat an ordinary meeting or committee decision as general-body approval.

The approval engine's `GENERAL_BODY_OR_SGM` label is ambiguous. Proposed mapping is: when `approvalType` is `SGM_REQUIRED`, require a general-body decision recorded at an SGM; otherwise map explicit general-body requirements to their specified meeting type. This mapping needs owner/supervisor confirmation and a future controlled specification update.

### Electorate and snapshot

At voting open, resolve eligibility server-side for the resolution's society, decision body, active rule version, and membership state; persist a dated immutable snapshot and the rule inputs used. Keep User role, ownership, residence/occupancy, membership, and eligibility as separate facts. The authenticated voter must be an active account, but active account or role is not sufficient by itself. Do not infer multiple votes from multiple flats. No proxies.

For general-body membership categories, the official housing-specific statutory text offers a possible basis (primary member; joint member ordering; associate with recorded prior written consent; provisional member voting right). The current schema cannot prove associate consent and does not tie `primaryMemberOrder` to the registered share-certificate order. Therefore do not enable those cases by inference. Proposed safe MVP: require confirmed society membership evidence and apply an explicitly selected/versioned eligibility rule; fail closed for membership cases the rule cannot resolve. The owner/supervisor must decide whether to model the statute text as the initial eligibility policy and what evidence fields are required. For committee decisions, require current committee membership in the committee attached to the meeting, plus the approved conflict-of-interest rule; do not treat `COMMITTEE_MEMBER` application role as sufficient.

### Voting, changes and secrecy

Use one vote per eligible member as the ordinary-resolution baseline. Derive voter identity from authentication. Enforce uniqueness on `(resolutionId, voterId)` for this MVP. The existing Nivaas rule says recorded votes are not simply editable; proposed MVP therefore locks a vote once accepted, including before voting closes. Any correction must be a separate, append-only, auditable correction process; that process is not included until its authority and semantics are approved.

Do not implement elections. Do not promise secret ballots for ordinary resolutions: existing project specs allow multiple methods and specifically distinguish elections. Proposed first governance MVP should use a non-secret configured method only. If a society requires a secret ballot for a resolution, keep that resolution out of this implementation until an anonymity design is approved. Confirm whether `BALLOT` in resolution context means secret or recorded voting before enabling it.

### Quorum and outcome calculation

For general-body meeting quorum, retain the documented baseline exactly as the initial candidate rule: two-thirds of the relevant total society membership or 20, whichever is less; version it and snapshot it. Quorum is about meeting participation, not vote counts and not number of homes. A threshold must be an integer number of people, but the project documents do not specify rounding; nor do they resolve whether the denominator is all society members, active members, or eligible voters. Proposed formula for review only is `min(ceil(2 × memberPopulation / 3), 20)`, using the membership population selected by the society's confirmed rule at the meeting snapshot. Confirm both the population and rounding. Do not reuse this general-body baseline for committee meetings or special resolutions without an approved rule.

For ordinary general-body resolutions, propose the documented model-bye-law pattern as the initial product rule: simple majority of eligible members present and voting; abstentions count toward attendance/quorum but not the yes/no denominator. A tie does not pass; to avoid adding an unrecorded chairperson override, represent it as `NO_DECISION` unless the owner confirms a chairperson casting-vote procedure and that procedure is applicable to the society. This deliberately avoids treating a tie as approval. The denominator, abstention handling and tie outcome must be confirmed before finalization code is enabled.

For committee and special resolutions, no result can be finalized until their majority and quorum rules are explicit and versioned. Do not use a general-body formula as a fallback.

### Rule configuration and historical evidence

Replace opaque voting-related `Mixed` configuration with validated typed schemas (or an equally strict versioned validator) for decision body, allowed method, eligibility policy, quorum population/formula/rounding, majority denominator, abstentions, tie handling, and any special weights. Keep unrelated configuration fields unchanged. Validate configurations when a rule version is created/activated, and reject opening a resolution if required fields are absent or invalid. Capture the exact `ruleVersionId` and immutable normalized configuration snapshot at resolution creation/opening; later rule changes must not alter it. The authority permitted to create/activate rule versions remains unresolved and must be decided separately.

### Meeting record and lifecycle

Use the documented `Meeting` entity as the decision context. At minimum a decision-bearing meeting needs `societyId`, type, title, scheduled date/time, agenda item/reference, decision body, status, creator, and applicable rule version. For AGM/SGM, it also needs official notice reference and issue date/notice period sufficient to check the configured notice rule. A resolution must reference a meeting in the same society and the project/proposal it concerns. Do not create a meeting/resolution from a client-supplied society identifier that conflicts with authenticated scope.

Proposed lifecycle: meeting `DRAFT → PUBLISHED → HELD → CLOSED`, with `ADJOURNED` and `CANCELLED` represented as explicit audited transitions; resolution `DRAFT → OPEN → CLOSED → APPROVED | REJECTED | NO_DECISION`, with `CANCELLED` permitted only before voting opens. These lifecycle labels and transition authority are proposals because the existing database specification lists meeting fields but no meeting-status enum or lifecycle. Apply configured notice periods; existing Nivaas baselines are 14 clear days for AGM and 5 clear days for ordinary SGM, both configurable.

### Finalization and project approval

Finalization is a backend transaction and idempotent state transition. It must re-read and validate: meeting/resolution/project society equality; resolution is closed and not already finalized; the recorded rule and eligibility snapshot match; voting window and meeting/notice/quorum conditions are satisfied; counts derive only from immutable accepted votes; and the selected `ApprovalDecision` belongs to this project/society and is still the current non-invalidated `REQUIRED` or `RE_EVALUATED` decision. Its `requiredDecisionBody`, approval type, rule version, evaluated amount, and applicable quotation/change-request version must match the resolution evidence.

Only a passed, valid final outcome matching the active required approval may transition the project to `APPROVED`, mark the decision `COMPLETED`, and link the project/decision/resolution/meeting in the same MongoDB transaction with an audit event. Route evaluation, resolution creation, opening, vote submission, meeting quorum alone, and blockchain proof alone never approve a project. A failed/rejected/no-decision result must not set `APPROVED`; mapping these outcomes to project `REJECTED` or another status needs an explicit product decision. A material amount/version change must first create/re-evaluate the approval decision through the existing approval engine.

### Audit and blockchain

Audit append-only events for meeting creation/publication/adjournment/closure, resolution creation/open/close/finalization, eligibility snapshot creation, accepted vote, any authorized correction, quorum/notice failure where required, approval completion, and project status transition. Keep vote identity/choice visibility subject to the chosen method; never place individual vote choices on a public chain. The existing blockchain specification allows selected resolution commitments, final governance-result proofs, approval-decision proofs, and rule/eligibility snapshot hashes. Proposed MVP: after a result is validly finalized, submit a commitment to the resolution/result and rule/eligibility snapshot hashes through the existing proof service; keep MongoDB authoritative and store no personal vote choices or full records on-chain. Chain proof is not a prerequisite that makes a decision legally valid and must not be shown confirmed without actual receipt and read-back verification.

## 5. Decision table

| Policy question | Existing documented rule | Proposed MVP rule | Evidence / rationale | Confirmation required |
|---|---|---|---|---|
| What is a decision body versus meeting type? | Resolution requires a decision body; meetings include AGM, SGM, committee. Exact General Body/SGM relationship is unresolved. | Store `COMMITTEE` or `GENERAL_BODY` as body; AGM/SGM/COMMITTEE as meeting type. | `BUSINESS_RULES`, `DATABASE`, `API`; engine uses `GENERAL_BODY_OR_SGM`. | **Yes** |
| Which route can each body satisfy? | Approval engine emits `COMMITTEE` or `GENERAL_BODY_OR_SGM`; no finalization implementation. | Committee decision satisfies committee route only; general-body outcome satisfies general-body route; `SGM_REQUIRED` requires SGM. | Prevent a weaker body from satisfying the evaluated approval. | **Yes** |
| PRIMARY electorate | Membership is separate; ordinary baseline is one eligible member/one vote. | Active, confirmed primary member is a candidate; still require applicable resolution eligibility rule. | Business rules; `Membership` does not itself grant eligibility. | **Yes** |
| JOINT electorate | Ordering must be represented; detailed outcome unresolved. | Apply registered share-certificate order and attendance/absence evidence only if approved and represented in schema; otherwise fail closed. | MCS Act §154B-11(4) context; current order field alone may not evidence certificate or presence. | **Yes** |
| ASSOCIATE electorate | Detailed outcome unresolved. | Require recorded prior written consent and applicable member absence if adopted; do not infer from role/ownership. | MCS Act §154B-11(2); schema has no consent/absence evidence. | **Yes** |
| PROVISIONAL electorate | Detailed outcome unresolved. | No default; apply only an explicitly approved rule based on documented status. | MCS Act §154B-11(3) context; applicability and schema semantics need confirmation. | **Yes** |
| Residence, ownership and application role | Must remain distinct from membership and eligibility. | None independently grants voting rights. | BR-GOV-001; API says residence alone is insufficient. | No |
| Vote count / proxy | One eligible member, one vote baseline; no proxy MVP. | One authenticated eligible member, one immutable vote; no proxy. | BR-GOV-002/005 and Act §154B-11. | No |
| Change after casting | Recorded votes cannot simply be edited; corrections require separate audited event. | Lock accepted vote immediately; correction mechanism is out of first MVP. | BR-VOTE-003; avoids silent history mutation. | **Yes**, if edits before close are desired |
| Secret ballot | Not every governance resolution is secret; elections need separate secrecy architecture and are out of MVP. | Exclude secret resolutions until an anonymity design; clarify meaning of `BALLOT`. | BR-VOTE-001 and current `GovernanceVote` design names voter and vote. | **Yes** for `BALLOT` |
| General-body quorum denominator and rounding | Two-thirds of total society members or 20, whichever is less; configurable. Active/eligible denominator and fractional rounding unspecified. | Candidate: `min(ceil(2N/3),20)` with `N` from a confirmed membership population snapshot. | BR-MEETING-006; model bye-law clause 102. | **Yes** |
| Committee/special quorum | Special quorum unresolved. | No finalization until configured and versioned. | Implementation decisions §2; avoid applying general-body rule elsewhere. | **Yes** |
| Ordinary general-body majority | Exact formulas configurable; official model bye-law gives simple majority of those present and voting. | Candidate: YES > NO; abstain counts for attendance/quorum but not denominator. | Model bye-law cl. 109; project abstention semantics remain TBC. | **Yes** |
| Special / committee majority | Unresolved. | No fallback; reject finalization without an explicit rule. | Implementation decisions §2; BR-VOTE-004. | **Yes** |
| Ties | Project docs silent; Act/model clause provide chair casting vote in relevant general voting context. | Candidate `NO_DECISION` absent approved chair tie-break procedure. | Act §§27/154B-11 and model bye-law cl.108; society applicability and digital recording unresolved. | **Yes** |
| Rule schema/authority | Rule versioned; voting fields currently opaque; authority to change rule versions unresolved. | Typed, validated, versioned config; snapshot at opening; no rule edits after activation. | BR-GOV-007; current `SocietyRuleVersion` Mixed fields. | **Yes** for authority; schema can follow policy |
| Meeting evidence/lifecycle | Meeting fields and notice baselines documented; lifecycle enum/transition permissions not specified. | Store same-society meeting, agenda, body, date/time, notice reference/issue date; explicit audited lifecycle. | DB §25; BR-MEETING-003/004. | **Yes** |
| Pass-to-project condition | Project cannot become approved without required governance. | Matching finalized pass for current applicable ApprovalDecision; atomically complete decision/link records and set project approved. | BR-APPROVAL-005; `ApprovalDecision` snapshot and project governed-field protection. | **Yes** for body/route mapping and rejection status |
| Blockchain | Proofs selected governance records/results; blockchain is integrity only. | Proof finalized resolution/result and snapshot commitments only after successful finalization; never individual choices. | `BLOCKCHAIN.md`; protects privacy and avoids implying legal validity. | No for integrity-layer principle; **Yes** for exact proof event selection |

## 6. Minimum confirmation set to unblock implementation

The owner/supervisor can unblock a bounded MVP by confirming these five grouped decisions (and recording them in the controlled specifications before code changes):

1. **Body mapping:** confirm whether `SGM_REQUIRED` is satisfied only by an SGM, and whether `GENERAL_BODY_OR_SGM` can also be satisfied at an AGM; confirm committee resolutions satisfy only committee-required decisions.
2. **Electorate:** select the society-member eligibility rule for PRIMARY/JOINT/ASSOCIATE/PROVISIONAL, including what evidence is authoritative for joint ordering and associate consent. Decide whether the MVP supports these categories or fails closed until evidence exists.
3. **Calculation:** confirm quorum denominator and integer rounding; confirm general-body majority denominator, abstentions, and tie handling; define committee and special-resolution formulas or explicitly exclude those decision types from finalization.
4. **Voting/meeting operations:** confirm no vote changes after casting (or specify an append-only correction flow), whether any governance `BALLOT` is secret, meeting lifecycle and notice evidence requirements, and who may create/publish/finalize records.
5. **Approval and proof:** confirm how a rejected/no-decision result affects project status, the exact match between a resolution and the current ApprovalDecision/quotation revision, and which finalized events receive blockchain commitments.

## 7. Suggested implementation sequence after approval

1. Update the controlled business-rules, database, API, architecture and implementation-decision documents with the confirmed contract.
2. Replace voting-related opaque rule values with validated, versioned schemas; add meeting, resolution, eligibility snapshot and vote models with society-scoped uniqueness and immutable history.
3. Add authenticated meeting/resolution/voting routes and transactional services, including fail-closed eligibility and outcome evaluation.
4. Link finalization transactionally to the current ApprovalDecision and project; add audit history and selected proof submission only after finalization.
5. Connect the existing Projects and Voting navigation with accessible real-API states; add unit, integration, concurrency and cross-society tests.

No runtime code or existing controlled specification is changed by this proposal.
