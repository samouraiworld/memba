# NFT Marketplace — Phase 3+ Plan (validated)

_Status: DESIGN (2026-06-17). Validated by a 5-lens CTO expert panel (security/crossing, economics, architecture, product, data-infra). Supersedes the "Phase 3+ deferred" stub in `memba_nft_market_v3`. Next step: per-phase implementation plans via the writing-plans flow._

## 1. Context & invariants

The open NFT marketplace + launchpad is live in core form on test13: `memba_collections` (canonical, **irreversible** multi-collection registry — holds every collection's NFT ledger, never redeployed), `memba_nft_market_v3` (fixed-price listings + escrowed offers, 2.0% fee), and the launchpad UI (create / mint phases / allowlist / creator profiles). Phase 3+ adds the remaining marketplace mechanisms **without ever touching `memba_collections`** — it is all engine / frontend / indexer / package work.

**Hard invariants (do not violate):**
- **The royalty moat.** `MarketTransfer(cur, id, from, to, tid)` on `memba_collections` is the ONLY owner-to-owner token-movement path, callable only by addresses authorized via `RegisterMarket(addr)`. Royalties settle via `RoyaltyInfo(id, tid, salePrice) → (recip, amount)`. Every settlement path in every engine MUST route through `RoyaltyInfo` + `MarketTransfer`. "No ungated / no-royalty transfer path, EVER."
- **Irreversibility.** `memba_collections` is never redeployed. Engines are versioned, separately-deployed realms. Gno paths are immutable: a fixed engine = a new `_vN` path.
- **`memba_collections` already provides the kill-switch:** `UnregisterMarket(addr)`, global `Pause`, and per-collection pause all exist — a buggy/malicious engine can be revoked without touching the ledger.
- **ABI limit:** `vm/MsgCall` cannot encode a `[]string` arg (only scalars + base64 `[]byte`). Slice-shaped args (e.g., a sweep token-id list, a Merkle proof) must be a delimited string or base64, split in-realm.

## 2. Strategic framing (from the founder)
- **Priority for this wave = trust + premium UX**, then liquidity, then tokenomics.
- **$MEMBA is NOT live** → the tokenomics features are the final, explicitly-gated phase; points accrue off-chain from day one, the on-chain claim waits for $MEMBA.
- Positioning = Magic-Eden model (open marketplace + launchpad + rewards token + multi-token). Builder identity is a **trust layer, not a gate**.

## 3. Validated sequence

```
Phase 0  Foundation (cross-cutting; blocks all engines)
Phase 1  Verified badge        (trust; no new realm)
Phase 2  Floor offers + Sweep  (liquidity; one engine)
Phase 3  Auctions              (premium UX; separate engine)
Phase 4  Tokenomics            (gated on $MEMBA launch)
   └ points accrual begins in Phase 0 and runs continuously
```

**Why this order (panel consensus):** liquidity primitives (floor offers) manufacture a two-sided market at low volume and are the volume flywheel, so they precede auctions; auctions carry the highest thin-market flop risk (a no-bid auction signals "nobody's here") and are deferred behind featured/reserved drops. The trust priority is honored by leading with the badge and by the foundation phase, not by front-loading auctions. The Phase-0 shared escrow library dissolves the security argument for "build the hardest escrow engine first."

## 4. Master guardrails (apply to the whole initiative)
1. **Royalty-routing audit gate.** No engine is `RegisterMarket`-ed until an independent audit proves every settlement path routes through `RoyaltyInfo` + `MarketTransfer`, CEI-ordered, under one reentrancy guard. This protects both the moat and the irreversible ledger.
2. **Event schema is a frozen, append-only public API.** Design the full cross-engine vocabulary ONCE in Phase 0 (see §5.1). It binds engine ↔ indexer ↔ frontend ↔ points ledger and cannot be cheaply changed after an engine deploys.
3. **Points = deterministic pure function of (retained raw event log + versioned formula).** Retain raw events as an immutable ledger; accrue from day one; freeze the formula's invariants before accrual starts.
4. **Canonical fee/royalty conformance.** One fee/royalty spec (basis, rounding, incidence), conformance-tested against EVERY engine before the second engine ships — otherwise traders arbitrage the cheapest path and the wash-tax (sybil defense) leaks.
5. **Indexer-tails-before-RegisterMarket.** An engine goes public only after the indexer is confirmed ingesting its events — else events (and points) in the gap are silently lost.

## 5. Phase 0 — Foundation (cross-cutting, blocks all engines)

### 5.1 `p/samcrew/memba_market_core` (shared pure package)
Extract from the proven `memba_nft_market_v3` code (gno can't share realm *state*, but can share pure helpers):
- royalty + platform-fee split math (clamp royalty ≤ salePrice; defined rounding);
- the `RoyaltyInfo` + `MarketTransfer` settlement choreography (the single correct money sequence);
- pull-payment escrow accounting helpers (credit-balance / claim-separately; never push-refund);
- event-emit helpers that enforce the frozen schema.
Audited once; every engine imports it. Per-engine test setup: the package + `memba_collections` must be **real dirs in `examples/`** (gno `test` doesn't follow symlinks for cross-realm deps) — bake into the per-engine template.

### 5.2 Frozen event schema (versioned, append-only)
Full vocabulary for all engines, even unbuilt ones: `Sale` (exists), `OfferMade/OfferAccepted/OfferCancelled`, `AuctionCreated/BidPlaced/BidRefunded/AuctionExtended/AuctionSettled`, `SweepExecuted`. Standardized fields on every event: `collection`, `tokenId`, `from`/`to` (or `seller`/`buyer`), `price`/`amount`, `denom`, `via`, `fee`, `royalty`, `height`, and a **`schemaVersion`** attr. Points-relevant fields (maker/taker, normalized volume basis) included from the start. The indexer parser and the frontend `lib/nftMarketplace.ts` parser are co-specified consumers of this schema.

### 5.3 Fee/royalty conformance spec
Canonical 2.0% platform fee + `RoyaltyInfo`-driven royalty, fixed basis (hammer/sale price), rounding rule, and incidence (seller-side vs buyer-added) — identical across v3, offers/sweep, auctions. A conformance test suite each engine must pass.

### 5.4 RegisterMarket governance policy
`RegisterMarket`/`UnregisterMarket` are multisig/platformAdmin-only, no DAO-shortcut, no auto-registration, registered engines cannot self-register (no escalation). Incident runbook: revoke a bad engine via `UnregisterMarket` + global `Pause`. Document the multi-engine authorization surface as a critical, irreversible trust surface.

### 5.5 Points data foundation (accrual starts here)
- Retain a raw, normalized **event ledger** forever (height, tx/event index, pkg_path, name, schemaVersion, full attr blob, ingest ts) — separate from derived aggregates.
- Points = pure function of (raw ledger + versioned formula). Build a deterministic **recompute harness** (CI-runnable against a snapshot).
- Freeze formula invariants: royalty-bearing volume only, exclude self/cluster, per-wallet caps, reputation multipliers; coefficients may stay private. Publish **non-binding / clawback / no-guaranteed-conversion** terms.
- Accrual **start-block = earliest engine deploy block whose events feed points** (decide retroactive policy now; it is irreversible in perception). Multi-denom volume normalized to a frozen unit.
- Indexer correctness: gap-free + reorg-safe + delete/replay-by-height; a monotonic "indexed-through" watermark accrual reads so it never counts a partial block; lag + parse-failure alerting.

### 5.6 Frontend multi-engine router
`{collection, action} → engine address` routing + per-engine builders + `REALM_ALLOWLIST` plan, so v3 + offers/sweep + auctions coexist. Lands with the event schema, not as a per-engine afterthought.

## 6. Phase 1 — Verified badge (trust; no new realm)
- On-chain: `SetCollectionMeta(id, "verified", "true")` by platformAdmin (existing hook). Revoke = overwrite/remove. **Team-curated v1** against a **published checklist** (creator identity linked, metadata locked, not a clone, supply/royalty disclosed) with a stated review SLA and a **public appeal channel**. **Informational only — never a listing/trading gate.** DAO-governed curation deferred until volume justifies it.
- Indexer: surface the on-chain `verified` flag (trust the chain, not the frontend); reflect revocation.
- Frontend: verified badge on cards/detail + "verified only" filter.
- **Entry criterion:** enough real launchpad collections exist that curation has contrast (a badge on ~3 collections is theater). Track time-to-review as the success metric.

## 7. Phase 2 — Floor offers + Sweep (liquidity; one engine)
One engine sharing the order-book/offer state. **Floor offers ship first; sweep is gated on real listing depth.**
- **Collection / floor offers:** escrowed collection-wide bids (bid on ANY token in a collection); any holder accepts. The accept path is a SECOND transfer path → **must route through `RoyaltyInfo` + `MarketTransfer` identically to a listing** (the single most likely royalty-bypass seam). CEI on the *offer state* (mark consumed before transfer) to kill accept-race / double-settle. Show executable depth, not headline bid. Self/cluster offers excluded from points.
- **Sweep:** batch-buy-N-cheapest. Per-unit royalty + fee on EACH filled item (batch is the second-likeliest royalty-bypass seam). Slippage / max-total-spend cap (anti front-run/sandwich). Bound N for gas/state. Token-id list is **`[]string`-unsafe** → encode as a delimited string / base64, split in-realm.
- Pull-payment refunds throughout. Stale-listing/stale-offer handling for items that settle elsewhere (see §10).

## 8. Phase 3 — Auctions (premium UX; separate engine `memba_nft_auction_v1`)
Separate engine (distinct time-based state machine). English/timed first; Dutch later.
- `CreateAuction(collectionID, tid, reserve, duration, denom)` → escrowed bids (CEI) → `settle`: `MarketTransfer` + seller + `RoyaltyInfo` + fee.
- **ugnot-only bids in v1** (sidesteps GRC20 settle-reentrancy); if GRC20 bids are added, strict CEI + one guard across the whole settle sequence.
- **Pull-payment outbid refunds** (a contract bidder that panics on push-refund would lock the auction).
- **Anti-snipe:** extend-on-late-bid with a **capped total extension** + meaningful min-bid increment (else a whale griefs the auction open forever).
- **Cold-start guard:** ship behind **featured / hand-picked drops with reserve prices**; do not open generic auctions until bidding density is demonstrated. A no-bid auction is the worst trust outcome.
- Reserve/shill/self-bid volume excluded from points; define fee/royalty on hammer price per §5.3.

## 9. Phase 4 — Tokenomics (GATED on $MEMBA launch)
- **D1 (already running since Phase 0):** off-chain points accrual.
- **D2 — GRC20 settlement desk:** let listings/offers/auctions settle in $MEMBA or vetted GRC20 (the `SettlementDenom`/`denom` hooks are already threaded; `memba_collections` already supports GRC20 pricing via RealmTeller). **Denom allowlist = $MEMBA + explicitly vetted only** (arbitrary GRC20 = mint-worthless-token-buy-real-NFT attack). RealmTeller reentrancy → strict CEI + guard.
- **D3 — points → $MEMBA on-chain claim:** commit off-chain points on-chain (Merkle root / signed snapshot) before claims open; replay/double-claim protection; apply anti-sybil clawback before the window. Conversion is ratio-based against supply, not fixed-rate (cap accruable liability).

## 10. Cross-cutting concerns
- **Same-NFT consistency across engines.** An NFT may be listed in v3, offered in Phase 2, and auctioned in Phase 3 simultaneously. `MarketTransfer` on the single registry is the serialization point: the first venue to settle succeeds; the others must fail gracefully (stale-listing/stale-offer handling, no double-spend-of-NFT). Define and test this at every engine's settle path.
- **Per-engine deploy choreography (template):** deploy engine (no public entry) → configure indexer to tail its `pkg_path` from deploy height → confirm a synthetic event ingests → `RegisterMarket(addr)` (multisig, post-audit) → frontend allowlist flip + router entry → **live 2-wallet end-to-end verification** → enable discovery UI. Per-engine **backfill-from-deploy-height** must be a tested capability.
- **Engine supersession lifecycle:** when an engine is replaced, both stay deployed; define how in-flight listings/offers/auctions drain on the old one, how the frontend stops creating new orders there while still resolving existing ones, and how the indexer disambiguates via `schemaVersion`/version tag without double-counting.
- **Indexer schema migrations** per new event family (versioned, forward-only runner; back up the raw-event table specifically — it is a ledger, not a cache).
- **Discovery + education:** every engine ships with a discoverable UI surface (offers inbox, sweep UI, auction page, "verified only" filter) and minimal inline explainers; a feature nobody can find or understand is not shipped. Define a success metric per feature.

## 11. Testing & verification
- gno TDD per engine (mirror the v3 harness lessons: IsUserCall wrapper + internal helper; real-dir-in-examples for cross-realm deps; AbortsWithMessage func() form). Conformance suite from §5.3.
- Multi-agent security audit per engine — **mandatory for auctions and the offers/sweep accept paths** (royalty routing + escrow + reentrancy).
- Frontend builders/parsers + UI via vitest TDD; allowlist gating keeps each feature dark until its engine is live.
- Live 2-wallet economic-flow verification per engine before it counts as shipped.

## 12. Out of scope (future)
EVM-token settlement via HyperGno; pro-trader analytics; Dutch auctions; cross-collection bundles; DAO-governed verification (Phase 1 successor).

## 13. Expert review trail
Validated 2026-06-17 by a 5-lens CTO panel; all five returned REORDER/ORDER-OK-with-insertion verdicts that converged on: (a) a Phase-0 shared-core + frozen-event-schema foundation before any engine; (b) floor offers ahead of auctions; (c) offers+sweep merged, auctions separate; (d) team-curated informational badge; (e) day-one recomputable points accrual. Founder accepted the reorder and the team-curated badge. Lens verdicts:
- **Security:** ORDER-OK + insert shared escrow lib & audit gate; master rule = royalty-routing-under-guard, audited before RegisterMarket.
- **Economics:** REORDER — promote floor offers above auctions; accrue points day-one (royalty = wash-tax); freeze cross-engine fee/royalty.
- **Architecture:** REORDER — extract `p/memba_market_core`; freeze event schema as append-only API; merge offers+sweep, keep auctions separate.
- **Product:** REORDER — demote auctions to behind floor offers (thin-market flop risk); team-curate the badge; gate value on launchpad supply; add discovery/education/2-wallet gates.
- **Data/infra:** REORDER — Phase-0 frozen versioned schema; retain raw event ledger + deterministic recompute; indexer-tails-before-RegisterMarket.
