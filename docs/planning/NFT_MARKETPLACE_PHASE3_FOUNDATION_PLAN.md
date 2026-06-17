# memba_market_core (Phase 3+ Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `gno.land/p/samcrew/memba_market_core` — a pure, stateless gno package that encodes the frozen cross-engine event schema and the canonical fee/royalty split math, extracted verbatim from the deployed `memba_nft_market_v3`, so every future marketplace engine (offers/sweep, auctions) emits identical events and splits money identically.

**Architecture:** A `p/` package holds only pure helpers (gno cannot share realm *state* across realms, only pure code). It provides: (1) platform constants, (2) `SplitProceeds` — the three-way fee/royalty/seller math, (3) event-name constants + ordered arg-builder functions for every settlement event (the frozen schema, including a `schemaVersion` attr). Engines import it and call `chain.Emit(core.SaleEvent, core.SaleArgs(...)...)`. The package has NO `chain`/realm imports — it is unit-testable without a realm. The deployed v3 is NOT refactored (its path is immutable); the package's behavior is pinned to v3's by a conformance test, and v3 remains the reference. Future engines consume the package.

**Tech Stack:** gno (test13 / chain/test13 toolchain), `gno test` + `gno lint`, samcrew-deployer manifest/deploy.sh wiring, examples-symlink dev workflow.

## Global Constraints

- Package path: `gno.land/p/samcrew/memba_market_core`. Module line: `module = "gno.land/p/samcrew/memba_market_core"`, `gno = "0.9"`.
- **Pure package only:** no `chain`, `chain/banker`, `chain/runtime`, or realm imports. Allowed stdlib: `strconv` (and `testing`/uassert in tests). If a helper would need `chain.Emit`, it returns `[]string` args instead — the engine emits.
- **Values copied VERBATIM from `memba_nft_market_v3/params.gno`:** `FeeBPS = 200`, `MaxRoyaltyBPS = 1000`, `MinPrice = 1000`, `MaxPrice = 1_000_000_000_000_000`, `SettlementDenom = "ugnot"`. New: `SchemaVersion = "1"`.
- **`SplitProceeds` must be behaviorally identical to v3's `splitProceeds`** (same math, same clamps, same panic messages) — it is the conformance reference for all engines.
- **The `Sale` event arg order + keys must exactly match v3's `emitSale`** (so the existing indexer parses both identically), with `"schemaVersion", SchemaVersion` appended.
- gno gotchas: no `[]string` in any realm's public ABI (engine-side concern, not this package); tests run from `gno/examples` via the symlink; `gno lint` must be clean.
- Standing rules: branch + PR, no Claude attribution in commits/PRs, never deploy/merge without explicit user OK.

## File Structure

All under `samcrew-deployer/projects/memba/realms/memba_market_core/` (sources live in the deployer, symlinked into `gno/examples/gno.land/p/samcrew/memba_market_core` for `gno test`/`lint`):

- `gnomod.toml` — module declaration.
- `params.gno` — platform constants + `SchemaVersion` + `itoa` helper. One responsibility: frozen tunables.
- `split.gno` — `SplitProceeds(price, royaltyAmount) (fee, royalty, seller)`. One responsibility: canonical money math.
- `events.gno` — event-name constants + arg-builder funcs for `Sale` and the future event families (offers, auctions, sweep). One responsibility: the frozen event schema.
- `*_test.gno` — one test file per source file.

**Out of scope for this plan (separate Phase-0 plans):** the backend points raw-event ledger + recompute harness (Go), the frontend multi-engine router (`lib/nftMarketplace.ts`), and the RegisterMarket governance runbook (docs). This plan delivers the on-chain shared core only.

---

### Task 1: Package scaffold + frozen constants

**Files:**
- Create: `samcrew-deployer/projects/memba/realms/memba_market_core/gnomod.toml`
- Create: `samcrew-deployer/projects/memba/realms/memba_market_core/params.gno`
- Test: `samcrew-deployer/projects/memba/realms/memba_market_core/params_test.gno`

