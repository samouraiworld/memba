# Implementation-plan proposal

Status: **P0–P5 pilot implemented for final review on 2026-09-14** by the user: “OK, what’s next? Can we start proceeding the plan?” This authorizes isolated implementation and a reviewable preview. It does not authorize automatic merge, production enablement, later feature waves or logo replacement. The user subsequently delegated autonomous completion. Responsive/state details and implemented table defaults are consolidated in [REVIEW.md](REVIEW.md). See [TASK-LEDGER.md](TASK-LEDGER.md).

## Outcome and constraints

Deliver direction A with System / Light / Black theme behavior, then prove the layout and component foundations on Validators before broadening adoption. Serve professional teams, communities and future project builders through one approachable interface. All existing features remain reachable. No contract deployments, network cutovers, auth changes or transaction redesign belong in the Validators pilot.

Use short branches/worktrees and small PRs, not a long-lived application rewrite branch. The current `docs/professional-design-audit` branch remains a design record. Future implementation branches start from an agreed current mainline commit; do not build months of feature work on the audit's historical snapshot.

## Proposed sequence and ownership

Each row is a reviewable unit, not a promise that one PR can safely contain all work. Split further if behavior or file ownership expands. Roles below are responsibilities to assign, not agents already launched.

| Unit | Concrete scope / likely files | Dependency and acceptance | Owner / rollback |
|---|---|---|---|
| P0 · Baseline and approved proof | Study docs; pinned fixture/build manifest and reference images in existing E2E conventions | Confirm current mainline, preview build, supported networks, exact metric mapping and desktop/mobile/loading/stale/error designs. Record old-screen baselines. | Design/integration owner. Documentation-only; no runtime rollback. |
| P1 · Theme preference behavior | `frontend/src/lib/themeStore.ts`, its callers in topbar/mobile/command palette/settings, focused theme tests | Preserve resolved `light/dark` compatibility and existing explicit choices. Add System / Light / Black preference, OS-change listener only for System, storage-failure fallback and cross-tab synchronization. Keep existing palettes in this PR. | Foundation owner. Revert preference behavior with backward-compatible storage values. |
| P2 · Scoped visual foundations and width contract | `frontend/src/components/layout/Layout.tsx`, shared shell styles in `index.css`, proposed scoped pro styles/component tokens; relevant layout tests | After P0/P1. Add route-scoped fluid layout and A light/black tokens for the pilot only. Do not replace legacy global tokens wholesale. Verify unaffected route screenshots. | Same foundation owner; exclusive ownership of shared shell/token files. Revert scoped styles or disable presentation preview. |
| P3 · Validators presentation | `pages/Validators.tsx`, `pages/validators.css`, relevant `components/validators/*`; `Validators.table.test.tsx` and mobile tests | After P2. Compact metric strip, readable typography and default table/list, preserve candidate/node tabs, source/copy/review links, pagination, expert metrics and existing detail routes. No query/computation changes. | Validators owner, receiving a frozen component/layout contract. Revert presentation PR or preview switch. |
| P4 · Optional table interactions | Proposed column chooser and health filter, narrow new UI components plus interaction tests | After P3. Use delegated defaults for final review; all fields remain accessible. Keyboard controls, sorting, paging and unknown-health behavior verified. Defer saved presets and density settings unless separately approved. | Validators owner. Revert independent interaction layer; keep basic presentation. |
| P5 · Pilot validation and release proposal | Existing visual/a11y/mobile/validator suites and proof documentation | All acceptance criteria below met on pinned preview. User reviews real rendered pages, not only raster concepts. Pilot remains off in production until normal release approval. | Integration/review owner. Disable approved preview mechanism or revert bounded PRs. |
| P6 · Navigation and shell adoption | `lib/navManifest.ts`, sidebar/mobile shell, command palette and route tests | After successful pilot and exact IA approval. Map every existing route to its new discoverable entry; keep legacy URLs/query behavior. Validate visitor/member navigation independently. | Foundation/integration owner. Revert presentation/manifest change without route migration. |
| P7 · Feature-family waves | Bounded ownership by feature family, using approved primitives | After P5, and P6 when a wave relies on new navigation. Separate waves listed below; no one giant migration PR. | One feature owner per wave plus shared-foundation reviewer. Per-wave revert. |
| B1 · Branding and share previews | Study assets first; later selected SVG/icon/OG assets; metadata/edge handler in a separate PR | Folded M direction selected; vector refinement and actual-size checks next. Separate artwork adoption from crawler routing/metadata changes. UI pilot can ship with the current logo. | Brand owner; metadata engineer separately. Independently reversible assets and handler changes. |

## Preview mechanism proposed for P2

Use one explicit presentation-only build flag, proposed name `VITE_ENABLE_PRO_UI`, plus a narrow route allowlist initially containing the existing network-prefixed Validators route. Keep the same public URL and existing data components/contracts. The exact flag name and mechanism must be checked against current repository conventions at P0 before adoption.

Production defaults off. Local/PR preview enables the pilot. A preview flag may select visual presentation only: it must not turn on marketplace/contracts, switch RPCs or networks, change authentication, override data, or bypass transaction guards. Do not add mock figures to ordinary runtime paths. Use test fixtures only in the test/preview harness and visibly identify them.

Avoid parallel copies of query/business logic. Extract a small presentation boundary only if necessary to keep the old view available during review. Remove obsolete presentation code after the approved rollout window rather than maintaining two UIs indefinitely. If current route composition makes a flag more complex than a clean additive layout variant, P0 should explicitly revise this mechanism before coding.

