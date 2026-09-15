# Design audit

## Conclusion

The central problem is the allocation of attention and space. Large outer margins surround dense, very small interface content. Many sections have similar visual weight despite serving very different jobs: deciding a vote, monitoring uptime, discovering games, or reading an announcement.

An institutional experience should make five things easy to answer: **Where am I? What is available here? What needs my attention? What will this action do? Did it succeed?** It should earn confidence through readable evidence and predictable behavior.

## Method and limits

- **S1:** supplied desktop GovDAO screenshot, 19:18:35; mainnet, disconnected/sync timeout.
- **S2:** supplied desktop validators screenshot, 19:19:35; mainnet, four validators and horizontal table scrolling.
- **S3:** supplied desktop home screenshot, 19:29:33; Pearl, visitor experience.
- **C:** source review at `e20d261b`; App routes, DAO router, navigation, layout, tokens, UI primitives, page structures, plugins, sharing configuration. [Inventory](INVENTORY.md) makes coverage traceable.
- **L:** public browser inspection on 14 September: validators and DAO discovery/detail on Pearl; DAO detail also at a 390 × 844 viewport. No wallet connection, signing, posting, or contract writes.

The browser initially redirected `/mainnet/validators` to `/pearl/mainnet/validators`; following its Validators navigation opened `/pearl/validators`. The observed footer identified v7.4.0, whereas S2 identifies v7.5.0. A later selector included gno.land. This is a reproducible session observation, **not a diagnosis of deployment or caching**. Do not transpose Pearl numbers or old-release behavior onto mainnet. Establish a pinned build/network baseline before implementation validation.

Coverage is broad and heuristic, with deeper visual inspection of the supplied pages. Source inspection establishes structure, not successful behavior under all runtime states. Connected/member/admin flows, light-theme rendering, actual device behavior, screen readers, crawler unfurls, and transaction lifecycle testing remain explicitly unverified.

## What is already worth keeping

- A recognizable teal identity and distinct GovDAO treatment.
- Real governance, wallet, validator, contributor, and public-discovery depth.
- Read-only exploration before wallet connection.
- Network-aware routes and capability gates.
- Existing transaction confirmations, deployment progress, error handling, mobile shell, command palette, and accessible dialog primitive.
- An existing design-system document, theme tokens, type/spacing/radius tokens, and accessibility-related tests. This is an incomplete and inconsistently applied system, not a blank slate.

## Findings by priority

Severity here expresses design impact, not a security vulnerability assessment. High affects task completion, interpretation, or trust; medium adds friction or inconsistency; low affects polish.

