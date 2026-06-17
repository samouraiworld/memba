# Canonical Collection Registry — ABI Spec v2 (audit-hardened, the one irreversible deploy)

**Status:** v2 — incorporates the 3-lens adversarial audit (security/interrealm, upgradeability/governance, economics/launchpad). Supersedes v1 draft (`CANONICAL_COLLECTION_ABI.v1-draft.bak`). **Re-audit this v2 before writing realm code.** Phase 2 of [`NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md`](./NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md).
**Why frozen-correct matters:** gno realms are immutable; a collection realm that holds NFTs can never be redeployed without orphaning them. Every field, function, AND emitted event below is part of the permanent surface.
**Proposed path:** `gno.land/r/samcrew/memba_collections` (name-neutral). Dual-imports with live `memba_nft_v2` (3 genesis tokens keep trading there; zero orphaning).

---

## 0. Audit resolutions (what changed from v1, and why)

| # | Audit finding | Resolution (frozen) |
|---|---|---|
| C-1/C-2 | grc721 per-token royalty = percent/100, 100% cap, owner-only setter — wrong unit, breaks moat, wrong auth | **Do per-token royalty IN-REALM as BPS.** Use the **metadata** composite (`grc721.NewNFTWithMetadata`, no royalty path) + in-realm `tokenRoyalty` table. Never call grc721 royalty methods. |
| C-3/F7 | `MarketTransfer` enforces no royalty; "on-chain invariant" overstated | **Keep `MarketTransfer(from,to,tid)` minimal & FINAL.** Royalty/fees are **engine-enforced**; the moat = "only *registered* engines can move tokens." Documented as a trust boundary, not an absolute invariant. Economics come from engine `PurchaseConfirmed{...,denom}` events; the indexer joins them. |
| H-1 | curated `Mint(tid)` collides with auto-counter | **All mints auto-assign** `tid = itoa(nextAutoTokenID++)`. Admin cannot pick `tid`. Collision class removed. |
| H-2/M-2 | grc20-mint CEI/reentrancy; Merkle replay | **CEI frozen** (checks→effects→interactions) + a `mintGuard` reentrancy flag. Merkle: tagged-hash, leaf `=sha256(0x00‖addr‖":"‖maxQty)`, qty enforced via `mintedByWallet`. |
| H-3/F2 | native vs GRC20 proceeds inconsistent; GRC20 bypasses realm | **Both denoms transit the realm.** Per-collection, per-denom `proceeds` ledger; `WithdrawProceeds(id,denom)` → fixed-at-create `mintCustody`; CEI-zeroed. |
| H-4 | `Burn` no owner-check, leaves stale royalty | Wrapper checks `caller==OwnerOf(tid)`; clears in-realm `tokenRoyalty[tid]`. (tid never reused — counter only increments.) |
| M-5 | single `platformAdmin` can't do "fast multisig pause under DAO" | **Separate `pauser` role** (multisig) distinct from `platformAdmin` (→ DAO). |
| Upgrade | no extensible per-collection field for DAO badge/flags | **`meta avl.Tree` per collection** + `SetCollectionMeta`/`GetCollectionMeta` (platformAdmin). |
| Upgrade | lost/compromised creator key bricks a collection | **`ForceSetCollectionAdmin`** (platformAdmin break-glass, event-logged). |
| F1 | no platform primary-cut lever (permanent 0% ceiling) | **`primaryFeeBPS` platform param, default 0** + split in both mint branches. |
| F3 | flat global `collectionID` namespace → squatting | **Namespaced key:** collectionID derived as `caller.String()+"/"+slug`. |
| F4 | mint events lack anti-sybil fields | **Frozen event schema** (§6) with minter/payer/price/denom/phase/isSelfMint/count. |
| F5 | open `payDenom` → fake-volume/malicious tokens | **`allowedDenoms` allowlist gate** (platformAdmin), checked in `SetMintConfig`. payDenom field stays open in ABI; the gate is the control. |
| F6 | royalty band not encoded | `DefaultRoyaltyBPS=500`, `maxCreatorRoyaltyBPS=750` (tunable), `MaxRoyaltyBPS=1000` hard. |
| F8 | maxPerWallet not a sybil guard | Keep as UX guard; reserve `mintStartBlock`/`mintCooldownBlocks` per collection (anti-bot); reputation gating via allowlist root is the real sybil seam. |
| F12/econ | truncation, overflow | `MinMintPrice=1000`, `MaxPriceUgnot=1e15`, `overflow.Mul64p`. |
| L-2 | RoyaltyInfo pays zero-addr | Return `("",0)` when `bps==0 || recip==""`. |
| L-1 | foreign nft impl injection | No `SetNFTImpl`, ever (frozen invariant). |

