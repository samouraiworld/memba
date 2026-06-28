# Memba Quests — Deep Audit & Production Delivery Plan

**Date:** 2026-06-26
**Author:** CTO + cross-perspective expert panel (2× Gno core engineers, full-stack engineers, security team, UX expert, UI expert) + 5 simulated Gno users
**Status:** AUDIT COMPLETE → DECISIONS LOCKED → VALIDATION ROUND → READY TO START (dedicated branch)
**Network:** test13 (`chain-id="test-13"`) — live at https://memba.samourai.app/test13/quests
**Scope:** The Quests feature end-to-end — catalog, ranks, XP, candidature gate, badges, leaderboard, admin review, on-chain verification, and the backend that powers it.

> **How to read this file.** Part I is the audit (the persistent reference). Part II is the implementation plan you review and approve. Part III is the review/triple-check governance that runs *through* the plan. Issue IDs (Q-NN) are stable handles used in both parts.

---

## 0. Method & Sources

This audit was produced by reading the shipped code (which **is** what is live on test13), the docs/changelog/roadmap, the CI configuration, and by assessing the upstream Gno ecosystem for breaking changes. Four parallel expert deep-dives fed it, then findings were **triple-checked against source** — which corrected three false negatives (see §1.4). Live-browser capture was blocked by a locked Chrome profile; the assessment is grounded in source + existing screenshots instead, which is faithful because the test13 deployment tracks the merged code.

**Primary evidence files:**
- Frontend: `frontend/src/lib/quests.ts`, `frontend/src/lib/gnobuilders.ts`, `frontend/src/lib/questVerifier.ts`, `frontend/src/lib/questClaims.ts`, `frontend/src/lib/badges.ts`, `frontend/src/pages/{QuestHub,QuestDetail,QuestAdmin,Leaderboard}.tsx`, `frontend/src/components/quests/*`, `frontend/src/components/ui/{QuestProgress,CommandPalette}.tsx`
- Backend: `backend/internal/service/quest_rpc.go`, `quest_verify.go`, `quest_verify_phase3.go`, `backend/cmd/badge-mint/main.go`, `backend/internal/db/migrations/{003_quests,010_gnobuilders}.sql`, `backend/internal/auth/crypto.go`, `backend/internal/ratelimit/limiter.go`
- Docs/CI: `CHANGELOG.md`, `ROADMAP.md`, `docs/**`, `.github/workflows/ci.yml`, `realm-versions.json`, `.env.example`
- On-chain: `samcrew-deployer/projects/memba/realms/**`, `gno/examples/gno.land/r/sys/users/store.gno`

---

# PART I — AUDIT

## 1. Executive Summary

### 1.1 Verdict

