# Memba NFT Marketplace v2 — Design Spec

**Status:** Design approved (pending written-spec review) — 2026-06-16
**Supersedes the gated v1:** [`NFT_MARKETPLACE_REDESIGN.md`](./NFT_MARKETPLACE_REDESIGN.md)
**Target:** gno.land **test13** (gno 0.9 / interrealm-v2 "crossing" model)
**Author trail:** design-first brainstorm + 4-perspective expert design review (Gno security/crossing-semantics, marketplace product, platform architecture/extensibility, economics/abuse).

---

## 1. Goal & scope

Build a **safe, atomic, functional NFT marketplace live on test13**, and architect it to grow into a best-in-class multi-collection marketplace.

- **v1 ships:** a curated, multisig-minted collection (placeholder drop for test13; real art TBD) + a marketplace with **fixed-price listings, escrowed offers/bids, GRC2981 royalties, 2.5% platform fee**, atomic settlement, and a **Go backend indexer** powering floor/activity/search/rarity/portfolio.
- **Designed-in for later (zero collection redeploy):** multiple collections, public/allowlist mint phases, PFP/membership utility, auctions, sweep/bundles.

### Decisions locked (this session)
1. **Collection architecture:** ONE multi-collection **registry realm** keyed by `collectionID` (the `tokenfactory_v2` instance pattern), *not* one-realm-per-collection.
2. **Indexer:** built **in v1** (not fast-follow).
3. **v1 collection content:** **placeholder drop** for test13 (parameterized name/symbol/supply + IPFS metadata); real art/metadata supplied before any mainnet launch.
4. **Art/metadata:** off-chain (IPFS/HTTPS) via `TokenURI`.
5. **Offers:** fixed-price **+ offers/bids** in v1.
6. **Economics:** 2.5% platform fee **+ GRC2981 creator royalty**; fee recipient = Samouraï 2-of-2 multisig (`samcrew-core-test1`).

---

## 2. Why the old design was gated, and why this one works

The gated `r/samcrew/nft_market` keyed listings by an arbitrary `nftRealm string` and could not transfer NFTs itself — it ran a **2-phase commit** (escrow → buyer transfers NFT out-of-band → confirm), with an unavoidable trust gap.

