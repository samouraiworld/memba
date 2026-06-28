# GnoBuilders — test13 Audit & Implementation Plan (CTO-optimized)

> **Date:** 2026-06-18 · **Target:** make the GnoBuilders quest/badge feature *fully functional* on Gno **test13** (https://memba.samourai.app/test13/quests)
> **Method:** 4 parallel deep audits (on-chain/security · backend/verification-correctness · frontend integration · UX/UI & product) + live-page inspection + on-chain probes of `gnobuilders_badges_v2` on test13 (official + onbloc nodes) + a CTO optimization pass (§E).
> **Status:** AUDIT COMPLETE · plan drafted · CTO-optimized. **Awaiting your go/no-go + two scope decisions (§B).**

---

## TL;DR

GnoBuilders **looks** launch-ready (clean catalog, real responsive mobile, a live leaderboard with 7 real players) but is functionally **an ~18%-complete roadmap shipped as a product**:

- **The live leaderboard is already forgeable.** Backend `CompleteQuest` does **no server-side verification** — any authenticated user can `curl` it to fabricate any completion (incl. 100-XP quests) and top the leaderboard. This is the single highest-leverage *fix* and it leads the plan.
- **Badges never mint.** `gnobuilders_badges_v2` is deployed & valid on test13, owned by the `samcrew-core-test1` multisig — but **`TotalSupply() = 0`**, verified live on two nodes. The backend queues mints into `badge_mints` (`pending`) and **nothing drains the queue**; the backend has **no transaction-signing capability** (read-only ABCI proxy, no key, no `gnoclient`, no broadcast — the existing "Sign/CompleteTransaction" RPCs are *multisig coordination*, not server broadcast). The frontend mint builders are **never called**, and the only badge-display component (`AchievementGrid`) is **mounted nowhere**. QuestHub still tells users "*N badges ready to mint*."
- **Only ~15–16 of 85 quests are completable.** ~28 dead-end ("provide your realm path / submit proof" with no input UI); ~12 self-report quests have **no submission UI** (`SubmitQuestClaim`/`ReviewQuestClaim`/`ListPendingClaims` exist server-side, **zero frontend callers**). The entire **Developer track is non-functional** for verification.
- **Feedback is broken.** The global "Quest Complete" toast only fires for the Konami easter-egg; QuestDetail celebrates then contradicts itself (stale state); displayed XP/rank reads forgeable **localStorage**, not the backend.

**The win is sequencing + scope, not gold-plating.** Lead with the ~80-line server-side verification fix; ship the catalog-honesty pass alongside it; mint the badge backlog with the **multisig you already trust** (manual batch, no new infra); and defer the production signer / soulbound `_v3` realm / voucher model to the **mainnet** plan where they pay for themselves. **Credible public state (honest + un-gameable) lands in ~4 days; full badge feature in ~1.5–2 weeks, no new key custody, zero added multisig ceremonies.**

---

## Part A — Current-State Audit

### A.1 Architecture (as built)

```
Frontend (localStorage-first)        Backend (Go / ConnectRPC / SQLite)     On-chain (test13)
─────────────────────────────       ───────────────────────────────────    ─────────────────────────────
gnobuilders.ts  — 85 quests, 8 ranks  quest_rpc.go                          gno.land/r/samcrew/
quests.ts       — localStorage + ┐    • CompleteQuest (NO verify)            gnobuilders_badges_v2
                  fire-and-forget │    • SyncQuests / GetUserQuests          • GRC721, admin-only mint
questVerifier.ts— on/off-chain,  │    • GetUserRank / GetLeaderboard         • quest badges (transferable)
                  social, self    │    • SubmitQuestClaim / Review… (no UI)  • rank badges (soulbound)
badges.ts       — ABCI read +    │    • queueBadgeMint → badge_mints         • owner = samcrew multisig
                  mint builders   │      (PENDING — never drained)           • TotalSupply() = 0  ← verified
                  (NEVER called) ─┘    • NO tx signer / key / broadcast       • IsPaused() = false
QuestHub/QuestDetail/Leaderboard      migration 010: user_ranks, badge_mints,
AchievementGrid (MOUNTED NOWHERE)       login_streaks (dead), quest_claims
```

**Three layers, three break points:** (1) the on-chain badge layer is disconnected end-to-end; (2) the backend is the *real* XP authority but verifies nothing; (3) the frontend shows localStorage, not backend state. The leaderboard is the only surface genuinely wired to the backend — it works (7 real players, top 85 XP) and is therefore the live forgeable surface.

### A.2 Findings by severity

**🔴 P0 — blocks "functional," or breaks user trust**

| ID | Finding | Evidence |
|----|---------|----------|
| P0-1 | **Backend `CompleteQuest` does no server-side verification** → any authenticated user can fabricate any completion via direct RPC; leaderboard fully gameable **today**. | `quest_rpc.go:181-218`; `authenticate()` is quest-agnostic |
| P0-2 | **Badge mint pipeline dead end.** `queueBadgeMint` writes `pending` rows; nothing drains them; backend has no signer. `TotalSupply()=0` live. | `quest_rpc.go:566-600`; live probe both nodes; no `MintQuestBadge`/`gnoclient`/`BroadcastTx` in `backend/` |
| P0-3 | **"N badges ready to mint" banner does nothing** — no mint button/link anywhere; mint builders never called. | `QuestHub.tsx:130-134`; `badges.ts:174,196` (0 callers) |
| P0-4 | **`AchievementGrid` (only badge-display UI) is mounted nowhere** — badges would be invisible even if minted. | grep: 0 mount sites for `<AchievementGrid` |
| P0-5 | **~28 on-chain quests dead-end** ("provide path / submit proof") — input only renders for `deploy-`prefixed on_chain quests; all others get a "Check Completion" button that can never succeed. | `questVerifier.ts:155-220`; `QuestDetail.tsx:193,215` |
| P0-6 | **~12 self-report quests un-completable** — `SubmitQuestClaim` has no frontend caller; no proof form; no admin review UI. | grep: 0 callers of `submitQuestClaim`/`reviewQuestClaim`/`listPendingClaims` |

**🟠 P1 — credibility / correctness**

| ID | Finding | Evidence |
|----|---------|----------|
| P1-1 | **Displayed XP/rank reads localStorage, not backend** → catalog ↔ leaderboard divergence; candidature eligibility forgeable client-side. | `QuestHub.tsx:43,55`; `quests.ts:230` `canApplyForMembership()` |
| P1-2 | **`syncQuestsToBackend` overwrites localStorage with server XP, once per connect-session** → can silently shrink XP; 5 token-less `completeQuest` calls never persist server-side. | `quests.ts:280-308`; `Layout.tsx:131`; TopBar/CommandPalette/FeedbackPage/TransactionView/ValidatorDetail |
| P1-3 | **QuestDetail celebrates then contradicts** — `useMemo([])` state never recomputes after verify; status stays "Available" under the celebration. | `QuestDetail.tsx:40-41,77-99` |
| P1-4 | **Global "Quest Complete" toast only fires for Konami** — every other completion is silent; `rankUp` never set. | `Layout.tsx:156-160,385` |
| P1-5 | **`verifyDeployment` credits ANY existing realm** ("benefit of the doubt" branch) → 19 deploy quests verify nothing real and are interchangeable; XP-farmable. | `questVerifier.ts:388-419` (esp. 415) |
| P1-6 | **2 deploy-prefixed self-report quests render an empty verification section** (`deploy-test-pkg`, `deploy-full-dapp`). | `QuestDetail.tsx:119,193,215` |
| P1-7 | **Leaderboard: O(n²) hand-rolled sort + cache recompute only when fully empty** (staleness/divergence risk). *(The MaxOpenConns(1) self-deadlock was **already fixed** in `computeLeaderboard` — cursor is closed before write.)* | `quest_rpc.go:392,468-478`; fix at `:449-455` |
| P1-8 | **`SyncQuests` is an unbounded forgery amplifier** (200/batch, client-supplied `completed_at`, no verify). | `quest_rpc.go:237-277` |
| P1-9 | **v2 realm ships with ZERO tests** — v1 unit + audit/regression tests not ported (matters only if we redeploy a `_v3`). | `gnobuilders_badges_v2/` has only `.gno` + `gnomod.toml` |
| P1-10 | **CandidatureUnlock "pending" branch unreachable** (prop never passed); Sidebar eligibility badge non-reactive. | `CandidatureUnlock.tsx:25,35`; `Sidebar.tsx:228` |

**🟡 P2 — polish / hardening**

- `CompleteQuest` doesn't reject `self_report` quests → they bypass the review queue (`quest_rpc.go:188`).
- `MintRankBadge` lacks tier bounds (negative/huge tier accepted) — the one real realm bug (`gnobuilders_badges.gno:281`); rank badges already soulbound.
- Quest badges **transferable** → not a sound credential (mainnet concern; on a zero-value testnet the cost is ~nil; `UpdateTokenURI` already allows metadata fixes without redeploy).
- Schema for a drainer: `badge_mints` has `idx_badge_mints_address` but lacks `idx_badge_mints_status`, `retry_count`, `last_error`, `tx_hash`; `login_streaks` table is **dead** (never written by Go).
- `GNO_RPC_URL` backend default = **test12** (`render_proxy.go:26`) — but `main.go` already runs a test13 NFT poller on `NFT_RPC_URL` (`main.go:114-161`): **proof the server-side test13 read path works, and the pattern to reuse for server-side quest verification.**
- A11y: 5 form fields lack `id`/`name` (live console warning); category tabs lack roving-tabindex/`aria-controls`.
- Catalog says "**85 quests**" / shows "**75**" / ~15 work; lock copy leaks raw quest IDs; rank perks defined but never surfaced; 8/10 hidden quests unwired.
- **Confirmed good:** verifier/config point at the **valid v2 realm paths** (`tokenfactory_v2`, `channels_v2`, `candidature_v2`, `memba_dao`, `gnobuilders_badges_v2`) — **no stale-path bugs**; mobile/responsive, dark-theme tokens, and the leaderboard wiring are solid.

### A.3 The 85-quest verifiability matrix (summary)

| Status | Count | Meaning |
|--------|------:|---------|
| **AUTO** (completable today) | ~15–16 | wallet/off-chain auto-track or real on-chain verify vs live v2 realms |
| **LOCALSTORAGE** (completes but forgeable) | ~6 | `visit-5-pages`, `earn-500/1000-xp`, `weekly-login`, `ai-report-reader`, `complete-all-everyone` |
| **DEAD-END** (verifier wants input the UI can't supply) | ~28 | votes/proposals/NFT/token-send/membership + unwired hidden quests |
| **SELF-REPORT-BROKEN** (no submission UI) | ~12 | `fix-upstream-bug` (100xp), `audit-realm`, `build-mcp-tool`, `deploy-full-dapp`, … |
| **DEPENDS-ON-BROKEN-REALM** | ~0 | none — paths point at valid v2 realms ✅ |

**Launch-ready playable set (~16, all AUTO, minor fixes):**
`connect-wallet`, `setup-profile`, `register-username`, `first-transaction`, `faucet-claim`, `use-cmdk`, `switch-network`, `view-validator`, `browse-proposals`, `share-link`, `submit-feedback`, `visit-5-pages`, `join-dao`, `create-token`, `submit-candidature`, `create-team`, `easter-egg-konami` (+ `read-docs` with a 1-line fix).
**Fast on-chain wins to add next** (live v2 realms are readable): `vote-proposal`, `create-proposal`, `post-board`, `mint-nft`, `list-nft`, `earn-500-xp`.

---

## Part B — Two scope decisions needed before build (your call)

### Decision 1 — Catalog scope at launch

| Option | What ships on test13 | Trade-off |
|--------|----------------------|-----------|
| **B1 — Curate (RECOMMENDED)** | Show only the ~16–22 quests that work (or work after a small wire-up). Everything else moves behind a labeled **"Season 2 — Coming soon"** section (data kept, not deleted). | Honest & credible immediately. Smaller headline number. |
| B2 — Fix-all-then-launch | Wire verification + submission UI for all ~85 first. | 3–4× the work; delays honesty for weeks; some quests (social/upstream-PR) can't be cheaply verified. |
| B3 — Ship as-is + "beta" banner | Keep 85 visible. | Continues the trust problem. Not recommended. |

**Recommendation: B1.**

### Decision 2 — Badge minting model (CTO-revised)

| Option | Mechanism | Effort | Verdict |
|--------|-----------|-------:|---------|
| **D1 — Defer banner honestly (now)** | Remove "ready to mint" + mint copy; show "Badges — coming soon." | ~2h | **Do now**, regardless of the rest. |
| **D2c — Manual multisig batch-mint (RECOMMENDED for test13)** | Operator CLI: export `pending` → re-verify → build `MsgCall` batch → multisig signs (Adena) → broadcast → mark `minted`+`tx_hash`. Mint into **v2 as-is** (transferable quest badges are fine on a zero-value testnet). | ~1–2d, **0 new infra, 0 new ceremonies** | **Best test13 call** — uses the trust path you already have; throwaway script. |
| D2a — Backend hot-key relayer | Backend gains a funded hot-key admin + a Go tm2 signer that mints automatically. | ~4–6d | **Mainnet** only — production custody infra for a zero-value testnet collectible is the wrong investment now. |
| D2b — User-claim voucher (`_v3.ClaimBadge`) | New soulbound `_v3` realm; backend signs vouchers; user pays gas. | ~6–8d | **Mainnet** design — right when badges have value. |

**Recommendation: D1 now + D2c for test13.** Mint into the existing **v2** realm (no `_v3` redeploy — immutability/soulbound are *mainnet* arguments; on testnet a transferable badge costs ~nothing and `UpdateTokenURI` fixes metadata in place). The signer/voucher/soulbound-`v3` stack moves to a separate **mainnet** plan.

> The plan below assumes **B1 + (D1 now, D2c for test13)**. Say the word for any other combination and I'll re-cut Phases 2–3.

---

## Part C — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. **TDD throughout** — failing test first; Memba runs `vitest` (frontend) and `go test` (backend), `gno test` (realms).

**Goal:** Turn GnoBuilders from an 18%-complete facade into an honest, server-truthful, fully-functional quest game on test13 with a working badge reward.

**Architecture:** Make the backend the single source of truth for XP and re-verify completions server-side; curate the catalog to a playable set (config-driven); mint the badge backlog via the existing multisig; progressively widen the catalog as verifiers/UIs land.

**Tech Stack:** Vite + React + TS (`vitest`), Go + ConnectRPC + SQLite (`go test`), Gno realms (`gno test`), `samcrew-deployer` + Adena multisig for the one-shot mint.

### Global Constraints (apply to every task)

- **Git:** never commit to `main`/`master`; branch (`feat/…`,`fix/…`) + PR. **No Claude attribution** (no `Co-Authored-By`, no "Generated with" footer). Commit = concise *why*, no trailers. **Ask before pushing; never merge without explicit approval.**
- **Memba env:** `vite.config.ts` sets `envDir: '..'` → `.env*` at **repo root**, not `frontend/`.
- **test13 facts:** chain-id `test-13`; RPC `https://rpc.test13.testnets.gno.land:443` (fallbacks aeddi, onbloc); badge realm `gno.land/r/samcrew/gnobuilders_badges_v2`; owner/admin = multisig `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`. For server-side reads, reuse the **`NFT_RPC_URL` test13 pattern** in `main.go` (do **not** rely on `GNO_RPC_URL`, which defaults to test12).
- **Registry sync:** `frontend/src/lib/gnobuilders.ts` ↔ `backend/internal/service/quest_rpc.go` `validQuests` must agree (enforced by Task 0.0).
- **Test before continuing.** `npm run -w frontend test`; `cd backend && go test ./...`; `gno test`.

---

### Phase 0 — Honest + un-gameable baseline — ~3–4 days · NO multisig, NO new infra

**Why first:** delivers a credible public state — honest catalog **and** a leaderboard nobody can forge — with zero on-chain/multisig dependency. (Honesty without the verify fix is theater: the live leaderboard stays forgeable.) Server-verify and the frontend honesty tasks have no interdependency and can run in parallel.

**Exit criteria:** fabricated `CompleteQuest`/`SyncQuests` calls are rejected server-side; every *visible* quest is completable or marked "coming soon"; no dead "Check Completion" buttons; no "ready to mint" with 0 supply; celebration only on confirmed completion + immediate refresh; registries can't drift.

#### Task 0.0 — Registry-drift CI test (do this first; protects every later phase)
**Files:** Test `backend/internal/service/quest_registry_parity_test.go`; a small exported JSON or generated list from `gnobuilders.ts` (or parse the TS constant in the test).
- [ ] Write a Go test that loads the frontend quest ids+XP and asserts they exactly match `validQuests` (same ids, same XP, no extras either side). Fails on drift.
- [ ] Wire into CI; commit.

#### Task 0.1 — Server-side re-verification in `CompleteQuest` + `SyncQuests` (P0-1, P1-8)
**Files:** Modify `backend/internal/service/quest_rpc.go`; new `backend/internal/service/quest_verify.go` (reuse the ABCI read pattern; use the test13 RPC like the NFT poller); Test `quest_rpc_test.go`.
- [ ] Failing test: `CompleteQuest{questId:"first-transaction"}` for an address with `sequence==0` is **rejected**; `sequence>0` accepted. `self_report` quest via `CompleteQuest` is **rejected** (must use `SubmitQuestClaim`).
- [ ] Implement `verifyServerSide(ctx, addr, questID)`: `on_chain` quests re-query the same sources the frontend uses (account info, `r/sys/users`, DAO membership, `tokenfactory_v2`, channels_v2, candidature_v2); `off_chain`/localStorage accepted but flagged low-trust; `self_report` rejected here.
- [ ] Gate the `INSERT` on verification in both `CompleteQuest` and `SyncQuests`; clamp `completed_at` to server time.
- [ ] `go test ./...`; commit.

#### Task 0.2 — Quest catalog curation (config-driven `status`) (B1)
**Files:** Modify `frontend/src/lib/gnobuilders.ts` (`status?: "live" | "coming_soon"` on `GnoQuest` + tag each; `getLiveQuests()`/`getComingSoonQuests()`); Modify `frontend/src/pages/QuestHub.tsx`; Test `gnobuilders.test.ts`.
- [ ] Failing test: `getLiveQuests()` returns only `live` quests, count ≥16, every live id in an allowlist constant.
- [ ] Tag the playable set `live`, rest `coming_soon`; QuestHub grid uses live; collapsed `<details>` "Season 2 — Coming soon" section for the rest (dimmed, non-clickable); hero count uses live.
- [ ] `npm run -w frontend test`; commit.

#### Task 0.3 — Remove the dead badge promise (D1)
**Files:** Modify `frontend/src/pages/QuestHub.tsx:92-134`.
- [ ] Replace the "N badges ready to mint" banner with a static "🏅 Badges — coming soon" chip; remove the `fetchUserBadges`/`getMintableBadges` effect until Phase 2.
- [ ] Test renders the chip, never a mint count; commit.

#### Task 0.4 — QuestDetail refresh + celebration honesty (P1-3, P1-6)
**Files:** Modify `frontend/src/pages/QuestDetail.tsx`; new `QuestDetail.test.tsx`.
- [ ] `state` → `useState` seeded from `loadQuestProgress()` + a `quest-completed` listener; `setShowCelebration(true)` only when `result.status==="verified"`; `self_report` quests show a "coming soon" note (Phase 0) instead of an empty section/dead button.
- [ ] Test: verified completion flips status to "Completed" and hides the verify section; self_report never shows a dead button. Commit.

#### Task 0.5 — Real completion feedback (P1-4)
**Files:** Modify `frontend/src/components/layout/Layout.tsx`; `frontend/src/lib/quests.ts` (event detail includes `xp`).
- [ ] On `quest-completed`, look up the quest and show QuestToast ("Quest Complete! +X XP"); drop the Konami-only coupling.
- [ ] Test: dispatching `quest-completed` surfaces the right toast. Commit.

#### Task 0.6 — Display backend XP/rank for connected users (P1-1; P1-10 refresh)
**Files:** Modify `frontend/src/pages/QuestHub.tsx`, `frontend/src/components/ui/QuestProgress.tsx`; add `fetchUserRank` in `frontend/src/lib/quests.ts`.
- [ ] When a token is present, prefer backend `GetUserQuests`/`GetUserRank` for display; localStorage = offline cache/optimistic overlay; subtle "syncing…" on mismatch. Add a `quest-completed` listener to QuestProgress own-profile mode.
- [ ] Test: connected user with backend XP=85 shows 85 even if localStorage differs. Commit.

#### Task 0.7 — Copy/UX/a11y polish (P2)
**Files:** `QuestCard.tsx` (lock copy → prerequisite **title**), `QuestHub.tsx` ("16 live · N coming soon"; `id`/`name` on search/selects).
- [ ] Implement + test + commit.

**Ships as one PR (or small PRs). After merge → honest, functional, un-gameable; no badges yet.**

---

### Phase 1 — Backend hardening — ~1 day · backend-only

**Exit criteria:** leaderboard deterministic & non-degenerate; sync can't regress legit XP.

- **Task 1.1 — Leaderboard sort + staleness (P1-7).** Replace the O(n²) selection sort (`quest_rpc.go:468-478`) with `sort.Slice`; add a deterministic tiebreak (`total_xp DESC, quests_completed DESC, address ASC`); recompute `user_ranks` on staleness, not only when the cache is fully empty (`:392`). *(Deadlock already fixed — no action.)* Test + commit.
- **Task 1.2 — Sync merge-direction fix (P1-2).** `syncQuestsToBackend` must never delete a legitimately-earned local completion that failed to persist; surface sync failures instead of swallowing them. Test + commit.
- **Task 1.3 — Drainer schema (P2).** New `011_badge_mints_drainer.sql`: add `retry_count`, `last_error`, `tx_hash`, `CREATE INDEX idx_badge_mints_status`; drop/﻿document dead `login_streaks`. Migration test; commit.

---

### Phase 2 — Mint the badge backlog (D2c) — ~1–2 days · 1 multisig signing of a prepared batch, 0 new infra

**Why now possible:** Phase 0 made completions trustworthy, so draining the queue no longer immortalizes a forged completion on-chain. Mint into **v2 as-is**.

- **Task 2.1 — Operator batch-mint CLI** (in `samcrew-deployer` or `backend/scripts`). Read `badge_mints WHERE mint_status='pending'` → **re-verify each completion** (reuse Task 0.1 verifier) → build `MintQuestBadge`/`MintRankBadge` `MsgCall` batch → present for **multisig (Adena) signing** → broadcast → mark `minted`+`tx_hash`; idempotent (realm dedups; check on-chain ownership before broadcast); log failures to `last_error`. Tests for the export/verify/mark logic; commit.
- **Task 2.2 — Badge artwork → IPFS → tokenURI.** Badge SVGs (per category + 7 ranks); pin via existing `ipfs_proxy.go`; populate `badge_mints.metadata_cid`; pass as `tokenUri` at mint (v2 `UpdateTokenURI` fixes any later). Commit.
- **Task 2.3 — Surface badges (P0-3, P0-4).** Mount `AchievementGrid` on `ProfilePage` (+ optionally QuestHub) behind `VITE_ENABLE_BADGES`; truthful states from on-chain `fetchUserBadges` + `badge_mints` status (earned / "minting…" / none). Enable the flag after the first batch lands. Test + commit.

---

### Phase 3 — Widen the playable set (progressive, highest-ROI first) — ~4–6 days incremental

Each item flips `coming_soon` → `live` independently.

- **Task 3.1 (FIRST — best ROI) — Self-report submission UI + admin review page.** The entire backend (`SubmitQuestClaim`/`ReviewQuestClaim`/`ListPendingClaims`, `selfReportQuests`, admin gate) **already exists and is tested** — pure frontend wiring. Add a proof form on QuestDetail (`self_report`) + an admin page gated by the existing allowlist. Unlocks ~12 high-XP Developer quests for the least effort in the plan.
- **Task 3.2 — Sound `verifyDeployment` (P1-5).** Require the realm under the user's registered namespace (`r/<username>/…` resolving to the address); drop the "benefit of the doubt" branch (`questVerifier.ts:415`). Then flip deploy quests `live`.
- **Task 3.3 — On-chain verifiers for fast wins** (votes, proposals, NFT mint/list, board posts) reading the live v2 realms; add the missing input UI for non-deploy on-chain quests (or auto-verify). Flip `live` as each lands. Mirror each in the Task 0.1 server-side verifier.
- **Task 3.4 — Social proof** (Twitter/Discord) only if an OAuth/attestation path exists; else leave `coming_soon`.
- **Task 3.5 — Wire or cut the 8 dead hidden quests.**

---

## Part D — Risks, rollout, success criteria

**Risks & mitigations**
- *Who signs the batch (Phase 2):* needs the multisig signers available for one Adena ceremony; coordinate before scheduling Phase 2. (No hot key, so no custody risk.)
- *Registry drift:* Task 0.0 CI test (added up front).
- *Server-verify load:* on_chain re-verification adds ABCI reads per completion — cache/short-TTL where hot; reuse the NFT poller's RPC client/pattern.
- *XP regression on sync (P1-2):* fixed in Task 1.2.
- *Indexer reconciliation:* after minting, update `badge_mints.nft_token_id`/`tx_hash`; optionally have the NFT indexer tail `gnobuilders_badges_v2` so `fetchUserBadges` reflects reality.
- *Rollback:* Phases 0–1 are normal PRs (revertable). Phase 2 badge UI behind `VITE_ENABLE_BADGES`. Minting is additive (badges can be `BurnBadge`'d by admin if a bad batch ships).
- *Mainnet debt (tracked separately):* soulbound `_v3` (+ `MintRankBadge` tier bounds + ported tests), backend hot-key relayer (D2a) or voucher `ClaimBadge` (D2b). Do **not** build on test13.

**Rollout:** Phase 0 → merge (honest + un-gameable, ~4d). Phase 1 → merge (~1d). Phase 2 behind `VITE_ENABLE_BADGES`; mint backlog via multisig; enable flag. Phase 3 flips quests `live` one at a time.

**Success criteria ("fully functional on test13") — enforceable**
1. **0 dead-end quests** in the visible catalog — every visible quest completes or is clearly "coming soon."
2. **State consistency** — catalog XP == profile XP == leaderboard XP for a connected wallet (all backend-sourced).
3. **Verification integrity** — fabricated `CompleteQuest`/`SyncQuests` calls are rejected server-side (covered by tests).
4. **Reward integrity (badge milestone)** — completing a `live` quest for a test wallet produces an on-chain badge visible on its profile within one mint-batch, idempotently. Before that milestone: **no badge UI references minting.**
5. **Activation KPI (post-launch, not a gate):** distinct addresses in `quest_completions` over time + median quests/address (baseline: leaderboard shows 7 players at 4–7 quests each). Wire a real event source before claiming this as DoD.

**Effort (CTO-revised):** Phase 0 ≈ **3–4d** · Phase 1 ≈ **~1d** · Phase 2 ≈ **1–2d (no new infra, no added ceremony)** · Phase 3 ≈ **4–6d incremental**. **Credible public state in ~4 days; full badge feature in ~1.5–2 weeks.**

---

## Part E — CTO review (optimizations applied)

**Verdict:** *Ship with changes.* The audit found the right problems; the original draft slightly mis-ranked the fixes and gold-plated the testnet badge path. Four changes were applied to the plan above.

**Top optimizations folded in:**
1. **Lead with server-side verification (P0-1), not the honesty pass.** The live leaderboard is *already* forgeable; making the catalog look trustworthy while the leaderboard stays gameable is honesty theater. The verify fix is ~80 lines of Go reusing existing ABCI reads, with no UI/multisig dependency — so it moved into Phase 0 as Task 0.1 (alongside the parallel frontend honesty work).
2. **Cut the production signer + `_v3` redeploy for testnet; mint the backlog with the multisig (D2c).** Building a Go tm2 signer, hot-key custody in Fly secrets, monitoring, *and* an immutable `_v3` realm — to mint collectible badges on a zero-value testnet with 7 players — is the wrong investment. Manual multisig batch-mint uses infra you already trust, ships in ~1–2d, adds **no** new attack surface, and front-runs nothing. Phase 2 dropped from 5–8d + ceremony to 1–2d. The signer (D2a) / voucher (D2b) / soulbound-`_v3` stack moved to a separate **mainnet** plan.
3. **Mint into v2 as-is (transferable quest badges).** Soulbound-correctness and immutability are *mainnet* arguments; on testnet a transferable badge costs ~nothing and `UpdateTokenURI` fixes metadata in place. Removed the `_v3` ceremony from the critical path. (The only real realm bug — `MintRankBadge` tier bounds — is logged for the mainnet `_v3`.)
4. **Added Task 0.0 registry-drift CI test up front** (the plan itself adds a `status` field and a verify switch — the two registries *will* drift during this work) and **tightened two gameable "done" criteria** (badge DoD no longer satisfiable by hiding badges; activation demoted to a post-launch KPI with a named source).

**Factual corrections to the audit (applied):**
- **P1-7 deadlock was already fixed** in committed code (`computeLeaderboard` closes the cursor before writing `user_ranks`, `:449-455`). Only the **O(n²) sort** and **cache-only-when-empty staleness** remain → Phase 1 shrank from 3–4d to ~1d.
- **Migration 010 already has `idx_badge_mints_address`** (not `_status`/`retry_count`/`tx_hash`) — Task 1.3 is smaller than first implied.
- **`main.go` already runs a test13 read path** (NFT poller on `NFT_RPC_URL`) — reuse it for server-side verification rather than the test12-defaulted `GNO_RPC_URL`.

**Net effect:** time-to-credible-public-state dropped from "Phase 0 then Phase 1" to **~4 days**; total to fully-functional from ~2–3 weeks + a multisig ceremony to **~1.5–2 weeks with no new key custody and no added ceremonies.**