The Quests feature is **substantially built and architecturally sound — roughly 70–75% of the way to a polished, production-grade ("delivered") state.** The hard parts are done and correct: a server-authoritative XP model, genuine on-chain proof verification, an offline-first client, per-wallet isolation, a curated honest catalog (44 live of ~85), a working leaderboard, a candidature gate, a self-report claim+review flow, and a badge-mint tooling path. The June "Phase 0" hardening wave (#437–#444, #483, #486, #502, #539) closed the dangerous exploits (forgeable leaderboard, localStorage XP bypass, "credit-any-realm" deploy quests).

**What stands between "live on test13" and "delivered AAA product":**
1. **Badges never mint** — the queue exists, the CLI exists, the art pipeline exists, but `gnobuilders_badges_v2.TotalSupply() == 0`. The reward loop is open. *(Q-01)*
2. **~40% of on-chain verifiers are unimplemented** and silently return `false`; those quests are honestly hidden as "coming soon," which caps the *playable* set at ~44 and makes the catalog feel thin. *(Q-02)*
3. **No per-user rate limiting** → sybil/leaderboard farming and on-chain-verify DoS remain open at scale. *(Q-03, Q-04)*
4. **Polish debt**: fragile sync indicator, missing loading skeletons, hardcoded theme colors, weak focus states, generic error copy, duplicated XP-threshold constant. *(Q-10..Q-20)*
5. **Centralization**: quest XP is purely a backend SQLite ledger with no on-chain settlement — acceptable for a zero-value testnet, a real question for "decentralized onboarding" at mainnet. *(Q-05)*

**No critical exploit is currently open, and no upstream Gno change breaks the feature** (full ecosystem assessment: §6).

### 1.2 Component scorecard

| Area | State | Grade |
|---|---|---|
| Server-authoritative XP + idempotency | Shipped, correct | A |
| On-chain proof verification (deploy/namespace/candidature/join-dao/create-token) | Shipped, un-spoofable | A− |
| Offline-first client + per-wallet isolation (H-06) | Shipped | A− |
| Candidature XP gate (backend-authoritative) | Shipped, bypass closed | A |
| Quest catalog & rank system (44 live / 85 total, 8 tiers) | Shipped, honestly curated | B+ |
| Leaderboard | Shipped & routed (`/leaderboard`) | B |
| Self-report claim + admin review | Built & wired, under-tested | B− |
| **Badge mint + display loop** | **Tooling only; never executed; grid not mounted** | **D** |
| On-chain verifier coverage (vote/board/nft/token-send/multisig/…) | ~60% live, ~40% stubbed | C |
| Sybil / per-user rate limiting | Absent | C− |
| UX polish (loading/empty/error/copy) | Partial | C+ |
| UI/theme/a11y | Mostly tokenized; gaps | B− |
| Observability (quest metrics) | Absent | C |
| Test coverage (unit+e2e+backend) | Good breadth, gaps in self-report/badge e2e | B |

### 1.3 The architecture in one picture

```
                    ┌─────────────────────────── CLIENT (offline-first) ───────────────────────────┐
 user action ─────▶ │ auto-track (visit-5-pages, use-cmdk, switch-network, share-link)              │
                    │ self-report (URL+text → SubmitQuestClaim)                                      │
                    │ on-chain ("Verify": enter realm path / verify-from-address)                    │
                    │   localStorage (per-wallet scoped) = optimistic overlay, NEVER authoritative   │
                    └───────────────┬───────────────────────────────────────────────────────────────┘
                                    │ ConnectRPC (+ A2/A3 ed25519 auth token, chain-id bound)
                                    ▼
        ┌──────────────────────── BACKEND (authoritative, Go + SQLite) ────────────────────────┐
        │ CompleteQuest → verifyQuestCompletable() re-checks EVERY claim server-side:           │
        │    off_chain → accept (low-XP)   self_report → REJECT (must go via claim review)       │
        │    on_chain  → ABCI query gno chain (namespace owner / qfile exists / render parse)    │
        │ quest_completions (PK address,quest_id; INSERT OR IGNORE = idempotent)                 │
        │ XP recomputed server-side from validQuests map · user_ranks cache · queueBadgeMint()   │
        │ GetUserQuests (public) · GetLeaderboard · SubmitQuestClaim/ReviewQuestClaim (admin)    │
        └───────────────┬─────────────────────────────────────────┬────────────────────────────┘
                        │ reads (verification only, no XP on-chain) │ badge_mints queue (drained MANUALLY)
                        ▼                                           ▼
              gno.land/r/sys/users, vm/qfile,            backend/cmd/badge-mint CLI → multisig signs →
              memba_dao*, candidature_v2, tokenfactory   gnobuilders_badges_v2.MintQuestBadge  ◀── NEVER RUN
```

**Key truth:** XP lives only in the backend DB. The chain is consulted to *prove an action happened*, never to *hold the score*. Badges are the only on-chain artifact — and they have never been minted.

### 1.4 Triple-check corrections (why rigor matters)

Initial expert passes reported three problems that **source verification disproved** — recording them so the audit is trustworthy:
- ❌ "Leaderboard page missing / link dangles" → **FALSE.** `Leaderboard.tsx` (160 LOC, quest-aware) is routed at `App.tsx:275`.
- ❌ "Self-report submission UI missing (Phase 2)" → **FALSE.** `SelfReportForm` is rendered at `QuestDetail.tsx:257`; `questClaims.ts` implements submit/list/review; `QuestAdmin.tsx` is the review queue.
- ❌ "`use-cmdk` quest has no trigger" → **FALSE.** Fired at `CommandPalette.tsx:75`.

These were doc-vs-code drift. The corrected reality is that the feature is *more* complete than its own roadmap notes claim — the gap is **execution & polish, not missing scaffolding**.

---

## 2. Feature Inventory (what exists today)

| Surface | File | What it does |
|---|---|---|
| Quest Hub | `pages/QuestHub.tsx` + `questhub.css` | Catalog: search, category/difficulty/status filters, progress bar, rank badge, XP, "syncing…" indicator, live grid + collapsible "Season 2 / coming soon", badges "coming soon" chip, leaderboard link |
| Quest Detail | `pages/QuestDetail.tsx` | Single quest: metadata, prerequisite chain, verification dispatch (on-chain / self-report / coming-soon), completion celebration |
| Quest Admin | `pages/QuestAdmin.tsx` | Pending self-report claims, approve/reject (admin-gated client + server) |
| Leaderboard | `pages/Leaderboard.tsx` | Global XP ranking, rank badges, quest counts, link back to hub |
| Quest Progress widget | `components/ui/QuestProgress.tsx` | Profile widget: collapsed summary + SVG radial ring + expandable grid + candidature CTA |
| Achievement grid | `components/quests/AchievementGrid.tsx` | Badge gallery (fetches on-chain badges) — **defined, not mounted on profile** |
| Self-report form | `components/quests/SelfReportForm.tsx` | URL + text proof → `SubmitQuestClaim` |
| Candidature unlock | `components/quests/CandidatureUnlock.tsx` | Gold-tier CTA to apply for Memba DAO |
| Rank badge / Quest card / Toast | `components/quests/{RankBadge,QuestCard,QuestToast}.tsx` | Visual primitives |
| Quest engine | `lib/quests.ts` | Offline-first store, XP, candidature rules, sync, page/tab tracking |
| Catalog | `lib/gnobuilders.ts` | 85 quests, 8 ranks, `LIVE_QUEST_IDS` (44), category/season helpers |
| Verifier | `lib/questVerifier.ts` | Client-side verification dispatch + on-chain checks |
| Claims | `lib/questClaims.ts` | submit / list / review self-report claims |
| Badges | `lib/badges.ts` + `badgeArt.ts` | Badge eligibility + programmatic SVG art |
| Backend RPC | `service/quest_rpc.go` | CompleteQuest, SyncQuests, GetUserQuests, GetUserRank, GetLeaderboard, SubmitQuestClaim, ReviewQuestClaim |
| Backend verify | `service/quest_verify.go`, `quest_verify_phase3.go` | Server-side re-verification (off/on-chain, deploy namespace, candidature, join-dao, create-token) |
| Badge mint | `cmd/badge-mint/main.go` | CLI to drain `badge_mints` → gnokey templates for multisig |

**Catalog shape:** 85 unique quests across 4 categories (developer ~30, everyone ~30, champion ~15, hidden ~10). 8 rank tiers: Newcomer(0) → Bronze(50) → Silver(150) → **Gold(350 = candidature unlock)** → Platinum(600) → Diamond(1000) → Obsidian(1500) → Gno Guardian(2000). **44 quests in `LIVE_QUEST_IDS`**; remainder shown as "coming soon."

---

## 3. Consolidated Issue Register

Severity: 🔴 Critical (blocks "delivered") · 🟠 High (correctness/credibility/security) · 🟡 Medium (polish/hardening) · 🟢 Low (nice-to-have). "Status" reflects today's `chore/reviews-enable-flag` branch.

### 🔴 Critical — blocks a credible "delivered" Quests product

| ID | Issue | Evidence | Why it blocks |
|---|---|---|---|
| **Q-01** | **Badge reward loop is open** — quest completion calls `queueBadgeMint` (`quest_rpc.go:245`) writing `pending` rows, but the queue has never been drained; `gnobuilders_badges_v2.TotalSupply()==0`. `AchievementGrid` exists but is **not mounted** on the profile, and `VITE_ENABLE_BADGES=false`. Users earn XP and ranks but get **nothing tangible**. | `cmd/badge-mint/main.go`, `quest_rpc.go:245,657`, `AchievementGrid.tsx` (unmounted), `realm-versions.json` | The core promise ("earn badges") is undelivered; the loop has no payoff. |
| **Q-02** | **~40% of on-chain verifiers unimplemented** — `defaultVerifyOnChainQuest` returns `false` for vote-proposal, create-proposal, execute-proposal, post-board, reply-board, send-tokens, mint-nft, list-nft, hold-5-tokens, 3-dao-member, multisig-signer, validator-delegator, etc. They're hidden as "coming soon," capping the playable catalog at 44 and making it feel thin relative to the advertised 85. | `quest_verify.go` (default-false branch), `gnobuilders.ts:242` (`LIVE_QUEST_IDS`=44) | Limits depth; "85 quests" vs ~44 playable risks a credibility gap. |

### 🟠 High — security, correctness, credibility

| ID | Issue | Evidence | Risk |
|---|---|---|---|
| **Q-03** | **No per-user rate limiting** on CompleteQuest/SyncQuests — only IP /24 endpoint limit (60/min). Sybil farms can mint XP/badges and poison the leaderboard at scale; candidature 350-XP reachable by ~14 off-chain quests. | `ratelimit/limiter.go:65-85`, `main.go` (endpoint "rpc" 60/min) | Leaderboard integrity, badge-spend at mainnet. |
| **Q-04** | **On-chain verify DoS** — each `CompleteQuest` with proof fans out up to 4 ABCI calls (`questAbciQuery`) with no per-user throttle; 60 req/min × 4 = 240 chain calls/min from one subnet. | `quest_verify.go:402-423` | Backend + RPC node load. |
| **Q-05** | **Centralized XP trust** — XP is backend-only; a compromised/malicious operator can insert completions, inflate XP, unlock candidature. No on-chain settlement. | `quest_rpc.go` (DB-only) | Contradicts "decentralized onboarding" narrative; mainnet governance concern. |
| **Q-06** | **Self-report path under-tested** — UI is built (`SelfReportForm`→`QuestDetail:257`, `QuestAdmin`, `questClaims.ts`) but lacks E2E coverage for submit→review→grant; `SelfReportForm` submission is not optimistic-atomic (double-submit window). | `SelfReportForm.tsx:36-48`, no `e2e/*claim*` spec | Regression-prone path that grants XP. |
| **Q-07** | **Frontend↔backend catalog parity is a manual sync point** — `quest_rpc.go:16` comment "Must match `gnobuilders.ts`"; a parity test exists but divergence in XP/ids is a live foot-gun. | `quest_rpc.go:16`, `quest_registry_parity_test.go` | Silent XP mismatches. |
| **Q-08** | **Badge mint durability** — `queueBadgeMint` is fire-and-forget; mint worker is a manual CLI; if a queue write fails or the operator never runs it, badges silently never mint (today's reality). No alerting. | `quest_rpc.go:245,657`, `cmd/badge-mint/main.go` | Reward loss, no signal. |
| **Q-09** | **Duplicated candidature threshold** — `CANDIDATURE_XP_THRESHOLD=350` defined in both `quests.ts:61` and `gnobuilders.ts` (V2). Two sources of truth for the single most important gate. | `quests.ts:61`, `gnobuilders.ts` | Drift unlocks/locks candidature incorrectly. |

### 🟡 Medium — polish & hardening

| ID | Issue | Evidence |
|---|---|---|
| **Q-10** | Fragile "syncing…" indicator: derived from `completed.length` comparison, wrong when same count differs across devices. | `QuestHub.tsx:90` |
| **Q-11** | No loading skeleton while backend XP is fetched on connect → XP "jumps." | `QuestHub.tsx:62-70` |
| **Q-12** | Hardcoded theme colors (`#00d4aa`, gradient hexes) instead of `var(--color-k-accent)` — light-theme drift risk. | `candidatureunlock.css:82-85`, `questprogress.css` |
| **Q-13** | `QuestAdmin` renders raw `createdAt` string (no locale/timezone). | `QuestAdmin.tsx:110` |
| **Q-14** | Deploy-quest input lacks format hint (`gno.land/r/yourname/realm`). | `QuestDetail.tsx:260` |
| **Q-15** | Generic error copy ("Couldn't verify on-chain yet", "No @username registered") — no next step for the user. | `QuestDetail.tsx:148`, `questVerifier.ts:126` |
| **Q-16** | No quest Prometheus metrics (completions by id, verify latency/outcome) — sybil spikes invisible. | backend `/metrics`, no quest counters |
| **Q-17** | `verifySocial()` returns `NOT_VERIFIED` placeholder; `trackNetworkVisit()` orphaned. | `questVerifier.ts:71,437` |
| **Q-18** | "Coming soon" quests listed (dimmed, non-clickable) in the main grid — verbose/confusing vs a cleaner separate section. | `QuestHub.tsx`, `questhub.css:820` (opacity 0.65 legibility) |
| **Q-19** | Verify the wallet lifecycle calls `setQuestWalletAddress()` on connect *and* `null` on disconnect (per-wallet isolation depends on it). | `quests.ts:86`, auth/adena hooks |
| **Q-20** | `v2` badge/candidature realms shipped with **zero ported tests** (v1 unit/regression not carried over). Acceptable on zero-value test13; a mainnet blocker. | samcrew-deployer realms |

### 🟢 Low — accessibility & finish

| ID | Issue | Evidence |
|---|---|---|
| **Q-21** | Missing `:focus-visible` rings on quest cards/filters/buttons. | `questhub.css` |
| **Q-22** | `QuestAdmin` claims list is a `div` grid, not a semantic table/list. | `QuestAdmin.tsx:98-127` |
| **Q-23** | Difficulty conveyed by color only (no text/icon) — WCAG. | `QuestCard.tsx:39-44` |
| **Q-24** | Empty filter result message generic ("No quests in this category") — no "clear filters." | `QuestHub.tsx:235` |
| **Q-25** | Self-report form fields lack `id`/`name`; proof inputs not grouped in a `fieldset`. | `SelfReportForm.tsx:50-88` |

---

## 4. Perspective Findings (the panel)

**Gno core engineer (×2).** On-chain verification is genuinely un-spoofable: namespace ownership matches the *typed* owner field `("<addr>" .uverse.address)` (not a substring scan), path existence via `vm/qfile`, distinct-path-per-deploy-quest dedup. ABCI wire format usage (base64 `data`, `qrender` colon, `qeval` dot) is correct and **unaffected by upstream drift** (§6). The "register-username always-passes" note in `quest_verify.go:181` still accurately reflects `r/sys/users`. Recommendation: keep verification reads behind RPC failover (already done, #488/#539) and add the missing Phase-3 verifiers incrementally — the patterns (`verifyJoinDAO`, `verifyCreateToken`) are the template.

**Backend / security.** Server is authoritative and idempotent; the dangerous exploits are closed. The open security gap is **economic, not cryptographic**: no per-user throttle (Q-03/Q-04) and a centralized ledger (Q-05). Before badges carry value (mainnet), per-address rate limits + sybil heuristics + on-chain settlement (or a signed-voucher mint model) are required. Observability (Q-16) is the cheapest high-leverage fix — you cannot detect farming you cannot measure.

**Full-stack engineer.** The codebase is clean and well-tested in the engine layer (`quests.test.ts`, `quest_rpc_test.go`, parity test). The weak seams are the **edges**: the sync indicator (Q-10), the unmounted `AchievementGrid` (Q-01), the manual badge CLI with no automation/alerting (Q-08), and the manual catalog parity (Q-07). Consolidate the duplicated threshold (Q-09) and generate the backend quest map from the frontend (or vice-versa) to kill the sync point.

**UX expert.** The journey *discover → do → verify → earn XP → rank up → unlock candidature* is coherent and the honest "coming soon" framing builds trust. But the **payoff is missing** (no badge ever appears, Q-01), the **catalog feels thinner than advertised** (Q-02), and **failure states leave users stuck** (Q-15 — generic errors with no next action). The "syncing…" copy and XP jump (Q-10/Q-11) read as flakiness. Fixing the reward loop + error copy is the highest-impact UX work.

**UI expert.** Strong tokenized base (light-theme sweep §13 landed), good hover/celebration motion, solid mobile stacking. Debt: hardcoded accent hexes (Q-12) that will drift the light theme, weak focus visibility (Q-21), color-only difficulty (Q-23), and the dimmed coming-soon grid hurting legibility (Q-18). These are a 1–2 day finishing pass.

**5 Gno users (personas).**
1. *New web3-curious user* — completes connect-wallet/explorer quests, sees XP rise, then **nothing to show for it** (no badge). Confused by "coming soon" quests cluttering the list.
2. *Gno developer* — wants the deploy quests; namespace verification works and feels legit. Hits a dead "Verify" on a vote/board quest that's actually unimplemented-but-shown — mild distrust. Wants clearer "what counts as proof."
3. *DAO governance participant* — vote/proposal quests are exactly their path but are "coming soon" (Q-02). Feels the catalog isn't for them yet.
4. *Power user / completionist* — reaches Gold, unlocks candidature successfully (this works well), but the leaderboard feels gameable and badges never arrive, denting prestige.
5. *Mobile-first user* — flow is usable at 375px; "syncing…" + XP jump reads as a bug; small tap targets on filters.

**Common thread:** the **mechanics are trustworthy; the rewards and the long tail are missing.** Delivering badges + clearer states + more live verifiers converts a solid skeleton into a AAA loop.

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation (→ plan phase) |
|---|---|---|---|
| Badge mint ceremony errors (wrong CID/owner/tier) | Med | High (on-chain, multisig) | Dry-run + golden-file + dual-review runbook (Phase 1) |
| Sybil farming pre-mainnet | Med | Med (testnet) / High (mainnet) | Per-user rate limit + metrics (Phase 2), on-chain settlement (Phase 4) |
| Catalog parity drift | Low | High (XP correctness) | Generate one from the other + CI gate (Phase 1) |
| Light-theme regression from hardcoded colors | Med | Low | Tokenize + CI guard already exists (Phase 1) |
| Enabling `VITE_ENABLE_BADGES` prematurely breaks prod build | Low | High | Badges flag is **not** in `SAFETY_GATED_FLAGS` (safe to enable); still gate behind mint-complete (Phase 1) |
| Upstream Gno breaking change | **Low/None now** | — | Re-run live gated tests before any redeploy (§6) |

---

## 6. Gno Ecosystem Breaking-Change Assessment (no action required)

Full upstream review (gno core, gnodaokit, samcrew-deployer, tokenfactory, adena) found **no confirmed or potential breaking change** to quest/candidature/badge on-chain verification:
- `r/sys/users` `UserData{addr address; username string; deleted bool}` is **byte-identical** at HEAD vs `origin/master`; `ResolveName/ResolveAddress` signatures unchanged → the typed owner-match in `namespaceOwnedBy` holds.
- ABCI wire format (base64 `data`, `qrender` colon, `qeval` dot, `ResponseBase.Error`) unchanged; only test-only commits touch `pkg/sdk/vm/`.
- `chain.emit` hard-cap panic (#5858, state-breaking) — **no Memba realm emits oversized attrs**; the cap was also raised 1024→4096.
- grc721 `SetTokenMetadata` owner-gate (#5792) — already ported in samcrew-deployer (`326e96a`); NFT path, gated off anyway.
- test13 endpoints/chain-id aligned across Memba config, backend default, and adena (`*.test13.testnets.gno.land`, `test-13`).
- #5655 (hyphen usernames) is permissive-only — favorable, never breaking.

**Required guardrail (carried into the plan):** before *any* test13 realm redeploy or gno HEAD sync, run the gated live tests (`quest_verify_namespace_live_test.go`, `quest_verify_phase3_live_test.go`) + `TestQuestVerificationParity`, and spot-check one real `ResolveName` owner match on-chain.

---

# PART II — PRODUCTION DELIVERY PLAN

## 7. North Star & Definition of "Delivered"

> **A Gno newcomer connects a wallet, is guided through a trustworthy, honest quest loop, earns visible XP → ranks → an on-chain badge they can show off, climbs a credible leaderboard, and unlocks Memba DAO candidature — with every state (loading / empty / error / success) polished to AAA, every grant un-gameable, and every reward actually delivered.**

**"Delivered" acceptance (the gate for calling Quests done):**
- [ ] Every quest shown as "live" is completable end-to-end **and** mints/awards its reward.
- [ ] Badges mint on test13 and render on the profile; `VITE_ENABLE_BADGES=true` in a controlled rollout.
- [ ] Playable catalog ≥ a credible threshold (target: ≥ 60 live quests) **or** the "85" claim is reconciled to the live count in all copy.
- [ ] Per-user rate limiting + quest metrics live; leaderboard demonstrably farm-resistant at small scale.
- [ ] All 🔴/🟠 issues resolved; 🟡 addressed or explicitly deferred with rationale; a11y at WCAG AA for the quest surfaces.
- [ ] Self-report submit→review→grant covered by E2E; no double-grant, no double-submit.
- [ ] Security re-audit (independent) signs off; runbook + rollback documented.
- [ ] Three deep-review gates passed (G1/G2/G3, §11).

## 8. AAA Standards (apply to every task)

1. **Honesty over volume** — never show a quest as completable unless its verifier exists and its reward delivers. Reconcile all "85 quests" copy to live reality.
2. **Server is truth** — no client-trusted XP, ever. Every new verifier re-checks on-chain.
3. **Every state designed** — loading (skeleton), empty (guidance), error (cause + next action), success (celebration + reward). No raw strings, no silent failures.
4. **Tokenized & themed** — zero hardcoded colors; light+dark verified; WCAG AA contrast; visible focus.
5. **Tested at the edge** — unit + backend + E2E for each money/XP path; parity enforced in CI.
6. **Observable** — every grant and verify emits a metric; mint failures alert.
7. **Reversible** — flags gate rollout; documented rollback for any on-chain action.

## 9. Phasing

Ordering principle: **close the reward loop and the credibility gap first (highest user-visible value), then harden security/scale, then deepen the catalog, then decentralize for mainnet.** Each phase ends in a review gate.

---

### Phase 1 — Close the Loop & Finish (badges + polish) — *highest priority*

**Goal:** a Gno user can earn a visible on-chain badge; every live state is AAA-polished; the catalog is honest.

| Task | Issues | Acceptance criteria | Test/verify |
|---|---|---|---|
| **1.1 Badge mint ceremony (test13)** | Q-01, Q-08, Q-20 | Regenerate assets → IPFS pin (capture CID) → `badge-mint` CLI dry-run → multisig signs `MintQuestBadge`/`MintRankBadge` for all pending rows → broadcast → mark `minted`+`tx_hash`. `TotalSupply()>0` verified on-chain. | Dry-run golden file; on-chain `TotalSupply`/`BalanceOf` reads; runbook `docs/BADGE_MINT_RUNBOOK.md` updated with exact commands + dual-signer checklist |
| **1.2 Mount AchievementGrid on profile** | Q-01 | Earned badges render on profile Activity tab; reads `getTotalMintedBadges`; empty state ("Complete quests to earn your first badge") for zero. | E2E: connected wallet with ≥1 badge shows it; zero-state renders |
| **1.3 Badge-mint automation + alerting** | Q-08 | Optional scheduled drain OR a documented cadence + a metric/alert when `badge_mints.pending` age exceeds threshold. | Metric exported; alert fires on stale queue in staging |
| **1.4 Enable badges (controlled)** | Q-01 | `VITE_ENABLE_BADGES=true` only after 1.1–1.2 green; verify prod build (native Netlify) passes (`assertSafeFlags` — badges flag is not safety-gated, confirm). | `npm run build` green; deploy-preview + prod parity check |
| **1.5 Consolidate candidature threshold** | Q-09 | Single exported constant; the other re-exports it; parity test asserts equality. | Unit test |
| **1.6 Catalog honesty reconciliation** | Q-02, Q-18 | All user-facing "85 quests" copy reflects live count (or frames total vs live explicitly); coming-soon quests moved to a clean separate section (not dimmed in main grid); legibility ≥ AA. | Visual review; copy audit |
| **1.7 Sync + loading polish** | Q-10, Q-11 | Explicit pending-sync state (not length-compare); skeleton while backend XP loads; no XP "jump." | E2E: offline complete → reconnect shows correct synced state |
| **1.8 Theme + a11y finishing pass** | Q-12, Q-21, Q-22, Q-23, Q-24, Q-25 | Zero hardcoded colors (tokens only); `:focus-visible` rings; semantic claims list; difficulty has text+color; empty-filter guidance; form fields labeled. | Light/dark visual diff; axe/WCAG AA scan clean |
| **1.9 Error-state + copy pass** | Q-13, Q-14, Q-15 | Every verify/submit failure states cause + next action; deploy input shows format hint; `createdAt` localized. | Manual matrix of failure paths |
| **1.10 Per-user rate limiting** *(pulled fwd, decision #4)* | Q-03 | Per-address token bucket on CompleteQuest/SyncQuests/SubmitQuestClaim layered on the IP limit; env-configurable; protects badge mint + attestation writes. | Unit + small load test |
| **1.A Attestation spike (Track A.1–A.2)** *(decision #3)* | Q-05 | ADR picks the on-chain attestation model; minimal prototype realm on test13 with ACL-gated writes + ported tests. Backend/frontend integration (A.3/A.4) lands in Phase 2. | ADR reviewed; realm `_test.go` green; live read on test13 |

**Phase 1 exit (Gate G1):** badges mint & display on test13; all live states AAA; catalog honest; light/dark + a11y clean; full quest+candidature+badge E2E green. **Independent design + a11y review.**

---

### Phase 2 — Trust & Scale (security hardening + verifier expansion)

**Goal:** the loop is farm-resistant and measurable; the playable catalog deepens toward the "delivered" threshold.

| Task | Issues | Acceptance criteria |
|---|---|---|
| **2.1 Per-user rate limiting** | Q-03 | Per-address token bucket on CompleteQuest/SyncQuests/SubmitQuestClaim (e.g. ≤10/min/address) layered on the IP limit; configurable via env. Unit + load test. |
| **2.2 On-chain verify throttle / circuit breaker** | Q-04 | Per-user throttle on `questAbciQuery`; circuit-breaker on slow RPC; bounded fan-out. |
| **2.3 Quest observability** | Q-16 | Prometheus: `memba_quest_completions_total{quest_id}`, `memba_quest_verify_duration_seconds{type}`, verify outcome counters, `badge_mints_pending`. Dashboard + farm-spike alert. |
| **2.4 Catalog parity automation** | Q-07 | Generate backend `validQuests` from `gnobuilders.ts` (or shared source); CI fails on drift (strengthen existing parity test to cover XP+category+verification class). |
| **2.5 Self-report hardening + E2E** | Q-06 | Optimistic-atomic submit (no double-submit); E2E submit→admin review→grant→badge; idempotent review. |
| **2.6 Implement next verifier batch** | Q-02 | Add verifiers for the highest-value stubbed quests (governance: vote-proposal, create-proposal, execute-proposal; board: post/reply; tokens: send-tokens, hold-5-tokens). Each: server re-verify + live gated test. Promote to `LIVE_QUEST_IDS` only when green. |
| **2.7 Sybil heuristics (lightweight)** | Q-03 | Flag/limit rapid multi-account completions from one subnet; leaderboard shows verified accounts; document policy. |

**Phase 2 exit (Gate G2):** rate limiting + metrics live; ≥ target live-quest count reached; self-report E2E green; **independent security re-audit** (sybil, rate-limit, new verifiers, replay) signs off.

---

### Phase 3 — Depth & Delight (catalog completion + seasons)

**Goal:** finish the catalog long tail and add progression mechanics that sustain engagement.

| Task | Issues | Acceptance criteria |
|---|---|---|
| **3.1 Remaining verifiers** | Q-02 | Implement/curate the rest of the on-chain quests (nft mint/list, multisig-signer, validator-delegator, multi-DAO, channels) or formally retire them from the catalog. No silent `false`. |
| **3.2 Hidden quest wiring** | Q-17 | Wire the easter-egg/hidden quests; remove orphaned `trackNetworkVisit`; replace `verifySocial` placeholder (real social verification or remove social quests). |
| **3.3 Rank perks rendering** | — | Render defined rank cosmetics (profile glow/border/frame) tied to tier. |
| **3.4 Seasons / leaderboard reset** | — | Season model: snapshot, reset, season badges; leaderboard "season vs all-time." |
| **3.5 Leaderboard polish** | — | Pagination, self-highlight, verified indicator, share. |

**Phase 3 exit (Gate G3):** catalog has no dead-end quests; perks + seasons live; full regression green.

---

### Phase 4 — Mainnet & Decentralization (separate go decision)

**Goal:** make badges real credentials and reduce centralized trust before mainnet.

| Task | Issues | Notes |
|---|---|---|
| **4.1 Soulbound badge realm `_v3`** | Q-20 | `MintRankBadge` tier bounds, soulbound flag, **ported v1 tests**, full security review. |
| **4.2 Mint model** | Q-05, Q-08 | Hot-key relayer **or** signed-voucher user-claim model; design + security review; no operator-custody risk. |
| **4.3 On-chain XP settlement (or attestation)** | Q-05 | Evaluate periodic on-chain attestation/anchoring of XP/candidature so the ledger is verifiable, not operator-trusted. |
| **4.4 Mainnet readiness** | — | Pre-deploy live-gated tests (§6), realm test suites, runbook, rollback, governance sign-off. |

**Phase 4 exit:** independent audit; governance approval; documented rollback. *Gated separately on grant + mainnet availability + counsel (per R&D-lab posture).*

---

## 10. Cross-cutting Engineering Rules

- **Branch/PR discipline:** never commit to `main`; feature branch + PR per task; admin-merge only on green CI **and explicit user approval**. `cd` into worktree before commit. No Claude attribution anywhere.
- **Flags:** `VITE_ENABLE_BADGES` stays off until Phase 1.1–1.2 are green; never set safety-gated flags in Netlify prod env. Prod deploy = Netlify native (`netlify.toml`), never `deploy-frontend.yml`.
- **Realm immutability:** gno paths are immutable; any realm change = new `_vN` path + redeploy ceremony, never in place.
- **Pre-deploy guardrail:** run gated live tests + parity test before any realm redeploy or gno HEAD sync (§6).

## 11. Review & Triple-Check Governance (runs through every phase)

The user mandate: *frequent deep reviews and triple-checks to hold AAA standards.* This is enforced, not optional.

**Per-task (every PR):**
1. **Self-review** against the task's acceptance criteria + AAA standards (§8).
2. **Subagent code review** (`requesting-code-review` / `pr-review-toolkit`) — bugs, silent failures, type design.
3. **Test gate** — unit + backend + relevant E2E green in CI; coverage not regressed.

**Per-phase deep-review gates (G1/G2/G3, multi-perspective — mirrors this audit's panel):**
- **Engineering review** — correctness, parity, idempotency, no dead-ends.
- **Security review** — `/security-review` + independent pass for any XP/badge/auth/rate-limit change (G2 = full re-audit).
- **UX/UI review** — every state designed; light/dark; WCAG AA; copy quality; on real mobile + desktop.
- **Product/user review** — walk the 5 personas (§4) through the changed flows; confirm the friction they hit is gone.
- **On-chain review** (badge/realm changes) — dry-run, golden files, dual-signer, live-gated tests.

**Triple-check rule for money/XP/on-chain paths:** (1) code review, (2) test proof (automated), (3) live verification on test13 (real wallet / real chain read). All three required before a 🔴/🟠 issue is marked resolved. *(This audit already applied the rule retroactively — §1.4 — catching three false negatives.)*

**Cadence:** a short deep-review checkpoint at each gate, written into the session's single consolidated MD (this file's companion log), so state persists across sessions.

## 12. Rollout & Rollback

- **Badges:** mint ceremony on test13 → verify on-chain → mount grid → flip `VITE_ENABLE_BADGES=true` via Netlify native build → smoke test. **Rollback:** flip flag off (UI hides badges; on-chain badges remain, harmless).
- **Rate limiting / verifiers:** env-configurable thresholds; ship behind conservative defaults; **rollback** = raise limits / demote new quests out of `LIVE_QUEST_IDS` (no redeploy needed for catalog curation).
- **Realm changes (Phase 4):** new `_vN` path; old path untouched; frontend repoint is the switch; rollback = repoint frontend.

## 13. Sequenced Backlog (issue → phase quick map)

- **Phase 1:** Q-01, Q-08, Q-09, Q-10, Q-11, Q-12, Q-13, Q-14, Q-15, Q-18, Q-19, Q-21, Q-22, Q-23, Q-24, Q-25 (+ honesty reconciliation of Q-02 copy)
- **Phase 2:** Q-03, Q-04, Q-06, Q-07, Q-16 (+ first verifier batch of Q-02)
- **Phase 3:** remainder of Q-02, Q-17, perks, seasons
- **Phase 4:** Q-05, Q-20 (mainnet), settlement/soulbound

## 14. Locked Decisions (CTO/user sign-off, 2026-06-26)

1. **Catalog: EXPAND.** Grow the live catalog over time; not all quests live at once — "coming soon"/teasing is explicitly desired (creates anticipation). No need to reframe "85" copy down; instead progressively promote quests into `LIVE_QUEST_IDS` as verifiers ship, and present coming-soon as a deliberate teaser. *(Affects Q-02, Phases 2–3.)*
2. **Badges: SCHEDULED DRAIN.** Automate the `badge_mints` queue drain (not manual cadence). Security model for the drainer's signing key is a first-class design question (see §15 validation + Q-08). *(Phase 1.3.)*
3. **On-chain attestation: PROTOTYPE NOW.** Strategic intent — *"be on-chain as much as possible."* Pull on-chain XP/quest attestation forward from Phase 4 into an early spike: design ADR + a minimal on-chain attestation realm prototype on test13, so XP/candidature become chain-verifiable, not operator-trusted. Backend stays the fast path; chain becomes the durable, auditable record. *(New Track A + reshaped Phase 2/4; addresses Q-05.)*
4. **Sequencing: PULL Q-03 FORWARD.** Per-user rate limiting moves into Phase 1 — it's quick and it protects the badge mint and attestation writes from farming. *(Phase 1.10.)*

### Plan deltas from the decisions
- **New Track A — On-chain Attestation Spike (starts in Phase 1, parallel):**
  - A.1 **ADR** — decide the attestation model on Gno: (a) backend writes signed XP/quest attestations to a new realm `gno.land/r/samcrew/memba_quest_attestation_v1` via a dedicated relayer key, vs (b) periodic Merkle-root anchoring of the XP ledger, vs (c) user-claim vouchers. Evaluate trust, cost, and key-custody for each; pick one for the prototype. *(Gno-core + security own this.)*
  - A.2 **Prototype realm** on test13 — minimal `RecordCompletion(address, questId)` / `AttestXP(address, total)` with ACL so only the relayer/multisig can write; render shows per-user attested XP. Ported tests from day one (avoids Q-20 repeating).
  - A.3 **Backend integration** — on a verified grant, also write the attestation (best-effort, queued like badges); reconcile chain vs DB; expose attested XP in `GetUserQuests`.
  - A.4 **Frontend** — show "✓ on-chain" attestation state on quests/profile; candidature gate can read attested XP.
  - Phase 4 then **hardens** A.* to mainnet grade (soulbound, relayer security, full audit) rather than starting from scratch.
- **Phase 1 additions:** 1.3 badge drain is now a **scheduled** worker (not manual CLI cadence) with key-custody design; **1.10 per-user rate limiting** (Q-03) added.
- **Catalog (Q-02):** reframed from "reconcile copy down" to "progressively expand + intentional teasers."

### North-star / DoD update
Add to §7 acceptance: *quest XP/candidature is attested on-chain (prototype on test13) — the chain holds a verifiable record, not just the backend.*

## 15. Last-Round Validation (cross-perspective expert review)

Before any code, the plan goes through one **adversarial validation round** by the same expert panel that produced the audit — explicitly to pressure-test the locked decisions (especially attestation-now and scheduled-drain key custody). Validation criteria: technical feasibility on Gno, security of the new on-chain write paths, sequencing/dependency soundness, and AAA-deliverability. Outcome recorded in §16.

## 16. Merge-Autonomy Contract

Implementation runs on a **dedicated branch**. Autonomous admin-merge to `main` is permitted **only when ALL three hold** (else: stop and report):
1. **Expert-reviewed & validated** — per-task subagent code review **and** the relevant per-phase deep-review gate (G1/G2/G3, §11) pass; security review for any XP/badge/auth/rate-limit/attestation change.
2. **CI green** — all gates (lint, type, unit, backend `-race`, e2e, build/safety-flags, parity) green on the PR.
3. **Rebased & up to date** — branch rebased on latest `main`, no conflicts, realm-versions/flags consistent.
Branch/PR discipline and "no Claude attribution" (per global rules) always apply. Phase 4 (mainnet) remains a **separate** explicit go.

---

## 17. Validation Outcome (cross-perspective panel, 2026-06-26) — **GREEN-WITH-CONDITIONS → CLEARED TO START**

Two independent expert validations (Gno-core feasibility + blockchain security pre-mortem) reviewed the locked decisions. Both returned **GREEN-WITH-CONDITIONS**. The panel surfaced one genuine conflict and one feasibility question, both now resolved:

### 17.1 Resolved: the attestation model (the key decision)
The two experts disagreed — Gno-core favored a **relayer hot-key (Model A)**; security argued against any hot key and favored an **offline-signed voucher (Model B)** but doubted Gno could verify signatures in-realm. **Source check settles it:** `crypto/ed25519.Verify(pub,msg,sig) bool` **is** whitelisted for realms (`gno/gnovm/stdlibs/generated.go:1266`, gas-priced in `native_gas.go:88`), and `crypto/merkle.VerifySimpleProof` is too.

**CTO decision — Attestation = Model B (offline-signed voucher):**
- Backend holds an **offline** ed25519 key that signs vouchers `(address, questId, xp, nonce)` — it is *never* a hot key able to broadcast arbitrary on-chain writes.
- Realm `memba_quest_attestation_v1` verifies the voucher via `crypto/ed25519.Verify` + **nonce dedup** (replay protection), then records the completion/XP. ACL gates `SetSigner` to the multisig owner.
- The **user broadcasts** their own attestation tx (decentralized; backend custody risk minimized; satisfies "on-chain as much as possible").
- `crypto/merkle` batch-root anchoring is the **Phase-4** cost-optimization path (amortizes gas at mainnet scale).
- This eliminates the hot-key "mint/attest anything" blast radius that both the badge-drain and a relayer attestation would carry.

### 17.2 Conditions folded into the plan (binding on G1 / the relevant phases)
**Badge scheduled drain (Q-08, Phase 1.3) — required before it ships on test13:**
- On-chain **capped authority**: drainer may mint only from a queued batch (batch-hash verification) — not freeform; **allowlist** to `LIVE_QUEST_IDS`; on-chain **batch-size cap** (≤100/call); **time-lock** (24h rolling, re-auth via multisig).
- Drainer key in a **secrets manager** (Fly secrets / KMS), never plaintext in repo or app env; documented **rotation + emergency revocation** in `docs/BADGE_MINT_RUNBOOK.md`.
- **Mainnet:** multisig-approval loop in front of the drainer (Phase 4) — drainer is relayer, not authority.

**Attestation (Q-05, Track A) — required:** ADR `docs/ADR_QUEST_ATTESTATION_2026-06-26.md` confirms Model B + offline-key handling; realm ships with **ported tests from day one** (kills Q-20 repeating); nonce-dedup TTL documented; frontend goes live only after a test13 on-chain read is verified; candidature gate may read attested XP **or** fall back to backend XP (degrade, not block).

**Rate limiting (Q-03, Phase 1.10) — required + honest scope:** per-address token bucket on CompleteQuest/SyncQuests/SubmitQuestClaim (env-configurable; defaults 10/10/5 per min); `rate_limit_exceeded{endpoint}` metric. **Documented limit:** this stops per-wallet abuse, **not** multi-wallet sybil — heavier sybil heuristics remain Phase 2 and are a **mainnet prerequisite** before badges carry value.

**Sequencing guardrail (added to G1 & §7):** Phase-1 badge mint + attestation are **test13-only**. No mainnet badge mint / attestation without Phase-2 sybil heuristics + security re-audit sign-off. A CI guard fails any mainnet badge-mint flag while Phase-2 observability is absent.

### 17.3 Merge-Autonomy refinement (adds §16 Condition 4)
Both experts require a human/security gate for the new on-chain-write & key-custody paths. **§16 Condition 4 (binding):** any PR touching badge-mint, `quest_attestation`, signing keys, or realm ACL requires (a) `/security-review` independent of `/code-review`, **and (b) explicit user approval — these PRs are NOT eligible for autonomous merge** even when CI is green and the branch is rebased. Pure frontend/polish/rate-limit PRs remain eligible for autonomous merge under §16 conditions 1–3. *(This honors the standing "never merge without explicit approval" rule precisely where the risk lives, while keeping low-risk polish moving.)*

### 17.4 Verdict
**CLEARED TO START** on a dedicated branch. Execution order for Phase 1: (1) attestation **ADR** (design, no key) → (2) safe code: Q-09 threshold consolidation + Q-10/11 sync/loading + Q-12/21/23 theme/a11y + Q-13/14/15 copy → (3) attestation realm + voucher (security-reviewed, **user-approved** merge) → (4) badge drain hardening + ceremony (**user-approved**) → (5) Q-03 rate-limit → G1 deep-review gate.

---

## 18. Delivery Status / Close-out (2026-06-27)

What actually shipped from this plan, with the audit's "remaining gaps" reconciled against the code.

### ✅ Delivered & merged
- **Q-05 — on-chain XP attestation: DELIVERED + LIVE-VERIFIED end-to-end on test13.** Realm `gno.land/r/samcrew/memba_quest_attestation_v1` deployed + `SetSigner`'d (2-of-2 multisig); offline ed25519 **voucher** model (Model B), backend signer (`MEMBA_ATTESTATION_SEED`, dormant when unset), QuestHub attestation panel. A real completion recorded **15 XP on-chain**, signer-verified. PRs: #582 (audit/plan/ADR), deployer#38 (realm), deployer#40 (`SetSigner` helper), #605 (signer), #610 (backend issuance + `GetAttestationVouchers`), #613 (frontend), #619 (also issue on `SyncQuests` → every completion attests). Signer key **rotated** after a seed exposure during activation; old key inert.
- **Q-03 — per-address rate limiting:** #596 (security-reviewed).
- **Q-16 — rate-limit observability (the farming signal):** #601.
- **Q-09–Q-25 polish (the genuinely-missing subset):** #583, #586 — threshold single-source, accurate sync indicator + XP-confirming state, color tokenization, clear-filters, semantic claims list, localized dates, deploy hint.

### 🔁 Audit overstatements (verified already-shipped — no work needed)
Q-07 (3 CI parity tests already cover XP+verification+self-report; backend has no `category` concept), Q-17 (`trackNetworkVisit`/`verifySocial` both wired), Q-18-clutter (coming-soon already a clean `<details>`), **Q-21** (global `:focus-visible` exists), **Q-23-text** (difficulty text already rendered), **Q-25** (SelfReportForm already labeled), **Leaderboard** (routed at App.tsx), **self-report UI** (built + wired), **AchievementGrid** (mounted, gated behind `VITE_ENABLE_BADGES`).

### ⏳ Open (gated on the user / external state — not code-blocked)
- **Q-01 badges** — code-complete (frontend mounted, mint CLI, runbook). Needs the operational mint ceremony: IPFS pin → `badge-mint` drain → multisig sign → flip `VITE_ENABLE_BADGES`. Turnkey.
- **Q-02 verifier expansion** — blocked on **zero live test13 activity** (0 proposals / 0 threads), so render-parse verifiers can't be written + live-validated. Unblock = seed real activity (and a username for deploy quests) → then implement+validate.
- **Phase 4 (mainnet)** — soulbound badges, sybil heuristics, on-chain settlement hardening — a separate go, per §17.2 guardrail.

### Known follow-ups (logged)
- Attestation immediacy: most off-chain quest *triggers* call `completeQuest(id)` without the auth token, so they attest only via the next `SyncQuests` (covered by #619, but with a small latency). Optional nicety: pass the token in those triggers for instant vouchers.

---

*Delivered: Q-05 attestation live on test13, plus Q-03/Q-16 hardening and the genuine polish. Q-01/Q-02 are user/external-gated, not code-blocked. End of plan.*