| ID | Finding and evidence | Impact | Proposed response |
|---|---|---|---|
| D01 · High | `.k-main` caps every page at 1,152 px (`frontend/src/index.css:1383`); `.val-page` allows 1,920 px inside that cap (`pages/validators.css:9`). S2 visibly has large gutters while table data overflows. | Operational pages cannot use available workspace. | Introduce content-width families: fluid data workspace, bounded detail, readable document, focused form. |
| D02 · High | S1–S3 show micro-labels and tiny controls. `daohome.css` contains 9–11 px labels; validator table headings use 10 px. | Extra visual effort, weak hierarchy, difficult scanning and touch use. | Body 15–16 px; operational data 13–14 px; metadata usually 12–13 px; mono reserved for code/identifiers. Validate at actual zoom. |
| D03 · High | S2 shows five metric cards in a four-column arrangement, leaving a stranded card. L shows the table below an unusually tall summary stack. | Users scroll past summary furniture to reach the actual work. | One wrapping metric strip; merge repetitive health summaries; give the table priority. |
| D04 · High | S1 and L list passed proposals under “Active Proposals”; L simultaneously reports active and executable counts for the same set. | “Needs a vote” and “needs execution” are easy to confuse. | Separate lifecycle states and next action; map them to actual contract semantics, including unknown/unsupported states. Do not infer execution from a passed vote. |
| D05 · High | Global `RealmsNotDeployedBanner` says DAO/channel features are unavailable while S1 shows GovDAO data. | Users cannot tell native network governance from Memba-specific deployment availability. | Explain affected capabilities locally; distinguish read availability, wallet mismatch, missing Memba realms, and RPC failure. Preserve all gates. |
| D06 · High | Shared `TxConfirmation` shows contract functions, abbreviates caller and long arguments, and reduces the contract path to its last two segments. Multisig `TransactionView` instead uses a separate full-field review card. | Different mental models and incomplete identity information in Memba's own confirmation surface. | Human-readable effects plus exact full target/recipient/arguments on demand before confirmation; retain separate propose, approve, sign, broadcast and execute meanings. Wallet-side presentation was not tested. |
| D07 · High | L at 390 × 844: DAO header, donut and seven stacked metrics consume the first viewport; proposals are below it. | Mobile users cannot reach the principal decision promptly. | Put next action and proposal list first; collapse secondary governance statistics into an expandable summary. |
| D08 · Medium | S3 places an introductory hero, entry cards, GovDAO spotlight, ecosystem metrics and further lists in one view. `MemberHero` foregrounds standing/XP. | Everyday operational priorities compete with discovery and gamification. | Preserve separate visitor/member modes; a member's pending work leads, with community standing secondary. |
| D09 · Medium | Navigation has many destinations, “new/soon” badges, bottom utilities, and auth-dependent entries. `MobileTabBar` relabels Alerts as Activity for members. | Locating features requires understanding the product's history and terminology. | Propose a simpler task-based structure with explicit route mapping; keep every capability reachable. |
| D10 · Medium | `DESIGN_SYSTEM.md` specifies one color source, but legacy aliases, inline styles and literal colors coexist. Fonts and spacing also vary per feature. | Each future change can diverge again. | Govern semantic tokens, component contracts, page patterns, and exceptions together. |
| D11 · High | Shared `TxConfirmation` uses dialog semantics and Escape/backdrop dismissal, but does not use `AccessibleDialog`/its focus trap. | Keyboard containment/return focus needs validation for a critical flow. | Audit focus lifecycle and converge behavior on tested primitives. Source risk, not a claimed measured keyboard failure. |
| D12 · Medium | Tiny badges, colored status, dim code-like copy, mixed emoji and icons appear throughout S1–S3. | Technical density is communicated without a consistent level of importance. | One icon family for app chrome; semantic text+icon statuses; named typography roles. Keep personality in community content. |
| D13 · Medium | L showed a “What's New” overlay covering DAO content on desktop and mobile. `OnboardingWizard` presents an additional multi-step feature tour after connection. | Product announcements interrupt time-sensitive work. | Non-blocking release notice and contextual onboarding; no surprise overlay during review/signing. |
| D14 · High | `public/og-image.jpg` is a square 640 × 640 generic brand image. Default OG/Twitter images in `index.html` are relative paths. `RouteMetaSync` changes metadata client-side. | Shared links lack object-specific context and consistent landscape composition. | A designed preview family plus crawler-readable metadata and verified absolute image URLs. |
| D15 · High | Feed edge handler explicitly matches `/feed/post/:id`; the current app routes include `/:network/feed/post/:id`. Its canonical construction is also unprefixed. | Network-prefixed shares may fall back to generic SPA metadata. | Verify actual bot HTML on every supported URL form; preserve network identity and moderation behavior. This is a source mismatch, not a tested crawler outage. |
| D16 · Medium | Alpha/v3 top badge, versioned footer and experimental language coexist in S1–S3. | Release maturity is ambiguous; visual polish alone cannot resolve it. | One truthful release/support surface and contextual action risk information; never remove truthful warnings merely to look established. |

### Width and density evidence

At the browser's 1,280 px viewport on the observed Pearl release, `main` measured 1,152 px wide starting at x=220; the table measured approximately 1,583 px. The screenshot showed clipping at the right edge. This is supporting live-release evidence; the independent source finding is the nested width constraint.

Do not solve this by shrinking all text or making every page full-width. Reading a proposal benefits from a bounded text measure. Comparing validators benefits from width, selected columns and an accessible row detail. Deliberate whitespace separates decisions; unused gutters around overflowing data do not.

### Design-system adoption snapshot

A mechanical scan of non-test `.tsx` and `.css` under `frontend/src` found:

| Indicator | Occurrences | Files |
|---|---:|---:|
| Literal `style={{` | 1,347 | 158 |
| Hex color-looking strings | 784 | 58 |
| CSS font-size declarations of 9, 10 or 11 px | 534 | 40 |

These are search counts, not 1,347 defects. They include token definitions, comments, charts, intentional game styling and legitimate exceptions. The historical “~1,800” figure in DESIGN_SYSTEM.md is not used as a current measured total. `tokens.css` already contains type, spacing, radius, shadow and transition scales; the next system should reconcile those foundations, not create an independent competing palette.

## Feature coverage and recommendations

All URLs below are relative to the selected network unless indicated. **Visual** means supplied or live evidence; **source** means heuristic inspection of routing, page structure and/or component markup, without completing the workflow. Suggested patterns are proposals, not confirmed missing functionality.

