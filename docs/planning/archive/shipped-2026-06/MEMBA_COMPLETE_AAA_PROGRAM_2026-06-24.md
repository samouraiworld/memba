# Memba — Complete AAA Implementation Program (2026-06-24)

> **For agentic workers:** This is the **master program plan** — every workstream Memba has open, organized into epics, each epic delivered as **dedicated branch-per-feature PRs**, dependency-sequenced into execution waves, with a **coverage matrix** proving nothing is dropped. Each epic gets its own bite-sized, TDD-level plan in `docs/superpowers/plans/YYYY-MM-DD-<epic>.md` **at the moment we start it** (writing line-by-line code for 60 PRs up front would be stale before we reached the last) — executed via `superpowers:subagent-driven-development` (fresh subagent per task, review between).

**Goal:** Ship *everything* on Memba's backlog — the morning audit's P0/P1/P2, the five new dimensions (Validators · safe-AI/gno-mcp · Quests · UX · repo health), and the gated go-lives — to AAA standard, with clean git hygiene and nothing deferred or dropped. Demo for the gno core team is **Friday 2026-06-26**; the plan front-loads demo-relevant strength but schedules the entire program.

**Architecture:** Memba = Vite/React SPA (`frontend/`) + Go ConnectRPC backend (`backend/`, Fly.io) + on-chain Gno realms (`r/samcrew/*`, deployed via `samcrew-deployer`) on **test13**. Keys never leave the user's Adena wallet; the backend holds no signing keys. Work is decomposed so each PR is independently shippable **and** revertible.

**Tech Stack:** TypeScript/React/react-query/Vitest/Playwright; Go/ConnectRPC/sqlite/golangci-lint; Gno (gno.land test13); Adena wallet; OpenRouter (analyst); gnomonitoring + `r/gnops/valopers` (validators); gnomcp (AI reads).

## Global Constraints (apply to every PR)

- **Never commit to `main`.** Branch off **updated** `main`; one feature per branch; open a PR; admin-merge **only on explicit per-PR approval**, even with green CI.
- **No Claude attribution** anywhere — no `Co-Authored-By`, no "Generated with" footers, no Claude mention in commits/PRs/tags.
- **Commit message format:** concise, focused on the *why*. No trailers.
- **Backend logic changes are TDD** with permanent **real-body** regression fixtures (the tailer `block_meta` and login `args` bugs both shipped because tests used synthetic inputs).
- **Frontend test parity:** `VITE_GNO_CHAIN_ID= npx vitest run` in `frontend/`. a11y changes get axe/Lighthouse assertions.
- **The feature-flag safety gate stays authoritative.** Don't enable a fund-moving flag without its on-chain enforcement + observability + (where funds move) a wallet-signed E2E.
- **Each phase independently revertible:** UI/logic PRs revert by reverting the PR; env-flag flips revert by flipping back (two-phase auth is lockout-safe).
- **Don't smuggle scope:** the light-theme migration is its own epic, never folded into a11y/UX PRs.

---

## 0. Current state & in-flight reconciliation (read first)