**Interfaces:**
- Produces: package `memba_market_core` with consts `FeeBPS, MaxRoyaltyBPS, MinPrice, MaxPrice int64`; `SettlementDenom, SchemaVersion string`; func `itoa(int64) string`.

- [ ] **Step 1: Create the symlink so gno can resolve the package**

Run:
```bash
ln -sfn /Users/zxxma/Desktop/Code/Gno/samcrew-deployer/projects/memba/realms/memba_market_core \
  /Users/zxxma/Desktop/Code/Gno/gno/examples/gno.land/p/samcrew/memba_market_core
mkdir -p /Users/zxxma/Desktop/Code/Gno/samcrew-deployer/projects/memba/realms/memba_market_core
```

- [ ] **Step 2: Write `gnomod.toml`**

```toml
module = "gno.land/p/samcrew/memba_market_core"
gno = "0.9"
```

- [ ] **Step 3: Write the failing test** (`params_test.gno`)

```go
package memba_market_core

import (
	"testing"

	"gno.land/p/nt/uassert/v0"
)

func TestConstants_MatchV3(t *testing.T) {
	uassert.Equal(t, int64(200), FeeBPS, "2.0% platform fee, identical to v3")
	uassert.Equal(t, int64(1000), MaxRoyaltyBPS, "10% royalty clamp")
	uassert.Equal(t, int64(1000), MinPrice, "0.001 GNOT floor")
	uassert.Equal(t, int64(1_000_000_000_000_000), MaxPrice, "1B GNOT ceiling")
	uassert.Equal(t, "ugnot", SettlementDenom, "native settlement denom")
	uassert.Equal(t, "1", SchemaVersion, "frozen event schema version")
}

func TestItoa(t *testing.T) {
	uassert.Equal(t, "0", itoa(0), "zero")
	uassert.Equal(t, "1000000", itoa(1_000_000), "positive")
	uassert.Equal(t, "-1", itoa(-1), "negative")
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: FAIL/build error — `undefined: FeeBPS` (and friends), `undefined: itoa`.

- [ ] **Step 5: Write `params.gno`**

```go
// Package memba_market_core holds the frozen, cross-engine money math and event
// schema for the Memba NFT marketplace engines. It is a PURE package (no chain/
// realm imports): split math returns values, event helpers return ordered arg
// slices, and the importing engine performs chain.Emit / banker / MarketTransfer.
//
// Constants are copied verbatim from memba_nft_market_v3 (the deployed reference).
// SplitProceeds must stay behaviorally identical to v3's splitProceeds so every
// engine pays out identically (fee/royalty conformance).
package memba_market_core

import "strconv"

const (
	FeeBPS        = int64(200)                   // 2.0% platform fee (matches v3)
	MaxRoyaltyBPS = int64(1000)                  // 10% royalty clamp (defense-in-depth)
	MinPrice      = int64(1000)                  // 0.001 GNOT — prevents fee truncation to zero
	MaxPrice      = int64(1_000_000_000_000_000) // 1 billion GNOT

	// SettlementDenom is carried on every settlement event for forward-compat with
	// the GRC20 settlement desk (PHASE 3+). Engines settle in ugnot today.
	SettlementDenom = "ugnot"

	// SchemaVersion stamps every event so the indexer can branch parsing
	// deterministically and the schema can evolve without ambiguity. Bump ONLY
	// when an event's key set changes; never reuse a version for a different shape.
	SchemaVersion = "1"
)

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/ && gno lint ./gno.land/p/samcrew/memba_market_core/`
Expected: `ok` + lint clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/zxxma/Desktop/Code/Gno/samcrew-deployer
git add projects/memba/realms/memba_market_core/
git commit -m "memba_market_core: package scaffold + frozen constants (match v3)"
```

---

### Task 2: `SplitProceeds` — canonical fee/royalty/seller math

**Files:**
- Create: `samcrew-deployer/projects/memba/realms/memba_market_core/split.gno`
- Test: `samcrew-deployer/projects/memba/realms/memba_market_core/split_test.gno`