Theme preference behavior in P1 is global; the new palette in P2 is scoped to the pilot. This distinction limits risk while other sessions continue shipping legacy feature pages. Existing dark surfaces are already predominantly black; do not use this program to introduce gray fallback panels elsewhere.

## Pilot acceptance criteria

| Category | Required evidence before rollout |
|---|---|
| Width | No app-level clipping at 1,280, 1,440 and 1,920 px. Default desktop columns fit at 1,440/1,920 px. Optional wide table scroll stays contained and identity remains accessible. |
| Mobile | At 390 px, principal controls and first useful validator information appear without a viewport of summary tiles. At 320 CSS px, page content reflows; genuine two-dimensional table content has an accessible alternative/detail path. |
| Theme | System follows OS changes; manual override remains stable; switching back to System works; old stored preferences migrate safely; unavailable storage does not prevent rendering. Black standard surfaces compute to `rgb(0, 0, 0)`. |
| Readability | Both themes meet the agreed text/control contrast targets; no 9–11 px essential labels; visible focus and comprehensible unknown states. |
| Data parity | Same validators, candidate/node membership, metrics, windows, health explanations, sorting calculations and update cadence as baseline. No synthetic healthy/zero values on missing data. |
| Interaction | Search, sort, page size, paging, tab URLs, copy, external links, reviews and detail navigation remain correct. Back navigation and refresh preserve agreed state. |
| Accessibility | Preserve semantic table rows and nested links/buttons; sortable header announcement, tabs, chooser/filter keyboard support and focus return. Automated scan plus manual keyboard review; screen-reader review for changed table patterns. |
| Failure states | Loading, empty roster, zero search results, stale telemetry, partial monitoring outage, wrong network and RPC failure have separately reviewed behavior. |
| Coexistence | Unmigrated home/DAO/treasury/feed/game screens and legacy theme consumers retain behavior; compare a representative screenshot set after shared-file changes. |
| Performance | No new data requests/pollers solely for styling; no loss of route lazy loading; no material bundle/render regression against baseline. Quantitative budget to be established at P0, not invented now. |

Use existing tests as a starting point: `pages/Validators.table.test.tsx`, `pages/Validators.test.tsx`, `pages/validatorThemeRegression.test.ts`, `e2e/validators.spec.ts`, `e2e/desktop-layout.spec.ts`, and mobile validator/shell tests. Check current test setup and network fixtures before execution. Add tests for new behavior and actual observed regressions; do not mirror CSS implementation in a large brittle snapshot suite.

For every code PR run the repository's applicable required build/lint/test checks and disclose any baseline failure separately. This is the sequence and acceptance contract. Executed checks and remaining rollout gates are recorded in the pilot handoff and REVIEW.md; named future-wave checks are not claimed as run.

## Later waves after the pilot

1. **Discovery and identity:** home visitor/member hierarchy, directory, profile, app discovery, editorial and help. Preserve a visible route for community features and project builders.
2. **Governance reading and collaboration:** DAO list/overview, proposals, members, channels and analytics; reconcile capabilities across DAO types. Keep read-only work separate from writes.
3. **Shared assets and consequential actions:** tokens, multisig, treasury, creation/import, payroll and transaction review. Require exact payload/threshold/amount and rejected/uncertain/confirmed-state evidence before rollout.
4. **Commerce and creator tools:** marketplace, services/agents, NFT views/Studio, publisher and curator flows, according to the feature sessions' deployment readiness.
5. **Community and specialist surfaces:** feed/moderation, Gnolove, quests/reputation/candidature, games and remaining plugins. Reuse the shared shell while retaining appropriate specialist presentation.

The audit inventory remains the completeness checklist. Waves can be reordered around active feature work without changing shared contracts. Availability work stays with the relevant contract/deployment session; design work does not activate unfinished features.

## Agent-compatible coordination

Maintain the versioned task ledger in this study directory with task ID, base SHA, branch/worktree, owner, file list, dependency, status, PR and handoff. Named human or agent owners can be assigned later. Proposed statuses: ready, active, blocked on dependency, in review, complete. Record why a task is blocked and which owner can resolve it.

One foundation owner serializes changes to global styles, theme store, shell and navigation manifest. A feature owner edits only the assigned route/components. If an overlapping feature session lands changes, update the baseline and adapt; never reset its work. Parallel work is appropriate only after interfaces and file ownership are stable. No background agents or automation are started by this document.

Each handoff includes approved decision/proof versions, changed files, full validation results, compatibility notes, rollback and remaining uncertainties. Each PR uses the user's Summary + Test plan format and contains no generator attribution. No commits to main/master, no automatic merge, and no mainnet deployment as a side effect of design review.

## Scope and estimates

P0–P5 is the authorized bounded pilot and is now ready for review. Estimate each unit against the refreshed baseline and approved state frames; do not promise a completion date for the whole product redesign yet. The major sizing variables are existing feature changes, amount of table extraction required, coverage gaps in themes and mobile, and the final optional-column behavior. Branding can proceed without delaying the pilot.

The next user review is the rendered pilot. Keep production presentation off until that review and the normal PR/release process are complete.

## Subsequent authorization and delivery

D-10 authorizes continued autonomous work after the pilot. P6 is now a separately default-off shell preview in [#1196](https://github.com/samouraiworld/memba/pull/1196); exact IA defaults are supplied for consolidated review. B1 contains vector masters, actual-size specimens and PNG renditions, with production favicon/PWA/OG wiring still separate. The existing phase gates govern production adoption, not an additional permission request before preparing these reversible previews. P7 feature bodies remain staged, beginning with DAO/proposal presentation.