**The deeper finding (security review):** even an "interface-object" marketplace passing a `grc721.IGRC721` cannot drive the **stdlib grc721** on test13. That package (`p/demo/tokens/grc721/basic_nft.gno`) is the old monolithic `basicNFT`: its `TransferFrom`/`Approve`/`SetApprovalForAll` are **non-crossing methods** that authorize via `runtime.PreviousRealm()`. There is **no ledger/teller split** (the teller-grc721 PRs #5603/#5728 are unmerged upstream).

Mechanism: `PreviousRealm()` = `getRealm(1)`, which walks call frames and only counts frames entered via `cross(fn)` (`WithCross == true`). A non-crossing method call does **not** advance the cross counter. So `EOA → market(cross) → nft.TransferFrom(...)` resolves `PreviousRealm()` *past* the marketplace to the **EOA** — the marketplace is never seen as the approved operator, and the transfer fails. That is the real reason a generic marketplace is impossible today.

**This design's fix:** because Memba owns the collection, we build our **own collection realm exposing a crossing `MarketTransfer(cur realm, …)`**. When the marketplace `M` calls `collection.MarketTransfer(cross(cur), …)`, the `MarketTransfer` frame *is* `WithCross == true`, so `PreviousRealm()` inside the collection **resolves to `M`'s realm address** (verified against `getRealm`/`WithCross`). The collection authorizes `M` (registered marketplace + token approved by owner) and performs the transfer over its **internal ledger** in one atomic tx. No trust gap, no 2-phase commit.

> One realm statically importing another realm and cross-calling its crossing functions is a supported pattern — `tokenfactory_v2` does exactly this: `grc20reg.Register(cross(cur), token, symbol)`.

---

## 3. Architecture overview

```
        EOA (Adena)                         Go backend (indexer)
            │                                      ▲  reads chain.Emit events
            │ cross(cur)                           │  (floor, activity, search,
            ▼                                      │   rarity, portfolio, IPFS cache)
  ┌──────────────────────────┐                     │
  │ r/samcrew/                │  cross(cur)         │
  │   memba_nft_market_v2     │────────────────┐    │
  │  (order book + escrow +   │                │    │
  │   atomic settlement +     │   static import│    │
  │   fee/royalty split)      │◀───────────────┘    │
  └──────────────────────────┘                      │
            │ collection.MarketTransfer(cross(cur), collectionID, from, to, tid)
            ▼                                        │
  ┌──────────────────────────┐                      │
  │ r/samcrew/memba_nft_v2    │──────────────────────┘
  │  multi-collection GRC721  │
  │  registry (collectionID → │
  │   collection state)       │
  └──────────────────────────┘
```

- **On-chain = value & ownership only.** Collection holds ownership/approvals/metadata-pointers/royalty/mint-phase; marketplace holds listings/offers/escrow/atomic settlement and emits rich events.
- **Off-chain (Go backend) = discovery & presentation.** Tails `chain.Emit` into a DB; serves search/filter/sort, activity feed, floor/last-sale/volume, rarity, portfolios, IPFS image caching/thumbnails. Survives a marketplace redeploy (history reconstructed from events).
- **Frontend** reads list/search/activity from the backend; reads *authoritative* ownership/price from the realm before a buy; submits txs via Adena.

---

## 4. Collection realm — `r/samcrew/memba_nft_v2`

Multi-collection registry following the `tokenfactory_v2` instance pattern.

### 4.1 State

```go
package memba_nft_v2

// collectionID → *collection
var collections avl.Tree

type collection struct {
    nft            *grc721.royaltyNFT // basic + metadata + royalty composite (internal ledger)
    admin          address            // per-collection admin (v1: the multisig)
    royaltyRecip   address            // MUTABLE (admin-settable)
    royaltyBPS     int64              // capped at MaxRoyaltyBPS
    // mint phase state — carried in v1 even if unused, since path is immutable:
    phase          int                // 0=curated/multisig-only, 1=allowlist, 2=public
    allowlistRoot  string             // merkle root (allowlist phase, later)
    mintPrice      int64              // public/allowlist phase
    maxSupply      int64              // 0 = unlimited
    maxPerWallet   int64
    paused         bool               // per-collection pause
}

// market authorization — a DRAIN KEY. multisig-only, event-logged.
var registeredMarkets avl.Tree // marketAddr(string) → bool

const AdminAddress = "g1...samcrew-core-test1-multisig..." // root of trust (const)
var   paused bool                                          // global pause
```

### 4.2 Public functions (crossing)

```go
// ── admin (multisig-only) ──
func CreateCollection(cur realm, id, name, symbol string, royaltyBPS int64,
                      royaltyRecip address, maxSupply, maxPerWallet int64)
func Mint(cur realm, id string, to address, tid grc721.TokenID, tokenURI string) // v1: multisig-only
func SetRoyalty(cur realm, id string, recip address, bps int64)   // bps ≤ MaxRoyaltyBPS
func SetMintPhase(cur realm, id string, phase int, price int64, allowlistRoot string)
func PauseCollection(cur realm, id string) / UnpauseCollection(cur realm, id string)
func Pause(cur realm) / Unpause(cur realm)                        // global

// ── market authorization (multisig-only, DRAIN KEY, event-logged) ──
func RegisterMarket(cur realm, marketAddr address)
func UnregisterMarket(cur realm, marketAddr address)

// ── owner-driven (EOA) ──
func Approve(cur realm, id string, operator address, tid grc721.TokenID)
func SetApprovalForAll(cur realm, id string, operator address, approved bool)

// ── settlement (registered-market-only) ──
func MarketTransfer(cur realm, id string, from, to address, tid grc721.TokenID)

// ── reads (no cur realm) ──
func OwnerOf(id string, tid grc721.TokenID) address
func BalanceOf(id string, owner address) int64
func GetApproved(id string, tid grc721.TokenID) address
func IsApprovedForAll(id string, owner, operator address) bool
func TokenURI(id string, tid grc721.TokenID) string
func RoyaltyInfo(id string, tid grc721.TokenID, salePrice int64) (address, int64)
func Render(path string) string // mux: "" gallery, "{id}", "{id}/{tid}"
```

> **No public `TransferFrom`/`SafeTransferFrom`, no gift/airdrop transfer, no `onReceived` callback.** `MarketTransfer` is the *only* transfer path — this is what keeps royalty enforcement strong and reentrancy out.

### 4.3 `MarketTransfer` — the security-critical core

```go
func MarketTransfer(cur realm, id string, from, to address, tid grc721.TokenID) {
    caller := unsafe.PreviousRealm().Address()      // = marketplace realm addr on cross-call
    assert(registeredMarkets has caller)            // CRITICAL: registered-market-only
    c := mustGet(id)
    assert(!paused && !c.paused)
    owner := c.nft.OwnerOf(tid)
    assert(owner == from)                           // never trust the caller's `from`
    assert(c.nft.GetApproved(tid) == caller ||      // token approved to this market…
           c.nft.IsApprovedForAll(from, caller))    // …or operator-approved
    c.nft.transfer(from, to, tid)                   // internal ledger; CLEARS tokenApprovals[tid]
    chain.Emit("MarketTransfer", "collection", id, "from", from, "to", to, "tokenId", tid)
}
```

**Must-haves (security review):** verify everything *inside* the collection (don't trust the marketplace); clear the per-token approval on transfer (stdlib `transfer` does `tokenApprovals.Remove(tid)` — preserve it); registered-market check; no untrusted receiver callback.

### 4.4 Mint authority

v1 mint is **multisig-only**: `assert unsafe.PreviousRealm().Address() == AdminAddress`. Do **not** use current-realm ownable auth (it would compare against the collection realm itself and lock out the EOA multisig).

---

## 5. Marketplace realm — `r/samcrew/memba_nft_market_v2`

Forked from the audited `nft_market.gno` (keep its CEI, caps, timeouts, pause-exempt value-exits) with two structural changes: **(a) statically imports `memba_nft_v2` and settles atomically via `MarketTransfer`**, deleting the 2-phase commit (`pendingPurchases`/`ConfirmPurchase`/`ClaimPurchaseTimeout`); **(b) adds the GRC2981 royalty leg** with the safe arithmetic below.

### 5.1 Public functions

```go
import nft "gno.land/r/samcrew/memba_nft_v2"

func ListNFT(cur realm, collectionID string, tid grc721.TokenID, price int64)
func DelistNFT(cur realm, collectionID string, tid grc721.TokenID)
func BuyNFT(cur realm, collectionID string, tid grc721.TokenID)            // atomic
func MakeOffer(cur realm, collectionID string, tid grc721.TokenID)          // escrows OriginSend
func AcceptOffer(cur realm, collectionID string, tid grc721.TokenID, buyer address) // atomic
func CancelOffer(cur realm, collectionID string, tid grc721.TokenID)        // pause-exempt
func ClaimExpiredOffer(cur realm, collectionID string, buyer address)       // pause-exempt
func AdminDelist(cur realm, collectionID string, tid grc721.TokenID)        // moderation, multisig
func Pause(cur realm) / Unpause(cur realm)                                  // multisig
func SetFeeRecipient(cur realm, addr address)                              // multisig, event
func Render(path string) string
```

### 5.2 Atomic `BuyNFT` (CEI ordering)

```go
func BuyNFT(cur realm, collectionID string, tid grc721.TokenID) {
    buyer := unsafe.PreviousRealm().Address()
    l := mustGetListing(collectionID, tid)
    // ── Checks ──
    assert(!paused)
    assert(buyer != l.Seller)                       // self-buy guard
    paid := sumUgnot(unsafe.OriginSend())
    assert(paid == l.Price)                         // exact payment
    fee, royalty, royaltyRecip, sellerAmt := splitProceeds(collectionID, tid, l.Price)
    // ── Effects (before any external call / send) ──
    removeListing(collectionID, tid)
    recordSale(collectionID, tid, l.Seller, buyer, l.Price, fee, royalty)
    totalVolume += l.Price
    // ── Interactions ──
    nft.MarketTransfer(cross(cur), collectionID, l.Seller, buyer, tid)
    bnk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
    self := unsafe.CurrentRealm().Address()
    if royalty > 0 { bnk.SendCoins(self, royaltyRecip, coins("ugnot", royalty)) }
    if fee > 0     { bnk.SendCoins(self, feeRecipient, coins("ugnot", fee)) }
    bnk.SendCoins(self, l.Seller, coins("ugnot", sellerAmt)) // seller LAST
    chain.Emit("PurchaseConfirmed", "collection", collectionID, "tokenId", tid,
        "buyer", buyer, "seller", l.Seller, "price", l.Price,
        "fee", fee, "royalty", royalty, "royaltyRecipient", royaltyRecip, "sellerAmount", sellerAmt)
}
```

`AcceptOffer` follows the same shape (remove offer in Effects, then `MarketTransfer` + split, seller = caller). This closes the ownership gap the old `AcceptOffer` explicitly deferred.

### 5.3 Safe proceeds split (economics review — must-fix)

```go
func splitProceeds(id string, tid grc721.TokenID, price int64) (fee, royalty int64, recip address, seller int64) {
    assert(price >= MinPrice && price <= MaxPrice)        // MaxPrice prevents int64 overflow
    fee = price * FeeBPS / 10000
    recip, rbps := nft.RoyaltyInfo(id, tid, price)        // rbps clamped to MaxRoyaltyBPS in collection
    if rbps > MaxRoyaltyBPS { rbps = MaxRoyaltyBPS }      // defensive clamp (don't panic the sale)
    royalty = price * rbps / 10000
    assert(FeeBPS + rbps < 10000)
    seller = price - fee - royalty
    assert(seller > 0)                                    // never underflow / overpay
    return
}
// invariant: fee + royalty + seller == price exactly (truncation lands in seller)
```

### 5.4 Offer hardening (economics review)
- On-chain **ugnot escrow** is mandatory (no allowance primitive for native coin) — keep escrow model.
- `MinOfferLifetimeBlk = 10` before `CancelOffer` is allowed (blunts AcceptOffer↔CancelOffer front-run).
- Emit `TokenSold` so losing bidders know to `CancelOffer` (their funds stay escrowed until they cancel/expire).
- `CancelOffer`, `ClaimExpiredOffer` stay **pause-exempt** so funds are never trapped.

---

## 6. Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `FeeBPS` | 250 (2.5%) | matches reference / industry |
| `MaxRoyaltyBPS` | 1000 (10%) | bounds underflow; clamp returned royalty |
| `FeeBPS + royaltyBPS` | **< 10000** | seller always nets > 0 |
| `MinPrice` | 1000 ugnot (0.001 GNOT) | fee/royalty round > 0 |
| `MaxPrice` (new) | 1e15 ugnot (1B GNOT) | `price * BPS` stays far under int64 max |
| `OfferTimeoutBlk` | 302400 (~7d) | keep |
| `MinOfferLifetimeBlk` (new) | 10 | anti front-run cancel |
| `MaxListings` / `MaxOffers` | 1000 / 1000 | curated v1 scale; caps O(n) gas-grief |
| `MaxListingsPerAddr` / `MaxOffersPerAddr` | 50 / 50 | keep |

---

## 7. Off-chain Go backend indexer (v1)

Lives in the existing Memba Go backend. **Source of truth for value stays on-chain; the indexer is read-only.**

- **Ingest:** tail `chain.Emit` events (`MarketTransfer`, `Mint`, `NFTListed`, `PurchaseConfirmed`, `OfferMade`, `OfferAccepted`, `TokenSold`, `FeeRecipientChanged`, …) into a DB keyed by `(collectionID, tokenId)` and by address. Index by event so a marketplace redeploy never loses history (re-index from genesis on a new path).
- **Serves:** search/filter/sort (price, recently listed), activity feed, floor / last-sale / 24h volume, rarity & trait facets, per-wallet portfolio ("my items / listings / offers"), IPFS image pinning + thumbnail/CDN cache.
- **Volume is labeled gross/unverified** (wash-trade aware); never tie rewards/leaderboards to it.

---

## 8. Frontend rewire (Vite + React, TDD)

Existing NFT surface to repoint (no message-builder rewrite needed — builders take the marketplace path + add `collectionID`):

- **Path constants:** `lib/nftConfig.ts` (`NFT_MARKETPLACE_PATH`), `lib/config.ts` (`MEMBA_DAO.nftMarketPath` + new collection path).
- **Gating:** add both realms to `REALM_ALLOWLIST['test13']`; set `VITE_ENABLE_NFT=true`; `isNftMarketValid()` then returns true and `ComingSoonGate` lifts.
- **Builders:** `lib/nftMarketplace.ts` — thread `collectionID` through `buildListForSaleMsg`/`buildBuyNFTMsg`/`buildMakeOfferMsg`/`buildAcceptOfferMsg`/`buildDelistMsg`/`buildCancelOfferMsg`.
- **UX (HQ):** guided **approve→list** two-step flow (remember `SetApprovalForAll`), **price-split** display (buyer pays / royalty / 2.5% fee / you receive) in Buy & List modals, **My Offers / Offers received** tab with expiry countdown, floor/last-sale on cards, skeleton/empty/error states, mobile pass, marketplace-specific entries in `lib/errorMap.ts`.
- **Components:** `components/nft/{ListForSaleModal,BuyNFTModal,MakeOfferModal,NFTActivityFeed,NFTListingCard}.tsx`, `pages/{Marketplace,NFTGallery,NFTLaunchpad}.tsx`.
- **TDD:** extend the existing **vitest** suites (`nftMarketplace.test.ts`, `grc721.test.ts`, `config.test.ts`) — write failing tests for `collectionID` args + the `vm/MsgCall` shape first, then implement.

---

## 9. Deployment (samcrew-deployer, commerce-v2 multisig flow)

The user runs the multisig signing; Claude prepares everything.

1. **Realm sources:** `samcrew-deployer/projects/memba/realms/memba_nft_v2/` and `…/memba_nft_market_v2/` (each: `*.gno`, `*_test.gno`, `gnomod.toml` with `module = "gno.land/r/samcrew/<name>"`, `gno = "0.9"`).
2. **manifest.toml:** add two `[[artifact]]` entries — `memba_nft_v2` (order N) and `memba_nft_market_v2` (order N+1, `depends = ["memba_nft_v2"]`, `scope = "deferred"`); reclassify the old `nft_market` `deferred → deprecated`.
3. **deploy.sh:** add both to the commerce-v2 redeploy block (collection before marketplace).
4. **Lint (v2 toolchain) before deploy:** `gno lint projects/memba/realms/memba_nft_v2` and `…/memba_nft_market_v2` (must be clean of `imported and not used` / `redeclared` / `could not import`); run `gno test` on the realm test files.
5. **Deploy:** `MULTISIG_SIGNERS="zooma,adena-zxxma" ./samcrew-deploy.sh test13 memba --commerce-v2` (DEPLOY_KEY=`samcrew-core-test1`, 2-of-2). Chain id `test-13`.
6. **Post-deploy txs (multisig):** `RegisterMarket(<memba_nft_market_v2 addr>)` on the collection; `CreateCollection(...)` + `Mint(...)` the placeholder drop.
7. **Frontend:** repoint paths, add to allowlist, ungate, prod rebuild on Netlify.
8. **Verify end-to-end:** mint → approve → list → buy (check fee+royalty splits + events) → make/accept offer → cancel/expire refund → indexer reflects floor/activity/portfolio.

### Deploy order & dependency note
Collection must deploy first (marketplace statically imports it). `RegisterMarket` must run **after** the marketplace address is known. Static import pins the marketplace to the collection's exact path — a collection bug requires redeploying both to new paths, so the collection ABI is frozen carefully (see §11).

---

## 10. Critical safety checklist (must-fix before deploy)

**CRITICAL**
1. `RegisterMarket`/`UnregisterMarket` = drain key → multisig-only, event-logged, treated like an upgrade key.
2. `MarketTransfer` verifies inside the collection: `OwnerOf==from`, caller is registered market, token approved.
3. `MarketTransfer` clears `tokenApprovals[tid]` on transfer (no stale-approval hijack).
4. Proceeds split: `MaxPrice` guard, separate truncated legs, `FeeBPS+royaltyBPS<10000`, `MaxRoyaltyBPS` clamp, `require(seller>0)`, seller paid last.

**HIGH**
5. CEI: remove listing/offer (Effects) before the `MarketTransfer` cross-call and all `SendCoins`.
6. No `onReceived`/receiver callback to arbitrary realms inside `MarketTransfer` (reentrancy).
7. Mint auth = `PreviousRealm() == AdminAddress` (not current-realm ownable).

**MEDIUM**
8. Correct syntax: crossing fns take `cur realm` first; cross-calls use `cross(cur)`; pick ONE caller API (`unsafe.PreviousRealm`/`unsafe.CurrentRealm`/`unsafe.OriginSend`, matching `escrow_v2`) and use it consistently.
9. Carry over exact-payment + self-buy + double-list guards; `MinPrice`/`MinOffer ≥ 1000`.
10. Value-exit fns (`CancelOffer`, `ClaimExpiredOffer`) stay pause-exempt.
11. Pause valve (global + per-collection) + per-address caps, multisig-gated.

**DOCUMENT**
12. Royalty is **marketplace-enforced, not chain-enforced** — never add an ungated transfer path; never make royalty "optional."
13. Static import pins marketplace↔collection — plan upgrades accordingly.
14. Displayed volume is gross/unverified — never gamify it.

---

## 11. Extensibility & forward path

- **Multi-collection without redeploy:** new drops, mint phases, PFP collections = `CreateCollection`/`SetMintPhase` state writes on the unchanged collection realm. The marketplace trades all of them via `collectionID` (one static import).
- **Marketplace iteration is cheap; collection is forever:** a marketplace redeploy loses only the order book (ephemeral; re-listing is a user action; history preserved off-chain). Migrate by `Pause`-ing new trades, letting users drain escrow via the pause-exempt exits, registering the new market address, repointing the frontend. The collection (and the NFTs) never move.
- **Marketplace authorization via allowlist (not const):** lets `memba_nft_market_v3` be authorized on the unchanged collection by registering its address — no collection redeploy.
- **teller-grc721 migration (if it lands upstream):** keep `MarketTransfer` the *only* market transfer path and expose the full standard `IGRC721`+`IGRC2981` surface; a future teller-based marketplace is just a new registered market — zero collection redeploy.

---

## 12. Roadmap

- **v1 (this build):** multi-collection registry realm (curated/multisig-mint) + marketplace (fixed-price + offers + royalties + fees, atomic) + Go indexer + frontend rewire + placeholder test13 drop.
- **v2:** collection offers, sweep/floor-buy, bundles, allowlist/Merkle mint phases, Dutch auctions (primary drops), rarity/trait analytics, watchlists, notifications (reuse alerts infra).
- **v3:** English auctions (anti-snipe + min-increment), on-chain reputation / DAO-curated drops (memba_dao), escrow_v2/tokenfactory_v2/feedback integrations, GRC20-priced listings, multi-collection registry marketplace (closest feasible to generic until gno gets dynamic dispatch).

### Roadmap economic footguns (pre-build each)
- Public/allowlist mint: separate mint-fee custody from marketplace escrow; refund path for failed/over-cap mints; per-wallet caps + sealed/random token assignment vs front-running.
- Dutch auction: `start - ((start-end)*elapsed)/duration`, clamp `≥ end ≥ MinPrice`, settle at buy-block price, guard `duration>0` + overflow.
- English auction: refund prior bidder atomically; `newBid ≥ cur*105/100` and `≥ cur+MinPrice`; anti-snipe extension.
- Royalty evasion becomes material post-public-mint — decide enforced-on-platform vs "creator-supported" messaging before then.

---

## 13. Open content TODOs (user-supplied, non-blocking for test13)
- Final flagship collection: name, symbol, supply, mint recipients, IPFS art/metadata source.
- Confirm royalty recipient (default = multisig) and royaltyBPS for the flagship.
- Confirm exact multisig address constant for `AdminAddress`/fee recipient.

---

## 14. Anti-features / YAGNI
Generic any-collection trading (not feasible in gno); on-chain analytics/rarity/search (belongs off-chain); on-chain order-book aggregation; complex auctions in v1; public/allowlist mint machinery in v1; fiat on-ramp / NFT financialization. Defend against: wash trading (keep self-buy guard; backend flags round-trips), royalty evasion (no ungated transfer path), predatory dust offers (MinPrice + clear escrow/expiry UX), stuck escrow (value-exit fns), stale listings (re-check ownership in `MarketTransfer`), metadata rug (pin immutable IPFS CIDs in backend).