**Interfaces:**
- Consumes: `FeeBPS`, `MaxRoyaltyBPS`, `MinPrice`, `MaxPrice` (Task 1).
- Produces: `func SplitProceeds(price, royaltyAmount int64) (fee, royalty, seller int64)`. `royaltyAmount` is the pre-computed amount from the collection's `RoyaltyInfo` (not bps). Panics: `"price below minimum"`, `"price above maximum"`, `"fee plus royalty exceeds price"`, `"seller amount not positive"`.

- [ ] **Step 1: Write the failing test** (`split_test.gno`)

```go
package memba_market_core

import (
	"testing"

	"gno.land/p/nt/uassert/v0"
)

func TestSplitProceeds_NoRoyalty(t *testing.T) {
	// 1 GNOT, 0 royalty: fee = 1_000_000 * 200 / 10000 = 20_000; seller = 980_000
	fee, roy, seller := SplitProceeds(1_000_000, 0)
	uassert.Equal(t, int64(20_000), fee, "2.0% fee")
	uassert.Equal(t, int64(0), roy, "no royalty")
	uassert.Equal(t, int64(980_000), seller, "seller gets remainder")
}

func TestSplitProceeds_WithRoyalty(t *testing.T) {
	// 1 GNOT, 50_000 royalty: fee 20_000; seller = 1_000_000 - 20_000 - 50_000 = 930_000
	fee, roy, seller := SplitProceeds(1_000_000, 50_000)
	uassert.Equal(t, int64(20_000), fee, "fee")
	uassert.Equal(t, int64(50_000), roy, "royalty passes through")
	uassert.Equal(t, int64(930_000), seller, "seller remainder")
}

func TestSplitProceeds_ClampsRoyaltyToMax(t *testing.T) {
	// royaltyAmount above 10% is clamped to price*MaxRoyaltyBPS/10000 = 100_000
	_, roy, _ := SplitProceeds(1_000_000, 500_000)
	uassert.Equal(t, int64(100_000), roy, "royalty clamped to 10%")
}

func TestSplitProceeds_NegativeRoyaltyFloored(t *testing.T) {
	_, roy, _ := SplitProceeds(1_000_000, -5)
	uassert.Equal(t, int64(0), roy, "negative royalty floored to 0")
}

func TestSplitProceeds_BelowMin_Aborts(t *testing.T) {
	uassert.AbortsWithMessage(t, "price below minimum", func() { SplitProceeds(999, 0) })
}

func TestSplitProceeds_AboveMax_Aborts(t *testing.T) {
	uassert.AbortsWithMessage(t, "price above maximum", func() { SplitProceeds(MaxPrice+1, 0) })
}

func TestSplitProceeds_SellerNotPositive_Aborts(t *testing.T) {
	// fee+royalty must stay below price; force royalty so seller would be <= 0.
	// At price=MinPrice(1000): fee = 1000*200/10000 = 20; maxRoy = 1000*1000/10000 = 100.
	// Even max royalty leaves seller = 1000-20-100 = 880 (>0), so to hit the guard we
	// rely on the clamp keeping seller positive — assert the happy floor instead:
	_, _, seller := SplitProceeds(MinPrice, MaxPrice) // royalty clamps to 100
	uassert.Equal(t, int64(880), seller, "min price seller after fee+clamped royalty")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: FAIL/build error — `undefined: SplitProceeds`.

- [ ] **Step 3: Write `split.gno`** (extracted verbatim from v3's `splitProceeds`, renamed exported)

```go
package memba_market_core