---

## 1. Design anchors (unchanged, verified)
- grc721 = Reader/Writer split; writes take explicit `caller`; realm holds the concrete pointer behind an unexported `membaNFT` interface; derive `caller := unsafe.PreviousRealm().Address()` in crossing wrappers. **Use `grc721.NewNFTWithMetadata(0, cur, name, symbol)`** (metadata composite — royalty handled in-realm).
- **Moat:** `MarketTransfer` is the ONLY token-movement path; no public `TransferFrom`/gift/airdrop, ever.
- No dynamic dispatch → the marketplace statically imports this realm, routes by `collectionID`.
- `IsUserCall()` guard on every fn trusting `OriginSend` OR a grc20 approval (both mint branches).
- No persisted `realm` values.

## 2. State
```go
const (
    MaxRoyaltyBPS        = 1000          // 10% hard cap (defensive)
    DefaultRoyaltyBPS    = 500           // 5% applied when creator passes 0
    MinMintPrice         = 1000          // 0.001 GNOT — anti-truncation
    MaxPriceUgnot        = 1_000_000_000_000_000
)
// platform (mutable; → memba_dao executor on mainnet)
var platformAdmin address
var pendingPlatformAdmin address
var pauser address                       // SEPARATE fast-pause role (multisig), mutable
var feeRecipient address                 // DAO treasury (createFee + primaryFee sink)
var createFee int64                      // anti-spam launch fee (tunable; default 1 GNOT)
var primaryFeeBPS int64                  // platform cut on primary mints (tunable; DEFAULT 0)
var maxCreatorRoyaltyBPS int64           // creator-set royalty cap (tunable; default 750)
var allowedDenoms avl.Tree               // denom key -> bool  (curated mint-payment tokens; seed "ugnot")
var registeredMarkets avl.Tree           // marketAddr -> bool  (DRAIN KEY)
var paused bool                          // global (pauser/platformAdmin)
var collections avl.Tree                 // collectionID ("creator/slug") -> *collection

type collection struct {
    nft             membaNFT             // *grc721.metadataNFT (internal ledger) via composite iface
    creator         address              // immutable record of who launched it
    admin           address              // mutable (2-step transfer; platformAdmin break-glass)
    pendingAdmin    address
    // royalty — ALL in-realm, BPS
    royaltyRecip    address
    royaltyBPS      int64                // collection default, <= maxCreatorRoyaltyBPS
    tokenRoyalty    avl.Tree             // tokenId -> {recip address, bps int64}  (per-token override)
    // mint config
    phase           int                  // 0 draft, 1 allowlist, 2 public, 3 closed
    allowlistRoot   string               // hex sha256 root (tagged-hash, leaf=sha256(0x00‖addr‖":"‖maxQty))
    mintPrice       int64                // [MinMintPrice, MaxPriceUgnot]
    payDenom        string               // "" / "ugnot" = native; else an allowedDenoms key
    maxSupply       int64                // 0 = unlimited
    maxPerWallet    int64                // 0 = unlimited (UX guard, not sybil)
    mintStartBlock  int64                // 0 = open; else mint allowed only at/after this height
    mintCooldownBlocks int64             // 0 = none; per-wallet cooldown between mints (anti-bot)
    mintedByWallet  avl.Tree             // minter -> count
    lastMintBlock   avl.Tree             // minter -> last mint height (cooldown)
    nextAutoTokenID int64                // sequential id for ALL mints
    mintCustody     address              // fixed-at-create creator sink for withdrawn proceeds
    proceeds        avl.Tree             // denom -> accrued creatorAmt (withdraw to mintCustody)
    paused          bool                 // per-collection (admin/pauser/platformAdmin)
    mintGuard       bool                 // reentrancy guard for mint/withdraw
}
```

