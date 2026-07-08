# Marketplace v2 — Handoff / Resume Guide (2026-07-09)

> **Start here to resume.** This is the single source of "where we are + what's next." The full audit + plan is [`MARKETPLACE_V2_DEEP_AUDIT_AND_AAA_PLAN_2026-07-08.md`](./MARKETPLACE_V2_DEEP_AUDIT_AND_AAA_PLAN_2026-07-08.md) (phase statuses are kept current there too).

## TL;DR
- **Branch:** `feat/marketplace-v2` — worktree at `/Users/zxxma/Desktop/Code/Gno/Memba-worktrees/marketplace-v2`.
- **State:** 20 commits, **clean working tree**, **120 marketplace tests green**, `npm run build` green.
- **Behind** `VITE_ENABLE_MARKETPLACE_V2` (off in prod) — nothing user-facing until the flag flips. Safe to leave as-is.
- **Foundation (Phases 0–4) + lane rebuilds (Phase 7) DONE** and cut over (flag-gated). NFT lane verified rendering real test13 data in the browser.
- **Remaining** all have external gates: Phase 5 (needs a real listing to verify), Phase 6 (needs a deployer realm getter), Phase 8 (e2e/docs/cutover-flip).

## How to run + verify (exact)
```bash
# tests (one dir at a time; the harness uses a bounded vitest wrapper — never npx)
cd /Users/zxxma/Desktop/Code/Gno/Memba-worktrees/marketplace-v2/frontend
node ./node_modules/.bin/vitest run src/lib/marketplace src/components/marketplace src/pages/UnifiedMarketplace.test.tsx
npm run build   # tsc + vite build (tsc --noEmit is a no-op here — always use build)

# see it in a browser (the Claude preview proxy caches a stale App.tsx — run vite manually)
VITE_ENABLE_MARKETPLACE_V2=true VITE_ENABLE_NFT=true npx vite --port 5199
#  → design harness (all lanes + seed):   http://localhost:5199/test13/marketplace-v2-preview
#  → the REAL shell w/ v2 NFT lane live:   http://localhost:5199/test13/marketplace
```

## Architecture (what to know before touching it)
The whole marketplace now flows through one shared pipeline:
```
lane component (NftLaneV2 / TokenLaneV2 / ServiceLaneV2)
  └─ LaneView(lane, fetchFn, toCard, categories)                  components/marketplace/LaneView.tsx
       ├─ useLaneQuery  (cached TanStack Query)                    lib/marketplace/useLaneQuery.ts
       │     └─ fetchFn → codec (Result<T>, never throws)          lib/marketplace/codec.ts (+ result.ts)
       ├─ toCard adapter: row → CardModel                          lib/marketplace/adapters/*
       ├─ useMarketFilters (URL ?q/category/sort/verified)         lib/marketplace/useMarketFilters.ts (+ marketFilters.ts)
       ├─ LaneToolbar (search/chips/sort/verified)                 components/marketplace/LaneToolbar.tsx
       └─ ListingGrid → MarketCard (+ ReputationBadge)             components/marketplace/{ListingGrid,MarketCard,ReputationBadge}.tsx
```
- **Design tokens:** `src/tokens.css` (`--font-sans`=Inter now; `--color-k-lane-*` 4-lane accents). MarketCard is CSS-only (no inline styles / JS hover). Monogram gradient is the one sanctioned inline-color exception.
- **Shell:** `src/pages/UnifiedMarketplace.tsx` — `LANE_COMPONENTS` picks v2 lanes when `isMarketplaceV2Enabled()`, else the old lanes. Shell search hidden + Phosphor tab icons + `aria-selected` when v2.
- **Seed:** `src/lib/marketplace/seed/foundingSupply.seed.ts` (34 listings; drives fixtures + `MarketplaceV2Preview`).

## DONE (per phase, with commits)
- **Phase 0** `be609a9` `4878391` `8756209` — branch scaffold, deleted 1,320 dead lines, fixed stale route test, killed demo-tells (fabricated AgentLane ★/✓, reload, alert, MEMBATEST marked), landed+validated seed.
- **Phase 1** `4c32cba` — `MarketCard` + `ListingGrid` + Inter + lane tokens.
- **Phase 1.5** `342e857` `f1f7732` — buyer-first "You pay" price + no-refund copy; `ReputationBadge` (live wiring deferred to Phase 6).
- **Phase 2** `cf9eb27` `32ee457` `47e45ac` — codec (`Result<T>`), `useLaneQuery`, seed adapters, preview harness.
- **Phase 3** `6f458bb` — `useMarketFilters` + `applyFilters` (honest search) + `LaneToolbar`.
- **Phase 4** `269dc10` — `SellAnythingButton` + one-front-door (already on main) + Robot→ShoppingBag icon.
- **Phase 7** `fa72f5b` `622ce9c` `a2fae98` `644094f` — `LaneView`; `nftToCard`/`tokenOtcToCard`; `NftLaneV2` (real fetch) / `TokenLaneV2` (real OTC) / `ServiceLaneV2` (seed-fed, gated); flag-gated shell cutover.
- **Phase 8 polish** `35a50b9` `4d8b751` — fixed live bugs (doubled `0 GNOT GNOT`, doubled seller address, two search boxes), emoji→Phosphor icons.
- **Phase 5.3 partial** `eb57d4e` — `aria-selected` on lane tabs.

