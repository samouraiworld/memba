# NFT Phase-0 Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the indexer data foundation the roadmap (§5.5) makes a hard gate for every marketplace engine — an immutable raw event ledger, correct ingestion of the canonical `Sale` event (fixing a live v3 data-loss bug), engine-disambiguated projections, reorg-safety, deploy-height backfill, and a deterministic points recompute harness.

**Architecture:** The existing block-tailer (`internal/indexer/`) reads gno `/block_results`, parses `chain.Emit` events, and writes SQLite projections. This plan adds a raw-event ledger written before each projection (source of truth; projections become rebuildable caches), a `Sale`-event handler, `pkg_path`/`schema_version` columns so v3 and the future floor engine coexist without double-count, confirmation-depth + block-hash reorg handling, per-realm deploy-height cursor seeding, and a pure `points` package that recomputes from the raw ledger up to a confirmed watermark.

**Tech Stack:** Go, `database/sql` + `modernc.org/sqlite` (pure-Go, in-memory `:memory:` for tests), `//go:embed` forward-only SQL migrations, `log/slog`. Tests: standard `testing`, `go test ./internal/...`.

## Global Constraints
- **Migrations are forward-only**, embedded via `//go:embed migrations/*.sql` in `internal/db/db.go`, applied in lexical filename order, each tracked in `_migrations` and run in its own tx. New migration file: `013_nft_data_foundation.sql`. NEVER edit an applied migration.
- **Idempotency invariant:** event-keyed rows use `INSERT OR IGNORE` on `(event_block, event_tx_index, event_index)`; re-processing a block must be a no-op. Preserve this for every new write.
- **`Sale` is the ONLY volume row.** `OfferAccepted` is metadata, never counted as a second sale (this was the v2→v3 double-count bug). Never aggregate volume off `OfferAccepted`/`PurchaseConfirmed` when a `Sale` exists.
- **The raw event ledger is the source of truth**; projection tables are rebuildable caches. Store the full attr blob so no field is ever lost.
- **No Claude attribution in commits.** Commit message format: concise subject line, no trailers, no co-authors.
- **Branch, never commit to main.** Work on `feat/nft-phase0-data-foundation` (branch off `main`).
- **`go test`/`go build` must be runnable** — these are blocked by the Semgrep Guardian hook until the operator disables it; verify `go test ./internal/indexer/...` runs before starting Task 1.
- Test DB helper: `openTestDB(t)` (in `internal/indexer/poller_test.go`) = `db.Open(":memory:")` + `db.Migrate()`; `must(t, err)`, `ev(typ, pkg, block, tx, idx, attrs)`, `countRows(t, db, query, args...)` helpers exist in `dispatch_test.go`.

---

## File Structure
- **Create** `internal/db/migrations/013_nft_data_foundation.sql` — raw ledger table, `pkg_path`/`schema_version` columns, `block_hash` on cursor state.
- **Create** `internal/indexer/raw_ledger.go` + `_test.go` — `recordRawEvent` (the source-of-truth write).
- **Modify** `internal/indexer/dispatch.go` — add `recordRawEvent` call + `case "Sale"` + `applySale`; thread `pkg_path`/`schema_version` into `settleSale`, `applyOfferMade`.
- **Modify** `internal/indexer/tailer.go` — confirmation depth, block-hash fetch, reorg delete/replay, per-realm deploy-height seed; `TailerConfig.Confirmations`.
- **Create** `internal/indexer/reorg.go` + `_test.go` — pure helpers `confirmedEnd`, reorg detection + `rollbackFromHeight`.
- **Create** `internal/points/points.go` + `_test.go` — deterministic `Recompute`.
- **Modify** the env-reading site that builds `TailerConfig` (where `NFT_WATCHED_REALMS`/`NFT_START_BLOCK` are parsed) + `.env.example` — add `NFT_CONFIRMATIONS`.
- **Create** `docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md` — the frozen, irreversible formula policy.

---

### Task 1: Migration 013 — raw ledger + disambiguation columns + reorg state

**Files:**
- Create: `internal/db/migrations/013_nft_data_foundation.sql`
- Test: `internal/db/db_test.go` (add one test; mirror `TestMigrate_CreatesTablesAndTracks`)

**Interfaces:**
- Produces: tables/columns `nft_raw_events(event_block,event_tx_index,event_index PK, pkg_path, event_name, schema_version, attrs_json, block_hash, ingest_ts)`; `nft_sales.pkg_path`, `nft_sales.schema_version`; `nft_offers.pkg_path`, `nft_offers.schema_version`; `nft_indexer_state.block_hash`.

- [ ] **Step 1: Write the failing test** in `internal/db/db_test.go`

```go
func TestMigrate_013_RawLedgerAndColumns(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := Migrate(database); err != nil {
		t.Fatal("migrate:", err)
	}
	// Raw ledger table exists and accepts a row.
	if _, err := database.Exec(`INSERT INTO nft_raw_events
		(event_block, event_tx_index, event_index, pkg_path, event_name, schema_version, attrs_json, block_hash, ingest_ts)
		VALUES (1,0,0,'gno.land/r/x','Sale','1','{}','abc', CURRENT_TIMESTAMP)`); err != nil {
		t.Fatalf("nft_raw_events insert: %v", err)
	}
	// New disambiguation columns exist on sales + offers.
	for _, q := range []string{
		`SELECT pkg_path, schema_version FROM nft_sales LIMIT 0`,
		`SELECT pkg_path, schema_version FROM nft_offers LIMIT 0`,
		`SELECT block_hash FROM nft_indexer_state LIMIT 0`,
	} {
		if _, err := database.Exec(q); err != nil {
			t.Fatalf("column missing: %q: %v", q, err)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/ -run TestMigrate_013 -v`
Expected: FAIL — `no such table: nft_raw_events`.

