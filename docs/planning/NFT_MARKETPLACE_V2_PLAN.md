# NFT Marketplace v2 — Implementation Plan (Plan 1 of 3: on-chain realms)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two lint-clean, test-passing Gno realms on test13 — a multi-collection GRC721 registry (`memba_nft_v2`) and an atomic marketplace (`memba_nft_market_v2`) — ready for the commerce-v2 multisig deploy.

**Architecture:** Marketplace statically imports the collection registry and settles atomically via a crossing `MarketTransfer` guarded so only a registered marketplace address can transfer, and only with the owner's approval. All money math is a pure, exhaustively-tested function. Forks the audited `nft_market.gno` for caps/timeouts/CEI/pause patterns; deletes its 2-phase commit.

**Tech Stack:** Gno 0.9 (interrealm-v2 / crossing model); `gno test` + `gno lint`; `p/nt/{avl,ufmt,uassert,testutils}/v0`, `chain`, `chain/banker`, `chain/runtime/unsafe`; samcrew-deployer multisig flow.

**Spec:** [`NFT_MARKETPLACE_V2_DESIGN.md`](./NFT_MARKETPLACE_V2_DESIGN.md) — read §4, §5, §6, §10 before starting.

---

## Scope of this plan (and the two follow-on plans)

This plan covers **only the realms** (spec §4, §5, §6, §9, §10). It produces working, testable software on its own: two realms that lint clean and pass `gno test`, plus the deployer wiring to push them via multisig.