## 3. Public API
**Launchpad (open, fee-gated):** `CreateCollection(cur, slug, name, symbol string, royaltyBPS int64, royaltyRecip, mintCustody address, maxSupply, maxPerWallet int64)` — IsUserCall; !paused; `OriginSend ugnot >= createFee` → feeRecipient; `collectionID = caller+"/"+slug` (unique); valid slug/name/symbol; `royaltyBPS` defaulted to 500 if 0, clamped to `maxCreatorRoyaltyBPS`; `creator=admin=caller`; constructs nft via `NewNFTWithMetadata(0,cur,…)`. `SetCollectionAdmin`/`AcceptCollectionAdmin` (2-step).
**Collection config (admin):** `SetMintPhase(id,phase,allowlistRoot)`, `SetMintConfig(id,mintPrice,payDenom,maxPerWallet,mintStartBlock,mintCooldownBlocks)` (payDenom ∈ allowedDenoms; price in range), `SetRoyalty(id,recip,bps)` (≤maxCreatorRoyaltyBPS), `SetTokenRoyalty(id,tid,recip,bps)` (in-realm table; ≤maxCreatorRoyaltyBPS), `PauseCollection`/`UnpauseCollection`, `WithdrawProceeds(id,denom)` (CEI-zeroed → mintCustody).
**Mint (auto-assigned tid, CEI + mintGuard):** `Mint(id, to, tokenURI)` (admin, no payment); `MintPublic(id, tokenURI)` (phase 2; pays mintPrice in payDenom; caps + start/cooldown; split primaryFee; refund overpay native); `MintAllowlist(id, proof []string, maxQty, tokenURI)` (phase 1; tagged-Merkle verify of `(caller,maxQty)`; per-wallet qty). All: minter = `PreviousRealm()`; isSelfMint = `minter==admin||minter==royaltyRecip`.
**Owner:** `Approve`, `SetApprovalForAll`, `Burn(id,tid)` (caller must own; clears tokenRoyalty[tid]).
**Settlement (registered-market only):** `MarketTransfer(cur, id, from, to, tid)` — FINAL minimal signature; registered-market gate; `c.nft.TransferFrom(caller,from,to,tid)`; no receiver callback.
**Platform governance:** `RegisterMarket`/`UnregisterMarket` (platformAdmin, drain key, event-logged), `Pause`/`Unpause` (**pauser** OR platformAdmin), `SetCreateFee`/`SetPrimaryFeeBPS`/`SetFeeRecipient`/`SetMaxCreatorRoyaltyBPS`/`AllowDenom`/`DisallowDenom` (platformAdmin), `SetPauser` (platformAdmin), `TransferPlatformAdmin`/`AcceptPlatformAdmin` (2-step), `ForceSetCollectionAdmin(id,newAdmin)` (platformAdmin break-glass, event-logged), `SetCollectionMeta(id,key,value)`/`GetCollectionMeta(id,key)` (platformAdmin write).
**Reads:** standard `IGRC721Reader` + `TokenURI` + `RoyaltyInfo(id,tid,salePrice)→(recip,amount)` (in-realm; per-token override; `("",0)` if disabled; `overflow.Mul64p`/10000) + `CollectionInfo`/`MintInfo`/`IsRegisteredMarket`/`Render` (**paginated** mux).

## 4. Payment / proceeds (unified, both denoms transit the realm)
`MintPublic`/`MintAllowlist`: compute `platformCut = mintPrice*primaryFeeBPS/10000` (overflow-safe), `creatorAmt = mintPrice - platformCut`. **Native (`payDenom`∈{"","ugnot"})**: minter `OriginSend`s ≥ mintPrice (IsUserCall guard); effects; `proceeds["ugnot"] += creatorAmt`; send platformCut→feeRecipient; refund overpay→minter (banker). **GRC20**: look up token via `grc20reg`; effects; `teller.TransferFrom(minter → realm, mintPrice)`; `proceeds[denom] += creatorAmt`; `teller.Transfer(realm → feeRecipient, platformCut)` (exact pull, no overpay). `WithdrawProceeds(id,denom)`: admin; zero `proceeds[denom]` (CEI) then send to `mintCustody` (banker for ugnot / grc20 teller for tokens). `mintGuard` wraps mint + withdraw.

