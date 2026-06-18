# NFT Phase-0 Data Foundation — Design

_Status: DESIGN (2026-06-17). Phase 0 of `NFT_MARKETPLACE_PHASE3_PLUS_PLAN.md` §5.5 — the cross-cutting foundation that **blocks all engines**. Promoted ahead of the floor-offers engine after the 5-lens CTO panel found (a) the live indexer silently drops 100% of v3 `Sale` events today, (b) no raw immutable event ledger exists (§5.5 unmet), (c) the maker/taker volume basis is an irreversible schema decision that must be frozen before more volume accrues. The floor-offers engine design (`NFT_FLOOR_OFFERS_DESIGN.md`) is panel-validated and parked behind this. **Build is Go-backend; gated on the Semgrep Guardian hook being un-blocked for `go`.**_

## 1. Why this is first
Guardrail #5 ("indexer tails + ingests an engine's events before `RegisterMarket`") and guardrail #3 ("points = pure function of a retained raw event ledger + versioned formula") are hard prerequisites for *any* engine. The panel proved neither is met today. Worse, the live `memba_nft_market_v3` is registered/deployed and emitting `Sale` events that the indexer **does not handle** — so volume and points data are being lost right now (backfillable from chain, but the hole grows each block). Phase-0 both unblocks the floor-offers engine and fixes this live bug.

## 2. Scope (this phase)
Backend indexer + ledger + recompute harness + frozen formula policy. **No new realm, no engine, no chain deploy.** All work is in `Memba/backend/internal/indexer/` + migrations + a points recompute package. Engine-specific dispatch (floor-offer resolution by `(collection, buyer, pkg_path)`) lands with the engine, not here.

## 3. Components

### 3.1 Raw immutable event ledger (BLOCKER-2)
New table `nft_raw_events`:
`(event_block INT, event_tx_index INT, event_index INT, pkg_path TEXT, event_name TEXT, schema_version TEXT, attrs_json TEXT, ingest_ts INT, block_hash TEXT, PRIMARY KEY(event_block, event_tx_index, event_index))`.
- **First write in every dispatch**, in the *same DB tx* as the derived projection. The ledger is the source of truth; `nft_sales`/`nft_offers`/`nft_listings` become rebuildable caches.
- Stores the **full attr blob** (`attrs_json`) so no field is ever lost to a lossy column mapping (today `royaltyRecipient`, `denom`, `via`, `sellerAmount`, `schemaVersion` are dropped).
- Backed up separately from the projection cache (§10 — it is a ledger, not a cache).

### 3.2 `Sale` event handler (BLOCKER-1 — fixes the live v3 bug)
Add `case "Sale"` to the dispatcher → `applySale()` reading the frozen `SaleArgs` keys (`via, collection, tokenId, seller, buyer, price, fee, royalty, royaltyRecipient, sellerAmount, denom`) + envelope height. Routes to the sales projection with `kind = via`. Retire reliance on the dead v2 names (`PurchaseConfirmed`/`OfferAccepted`/`TokenSold`) for volume. **Volume is counted on `Sale` ONLY** — `OfferAccepted` (companion, see engine design) is metadata, never a second volume row (this is the exact v2→v3 double-count bug; do not reintroduce).