- [ ] **Step 3: Write the migration** `internal/db/migrations/013_nft_data_foundation.sql`

```sql
-- 013_nft_data_foundation.sql — raw event ledger + engine disambiguation + reorg state.
--
-- The raw ledger is the immutable source of truth (full attr blob, never lossy);
-- nft_sales/nft_offers/etc. are rebuildable projections. pkg_path + schema_version
-- let v3 (per-token) and future engines (e.g. memba_nft_offers_v1, floor offers)
-- coexist in one projection table without double-count. block_hash on the cursor
-- enables reorg detection.

CREATE TABLE IF NOT EXISTS nft_raw_events (
    event_block     INTEGER NOT NULL,
    event_tx_index  INTEGER NOT NULL,
    event_index     INTEGER NOT NULL,
    pkg_path        TEXT NOT NULL,
    event_name      TEXT NOT NULL,
    schema_version  TEXT,
    attrs_json      TEXT NOT NULL,
    block_hash      TEXT,
    ingest_ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_block, event_tx_index, event_index)
);

CREATE INDEX IF NOT EXISTS idx_nft_raw_events_pkg_name ON nft_raw_events (pkg_path, event_name);
CREATE INDEX IF NOT EXISTS idx_nft_raw_events_block ON nft_raw_events (event_block);

ALTER TABLE nft_sales  ADD COLUMN pkg_path TEXT;
ALTER TABLE nft_sales  ADD COLUMN schema_version TEXT;
ALTER TABLE nft_offers ADD COLUMN pkg_path TEXT;
ALTER TABLE nft_offers ADD COLUMN schema_version TEXT;
ALTER TABLE nft_indexer_state ADD COLUMN block_hash TEXT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/ -run TestMigrate_013 -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/migrations/013_nft_data_foundation.sql internal/db/db_test.go
git commit -m "nft indexer: migration 013 — raw event ledger + engine disambiguation columns"
```

---

### Task 2: Raw event ledger write (`recordRawEvent`)

**Files:**
- Create: `internal/indexer/raw_ledger.go`
- Test: `internal/indexer/raw_ledger_test.go`

**Interfaces:**
- Consumes: `GnoEvent{Type, PkgPath, Attrs map[string]string, Block, TxIndex, EventIdx}` (from `block_results_parser.go`).
- Produces: `func recordRawEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error` — idempotent insert of the full event into `nft_raw_events`. Reads `schemaVersion` from `ev.Attr("schemaVersion")`.

- [ ] **Step 1: Write the failing test** `internal/indexer/raw_ledger_test.go`

