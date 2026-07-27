# Memba — Priority Audit (2026-07-23)

Local doc — not for git/GitHub (untracked, like the other 13 planning docs).
Supersedes the "next steps" framing in `MEMBA_STATUS_OVERVIEW_2026-07-20.md` and the
Wave 5–7 status block in `MEMBA_ROADMAP_COMPOUND_2026-07.md` (both stale — see §0).

## 0. What's stale, corrected

| Doc claim | Status |
|---|---|
| `MEMBA_STATUS_OVERVIEW_2026-07-20.md`: "Next work session = the WS-E ceremony" | **SPENT.** Ceremony ran 2026-07-21, 21/22 artifacts on-chain. Whole doc is a pre-ceremony snapshot. |
| `MEMBA_ROADMAP_COMPOUND_2026-07.md` U-2: `METRICS_BEARER` unset | **Doc itself already tracked this as done 2026-07-06.** Its own "current gate status" section is frozen at 2026-07-06 (end of Wave 7) — everything since (Feed v2, NFT launch, points_v1, BARRICADE, Topaz ceremony) postdates this document. Treat it as historical, not governing. |
| `HANDOFF_memba_next_2026_07_22.md`: `QUEST_ADMIN_ADDRESSES` still unset | **STALE, re-verified false just now.** `fly secrets list -a memba-backend` (live, this session) shows `METRICS_BEARER`, `QUEST_ADMIN_ADDRESSES`, `FEED_MODERATION_BEARER` all **Deployed**. All 3 owner-blocked secrets from the task brief are closed. |
| ICO sale flag (`VITE_ENABLE_ICO_ANNOUNCEMENT`) | Not independently reconfirmed this session — a fresh, cookie-less load of memba.samourai.app (network=Topaz) showed no promo modal. Memory has a same-day (2026-07-23) screenshot confirming it live on a different network context; not chasing further since it's cosmetic, not fund-risk. **If it matters today, ask the owner to confirm which network the promo is scoped to.** |
| topaz-1 multisig `g1x7k4628…` sequence | **UNCHANGED** — re-queried both official RPC and samourai sentry just now: seq **24**, **9614294200ugnot**, matches yesterday exactly. Nothing deployed since the handoff was written. |

**⚠️ Live parallel session detected.** A different session's worktrees (`fix-topaz-monitoring-key`, `review-a`, `review-b`, under a scratchpad path that is not this session's) pushed branch `fix/topaz-monitoring-chain-key` → **PR #989** (Memba, "Remove the topaz monitoringChain override — gnomonitoring flipped back to topaz-1"), mergeable, updated today. This is the exact item my memory logged as "NOT yet fixed — owner reviewing" from a few hours ago — it has since been worked and opened as a PR by another session. **Don't redo it.** Check whether that session is still live before touching `frontend/src/lib/config.ts`-adjacent monitoring-chain files, and route PR #989 through the normal review/merge gate rather than starting parallel work on the same bug.

