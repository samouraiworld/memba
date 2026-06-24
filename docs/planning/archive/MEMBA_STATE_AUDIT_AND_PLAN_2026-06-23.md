# Memba — State Audit & Session Plan (2026-06-23)

> **For agentic workers:** This is a session-prep roadmap across several workstreams (not a single-feature TDD plan). Each Track below is independently actionable with exact file paths and verification gates. Use checkbox (`- [ ]`) syntax for tracking. Honour `docs/planning/SESSION_CONVENTIONS.md` (never commit to `main`; feature branch → PR → squash; quality gates per §3).

**Goal:** Establish the *verified* real state of Memba (local + repos + test13), then execute the user's priorities — (a) wind down test12, (b) make test13 features functional & complete, (c) polish the new homepage.

**Method:** Git/PR/CI probed directly; backend + frontend built and tested locally; three deep audit passes (homepage, test13/test12, roadmap) cross-checked; every load-bearing claim re-verified against code (not prose). Each finding is tagged **[VERIFIED]** (checked in code/CI this session) or **[DOC-CLAIMED]** (asserted by a doc/memory, not re-probed against the live chain).

---

## 0. TL;DR

- **Local build & tests are GREEN. [VERIFIED]** Backend: `go build` + `go test ./...` all pass. Frontend: `vite build` clean (7.2s), **2399 unit tests pass / 140 files**. All repos in sync with their remotes; zero uncommitted changes.
- **3 open Memba PRs.** #443 (NFT Marketplace Phase 2) — CI **green**. #444 (GnoBuilders namespace live-test) — CI **green**, trivial. #445 (Home Phase 2 `GetHomeSnapshot`) — CI **RED** (9 trivial test-only lint errors) **and** carries a real validators-count bug. None merged (all `REVIEW_REQUIRED`).
- **The homepage is live (Phase 0+1, #439) and solid**, but Phase 2 (#445) is stuck and has 14 polish/correctness findings — incl. **2 High** (the CI lint + a "validators show 0" bug).
- **test13 DAO core is genuinely live & functional** (DAO, channels, candidature, token-factory, feedback). **Commerce (NFT, escrow) is deployed-and-valid but gated OFF in the repo.** GnoBuilders badges are deployed but **never mint**; quests are **forgeable**.
- **"Wind down test12" has NOT started in committed config. [VERIFIED]** Both `backend/fly.toml` and `.github/workflows/deploy-frontend.yml` still hardcode `test12`; prod frontend even points at a **stale DAO path** (`samourai_dao`). test13 is reachable only via the in-app network switcher.
- **`realm-versions.json` has ZERO test13 entries. [VERIFIED]** The canonical deploy ledger is blind to production — this is the #1 winddown precondition.
- **Memory correction:** the "20-commit stranded NFT Phase-0 data foundation" is a **false alarm** — that work merged via **#431** and is in `main` (confirmed by direct two-dot diff). NFT Creator Studio merged via **#441**. No stranded work; several stale squash-orphan branches to prune.

---

## 1. Decisions for your review

These genuinely change scope — please pick on review; everything else I can proceed on with CTO defaults.

| # | Decision | Recommendation | Why it matters |
|---|----------|----------------|----------------|
| **D1** | **Turn NFT commerce ON for test13?** Flip `VITE_ENABLE_NFT=true` (marketplace + launchpad) after #443 merges. | **Yes, after the #443 on-chain E2E passes** — realms are live & valid; it's the single biggest jump in test13 functional completeness. | Without it, launchpad/marketplace stay invisible to users despite working realms. CI has a safety gate (`ci.yml`) that blocks the flag in `.env.example`; enable via Netlify. |
| **D2** | **Turn Services/Escrow ON?** Flip `VITE_ENABLE_SERVICES=true`. | **Defer** until one escrow lifecycle (fund→milestone→release) is run E2E on test13 — it moves real ugnot. | Lower demand than NFT; needs GRC20 approve/transferFrom verified first. |
| **D3** | **test12 hard cutover now or staged?** | **Staged** — this session: backfill the ledger + validate a test13 wallet returns `result=signed`; flip chain config in a *separate, single release* once validated (backend+frontend must flip together or authed RPCs 401). | A premature `GNO_CHAIN_ID` flip without auth validation can lock out legit users (chain-id is bound into the sign-doc). |
| **D4** | **Prune stale branches/worktrees?** ~8 stale local branches + 3 idle worktrees (see A9). | **Yes** — after a diff-check (already done; they're squash-orphans/stale). | Reduces confusion; none hold unmerged work. |
| **D5** | **GnoBuilders badge go-live** needs an off-chain multisig mint ceremony (your/multisig action). | Schedule it; until then keep `VITE_ENABLE_BADGES` off. | Badges deployed but `TotalSupply()=0`; no backend signer. |

---

# PART A — VERIFIED CURRENT STATE

## A1. Repo & CI snapshot

| Repo | Branch | Sync vs remote | Notes |
|------|--------|----------------|-------|
| **Memba** | `main` @ `ae3c2bf` | even (0/0) | 3 open PRs (below). Clean tree. |
| **gnolove** | `main` @ `e72d397` | even | Last: #230 Notable-PRs multi-board (3wk ago). 0 open PRs. |
| **samcrew-deployer** | `feat/nft-register-market-v3` @ `099d373` | even (its upstream) | **#32 RegisterMarket-v3 already MERGED** (06-18). Local `main` is 1 behind origin — switch back & fast-forward. |
| **gnodaokit** | `main` @ `b833296` (7mo) | even | 4 **stale** dep PRs: #64 (port latest gno/interrealm-v2), #63 (toolchain bump), #62 (v5 audit), #25 (avatar). Parked; not blocking Memba. |

**Open Memba PRs [VERIFIED this session]:**

| PR | Branch | CI | Mergeable | Disposition |
|----|--------|----|-----------|-------------|
| **#443** NFT Marketplace Phase 2 (discovery hub, unified trading, buy/list MVP) | `feat/nft-marketplace-phase2` | ✅ all green | MERGEABLE / REVIEW_REQUIRED | Needs on-chain E2E on preview, then approve+merge (Track 2). |
| **#444** GnoBuilders: gated live-test for deploy-quest namespace ownership | `feat/gnobuilders-namespace-live-test` | ✅ all green | MERGEABLE / REVIEW_REQUIRED | Trivial test-only regression guard; approve+merge (Track 0). |
| **#445** Home Phase 2: `GetHomeSnapshot` (one cached RPC) | `feat/home-phase2` | ❌ **Backend (Go) + Go Security Scan FAIL** | MERGEABLE / REVIEW_REQUIRED | Fix lint + validators bug, then merge (Track 0/1). |

## A2. Local verification results — GREEN [VERIFIED]

```
backend:  go build ./...           OK
          go test ./...            ok (auth, db, indexer, points, ratelimit, service, cmd/*)
frontend: vite build               built in 7.19s (largest chunk index 449KB / 135KB gz)
          vitest run               140 files, 2399 tests passed (24.8s)
```
Note: `npm version` field is **`4.1.0`** while the product line is **v6.3.1** (ROADMAP/CHANGELOG) — the package.json version is not maintained; not load-bearing, flagged for cleanup.

## A3. Homepage ("Control Room") audit

**Architecture [VERIFIED]:** Single mode-aware `frontend/src/pages/Home.tsx` (`visitor|member`), mounted at `/:network/` via `HomeRedirect` (`App.tsx`), inside `<main class="k-main">` (max-w 1152, centered). Three zones: `StatusStrip` (network heartbeat) → spine (`ActionInbox` member / `VisitorHero` visitor) → `StateBoard` grid of 7 lazy, error-isolated panels (NetworkPulse, YourWorlds, FeaturedDao, Validators, Gnolove, Directory, Ecosystem), each fed by its own TanStack Query hook in `hooks/home/`, built from one `ActionCard` primitive. Phase 0+1 does client-side fan-out; **Phase 2 (#445) adds backend `GetHomeSnapshot`** to collapse the fan-out into one 30s-cached RPC keyed by chain-id (clean design, mirrors the indexer-first/on-chain-fallback pattern). 146 home tests green on `main`.

**Phase 0+1 delivered = faithful to `HOME_REWORK.md`.** Landing + Remotion fully retired. Deferred items (featured members, validator uptime, live Activity card) were deferred *as planned*.

**"Not perfect yet" findings (14):**

| # | Finding | file:line | Sev | Fix |
|---|---------|-----------|-----|-----|
| 1 | **CI red:** 9 `errcheck` lint failures (test-only) block #445; Security Scan fails on same gate | `backend/internal/service/home_rpc_test.go:45,46,53,54,135,137,170,550,594` | **High** | Assign `os.Setenv`/`os.Unsetenv`/`w.Write` returns to `_`; re-run lint **[VERIFIED root cause]** |
| 2 | **Validators show 0:** Go `home_rpc.go` never sets `NetworkPulse.ValidatorsTotal`, but frontend reads `snapshot.network?.validatorsTotal` | `home_rpc.go fetchNetworkPulse` (no `ValidatorsTotal` set — **[VERIFIED]** 0 matches); `useNetworkPulse.ts:63` | **High** | Set `pulse.ValidatorsTotal`, or read `snapshot.counts.validators`; add regression test |
| 3 | False "Healthy": `useValidatorHealth` defaults `status:"healthy", total:0` on query error | `useValidatorHealth.ts:85`; `ValidatorsPanel.tsx:68` | Med | Add `unknown`/error status; show "—" not "Healthy" |
| 4 | StatusStrip can't show "offline": `loading` only tracks `isLoading`, never `isError` | `useNetworkPulse.ts:55`; `StatusStrip.tsx:24` | Med | Surface `isError` → distinct offline dot |
| 5 | Emoji 🌐 violates the doc's own "retire emoji" token rule (only home component still using one) | `YourWorldsPanel.tsx:38` | Med | Replace with Tabler icon |
| 6 | Inline `style={{…}}` + re-implemented card markup instead of `<ActionCard>`/`home.css` | `YourWorldsPanel.tsx:37-126` | Med | Move to `home.css` + `ActionCard` |
| 7 | Mislabeled metric: "members"/"contributors" comes from Gnolove **GitHub** stats, not on-chain members | `useNetworkPulse.ts:54`; `traction.ts:70` | Med | Relabel "GH contributors" or source real member count |
| 8 | Hardcoded `"test12"` fallback + hardcoded namespace `"samcrew"` in shared `traction.ts` (home runs on test13) | `traction.ts` daoCount (~:88) | Med | Pass active `networkKey`; make namespace configurable |
| 9 | Orphaned `NetworkStatsLive.tsx` (+ dead `landing-stat*` CSS) survived the Landing purge | `components/landing/NetworkStatsLive.tsx` | Low | Delete |
| 10 | Stale route comment ("redirects to /dashboard when connected") | `App.tsx:170` | Low | Update |
| 11 | StatusStrip not full-bleed (renders inside `.k-main` padding; border floats mid-page) | `home.css:130`; `Layout.tsx:320` | Low | Render outside `.k-main` or drop border |
| 12 | Skeleton↔content count mismatch → layout shift (CLS) | `ActionInbox.tsx:81`; `GnolovePanel.tsx:43`; `DirectoryPanel.tsx:45` | Low | Match skeleton count/height |
| 13 | Hardcoded wordmark `メンバー` literal | `StatusStrip.tsx:20` | Low | Pull from brand constant |
| 14 | `ActionCard.icon` unused on action paths (sign/candidature cards lack glyphs) | `ActionInbox.tsx:132` | Low | Pass per-kind icons |

**Gotcha honoured [VERIFIED]:** backend `isOpenProposalStatus` maps `active`/`open`/`""`→open, mirroring the frontend — the `"active"`-removal was NOT mirrored into the backend. ✅

## A4. test13 deployment & feature reality

**Realm inventory [DOC-CLAIMED — not in the ledger].** Reconstructed from `frontend/src/lib/config.ts` `REALM_ALLOWLIST.test13` + `TEST13_GO_LIVE_NOTE.md`; **`realm-versions.json` has no test13 block to corroborate blocks/txHashes.**

| Realm | Path | Status |
|-------|------|--------|
| DAO core | `r/samcrew/memba_dao` | LIVE & valid; Featured DAO |
| Candidature | `…/memba_dao_candidature_v2` | LIVE; **no accept/reject UI** → approved deposits can lock |
| Channels | `…/memba_dao_channels_v2` | LIVE (post/reply); **admin create/edit/delete/flag unwired** |
| Agent registry | `…/agent_registry` | LIVE; `UseCredit` hardened; credits UI gated off |
| Token factory | `…/tokenfactory_v2` | LIVE & functional |
| Escrow | `…/escrow_v2` | valid but **gated off** (`VITE_ENABLE_SERVICES=false`) |
| Badges | `…/gnobuilders_badges_v2` | deployed but **`TotalSupply()=0`, never mints** |
| Feedback | `…/memba_feedback_v2` | LIVE & functional |
| NFT token / market | `…/memba_nft_v2`, `…/memba_nft_market_v2` | valid but **gated off** (`VITE_ENABLE_NFT=false`) |
| NFT launchpad registry | `…/memba_collections` | valid; **irreversible** realm |
| NFT trading engine v3 | `…/memba_nft_market_v3` | deployed but **deliberately NOT frontend-wired** (excluded from allowlist pending Phase 3 router) |

**Feature functionality matrix (test13) [VERIFIED against page wiring + flag defaults]:**

| Feature | Status | Evidence |
|---------|--------|----------|
| DAO governance (read/propose/vote) | ✅ LIVE | no realm gate; audited GO |
| DAO treasury *spend* | ⛔ gated off (fund-safety) | `TREASURY_SPEND_ENABLED=false` |
| Channels | 🟡 post/reply only | admin builders unwired |
| Candidature | 🟡 apply works | accept/reject has no UI |
| Token factory | ✅ LIVE | `isTokenFactoryValid()` → real path |
| Escrow / Services | ⛔ ready-but-off | `VITE_ENABLE_SERVICES=false` |
| NFT marketplace/launchpad | ⛔ off in repo | `VITE_ENABLE_NFT=false` (claimed on in Netlify — unverifiable from code) |
| GnoBuilders quests | 🟡 live but forgeable | `CompleteQuest` does no server-side verify; ~15/85 completable |
| GnoBuilders badges | ⛔ broken | `TotalSupply()=0`; no signer |
| Agent credits | ⛔ fail-closed off | `AGENT_CREDITS_ENABLED=false` |
| Feedback board | ✅ LIVE | `isFeedbackValid()` |

## A5. test12 winddown — committed-config reality [VERIFIED]

- `backend/fly.toml:25` `GNO_CHAIN_ID = 'test12'`; `:30` `MEMBA_ACCEPTED_CHAIN_IDS='test12,test-13'`; `:31` RPC = `rpc.testnet12.samourai.live`. Helpful inline comment at `:29` already describes the cutover.
- `.github/workflows/deploy-frontend.yml:71` `VITE_GNO_CHAIN_ID: test12`; `:72` test12 RPC; **`:73` `VITE_DAO_REALM_PATH: gno.land/r/samcrew/samourai_dao` — STALE** (should be `…/memba_dao`).
- **Auth enforcement flags absent from `fly.toml` → permissive defaults [VERIFIED].** `MEMBA_ALLOW_UNSIGNED_AUTH` unset = **Phase 1 (accept unsigned + log)**; `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` unset = **log-only**. This is the *deliberate lockout-safe staged rollout* (`crypto.go:213-226`, `multisig_verify.go:17-28`), not a bug — flipping to enforce is a gated step.
- `frontend/src/lib/config.ts`: `NETWORKS.test12` (~:84), plus `||"test12"` fallbacks at `:163` (DEFAULT_NETWORK), `:257`, `:343`+`:348`, `FEATURED_DAO_REALM.test12` (~:547).
- Other fallbacks: `directory.ts:133`, `traction.ts:89`, `chainHealth.ts:110`.
- test12-specific UI: `ChainHaltedBanner.tsx:59`, `gnolove/teams/TeamHubHeader.tsx:53`; backend `analyst_consensus.go:504`.
- Test golden-vectors hardcode `test12` (auth/crypto/signbytes) — **safe to leave** (they test chain-id binding generically); review only.

## A6. Workstream map [VERIFIED unless noted]

| Workstream | Status | Where | Next action |
|------------|--------|-------|-------------|
| Home rework | IN-FLIGHT | P0+1 merged #439; P2 = #445 (CI red) | Fix #445, merge (Track 1) |
| NFT Marketplace P2 | IN-FLIGHT | #443 (green) | On-chain E2E → merge (Track 2) |
| NFT Phase 0 data foundation | **DONE** | merged #431 (in `main`; migration 013, indexer, points) | none — branch is stale, prune |
| NFT Phase 3 / floor offers | PLANNED | designs in `main` (`NFT_FLOOR_OFFERS_DESIGN.md`, `NFT_PHASE0…PLAN.md`) | build engines after go-live |
| NFT Creator Studio | DONE | merged #441 | none |
| NFT v3 trading engine wiring | TODO | `memba_nft_market_v3` deployed, not in allowlist | multi-engine router → add to allowlist (Track 2) |
| GnoBuilders quests/badges/verifiers | DONE (code) | #437/#438/#440/#442 | server-side quest verify + badge mint ceremony (Track 2) |
| GnoBuilders namespace test | IN-FLIGHT | #444 (green) | merge (Track 0) |
| AAA auth | LARGELY SHIPPED | tm2 sign-bytes helper #397, server-side multisig verify #398, A2-verify #399, signed-login re-enabled #407 | enforce-flip only (= Track 3 cutover gate); validate then flip |
| test13 go-live | DONE (live) [DOC] | `TEST13_GO_LIVE_NOTE.md` | ledger backfill + auth validation (Track 3) |
| Services/Escrow | BLOCKED (flag off) | `escrow_v2` valid | E2E + CI-gate fix + flip (Track 2, D2) |
| Teams (Memba orgs) | NOT STARTED | `TEAMS_ACTIVATION.md` | confirm backend exists; likely from scratch (Track 4) |
| Agent credits | gated off | fail-closed per A5 | keep off pending A5 redeploy |
| gnolove | DONE | v6.3.1 | publish release tag (Track 4) |

## A7. Corrections to project memory / stale docs

- ❗ **No stranded "20-commit NFT Phase-0" work** — merged via #431, content confirmed in `main`. (Memory/agent over-flagged a three-dot diff artifact.)
- ❗ **#430 (NFT allowlist) and samcrew-deployer #32 (RegisterMarket-v3) are MERGED** (both 06-18) — memory said "OPEN/held."
- ❗ **NFT Creator Studio is merged (#441)** — memory said unmerged on `feat/nft-creator-studio`; that local branch **doesn't exist** anymore.
- 🟡 **`docs/planning/TEST13_FEATURE_AUDIT.md` is stale** — claims 6 realms are invalid-v1-on-v2 with "zero gating"; reality: redeployed to `_v2` paths + re-gated (config verified). The `/vm.m_call`→`vm/MsgCall` agent-builder bug it flags is **fixed**.
- 🟡 **`CHANGELOG.md` / `ROADMAP.md` ~4 weeks stale** — missing the entire 06-18→19 wave (NFT launchpad, GnoBuilders, Home rework). ROADMAP still points at "v7.1 Phase 1."
- 🟡 **`docs/features/*_ACTIVATION.md`** prerequisite sections describe realms as pending-deploy; they're live. Flag-flip gates remain accurate.

## A8. Branch & worktree hygiene (reconciled) [VERIFIED]

**Worktrees:** `Memba` (main), `memba-home` (`feat/home-rework` — superseded by #439), `memba-home-phase2` (`feat/home-phase2` = #445, active), `memba-nft-phase2` (`feat/nft-marketplace-phase2` = #443, active), `memba-nstest` (`feat/gnobuilders-namespace-live-test` = #444, active).

**Prune candidates (squash-orphans / stale, direct-diff confirmed no unmerged content):** `feat/nft-phase0-data-foundation`, `feat/nft-floor-offers-design`, `feat/nft-v3-trading-ui`, `feat/nft-collectiondetail-ux`, `feat/nft-collection-route-fix`, `feat/nft-launchpad-allowlist-surface`, `feat/nft-launchpad-css-fix`, `feat/home-rework`, `docs/nft-ui-rework-design`. Worktrees `memba-home` (and `memba-nft-phase2`/`memba-nstest` once their PRs merge) can be removed.

---

# PART B — IMPLEMENTATION PLAN

> Recommended execution order: **Track 0 → 1 → 2 → 3 → 4**. Tracks 1–3 map to the user's priorities (homepage / test13 / test12). Track 0 unblocks everything fast. Each task = its own feature branch → PR → squash (per SESSION_CONVENTIONS §2). Gates per §3 before any merge.

## Track 0 — Unblock & hygiene (fast; ~½ session)

### Task 0.1 — Fix #445 CI (homepage Phase 2 unblock) [High] ✅ DONE (local), ⏳ needs push
**Branch:** `feat/home-phase2` (worktree `memba-home-phase2`).
**FINDING:** the lint fix was already committed locally (`bc4b7d2`, "clear backend CI lint") but **never pushed** — `origin/feat/home-phase2` + PR #445 head were still at the pre-fix `b723eb2`, which is why CI was red. The fix was stranded, not missing.
- [x] errcheck fixed (`home_rpc_test.go`: `os.Setenv/Unsetenv`→`t.Setenv`, `w.Write`→`_, _ =`) + gosec G115 annotation — in `bc4b7d2`.
- [x] `cd backend && golangci-lint run ./...` → **0 issues** (verified locally with CI's exact command; no `.golangci.yml` exists — CI uses defaults).
- [x] `gosec -exclude-generated -severity high -confidence medium ./...` → **0 issues** (verified).
- [ ] **Push `bc4b7d2`+`2dbea9c`** to origin → CI re-runs on the real head → both red checks go green.

### Task 0.2 — Fix the validators-count bug in #445 [High] ✅ DONE (local, TDD), ⏳ needs push
- [x] TDD: added failing regression test `TestAssembleHomeSnapshot_WiresValidatorsTotalIntoNetwork` (real httptest server, 3 validators), watched it fail (`ValidatorsTotal = 0, want 3`).
- [x] Fix in `home_rpc.go assembleHomeSnapshot`: wire `snap.Network.ValidatorsTotal = v.Total` in the validators block (guarded `if snap.Network != nil`; ordering-correct since /status is fetched first). Commit `2dbea9c`. No frontend change needed — `useNetworkPulse.ts:63` already reads `snapshot.network?.validatorsTotal`.
- [x] `go test ./...` green; `go test -race ./internal/service/` green; lint + gosec still 0.
- [x] **Cross-perspective review (2 independent agents): both MERGE-READY.** Gotcha (ACTIVE=open) PASS. Findings: only Low nits.
- [ ] **Gate:** push → CI green → request user approval → squash-merge #445. *(Closes homepage Phase 2.)* **(merge needs explicit user approval)**

**Deferred Low-severity hardening (follow-up, do NOT expand #445):** (1) wrap `httpGetJSON` body read with `io.LimitReader(…, 5<<20)`; (2) give `abciQuery` a ctx param for cancellation; (3) optional `singleflight` for cache-miss thundering-herd; (4) overall deadline on `assembleHomeSnapshot` (≤9 sequential upstream calls = ~90s worst case). Track in Track 1 or a follow-up PR.

### Task 0.3 — Merge #444 (trivial) [Low]
- [ ] Confirm green; request approval; squash-merge. Remove worktree `memba-nstest` + branch.

### Task 0.4 — Branch & worktree cleanup (D4)
- [ ] After a final `git diff main <branch>` confirm-empty per branch in A8, delete the 9 prune-candidate branches (and their `origin/` if pushed).
- [ ] `git worktree remove memba-home`; remove `memba-home-phase2`/`memba-nft-phase2` after their PRs merge.
- [ ] In `samcrew-deployer`, `git switch main && git pull` (fast-forward the 1-behind local main).

### Task 0.5 — Doc refresh (no code) [Med]
- [ ] `CHANGELOG.md` + `ROADMAP.md`: record the 06-18→19 wave (NFT launchpad #430–#436/#441, GnoBuilders #437/#438/#440/#442, Home #439) and the current milestone.
- [ ] Mark `docs/planning/TEST13_FEATURE_AUDIT.md` **RESOLVED** (realms redeployed to `_v2` + re-gated; agent-builder bug fixed).
- [ ] Update `docs/features/{NFT,MARKETPLACE,SERVICES}_ACTIVATION.md` prerequisite sections (realms live; only flag-flip + verification remain).
- [ ] Sync `npm version` (`4.1.0`) to the real product line, or note it as intentionally unused.

## Track 1 — Homepage polish (priority c)

> After #445 merges, address A3 findings #3–#14. Branch `fix/home-polish` (or split).

### Task 1.1 — Truthful health/connection signaling [Med] (findings #3, #4)
- [ ] `useValidatorHealth.ts:85`: introduce an `unknown` status; on `query.isError` render neutral "—", not "Healthy".
- [ ] `useNetworkPulse.ts`/`StatusStrip.tsx`: surface `isError` → distinct "offline" dot + title.
- [ ] Tests for both error states; `npm test` green.

### Task 1.2 — Token/brand consistency [Med] (findings #5, #6, #13)
- [ ] Replace 🌐 in `YourWorldsPanel.tsx:38` with a Tabler icon.
- [ ] Migrate `YourWorldsPanel` inline styles → `home.css`; render invites via `<ActionCard>`.
- [ ] Pull the `メンバー` wordmark from a brand constant/logo component.

### Task 1.3 — Correct/clarify metrics [Med] (findings #7, #8)
- [ ] Relabel the Gnolove-GitHub metric as "GH contributors" (or wire a real on-chain member count when `ListProfiles` lands).
- [ ] `traction.ts`: thread the active `networkKey` (remove `||"test12"`); make namespace configurable via `lib/config`.

### Task 1.4 — Dead code & polish [Low] (findings #9–#12, #14)
- [ ] Delete `components/landing/NetworkStatsLive.tsx` + dead `landing-stat*` CSS; fix `App.tsx:170` comment.
- [ ] Make StatusStrip full-bleed (render outside `.k-main` or drop the floating border).
- [ ] Reduce skeleton↔content CLS; pass per-kind icons to action cards.
- [ ] **Gate:** §3 → PR → merge.

## Track 2 — test13 functional completeness (priority b)

### Task 2.1 — Finalize NFT Marketplace Phase 2 (#443) [High]
- [ ] On the #443 deploy-preview, run the on-chain E2E on test13: create collection → admin-mint → list (wallet 1) → buy (wallet 2) → confirm the v3 `Sale` event indexes (no double-count, per the `pkg_path`-scoped indexer).
- [ ] Document the run in the PR; **gate** §3 → approval → squash-merge. Remove worktree `memba-nft-phase2`.

### Task 2.2 — Turn NFT commerce ON (D1) [High]
- [ ] Wire `memba_nft_market_v3` into the frontend: build the minimal multi-engine router and add `memba_nft_market_v3` to `REALM_ALLOWLIST.test13` in `config.ts`.
- [ ] Ensure `CreateCollectionLaunchpad.tsx` gates render on `isNftLaunchpadValid()` (currently flag-only).
- [ ] Set `VITE_ENABLE_NFT=true` in Netlify (CI `.env.example` gate stays as-is) — pending **D1**.
- [ ] Verify launchpad + marketplace render and trade on test13.

### Task 2.3 — Ledger backfill: record test13 in `realm-versions.json` [High] (also a Track 3 precondition)
- [ ] For each test13 realm in `REALM_ALLOWLIST.test13`, verify on-chain via `vm/qfile <pkgpath>`; record path/version/block/date/txHash (`base64(sha256(txbytes))` of the deploy tx) under a new `"test13"` block.
- [ ] Cross-check ACL guard counts as in the existing test12 notes.

### Task 2.4 — Candidature accept/reject UI [Med]
- [ ] Add `MarkApproved`/`MarkRejected` builders (`frontend/src/lib/dao/builders.ts`) + admin UI on the candidature page, so approved deposits don't lock. (Or document CLI-only + warn in UI.)
- [ ] Tests; gate; PR.

### Task 2.5 — Channel admin wiring [Med]
- [ ] Wire create/edit/delete/flag/membership builders to UI callers (builders exist; callers missing). Tests; gate; PR.

### Task 2.6 — GnoBuilders integrity [Med→High for credibility]
- [ ] Ship server-side quest verification in `backend/internal/service/quest_rpc.go` `CompleteQuest` (today it does none → leaderboard forgeable). Start with the verifiable subset; fail-closed otherwise.
- [ ] Badge go-live (D5): IPFS-pin assets → multisig mint ceremony (`docs/BADGE_MINT_RUNBOOK.md`) → flip `VITE_ENABLE_BADGES`. *(off-chain / your action)*

### Task 2.7 — Services/Escrow activation (D2 — deferred default) [Med]
- [ ] Run one escrow lifecycle (fund→milestone→release) on test13; verify GRC20 approve/transferFrom.
- [ ] Add `VITE_ENABLE_SERVICES` to the CI safety gate; flip the flag — pending **D2**.

## Track 3 — test12 winddown (priority a) — STAGED (D3)

### Task 3.1 — Cutover precondition: auth validation [High, gating]
- [ ] Connect Adena with a **test13-transacted** wallet; hit `auth_login`; confirm `result=signed` (per `TEST13_GO_LIVE_NOTE.md §🔶.1`). If not signed, do **not** proceed to the flip.
- [ ] Complete Task 2.3 (ledger backfill) — must precede any cutover.

### Task 3.2 — Backend cutover (single release with 3.3) [High]
**File:** `backend/fly.toml`
- [ ] `:25` `GNO_CHAIN_ID = 'test-13'`; `:31` `GNO_RPC_URL` → a test13 node; `:30` `MEMBA_ACCEPTED_CHAIN_IDS = 'test-13'`.
- [ ] Add `MEMBA_ALLOW_UNSIGNED_AUTH = '0'` and `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY = '1'` (enforce — only after 3.1 passes).

### Task 3.3 — Frontend cutover (same release) [High]
**File:** `.github/workflows/deploy-frontend.yml`
- [ ] `:71` `VITE_GNO_CHAIN_ID: test13`; `:72` RPC → test13; **`:73` fix the stale DAO path** → `gno.land/r/samcrew/memba_dao`.
- [ ] `.env.example:40-41` → test13 (dev parity).

### Task 3.4 — Remove test12 from the network map [Med]
**File:** `frontend/src/lib/config.ts`
- [ ] Remove `NETWORKS.test12` (~:84). Replace `||"test12"` fallbacks at `:163`, `:257`, `:343`/`:348`, `FEATURED_DAO_REALM.test12` (~:547) with test13.
- [ ] `directory.ts:133`, `traction.ts:89`, `chainHealth.ts:110` (drop test12 from fallback order).

### Task 3.5 — test12-specific UI + tidy [Low]
- [ ] `ChainHaltedBanner.tsx:59`, `gnolove/teams/TeamHubHeader.tsx:53`, backend `analyst_consensus.go:504` → test13.
- [ ] Update `LegacyRedirect.tsx`/`DAORouter.tsx` doc comments. Review (leave) the golden-vector tests.
- [ ] Archive the `test12` block in `realm-versions.json` once `test13` is recorded.
- [ ] **Gate:** §3 → PR → merge → deploy. Verify a fresh visitor lands on test13 and authed RPCs succeed.

## Track 4 — Deferred / strategic (after the top-3)

- **AAA auth — mostly shipped (correction):** the tm2 canonical sign-bytes helper (#397), server-side multisig verify (#398), tx-shaped login verify (#399), and signed-login re-enable (#407) all merged 06-12→06-15. The keystone is NOT stalled. What remains is the **enforce-flip** (`MEMBA_ALLOW_UNSIGNED_AUTH=0` + `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`), which is exactly Track 3.2's cutover gate — validate a test13 wallet returns `result=signed`, then flip. Remaining hardening per `MEMBA_AAA_IMPLEMENTATION_PLAN.md` is incremental, not blocking.
- **NFT Phase 3 / floor offers:** Phase 0 foundation is in `main`; build engines per `NFT_MARKETPLACE_PHASE3_FOUNDATION_PLAN.md` + `NFT_FLOOR_OFFERS_DESIGN.md`.
- **Teams (Memba orgs):** confirm whether backend `TeamService`/`004_teams.sql`/`team_rpc.go` exist; likely from-scratch. Lowest priority.
- **gnolove:** publish the v6.3.1 release tag; add `onbloc/gno-ibc/main` to VPS `GITHUB_REPOSITORIES`.
- **Dependency vulns [VERIFIED via push 2026-06-23]:** Dependabot reports **28 open alerts on the default branch — 1 critical, 5 high, 14 moderate, 8 low**. The ROADMAP previously claimed "0 open alerts" (now corrected). Run a dependency-refresh pass (prioritise the critical + 5 high); the repo has prior precedent (#363/#365/#368). Worth its own `chore/dep-refresh` PR.
- **gnodaokit:** triage the 4 stale PRs (#62 audit, #63/#64 toolchain/port) only if a Memba dep bump needs them.

---

## Quality gates (apply per task before any merge — SESSION_CONVENTIONS §3)
`npm test` (≥90% new-code cov) · `npx playwright test` · `go test -race -count=1 -cover ./...` · `npm run lint` (0/0) · `npx tsc --noEmit` (0) · `npm run build` (<500KB) · `govulncheck ./... && gosec ./...` (0). CHANGELOG/ROADMAP updated on merge.

## Verified-vs-claimed ledger
**[VERIFIED in code/CI this session]:** all git/PR/CI states; local build+test (2399 FE / all BE); #445 root cause + validators bug; `realm-versions.json` has no test13; `fly.toml`/`deploy-frontend.yml` test12 + stale DAO path; auth-flag defaults; config.ts gating + flag defaults; branch reconciliation (Phase-0 merged via #431; studio via #441; no stranded work).
**[DOC-CLAIMED — not re-probed against the live chain]:** test13 realm on-chain liveness/blocks, badge `TotalSupply()=0`, AAA-0 ship list, Netlify flag overrides.