## NOT DONE — exact next steps + gates
1. **Phase 5 — mobile trade sheet + real dialogs.** `TradeModal.css` has **0 @media** (no mobile layout). Primitives EXIST: `src/hooks/useFocusTrap.ts` + `src/components/AccessibleDialog.tsx` — *adopt them* in `TradeModal` (has `role="dialog"`, no `aria-modal`/trap) + fix `BottomSheet`'s single-`focus()` fake trap. Add mobile bottom-sheet CSS + sticky CTA.
   - **GATE:** to verify the money path you need a **real NFT listing** on test13 (current collections have floor 0 / no listings). Either list one, or use e2e with a fixture. Do NOT change the live money-path modal without browser/e2e verification.
2. **Phase 6 — purchase-gated reviews.** Wire `ReputationBadge` to real data + gate `PostReview` to a settled on-chain trade.
   - **GATE (deployer task):** `nft_market_v3_1` persists sales (`salesLog`) but exposes **no purchase-query getter**. Need a **new engine version `nft_market_v3_2`** adding `HasPurchased(buyer, seller)` / `GetSalesByBuyer` (+ `salesLog` state migration). Build on the shipped `p/samcrew/memba_reviews_core_v1` engine via a new `memba_marketplace_reviews_v1` consumer (do NOT fork/redeploy frozen realms). Until then, reputation display stays deferred (ungated data is sybil-prone — "worse than none").
3. **Phase 8 — finish.** Roving `tabindex` + `aria-controls`/tabpanel on tabs; funnel instrumentation (view→detail→sign→settle); Playwright e2e (per-lane browse on desktop + iphone/pixel; gating); update `CHANGELOG.md` + `DESIGN_SYSTEM.md`; **then flip `VITE_ENABLE_MARKETPLACE_V2=true` = the real cutover** (owner call).
4. **Agents v2 lane** — not built (secondary). `AgentLaneV2` on `LaneView` + an `agentToCard` when wanted.
5. **Services/Tokens de-gate** — separate milestone: needs `escrow_v3`/`token_otc_v2` live (they are, P0-guarded) + the money-path hard-gate trio (sig-verify flip + restore drill + fund-recovery e2e) + real seed→on-chain supply (`seedToOnchain` script, Task 7.4 — not built).

## Known rough edges (logged, non-blocking)
- Real `UnifiedListing→CardModel` adapters are per-source (`nftToCard`, `tokenOtcToCard`, seed adapters) rather than one unified adapter — fine; consolidate only if it helps.
- ServiceLaneV2 renders SEED data (no real services read yet) — clearly labeled, gated OFF in prod. Swap `fetchFn` for the real read at de-gate.
- `TokenLaneV2` is browse-only (the old TokenLane's list/buy trade actions are reintroduced with the Phase 5 trade-panel work).

## HARD CONSTRAINTS (do not violate)
- **Never commit to `main`** — work on `feat/marketplace-v2`; `cd` into the worktree before `git commit`. No Claude attribution in commits/PRs.
- **Never redeploy `tokenfactory_v2`** or any frozen realm — new versions only.
- Per-lane fee → DAO treasury; 5% ceiling; `NewBanker` with `cur` not `cur.Previous()`; safety-gated flags fail prod build if "true".
- Zero hardcoded colors (`var(--color-k-*)`; monogram gradient is the exception); mono = data only.
- No fabricated trust signals; reputation only from the authoritative, purchase-gated source.

## Resume checklist (tomorrow)
1. `cd /Users/zxxma/Desktop/Code/Gno/Memba-worktrees/marketplace-v2 && git status` → should be clean on `feat/marketplace-v2`.
2. `cd frontend && npm run build` → confirm still green (main may have moved; the branch is isolated).
3. Pick a lane of work from "NOT DONE" above. Phase 8 docs/e2e is fully browser-independent (safest solo). Phase 5 needs a listing/e2e. Phase 6 needs the deployer getter.
4. The Deep Audit + Plan doc has the full per-task detail; this handoff is the index.