### 3.3 schemaVersion + pkg_path persistence (BLOCKER-3)
Add `pkg_path` and `schema_version` columns to `nft_sales` and `nft_offers` (and they're in `nft_raw_events`). Every points query and every order-book view is **scoped by `pkg_path`**, so v3 (per-token) and the future `offers_v1` (floor) coexist in one table without double-count or cross-contamination, and supersession (§10) disambiguates cleanly.

### 3.4 Reorg-safety + indexed-through watermark (HIGH-3)
- **Confirmation depth:** tail to `latest - NFT_CONFIRMATIONS` (env, default e.g. 5), not the bleeding edge.
- **Block-hash tracking** per processed height; on hash mismatch at re-tail, `DELETE FROM <projections + raw_events> WHERE event_block >= forkHeight` and re-ingest (delete/replay-by-height — a **tested** capability, currently absent).
- **`indexed_through` watermark** = max safe (confirmed) height. The points recompute harness reads this, never the raw cursor — so it never counts a partial/unconfirmed block.

### 3.5 Backfill-from-deploy-height (HIGH-4)
- Seed `nft_indexer_state(<realm_path>, deploy_height - 1)` at each engine's deploy so its cursor starts at deploy height, not genesis. Verify adding a watched realm does **not** drag the global cursor min backward (today it would re-scan from block 260000 for all realms).
- Make backfill-from-height an explicit, tested operator command.

### 3.6 Points recompute harness (§5.5 / guardrail #3)
A deterministic pure function `points = f(raw_ledger_snapshot, formula_version)` in its own package, **CI-runnable against a fixture snapshot** (same input → same output, byte-stable). Reads only `nft_raw_events` up to `indexed_through`. No accrual goes live until this harness is green and reproducible.

## 4. Frozen formula invariants (POLICY — irreversible, write before accrual)
These are declared irreversible in §5.5; ratify them now:
1. **Royalty-weighted volume** (economics highest-leverage fix): points volume is weighted by *realized royalty rate*, not nominal price. Zero-/low-royalty collections contribute ≈0 points — because enforced royalty is the only on-chain wash-tax and `RoyaltyInfo` legitimately returns 0 for many collections. Without this, the marketplace is a profitable wash-farming venue subsidized by the points program.
2. **Maker/taker via→role mapping** (the irreversible schema decision; `Sale` is already live on v3 so we ratify a mapping rather than add attrs): `via="buy"` → maker=seller(lister), taker=buyer; `via="offer"` (v3 per-token AND offers_v1 floor) → maker=buyer(offerer), taker=seller(accepter); `auction`/`sweep` roles defined when those engines ship. The mapping is consistent for `via="offer"` across both engines, so `pkg_path` scopes attribution but the role rule is uniform.
3. **Denom normalization unit** = ugnot; a versioned denom→unit policy is frozen now (only ugnot exists today) so Phase-4 GRC20 volume is recomputable.
4. **Accrual start-block** policy: decide retroactive-to-v3-deploy vs from-foundation; backfill the v3 `Sale` gap into the raw ledger before accrual is declared authoritative; declare `accrual_start_block` a frozen constant.
5. Self/cluster exclusion (off-chain, fed by the companion `OfferAccepted` offer-age signal from the engine), per-wallet caps, reputation multipliers (coefficients may stay private), and **non-binding / clawback / no-guaranteed-conversion** published terms.

## 5. Migrations
Forward-only runner (already the pattern). New migration: `nft_raw_events` + `pkg_path`/`schema_version` columns on `nft_sales`/`nft_offers` + block-hash/watermark state. The raw-event table is a ledger — backed up separately; projections are droppable/rebuildable from it.

## 6. Testing (TDD)
- Unit: `applySale` parses every `SaleArgs` key; raw-ledger write precedes projection in the same tx; pkg_path scoping; dedupe (Sale = volume, OfferAccepted = metadata).
- Reorg: synthetic fork → delete/replay-by-height restores correct projections; watermark never exceeds confirmed height.
- Backfill: seed deploy-height, re-tail a range, assert idempotent + complete; adding a realm doesn't drag others.
- Recompute determinism: fixture snapshot → identical points across two runs.
- **Smoke gate (guardrail #5):** the synthetic-event ingest test asserts a `Sale` ingests end-to-end (not just `OfferMade`) — otherwise the gate is theater.
- ⚠️ **All of the above needs `go test`**, currently blocked by the Semgrep Guardian hook.

## 7. Sequencing after this
Phase-0 green → finalize `NFT_FLOOR_OFFERS_DESIGN.md` as the engine spec (panel-hardened) → TDD build the engine → deploy choreography (indexer already tailing+ingesting → RegisterMarket → allowlist flip → 2-wallet verify).

## 8. Out of scope
The floor-offers engine realm; the frontend offers UI; trait-scoped offers; GRC20 desk; the on-chain points claim (all later phases).

## 9. v3 Sale-gap backfill (operator step, before declaring accrual authoritative)

The Task-3 `Sale` handler shipped after v3 was already live, so v3 `Sale` events
between the v3 deploy block and the handler-deploy block were never ingested. The
executable procedure to close the gap:

### 9.1 Prerequisites

Confirm v3 is in `NFT_WATCHED_REALMS` (it is by default in the current config).
Confirm the v3 deploy height — query the chain or check the deploy TX; at time of
writing the v3 engine (`memba_nft_market_v3`) was deployed around block **280000**
on test13.

### 9.2 First-time seed (no existing cursor row)

If the v3 realm has never been indexed and has no row in `nft_indexer_state`:

1. Set `NFT_SEED_REALM_CURSOR=gno.land/r/samcrew/memba_nft_market_v3@280000` in
   the backend environment (`.env` / Fly.io secrets).
2. Restart the backend. On startup `SeedRealmCursor` inserts the cursor at
   `deployHeight-1` (279999) via `INSERT OR IGNORE`. The tailer then scans forward
   from that height, ingesting the previously-dropped `Sale` events. All writes are
   idempotent — already-ingested rows are silent no-ops.
3. Remove `NFT_SEED_REALM_CURSOR` (or leave it empty) for subsequent restarts.

### 9.3 Re-seed when the cursor has already advanced (important caveat)

`SeedRealmCursor` is `INSERT OR IGNORE` and **will not rewind** a realm whose
`nft_indexer_state` row already exists (even if the cursor advanced past the gap).
If the v3 realm is already being indexed and its row is past the gap, seeding is a
no-op.

To force a full re-scan from the deploy block:

```sql
-- Connect to the SQLite DB (sqlite3 $DB_PATH) and run:
DELETE FROM nft_indexer_state WHERE realm_path='gno.land/r/samcrew/memba_nft_market_v3';
```

Then set `NFT_SEED_REALM_CURSOR` and restart as in §9.2. Re-ingest is safe — all
event-write queries use `INSERT OR IGNORE` on the `(realm_path, tx_hash, event_name)`
triple, so duplicate rows are impossible.

### 9.4 Confirmation

Before flipping `accrual_start_block` to authoritative, confirm the gap filled:

```sql
SELECT COUNT(*) FROM nft_raw_events WHERE event_name='Sale';
```

The count should be non-zero and the recompute harness should read those rows.
