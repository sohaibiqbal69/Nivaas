# Maharashtra Housing-Society Governance Rules — Research Note

**Reviewed:** 24 October 2026  
**Purpose:** Establish what can and cannot safely be encoded in Nivaas's
project approval workflow. This is engineering research, not legal advice.

## Findings from primary government sources

The Maharashtra Law and Judiciary Department publishes the Maharashtra
Co-operative Societies Act, 1960 with text current as of **6 June 2025**. The
English Act copy hosted by the Commissioner for Cooperation contains the same
relevant framework reviewed here:

- **Section 72:** subject to the Act, Rules, and registered bye-laws, final
  authority in a society vests in its general body.
- **Section 73:** committee management/powers operate subject to the Act,
  Rules, and bye-laws; it does not itself define one general spending limit
  for every category.
- **Section 154B-11:** voting concerns society members and contains
  membership-specific conditions. Application role, property ownership, or
  residence alone is not a substitute for the applicable society membership
  evidence.
- **Section 154B-4:** recognizes associate, joint, and provisional members;
  the Act's particular rights and conditions must be applied to the relevant
  membership evidence, not inferred from an application role.

The official Department Acts & Rules catalog lists the 1961 Rules and a 2025
amendment. The Commissioner for Cooperation's official site separately lists
an item titled “अधिसूचना गृहनिर्माण नियम १०६-सी” dated 22 June 2026. The supplied
Gazette reproduction identifies **Maharashtra Government Gazette, Part IV-B,
Extraordinary No. 366**, Notification **Sanini 0321/C.R.41/13-C**, dated
18 June 2026. The actual Gazette attachment could not be retrieved during
this review. Consequently, its English clause text below is recorded as a
reproduced text, not independently authenticated primary wording.

## Rule 106C-13(5)(b): narrow scope, not a universal threshold

The third-party English Gazette reproductions present sub-rule (5) as
“Maintenance and repairs,” with paragraph (a) assigning responsibility for
maintaining and repairing society property to the managing committee. The
reproduced paragraph **106C-13(5)(b)** states that the committee is competent
to incur expenditure on repair and maintenance of society property **once in
a financial year**, provided the **one-time expenditure does not exceed**:

| Society membership size in the reproduction | Stated cap |
| --- | ---: |
| Up to 25 members | ₹1,00,000 |
| 26–50 members | ₹2,00,000 |
| 51–100 members | ₹3,00,000 |
| 101–1,000 members | ₹4,00,000 |
| 1,001 and above | ₹5,00,000 |

That wording is limited to repair/maintenance of society property, one-time
expenditure, and the stated once-per-financial-year condition. It does not
support applying those figures to every purchase, project, service contract,
or budget item. The wording establishes the extent of the committee
competence described in that paragraph; without the authenticated complete
rule and applicable registered bye-laws it is not enough to conclude that
every expenditure above the amount necessarily follows one identical SGM
route. Tender requirements, emergency treatment, what counts as “one-time,”
membership-count date/basis, whether a lower registered-bye-law procedure
continues to apply, and the legal consequences above the cap all need primary
text and legal interpretation.

## Requirements not encoded from unverified text

Rules for managing committee powers, AGM/SGM notice and quorum, majority,
abstentions, ties, category-specific expenditure, tenders, minutes, and the
2026 amendment's effective date require the Gazette text and the society's
registered bye-laws. Model bye-laws are guidance and do not establish which
version a particular society adopted or registered. A society's registered
bye-laws and supporting approvals are not stored in this repository in a
form that allows Nivaas to independently establish those facts.

The project currently uses a **single, versioned, configurable MVP approval
threshold**. It is a product prototype, not a claim of legal compliance. No
spending category or amount-to-SGM mapping was changed on the basis of the
unverified reproduction. Governance voting remains separately policy-gated;
no vote outcome is inferred from owner/resident role.

## Decision and evidence table

| Question | Evidence reviewed | Current conclusion | Implementation status |
| --- | --- | --- | --- |
| Does the general body have final authority? | MCS Act ss.72–73, Act text through 6 June 2025 | Yes, subject to the Act, Rules and registered bye-laws; committee authority is not a universal unlimited delegation. | Documented; no new route inferred. |
| Does Rule 106C-13(5)(b) define a cap for every project? | 2026 Gazette reproduction only; official Commissioner site lists the notification, but attachment was unavailable | No. The reproduced text is confined to one-time annual repair/maintenance expenditure on society property. | No category routing change. |
| Does every amount above those caps automatically require an SGM? | No authenticated complete primary rule or registered bye-law available here | Unresolved. The paragraph describes a limit on that committee competence but not enough to map every other expenditure to SGM. | Explicitly unresolved. |
| Which member count, date, or prior expenditure determines the cap? | Reproduction gives tiers and one-time/annual language but repository lacks the required membership ledger and accounting history | Unresolved, including how to calculate eligible members and whether the annual limit has already been used. | No automated statutory-cap calculation. |
| What notice, quorum, voting, abstention, or tie formula applies? | Act/Rules references plus unverified 2026 reproduction; society registered bye-laws unavailable | Must be verified per applicable current law and registered bye-laws. | Existing policy-gated MVP behavior only; no new legal claim. |
| Are owners, tenants, or account roles automatically voters? | MCS Act s.154B-11 and Nivaas's separate User/Ownership/Residence/Membership records | No. Applicable society membership and its evidence/rules control. | No automatic eligibility change. |

## Sources

### Primary government sources

- [Maharashtra Law and Judiciary Department — MCS Act text as of 6 June 2025](https://lj.maharashtra.gov.in/en/document/the-maharashtra-co-operative-societies-act-1960-text-as-on-6th-june-2025-2/)
- [MCS Act English edition hosted by the Commissioner for Cooperation](https://sahakarayukta.maharashtra.gov.in/site/upload/documents/maharashtra-co-operative-societies-act-1960-%20English%20Edition.pdf)
- [Maharashtra Co-operation Department — Acts & Rules catalog](https://mahasahakar.maharashtra.gov.in/en/document-category/acts-rules/)
- [Commissioner for Cooperation — official site listing the 106-C housing-rules notification](https://sahakarayukta.maharashtra.gov.in/1124/Home)
- [Maharashtra Government e-Gazette search portal](https://egazzete.mahaonline.gov.in/Forms/GazetteSearch.aspx/)
- [Bombay High Court — Maharashtra Acts 2026 index](https://bombayhighcourt.gov.in/bhc/libweb/legislation/acts/Stateact/2026acts/act2026.html). It lists the Maharashtra Co-operative Societies (Amendment) Act, 2026; that Act's full text was not analyzed in this review.

### Reproductions used only to locate and understand the 2026 provision

- [SocietySeWA page reproducing Gazette No. 366](https://societysewa.in/co-operative-housing-rules-2026/official-gazette) (third-party reproduction; the page itself says the Government Gazette prevails).
- [Scribd scan/text copy of Rule 106C](https://www.scribd.com/document/1059440628/New-Housing-Rules-Rule-106C) (secondary-hosted copy).

The reproduced sources are not a substitute for verifying the primary Gazette,
current amendments, and each society's registered bye-laws. A qualified
Maharashtra co-operative-society lawyer or the Registrar should confirm any
rule before enabling legal-compliance claims or production approval routing.
