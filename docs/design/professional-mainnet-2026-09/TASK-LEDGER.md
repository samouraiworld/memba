# Professional design task ledger

Updated 2026-09-15. D-12 authorizes the complete frontend rollout in one PR. Current status: implementation complete in [#1200](https://github.com/samouraiworld/memba/pull/1200); see [COMPLETE-REVIEW.md](COMPLETE-REVIEW.md) and [COMPLETE-HANDOFF.md](COMPLETE-HANDOFF.md). Owner: design/integration session. Memba only; production remains unchanged.

The P0–P8 table below records the earlier pilot sequence. Its separate PRs are superseded by the consolidated C1–C7 delivery at the end of this ledger.

## Baseline and isolation

- Initial integration base: `98b8b762`; refreshed to `d49896a1` while preserving the landed validator accessibility and protobuf changes. Theme head `d3028e88`; pilot head `a3f8559b`.
- Shared `Memba` checkout remains untouched on its existing `main` revision.
- P1 branch: `feat/system-theme-preference`.
- P1 worktree: `Memba-worktrees/system-theme-preference`.
- Separate active worktree `review-main-98b8b76` has validator accessibility work. Preserve semantic rows/sort buttons and incorporate landed changes when updating the pilot base; do not modify that checkout.
- Decisions: D-01 through D-12. Branding: 01 / Folded M selected and adopted in the consolidated preview.

| Task | Status | Owned files / dependency | Handoff |
|---|---|---|---|
| P0 Baseline | In review | This ledger; deterministic E2E fixture and pilot handoff | Base `98b8b762`; source/user-screenshot baseline, labelled rendered fixtures and read-only live inspection recorded. Remaining state gates are explicit. |
| P1 Theme preference | In review · [#1194](https://github.com/samouraiworld/memba/pull/1194) | `lib/themeStore.ts`, shared `ThemeSelect`, topbar/mobile/settings/palette callers, tests, changelog | Preserves palette and resolved `light/dark` contract. Initial local 5,002 unit tests, build/lint, backend/race and Buf passed. Refreshed branch passes full remote CI, including Node 20/22, Chromium E2E and mobile guardrails. CI found iPhone clipping; narrower mobile header passes 20 local guardrails. Desktop CI exposed an ambiguous network-picker test after adding the theme picker; the semantic selector fix passes the three affected local tests. Corrected remote CI is green; evidence is linked in REVIEW.md. |
| P2 Scoped foundations | In review · [#1195](https://github.com/samouraiworld/memba/pull/1195) | `Layout.tsx`, scoped pro stylesheet/config predicate, optional notice style tokens | Default-off presentation flag; Validators overview allowlist only. |
| P3 Validators presentation | In review · #1195 | `Validators.tsx`, scoped CSS, relevant validator tests | Same queries and metric derivation; responsive rendered proof. Initial local 5,017 unit tests passed; final CI unit/build/lint checks and 36 local preview browser cases pass. Larger status/pagination text and resolved-incident contrast verified after the mainline refresh. See the handoff for review limits. |
| P4 Optional interactions | Implemented for final review · #1195 | Narrow table control surface | Grouped All columns plus health filter with Unknown implemented. Keyboard scrolling, filter/paging resets and missing data verified. Individual column preferences and saved presets/density deliberately deferred. |
| P5 Pilot review | Awaiting user review | Reproducible preview, screenshots, validation evidence | Production flag stays off. Mixed health and missing-signal states verified. Manual screen-reader, physical-device, browser zoom and connected-wallet reviews remain rollout gates. |
| P6 shell / B1 artwork | In review · [#1196](https://github.com/samouraiworld/memba/pull/1196) | `feat/professional-shell-brand`, stacked on #1195; own worktree and dependency cache. Shell flag, manifest-derived presentation, SVG/PNG identity package | 19 targeted unit tests, build/lint, 35 browser checks passed locally; additional mobile search-focus checks passed. Full CI is linked from the PR. [Review pack](https://github.com/samouraiworld/memba/blob/feat/professional-shell-brand/docs/design/professional-mainnet-2026-09/SHELL-BRAND-REVIEW.md). |
| P7 DAO / proposal readers | In review · [#1197](https://github.com/samouraiworld/memba/pull/1197) | `feat/professional-governance`, based on #1196. Scoped route flag, overview/list/member links, proposal reading layout, offline browser tests | 35 targeted units + 10 transaction parity tests passed. Lint/build, 42 browser cases and 8 final contrast/visual checks passed locally. Final-head full CI passed; see evidence below. |
| P8 remaining bodies / production brand activation | Frontend complete in C1–C7; production activation separate | DAO directory/onboarding, Home, remaining route families, metadata and icons | Full preview delivered in #1200; current-main status correction integrated. Production flag activation remains a release decision. |

## Handoff requirements

Record commit and PR URLs, base changes, exact validation commands/results, fixture vs live evidence, browser/state gaps and rollback before marking a task in review. One owner serializes shared shell/theme edits. Feature/deployment work in other sessions continues independently. Never reset another worktree or fold unrelated changes into these PRs.

## Implementation review links

- Theme foundation: [#1194](https://github.com/samouraiworld/memba/pull/1194), branch `feat/system-theme-preference`.
- Validators pilot: [#1195](https://github.com/samouraiworld/memba/pull/1195), branch `feat/validators-professional-pilot`, based on the theme branch. Worktree `Memba-worktrees/validators-professional-pilot`.
- [Pilot handoff with run commands and verification limits](https://github.com/samouraiworld/memba/blob/feat/validators-professional-pilot/docs/design/professional-mainnet-2026-09/PILOT-HANDOFF.md).

## Decisions for the rendered pilot review

1. Does the desktop density/spacing suit everyday professional work?
2. Keep the mobile network overview collapsed by default?
3. Keep the seven primary columns (six without uptime data) and grouped All columns, or refine column selection next?
4. Approve the Light / true Black treatment for the next feature family?

These decisions concern the working preview. No production release or global navigation change follows automatically.

## Next-stage scope record

D-10 extends autonomous implementation into a review-only navigation shell and Folded M artwork. New branch `feat/professional-shell-brand` is based on pilot head `a3f8559b`; implementation commit `a0299c27`. Main was inspected at `08f8b04b` without changing the shared checkout. See [the shell handoff](https://github.com/samouraiworld/memba/blob/feat/professional-shell-brand/docs/design/professional-mainnet-2026-09/SHELL-BRAND-HANDOFF.md) for route mapping, token specifications and ownership boundaries.

## Final shell / brand CI evidence

Final implementation head: `62566f17`. [Professional preview run 34896625904](https://github.com/samouraiworld/memba/actions/runs/34896625904) passed on that exact head: **5,012 unit tests passed, 15 skipped**, production build, lint, **36 Validators browser checks** and **37 shell/brand browser checks**. Changelog, attribution and default-flags deploy-preview checks are also green. No production merge or deployment was performed. The shared checkout remains clean on `main` at `4a7081ec`.

## Governance stage handoff

- Decision D-11; branch `feat/professional-governance`, worktree `Memba-worktrees/professional-governance`, based on shell head `62566f17`.
- Implementation `6154abee`; final review-document head `3c752565`; draft [#1197](https://github.com/samouraiworld/memba/pull/1197).
- [Review pack](https://github.com/samouraiworld/memba/blob/feat/professional-governance/docs/design/professional-mainnet-2026-09/GOVERNANCE-REVIEW.md) and [technical handoff](https://github.com/samouraiworld/memba/blob/feat/professional-governance/docs/design/professional-mainnet-2026-09/GOVERNANCE-HANDOFF.md).
- Independent default-off `VITE_ENABLE_PRO_GOVERNANCE`. Real local preview on port 5194; tests on strict port 5195; copied dependencies isolate the Vite cache. The older 5188 and 5191 previews remain available.
- Scope: direct overview counts, compact power disclosure, searchable status/history list, keyboard-accessible proposal/member links, responsive reading/voting columns, truthful missing-data copy. Existing transaction builders, permissions, polling and feature routes are preserved. Creation, treasury, full members, channels and plugins keep their existing feature presentation.
- Live inspection verified mainnet DAO and proposal loading without connecting a wallet. It also reproduced an existing status inconsistency: GovDAO proposal #4 is passed in the list but ACTIVE in the detail page on both this preview and unchanged pilot head `a3f8559b`. Treat this as a mainnet rollout blocker. Do not silently alter signing eligibility in a style PR; assign a separate read/parser change with actual realm-render regression fixtures.
- The professional reader reports absent thresholds as unavailable instead of inheriting the legacy default-60% quorum claim. It does not infer missing vote totals from percentages.
- Manual screen-reader, physical-device, connected-wallet visual review and source-parser correctness remain release gates. This preview has not been merged or deployed to production.

[Reproducible mainnet status blocker](MAINNET-STATUS-BLOCKER.md): confirmed chain gnoland-1 at height 47293; the broad status expression captures `restricted` in the description before ACCEPTED in the authoritative status section. Regression scope is specified without modifying transaction eligibility.

## Final governance CI evidence — 2026-09-15

Final review head **3c752565** passed [Professional preview run 34901052752](https://github.com/samouraiworld/memba/actions/runs/34901052752) in 14m9s: **5,044 unit tests passed, 15 skipped** (510 passing test files, one skipped), lint and default production build, **36 Validators**, **37 shell/brand** and **42 governance** browser checks — **115 browser checks total**. Changelog and both attribution checks passed. The provider marked its deploy preview canceled/skipped; this is not a production deployment or an enabled hosted design preview.

The shared checkout was last inspected clean on `main` at `3120124f`; other activity advanced its dependency updates during this session. The design work did not alter that checkout. The stacked feature branches still require integration with current main before release. At this checkpoint the mainnet status parser blocker remained unresolved and outside the presentation PR; the subsequent separate fix is recorded below.

## Separate mainnet read-correctness fix — 2026-09-15

- [Draft PR #1199](https://github.com/samouraiworld/memba/pull/1199), branch
  `fix/govdao-proposal-status`, own worktree of the same name, base **3120124f**
  from main; final implementation head **f2363775**.
- Reads generated status fields instead of arbitrary prose and treats
  canonical/versioned GovDAO ACCEPTED as already executed in list and detail.
  Basedao/daokit, other realms, JSON and transaction builders remain unchanged.
- Deployed read evidence and limitations: [status blocker report](MAINNET-STATUS-BLOCKER.md).
- Local: **415 targeted tests / 20 files**, build, lint, attribution and diff
  checks passed. Fresh mainnet RPC at block 52365; live browser shows EXECUTED.
  All transaction tests use mocked broadcasts. No wallet was connected.
- Final-head [CI run 34926842222](https://github.com/samouraiworld/memba/actions/runs/34926842222) passed on that exact head: **5,029 unit tests passed, 15 skipped** (Node 22); both Node 20/22 jobs green. **229 Chromium checks passed, 7 skipped; 58 browser guardrails passed**. Backend, Buf, workspace checks, Docker, security, Lighthouse, changelog and attribution also passed.
- Review preview: `http://127.0.0.1:5197/mainnet/dao/gno.land/r/gov/dao/proposal/4`.
  This is the separate main-based correction, not the professional theme.
- No merges, production deployments or design flag activation. Existing
  5188/5191/5194 preview branches are unchanged. Merge/integration ordering
  should land the read fix before enabling the professional governance reader.

Next design wave remains Home / DAO discovery. Integration with current main
and the status fix must precede a combined mainnet release review; continuing
review-only design work does not authorize unfinished contract capabilities.


## D12 consolidated completion

Owner: design/integration session. Worktree `professional-complete`, branch `feat/professional-complete`; base is the integrated governance/design stack plus current-main status correction. No parallel editor owns these files.

| Unit | Scope | Current status | Verification |
|---|---|---|---|
| C1 | Route policy, readable typography, Black/Light shared controls | Complete | Build/lint and 53-case complete route matrix passed |
| C2 | Home, discovery, DAO list, account and editorial | Complete | Live Home review, search/keyboard and route checks |
| C3 | Members, treasury readers, creation, multisig and transaction review | Complete | Synthetic account fixtures, existing payload/guard tests |
| C4 | Marketplace, apps, creator/curator/publisher and NFT Studio | Complete | Separate test-only feature build; capability gates preserved |
| C5 | Feed, community, quests, specialist tools and plugins | Complete | Route matrix, Black telemetry and game frame review |
| C6 | Folded M icon/share adoption and crawler metadata | Complete | Flag-on build and crawler unit checks |
| C7 | Consolidated evidence and PR | Complete | [#1200](https://github.com/samouraiworld/memba/pull/1200), [visual pack](COMPLETE-REVIEW.md), [handoff](COMPLETE-HANDOFF.md), current-main integration; latest commit checks remain authoritative |

An implemented row is not a release-readiness claim. See the final handoff for executed checks and the distinction between live readers, fixtures, unavailable data and capability-gated screens.