Deferred to separate plans (they depend on this one's deployed addresses + finalized event names):
- **Plan 2 — Go backend indexer** (spec §7): event ingestion → DB → API (floor/activity/search/rarity/portfolio/IPFS cache). Write after realms deploy and event names are frozen.
- **Plan 3 — Frontend rewire** (spec §8): vitest-TDD'd message builders threading `collectionID`, path/allowlist/gate flips, approve→list + price-split UX. Builders can be TDD'd against the frozen `vm/MsgCall` shape in parallel once this plan's ABI is fixed.

**Do not start Plan 2/3 until the realm ABIs and event field names in this plan are merged.**

---

## File structure

All realm sources live under the deployer repo (NOT the Memba repo):

```
samcrew-deployer/projects/memba/realms/
├── memba_nft_v2/
│   ├── gnomod.toml                 # module=gno.land/r/samcrew/memba_nft_v2, gno=0.9
│   ├── collection.gno              # registry state, CreateCollection, Mint, admin
│   ├── transfer.gno                # Approve/SetApprovalForAll/MarketTransfer + reads
│   ├── market_registry.gno         # RegisterMarket/UnregisterMarket (drain key)
│   ├── render.gno                  # Render() mux
│   ├── collection_test.gno         # registry + mint + admin tests
│   ├── transfer_test.gno           # approval + MarketTransfer guard tests
│   └── render_test.gno             # Render tests
└── memba_nft_market_v2/
    ├── gnomod.toml                 # module=gno.land/r/samcrew/memba_nft_market_v2, gno=0.9
    ├── params.gno                  # consts + splitProceeds (pure money math)
    ├── market.gno                  # state, ListNFT, DelistNFT, BuyNFT
    ├── offers.gno                  # MakeOffer/CancelOffer/ClaimExpiredOffer/AcceptOffer
    ├── admin.gno                   # Pause/Unpause/AdminDelist/SetFeeRecipient
    ├── render.gno                  # Render() + format helpers
    ├── params_test.gno             # exhaustive splitProceeds arithmetic tests
    ├── market_test.gno             # list/buy guard + cap tests
    ├── offers_test.gno             # offer lifecycle + lifetime + cap tests
    └── admin_test.gno              # admin ACL tests
```

Deployer config touched: `projects/memba/manifest.toml`, `projects/memba/deploy.sh`.

### Testability boundary (from the reference tests)
- **Unit-testable now** (`gno test`): pure helpers (esp. `splitProceeds`), all authorization **aborts** (`uassert.AbortsWithMessage`), state helpers, `Render`. Drive crossing fns with `testing.SetRealm(testing.NewUserRealm(addr))` + `Fn(cross, …)`; set payment with `testing.SetOriginSend`. Test fns that call crossing fns are declared `func TestX(cur realm, t *testing.T)`.
- **On-chain integration only** (per `nft_market` precedent — coin-moving success needs a funded realm + the live collection import): the full atomic `BuyNFT`/`AcceptOffer` happy path. Unit tests assert the guards that fire **before** any banker/cross-realm interaction; the happy path is verified in Task C5.

---

# Phase A — Collection realm `memba_nft_v2`

### Task A1: Scaffold collection realm + state

**Files:**
- Create: `samcrew-deployer/projects/memba/realms/memba_nft_v2/gnomod.toml`
- Create: `samcrew-deployer/projects/memba/realms/memba_nft_v2/collection.gno`

- [ ] **Step 1: Write `gnomod.toml`**

```toml
module = "gno.land/r/samcrew/memba_nft_v2"
gno = "0.9"
```

- [ ] **Step 2: Write `collection.gno` state + init (no behavior yet)**

```go
package memba_nft_v2

import (
	"chain"
	"chain/runtime/unsafe"

	"gno.land/p/demo/tokens/grc721"
	"gno.land/p/nt/avl/v0"
)

// AdminAddress is the Samouraï 2-of-2 multisig (samcrew-core-test1).
// Root of trust: mint authority + market registration + pause.
const AdminAddress = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

const MaxRoyaltyBPS = 1000 // 10% ceiling (spec §6)

// collectionID -> *collection
var collections = avl.NewTree()

// registered marketplace realm addresses allowed to call MarketTransfer.
// Adding one is a DRAIN KEY (spec §10 #1): multisig-only, event-logged.
var registeredMarkets = avl.NewTree() // addr.String() -> bool

var paused bool // global pause

type collection struct {
	nft          *grc721.RoyaltyNFT // basic+metadata+royalty composite (internal ledger)
	admin        address            // per-collection admin (v1: AdminAddress)
	royaltyRecip address            // MUTABLE
	royaltyBPS   int64              // <= MaxRoyaltyBPS
	phase        int                // 0=curated/multisig-only,1=allowlist,2=public (v1: 0)
	allowlistRoot string
	mintPrice    int64
	maxSupply    int64 // 0 = unlimited
	maxPerWallet int64
	paused       bool // per-collection pause
}

func mustGet(id string) *collection {
	v, ok := collections.Get(id)
	if !ok {
		panic("collection not found: " + id)
	}
	return v.(*collection)
}

func assertAdmin() {
	if unsafe.PreviousRealm().Address() != address(AdminAddress) {
		panic("admin only")
	}
}

func assertNotPaused(c *collection) {
	if paused || c.paused {
		panic("paused")
	}
}

var _ = chain.Emit // keep chain imported until first emit lands
```

> Verify the exact composite constructor name before relying on it. `grc721.RoyaltyNFT`/`NewNFTWithRoyalty` come from `gno/examples/gno.land/p/demo/tokens/grc721/grc721_royalty.gno` — open it and match the real exported names (the explore step found `NewNFTWithRoyalty`). If the type is unexported, store the concrete pointer the constructor returns.

- [ ] **Step 3: Lint to verify it compiles**

Run: `cd samcrew-deployer/projects/memba/realms/memba_nft_v2 && gno lint .`
Expected: no `imported and not used` / `redeclared` / `could not import`. (Add a temporary `_ = ...` for any not-yet-used import; remove as functions land.)

- [ ] **Step 4: Commit**

```bash
git add samcrew-deployer/projects/memba/realms/memba_nft_v2/
git commit -m "Scaffold memba_nft_v2 collection registry state"
```

---

### Task A2: CreateCollection (multisig-only) + RoyaltyInfo/SetRoyalty

**Files:**
- Modify: `memba_nft_v2/collection.gno`
- Create: `memba_nft_v2/collection_test.gno`

- [ ] **Step 1: Write failing test** (`collection_test.gno`)

```go
package memba_nft_v2

import (
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	tAdmin    = address(AdminAddress)
	tStranger = testutils.TestAddress("mn_stranger")
)

func TestCreateCollection_AdminSucceeds(cur realm, t *testing.T) {
	defer collections.Remove("c1")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	CreateCollection(cross, "c1", "Memba Genesis", "MGEN", 500, tAdmin, 100, 5)

	c := mustGet("c1")
	uassert.Equal(t, "MGEN", c.nft.Symbol(), "symbol stored")
	uassert.Equal(t, int64(500), c.royaltyBPS, "royalty bps stored")
}

func TestCreateCollection_NonAdminAborts(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(tStranger))
	uassert.AbortsWithMessage(t, "admin only", func() {
		CreateCollection(cross, "c2", "X", "X", 100, tStranger, 0, 0)
	})
	_, ok := collections.Get("c2")
	uassert.False(t, ok, "non-admin must not create a collection")
}

func TestCreateCollection_RoyaltyClamped(cur realm, t *testing.T) {
	defer collections.Remove("c3")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	uassert.AbortsWithMessage(t, "royalty exceeds max", func() {
		CreateCollection(cross, "c3", "X", "X", MaxRoyaltyBPS+1, tAdmin, 0, 0)
	})
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd samcrew-deployer/projects/memba/realms/memba_nft_v2 && gno test .`
Expected: FAIL — `CreateCollection` undefined.

- [ ] **Step 3: Implement in `collection.gno`**

```go
func CreateCollection(cur realm, id, name, symbol string, royaltyBPS int64,
	royaltyRecip address, maxSupply, maxPerWallet int64) {
	assertAdmin()
	if _, ok := collections.Get(id); ok {
		panic("collection exists: " + id)
	}
	if royaltyBPS > MaxRoyaltyBPS {
		panic("royalty exceeds max")
	}
	c := &collection{
		nft:          grc721.NewNFTWithRoyalty(name, symbol), // match real ctor (Task A1 note)
		admin:        address(AdminAddress),
		royaltyRecip: royaltyRecip,
		royaltyBPS:   royaltyBPS,
		maxSupply:    maxSupply,
		maxPerWallet: maxPerWallet,
	}
	collections.Set(id, c)
	chain.Emit("CollectionCreated", "collection", id, "name", name, "symbol", symbol,
		"royaltyBPS", itoa(royaltyBPS), "royaltyRecipient", royaltyRecip.String())
}

func SetRoyalty(cur realm, id string, recip address, bps int64) {
	assertAdmin()
	if bps > MaxRoyaltyBPS {
		panic("royalty exceeds max")
	}
	c := mustGet(id)
	c.royaltyRecip, c.royaltyBPS = recip, bps
	chain.Emit("RoyaltyChanged", "collection", id, "royaltyBPS", itoa(bps), "recipient", recip.String())
}

// RoyaltyInfo returns (recipient, royaltyAmount) for a sale price (GRC2981 shape).
func RoyaltyInfo(id string, tid grc721.TokenID, salePrice int64) (address, int64) {
	c := mustGet(id)
	return c.royaltyRecip, salePrice * c.royaltyBPS / 10000
}
```

Add helper `itoa` in `collection.gno`:

```go
import "strconv"

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `gno test .`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add samcrew-deployer/projects/memba/realms/memba_nft_v2/
git commit -m "memba_nft_v2: CreateCollection + royalty (multisig-only, clamped)"
```

---

### Task A3: Mint (multisig-only, supply/per-wallet caps)

**Files:** Modify `collection.gno`; add to `collection_test.gno`.

- [ ] **Step 1: Write failing tests** (append to `collection_test.gno`)

```go
func TestMint_AdminSucceeds(cur realm, t *testing.T) {
	defer collections.Remove("cm")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	CreateCollection(cross, "cm", "M", "M", 0, tAdmin, 2, 0)

	testing.SetRealm(testing.NewUserRealm(tAdmin))
	Mint(cross, "cm", tAdmin, grc721tid("1"), "ipfs://meta/1")
	uassert.Equal(t, tAdmin.String(), OwnerOf("cm", grc721tid("1")).String(), "minted to admin")
}

func TestMint_NonAdminAborts(cur realm, t *testing.T) {
	defer collections.Remove("cm2")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	CreateCollection(cross, "cm2", "M", "M", 0, tAdmin, 0, 0)
	testing.SetRealm(testing.NewUserRealm(tStranger))
	uassert.AbortsWithMessage(t, "admin only", func() {
		Mint(cross, "cm2", tStranger, grc721tid("1"), "")
	})
}

func TestMint_MaxSupplyAborts(cur realm, t *testing.T) {
	defer collections.Remove("cm3")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	CreateCollection(cross, "cm3", "M", "M", 0, tAdmin, 1, 0)
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	Mint(cross, "cm3", tAdmin, grc721tid("1"), "")
	testing.SetRealm(testing.NewUserRealm(tAdmin))
	uassert.AbortsWithMessage(t, "max supply reached", func() {
		Mint(cross, "cm3", tAdmin, grc721tid("2"), "")
	})
}
```

Add a tiny test helper at the bottom of `collection_test.gno`:

```go
func grc721tid(s string) grc721.TokenID { return grc721.TokenID(s) }
```

and import `"gno.land/p/demo/tokens/grc721"` in the test file.

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL `Mint`/`OwnerOf` undefined.

- [ ] **Step 3: Implement** `Mint` in `collection.gno`

```go
func Mint(cur realm, id string, to address, tid grc721.TokenID, tokenURI string) {
	assertAdmin()
	c := mustGet(id)
	if c.maxSupply > 0 && c.nft.TokenCount() >= c.maxSupply {
		panic("max supply reached")
	}
	if err := c.nft.Mint(to, tid); err != nil {
		panic(err.Error())
	}
	if tokenURI != "" {
		if _, err := c.nft.SetTokenURI(tid, grc721.TokenURI(tokenURI)); err != nil {
			panic(err.Error())
		}
	}
	chain.Emit("Mint", "collection", id, "to", to.String(), "tokenId", string(tid))
}
```

> `SetTokenURI` on `basicNFT` checks `caller == owner` via `PreviousRealm()`; in a crossing `Mint` called by the admin who is also `to`, this holds for the v1 curated drop (mint-to-multisig). If minting to a different recipient, set the URI through the internal ledger instead — verify against `grc721_metadata.gno`'s `SetTokenMetadata`/URI path and prefer the metadata-aware setter that doesn't require caller==owner. Adjust the call here to whichever the composite type exposes without an owner check.

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_v2: multisig-only Mint with supply cap"`

---

### Task A4: Approve / SetApprovalForAll + reads

**Files:** Create `transfer.gno`; create `transfer_test.gno`.

- [ ] **Step 1: Write failing tests** (`transfer_test.gno`)

```go
package memba_nft_v2

import (
	"testing"

	"gno.land/p/demo/tokens/grc721"
	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	xOwner  = testutils.TestAddress("mn_owner")
	xMarket = testutils.TestAddress("mn_market")
)

func seedTokenTo(owner address) {
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	if _, ok := collections.Get("t"); !ok {
		CreateCollection(cross, "t", "T", "T", 500, address(AdminAddress), 0, 0)
	}
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	Mint(cross, "t", owner, grc721.TokenID("1"), "")
}

func TestSetApprovalForAll_RecordsCaller(cur realm, t *testing.T) {
	defer collections.Remove("t")
	seedTokenTo(xOwner)
	testing.SetRealm(testing.NewUserRealm(xOwner))
	SetApprovalForAll(cross, "t", xMarket, true)
	uassert.True(t, IsApprovedForAll("t", xOwner, xMarket), "owner approved market as operator")
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement `transfer.gno`**

```go
package memba_nft_v2

import (
	"chain/runtime/unsafe"

	"gno.land/p/demo/tokens/grc721"
)

func Approve(cur realm, id string, operator address, tid grc721.TokenID) {
	c := mustGet(id)
	if err := c.nft.Approve(operator, tid); err != nil { // basicNFT checks PreviousRealm()==owner
		panic(err.Error())
	}
}

func SetApprovalForAll(cur realm, id string, operator address, approved bool) {
	c := mustGet(id)
	if err := c.nft.SetApprovalForAll(operator, approved); err != nil {
		panic(err.Error())
	}
}

func OwnerOf(id string, tid grc721.TokenID) address {
	o, err := mustGet(id).nft.OwnerOf(tid)
	if err != nil {
		panic(err.Error())
	}
	return o
}

func BalanceOf(id string, owner address) int64 {
	b, err := mustGet(id).nft.BalanceOf(owner)
	if err != nil {
		panic(err.Error())
	}
	return b
}

func GetApproved(id string, tid grc721.TokenID) address {
	a, err := mustGet(id).nft.GetApproved(tid)
	if err != nil {
		return ""
	}
	return a
}

func IsApprovedForAll(id string, owner, operator address) bool {
	return mustGet(id).nft.IsApprovedForAll(owner, operator)
}

func TokenURI(id string, tid grc721.TokenID) string {
	u, err := mustGet(id).nft.TokenURI(tid)
	if err != nil {
		return ""
	}
	return u
}

var _ = unsafe.PreviousRealm // used by MarketTransfer (Task A6)
```

> `Approve`/`SetApprovalForAll` on the composite are non-crossing methods that read `runtime.PreviousRealm()`. Wrapped in a crossing fn called directly by the EOA owner, `PreviousRealm()` resolves to the owner — correct. Confirm by the passing test.

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_v2: approvals + read views"`

---

### Task A5: RegisterMarket / UnregisterMarket (drain key)

**Files:** Create `market_registry.gno`; add tests to `transfer_test.gno`.

- [ ] **Step 1: Write failing tests** (append to `transfer_test.gno`)

```go
func TestRegisterMarket_AdminOnly(cur realm, t *testing.T) {
	defer registeredMarkets.Remove(xMarket.String())
	testing.SetRealm(testing.NewUserRealm(xOwner))
	uassert.AbortsWithMessage(t, "admin only", func() {
		RegisterMarket(cross, xMarket)
	})
	uassert.False(t, isRegisteredMarket(xMarket), "stranger cannot register a market")

	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	RegisterMarket(cross, xMarket)
	uassert.True(t, isRegisteredMarket(xMarket), "admin registers a market")

	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	UnregisterMarket(cross, xMarket)
	uassert.False(t, isRegisteredMarket(xMarket), "admin unregisters a market")
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement `market_registry.gno`**

```go
package memba_nft_v2

import "chain"

func RegisterMarket(cur realm, marketAddr address) {
	assertAdmin()
	registeredMarkets.Set(marketAddr.String(), true)
	chain.Emit("MarketRegistered", "market", marketAddr.String())
}

func UnregisterMarket(cur realm, marketAddr address) {
	assertAdmin()
	registeredMarkets.Remove(marketAddr.String())
	chain.Emit("MarketUnregistered", "market", marketAddr.String())
}

func isRegisteredMarket(a address) bool {
	v, ok := registeredMarkets.Get(a.String())
	return ok && v.(bool)
}
```

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_v2: market registry (multisig-only drain-key guard)"`

---

### Task A6: MarketTransfer (security-critical core)

**Files:** Modify `transfer.gno`; add tests to `transfer_test.gno`.

- [ ] **Step 1: Write failing tests** (append to `transfer_test.gno`)

```go
func TestMarketTransfer_UnregisteredCallerAborts(cur realm, t *testing.T) {
	defer collections.Remove("t")
	seedTokenTo(xOwner)
	testing.SetRealm(testing.NewUserRealm(xOwner))
	SetApprovalForAll(cross, "t", xMarket, true)
	// caller (xMarket) is NOT registered
	testing.SetRealm(testing.NewUserRealm(xMarket))
	uassert.AbortsWithMessage(t, "unauthorized market", func() {
		MarketTransfer(cross, "t", xOwner, xMarket, grc721.TokenID("1"))
	})
}

func TestMarketTransfer_WrongFromAborts(cur realm, t *testing.T) {
	defer collections.Remove("t")
	defer registeredMarkets.Remove(xMarket.String())
	seedTokenTo(xOwner)
	testing.SetRealm(testing.NewUserRealm(xOwner))
	SetApprovalForAll(cross, "t", xMarket, true)
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	RegisterMarket(cross, xMarket)
	testing.SetRealm(testing.NewUserRealm(xMarket))
	uassert.AbortsWithMessage(t, "from is not owner", func() {
		MarketTransfer(cross, "t", xStranger2, xMarket, grc721.TokenID("1"))
	})
}

func TestMarketTransfer_NoApprovalAborts(cur realm, t *testing.T) {
	defer collections.Remove("t")
	defer registeredMarkets.Remove(xMarket.String())
	seedTokenTo(xOwner) // no approval granted
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	RegisterMarket(cross, xMarket)
	testing.SetRealm(testing.NewUserRealm(xMarket))
	uassert.AbortsWithMessage(t, "market not approved", func() {
		MarketTransfer(cross, "t", xOwner, xBuyer2, grc721.TokenID("1"))
	})
}

func TestMarketTransfer_SuccessClearsApproval(cur realm, t *testing.T) {
	defer collections.Remove("t")
	defer registeredMarkets.Remove(xMarket.String())
	seedTokenTo(xOwner)
	testing.SetRealm(testing.NewUserRealm(xOwner))
	SetApprovalForAll(cross, "t", xMarket, true)
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	RegisterMarket(cross, xMarket)
	testing.SetRealm(testing.NewUserRealm(xMarket))
	MarketTransfer(cross, "t", xOwner, xBuyer2, grc721.TokenID("1"))
	uassert.Equal(t, xBuyer2.String(), OwnerOf("t", grc721.TokenID("1")).String(), "ownership moved")
	uassert.Equal(t, "", GetApproved("t", grc721.TokenID("1")).String(), "per-token approval cleared")
}
```

Add the extra test addresses near the top of `transfer_test.gno`:

```go
var (
	xStranger2 = testutils.TestAddress("mn_str2")
	xBuyer2    = testutils.TestAddress("mn_buy2")
)
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL `MarketTransfer` undefined.

- [ ] **Step 3: Implement `MarketTransfer` in `transfer.gno`**

```go
// MarketTransfer is the ONLY transfer path. Registered-market-only; verifies
// ownership + approval INSIDE the collection (never trusts the marketplace);
// clears the per-token approval on transfer. No receiver callback (reentrancy).
func MarketTransfer(cur realm, id string, from, to address, tid grc721.TokenID) {
	caller := unsafe.PreviousRealm().Address() // = marketplace realm addr on cross-call
	if !isRegisteredMarket(caller) {
		panic("unauthorized market")
	}
	c := mustGet(id)
	assertNotPaused(c)
	owner, err := c.nft.OwnerOf(tid)
	if err != nil {
		panic(err.Error())
	}
	if owner != from {
		panic("from is not owner")
	}
	approved, _ := c.nft.GetApproved(tid)
	if approved != caller && !c.nft.IsApprovedForAll(from, caller) {
		panic("market not approved")
	}
	// Transfer via the composite's TransferFrom: it re-checks isApprovedOrOwner
	// against PreviousRealm() (== caller == this registered+approved market) and
	// clears tokenApprovals[tid] internally (basic_nft.go transfer()).
	if err := c.nft.TransferFrom(from, to, tid); err != nil {
		panic(err.Error())
	}
	chain.Emit("MarketTransfer", "collection", id, "from", from.String(),
		"to", to.String(), "tokenId", string(tid))
}
```

Add `"chain"` to `transfer.gno` imports; remove the temporary `var _ = unsafe.PreviousRealm` from Task A4.

> Critical check during review: inside the non-crossing `c.nft.TransferFrom`, `runtime.PreviousRealm()` must still resolve to `caller` (the market). Because `MarketTransfer` is the crossing frame and `TransferFrom` is a non-crossing nested call, `PreviousRealm()` stays at the market — matching the security review. The `TestMarketTransfer_SuccessClearsApproval` test proves this end-to-end (ownership moved + approval cleared). If `TransferFrom` instead aborts on approval, fall back to calling the composite's internal `transfer` helper directly (white-box, same package import is not possible across p/ — in that case add a thin exported `MarketMove` on a Memba-owned grc721 fork). Resolve in review before proceeding.

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS (4 MarketTransfer tests).

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_v2: guarded atomic MarketTransfer (registered-market + approval + clear)"`

---

### Task A7: Render mux + pause + final lint

**Files:** Create `render.gno`; create `render_test.gno`; add pause fns to `collection.gno`.

- [ ] **Step 1: Write failing test** (`render_test.gno`)

```go
package memba_nft_v2

import (
	"strings"
	"testing"
)

func TestRenderHome(t *testing.T) {
	out := Render("")
	if !strings.Contains(out, "Memba NFT Collections") {
		t.Fatal("expected home title")
	}
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL `Render` undefined.

- [ ] **Step 3: Implement `render.gno`** (mux home / `{id}` / `{id}/{tid}`)

```go
package memba_nft_v2

import (
	"strings"

	"gno.land/p/demo/tokens/grc721"
	"gno.land/p/nt/ufmt/v0"
)

func Render(path string) string {
	if path == "" {
		out := "# Memba NFT Collections\n\n"
		out += ufmt.Sprintf("* Collections: %d\n", collections.Size())
		return out
	}
	parts := strings.SplitN(path, "/", 2)
	id := parts[0]
	v, ok := collections.Get(id)
	if !ok {
		return "# 404\n\nCollection not found."
	}
	c := v.(*collection)
	if len(parts) == 1 {
		out := ufmt.Sprintf("# %s (%s)\n\n", c.nft.Name(), c.nft.Symbol())
		out += ufmt.Sprintf("* Supply: %d\n* Royalty: %d bps\n", c.nft.TokenCount(), c.royaltyBPS)
		return out
	}
	tid := grc721.TokenID(parts[1])
	owner, err := c.nft.OwnerOf(tid)
	if err != nil {
		return "# 404\n\nToken not found."
	}
	uri, _ := c.nft.TokenURI(tid)
	return ufmt.Sprintf("# %s #%s\n\n* Owner: %s\n* URI: %s\n", c.nft.Symbol(), string(tid), owner.String(), uri)
}
```

- [ ] **Step 4: Add pause fns to `collection.gno`**

```go
func PauseCollection(cur realm, id string)   { assertAdmin(); mustGet(id).paused = true;  chain.Emit("CollectionPaused", "collection", id) }
func UnpauseCollection(cur realm, id string) { assertAdmin(); mustGet(id).paused = false; chain.Emit("CollectionUnpaused", "collection", id) }
func Pause(cur realm)   { assertAdmin(); paused = true;  chain.Emit("Paused") }
func Unpause(cur realm) { assertAdmin(); paused = false; chain.Emit("Unpaused") }
func IsPaused() bool    { return paused }
```

- [ ] **Step 5: Run all tests + lint**

Run: `gno test . && gno lint .`
Expected: all PASS; lint clean.

- [ ] **Step 6: Commit** — `git commit -m "memba_nft_v2: Render mux + pause valves; lint clean"`

---

# Phase B — Marketplace realm `memba_nft_market_v2`

> Fork from `samcrew-deployer/projects/memba/realms/nft_market/nft_market.gno`. Carry over verbatim: `MinPrice`, `MaxListings*`, `MaxOffers*`, `OfferTimeoutBlk`, the AVL state trees, `listingOrder`/`removeFromOrder`, `countListingsBySeller`/`countOffersByBuyer`, format/`truncAddr`/`truncPath` helpers, pause policy, and the ACL/B4/audit test scaffolding. Change: key by `collectionID` (not `nftRealm` string), import `memba_nft_v2`, atomic settlement, royalty leg, `MaxPrice`/`MinOfferLifetimeBlk`, mutable `feeRecipient`. Delete: `PendingPurchase`/`ConfirmPurchase`/`ClaimPurchaseTimeout`.

### Task B1: Scaffold marketplace + params/state

**Files:**
- Create: `memba_nft_market_v2/gnomod.toml`
- Create: `memba_nft_market_v2/params.gno`
- Create: `memba_nft_market_v2/market.gno` (state only this task)

- [ ] **Step 1: `gnomod.toml`**

```toml
module = "gno.land/r/samcrew/memba_nft_market_v2"
gno = "0.9"
```

- [ ] **Step 2: `params.gno` — constants** (split fn lands in B2)

```go
package memba_nft_market_v2

const (
	FeeBPS              = 250       // 2.5% platform fee
	MaxRoyaltyBPS       = 1000      // mirror collection ceiling
	MinPrice            = 1000      // ugnot; guarantees fee/royalty round > 0
	MaxPrice            = 1_000_000_000_000_000 // 1e15 ugnot; price*BPS << int64 max
	OfferTimeoutBlk     = 302400    // ~7d
	MinOfferLifetimeBlk = 10        // anti front-run cancel
	MaxListings         = 1000
	MaxOffers           = 1000
	MaxListingsPerAddr  = 50
	MaxOffersPerAddr    = 50
	AdminAddress        = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
)
```

- [ ] **Step 3: `market.gno` — state + imports**

```go
package memba_nft_market_v2

import (
	"chain"
	"chain/banker"
	"chain/runtime/unsafe"

	"gno.land/p/demo/tokens/grc721"
	"gno.land/p/nt/avl/v0"

	nft "gno.land/r/samcrew/memba_nft_v2"
)

var (
	listings     = avl.NewTree() // "collectionID:tokenId" -> *Listing
	offers       = avl.NewTree() // "collectionID:tokenId:buyer" -> *Offer
	salesLog     = avl.NewTree()
	listingOrder []string
	nextSaleId   int64
	totalVolume  int64
	paused       bool
	feeRecipient = address(AdminAddress) // MUTABLE via SetFeeRecipient
)

type Listing struct {
	CollectionID string
	TokenID      string
	Seller       address
	Price        int64
	CreatedBlk   int64
}

type Offer struct {
	CollectionID string
	TokenID      string
	Buyer        address
	Amount       int64
	CreatedBlk   int64
}

func listingKey(id, tid string) string       { return id + ":" + tid }
func offerKey(id, tid string, b address) string { return id + ":" + tid + ":" + b.String() }

var (
	_ = chain.Emit
	_ = banker.NewBanker
	_ = unsafe.PreviousRealm
	_ = grc721.TokenID("")
	_ = nft.OwnerOf
)
```

- [ ] **Step 4: Lint** — `cd ../memba_nft_market_v2 && gno lint .` → clean. (Local import of `memba_nft_v2` must resolve; see Task C3 note on the local module graph. If `gno lint` cannot resolve the sibling realm locally, proceed — it resolves on-chain at deploy; record this as a known local-tooling gap and rely on Task B2 pure-fn tests + Task C5 on-chain verification.)

- [ ] **Step 5: Commit** — `git commit -m "Scaffold memba_nft_market_v2 params + state"`

---

### Task B2: `splitProceeds` — exhaustive arithmetic tests (highest-severity unit)

**Files:** Modify `params.gno`; create `params_test.gno`.

- [ ] **Step 1: Write failing tests** (`params_test.gno`)

```go
package memba_nft_market_v2

import (
	"testing"

	"gno.land/p/nt/uassert/v0"
)

func TestSplit_Basic(t *testing.T) {
	fee, roy, seller := splitProceeds(1_000_000, 500) // 1 GNOT, 5% royalty
	uassert.Equal(t, int64(25000), fee, "2.5% fee")
	uassert.Equal(t, int64(50000), roy, "5% royalty")
	uassert.Equal(t, int64(925000), seller, "seller remainder")
	uassert.Equal(t, int64(1_000_000), fee+roy+seller, "invariant sum==price")
}

func TestSplit_DustGoesToSeller(t *testing.T) {
	fee, roy, seller := splitProceeds(1001, 0)
	uassert.Equal(t, int64(25), fee, "floor(1001*250/10000)")
	uassert.Equal(t, int64(0), roy, "no royalty")
	uassert.Equal(t, int64(976), seller, "dust to seller")
	uassert.Equal(t, int64(1001), fee+roy+seller, "invariant")
}

func TestSplit_RoyaltyClampedAtMax(t *testing.T) {
	// caller passes royaltyBPS over the ceiling -> clamp to MaxRoyaltyBPS, never panic
	fee, roy, seller := splitProceeds(1_000_000, MaxRoyaltyBPS+5000)
	uassert.Equal(t, int64(100000), roy, "royalty clamped to 10%")
	uassert.True(t, seller > 0, "seller still positive")
	uassert.Equal(t, int64(1_000_000), fee+roy+seller, "invariant after clamp")
}

func TestSplit_BelowMinPriceAborts(t *testing.T) {
	uassert.AbortsWithMessage(t, "price below minimum", func() { splitProceeds(MinPrice-1, 0) })
}

func TestSplit_AboveMaxPriceAborts(t *testing.T) {
	uassert.AbortsWithMessage(t, "price above maximum", func() { splitProceeds(MaxPrice+1, 0) })
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL `splitProceeds` undefined.

- [ ] **Step 3: Implement `splitProceeds` in `params.gno`**

```go
// splitProceeds returns (fee, royalty, sellerAmount) for a sale.
// Pure + total: clamps royalty, enforces price bounds, guarantees
// fee+royalty+seller == price exactly and seller > 0. (spec §5.3, §10 #4)
func splitProceeds(price, royaltyBPS int64) (fee, royalty, seller int64) {
	if price < MinPrice {
		panic("price below minimum")
	}
	if price > MaxPrice {
		panic("price above maximum")
	}
	if royaltyBPS < 0 {
		royaltyBPS = 0
	}
	if royaltyBPS > MaxRoyaltyBPS {
		royaltyBPS = MaxRoyaltyBPS
	}
	if FeeBPS+royaltyBPS >= 10000 {
		panic("fee+royalty exceeds 100%")
	}
	fee = price * FeeBPS / 10000
	royalty = price * royaltyBPS / 10000
	seller = price - fee - royalty
	if seller <= 0 {
		panic("seller amount not positive")
	}
	return
}
```

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS (5 tests).

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: safe splitProceeds + exhaustive money-math tests"`

---

### Task B3: ListNFT / DelistNFT + caps

**Files:** Modify `market.gno`; create `market_test.gno`.

- [ ] **Step 1: Write failing tests** (`market_test.gno`) — port the B4 cap tests, keyed by collectionID

```go
package memba_nft_market_v2

import (
	"strconv"
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

const tcoll = "c"

func TestListNFT_RecordsListing(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_seller")
	defer func() { k := listingKey(tcoll, "1"); listings.Remove(k); removeFromOrder(k) }()
	testing.SetRealm(testing.NewUserRealm(seller))
	ListNFT(cross, tcoll, grc721tid("1"), MinPrice)
	v, ok := listings.Get(listingKey(tcoll, "1"))
	uassert.True(t, ok, "listing recorded")
	uassert.Equal(t, MinPrice, v.(*Listing).Price, "price stored")
}

func TestListNFT_BelowMinPriceAborts(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_seller2")
	testing.SetRealm(testing.NewUserRealm(seller))
	uassert.AbortsWithMessage(t, "price below minimum", func() {
		ListNFT(cross, tcoll, grc721tid("x"), MinPrice-1)
	})
}

func TestDelistNFT_SellerOnly(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_s3")
	stranger := testutils.TestAddress("mk_str3")
	k := listingKey(tcoll, "2")
	defer func() { listings.Remove(k); removeFromOrder(k) }()
	testing.SetRealm(testing.NewUserRealm(seller))
	ListNFT(cross, tcoll, grc721tid("2"), MinPrice)
	testing.SetRealm(testing.NewUserRealm(stranger))
	uassert.AbortsWithMessage(t, "only seller can delist", func() { DelistNFT(cross, tcoll, grc721tid("2")) })
	testing.SetRealm(testing.NewUserRealm(seller))
	DelistNFT(cross, tcoll, grc721tid("2"))
	_, ok := listings.Get(k)
	uassert.False(t, ok, "seller delists")
}

func TestListNFT_PerSellerCap(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_cap")
	created := []string{}
	defer func() { for _, k := range created { listings.Remove(k); removeFromOrder(k) } }()
	for i := 0; i < MaxListingsPerAddr; i++ {
		tok := "cap-" + strconv.Itoa(i)
		testing.SetRealm(testing.NewUserRealm(seller))
		ListNFT(cross, tcoll, grc721tid(tok), MinPrice)
		created = append(created, listingKey(tcoll, tok))
	}
	testing.SetRealm(testing.NewUserRealm(seller))
	uassert.AbortsWithMessage(t, "seller listing limit reached", func() {
		ListNFT(cross, tcoll, grc721tid("cap-over"), MinPrice)
	})
}

func grc721tid(s string) string { return s } // tokenId carried as string in market state
```

> Note: marketplace stores tokenId as `string` (AVL keys). The public `ListNFT` signature takes `grc721.TokenID`; convert with `string(tid)` internally. The `grc721tid` test helper returns a string to match — adjust if you keep the public arg as `grc721.TokenID` (then helper returns `grc721.TokenID`). Pick one and keep it consistent across B3–B5.

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement in `market.gno`** (`ListNFT`, `DelistNFT`, `removeFromOrder`, `countListingsBySeller`)

```go
func ListNFT(cur realm, collectionID string, tid grc721.TokenID, price int64) {
	if paused {
		panic("market paused")
	}
	if price < MinPrice {
		panic("price below minimum")
	}
	if price > MaxPrice {
		panic("price above maximum")
	}
	seller := unsafe.PreviousRealm().Address()
	if listings.Size() >= MaxListings {
		panic("global listing limit reached")
	}
	if countListingsBySeller(seller) >= MaxListingsPerAddr {
		panic("seller listing limit reached")
	}
	key := listingKey(collectionID, string(tid))
	if _, ok := listings.Get(key); ok {
		panic("already listed")
	}
	listings.Set(key, &Listing{
		CollectionID: collectionID, TokenID: string(tid), Seller: seller,
		Price: price, CreatedBlk: chain.ChainHeight(),
	})
	listingOrder = append(listingOrder, key)
	chain.Emit("NFTListed", "collection", collectionID, "tokenId", string(tid),
		"seller", seller.String(), "price", itoa(price))
}

func DelistNFT(cur realm, collectionID string, tid grc721.TokenID) {
	key := listingKey(collectionID, string(tid))
	v, ok := listings.Get(key)
	if !ok {
		panic("listing not found")
	}
	if v.(*Listing).Seller != unsafe.PreviousRealm().Address() {
		panic("only seller can delist")
	}
	listings.Remove(key)
	removeFromOrder(key)
	chain.Emit("NFTDelisted", "collection", collectionID, "tokenId", string(tid))
}

func removeFromOrder(key string) {
	for i, k := range listingOrder {
		if k == key {
			listingOrder = append(listingOrder[:i], listingOrder[i+1:]...)
			return
		}
	}
}

func countListingsBySeller(s address) int {
	n := 0
	listings.Iterate("", "", func(_ string, v any) bool {
		if v.(*Listing).Seller == s {
			n++
		}
		return false
	})
	return n
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
```

Add `"strconv"` import to `market.gno`. Confirm the height fn name (`chain.ChainHeight()` vs `runtime.ChainHeight()`) against `escrow_v2` (`runtime.ChainHeight()`) and use that import consistently.

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: ListNFT/DelistNFT + per-seller caps"`

---

### Task B4: BuyNFT (atomic, CEI) — code + guard tests

**Files:** Modify `market.gno`; add tests to `market_test.gno`.

- [ ] **Step 1: Write failing guard tests** (append to `market_test.gno`) — assert the guards that fire before the cross-call/banker

```go
func TestBuyNFT_NotListedAborts(cur realm, t *testing.T) {
	buyer := testutils.TestAddress("mk_b1")
	testing.SetRealm(testing.NewUserRealm(buyer))
	uassert.AbortsWithMessage(t, "listing not found", func() { BuyNFT(cross, tcoll, grc721tid("nope")) })
}

func TestBuyNFT_SelfBuyAborts(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_self")
	k := listingKey(tcoll, "sb")
	defer func() { listings.Remove(k); removeFromOrder(k) }()
	testing.SetRealm(testing.NewUserRealm(seller))
	ListNFT(cross, tcoll, grc721tid("sb"), MinPrice)
	testing.SetRealm(testing.NewUserRealm(seller))
	testing.SetOriginSend(coins(MinPrice))
	uassert.AbortsWithMessage(t, "cannot buy own listing", func() { BuyNFT(cross, tcoll, grc721tid("sb")) })
}

func TestBuyNFT_WrongPaymentAborts(cur realm, t *testing.T) {
	seller := testutils.TestAddress("mk_wp")
	buyer := testutils.TestAddress("mk_wpb")
	k := listingKey(tcoll, "wp")
	defer func() { listings.Remove(k); removeFromOrder(k) }()
	testing.SetRealm(testing.NewUserRealm(seller))
	ListNFT(cross, tcoll, grc721tid("wp"), MinPrice*2)
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(coins(MinPrice)) // underpay
	uassert.AbortsWithMessage(t, "incorrect payment", func() { BuyNFT(cross, tcoll, grc721tid("wp")) })
}
```

Add a coins helper + import to `market_test.gno`:

```go
import "chain"
func coins(n int64) chain.Coins { return chain.Coins{chain.NewCoin("ugnot", n)} }
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL `BuyNFT` undefined.

- [ ] **Step 3: Implement `BuyNFT` (CEI ordering)** in `market.gno`

```go
func BuyNFT(cur realm, collectionID string, tid grc721.TokenID) {
	// ── Checks ──
	if paused {
		panic("market paused")
	}
	key := listingKey(collectionID, string(tid))
	v, ok := listings.Get(key)
	if !ok {
		panic("listing not found")
	}
	l := v.(*Listing)
	buyer := unsafe.PreviousRealm().Address()
	if buyer == l.Seller {
		panic("cannot buy own listing")
	}
	paid := sumUgnot(unsafe.OriginSend())
	if paid != l.Price {
		panic("incorrect payment")
	}
	_, royBPS := nft.RoyaltyInfo(collectionID, tid, l.Price) // recipient read again below
	royRecip, _ := nft.RoyaltyInfo(collectionID, tid, l.Price)
	fee, royalty, sellerAmt := splitProceeds(l.Price, royBPS)
	// ── Effects (before any external call / send) ──
	listings.Remove(key)
	removeFromOrder(key)
	recordSale(collectionID, string(tid), l.Seller, buyer, l.Price, fee, royalty)
	totalVolume += l.Price
	// ── Interactions ──
	nft.MarketTransfer(cross(cur), collectionID, l.Seller, buyer, tid)
	bnk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	self := unsafe.CurrentRealm().Address()
	if royalty > 0 {
		bnk.SendCoins(self, royRecip, chain.Coins{chain.NewCoin("ugnot", royalty)})
	}
	if fee > 0 {
		bnk.SendCoins(self, feeRecipient, chain.Coins{chain.NewCoin("ugnot", fee)})
	}
	bnk.SendCoins(self, l.Seller, chain.Coins{chain.NewCoin("ugnot", sellerAmt)}) // seller LAST
	chain.Emit("PurchaseConfirmed", "collection", collectionID, "tokenId", string(tid),
		"buyer", buyer.String(), "seller", l.Seller.String(), "price", itoa(l.Price),
		"fee", itoa(fee), "royalty", itoa(royalty), "royaltyRecipient", royRecip.String(),
		"sellerAmount", itoa(sellerAmt))
}

func sumUgnot(c chain.Coins) int64 {
	var n int64
	for _, coin := range c {
		if coin.Denom == "ugnot" {
			n += coin.Amount
		}
	}
	return n
}

func recordSale(id, tid string, seller, buyer address, price, fee, royalty int64) {
	nextSaleId++
	salesLog.Set(itoa(nextSaleId), &Listing{ // reuse struct as a row; or define Sale struct
		CollectionID: id, TokenID: tid, Seller: seller, Price: price,
	})
}
```

> `nft.RoyaltyInfo` is called once logically; collapse the two calls into `royRecip, royBPS := nft.RoyaltyInfo(...)`. (Shown split only to name both returns — fix to a single call.) Define a proper `Sale` struct for `salesLog` rather than reusing `Listing` if you want buyer/fee/royalty in history; keep it minimal for v1.

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS (guard tests). The happy path is covered on-chain (Task C5).

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: atomic BuyNFT (CEI, fee+royalty split, seller last)"`

---

### Task B5: Offers (MakeOffer/CancelOffer/ClaimExpiredOffer/AcceptOffer)

**Files:** Create `offers.gno`; create `offers_test.gno`.

- [ ] **Step 1: Write failing tests** (`offers_test.gno`) — port reference offer tests, add MinOfferLifetime + per-buyer cap

```go
package memba_nft_market_v2

import (
	"strconv"
	"testing"

	"chain"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

func mkOffer(buyer address, tok string, amt int64) {
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{chain.NewCoin("ugnot", amt)})
	MakeOffer(cross, tcoll, grc721tid(tok))
}

func TestMakeOffer_EscrowsAndCaps(cur realm, t *testing.T) {
	buyer := testutils.TestAddress("of_b")
	created := []string{}
	defer func() { for _, k := range created { offers.Remove(k) } }()
	for i := 0; i < MaxOffersPerAddr; i++ {
		tok := "of-" + strconv.Itoa(i)
		mkOffer(buyer, tok, MinPrice)
		created = append(created, offerKey(tcoll, tok, buyer))
	}
	uassert.Equal(t, MaxOffersPerAddr, countOffersByBuyer(buyer), "buyer at cap")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{chain.NewCoin("ugnot", MinPrice)})
	uassert.AbortsWithMessage(t, "buyer offer limit reached", func() { MakeOffer(cross, tcoll, grc721tid("of-over")) })
}

func TestMakeOffer_BelowMinAborts(cur realm, t *testing.T) {
	buyer := testutils.TestAddress("of_min")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{chain.NewCoin("ugnot", MinPrice-1)})
	uassert.AbortsWithMessage(t, "offer below minimum", func() { MakeOffer(cross, tcoll, grc721tid("m")) })
}

func TestCancelOffer_BeforeLifetimeAborts(cur realm, t *testing.T) {
	buyer := testutils.TestAddress("of_life")
	k := offerKey(tcoll, "lf", buyer)
	defer offers.Remove(k)
	mkOffer(buyer, "lf", MinPrice) // CreatedBlk = current height
	testing.SetRealm(testing.NewUserRealm(buyer))
	uassert.AbortsWithMessage(t, "offer too new to cancel", func() { CancelOffer(cross, tcoll, grc721tid("lf")) })
}
```

> `testing` exposes a height setter (used by the reference to age offers). Find the exact name (`testing.SkipHeights`/`testing.SetHeight` — grep the gno stdlib `testing` package) and add a positive cancel-after-lifetime test that advances height past `MinOfferLifetimeBlk` then asserts the refund path removes the offer. If no height setter exists in this gno build, assert only the abort and verify the positive cancel on-chain (Task C5).

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement `offers.gno`**

```go
package memba_nft_market_v2

import (
	"chain"
	"chain/banker"
	"chain/runtime"
	"chain/runtime/unsafe"

	"gno.land/p/demo/tokens/grc721"

	nft "gno.land/r/samcrew/memba_nft_v2"
)

func MakeOffer(cur realm, collectionID string, tid grc721.TokenID) {
	if paused {
		panic("market paused")
	}
	buyer := unsafe.PreviousRealm().Address()
	amt := sumUgnot(unsafe.OriginSend())
	if amt < MinPrice {
		panic("offer below minimum")
	}
	if offers.Size() >= MaxOffers {
		panic("global offer limit reached")
	}
	if countOffersByBuyer(buyer) >= MaxOffersPerAddr {
		panic("buyer offer limit reached")
	}
	key := offerKey(collectionID, string(tid), buyer)
	if _, ok := offers.Get(key); ok {
		panic("offer exists")
	}
	offers.Set(key, &Offer{
		CollectionID: collectionID, TokenID: string(tid), Buyer: buyer,
		Amount: amt, CreatedBlk: runtime.ChainHeight(),
	})
	chain.Emit("OfferMade", "collection", collectionID, "tokenId", string(tid),
		"buyer", buyer.String(), "amount", itoa(amt))
}

// CancelOffer: pause-EXEMPT (funds must never be trapped). Refunds the offerer.
func CancelOffer(cur realm, collectionID string, tid grc721.TokenID) {
	buyer := unsafe.PreviousRealm().Address()
	key := offerKey(collectionID, string(tid), buyer)
	v, ok := offers.Get(key)
	if !ok {
		panic("offer not found")
	}
	o := v.(*Offer)
	if runtime.ChainHeight()-o.CreatedBlk < MinOfferLifetimeBlk {
		panic("offer too new to cancel")
	}
	offers.Remove(key) // Effects before send
	refund(o.Buyer, o.Amount)
	chain.Emit("OfferCancelled", "collection", collectionID, "tokenId", string(tid), "buyer", buyer.String())
}

// ClaimExpiredOffer: pause-EXEMPT. Anyone can trigger refund after timeout.
func ClaimExpiredOffer(cur realm, collectionID string, buyer address) {
	// iterate this buyer's offers in the collection that are expired
	prefix := collectionID + ":"
	var expiredKey string
	var ofr *Offer
	offers.Iterate("", "", func(k string, v any) bool {
		o := v.(*Offer)
		if o.Buyer == buyer && o.CollectionID == collectionID &&
			runtime.ChainHeight()-o.CreatedBlk >= OfferTimeoutBlk {
			expiredKey, ofr = k, o
			return true
		}
		return false
	})
	_ = prefix
	if ofr == nil {
		panic("no expired offer")
	}
	offers.Remove(expiredKey)
	refund(ofr.Buyer, ofr.Amount)
	chain.Emit("OfferExpired", "collection", collectionID, "buyer", buyer.String())
}

// AcceptOffer: listing seller accepts an escrowed offer; atomic settle.
func AcceptOffer(cur realm, collectionID string, tid grc721.TokenID, buyer address) {
	if paused {
		panic("market paused")
	}
	seller := unsafe.PreviousRealm().Address()
	lkey := listingKey(collectionID, string(tid))
	lv, ok := listings.Get(lkey)
	if !ok {
		panic("listing not found")
	}
	if lv.(*Listing).Seller != seller {
		panic("only the listing seller can accept offers")
	}
	okey := offerKey(collectionID, string(tid), buyer)
	ov, ok := offers.Get(okey)
	if !ok {
		panic("offer not found")
	}
	o := ov.(*Offer)
	_, royBPS := nft.RoyaltyInfo(collectionID, tid, o.Amount)
	royRecip, _ := nft.RoyaltyInfo(collectionID, tid, o.Amount)
	fee, royalty, sellerAmt := splitProceeds(o.Amount, royBPS)
	// Effects
	offers.Remove(okey)
	listings.Remove(lkey)
	removeFromOrder(lkey)
	recordSale(collectionID, string(tid), seller, buyer, o.Amount, fee, royalty)
	totalVolume += o.Amount
	// Interactions
	nft.MarketTransfer(cross(cur), collectionID, seller, buyer, tid)
	bnk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	self := unsafe.CurrentRealm().Address()
	if royalty > 0 {
		bnk.SendCoins(self, royRecip, chain.Coins{chain.NewCoin("ugnot", royalty)})
	}
	if fee > 0 {
		bnk.SendCoins(self, feeRecipient, chain.Coins{chain.NewCoin("ugnot", fee)})
	}
	bnk.SendCoins(self, seller, chain.Coins{chain.NewCoin("ugnot", sellerAmt)})
	chain.Emit("OfferAccepted", "collection", collectionID, "tokenId", string(tid),
		"buyer", buyer.String(), "seller", seller.String(), "amount", itoa(o.Amount),
		"fee", itoa(fee), "royalty", itoa(royalty), "sellerAmount", itoa(sellerAmt))
	chain.Emit("TokenSold", "collection", collectionID, "tokenId", string(tid))
}

func refund(to address, amt int64) {
	bnk := banker.NewBanker(banker.BankerTypeRealmSend, nil) // see note: pass cur
	_ = bnk
	// NOTE: banker needs the crossing token `cur`. Refactor refund to take cur:
	// func refund(cur realm, to address, amt int64) and call NewBanker(..., cur).
	panic("refactor refund to take cur realm")
}

func countOffersByBuyer(b address) int {
	n := 0
	offers.Iterate("", "", func(_ string, v any) bool {
		if v.(*Offer).Buyer == b {
			n++
		}
		return false
	})
	return n
}
```

> **Fix during implementation:** `refund` must take `cur realm` to construct the banker (`banker.NewBanker(banker.BankerTypeRealmSend, cur)`). Change signature to `refund(cur realm, to address, amt int64)` and update `CancelOffer`/`ClaimExpiredOffer` to pass `cur`. The stub panic is intentional so the test forces the fix. Collapse the doubled `nft.RoyaltyInfo` calls into one. Resolve both before the step passes.

- [ ] **Step 4: Run, verify pass** (after the refund refactor) — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: offers (escrow, min-lifetime, atomic AcceptOffer, pause-exempt exits)"`

---

### Task B6: Admin (Pause/Unpause/AdminDelist/SetFeeRecipient)

**Files:** Create `admin.gno`; create `admin_test.gno`.

- [ ] **Step 1: Write failing tests** (`admin_test.gno`) — mirror the reference ACL tests

```go
package memba_nft_market_v2

import (
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

func TestPause_AdminOnly(cur realm, t *testing.T) {
	defer func() { paused = false }()
	testing.SetRealm(testing.NewUserRealm(testutils.TestAddress("ad_str")))
	uassert.AbortsWithMessage(t, "admin only", func() { Pause(cross) })
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	Pause(cross)
	uassert.True(t, paused, "admin pauses")
	Unpause(cross)
	uassert.False(t, paused, "admin unpauses")
}

func TestSetFeeRecipient_AdminOnly(cur realm, t *testing.T) {
	defer func() { feeRecipient = address(AdminAddress) }()
	newR := testutils.TestAddress("ad_fee")
	testing.SetRealm(testing.NewUserRealm(testutils.TestAddress("ad_str2")))
	uassert.AbortsWithMessage(t, "admin only", func() { SetFeeRecipient(cross, newR) })
	testing.SetRealm(testing.NewUserRealm(address(AdminAddress)))
	SetFeeRecipient(cross, newR)
	uassert.Equal(t, newR.String(), feeRecipient.String(), "admin updates fee recipient")
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement `admin.gno`**

```go
package memba_nft_market_v2

import (
	"chain"
	"chain/runtime/unsafe"

	"gno.land/p/demo/tokens/grc721"
)

func assertAdmin() {
	if unsafe.PreviousRealm().Address() != address(AdminAddress) {
		panic("admin only")
	}
}

func Pause(cur realm)   { assertAdmin(); paused = true;  chain.Emit("Paused") }
func Unpause(cur realm) { assertAdmin(); paused = false; chain.Emit("Unpaused") }

func AdminDelist(cur realm, collectionID string, tid grc721.TokenID) {
	assertAdmin()
	key := listingKey(collectionID, string(tid))
	if _, ok := listings.Get(key); !ok {
		panic("listing not found")
	}
	listings.Remove(key)
	removeFromOrder(key)
	chain.Emit("AdminDelisted", "collection", collectionID, "tokenId", string(tid))
}

func SetFeeRecipient(cur realm, addr address) {
	assertAdmin()
	feeRecipient = addr
	chain.Emit("FeeRecipientChanged", "recipient", addr.String())
}
```

- [ ] **Step 4: Run, verify pass** — `gno test .` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: admin ACL (pause, force-delist, mutable fee recipient)"`

---

### Task B7: Render + final lint

**Files:** Create `render.gno`; create `render_test.gno`.

- [ ] **Step 1: Failing test** (`render_test.gno`)

```go
package memba_nft_market_v2

import (
	"strings"
	"testing"
)

func TestRender_Stats(t *testing.T) {
	out := Render("stats")
	if !strings.Contains(out, "2.50%") {
		t.Fatal("expected fee in stats")
	}
}
```

- [ ] **Step 2: Run, verify fail** — `gno test .` → FAIL.

- [ ] **Step 3: Implement `render.gno`** (home/listing/sales/stats — port from `nft_market` render, keyed by collectionID; show fee 2.50%)

```go
package memba_nft_market_v2

import (
	"gno.land/p/nt/ufmt/v0"
)

func Render(path string) string {
	switch path {
	case "":
		return ufmt.Sprintf("# NFT Marketplace\n\n* Active Listings:** %d\n* Total Volume: %d ugnot\n",
			listings.Size(), totalVolume)
	case "stats":
		return ufmt.Sprintf("# Marketplace Stats\n\n* Platform Fee: 2.50%%\n* Listings: %d\n* Offers: %d\n",
			listings.Size(), offers.Size())
	case "sales":
		out := "# Recent Sales\n\n"
		if salesLog.Size() == 0 {
			out += "No sales yet.\n"
		}
		return out
	}
	return "# 404\n\nUnknown path."
}
```

- [ ] **Step 4: Run all tests + lint** — `gno test . && gno lint .` → PASS + clean.

- [ ] **Step 5: Commit** — `git commit -m "memba_nft_market_v2: Render + lint clean"`

---

# Phase C — Deploy wiring (multisig commerce-v2)

### Task C1: manifest.toml — add realms, deprecate old nft_market

**Files:** Modify `samcrew-deployer/projects/memba/manifest.toml`

- [ ] **Step 1: Add two artifacts** (set `order` to the next free integers after the existing commerce-v2 entries; collection before marketplace)

```toml
[[artifact]]
name = "memba_nft_v2"
type = "realm"
local_path = "memba_nft_v2"
pkg_path = "gno.land/r/samcrew/memba_nft_v2"
order = 7
scope = "deferred"

[[artifact]]
name = "memba_nft_market_v2"
type = "realm"
local_path = "memba_nft_market_v2"
pkg_path = "gno.land/r/samcrew/memba_nft_market_v2"
order = 8
scope = "deferred"
depends = ["memba_nft_v2"]
```

- [ ] **Step 2: Reclassify old `nft_market`** — change its `scope` from `deferred` to `deprecated` (match the candidature/channels v1 entries).

- [ ] **Step 3: Commit** — `git commit -m "deployer: register memba_nft_v2 + memba_nft_market_v2; deprecate nft_market"`

> Confirm the exact next `order` values against the live `manifest.toml` (the explore step assumed 5/6 were taken by earlier commerce-v2 work; verify and bump). `depends` must list `memba_nft_v2` so deploy order is enforced.

---

### Task C2: deploy.sh — add both to the commerce-v2 block

**Files:** Modify `samcrew-deployer/projects/memba/deploy.sh`

- [ ] **Step 1: Insert before the `fi` that closes the `--commerce-v2` block** (collection first):

```bash
log_section "Commerce v2: memba_nft_v2"
[[ -d "$REALMS_DIR/memba_nft_v2" ]] && \
    deploy_with_retry "gno.land/r/samcrew/memba_nft_v2" "$REALMS_DIR/memba_nft_v2" "$DEPLOY_KEY"

log_section "Commerce v2: memba_nft_market_v2"
[[ -d "$REALMS_DIR/memba_nft_market_v2" ]] && \
    deploy_with_retry "gno.land/r/samcrew/memba_nft_market_v2" "$REALMS_DIR/memba_nft_market_v2" "$DEPLOY_KEY"
```

- [ ] **Step 2: Commit** — `git commit -m "deployer: deploy.sh entries for nft v2 realms"`

---

### Task C3: Lint both under the v2 toolchain + dry-run plan

- [ ] **Step 1: Lint** (must be clean of `imported and not used` / `redeclared` / `could not import`)

```bash
cd samcrew-deployer
gno lint projects/memba/realms/memba_nft_v2
gno lint projects/memba/realms/memba_nft_market_v2
```

> If the marketplace lint reports an unresolved import of `gno.land/r/samcrew/memba_nft_v2` locally, that is the known local-module-graph gap (the dep resolves on-chain). Confirm the deployer's pre-deploy lint in `lib/deploy.sh` tolerates this (it greps for specific error substrings); if it would block, temporarily vendor `memba_nft_v2` into the local resolution path the deployer uses, or set the documented bypass. Record the outcome in the PR.

- [ ] **Step 2: Run realm tests once more from repo root**

```bash
(cd projects/memba/realms/memba_nft_v2 && gno test .)
(cd projects/memba/realms/memba_nft_market_v2 && gno test .)
```
Expected: all PASS.

- [ ] **Step 3: Dry-run plan** — `./samcrew-plan.sh test13 memba` → shows both new realms in the plan.

- [ ] **Step 4: Commit** any lint fixes — `git commit -m "deployer: lint-clean nft v2 realms under v2 toolchain"`

---

### Task C4: Multisig deploy + post-deploy txs (USER RUNS)

> **Claude prepares the commands and exact args; the user runs the multisig signing. Do not deploy without explicit user go-ahead (standing rule).**

- [ ] **Step 1: Deploy both realms**

```bash
cd samcrew-deployer
MULTISIG_SIGNERS="zooma,adena-zxxma" ./samcrew-deploy.sh test13 memba --commerce-v2
```
(DEPLOY_KEY=`samcrew-core-test1`, 2-of-2; chain id `test-13`.) Collection deploys first, marketplace second.

- [ ] **Step 2: Capture the marketplace realm address** — derive `gno.land/r/samcrew/memba_nft_market_v2`'s address (the deployer logs it; or compute via the realm path).

- [ ] **Step 3: Register the marketplace in the collection** (multisig MsgCall)

```
maketx call -pkgpath gno.land/r/samcrew/memba_nft_v2 -func RegisterMarket \
  -args <memba_nft_market_v2_addr>   (multisig-signed)
```

- [ ] **Step 4: Create + mint the placeholder collection** (multisig MsgCall)

```
maketx call -pkgpath gno.land/r/samcrew/memba_nft_v2 -func CreateCollection \
  -args "genesis" -args "Memba Genesis" -args "MGEN" -args 500 -args <multisig_addr> -args 10 -args 0
maketx call -pkgpath gno.land/r/samcrew/memba_nft_v2 -func Mint \
  -args "genesis" -args <multisig_addr> -args "1" -args "ipfs://<placeholder-cid>/1"
# repeat Mint for a few token IDs
```

- [ ] **Step 5: Record deployed addresses** in the PR and in `.remember/remember.md` for Plan 2/3.

---

### Task C5: On-chain end-to-end verification

- [ ] **Step 1:** `gnokey query vm/qrender --data "gno.land/r/samcrew/memba_nft_v2:genesis"` → shows the collection + minted supply.
- [ ] **Step 2:** As a test EOA holding a minted token (transfer one from multisig for the test), `SetApprovalForAll("genesis", <market_addr>, true)`, then `ListNFT("genesis", "1", 1000000)` → listing appears in `Render("")`.
- [ ] **Step 3:** As a second EOA, `BuyNFT("genesis", "1")` sending exactly 1000000 ugnot → verify: ownership moved (`OwnerOf`), per-token approval cleared, and the `PurchaseConfirmed` event shows `fee=25000`, `royalty=50000`, `sellerAmount=925000`; confirm fee+royalty arrived at the multisig and seller got the remainder.
- [ ] **Step 4:** `MakeOffer` → `AcceptOffer` happy path; `MakeOffer` → `CancelOffer` after `MinOfferLifetimeBlk` refunds.
- [ ] **Step 5:** Confirm guards on-chain: self-buy aborts, wrong payment aborts, unregistered-market `MarketTransfer` aborts.
- [ ] **Step 6:** Record results in the PR; this freezes the event names for Plan 2 (indexer) and the ABI for Plan 3 (frontend).

---

## Self-review (against the spec)

**Spec coverage:**
- §4 collection (registry, mint multisig-only, approvals, MarketTransfer, royalty, market registry, render, pause) → A1–A7 ✓
- §5 marketplace (list/delist, atomic buy, offers + atomic accept, admin, render) → B1–B7 ✓
- §5.3/§6 safe split + params → B2 + params.gno ✓
- §10 must-fixes: drain-key guard (A5), MarketTransfer in-collection verify + clear approval (A6), money clamps + seller>0 (B2/B4), CEI (B4/B5), no receiver callback (A6 — uses TransferFrom, no hook), mint auth via PreviousRealm (A3), pause-exempt exits (B5), caps (B3/B5) ✓
- §9 deploy (manifest, deploy.sh, lint, multisig, RegisterMarket, placeholder mint, verify) → C1–C5 ✓
- §7 indexer, §8 frontend → explicitly deferred to Plan 2/3 ✓

**Placeholder scan:** No "TBD/TODO" steps. Two **intentional stub-panics** (`refund` needs `cur`; the RoyaltyInfo double-call) are deliberate TDD-forcing devices with explicit fix instructions — not placeholders. The IPFS CID and final collection name are user-supplied content (spec §13), parameterized at deploy.

**Type consistency:** `collectionID string` + tokenId-as-`string` in marketplace state, public args `grc721.TokenID` converted via `string(tid)` — flagged in B3 to keep consistent across B3–B5. `splitProceeds(price, royaltyBPS) (fee, royalty, seller)` used identically in B2/B4/B5. `address`, `unsafe.PreviousRealm()/CurrentRealm()`, `banker.NewBanker(...,cur)` used consistently (one caller API, matching escrow_v2).

**Known verification points to resolve in review (not guesses to ship blind):** (a) exact composite ctor/type name in grc721 (`NewNFTWithRoyalty`/`RoyaltyNFT`); (b) that `c.nft.TransferFrom` inside crossing `MarketTransfer` sees the market as `PreviousRealm()` (proven by A6 success test) — fallback noted; (c) `runtime.ChainHeight()` vs `chain.ChainHeight()`; (d) `testing` height-advance API name for the positive cancel test; (e) local lint resolution of the sibling-realm import. Each has an explicit fallback in-task.

---

## Execution handoff

**Plan complete and saved to `Memba/docs/planning/NFT_MARKETPLACE_V2_PLAN.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best here because each task is TDD-bounded and the verification points (b)–(e) benefit from a clean per-task check.

**2. Inline Execution** — execute tasks in this session via executing-plans, batched with checkpoints.

**Which approach?** (And: deployment Tasks C4–C5 require your multisig run and explicit go-ahead — Claude will prepare exact commands but not deploy autonomously.)
