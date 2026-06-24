# NFT v3 Trading — Go-Live & Rollback Runbook

> **Scope:** activating the **v3 trading engine** (`memba_nft_market_v3` + `memba_collections`) on test13.
> **Status:** v3 deployed but **NOT `RegisterMarket`-ed and NOT frontend-wired** (by design).
> **Supersedes** the legacy v1 gallery plan in [`NFT_ACTIVATION.md`](NFT_ACTIVATION.md) for everything trading-related.
> **Audience:** operator + multisig signers. Every step has a verify + a gate; do not skip-ahead.
> **Source of truth for the audit context:** `docs/planning/NFT_FEATURE_AUDIT_AND_AAA_PLAN_2026-06-24.md`.

A reviewer must be able to execute go-live **and** abort from this doc alone.

---

## 0. Preconditions — every gate GREEN before you touch the chain

| Gate | Evidence | State |
|------|----------|-------|
| **F1 — settlement proven** | gnodev integration harness, 42 assertions ([samcrew-deployer#33](https://github.com/samouraiworld/samcrew-deployer/pull/33), MERGED) | ✅ |
| **F2 — indexer hardened** | malformed-Sale rejection ([memba#497](https://github.com/samouraiworld/memba/pull/497), MERGED + deployed) | ✅ |
| **Royalty-routing audit sign-off** | every settlement path routes through `RoyaltyInfo` + `MarketTransfer`, CEI-ordered, one reentrancy guard. The harness exercises this on the live engine. | ✅ (harness) |
| **Trading UI** | Phase-2 ([#443](https://github.com/samouraiworld/memba/pull/443)) merged + Phase-3 multi-engine router available (WS-G) | ⏳ in-flight |

> **Mainnet note:** gnoland1.1 lacks interrealm-v2 Phase 3 (gno #5669). **Do NOT attempt mainnet activation** until mainnet upgrades to a VM ≥ #5669. This runbook is **test13-only**.

---

## 1. Verify deployed artifacts (test13)

```bash
RPC=<test13 rpc>
COLL=gno.land/r/samcrew/memba_collections
V3=gno.land/r/samcrew/memba_nft_market_v3
V3_ADDR=g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj   # deterministic from pkgpath
# collections live + market not yet registered:
gnokey query vm/qrender -data "$COLL:" -remote "$RPC"
gnokey query vm/qeval  -data "$COLL.IsRegisteredMarket(\"$V3_ADDR\")" -remote "$RPC"   # expect: false
```
Confirm `V3_ADDR` matches `frontend/src/lib/nftConfig.ts` **and** `realm-versions.json`.
**Admin multisig:** `<TODO: confirm address + signer set>`.

---

## 2. Activation sequence — STRICT ORDER

### Step 1 — Indexer must tail v3 BEFORE registration ⛔ (the one irreversible ordering rule)
If the indexer is not ingesting v3 from its deploy height before the first trade, you get a **permanent event gap** → wrong volume/floor/points.
1. Add `memba_nft_market_v3` to `NFT_WATCHED_REALMS` **and** `NFT_SALE_VOLUME_REALMS` (so Sale is the only volume row).
2. Seed the cursor at the v3 deploy height: `NFT_SEED_REALM_CURSOR=<realm>:<deployHeight>` (never rewinds an existing realm).
3. **Verify:** `/metrics` → NFT tailer lag (`chain_head − last_block`) is current; a known v3 event (if any) is queryable in `nft_raw_events`.
- **GATE:** do not proceed until the indexer is confirmed tailing v3.

### Step 2 — `RegisterMarket(v3)` via multisig
```bash
cd samcrew-deployer && ./samcrew-nft-register-v3.sh test13   # idempotent; no-op if already registered
```
- `<TODO: which signers execute the multisig tx>`.
- **Verify:** `IsRegisteredMarket(V3_ADDR)` → `true`; indexer recorded the `MarketRegistered` event.

### Step 3 — 2-wallet E2E on test13 (the live money test) ⛔
Mirror the WS-A harness against the live chain with two real wallets (A=seller, B=buyer):
1. A: `CreateCollection` (pays createFee) → note `collectionID = <A>/<slug>`.
2. A: `Mint` token 0 → A.
3. A: `SetApprovalForAll(collectionID, V3_ADDR, true)`.
4. A: `ListNFT(collectionID, 0, price)`.
5. B: `BuyNFT(collectionID, 0)` sending `price` ugnot.
6. **Verify on-chain:** B owns token 0; A received `price − fee − royalty`; feeRecipient `+fee`; royaltyRecipient `+royalty`.
7. **Verify indexer:** one `nft_sales` row (`kind=buy`), `nft_collections` volume/floor updated.
8. Repeat once for the offer path (`MakeOffer` → `AcceptOffer`).
- **GATE:** all payouts + ownership + indexer rows correct, or **abort** (§3) and investigate.

### Step 4 — Frontend wiring (coordinate with #443 / Phase-3 router)
1. Add `"gno.land/r/samcrew/memba_nft_market_v3"` to `REALM_ALLOWLIST.test13` in `frontend/src/lib/config.ts`.
2. Route `tradeEngineFor(source) → v3` for `memba_collections` collections.
3. Deploy a **preview**; verify a real list→buy in-app; then promote.

### Step 5 — Flip the flag
1. Set `VITE_ENABLE_NFT=true` in Netlify env — **at the repo root** `.env` (Vite `envDir:'..'`; a `frontend/.env` silently no-ops).
2. Rebuild + deploy. Smoke: hub loads; a collection page completes a trade.

---

## 3. Rollback / abort — levers are TESTED (WS-A TEST 5 proved C)

Apply fastest-safest first; they compose.

| # | Lever | Effect | How |
|---|-------|--------|-----|
| **A** | Frontend kill | Hides + blocks v3 in-app instantly; no chain tx | `VITE_ENABLE_NFT=false` (or drop v3 from `REALM_ALLOWLIST`), redeploy |
| **B** | `market_v3.Pause()` (admin) | Blocks new List/Buy/MakeOffer/AcceptOffer; **value-exits still work** (Delist/Cancel/ClaimExpired) so no funds trap | multisig `maketx call $V3 Pause` |
| **C** | `memba_collections.UnregisterMarket(V3_ADDR)` (platformAdmin) | **Revokes the moat → ALL v3 settlement fails safe** (proven: WS-A TEST 5) | multisig `maketx call $COLL UnregisterMarket $V3_ADDR` |
| **D** | `memba_collections.Pause()` | Global registry halt (also stops mints + every market) | multisig `maketx call $COLL Pause` |

- **PRE-STAGE before launch:** a **pre-signed multisig `Pause` + `UnregisterMarket` tx**, stored securely, so abort is a single broadcast under pressure. `<TODO: owner + storage location>`.
- **Immutability:** `memba_collections` holds every NFT ledger and **cannot be redeployed** without orphaning NFTs. A realm-level fix = deploy a **new market path** + `RegisterMarket` it (the registry persists; the broken market is `UnregisterMarket`-ed).

---

## 4. Verified-badge operations

- **Grant:** `SetCollectionMeta(id, "verified", "true")` (multisig). **Revoke:** `SetCollectionMeta(id, "verified", "")` on a rug/violation.
- Badge is **informational only** — never a trading gate or a points multiplier (keep it that way).
- `<TODO: curation SLA, who reviews, public criteria link, appeal path>`.

---

## 5. Monitoring (post-launch)

- **Already live:** `/metrics` → NFT tailer lag (`chain_head − last_block`) + signed-login ratio.
- **WS-B added:** `slog.Warn "indexer: skipping malformed Sale event"` — **alert on any occurrence** (signals on-chain schema drift).
- **Follow-up (WS-B item 4):** sale-volume-spike, failed-settlement, and floor-anomaly signals.
- **Farming watch (WS-D):** off-chain cluster detection — flag sales where `royaltyRecipient` is in the buyer/seller cluster (royalty-weighted points don't deter a creator routing royalty to their own wallet).

---

## 6. Open items requiring an owner (fill before go-live)

- [ ] Multisig key holders + who executes each multisig step (Step 2, badges, rollback).
- [ ] Pre-signed `Pause`/`UnregisterMarket` tx ceremony + secure storage.
- [ ] Verified-badge review SLA + public criteria.
- [ ] Decision: keep v3 trading design-locked behind #443/Phase-3 until the router ships (current recommendation), vs. early-enable.
- [ ] Mainnet only: confirm gnoland1 ≥ gno #5669 (separate, blocking).