`origin/main` = `509e435` (#470). **Concurrent sessions are actively executing the morning backlog** — six PRs are already open and must be reconciled, not duplicated:

| PR | Branch | Implements | Review verdict → action |
|---|---|---|---|
| **#471** | `fix/security-analyst-auth-lighthouse` | **E3-a** (auth-gate consensus, =N1) + **E0-d** (Lighthouse key, =N2) | **MERGE-WITH-NITS → merge.** Both fully closed (verified). Fast-follow: auth-gate regression test |
| **#472** | `fix/nft-feature-gate-enforcement` | **E0-a** (NFT route gate, =P0-1/DB5) | **MERGE-WITH-NITS → merge.** Fully closed at route layer. Fast-follow: route-level test + consolidate 3 self-gating pages onto the helper |
| **#473** | `fix/deploy-ci-safety-gate` | **E8-c** (deploy runs gate+lint, =P0-3/M6) | **MERGE-WITH-NITS → merge.** **Does NOT close N9 → E8-d elevated to HIGH, stays open** (gate greps `.env.example`, which doesn't feed the prod build) |
| **#474** | `fix/backend-http-hardening` | **E5-a** (SSRF redirect, =P1-2) + **E5-c** (OAuth timeout, =P1-3) | **MERGE-WITH-NITS → merge.** Both fully closed, real e2e test. **N8 DNS-rebind NOT covered → E5-b stays open** |
| **#469** | `fix/default-network-invalid-loop` | mobile redirect-loop fix | **MERGE-READY → merge.** Root-cause fix, regression-tested. **E6-e gnoland1 untouched, stays open** |
| **#443** | `feat/nft-marketplace-phase2` | NFT Phase-2 (→ **E9-b**) | **HOLD → do not merge.** High quality + safe behind flag, but ships P1-1/P2-1 + a new ungated route (G1) + missing `NFT_WATCHED_REALMS`. All folded into E9-b |

> **Wave-0 merge order:** #469 and #472 both touch `App.tsx` + `config.ts` → merge one, rebase the other (trivial). **#472 must land before #443**; #443 then rebases to adopt `isNftEnabled()`/`NftGate` on every NFT route. Recommended: **#471 → #474 → #473** (independent) → **#469 → #472** (rebase the 2nd) → hold **#443** for E9-b. Each merge needs your explicit per-PR OK.
>
> **Net adjustments from review:** E8-d (N9) **elevated to HIGH** and confirmed open; E5-b (N8) and E6-e (gnoland1) confirmed still needed; two AAA test fast-follows added (E3-a backend auth-gate test, E0-a route-level gate test); the #443/NFT go-live blocker list (P1-1, P2-1, gate-gap G1, `NFT_WATCHED_REALMS`) is now explicit in E9-b.

**Resolved by current code (drop from scope):** Validators a11y "clickable divs" — **already fixed** (`Validators.tsx:482-490`: `role/tabIndex/onKeyDown/aria-label`). Quest backend leaderboard-fabrication — already fixed (`quest_verify.go`). `useEcosystemCounts`/`NetworkStatsLive` — already deleted (#468/#470).

**Upstream Gno:** 54 commits since the pin break **nothing** in Memba (realms + vendored deps untouched). One 30-sec smoke-test only — the gnoweb directory-listing scraper vs #5649 (folded into **E7-a**).

**Concurrent-session coordination:** `fix/home-connected-feedback` owns the home tree (editing `YourWorldsPanel.tsx`; has MH1/MH1b in flight). **Reconcile every home/UX item (E6) against that branch before branching.** This program doc is untracked there → commit it on a branch promptly (**E0-f**).

---

## 1. Branch / PR conventions

- **One epic → multiple feature branches**, each `feat/…`, `fix/…`, `chore/…`, `ci/…`, or `docs/…`, named in the epic tables below.
- Branch off **updated** `main` after each Wave's merges (so later PRs see earlier ones).
- PR body = **Summary + Test plan**, stripped of any Claude/Anthropic reference.
- Backend logic PRs include the regression fixture in the same PR.
- Independent PRs within a wave can be authored in parallel (different files) — the tables flag conflicts.

---

## 2. Epics & PRs

Effort: **S** = hours · **M** = ~1 day · **L** = multi-day. Owner: **[Me]** code+PR · **[You]** operator action.

### EPIC 0 — Safety hotfixes & demo cleanliness
*Goal: a clean, safe surface; close the live gating gap; unblock a credible demo.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E0-a | (#472) | **DONE via #472** (`isNftEnabled()` @ `config.ts:556` + `NftGate` on all 6 previously-ungated routes). **Fast-follow:** route-level test (current test only covers the wrapper, not the route table → wouldn't catch a future ungated route); consolidate the 3 self-gating pages onto the helper | `App.tsx:212-224`, `components/ui/NftGate.tsx`, `config.ts:556` | [Me] | S | merge #472 |
| E0-b | `fix/directory-blockers` | DB1 `VALIDATORS 0` (source from working path), DB2 raw-markdown DAO card (render/strip), DB3 empty global search (placeholder+icon or remove) | `components/directory/ChainMetricsBanner.tsx:47`, `pages/Directory.tsx:115`, directory DAO-card renderer | [Me] | S | — |
| E0-c | `fix/govdao-console-404s` | DB4 — feature-detect/guard `tx_search` so GovDAO doesn't emit 63 console 404s | DAO proposal-activity fetch (tx_search caller) | [Me] | M | — |
| E0-d | (#471) | Stop shipping `VITE_LIGHTHOUSE_API_KEY`; route avatar upload via server proxy (N2) | `lib/ipfs.ts:224-228`, `components/profile/AvatarUploader.tsx:39` | [Me] | S | — |
| E0-e | `chore/secret-rotation` | Rotate OpenRouter (`.env:35`) + Lighthouse keys; confirm gitignore | root `.env` | **[You]** rotate · [Me] verify | S | E0-d |
| E0-f | `chore/commit-planning-docs` | Commit the 3 untracked planning docs so a `git clean` can't drop them | `docs/planning/*2026-06-24*.md` | [Me] | S | — |

### EPIC 1 — Observability keystone (the precondition for every flip)
*Goal: make the two production-decision signals visible — signed-login ratio & indexer-lag — so enforcement/NFT/badge flips ship with eyes open.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E1-a | `feat/backend-metrics` | `/metrics` (Prometheus) instrumenting `auth_login` result ratio + `IndexerLastBlock` vs chain head; surface both on `/health`. TDD with a real metrics-scrape fixture. | `cmd/memba/main.go:404-451`, `internal/auth/crypto.go:236`, indexer tailer | [Me] | M | — |
| E1-b | (infra) | Fly log-drain → Grafana/Loki **or** BetterStack; Alert A (signed-login ratio drop), Alert B (indexer-lag delta > N) | infra | **[You]** provision · [Me] dashboards/alert config | M | E1-a |

### EPIC 2 — Validators & valoper onboarding (Dimension A)
*Goal: surface the new test13 valoper onboarding system — the most audience-aligned feature for the gno core team. All data is queryable today.*

| ID | Branch | Goal | Key files / source | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E2-a | `feat/validators-onboarding-cta` | A-E3 — "Become a validator" CTA + links (test13 article, gnops.io specs, `r/gnops/valopers`); optional `Register` gnokey snippet | `pages/Validators.tsx`, static links | [Me] | S | — |
| E2-b | `feat/validators-operator-signing-addr` | A-E2 — show operator vs signing address + last-rotation height on the detail page | `pages/Validators.tsx` detail; `valopers GetByAddr` qeval | [Me] | S | — |
| E2-c | `feat/valoper-candidate-panel` | A-E1 ⭐ — panel of registered valopers with status **Active / Registered–pending / Standby** (moniker, operator addr, server-type badge, profile link); 5 live on test13 | new `components/validators/ValoperPanel.tsx`; `lib/validators.ts` (+`GetByAddr`, cross-ref `GetValidators()`) | [Me] | M | E2-b |
| E2-d | `feat/validators-governance-view` | A-E4 — trust level, valset-change cooldown, keep-running | `lib/validators.ts` (+`r/sys/validators/v3` qeval) | [Me] | S–M | E2-c |
| E2-e | `refactor/validators-typed-parse` | A-E5 — replace `getValidators` `as any → []` with a typed (zod) parse + error state | `lib/validators.ts:106-123` | [Me] | S | — |
| E2-f | `feat/validators-monitoring-health` | A-E6 — adopt gnomonitoring one-call `/api/chain/<id>/health` (valset + server_type + keep_running + precommit_bitmap) | `lib/gnomonitoring.ts` | [Me] | M | **[You]** confirm endpoint live w/ Lours |

### EPIC 3 — Safe AI + gno-mcp (Dimension B)
*Goal: ship Memba's "safe AI + Gno" story — read-only chain context → LLM, with the security hole closed.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E3-a | (#471) | **DONE via #471** (auth gate + token header + Lighthouse-key removal — all verified at PR tip). **Fast-follow:** backend auth-gate regression test (existing tests call the handler directly, bypassing the middleware → no guard if the wrap is dropped) + optional daily LLM-spend ceiling | `cmd/memba/main.go:195,357`, `hooks/useAnalystReport.ts:107-130`, `analyst_test.go` | [Me] | S | merge #471 |
| E3-b | `feat/ai-dao-assistant` | Productionize the in-app "Ask AI about this DAO/proposal" surface (loading/empty/error states, caching, untrusted-content framing) | `hooks/useAnalystReport.ts`, proposal/DAO pages, `internal/service/analyst*.go` | [Me] | M | E3-a |
| E3-c | `docs/gno-mcp-integration` | Document Memba realms as MCP-friendly + recommend gnomcp; prep a live `gno_render gno.land/r/samcrew/memba_dao` demo beat | `docs/`, README | [Me] | S | — |
| E3-d | `feat/memba-mcp-server` | Thin **read-only** Memba MCP server (domain tools: `memba_dao_summary`, `quest_status`, `validator_uptime`, `treasury`) — realm-allowlisted, rate-limited, no key custody, untrusted-content envelopes (mirror gnomcp) | new `backend/cmd/memba-mcp/` (or sidecar) | [Me] | L | E3-a; recommend after E2/E4 land so tools wrap real data |

> **E3-d scope note (not deferral):** for *generic* reads, gnomcp already suffices (E3-c). E3-d is justified only for Memba-*specific* shaping; it's scheduled in Wave 6 and built strictly read-only. Kept in the program per "do everything."

### EPIC 4 — Quests to production (Dimension C)
*Goal: close the integrity gaps and light up the full quest/badge lifecycle. Backend verification layer already exists and is sound.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E4-a | `fix/candidature-xp-gate-ui` | HIGH-1 (UI) — when connected, gate the candidature form on backend `fetchUserQuests(addr).totalXP`, not localStorage | `CandidaturePage.tsx:59,215`, `QuestProgress.tsx:131`, `Sidebar.tsx:232`, `lib/quests.ts:262` | [Me] | S | — |
| E4-b | `fix/quest-catalog-curation` | Ensure `LIVE_QUEST_IDS`/`getLiveQuests` hides the ~18 verifier-less `on_chain` quests (incl. `vote-proposal`); fix the stale "background worker" comment | `lib/gnobuilders.ts:242-302`, `quest_rpc.go:610-612` | [Me] | S | — |
| E4-c | `feat/quest-meta-server-computed` | MED-2 — derive `earn-500-xp`/`earn-1000-xp`/`complete-all-everyone`/`top-10` server-side; **reject them via `CompleteQuest`/`SyncQuests`**; cap aggregate `off_chain` XP. TDD. | `quest_rpc.go`, `quest_verify.go:127-130` | [Me] | M | — |
| E4-d | `feat/candidature-xp-enforcement` | HIGH-1 (full) — backend pre-check before allowing on-chain submission, or realm/oracle XP enforcement | `backend` candidature path; realm `candidature_v2.Apply` (samcrew-deployer) | [Me] | M–L | E4-a; realm change ⇒ **[You]** redeploy |
| E4-e | `chore/quest-admin-allowlist-env` | MED-3 — move QuestAdmin allowlist (`quest_rpc.go:651`, `QuestAdmin.tsx:32`) to env/DB; document M-of-N path | `quest_rpc.go:651-665`, `QuestAdmin.tsx:32`, `membaDAO.ts:22` | [Me] | S | — |
| E4-f | `fix/quest-create-token-verify` | LOW-4 — confirm `tokenfactory_v2` render format against a real token; un-stub the verifier | `quest_verify_phase3.go:96-113` | [Me] | S | **[You]** create one test token |
| E4-g | `feat/quest-vote-proposal-verify` | Add the `vote-proposal` verifier once `memba_dao` has proposals | `quest_verify.go` | [Me] | S | proposals exist on `memba_dao` |
| E4-h | Badge go-live | LOW-5 — IPFS-pin badge assets (capture dir CID) → `cmd/badge-mint -metadata-base ipfs://<CID>` → multisig signs → `-mark-minted` → flip `VITE_ENABLE_BADGES` → verify `TotalSupply()` grew | `cmd/badge-mint/main.go`, `docs/BADGE_MINT_RUNBOOK.md` | **[You]** pin+ceremony · [Me] tooling | M | E1 (watch indexer) |

### EPIC 5 — Security & honesty hardening (P1/N batch)
*Goal: no data shown as real when it isn't; no swallowed failures; outbound hardening complete.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E5-a | (#474) | SSRF redirect re-validation (P1-2) | `internal/service/ipfs_serve.go:298` | [Me] | S | — |
| E5-b | `fix/ssrf-dns-rebind` | N8 — validate the **connected** IP via custom `DialContext` (https-uri branch) — if not in #474 | `ipfs_serve.go:266,322` | [Me] | M | E5-a |
| E5-c | (#474) | GitHub OAuth `NewRequestWithContext` + 10s `Timeout` (P1-3) | `github_oauth.go:199-209,231-239` | [Me] | S | — |
| E5-d | `fix/silent-failures-surfacing` | P1-7 Treasury per-source error banner (`Treasury.tsx:85,111`); P1-8 DAOHome degraded proposals (`DAOHome.tsx:103-115`); M12 Dashboard/TokenDashboard "service unreachable" notice | as listed | [Me] | M | — |
| E5-e | `fix/ecosystem-stats-honesty` | P1-6/M3 — "—" vs "0", never seed `SEED_AGENTS`, network-suffixed cache keys, no zero-caching on error | `lib/agentRegistry.ts:336`, `lib/traction.ts` | [Me] | M | — |
| E5-f | `fix/directory-member-count-honesty` | P1-5 — DirectoryDoor "members" count vs avatars population mismatch; re-source or relabel | `hooks/home/useDirectoryHighlights.ts:88-91`, `DirectoryDoor.tsx:53` | [Me] | S | — |
| E5-g | `chore/remove-auth-debug` | M10 — remove `AUTH-A2-DEBUG` logging (sign-bytes/sig/pubkey) | `crypto.go:380-392` | [Me] | S | — |
| E5-h | `chore/fail-closed-defaults` | P2 — flip code defaults of `MEMBA_ALLOW_UNSIGNED_AUTH`/multisig to fail-closed | `crypto.go:219-228` | [Me] | S | — |
| E5-i | `feat/csp-header` | P2 — add a backend CSP header (+ `netlify.toml`) | backend headers, `netlify.toml` | [Me] | S | — |
| E5-j | `fix/numeric-input-hardening` | P2-1 — `isInteger/isFinite/upper-bound` on list/offer | `V3ListForSaleModal.tsx:76` et al. | [Me] | S | E9-b track |

### EPIC 6 — Connected UX · mobile · a11y · light theme (Dimensions D + MH)
*Goal: 100% functional, beautiful, elegant on every viewport/theme. Reconcile with `fix/home-connected-feedback`.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E6-a | `fix/mobile-safe-area` | P1-9/H3 — `viewport-fit=cover` + `env(safe-area-inset-bottom)` on tabbar; anchor `WhatsNewToast` above the tabbar | `index.html:8`, `index.css` (`.k-mobile-tabbar:1386`), `WhatsNewToast.tsx:88,205` | [Me] | S | — |
| E6-b | `fix/login-no-force-disconnect` | M1 — on login failure keep wallet connected; typed actionable message + Retry | `Layout.tsx:135` | [Me] | M | — |
| E6-c | `fix/banner-toast-consolidation` | P1-10/M2 — one prioritized banner slot + a single bottom-toast stack region | `Layout.tsx:301-317`, toasts | [Me] | M | — |
| E6-d | `fix/stale-copy-and-back-links` | P1-11/M4 CreateToken "Testnet 12" copy (34 inline refs noted); L1 "Back to Dashboard" relabel | `CreateToken.tsx:67-69,187`, `RealmsNotDeployedBanner.tsx:60`, `CandidaturePage.tsx:280` | [Me] | S | — |
| E6-e | `fix/gnoland1-gating` | P1-12/M5 — `realmsDeployed:false` (or empty allowlist) for gnoland1 until deployed | `config.ts` | [Me] | S | reconcile #469 |
| E6-f | `feat/a11y-semantic-focus` | M7 — semantic `<button>`/role+keyboard on remaining clickable divs; dialog focus-traps (`ProposalView.tsx:494`); label inputs; `aria-expanded` (`Settings.tsx:62`,`AlertsPage.tsx:65`); FreelanceServices modal trap (L7) | as listed | [Me] | M | — |
| E6-g | `fix/mobile-grid-tables` | M11 — stack/scroll fractional grids <360px | `dashboard.css:144`, `multisigview.css:216` | [Me] | S | — |
| E6-h | `fix/command-palette-ios-zoom` | L4 — ≥16px input | `command-palette.css:54` | [Me] | S | — |
| E6-i | `fix/footer-social-icons` | D — replace unicode placeholder glyphs with real SVGs | `Layout.tsx:~330-363` | [Me] | S–M | — |
| E6-j | `fix/home-card-uniformity` | MH7 — equal-height home doors | `home.css` | [Me] | S | reconcile home branch |
| E6-k | `fix/tabler-icon-replacement` | MH1b — replace non-shipping `ti ti-*` with Phosphor | `ActionCard.tsx`, `YourWorldsPanel.tsx` | [Me] | S | **reconcile home branch (may be done)** |
| E6-l | `feat/member-home-atlas-polish` | MH1 rename, MH2 network-scoped saved DAOs (+migration), MH3 editable orgs, MH4 GovDAO tag, MH5 avatars+monthly+top-teams, MH6 network-health enrich | `YourWorldsPanel.tsx`, `ContributorsDoor.tsx`, `NetworkHealthDoor.tsx`, `lib/daoSlug.ts` | [Me] | M–L | **reconcile home branch** |
| E6-m | `fix/useadena-listener-leak` | M8 — register `changedNetwork` once with a guard | `useAdena.ts:430-463` | [Me] | S | — |
| E6-n | `feat/light-theme-migration` | L2 — replace inline hex/hardcoded colors with theme tokens (CreateToken 34×, marketplace coming-soon card, low-contrast labels) | `CreateToken.tsx`, `index.css` tokens, marketplace card | [Me] | L | after E6-f to avoid churn |

### EPIC 7 — Data correctness · dead-code · docs · multisig UX
*Goal: counts match chain; no swallowed RPC; ~1,500 dead lines gone; docs current.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E7-a | `fix/dao-data-correctness` | N4 threshold/quorum regex (`dao/config.ts:40`); N5 vote-success skeleton wipe (`ProposalView.tsx:187,217` → `loadProposal(true)`); N6 proposal-cache invalidation (`ProposeDAO.tsx:159`,`TreasuryProposal.tsx:94`); N3 Treasury memberstore arg (`Treasury.tsx:40`); + the #5649 directory-scraper smoke-test | as listed | [Me] | M | — |
| E7-b | `fix/dedup-dao-fetch` | P1-13 — shared `daoOverview` query key so featured ↔ your-worlds dedupe | `useFeaturedDao.ts:69`, `useYourWorlds.ts:69` | [Me] | M | reconcile home branch |
| E7-c | `chore/dead-code-removal` | §10.4 — delete ~1,500 verified-dead lines (`escrowTemplate.ts`, `nftMarketplaceTemplate.ts`, `ConnectWalletPrompt.tsx`, `useMultisig.ts`, `DAOCards.tsx`, stale barrels, `.board-sidebar` CSS, `buildFlagThreadMsg`) | as listed | [Me] | M | after dependent epics land |
| E7-d | `chore/stale-config-comments` | L3/§10.4 — `nftConfig.ts:7-23`, `config.ts:498`, test12 strings, `realm-versions.json` empty blocks | as listed | [Me] | S | — |
| E7-e | `fix/multisig-ux` | sign-button `auth.address` not `adena.address` (`TransactionView.tsx:213`); pubkey de-dup (`CreateMultisig.tsx:108`); disconnected-form hard-gate | as listed | [Me] | S | — |
| E7-f | `fix/agent-registry-template` | N10 — align `agentTemplate` render with the pipe-table parser | `lib/agentTemplate.ts`, `lib/agentRegistry.ts:158` | [Me] | M | — |
| E7-g | `docs/archive-and-readme` | Archive ~14 superseded plans → `docs/planning/archive/`; delete stray `sdd/final-review-fix-report.md`; **README refresh** (Atlas home, NFT v3, GnoBuilders, candidature) | `docs/`, `README.md:10,20` | [Me] | S | — |
| E7-h | `test/page-coverage-floor` | P2 — co-located unit tests for highest-risk-least-tested (`TransactionView`, `useAdena`, `Treasury`, `DAOHome`, `CreateDAO/CreateToken`); add a frontend per-file coverage floor | `frontend/src/**/*.test.tsx`, `vitest.config` | [Me] | M | — |
| E7-i | `chore/repo-claude-md` | Pointer `CLAUDE.md` → `SESSION_CONVENTIONS.md` + active plans for onboarding agents | `CLAUDE.md` | [Me] | S | — |

### EPIC 8 — Resilience & build gates
*Goal: graceful RPC degradation; no config drift; deploy can't skip the gate; backups survive volume loss.*

| ID | Branch | Goal | Key files | Owner | Effort | Deps |
|---|---|---|---|---|---|---|
| E8-a | `feat/backend-rpc-failover` | M9 — fallback RPC list for indexer/marketplace/home-snapshot/quest-verifier (frontend already has one) | backend RPC clients | [Me] | M | — |
| E8-b | `fix/env-rpc-drift` | P1-4/M9 — `home_rpc.go:29-37` default → pinned node (or require `NFT_RPC_URL`); align `.env.example:19,25`; `render_proxy.go:26` default test12→test13 | as listed | [Me] | S | — |
| E8-c | (#473) | Deploy jobs `needs: ci.yml` / `workflow_run` (P0-3/M6) | `.github/workflows/deploy-*.yml` | [Me] | S | — |
| E8-d **(HIGH)** | `ci/flag-gate-from-build-env` | N9 — **confirmed open after #473 review**: the safety gate greps `.env.example`, which does NOT feed the prod build (`vite.config.ts` `envDir:'..'` + uncommitted root `.env`/Netlify dashboard vars) → a fund-gated flag can ship green. Assert flags from the produced bundle / `import.meta.env` at build time. | `ci.yml:90`, `deploy-frontend.yml:49`, build step | [Me] | M | E8-c |
| E8-e | `feat/off-volume-backups` | N11 — off-volume backups (S3/object-store/litestream) + a restore drill | `internal/db/backup.go` | [Me] code · **[You]** provision store | M | — |
| E8-f | `chore/db-pool-hardening` | P2 — `_busy_timeout(5000)`, `SetConnMaxLifetime`, tailer shutdown `WaitGroup` join before WAL checkpoint | `db.go:16-23`, `main.go:237-245` | [Me] | S | — |

### EPIC 9 — Gated go-lives (each strictly after its prerequisites)
*Goal: actually turn on the gated features — safely. Nothing here is deferred; each is sequenced behind the work that makes it safe, with explicit [You] handoffs.*

| ID | Branch / action | Gate sequence | Owner | Deps |
|---|---|---|---|---|
| E9-a | **Multisig enforcement** — `fix/multisig-propose-format` (align propose `feeJson` `{gas_wanted,gas_fee}` + canonical `{"@type":"/vm.m_call"}` msg shape with the A3 verifier; **golden round-trip test vs a real Adena sig**; resolve the `broadcast_tx_commit` Amino-binary encoding) → **[You]** capture a real multisig-member sig → flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` → watch E1 dashboards. **Rollback = flip to 0.** | code-prereq is a hard blocker (flipping today = total multisig lockout — §10.1) | [Me] code+test · **[You]** sig + flip | E1; `ProposeTransaction.tsx:71,110,159`, `multisig_verify.go:89`, `TransactionView.tsx:473-503` |
| E9-b | **NFT go-live** — sequence confirmed by the #443 review: **(1)** merge #472 (E0-a) → **(2)** rebase #443 onto it, adopting `isNftEnabled()`/`NftGate` on *every* NFT route incl. the new **`LegacyCollectionView.tsx`** (`/nft/:realmPath`, ungated in #443 = gate-gap G1) → **(3)** fix **P1-1** (source price from `priceUgnot bigint` via `nftApi.ts`/indexer; drop `parseMarketplaceRender` at `v3TokenGrid.ts:101`→`nftMarketplaceV3.ts:55`) + **P2-1** (`Number.isFinite`/integer/upper-bound on list+offer in `TradeModal.tsx`) → **(4)** add `memba_collections` (+confirm v3) to `NFT_WATCHED_REALMS` (`backend/.env.example:34`, `main.go:155`) → **(5) [You]** wallet-signed create→list→buy E2E on the #443 preview → **(6)** flip `VITE_ENABLE_NFT` | #472 lands before #443; don't flip before the E2E | [Me] code · **[You]** E2E + flip | E0-a, E1, #443 |
| E9-c | **Badges go-live** — = E4-h | post-mint ceremony | **[You]** + [Me] tooling | E1, E4-h |
| E9-d | **Services / Treasury-spend / Agent-credits** — `feat/onchain-enforcement-services` (complete the realm-side enforcement these flags require; N3 Treasury memberstore fix is a prereq) → audit → **[You]** flip per-flag | currently gated because on-chain enforcement is incomplete; this PR *does the work* so they can be enabled (not left deferred) | [Me] realm+backend · **[You]** redeploy + flip | E4-d pattern; realm changes ⇒ samcrew-deployer redeploy |

---

## 3. Execution schedule (dependency-ordered waves — nothing unassigned)

Front-loads demo strength (Validators + AI + clean surface) for **Friday**, then completes the program. Independent PRs within a wave run in parallel.

- **Wave 0 — Land in-flight + commit docs (today). Reviewed ✅.** Merge in order **#471 → #474 → #473** (independent), then **#469 → #472** (both touch `App.tsx`/`config.ts` — rebase the 2nd), each on your per-PR OK. **Hold #443** (→ E9-b). Then commit planning docs (E0-f) + **[You]** rotate keys (E0-e). → refreshes `main`. Queued fast-follows: E3-a auth-gate test, E0-a route-level test. **Confirmed still-open after review: E8-d (N9, HIGH), E5-b (N8), E6-e (gnoland1).**
- **Wave 1 — Demo cleanliness + observability start (→ Thu).** E0-b (Directory), E0-c (GovDAO console), E1-a (`/metrics`), E2-a + E2-b (validator CTA + addr clarity), E4-a + E4-b (candidature UI gate + catalog curation), E3-a tail (token header if not in #471). All S/M, parallel.
- **Wave 2 — Demo headliners (→ Fri).** E2-c (valoper/candidate panel ⭐), E3-b (in-app AI surface), E3-c (gno-mcp doc + live read), E2-d (governance view). E1-b provisioning ([You]).
- **Wave 3 — Security/honesty.** E5-d, E5-e, E5-f, E5-g, E5-h, E5-i, E5-b (N8 if not in #474), E2-e.
- **Wave 4 — UX/mobile/a11y.** E6-a…E6-m (reconciled with home branch), E7-a, E7-b, E7-e, E7-f.
- **Wave 5 — Resilience & cleanup.** E8-a, E8-b, E8-d, E8-e, E8-f, E7-c (dead-code, after dependents), E7-d, E7-g, E7-h, E7-i, E4-c, E4-e, E2-f.
- **Wave 6 — Big features & light theme.** E6-n (light-theme migration), E3-d (Memba MCP server), E4-d (candidature enforcement), E9-a code-prereq (multisig propose-format + golden test).
- **Wave 7 — Gated go-lives.** E9-a flip, E9-b NFT, E9-c badges, E9-d services on-chain enforcement → flips. Each after its dashboard ([You] handoffs).

> "No delay" guarantee: every finding is assigned to a wave (see §4). [You] items are **handoffs, not deferrals** — I build to the handoff line and hand you a runbook; the flip is the only step I can't do.

---

## 4. Coverage matrix (every finding → PR → status — nothing dropped)

| Source ID(s) | PR | Status |
|---|---|---|
| P0-1 / DB5 (NFT gate) | E0-a (#472) | in-flight |
| P0-2 / H1 (observability) | E1-a, E1-b | planned |
| P0-3 / M6 (deploy gate) | E8-c (#473) | in-flight |
| N1 (analyst auth) | E3-a (#471) | in-flight |
| N2 (Lighthouse key) | E0-d (#471) | in-flight |
| P1-1 (raw-ugnot price) | E9-b | planned |
| P1-2 (SSRF redirect) | E5-a (#474) | in-flight |
| P1-3 (OAuth timeout) | E5-c (#474) | in-flight |
| P1-4 (RPC default/env drift) | E8-b | planned |
| P1-5 (member-count honesty) | E5-f | planned |
| P1-6 / M3 (ecosystem honesty) | E5-e | planned |
| P1-7 (treasury silent) | E5-d | planned |
| P1-8 (DAOHome silent) | E5-d | planned |
| P1-9 / H3 (safe-area) | E6-a | planned |
| P1-10 / M2 (banners) | E6-c | planned |
| P1-11 / M4 (test12 copy) | E6-d | planned |
| P1-12 / M5 (gnoland1) | E6-e | planned |
| P1-13 (dup fetch) | E7-b | planned |
| P1-14 (role paging) | (decision; deferred-by-design ≤10 pages) — **logged, revisit if a DAO >10 member pages** | tracked |
| H4 (DAO overcount) | #468/#470 | done |
| H5 / OpenRouter key | E0-e | planned |
| M1 (login disconnect) | E6-b | planned |
| M7 (a11y) | E6-f | planned |
| M8 (useAdena leak) | E6-m | planned |
| M9 (RPC failover) | E8-a, E8-b | planned |
| M10 (AUTH-A2-DEBUG) | E5-g | planned |
| M11 (mobile grids) | E6-g | planned |
| M12 (backend error notice) | E5-d | planned |
| L1 (back-to-dashboard) | E6-d | planned |
| L2 (inline hex/light theme) | E6-n | planned |
| L3 (stale comments) | E7-d | planned |
| L4 (cmdk iOS zoom) | E6-h | planned |
| L5 (QuestAdmin gate) | E4-e | planned |
| L6 (dead code) | E7-c | planned |
| L7 (FreelanceServices) | E6-f | planned |
| L8 (candidature 2-step) | E4 (UX note in E4-a) | planned |
| N3 (treasury memberstore) | E7-a / E9-d | planned |
| N4 (config regex) | E7-a | planned |
| N5 (vote banner) | E7-a | planned |
| N6 (proposal cache) | E7-a | planned |
| N7 / HIGH-1 (candidature XP) | E4-a (UI) + E4-d (full) | planned |
| N8 (DNS-rebind) | E5-b (verify vs #474) | planned |
| N9 (CI flag from build env) | E8-d | planned |
| N10 (agent template) | E7-f | planned |
| N11 (off-volume backups) | E8-e | planned |
| MH1/MH1b/MH2-7 | E6-k, E6-j, E6-l | planned (reconcile home branch) |
| DB1-3 (Directory) | E0-b | planned |
| DB4 (GovDAO console) | E0-c | planned |
| A-E1..E6 (validators) | E2-a..E2-f | planned |
| B options (AI/mcp) | E3-a..E3-d | planned |
| C HIGH-1/MED-2/MED-3/LOW-4/5 | E4-a..E4-h | planned |
| D polish | E6-a/i, E0-b | planned |
| E repo health | E0-f, E7-c/d/g/i | planned |
| Multisig propose-format / §10.1 | E9-a | planned |
| NFT custody / go-live | E9-b (#443) | planned |
| Services/Treasury/Agent flags | E9-d | planned |
| Gno upstream smoke-test (#5649) | E7-a | planned |

**Consciously tracked, not built (with rationale, revisit triggers):** P1-14 realm-side `GetMember(addr)` selector (early-exit cache fine ≤10 member-pages; build when a real DAO exceeds it). Atlas Phase-3/gnoland1 snapshot generalization (no value until Memba realms deploy on gnoland1 — gate via E6-e first). These are *logged with triggers*, not silently dropped.

---

## 5. Owner handoffs ([You]-only actions — I prep each to the handoff line + a runbook)

1. **Merge approvals** — every PR (per-PR, even green CI).
2. **Secret rotation** — OpenRouter + Lighthouse keys (E0-e).
3. **Observability provisioning** — choose Grafana/Loki vs BetterStack; provision the log-drain + 2 alerts (E1-b). *Default rec: Fly log-drain → Grafana Cloud (free tier) for speed.*
4. **gnomonitoring health endpoint** — confirm `/api/chain/<id>/health` is publicly deployed with Lours (E2-f).
5. **Wallet-signed E2Es** — multisig sig capture (E9-a); NFT create→list→buy (E9-b).
6. **Multisig ceremony** — badge mint batch signing (E4-h/E9-c).
7. **Realm redeploys** — candidature XP enforcement (E4-d), services on-chain enforcement (E9-d) via samcrew-deployer.
8. **Prod flag flips** — `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY`, `VITE_ENABLE_NFT`, `VITE_ENABLE_BADGES`, services flags — each after its dashboard.
9. **Off-volume backup store** provisioning (E8-e).

---

## 6. Per-epic detailed plans (just-in-time)

When we start each epic I'll write its bite-sized, TDD-level plan to `docs/superpowers/plans/2026-06-XX-<epic>.md` (failing test → run → implement → pass → commit, with complete code), then execute it **subagent-driven** (fresh subagent per task, two-stage review between tasks). This keeps detailed code from going stale behind earlier epics' changes, while this master plan guarantees scope, sequence, and coverage.

---

## 7. Self-review (against the request)

- **"Everything, nothing deferred"** — §4 maps every finding from the morning backlog, the connected audit, and the five new dimensions to a PR and a wave. The only items *not* coded are two explicitly logged with revisit-triggers (P1-14, Atlas-3) — not dropped.
- **"Dedicated branches per feature"** — §2 names a branch per PR; §1 sets one-feature-per-branch + per-PR approval.
- **"Correctly done / AAA"** — TDD + real-body fixtures + a11y assertions + observability-before-enforcement + each phase revertible (Global Constraints, §4).
- **"Do not delay works"** — §3 assigns every PR to a dependency-ordered wave; [You] items are handoffs with runbooks, not deferrals; gated flips are sequenced behind the work that makes them safe, and that work is itself scheduled.