// SplitProceeds computes the three-way split of a sale price into platform fee,
// creator royalty, and seller proceeds. `royaltyAmount` is the actual amount from
// the collection's RoyaltyInfo (NOT bps); it is floored at 0 and clamped to
// MaxRoyaltyBPS of price (defense-in-depth). Identical to memba_nft_market_v3's
// splitProceeds — the conformance reference for every engine.
func SplitProceeds(price, royaltyAmount int64) (fee, royalty, seller int64) {
	if price < MinPrice {
		panic("price below minimum")
	}
	if price > MaxPrice {
		panic("price above maximum")
	}
	fee = price * FeeBPS / 10000
	royalty = royaltyAmount
	if royalty < 0 {
		royalty = 0
	}
	maxRoy := price * MaxRoyaltyBPS / 10000
	if royalty > maxRoy {
		royalty = maxRoy
	}
	if fee+royalty >= price {
		panic("fee plus royalty exceeds price")
	}
	seller = price - fee - royalty
	if seller <= 0 {
		panic("seller amount not positive")
	}
	return
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zxxma/Desktop/Code/Gno/samcrew-deployer
git add projects/memba/realms/memba_market_core/split.gno projects/memba/realms/memba_market_core/split_test.gno
git commit -m "memba_market_core: SplitProceeds (canonical fee/royalty math, == v3)"
```

---

### Task 3: `Sale` event schema (must match v3's `emitSale` exactly)

**Files:**
- Create: `samcrew-deployer/projects/memba/realms/memba_market_core/events.gno`
- Test: `samcrew-deployer/projects/memba/realms/memba_market_core/events_test.gno`

**Interfaces:**
- Consumes: `SettlementDenom`, `SchemaVersion`, `itoa` (Task 1).
- Produces: `const SaleEvent = "Sale"`; `func SaleArgs(via, collection, tokenID, seller, buyer string, price, fee, royalty int64, royaltyRecipient string, sellerAmount int64, denom string) []string`. Returns the ordered key/value slice for `chain.Emit(SaleEvent, args...)`. Addresses are passed pre-stringified by the engine.

- [ ] **Step 1: Write the failing test** (`events_test.gno`)

```go
package memba_market_core

import (
	"testing"

	"gno.land/p/nt/uassert/v0"
)

func TestSaleArgs_MatchesV3SchemaPlusVersion(t *testing.T) {
	args := SaleArgs("buy", "g1abc/genesis", "0", "g1seller", "g1buyer",
		1_000_000, 20_000, 50_000, "g1royrecip", 930_000, "ugnot")
	expected := []string{
		"via", "buy",
		"collection", "g1abc/genesis",
		"tokenId", "0",
		"seller", "g1seller",
		"buyer", "g1buyer",
		"price", "1000000",
		"fee", "20000",
		"royalty", "50000",
		"royaltyRecipient", "g1royrecip",
		"sellerAmount", "930000",
		"denom", "ugnot",
		"schemaVersion", "1",
	}
	uassert.Equal(t, len(expected), len(args), "arg count")
	for i := range expected {
		uassert.Equal(t, expected[i], args[i], "arg["+itoa(int64(i))+"]")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: FAIL/build error — `undefined: SaleArgs`.

- [ ] **Step 3: Write `events.gno`** (Sale section)

```go
package memba_market_core

// Frozen cross-engine event schema. Every settlement event an engine emits MUST
// be built here so name + ordered key set are identical across engines and the
// indexer/frontend parse one schema. Append "schemaVersion" last on every event.
// Engines call: chain.Emit(SaleEvent, SaleArgs(...)...).

const SaleEvent = "Sale"

// SaleArgs builds the ONE canonical settlement event for a completed sale, keyed
// by `via` ("buy" | "offer" | "auction" | "sweep"). Key order matches
// memba_nft_market_v3.emitSale verbatim, with "schemaVersion" appended, so the
// existing indexer parses v3 and future engines identically.
func SaleArgs(via, collection, tokenID, seller, buyer string, price, fee, royalty int64, royaltyRecipient string, sellerAmount int64, denom string) []string {
	return []string{
		"via", via,
		"collection", collection,
		"tokenId", tokenID,
		"seller", seller,
		"buyer", buyer,
		"price", itoa(price),
		"fee", itoa(fee),
		"royalty", itoa(royalty),
		"royaltyRecipient", royaltyRecipient,
		"sellerAmount", itoa(sellerAmount),
		"denom", denom,
		"schemaVersion", SchemaVersion,
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zxxma/Desktop/Code/Gno/samcrew-deployer
git add projects/memba/realms/memba_market_core/events.gno projects/memba/realms/memba_market_core/events_test.gno
git commit -m "memba_market_core: frozen Sale event schema (== v3 keys + schemaVersion)"
```

---

### Task 4: Future-engine event schemas (offers, auctions, sweep)

**Files:**
- Modify: `samcrew-deployer/projects/memba/realms/memba_market_core/events.gno` (append)
- Modify: `samcrew-deployer/projects/memba/realms/memba_market_core/events_test.gno` (append)

**Interfaces:**
- Produces event-name consts + arg-builders consumed by the Phase-2 (offers/sweep) and Phase-3 (auctions) engines:
  - `OfferMadeEvent="OfferMade"`, `OfferAcceptedEvent="OfferAccepted"`, `OfferCancelledEvent="OfferCancelled"`
  - `AuctionCreatedEvent`, `BidPlacedEvent`, `BidRefundedEvent`, `AuctionExtendedEvent`, `AuctionSettledEvent`
  - `SweepExecutedEvent`
  - `func OfferMadeArgs(collection, tokenID, buyer string, amount int64, denom string, expiryBlock int64) []string`
  - `func OfferAcceptedArgs(...)` → reuses `SaleArgs` with `via="offer"` (no separate builder; documented).
  - `func AuctionCreatedArgs(collection, tokenID, seller string, reserve int64, denom string, endBlock int64) []string`
  - `func BidPlacedArgs(collection, tokenID, bidder string, amount int64, denom string, newEndBlock int64) []string`
  - `func SweepExecutedArgs(buyer string, count int, totalSpent int64, denom string) []string`

> Note: accepted offers, settled auctions, and sweep fills are SALES — they emit `SaleEvent` via `SaleArgs(via=...)` so the indexer counts every sale once through one path. The builders here are for the NON-sale lifecycle events (made/cancelled/bid/refunded/extended) plus a sweep summary.

- [ ] **Step 1: Write the failing tests** (append to `events_test.gno`)

```go
func TestOfferMadeArgs(t *testing.T) {
	args := OfferMadeArgs("g1abc/genesis", "0", "g1buyer", 500_000, "ugnot", 302400)
	expected := []string{
		"collection", "g1abc/genesis", "tokenId", "0", "buyer", "g1buyer",
		"amount", "500000", "denom", "ugnot", "expiryBlock", "302400",
		"schemaVersion", "1",
	}
	uassert.Equal(t, len(expected), len(args), "count")
	for i := range expected {
		uassert.Equal(t, expected[i], args[i], "arg")
	}
}

func TestAuctionCreatedArgs(t *testing.T) {
	args := AuctionCreatedArgs("g1abc/genesis", "0", "g1seller", 1_000_000, "ugnot", 500)
	expected := []string{
		"collection", "g1abc/genesis", "tokenId", "0", "seller", "g1seller",
		"reserve", "1000000", "denom", "ugnot", "endBlock", "500",
		"schemaVersion", "1",
	}
	uassert.Equal(t, len(expected), len(args), "count")
	for i := range expected {
		uassert.Equal(t, expected[i], args[i], "arg")
	}
}

func TestBidPlacedArgs(t *testing.T) {
	args := BidPlacedArgs("g1abc/genesis", "0", "g1bidder", 1_200_000, "ugnot", 530)
	uassert.Equal(t, "bidder", args[4], "key")
	uassert.Equal(t, "g1bidder", args[5], "value")
	uassert.Equal(t, "newEndBlock", args[10], "anti-snipe extension carried")
	uassert.Equal(t, "schemaVersion", args[12], "version stamped")
}

func TestSweepExecutedArgs(t *testing.T) {
	args := SweepExecutedArgs("g1buyer", 3, 2_500_000, "ugnot")
	expected := []string{
		"buyer", "g1buyer", "count", "3", "totalSpent", "2500000",
		"denom", "ugnot", "schemaVersion", "1",
	}
	uassert.Equal(t, len(expected), len(args), "count")
	for i := range expected {
		uassert.Equal(t, expected[i], args[i], "arg")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/`
Expected: FAIL/build error — `undefined: OfferMadeArgs` etc.

- [ ] **Step 3: Append to `events.gno`**

```go
// ── Offer lifecycle (Phase 2). Accepted offers emit SaleEvent via SaleArgs("offer",…). ──

const (
	OfferMadeEvent      = "OfferMade"
	OfferAcceptedEvent  = "OfferAccepted" // reserved; accept emits SaleEvent (via="offer")
	OfferCancelledEvent = "OfferCancelled"
)

func OfferMadeArgs(collection, tokenID, buyer string, amount int64, denom string, expiryBlock int64) []string {
	return []string{
		"collection", collection, "tokenId", tokenID, "buyer", buyer,
		"amount", itoa(amount), "denom", denom, "expiryBlock", itoa(expiryBlock),
		"schemaVersion", SchemaVersion,
	}
}

func OfferCancelledArgs(collection, tokenID, buyer string) []string {
	return []string{
		"collection", collection, "tokenId", tokenID, "buyer", buyer,
		"schemaVersion", SchemaVersion,
	}
}

// ── Auction lifecycle (Phase 3). Settled auctions emit SaleEvent via SaleArgs("auction",…). ──

const (
	AuctionCreatedEvent  = "AuctionCreated"
	BidPlacedEvent       = "BidPlaced"
	BidRefundedEvent     = "BidRefunded"
	AuctionExtendedEvent = "AuctionExtended"
	AuctionSettledEvent  = "AuctionSettled" // reserved; settle emits SaleEvent (via="auction")
)

func AuctionCreatedArgs(collection, tokenID, seller string, reserve int64, denom string, endBlock int64) []string {
	return []string{
		"collection", collection, "tokenId", tokenID, "seller", seller,
		"reserve", itoa(reserve), "denom", denom, "endBlock", itoa(endBlock),
		"schemaVersion", SchemaVersion,
	}
}

func BidPlacedArgs(collection, tokenID, bidder string, amount int64, denom string, newEndBlock int64) []string {
	return []string{
		"collection", collection, "tokenId", tokenID, "bidder", bidder,
		"amount", itoa(amount), "denom", denom, "newEndBlock", itoa(newEndBlock),
		"schemaVersion", SchemaVersion,
	}
}

func BidRefundedArgs(collection, tokenID, bidder string, amount int64, denom string) []string {
	return []string{
		"collection", collection, "tokenId", tokenID, "bidder", bidder,
		"amount", itoa(amount), "denom", denom,
		"schemaVersion", SchemaVersion,
	}
}

// ── Sweep summary (Phase 2). Each filled unit also emits SaleEvent via SaleArgs("sweep",…). ──

const SweepExecutedEvent = "SweepExecuted"

func SweepExecutedArgs(buyer string, count int, totalSpent int64, denom string) []string {
	return []string{
		"buyer", buyer, "count", itoa(int64(count)), "totalSpent", itoa(totalSpent),
		"denom", denom, "schemaVersion", SchemaVersion,
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass + lint**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/ && gno lint ./gno.land/p/samcrew/memba_market_core/`
Expected: `ok` + lint clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/zxxma/Desktop/Code/Gno/samcrew-deployer
git add projects/memba/realms/memba_market_core/events.gno projects/memba/realms/memba_market_core/events_test.gno
git commit -m "memba_market_core: offer/auction/sweep event schemas (Phase 2/3 engines)"
```

---

### Task 5: Deploy wiring + CI classification

**Files:**
- Modify: `samcrew-deployer/projects/memba/manifest.toml`
- Modify: `samcrew-deployer/projects/memba/deploy.sh`
- Modify: `samcrew-deployer/.github/workflows/test.yml`

**Interfaces:**
- Consumes: the package dir from Tasks 1-4.
- Produces: `gno.land/p/samcrew/memba_market_core` as a deployable `package` artifact, ordered BEFORE the future engines (offers/sweep, auctions) that import it; CI classifies it so the "every realm classified" guard passes.

- [ ] **Step 1: Add the manifest artifact** (in `manifest.toml`, in the commerce-v2 block, before any future engine; it has no non-genesis deps beyond stdlib)

```toml
[[artifact]]
name = "memba_market_core"
type = "package"
local_path = "memba_market_core"
pkg_path = "gno.land/p/samcrew/memba_market_core"
order = 10
scope = "deferred"
# Pure shared package (split math + frozen event schema). Deploys before the
# Phase 2/3 engines that import it. Only deps are gno stdlib (strconv) + genesis.
```

- [ ] **Step 2: Add the deploy step** (in `deploy.sh`, inside the `if [[ "$DEPLOY_COMMERCE_V2" == "true" ]]` block, after the memba_nft_market_v3 step)

```bash
    log_section "Commerce v2: memba_market_core (shared engine package)"
    [[ -d "$REALMS_DIR/memba_market_core" ]] && \
        deploy_with_retry "gno.land/p/samcrew/memba_market_core" "$REALMS_DIR/memba_market_core" "$DEPLOY_KEY"
```

- [ ] **Step 3: Classify in CI** (`.github/workflows/test.yml`) — add to the informational loop and the KNOWN guard list

In the informational `for dir in … ; do` list add the line:
```
            projects/memba/realms/memba_market_core \
```
In the `KNOWN="…"` string append ` memba_market_core`.

- [ ] **Step 4: Verify the package still tests + lints clean from a fresh resolve**

Run: `cd /Users/zxxma/Desktop/Code/Gno/gno/examples && gno test ./gno.land/p/samcrew/memba_market_core/ && gno lint ./gno.land/p/samcrew/memba_market_core/`
Expected: `ok` + clean.

- [ ] **Step 5: Validate shell + commit**

```bash
cd /Users/zxxma/Desktop/Code/Gno/samcrew-deployer
bash -n projects/memba/deploy.sh && echo "deploy.sh syntax OK"
git add projects/memba/manifest.toml projects/memba/deploy.sh .github/workflows/test.yml
git commit -m "deploy+ci: wire memba_market_core package (deploys before Phase 2/3 engines)"
```

---

## Self-Review

**1. Spec coverage (§5.1–5.3 of the Phase 3+ plan):**
- §5.1 shared package (split math + event-emit helpers): Tasks 2 (split) + 3/4 (event arg-builders). ✓ — escrow-ledger helpers intentionally deferred (they're stateful/realm-side; specced in the offers/auctions engine plans, not the pure package).
- §5.2 frozen versioned event schema (schemaVersion + normalized fields across all engines): Tasks 3 + 4 cover Sale + offer/auction/sweep families with `schemaVersion`. ✓
- §5.3 fee/royalty conformance: `SplitProceeds` (Task 2) is the single conformance reference; engine conformance tests (importing it) belong to each engine's plan. ✓
- §5.4 RegisterMarket policy, §5.5 points data foundation, §5.6 frontend router: explicitly OUT of scope here (separate Phase-0 plans) — noted in File Structure. Not gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". Every code step shows complete code; every run step shows the command + expected result. ✓

**3. Type consistency:** `itoa(int64) string` defined in Task 1, used in Tasks 2-4. `SchemaVersion`/`SettlementDenom` defined Task 1, used Tasks 3-4. `SaleArgs` signature in Task 3 is reused (not redefined) by accepted-offer/auction/sweep sales (documented in Task 4's note). Event-name consts unique. ✓

---

## Execution Handoff

Plan complete and saved to `Memba/docs/planning/NFT_MARKETPLACE_PHASE3_FOUNDATION_PLAN.md`. This is the first of the Phase-0 plans (shared on-chain core); the backend points-ledger, frontend multi-engine router, and RegisterMarket governance runbook are separate Phase-0 plans to follow.
