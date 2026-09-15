# Design decisions — round 2

Status: user-confirmed product direction and Folded M branding selection; pilot, shell/brand and governance-reader preview implementation authorized; production rollout remains a separate decision.

These decisions supersede the corresponding open questions and recommendations in the initial study. Do not treat older boards as competing approved directions.

| ID | Confirmed decision | Consequence |
|---|---|---|
| D-01 | Serve DAO/treasury teams **and** mainstream communities **and** entrepreneurs/companies building projects on gno.land over the coming years. | One understandable product with professional depth. Do not reduce Memba to a treasury terminal, or hide community use behind expert terminology. |
| D-02 | Direction A, Quiet Confidence. | Clear sans-serif typography, deliberate hierarchy, useful workspace width, restrained teal and approachable language. |
| D-03 | System-default theme; real black for the dark experience, not gray or dark blue. | Propose System / Light / Black preferences; dark-resolved canvas, navigation, table and standard surfaces are `#000000`. The prior B charcoal/slate palette is superseded. |
| D-04 | Simplifying navigation and regrouping discovery/community features is acceptable. | Proceed with detailed IA proposals, preserve every feature and deep link, validate that Explore remains easy to navigate. Exact labels and mobile destinations are not yet approved. |
| D-05 | Explore branding separately; the M direction is liked, and should be tried on black with alternatives. | Produce a separate branding study. The existing deployed emblem stays in place until a logo is selected and approved for replacement. |
| D-06 | Validators is the preferred first design proof. | Concentrate the first implementation proposal on a read-only, data-rich area. Do not start by changing treasury/signing behavior. |
| D-07 | **01 / Folded M** selected as the branding direction. | Refine that geometry and teal facet treatment. Monochrome/small-size adaptations derive from 01; 02 and 03 remain historical alternatives. Selection does not by itself approve production deployment. |
| D-08 | User authorized proceeding with the plan on 2026-09-14. | Begin P0–P5 in isolated, bounded PRs; retain preview-only visual rollout and separate later navigation, feature-family and branding adoption. |

| D-09 | User requested autonomous continuation with review only at the end. | Finish the authorized pilot, choose routine defaults and verify them without intermediate approval requests; deliver one consolidated review package. Production merge/enablement and later feature waves remain separate. |

| D-10 | User requested further autonomous continuation after the completed Validators pilot. | Proceed with B1 vector artwork and a separately default-off P6 navigation/shell preview; choose routine IA defaults for end review. This does not activate branding in production or expand transaction/realm scope. |

| D-11 | User requested further autonomous continuation after the shell/brand preview. | Proceed with a separately default-off DAO overview/proposal reader slice, preserve transaction payloads and restrictions, and provide one end-review package. Mainnet status/read correctness is a separate rollout gate. |

## Delegated implementation decisions

- Keep grouped **All columns** instead of introducing a per-column preference editor in the first pilot.
- Add an explicit health filter including **Unknown**. Do not interpret missing monitoring as zero, or ignore valid signing evidence.
- Keep the mobile overview collapsed, with the complete network summary one disclosure away.
- Show non-healthy explanations directly in desktop rows. Preserve the existing source/health engine.
- Keep filter/column preferences ephemeral; defer saved layouts and density controls until use demonstrates a need.

These are implemented defaults for final review, not new product commitments or requests for intermediate approval.

## Product interpretation

Professionalism here means that a newcomer can understand the next step, and an experienced team can still inspect precise information. Audience contexts can shape Overview and shortcuts, but should not create separate products or a mandatory persona-selection screen. Gno terminology should have explanations; advanced capabilities remain accessible.

Entrepreneurs should be able to understand discovery, project setup, governance, shared assets, applications and community participation as a coherent journey. This audience decision does not authorize new enterprise features such as billing, SSO or new permission models.

## Remaining decisions

The working Validators proof and subsequent shell/brand preview are ready for end review. Exact IA labels and mobile destinations are concrete implementation defaults in PR #1196. The logo direction is selected; vector/size specifications are supplied in PR #1196; production integration remains separate from UI approval. Approval of direction A is not approval to merge application changes or deploy mainnet capabilities.