## 5. Merkle allowlist (frozen verifier)
`leaf = sha256(0x00 ‖ addr ‖ ":" ‖ itoa(maxQty))`; internal `node = sha256(0x01 ‖ sortedConcat(l,r))` (domain-separated, sorted-pair → second-preimage safe). `MintAllowlist` reconstructs the leaf from `(caller,maxQty)`, verifies against `allowlistRoot`, enforces `mintedByWallet[caller] + 1 <= maxQty` before mint. Reputation gating (gnolove/badges) is computed off-chain into the root — broadens trust, doesn't gate public-phase access.

## 6. FROZEN event schema (immutable — the indexer/points ledger depends on it)
Emit (exact keys): `CollectionCreated`(collectionID,creator,name,symbol,royaltyBPS,royaltyRecip,maxSupply,createFee,block) · `Mint`/`MintPublic`/`MintAllowlist`(collectionID,tokenId,minter,payer,price,denom,phase,isSelfMint,mintedAfter,block) · `Burned`(collectionID,tokenId,owner) · `RoyaltySet`(collectionID,bps,recip) · `TokenRoyaltySet`(collectionID,tokenId,bps,recip) · `MintConfigChanged`(collectionID,mintPrice,payDenom,phase) · `ProceedsWithdrawn`(collectionID,denom,amount,to) · `CollectionAdminTransferred`/`...Accepted` · `ForceAdminSet`(collectionID,newAdmin) · `PlatformAdminTransferred`/`...Accepted` · `PauserSet` · `MarketRegistered`/`MarketUnregistered`(market) · `Paused`/`Unpaused`/`CollectionPaused`/`CollectionUnpaused` · `CollectionMetaSet`(collectionID,key,value) · `MarketTransfer`(collectionID,from,to,tokenId) · platform-param-change events. (Secondary-sale economics — price/fee/royalty/denom — come from the market engine's `PurchaseConfirmed`/`OfferAccepted`; the indexer joins by collectionID+tokenId.)

## 7. Security invariants (carry + audit additions)
Drain-key (RegisterMarket) platformAdmin-only+events · MarketTransfer the ONLY transfer path, in-realm verified, no callback · no ungated transfer ever · IsUserCall on both mint branches · in-realm BPS royalty, clamped, never grc721's path · CEI everywhere + mintGuard · caps before mint, auto tid (no collision) · separated mintCustody · curated allowedDenoms · trust boundary: registered engines are trusted to honor RoyaltyInfo (drain-key governance is the protection) · no SetNFTImpl · Render paginated.

## 8. Migration
Deploy `memba_collections`; engines statically import BOTH it and live `memba_nft_v2`, routing by collectionID; genesis tokens keep trading on the old realm. "We got it wrong" recovery = new registry + dual-import + frontend repoint (zero orphaning) — the safety net that makes these fixes "cheap now" not "fatal if missed."

## 9. Recommended platform params (launch)
`createFee=1 GNOT` · `primaryFeeBPS=0` (lever to ~250–500 later) · `maxCreatorRoyaltyBPS=750` · `DefaultRoyaltyBPS=500` · `MaxRoyaltyBPS=1000` · `allowedDenoms={ugnot}` (add $MEMBA + bridged stables later) · secondary fee = **engine-side**, set the next engine to 200 bps (2.0%) per strategy (currently 250 live — reconcile). pauser=multisig; platformAdmin=multisig→DAO executor.

## 10. Open for re-audit
(1) Confirm the in-realm royalty redesign closes C-1/C-2 fully and `RoyaltyInfo`'s frozen output semantics are right. (2) Confirm the unified per-denom proceeds + primaryFee split has no fund-loss/double-withdraw (re-audit F2/H-3 interaction). (3) Confirm the frozen event schema (§6) is complete for the points ledger. (4) Confirm `MarketTransfer` staying minimal (royalty engine-side) is the accepted permanent trust model. (5) Confirm namespaced `collectionID` + `allowedDenoms` close the squatting/fake-volume vectors.