Repo state otherwise matches the handoff: samcrew-deployer `7ecac21` clean/0 PRs; gnodaokit `0eb8518` clean (2 open PRs, both owner-only per memory: #65, #25). **katana moved — 47 new commits, PR #11 "score-driven-vp-actions" merged by Louis, now caught up with origin.** Not this session's concern (owned by samcrew, unrelated to Memba fund-safety), noted for awareness only.

---

## 1. Ranked worklist

### 1. escrow_v3 — NF-2 solvency getters + fee-spine wiring (before it ships) — ✅ CLOSED 2026-07-23
**What:** `escrow_v3` is the **last unpublished pooled-fund realm** without `TotalLiabilities()`/`RealmAddress()` getters — `candidature_v3` and `agent_registry_v2` already shipped without them on immutable Topaz paths and can never get them now (`MAINNET_READINESS.md` §3b). Separately, `escrow_v3` doesn't use the shared fee spine at all: it hardcodes `FeeRecipient = "g1x7k4628…"` and `PlatformFeePct = 2` (`escrow.gno:47-48`, used at `:319,428,502,608`) instead of calling `memba_market_config.GetFeeBPS("escrow")`/`GetTreasury()` like every other guarded engine (`memba_appstore_v*`, `memba_nft_market_v3_*`, `memba_market_core_v2`, `memba_token_otc_v1` all reference it — escrow_v3 doesn't).
**Impact:** HIGH — escrow_v3 pools funds across `FundMilestone`→release (4 mutation sites per the task brief); a miscounted liability is worse than none, and once this ships to an enforce chain (topaz-1/mainnet) both gaps become **permanent**, same as the two realms that already lost the window.
**Effort:** M–L — getters are additive (no migration), fee-spine wiring touches 4 call sites + tests.
**Owner call needed:** No — this is pure pre-ship engineering. Owner only gates *when* escrow_v3 actually deploys to an enforce chain (it's still on the owner-gated `commerce-v2`/`p0-guards` lane per §3b), which is exactly why there's still time to do this first.
**Closed:** [samcrew-deployer#135](https://github.com/samouraiworld/samcrew-deployer/pull/135), merged `531cebaa`. TDD, two independent reviews (fund-safety lens clean; CTO/integration lens caught a real `p0-guards`-before-`commerce-v2` deploy-order hazard + a doc contradiction, both fixed before merge), CI green.

### 2. OTC decimals bug — order size misstated by 10^decimals — ✅ CLOSED 2026-07-23
**What:** `TokenTradeModal.tsx:95` — `Math.floor(parseFloat(listAmount || "0"))` with an explicit comment admitting no decimals handling ("let's assume 1:1 for simplicity"). Neither `tokenOtc.ts`, `tokenOtcApi.ts`, nor the codec does decimals math; `otc.gno` takes raw `int64` with no decimals field. Already tracked as open item T3.2 in `WAVE1_AUDIT_AND_PLAN_2026-07-16.md:168` — still unimplemented as of right now.
**Impact:** HIGH — this is a live, money-facing UI bug on `memba_token_otc_v2` (already guarded and deployable). A token with 6 or 18 decimals gets its order size wrong by orders of magnitude; on mainnet this is a direct loss vector, and on test13 today it silently misleads every OTC user.
**Effort:** M — fetch/cache each token's decimals, base-unit math end-to-end (list, fill, display), correct labels. Self-contained to the OTC lane.
**Owner call needed:** No.
**Closed:** [memba#992](https://github.com/samouraiworld/memba/pull/992), merged `32e7d346`. First pass fixed the core amount/price scaling; two independent reviews (math/precision lens + UX/integration lens) **both independently caught the same critical gap** — a failed decimals lookup silently defaulted to 6 on the fund-moving path instead of refusing to trade, exactly the bug class this PR set out to kill, re-entering through the failure door. Follow-up commit made it fail-closed (loading/error/ready state machine, retry UI, no silent default) before merge. CI green.

### 3. Review + merge PR #989 (topaz monitoring key flip) — ✅ CLOSED 2026-07-23 (merged independently by the other session before this session acted on it)
**What:** Another session already fixed the gnomonitoring `chain=topaz` vs `topaz-1` flip (the thing that broke validator monikers twice in 24h per memory) and opened it as PR #989. Confirm the other session is done, review it under the normal gate (CTO-lens diff read + tests + CI green + up to date), and merge if it clears — don't duplicate the work.
**Impact:** MED — cosmetic (validator monikers) but has flipped twice already; closing it stops the churn.
**Effort:** S — review only, code already written by someone else.
**Owner call needed:** Merge needs the standing per-PR merge authorization already granted this session (deep-reviewed + CTO-verified + tests + CI green + up to date + no conflicts).

### 4. Everything else in the audit corpus — hold
- **Marketplace fabricated-offer UI (Whole-Project AAA T0.3):** re-checked — **already fixed.** `FloorOffersList`/`mockFetchFloorOffers` no longer exist in the tree; a regression test (`noFabricatedOffers.test.ts`) guards against it reappearing. Drop from the backlog.
- **Feed v2 Waves C–F:** still open, no new fund-risk, lower leverage than #1/#2 above. Next in queue after those land.
- **Marketplace pilot audit shape:** owner explicitly said don't scale the 22-expert format to other features until the shape is approved — still waiting, not session work.
- **BARRICADE 3D:** post-mainnet by prior decision — defer.
- **Which NFT generation ships (v3_1 vs v3_2), collections:** genuinely owner-only, no code work possible until decided.

---

## 2. Recommendation

~~Start with #1 (escrow_v3 getters + fee spine)~~ — **done.** ~~#2 (OTC decimals) as the next PR~~ — **done.** #3 (PR #989) resolved itself (merged by the other session before this session could act).

**Next in natural order: #4's Feed v2 Waves C–F** — the only remaining item that's both actionable without an owner decision and not explicitly deferred/gated. Marketplace pilot shape stays owner-gated (don't scale the audit format further until approved), BARRICADE 3D stays post-mainnet, and NFT generation choice stays genuinely owner-only. Re-verify Feed v2's current state before starting — a lot of Memba work has landed since the 2026-07-13 plan was written.

## 3. Update — Wave C progress (2026-07-23, later same session)

Continued autonomously into Feed v2 Wave C (`docs/planning/MEMBA_FEED_V2_PLAN_2026-07-13.md` §5, lines ~259-286). Re-audited current state first (the plan doc is 10 days stale) — most of Wave C was untouched.

- **C.1 (feed_flags durable have-I-flagged) — ✅ CLOSED.** Backend projection (migration 025 + dispatcher capture) had already shipped; this session closed the remaining half: `viewer_has_flagged` on `GetFeedTimeline`/`GetFeedThread`, `PostCard.tsx` seeded/resynced from it instead of ephemeral local state. [memba#993](https://github.com/samouraiworld/memba/pull/993), merged `291cc69c`. Two independent reviews: privacy/correctness clean; React/UX-staleness lens caught a real bug (hardcoded `false` on the error-revert path could permanently desync from a stale-closure). The FIRST fix attempt for that finding was itself subtly wrong (still read a stale `post` closure) — caught not by a third review but by the regression test written to pin the original finding, which failed against the first fix. Second fix (a ref kept current via `useEffect`, since this repo's lint hard-errors on mutating a ref during render) made the test pass. Documented in the PR history as a two-step fix, not a single clean one — worth knowing if you're tracing "why two follow-up commits."
- **C.3 (flagged queue + audit log RPCs) — ✅ CLOSED.** `GetModerationLog` already existed; added `GetFlaggedPosts` (the actual moderation queue, WITH post bodies — unlike the body-free audit log). [memba#995](https://github.com/samouraiworld/memba/pull/995), merged `48fca834`. **Design call made unilaterally, not owner-confirmed:** bearer-gated it (`FEED_MODERATION_BEARER`, same secret/posture as `/api/feed/moderation`) since the plan doesn't specify auth for this one and it exposes flagged-content bodies — the plan explicitly calls `GetModerationLog` "public" but says nothing about `GetFlaggedPosts`. Flip-able in one line if the owner intended public.
- **Also shipped in this arc:** [memba#994](https://github.com/samouraiworld/memba/pull/994) — a genuine flaky-test hotfix in `TokenLaneV2.test.tsx` that CI caught mid-flight (unrelated pre-existing bug from an earlier merged PR, not from this session's own diff).
- **Still open in Wave C:** C.2 (quarantine-vs-tombstone + serve-override — new migration 026, new `hidden_cause` column + `feed_serving_overrides` table, extends `/api/feed/moderation`), C.4 (moderation console UI — depends on C.2 done + C.3 done), C.5 (public transparency page + `MODERATION_POLICY.md`), C.6 (SweepTombstones cron in `cmd/activitybot`), C.7 (abuse metrics + gnomonitoring alert). See the full plan doc for per-item detail — this doc doesn't duplicate it.

**Near-miss, corrected:** mid-session, a `git stash --include-untracked` (used to check a baseline against clean `main`) was never popped before branching further, which swept every untracked `docs/planning/*.md` file — including this one — out of the working tree for a stretch of the session. No data was lost (found and popped before session end; `git stash list` confirmed empty afterward), but it's a documented near-miss — see session handoff for the safer pattern going forward.