```go
package indexer

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRecordRawEvent_StoresFullAttrsIdempotently(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	e := ev("Sale", "gno.land/r/samcrew/memba_nft_market_v3", 500, 1, 2, map[string]string{
		"via": "buy", "collection": "genesis", "tokenId": "7",
		"royaltyRecipient": "g1roy", "denom": "ugnot", "schemaVersion": "1",
	})
	must(t, recordRawEvent(ctx, db, e, "HASH500"))
	must(t, recordRawEvent(ctx, db, e, "HASH500")) // replay = no-op

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events`); n != 1 {
		t.Fatalf("raw rows = %d, want 1 (idempotent)", n)
	}
	var pkg, name, sv, attrs, hash string
	must(t, db.QueryRow(`SELECT pkg_path, event_name, schema_version, attrs_json, block_hash FROM nft_raw_events`).
		Scan(&pkg, &name, &sv, &attrs, &hash))
	if pkg != "gno.land/r/samcrew/memba_nft_market_v3" || name != "Sale" || sv != "1" || hash != "HASH500" {
		t.Errorf("row = %q %q %q %q", pkg, name, sv, hash)
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(attrs), &m); err != nil {
		t.Fatalf("attrs_json not valid JSON: %v", err)
	}
	if m["royaltyRecipient"] != "g1roy" || m["via"] != "buy" {
		t.Errorf("attrs lost fields: %v", m)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/indexer/ -run TestRecordRawEvent -v`
Expected: FAIL — `undefined: recordRawEvent`.

- [ ] **Step 3: Write the implementation** `internal/indexer/raw_ledger.go`

```go
package indexer

import (
	"context"
	"database/sql"
	"encoding/json"
)

// recordRawEvent writes the immutable raw-ledger row for an event. It is the
// source of truth; projection tables are rebuildable from it. Idempotent on
// (event_block, event_tx_index, event_index). The full attr map is stored as
// JSON so no field is ever lost to a lossy projection column.
func recordRawEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error {
	attrs, err := json.Marshal(ev.Attrs)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_raw_events
			(event_block, event_tx_index, event_index, pkg_path, event_name,
			 schema_version, attrs_json, block_hash, ingest_ts)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		ev.Block, ev.TxIndex, ev.EventIdx, ev.PkgPath, ev.Type,
		ev.Attr("schemaVersion"), string(attrs), blockHash,
	)
	return err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/indexer/ -run TestRecordRawEvent -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/indexer/raw_ledger.go internal/indexer/raw_ledger_test.go
git commit -m "nft indexer: raw event ledger write (source of truth, full attr blob)"
```

---

### Task 3: `Sale` event handler (fixes the live v3 data-loss bug)

**Files:**
- Modify: `internal/indexer/dispatch.go` (add `case "Sale"` in `dispatchEvent`; add `applySale`)
- Test: `internal/indexer/dispatch_test.go`

**Interfaces:**
- Consumes: `settleSale(ctx, db, ev, col, tok, seller, buyer string, price, fee, royalty int64, kind string) error` (existing in `dispatch.go`).
- Produces: `func applySale(ctx context.Context, db *sql.DB, ev GnoEvent) error` — parses the frozen `SaleArgs` keys and routes to `settleSale` with `kind = ev.Attr("via")`.

- [ ] **Step 1: Write the failing test** in `internal/indexer/dispatch_test.go`

```go
func TestDispatch_Sale_v3_Ingests(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	const v3 = "gno.land/r/samcrew/memba_nft_market_v3"

	// The canonical v3 settlement event (via="buy"). Previously DROPPED.
	must(t, dispatchEvent(ctx, db, ev("Sale", v3, 600, 0, 0, map[string]string{
		"via": "buy", "collection": "genesis", "tokenId": "1",
		"seller": "g1seller", "buyer": "g1buyer",
		"price": "1000000", "fee": "20000", "royalty": "50000",
		"royaltyRecipient": "g1roy", "sellerAmount": "930000",
		"denom": "ugnot", "schemaVersion": "1",
	})))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales`); n != 1 {
		t.Fatalf("sales = %d, want 1 (Sale must ingest, not be dropped)", n)
	}
	var kind string
	var price, fee, royalty int64
	must(t, db.QueryRow(`SELECT kind, price_ugnot, fee_ugnot, royalty_ugnot FROM nft_sales`).
		Scan(&kind, &price, &fee, &royalty))
	if kind != "buy" || price != 1000000 || fee != 20000 || royalty != 50000 {
		t.Errorf("sale = %q %d %d %d", kind, price, fee, royalty)
	}
	var vol, sales int64
	must(t, db.QueryRow(`SELECT total_volume_ugnot, total_sales FROM nft_collections WHERE collection_id='genesis'`).Scan(&vol, &sales))
	if vol != 1000000 || sales != 1 {
		t.Errorf("aggregates vol%d sales%d", vol, sales)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/indexer/ -run TestDispatch_Sale_v3_Ingests -v`
Expected: FAIL — `sales = 0, want 1` (no `case "Sale"` yet, event dropped by default branch).

- [ ] **Step 3: Add the case + handler** in `internal/indexer/dispatch.go`

In `dispatchEvent`'s switch, add after the `case "PurchaseConfirmed":` line:

```go
	case "Sale":
		return applySale(ctx, db, ev)
```

Add this function (place it after `applyPurchaseConfirmed`):

```go
// applySale ingests the canonical v3+ settlement event (one Sale per sale, keyed
// by `via`). Replaces the retired v2 PurchaseConfirmed/OfferAccepted/TokenSold
// volume paths. Volume is counted HERE only — the OfferAccepted companion event
// is metadata, never a second sale row.
func applySale(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := ev.Attr("collection")
	tok := ev.Attr("tokenId")
	seller := ev.Attr("seller")
	buyer := ev.Attr("buyer")
	price := atoiSafe(ev.Attr("price"))
	fee := atoiSafe(ev.Attr("fee"))
	royalty := atoiSafe(ev.Attr("royalty"))
	via := ev.Attr("via") // "buy" | "offer" | "auction" | "sweep"
	return settleSale(ctx, db, ev, col, tok, seller, buyer, price, fee, royalty, via)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/indexer/ -run TestDispatch_Sale_v3_Ingests -v`
Expected: PASS. Then full package: `go test ./internal/indexer/ -v` — all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add internal/indexer/dispatch.go internal/indexer/dispatch_test.go
git commit -m "nft indexer: handle canonical Sale event (fixes dropped v3 sales)"
```

---

### Task 4: Persist `pkg_path` + `schema_version` on sales & offers (engine disambiguation)

**Files:**
- Modify: `internal/indexer/dispatch.go` (`settleSale` INSERT, `applyOfferMade` INSERT)
- Test: `internal/indexer/dispatch_test.go`

**Interfaces:**
- `settleSale` and `applyOfferMade` now write `ev.PkgPath` and `ev.Attr("schemaVersion")` into the new columns. No signature change (both already receive `ev`).

- [ ] **Step 1: Write the failing test** in `internal/indexer/dispatch_test.go`

```go
func TestDispatch_Sale_PersistsEngineColumns(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	const v3 = "gno.land/r/samcrew/memba_nft_market_v3"

	must(t, dispatchEvent(ctx, db, ev("Sale", v3, 600, 0, 0, map[string]string{
		"via": "buy", "collection": "genesis", "tokenId": "1", "seller": "g1s", "buyer": "g1b",
		"price": "1000000", "fee": "20000", "royalty": "0", "schemaVersion": "1",
	})))
	var pkg, sv string
	must(t, db.QueryRow(`SELECT pkg_path, schema_version FROM nft_sales`).Scan(&pkg, &sv))
	if pkg != v3 || sv != "1" {
		t.Fatalf("sale engine cols = %q %q, want v3 / 1", pkg, sv)
	}

	must(t, dispatchEvent(ctx, db, ev("OfferMade", v3, 601, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "buyer": "g1bidder", "amount": "900000", "schemaVersion": "1",
	})))
	must(t, db.QueryRow(`SELECT pkg_path, schema_version FROM nft_offers`).Scan(&pkg, &sv))
	if pkg != v3 || sv != "1" {
		t.Fatalf("offer engine cols = %q %q, want v3 / 1", pkg, sv)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/indexer/ -run TestDispatch_Sale_PersistsEngineColumns -v`
Expected: FAIL — `sale engine cols = "" ""` (columns written as NULL).

- [ ] **Step 3: Update the INSERTs** in `internal/indexer/dispatch.go`

In `settleSale`, change the `nft_sales` INSERT to include the two columns:

```go
	res, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_sales
			(collection_id, token_id, seller, buyer, price_ugnot, fee_ugnot, royalty_ugnot,
			 sale_block, kind, pkg_path, schema_version, event_block, event_tx_index, event_index)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		col, tok, seller, buyer, price, fee, royalty, ev.Block, kind,
		ev.PkgPath, ev.Attr("schemaVersion"),
		ev.Block, ev.TxIndex, ev.EventIdx,
	)
```

In `applyOfferMade`, change the `nft_offers` INSERT:

```go
	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_offers
			(collection_id, token_id, buyer, amount_ugnot, created_block, status,
			 pkg_path, schema_version, event_block, event_tx_index, event_index)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
		col, tok, buyer, amount, ev.Block, ev.PkgPath, ev.Attr("schemaVersion"),
		ev.Block, ev.TxIndex, ev.EventIdx,
	)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/indexer/ -run TestDispatch_Sale_PersistsEngineColumns -v` then `go test ./internal/indexer/ -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add internal/indexer/dispatch.go internal/indexer/dispatch_test.go
git commit -m "nft indexer: persist pkg_path + schema_version on sales/offers (engine scoping)"
```

---

### Task 5: Wire the raw ledger into dispatch + thread block hash

**Files:**
- Modify: `internal/indexer/dispatch.go` (`dispatchEvent` signature: add `blockHash string`; call `recordRawEvent` first)
- Modify: `internal/indexer/tailer.go` (pass block hash through `tailOnce`)
- Test: `internal/indexer/dispatch_test.go` (existing tests call `dispatchEvent(ctx, db, ev)` — update the `ev`/dispatch helper to pass a hash)

**Interfaces:**
- Changes: `func dispatchEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error`. Every existing caller/test must pass a hash (use `""` in tests that don't care).
- Produces: every dispatched event lands a `nft_raw_events` row before its projection.

- [ ] **Step 1: Write the failing test** in `internal/indexer/dispatch_test.go`

```go
func TestDispatch_WritesRawLedgerFirst(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	must(t, dispatchEvent(ctx, db, ev("NFTListed", marketPkg, 100, 0, 0, map[string]string{
		"collection": "genesis", "tokenId": "1", "seller": "g1s", "price": "1500000",
	}), "BLKHASH100"))

	var name, hash string
	must(t, db.QueryRow(`SELECT event_name, block_hash FROM nft_raw_events WHERE event_block=100`).Scan(&name, &hash))
	if name != "NFTListed" || hash != "BLKHASH100" {
		t.Fatalf("raw ledger row = %q %q", name, hash)
	}
}
```

- [ ] **Step 2: Update the dispatch helper signature so the package compiles, then run**

In `dispatch_test.go`, the existing tests call `dispatchEvent(ctx, db, ev(...))`. Add the trailing `""` arg to every existing `dispatchEvent(...)` call in the test file (they don't assert on hash). Then:

Run: `go test ./internal/indexer/ -run TestDispatch_WritesRawLedgerFirst -v`
Expected: FAIL to COMPILE — `not enough arguments in call to dispatchEvent` (until Step 3 adds the param).

- [ ] **Step 3: Update `dispatchEvent`** in `internal/indexer/dispatch.go`

Change the signature and record the raw event before the switch:

```go
func dispatchEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error {
	// Raw ledger first — the immutable source of truth. Idempotent; a later
	// projection failure is recoverable by rebuild-from-raw.
	if err := recordRawEvent(ctx, db, ev, blockHash); err != nil {
		return err
	}

	switch ev.Type {
	// ... unchanged cases ...
	}
}
```

Update the caller in `internal/indexer/tailer.go` `tailOnce`: the `dispatchEvent(ctx, db, ev)` call becomes `dispatchEvent(ctx, db, ev, blockHash)` where `blockHash` is fetched per height (Task 6 wires the real fetch; for now pass `""` — change the call to `dispatchEvent(ctx, db, ev, "")` so it compiles).

- [ ] **Step 4: Run tests**

Run: `go test ./internal/indexer/ -v`
Expected: PASS (all, including the new raw-ledger test and the updated existing tests).

- [ ] **Step 5: Commit**

```bash
git add internal/indexer/dispatch.go internal/indexer/dispatch_test.go internal/indexer/tailer.go
git commit -m "nft indexer: record every event to the raw ledger before projecting"
```

---

### Task 6: Confirmation depth + block-hash reorg handling

**Files:**
- Create: `internal/indexer/reorg.go`
- Test: `internal/indexer/reorg_test.go`
- Modify: `internal/indexer/tailer.go` (use `confirmedEnd`; fetch block hash; detect + roll back on mismatch)

**Interfaces:**
- Produces:
  - `func confirmedEnd(latest, confirmations, cursor, maxPerCycle int64) int64` — highest safe height to process this cycle (never exceeds `latest - confirmations`).
  - `func rollbackFromHeight(ctx context.Context, db *sql.DB, height int64) error` — deletes projection + raw rows with `event_block >= height` (reorg recovery).

- [ ] **Step 1: Write the failing tests** `internal/indexer/reorg_test.go`

```go
package indexer

import (
	"context"
	"testing"
)

func TestConfirmedEnd(t *testing.T) {
	// latest=1000, confirmations=5 → safe tip = 995.
	if got := confirmedEnd(1000, 5, 100, 500); got != 600 {
		t.Errorf("cursor-bound: got %d, want 600 (cursor+max)", got)
	}
	if got := confirmedEnd(1000, 5, 994, 500); got != 995 {
		t.Errorf("safe-tip-bound: got %d, want 995 (latest-confirmations)", got)
	}
	if got := confirmedEnd(1000, 5, 995, 500); got != 995 {
		t.Errorf("caught-up: got %d, want 995 (no work)", got)
	}
	if got := confirmedEnd(3, 5, 0, 500); got != 0 {
		t.Errorf("not-enough-confirmations: got %d, want 0", got)
	}
}

func TestRollbackFromHeight(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 100, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "1", "seller": "s", "buyer": "b", "price": "100",
	}), "H100"))
	must(t, dispatchEvent(ctx, db, ev("Sale", "gno.land/r/x", 200, 0, 0, map[string]string{
		"via": "buy", "collection": "c", "tokenId": "2", "seller": "s", "buyer": "b", "price": "100",
	}), "H200"))

	must(t, rollbackFromHeight(ctx, db, 200))

	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block >= 200`); n != 0 {
		t.Errorf("sales >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_raw_events WHERE event_block >= 200`); n != 0 {
		t.Errorf("raw >= 200 after rollback = %d, want 0", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM nft_sales WHERE event_block < 200`); n != 1 {
		t.Errorf("sales < 200 = %d, want 1 (kept)", n)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/indexer/ -run 'TestConfirmedEnd|TestRollbackFromHeight' -v`
Expected: FAIL — `undefined: confirmedEnd` / `undefined: rollbackFromHeight`.

- [ ] **Step 3: Write the implementation** `internal/indexer/reorg.go`

```go
package indexer

import (
	"context"
	"database/sql"
)

// confirmedEnd returns the highest block height safe to process this cycle:
// bounded by the confirmed tip (latest - confirmations) and the per-cycle cap
// (cursor + maxPerCycle). Returns cursor (no work) when not past it.
func confirmedEnd(latest, confirmations, cursor, maxPerCycle int64) int64 {
	safeTip := latest - confirmations
	if safeTip < 0 {
		safeTip = 0
	}
	end := safeTip
	if end > cursor+maxPerCycle {
		end = cursor + maxPerCycle
	}
	if end < cursor {
		end = cursor
	}
	return end
}

// rollbackFromHeight deletes all indexed rows at or above height across the raw
// ledger and the event-keyed projections — reorg recovery. Aggregate tables
// (nft_collections totals) are rebuilt by replaying the kept raw ledger; callers
// re-tail from `height` after rollback.
func rollbackFromHeight(ctx context.Context, db *sql.DB, height int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range []string{
		`DELETE FROM nft_raw_events WHERE event_block >= ?`,
		`DELETE FROM nft_sales WHERE event_block >= ?`,
		`DELETE FROM nft_listings WHERE event_block >= ?`,
		`DELETE FROM nft_offers WHERE event_block >= ?`,
		`DELETE FROM nft_ownership_history WHERE block >= ?`,
	} {
		if _, err := tx.ExecContext(ctx, stmt, height); err != nil {
			return err
		}
	}
	return tx.Commit()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `go test ./internal/indexer/ -run 'TestConfirmedEnd|TestRollbackFromHeight' -v`
Expected: PASS.

- [ ] **Step 5: Wire into `tailer.go`** (then re-run the whole package)

In `tailOnce`: replace the `end := latest; if end > cursor+maxBlocksPerCycle {...}` block with `end := confirmedEnd(latest, cfg.Confirmations, cursor, maxBlocksPerCycle)` and `if end <= cursor { return }`. Add a `fetchBlockHash(ctx, client, rpcURL, h)` helper (GET `/block?height=h` → `result.block_id.hash`) and, before processing height `h`, compare it to the stored `block_hash` for `h-1`'s successor: if a stored hash exists for `h` and differs, call `rollbackFromHeight(ctx, db, h)` and reset the cursor to `h-1`. Pass the fetched hash into `dispatchEvent(ctx, db, ev, hash)` and persist it via `saveCursor` (extend `saveCursor` to also store `block_hash`). Add `Confirmations int64` to `TailerConfig` (default e.g. 5 when `<= 0`).

Run: `go test ./internal/indexer/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/indexer/reorg.go internal/indexer/reorg_test.go internal/indexer/tailer.go
git commit -m "nft indexer: confirmation depth + block-hash reorg rollback/replay"
```

---

### Task 7: Per-realm deploy-height cursor seeding (backfill)

**Files:**
- Modify: `internal/indexer/tailer.go` (add `SeedRealmCursor`)
- Test: `internal/indexer/tailer_test.go`

**Interfaces:**
- Produces: `func SeedRealmCursor(ctx context.Context, db *sql.DB, realm string, deployHeight int64) error` — sets a realm's `last_processed_block = deployHeight - 1` only if no row exists (so a new engine tails from its deploy height, not genesis, and an existing realm is never rewound).

- [ ] **Step 1: Write the failing test** in `internal/indexer/tailer_test.go`

```go
func TestSeedRealmCursor(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	const offers = "gno.land/r/samcrew/memba_nft_offers_v1"

	must(t, SeedRealmCursor(ctx, db, offers, 280000))
	got, err := loadCursor(ctx, db, []string{offers}, defaultStartBlock)
	must(t, err)
	if got != 279999 {
		t.Fatalf("seeded cursor = %d, want 279999 (deployHeight-1)", got)
	}
	// Idempotent: seeding again (e.g. after it has advanced) must NOT rewind.
	must(t, saveCursor(ctx, db, []string{offers}, 285000))
	must(t, SeedRealmCursor(ctx, db, offers, 280000))
	got, err = loadCursor(ctx, db, []string{offers}, defaultStartBlock)
	must(t, err)
	if got != 285000 {
		t.Fatalf("cursor after re-seed = %d, want 285000 (no rewind)", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/indexer/ -run TestSeedRealmCursor -v`
Expected: FAIL — `undefined: SeedRealmCursor`.

- [ ] **Step 3: Write the implementation** in `internal/indexer/tailer.go`

```go
// SeedRealmCursor records a realm's first-tail cursor at deployHeight-1 so a
// newly deployed engine is indexed from its deploy block (not genesis) without
// dragging the global min cursor backward. INSERT OR IGNORE: never rewinds a
// realm that has already advanced.
func SeedRealmCursor(ctx context.Context, db *sql.DB, realm string, deployHeight int64) error {
	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_indexer_state (realm_path, last_processed_block, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)`,
		realm, deployHeight-1,
	)
	return err
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `go test ./internal/indexer/ -run TestSeedRealmCursor -v` then `go test ./internal/indexer/ -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add internal/indexer/tailer.go internal/indexer/tailer_test.go
git commit -m "nft indexer: seed per-realm deploy-height cursor (backfill, no rewind)"
```

---

### Task 8: Frozen points-formula invariants doc (irreversible policy)

**Files:**
- Create: `docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md`

This task has no code; it ratifies the irreversible decisions BEFORE the recompute harness encodes them. It is a reviewer gate.

- [ ] **Step 1: Write the policy doc** `docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md`

```markdown
# NFT Points — Frozen Formula Invariants (v1)

_Status: FROZEN 2026-06-17. These are declared irreversible in NFT_MARKETPLACE_PHASE3_PLUS_PLAN.md §5.5. Coefficients may stay private; these INVARIANTS may not change once accrual begins. formulaVersion = "1"._

1. **Royalty-weighted volume.** Points volume for a sale = realized royalty rate × price-derived base, NOT nominal price. A sale whose `royalty == 0` (RoyaltyInfo returned 0 — many collections) contributes ~0 points. Rationale: enforced royalty is the only on-chain wash-tax; rewarding nominal volume makes the marketplace a profitable wash-farming venue subsidized by the points program.
2. **Maker/taker via→role mapping.** `via="buy"` → maker = seller (lister), taker = buyer. `via="offer"` (v3 per-token AND offers_v1 floor) → maker = buyer (offerer), taker = seller (accepter). `via="auction"` / `via="sweep"` roles are defined when those engines ship (append-only). pkg_path scopes attribution; the role rule is uniform per `via`.
3. **Denom normalization unit = ugnot.** Only ugnot exists today; a versioned denom→ugnot rate policy is frozen now so Phase-4 GRC20 volume is recomputable.
4. **Accrual start-block.** `accrual_start_block` = the v3 deploy block (seq-43/44 deploy height on test13). The v3 `Sale` gap (events emitted before the Task-3 handler shipped) is backfilled into the raw ledger from chain before accrual is declared authoritative.
5. **Self/cluster exclusion.** `buyer == seller` excluded on-chain; cluster wash excluded off-chain using the engine's offer-age signal (`OfferAccepted.offerCreatedBlk`) + per-wallet/recipient graph heuristics. Coefficients private.
6. **Per-wallet caps + reputation multipliers** apply; **terms are non-binding, subject to clawback, with no guaranteed conversion** to $MEMBA. This is published wherever points are surfaced.
7. **Recompute determinism.** points = pure function of (raw ledger up to the confirmed `indexed_through` watermark, formulaVersion). Same input → byte-identical output.
```

- [ ] **Step 2: Commit**

```bash
git add docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md
git commit -m "nft points: freeze v1 formula invariants (royalty-weighted, maker/taker, accrual)"
```

---

### Task 9: Deterministic points recompute harness

**Files:**
- Create: `internal/points/points.go`
- Test: `internal/points/points_test.go`

**Interfaces:**
- Produces:
  - `type SaleEvent struct { Via, Collection, TokenID, Seller, Buyer string; Price, Royalty int64; Block int64 }`
  - `func LoadConfirmedSales(ctx context.Context, db *sql.DB, indexedThrough int64) ([]SaleEvent, error)` — reads `Sale` rows from the raw ledger up to the watermark, ordered deterministically by `(event_block, event_tx_index, event_index)`.
  - `func Recompute(sales []SaleEvent, formulaVersion string) map[string]int64` — pure; royalty-weighted volume; maker/taker per the frozen mapping; excludes `buyer == seller`.

- [ ] **Step 1: Write the failing tests** `internal/points/points_test.go`

```go
package points

import "testing"

func TestRecompute_RoyaltyWeighted_DeterministicAndExcludesWash(t *testing.T) {
	sales := []SaleEvent{
		// via=buy: maker=seller, taker=buyer; royalty 50000 → counts.
		{Via: "buy", Collection: "c", TokenID: "1", Seller: "g1s", Buyer: "g1b", Price: 1000000, Royalty: 50000, Block: 100},
		// zero-royalty sale → contributes ~0 points (anti-wash invariant #1).
		{Via: "buy", Collection: "c", TokenID: "2", Seller: "g1s", Buyer: "g1b2", Price: 1000000, Royalty: 0, Block: 101},
		// self-deal (buyer == seller) → excluded entirely (invariant #5).
		{Via: "buy", Collection: "c", TokenID: "3", Seller: "g1w", Buyer: "g1w", Price: 1000000, Royalty: 50000, Block: 102},
	}
	a := Recompute(sales, "1")
	b := Recompute(sales, "1")
	if len(a) != len(b) {
		t.Fatalf("non-deterministic size: %d vs %d", len(a), len(b))
	}
	for k, v := range a {
		if b[k] != v {
			t.Fatalf("non-deterministic value for %q: %d vs %d", k, v, b[k])
		}
	}
	if _, ok := a["g1w"]; ok {
		t.Errorf("self-dealer g1w earned points; must be excluded")
	}
	// Zero-royalty sale earns ~0: g1b2's taker points come only from sale #2 (royalty 0).
	if a["g1b2"] != 0 {
		t.Errorf("zero-royalty taker earned %d, want 0 (royalty-weighted)", a["g1b2"])
	}
	// Royalty-bearing sale credited both maker and taker.
	if a["g1s"] == 0 || a["g1b"] == 0 {
		t.Errorf("royalty-bearing maker/taker earned 0: g1s=%d g1b=%d", a["g1s"], a["g1b"])
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/points/ -v`
Expected: FAIL — `undefined: SaleEvent` / `undefined: Recompute` (package doesn't compile).

- [ ] **Step 3: Write the implementation** `internal/points/points.go`

```go
// Package points recomputes trading-reward points as a pure, deterministic
// function of the raw event ledger + a frozen formula version. See
// docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md. Coefficients here are the
// public, non-binding v1 weights; they may be tuned, the INVARIANTS may not.
package points

import (
	"context"
	"database/sql"
	"encoding/json"
)

type SaleEvent struct {
	Via, Collection, TokenID, Seller, Buyer string
	Price, Royalty                          int64
	Block                                   int64
}

// roles returns (maker, taker) per the frozen via→role mapping (invariant #2).
func roles(s SaleEvent) (maker, taker string) {
	switch s.Via {
	case "offer":
		return s.Buyer, s.Seller // offerer makes, accepter takes
	default: // "buy" (and future "auction"/"sweep" until defined)
		return s.Seller, s.Buyer // lister makes, buyer takes
	}
}

// Recompute is the deterministic points function. Volume is royalty-weighted
// (invariant #1): a sale contributes its royalty amount as the points base, so
// zero-royalty sales contribute zero. buyer==seller self-deals are excluded
// (invariant #5). Iteration order does not affect the result (pure summation).
func Recompute(sales []SaleEvent, formulaVersion string) map[string]int64 {
	out := map[string]int64{}
	for _, s := range sales {
		if s.Buyer == s.Seller {
			continue // self-deal excluded
		}
		base := s.Royalty // royalty-weighted: zero royalty → zero points
		if base <= 0 {
			continue
		}
		maker, taker := roles(s)
		out[maker] += base
		out[taker] += base
	}
	return out
}

// LoadConfirmedSales reads Sale events from the raw ledger up to the confirmed
// watermark, deterministically ordered, for the recompute harness.
func LoadConfirmedSales(ctx context.Context, db *sql.DB, indexedThrough int64) ([]SaleEvent, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT attrs_json, event_block FROM nft_raw_events
		WHERE event_name = 'Sale' AND event_block <= ?
		ORDER BY event_block, event_tx_index, event_index`, indexedThrough)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []SaleEvent
	for rows.Next() {
		var attrs string
		var block int64
		if err := rows.Scan(&attrs, &block); err != nil {
			return nil, err
		}
		var m map[string]string
		if err := json.Unmarshal([]byte(attrs), &m); err != nil {
			return nil, err
		}
		out = append(out, SaleEvent{
			Via: m["via"], Collection: m["collection"], TokenID: m["tokenId"],
			Seller: m["seller"], Buyer: m["buyer"],
			Price: atoi64(m["price"]), Royalty: atoi64(m["royalty"]), Block: block,
		})
	}
	return out, rows.Err()
}
```

Add `atoi64` (mirror `atoiSafe`):

```go
import "strconv"

func atoi64(s string) int64 {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return v
}
```

(Place the `strconv` import with the others.)

- [ ] **Step 4: Run to verify it passes**

Run: `go test ./internal/points/ -v`
Expected: PASS.

- [ ] **Step 5: Add a LoadConfirmedSales integration test** that ingests two `Sale` events via the indexer, then loads them:

```go
// internal/points/load_test.go
package points

import (
	"context"
	"testing"

	"github.com/.../internal/db"      // use the module path from go.mod
	"github.com/.../internal/indexer" // ditto
)
// NOTE: replace import paths with the real module path from backend/go.mod.

func TestLoadConfirmedSales_RespectsWatermark(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil { t.Fatal(err) }
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil { t.Fatal(err) }
	ctx := context.Background()

	// Two Sale events at heights 100 and 300.
	for _, h := range []int64{100, 300} {
		_, _ = database.ExecContext(ctx, `INSERT INTO nft_raw_events
			(event_block,event_tx_index,event_index,pkg_path,event_name,schema_version,attrs_json,ingest_ts)
			VALUES (?,0,0,'gno.land/r/x','Sale','1',?,CURRENT_TIMESTAMP)`,
			h, `{"via":"buy","seller":"s","buyer":"b","price":"100","royalty":"10"}`)
	}
	// Watermark at 200 → only the height-100 sale is confirmed.
	got, err := LoadConfirmedSales(ctx, database, 200)
	if err != nil { t.Fatal(err) }
	if len(got) != 1 || got[0].Block != 100 {
		t.Fatalf("loaded %d sales, want 1 at block 100", len(got))
	}
	_ = indexer.GnoEvent{} // ensure indexer import resolves; remove if unused
}
```

Run: `go test ./internal/points/ -v`
Expected: PASS. (Fix the import path to match `backend/go.mod`'s module path; drop the `indexer` import if it triggers an unused error.)

- [ ] **Step 6: Commit**

```bash
git add internal/points/
git commit -m "nft points: deterministic royalty-weighted recompute harness from raw ledger"
```

---

### Task 10: Config + wiring (`NFT_CONFIRMATIONS`)

**Files:**
- Modify: `cmd/memba/main.go` (the `StartNFTTailer(ctx, database, indexer.TailerConfig{...})` call at ~lines 113–137, which already uses `int64Or`/`durationOr`/`envOr` helpers)
- Modify: `.env.example`
- Test: `internal/indexer/tailer_test.go` (assert the `StartNFTTailer` confirmations default guard from Task 6, which is the unit-testable seam; `int64Or` lives in `package main` and is exercised by the wiring, not unit-tested in isolation)

**Interfaces:**
- Consumes: `TailerConfig.Confirmations int64` (added in Task 6, with a `<= 0 → default 5` guard inside `StartNFTTailer`).
- Produces: `NFT_CONFIRMATIONS` env flows into `TailerConfig.Confirmations` via the existing `int64Or` helper.

- [ ] **Step 1: Write the failing test** in `internal/indexer/tailer_test.go` — verify the default guard (the seam the env feeds):

```go
func TestConfirmedEnd_DefaultDepth(t *testing.T) {
	// StartNFTTailer applies Confirmations<=0 → 5. Here we assert the arithmetic
	// the env value drives: with depth 5, latest=1000 yields a safe tip of 995.
	if got := confirmedEnd(1000, 5, 990, 500); got != 995 {
		t.Fatalf("confirmedEnd with default depth = %d, want 995", got)
	}
}
```

(This is a guard test; the env parse itself uses the existing, already-tested `int64Or`.)

- [ ] **Step 2: Run to verify it passes** (it should — `confirmedEnd` exists from Task 6)

Run: `go test ./internal/indexer/ -run TestConfirmedEnd_DefaultDepth -v`
Expected: PASS. (No new production code for this step — it documents the contract.)

- [ ] **Step 3: Wire the env at the call site** in `cmd/memba/main.go`

Add `Confirmations` to the existing `TailerConfig` literal (mirroring how `StartBlock: int64Or("NFT_START_BLOCK", 260000)` is set):

```go
	indexer.StartNFTTailer(ctx, database, indexer.TailerConfig{
		RPCURL:        nftRPCURL,
		WatchedRealms: splitOrigins(envOr("NFT_WATCHED_REALMS", marketRealm+","+collectionRealm)),
		StartBlock:    int64Or("NFT_START_BLOCK", 260000),
		Confirmations: int64Or("NFT_CONFIRMATIONS", 5),
		Interval:      durationOr("NFT_TAILER_INTERVAL", 3*time.Second),
		Logger:        logger,
	})
```

Add to `.env.example`:

```
# Blocks to stay behind the chain tip for reorg-safety (default 5).
NFT_CONFIRMATIONS=5
```

- [ ] **Step 4: Verify it builds + the suite passes**

Run: `go build ./... && go test ./internal/indexer/ -v`
Expected: builds clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/memba/main.go .env.example
git commit -m "nft indexer: wire NFT_CONFIRMATIONS env for reorg-safety depth"
```

---

### Task 11: Full-suite gate + backfill-the-v3-gap runbook note

**Files:**
- Modify: `docs/planning/NFT_PHASE0_DATA_FOUNDATION_DESIGN.md` (append a short "v3 Sale-gap backfill" operator note)

- [ ] **Step 1: Run the whole backend test suite + vet + build**

```bash
go build ./... && go vet ./... && go test ./...
```
Expected: all PASS / no vet errors. (This is the gate that the Semgrep hook must be off for.)

- [ ] **Step 2: Append the operator runbook note** to the design doc

```markdown
## 11. v3 Sale-gap backfill (operator step, before declaring accrual authoritative)
The Task-3 `Sale` handler shipped after v3 was already live, so v3 `Sale` events
between the v3 deploy block and the handler-deploy block were never ingested. To
close the gap: set `NFT_START_BLOCK` (or seed the v3 realm cursor via
`SeedRealmCursor`) to the v3 deploy height and let the tailer re-scan — writes are
idempotent, so already-ingested rows are no-ops and the gap fills. Confirm
`SELECT COUNT(*) FROM nft_raw_events WHERE event_name='Sale'` is non-zero and the
recompute harness reads them before flipping `accrual_start_block` to authoritative.
```

- [ ] **Step 3: Commit**

```bash
git add docs/planning/NFT_PHASE0_DATA_FOUNDATION_DESIGN.md
git commit -m "nft phase-0: document v3 Sale-gap backfill operator step"
```

---

## Self-Review

**Spec coverage** (against `NFT_PHASE0_DATA_FOUNDATION_DESIGN.md`):
- §3.1 raw ledger → Tasks 1, 2, 5 ✓
- §3.2 Sale handler (live-bug fix) → Task 3 ✓
- §3.3 pkg_path/schemaVersion persistence → Tasks 1, 4 ✓
- §3.4 reorg-safety (confirmation depth, block-hash, delete/replay, watermark) → Task 6 (+ `indexed_through` consumed by Task 9's `LoadConfirmedSales`) ✓
- §3.5 backfill-from-deploy-height → Task 7 (+ runbook Task 11) ✓
- §3.6 recompute harness → Task 9 ✓
- §4 frozen invariants → Task 8 ✓
- §5 migrations → Task 1 ✓
- §6 testing → every task is TDD ✓

**Known gaps / follow-ups (call out, not silently dropped):**
- The reorg block-hash comparison in Task 6 Step 5 is wired into the live tailer loop but its full HTTP-integration test (a stubbed node serving two different hashes for the same height) is deferred to execution — the pure helpers (`confirmedEnd`, `rollbackFromHeight`) are unit-tested; the loop wiring is verified by the existing tailer tests + manual/integration run. Flag if the executor wants an httptest server added.
- `indexed_through` watermark is represented by the confirmed cursor (`latest - confirmations`); Task 9 reads a caller-supplied `indexedThrough`. Wiring the harness to read the live cursor value is a thin follow-up (a `CurrentWatermark(db)` query) — add when the points API/CLI surface is built (out of Phase-0 scope; that's the engine/frontend phase).
- Floor-offer-specific dispatch (resolve `OfferMade`/`Sale` for `memba_nft_offers_v1` by `(collection, buyer, pkg_path)` ignoring `tokenId`) lands WITH the engine, not here — Phase-0 only makes the columns + Sale handler + raw ledger exist.

**Placeholder scan:** none — every code step has complete code; the one import-path placeholder (Task 9 Step 5) is explicitly flagged to resolve against `backend/go.mod`.

**Type consistency:** `dispatchEvent(ctx, db, ev, blockHash)` signature change (Task 5) is propagated to all callers (tailer + tests); `TailerConfig.Confirmations` (Task 6) consumed by Task 10; `SaleEvent`/`Recompute`/`roles`/`LoadConfirmedSales` names consistent across Task 9.