| Feature family / surfaces | Review basis and friction | Design proposal / essential validation |
|---|---|---|
| Global shell, network, wallet, banners, notifications, command palette | Visual+C; weak hierarchy and multiple system states competing. | Persistent network/account context; concise prioritized status; discoverable command search; distinguish connect from authentication and activation. |
| Home: visitor and connected member | S3+C; ecosystem promotion and standing compete with tasks. | Visitor: purpose and three useful entry points. Member: pending votes/signatures and recent work, then ecosystem discovery. Validate first-time/returning/empty accounts. |
| DAO discovery `/dao` | L+C; featured DAO, connect and create actions. | Searchable organizations list with saved/recent and available capabilities; distinguish open existing DAO from wallet connection. |
| DAO overview `/dao/*` | S1+L+C; oversized stats and ambiguous action states. | Compact identity, context tabs, pending work and proposal list. Explain tier labels and score methodology on demand. |
| Proposal detail and creation | Source `ProposalView`, `ProposeDAO`; templates, types, raw fields, votes/actions. | Readable proposal narrative plus decision summary; human effects, eligibility and action lifecycle. Keep full code/addresses inspectable. |
| DAO creation | Source `CreateDAO`, five wizard step components and deployment UI. | Guided setup with plain-language presets, review, progress and recoverable partial-deployment state. Preserve validation and deployed-step recovery. |
| DAO membership | Source `DAOMembers`; power distribution and role controls. | Member table; role and voting-power explanations; membership changes clearly identified as proposals where applicable. |
| DAO treasury and spending | Source `Treasury`, `TreasuryProposal`; assets, charts and availability gate. | Wide asset ledger and focused transfer review; explicit units, ownership and supported actions. No invented fiat value or unsupported GovDAO treasury flow. |
| Multisig hub/detail | Source `MultisigHub`, `MultisigView`; saved/discovered wallets, members and transactions. | Shared-wallet workspace with threshold, signer roster and pending signature queue. Retain local/discovered distinction. |
| Multisig create/import | Source `CreateMultisig`, `ImportMultisig`; members, threshold, address and pubkey JSON. | Guided standard setup and clearly labeled advanced import. Verify threshold, member identity, duplicate/error and recovery states. |
| Transaction proposal/detail | Source `ProposeTransaction`, `TransactionView`; send, contract call, token operations, offline signatures/export. | Unified review language with distinct approval/sign/broadcast stages. Keep offline workflows and exact transaction payloads intact. |
| Tokens: list/detail/actions/create | Source `TokenDashboard`, `TokenView`, `CreateToken`; whole vs smallest-unit fields and capability gates. | Portfolio/discovery separation; consistent amount/unit labels and review; creation form with supply implications. Include zero/error/unknown balance. |
| Validators / candidates / network roster | S2+L+C; very wide table, 5-card summary, overlapping uptime/participation metrics. | Wide primary table, column presets, pinned identity, filter/sort controls, details; separate candidates/consensus/observed peers. Define time windows. |
| Validator detail / operator aliases / reviews | Source `ValidatorProfile` and operator redirect; identity, health, community reviews and edit dialog. | Identity and observation provenance first; clear historical vs current health; verified links distinct from community statements. |
| Hacker view | Source `ValidatorsHacker`; specialized consensus telemetry. | Retain expert workspace under Network; consider “Advanced telemetry” language. Do not remove heatmaps/topology just to simplify the main table. |
| Alerts and reports | Source `AlertsPage`, contact/webhook/schedule components; authenticated management. | Inbox separated from alert rules/delivery settings; clear scope, test status and last delivery. Private destinations never in shared previews. |
| Organizations / teams management | Source `OrganizationsPage`, `OrgContent`; gated availability, creation/invites. | Clear organization context and permissions; invitation lifecycle. Keep distinct from Gnolove contributor teams. |
| Directory, source explorer and drawers | Source `Directory`, explorer redirect, source/realm/token drawer components. | Search-first object directory, consistent type labels and details; code in advanced pane. Preserve existing deep links/query state. |
| Marketplace lanes / my listings / sell flows | Source `UnifiedMarketplace`, lane components and gates. | Consistent catalog and filter toolbar; explicit network availability, price units, fees, provenance and transaction outcome. No seeded offers shown as live. |
| Services and agents within marketplace | Source service/hire and agent registration/deploy/detail components. | Explain service scope, seller identity, terms and action outcome; distinguish AI assistance from verified conclusions. Feature availability must be confirmed per deployment. |
| NFT collection/item/creator/legacy views | Source collection and token pages with trade modals and gates. | Consistent ownership, listing and offer states; image fallbacks; readable token metadata and full transaction review. Preserve legacy URLs. |
| NFT launchpad and Studio | Source launch form, StudioHome/Manage, settings/mint/allowlist/phase/withdraw sections. | Creator workspace with progressive steps; distinguish display metadata from consequential supply/price/custody changes. Confirm all admin and public mint states. |
| App Store browse/detail/reviews | Source `AppStore`, rating/report/review components. | Professional catalog; publisher, external destination, capability and review provenance clear. Listing is not a security endorsement. |
| App submit / publisher / curator | Source `AppSubmit`, `PublisherConsole`, `AppCurator`. | Status-driven submission workspace and moderation queue; visible required fields, edit state, review reason and publish outcome. |
| Feed / thread / feed profile | Source feed pages, composers and empty/error states. | Bounded reading column; thread context, draft feedback, posting costs/visibility where applicable; accessible actions and durable permalink. |
| Feed moderation / transparency | Source `FeedMod`, `FeedTransparency`; bearer field, flagged queue, log. | Separate staff workspace from public transparency; clear permission boundary and action reasons. Preserve tombstone/redaction behavior in previews. |
| DAO channels / voice / board plugin | Source `ChannelsPage`, board/thread components, voice integration. | Dedicated conversation workspace with channel list and member permissions; public/on-chain visibility and microphone state clear. No cramped chat inside a stats header. |
| Extensions / plugin host | Source `Extensions`, `PluginPage`, registry. | Capability catalog with availability, status, scope and safe entry points; common host header and errors. |
| Proposal Explorer plugin | Source registry and proposals module. | Reuse governance filters/status vocabulary and readable list pattern. Avoid separate interpretation of proposal lifecycle. |
| Payroll plugin | Source payroll module; recipients, CSV, local templates, generated proposal preview. | Batch-payment preparation grid with unit labels, row errors, totals and full review. “Recurring template” must not imply autonomous scheduled execution. |
| GnoSwap plugin | Source availability gate and SwapView. | Focused exchange form, clear capability/quote/fee status; advanced pools/liquidity remain discoverable where supported. |
| DAO leaderboard plugin | Source registry/module. | Readable scoped table with scoring definition; do not equate contribution rank with authority or security. |
| Gnolove overview / analytics / PR reports | Source `gnolove/*`; many filters, charts and activity tables. | Dedicated full-width analytics workspace; persistent filters, time period, definitions, data source/freshness and export parity. |
| Gnolove notable PRs / milestone | Source board and milestone pages. | Consistent list/board controls and progress explanation; keyboard-operable grouping and filter state. |
| Gnolove contributors / teams / team hub / AI reports | Source profile, teams, TeamHub and report components. | Clear distinction between observed contributions, derived scores and generated analysis; source links and dates. Avoid duplicated profile identities. |
| Quests / detail / admin | Source quest pages and gating. | Progress and prerequisites first, verification requirements and claim state explicit; staff tools use administrative patterns. |
| Leaderboard / reputation / candidature | Source three pages and candidature form. | Community progression surface; distinguish XP, reputation, membership eligibility and actual permissions. Do not make it the primary B2B dashboard. |
| Games: Block Party, Space Invaders, Barricade | Source game routes/gates and wrapper structures. | Preserve individual game identity in Explore; shared entry/exit, controls, practice vs verified result, pause and accessibility messaging. Engine behavior not audited. |
| Profile / settings / identity callbacks | Source profile, settings, GitHub callback, username redirect. | Separate public identity from private preferences; connection outcomes and advanced gas settings clear. Do not present external-account linkage as institutional verification. |
| Blog / changelog / feedback | Source editorial pages and feedback form. | Readable editorial template and professional share cards; consistent support entry and submission status. |
| Not found / legacy redirects / feature gates | Source router, NotFound, ComingSoon and capability gates. | Honest destination-specific recovery with network context. Loading, unavailable, missing object and permission denied must be distinct. |
| Social previews / icons / install surfaces | Source metadata, OG asset and feed edge; asset visual inspection. | One brand asset family; object-aware public previews; crop/favicon/maskable icon testing. |

## Accessibility assessment

There are existing accessibility foundations. This review does not declare WCAG compliance or a measured contrast failure from screenshots. Small type is a usability concern even when its colors pass contrast; computed text on actual tinted/disabled/hover surfaces needs measurement.

Propose WCAG 2.2 AA as the acceptance baseline: ordinary text at least 4.5:1, large text at least 3:1; reflow at 320 CSS px with appropriate exceptions for genuinely two-dimensional content. Use 44 px touch targets as Memba's ergonomic goal; WCAG 2.2 AA's minimum target criterion is 24 × 24 CSS px with exceptions, not a universal 44 px rule. Sources: [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Validate both themes, keyboard focus and restoration, zoom, text resize, reduced motion, live announcements, tab order, screen-reader table navigation and form errors. Existing mobile and keyboard tests are assets to retain; their presence is not evidence that all screens pass.

## Validation still required

Before converting the proposals into implementation work, agree on the current build and supported network/capability matrix. Then design-review the critical flows in public, connected, member, signer and admin roles using non-production fixtures. Cover loading, empty, stale, partial failure, wrong network, wallet rejection, insufficient balance, pending confirmation and completion. No claim in this audit implies those flows have been executed successfully.
