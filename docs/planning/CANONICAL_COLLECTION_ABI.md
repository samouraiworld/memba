# Canonical Collection Registry — ABI Spec v3 (build-ready, the one irreversible deploy)

**Status:** v3 — incorporates the v2 re-audit (security + completeness/economics adversarial passes). v2 surfaced **2 HIGH blockers** + a set of must-fix-before-code items; all are resolved below. This is the **build-ready freeze**. Phase 2 of [`NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md`](./NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md).
**Why frozen-correct matters:** gno realms are immutable; a collection realm that holds NFTs can never be redeployed without orphaning them. Every field, function, AND emitted event below is part of the permanent surface.
**Proposed path:** `gno.land/r/samcrew/memba_collections` (name-neutral). Dual-imports with live `memba_nft_v2` (3 genesis tokens keep trading there; zero orphaning).

---

## 0. Audit resolutions

### 0.a — v1 → v2 resolutions (carried, still in force)

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
| F5 | open `payDenom` → fake-volume/malicious tokens | **`allowedDenoms` allowlist gate** (platformAdmin), checked in `SetMintConfig`. |
| F6 | royalty band not encoded | `DefaultRoyaltyBPS=500`, `maxCreatorRoyaltyBPS=750` (tunable), `MaxRoyaltyBPS=1000` hard. |
| F8 | maxPerWallet not a sybil guard | UX guard; `mintStartBlock`/`mintCooldownBlocks` (anti-bot); allowlist root is the real sybil seam. |
| F12/econ | truncation, overflow | `MinMintPrice=1000`, `MaxPriceUgnot=1e15`, `overflow.Mul64p`. |
| L-2 | RoyaltyInfo pays zero-addr | Return `("",0)` when royalty disabled (see §3a precedence). |
| L-1 | foreign nft impl injection | No `SetNFTImpl`, ever (frozen invariant). |

### 0.b — v2 re-audit resolutions (NEW — must-fix-before-code, all closed below)

| # | Re-audit blocker / must-fix | Resolution (frozen in v3) |
|---|---|---|
| **B-1 (HIGH)** | GRC20 proceeds path under-specified → potential reentrancy / wrong spender | **CEI order frozen** (§4): credit `proceeds[denom] += creatorAmt` and bump ALL counters (`mintedByWallet`, `lastMintBlock`, `nextAutoTokenID`) and mint the token **BEFORE any teller call**. GRC20 uses **`RealmTeller`** (realm is the spender), NOT `CallerTeller`. Minter **MUST `Approve(realm, mintPrice)`** on the grc20 token first — frozen UX prerequisite (frontend builds the Approve msg ahead of the GRC20 mint). |
| **B-2 (HIGH)** | `slug` unvalidated → `creator/slug` collectionID spoof (embed `/` or `:`) | **Slug charset FROZEN: `^[a-z0-9-]{1,64}$`** (lowercase alnum + hyphen, 1–64 chars). Rejects `/`, `:`, uppercase, empty, >64. Validated in `CreateCollection` before deriving `collectionID = caller.String()+"/"+slug`. |
| S-1 | royalty override precedence + `bps==0` ambiguity (absent vs explicit-zero) | **Frozen precedence (§3a):** per-token override is a *presence* check on `tokenRoyalty[tid]`; if present it fully wins (even `bps==0` → royalty intentionally off for that token). If absent, fall back to collection `royaltyBPS`/`royaltyRecip`. `RoyaltyInfo` returns `("",0)` whenever the resolved `bps==0 || recip==""`. |
| S-2 | `maxSupply` enforced on `TokenCount()` → Burn frees a slot → over-mint | **Gate on mint count (`nextAutoTokenID`), never `TokenCount()`.** `maxSupply>0` requires `nextAutoTokenID < maxSupply` before mint. Burns never reopen supply. |
| S-3 | `primaryFeeBPS` setter unbounded → `MaxPriceUgnot*primaryFeeBPS` can overflow int64 → `Mul64p` panic (mint DoS) | **`SetPrimaryFeeBPS` rejects `bps > MaxPrimaryFeeBPS=2000` (20%).** Bound chosen so `1e15 * 2000 = 2e18 < math.MaxInt64 (≈9.2e18)`; no overflow path reachable. Also `bps>=0`. |
| S-4 | `membaNFT` interface not frozen → may not compile against `*metadataNFT` | **Frozen interface (§1a) lists ONLY methods `*grc721.metadataNFT` actually implements** — NO royalty methods. |
| S-5 | Merkle leaf address encoding ambiguous (raw 20-byte vs bech32) | **Frozen: leaf uses the bech32 STRING form** `addr.String()` (e.g. `g1…`), not raw bytes. Off-chain tree builder MUST match. |
| E-1 | platform-param changes not individually event-logged | **Enumerated param events (§6):** `CreateFeeSet`/`PrimaryFeeBPSSet`/`MaxCreatorRoyaltyBPSSet`/`FeeRecipientSet`/`DenomAllowed`/`DenomDisallowed`, each with `old,new,block` (denoms: `denom,block`). |
| E-2 | phase change buried in `MintConfigChanged`; caps not in event | **Split `MintPhaseSet`(id,phase,allowlistRoot,block)** + **widen `MintConfigChanged`** to carry every cap (mintPrice,payDenom,maxPerWallet,maxSupply,mintStartBlock,mintCooldownBlocks,block). |
| E-3 | mint event lacks fee breakdown for points/accounting | **Add `primaryFee` + `creatorAmt`** to the `MintPublic`/`MintAllowlist` events. |
| E-4 | name/symbol could be mistaken for identity | **Frozen doc note (§3):** `name`/`symbol` are **cosmetic only**. Identity = `collectionID` (`creator/slug`). No uniqueness on name/symbol. |
| E-5 | denom could be disallowed after `SetMintConfig` but before mint | **Re-check `allowedDenoms[payDenom]` at mint time** (not only in `SetMintConfig`), so a `DisallowDenom` freezes new mints in that denom immediately. |
| E-6 | zero-value transfers when `primaryFeeBPS==0` | **Guard:** skip the `platformCut` transfer entirely when `platformCut==0` (both native and grc20). |
| E-7 | royalty floor | **`MinCreatorRoyaltyBPS=0`** documented (0 = creator opts out; allowed). `DefaultRoyaltyBPS=500` applied ONLY when creator passes the sentinel (see §3 CreateCollection). |
| E-8 | mintGuard scope | **`mintGuard` wraps mint AND the overpay refund** (native branch), closing refund-reentrancy. |

> **Engine-side (NEXT engine realm, not this one — tracked for the marketplace v3 build):** secondary `FeeBPS` 250→**200** (strategy alignment); add `denom` to all settlement events; **dedupe** `OfferAccepted`+`TokenSold` so the indexer doesn't double-count a single fill. Not part of `memba_collections`.

---

## 1. Design anchors (verified)
- grc721 = Reader/Writer split; writes take explicit `caller`; realm holds the concrete pointer behind an unexported `membaNFT` interface; derive `caller := unsafe.PreviousRealm().Address()` in crossing wrappers. **Use `grc721.NewNFTWithMetadata(0, cur, name, symbol)`** (metadata composite — royalty handled in-realm).
- **Moat:** `MarketTransfer` is the ONLY token-movement path; no public `TransferFrom`/gift/airdrop, ever.
- No dynamic dispatch → the marketplace statically imports this realm, routes by `collectionID`.
- `IsUserCall()` guard on every fn trusting `OriginSend` OR a grc20 approval (both mint branches).
- No persisted `realm` values.

### 1a. FROZEN `membaNFT` interface (verified against vendored `*grc721.metadataNFT` — NO royalty methods)
```go
// Exactly the subset of *grc721.metadataNFT the realm calls, VERIFIED against
// grc721_metadata.gno. Uses grc721.TokenID/TokenURI types. Note: Burn takes NO
// caller (realm must own-check first); SetTokenURI returns (bool, error).
// Adding a royalty method would break the metadata-composite assignment — do not.
type membaNFT interface {
    Name() string
    Symbol() string
    TokenCount() int64                                              // reads only; NOT supply gating (S-2)
    BalanceOf(owner address) (int64, error)
    OwnerOf(tid grc721.TokenID) (address, error)
    GetApproved(tid grc721.TokenID) (address, error)
    IsApprovedForAll(owner, operator address) bool
    TokenURI(tid grc721.TokenID) (string, error)
    Mint(to address, tid grc721.TokenID) error                      // no caller (mint authority = realm wrapper)
    Approve(caller, to address, tid grc721.TokenID) error
    SetApprovalForAll(caller, operator address, approved bool) error
    TransferFrom(caller, from, to address, tid grc721.TokenID) error
    SetTokenURI(caller address, tid grc721.TokenID, tURI grc721.TokenURI) (bool, error)
    Burn(tid grc721.TokenID) error                                  // NO caller — wrapper own-checks (H-4)
}
```

## 2. State
```go
const (
    MaxRoyaltyBPS         = 1000          // 10% hard cap (defensive)
    DefaultRoyaltyBPS     = 500           // 5% applied when creator passes the sentinel (-1)
    MinCreatorRoyaltyBPS  = 0             // creators may opt fully out
    MinMintPrice          = 1000          // 0.001 GNOT — anti-truncation
    MaxPriceUgnot         = 1_000_000_000_000_000        // 1e15
    MaxPrimaryFeeBPS      = 2000          // 20% — bounds primaryFeeBPS so MaxPriceUgnot*bps < MaxInt64
    RoyaltySentinel       = -1            // CreateCollection: "use DefaultRoyaltyBPS"
)
// platform (mutable; → memba_dao executor on mainnet)
var platformAdmin address
var pendingPlatformAdmin address
var pauser address                       // SEPARATE fast-pause role (multisig), mutable
var feeRecipient address                 // DAO treasury (createFee + primaryFee sink)
var createFee int64                      // anti-spam launch fee (tunable; default 1 GNOT)
var primaryFeeBPS int64                  // platform cut on primary mints (tunable; DEFAULT 0; <= MaxPrimaryFeeBPS)
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
    tokenRoyalty    avl.Tree             // tokenId -> {recip address, bps int64}  (per-token override; PRESENCE wins)
    // mint config
    phase           int                  // 0 draft, 1 allowlist, 2 public, 3 closed
    allowlistRoot   string               // hex sha256 root (tagged-hash, leaf=sha256(0x00‖addr.String()‖":"‖maxQty))
    mintPrice       int64                // [MinMintPrice, MaxPriceUgnot]
    payDenom        string               // "" / "ugnot" = native; else an allowedDenoms key
    maxSupply       int64                // 0 = unlimited; gate on nextAutoTokenID (NOT TokenCount)
    maxPerWallet    int64                // 0 = unlimited (UX guard, not sybil)
    mintStartBlock  int64                // 0 = open; else mint allowed only at/after this height
    mintCooldownBlocks int64             // 0 = none; per-wallet cooldown between mints (anti-bot)
    mintedByWallet  avl.Tree             // minter -> count
    lastMintBlock   avl.Tree             // minter -> last mint height (cooldown)
    nextAutoTokenID int64                // sequential id for ALL mints; ALSO the supply counter
    mintCustody     address              // fixed-at-create creator sink for withdrawn proceeds
    proceeds        avl.Tree             // denom -> accrued creatorAmt (withdraw to mintCustody)
    meta            avl.Tree             // extensible per-collection flags (platformAdmin) — DAO badge etc.
    paused          bool                 // per-collection (admin/pauser/platformAdmin)
    mintGuard       bool                 // reentrancy guard for mint + withdraw + refund
}
```

## 3. Public API
> **name/symbol are cosmetic only** (E-4). Collection identity is `collectionID = creator/slug`; no uniqueness check on name or symbol.

**Launchpad (open, fee-gated):** `CreateCollection(cur, slug, name, symbol string, royaltyBPS int64, royaltyRecip, mintCustody address, maxSupply, maxPerWallet int64)` — IsUserCall; !paused; **slug matches `^[a-z0-9-]{1,64}$`** (B-2); `OriginSend ugnot >= createFee` → feeRecipient; `collectionID = caller.String()+"/"+slug` (must be unique); `royaltyBPS == RoyaltySentinel(-1)` → `DefaultRoyaltyBPS`, else clamp to `[MinCreatorRoyaltyBPS, maxCreatorRoyaltyBPS]`; `creator=admin=caller`; constructs nft via `NewNFTWithMetadata(0,cur,…)`. `SetCollectionAdmin`/`AcceptCollectionAdmin` (2-step).
**Collection config (admin):** `SetMintPhase(id,phase,allowlistRoot)`, `SetMintConfig(id,mintPrice,payDenom,maxSupply,maxPerWallet,mintStartBlock,mintCooldownBlocks)` (payDenom ∈ allowedDenoms at config time; price ∈ range), `SetRoyalty(id,recip,bps)` (∈[Min,maxCreatorRoyaltyBPS]), `SetTokenRoyalty(id,tid,recip,bps)` (in-realm table; ≤maxCreatorRoyaltyBPS), `ClearTokenRoyalty(id,tid)` (removes override → falls back to collection default), `PauseCollection`/`UnpauseCollection`, `WithdrawProceeds(id,denom)` (CEI-zeroed → mintCustody).
**Mint (auto-assigned tid, CEI + mintGuard):** `Mint(id, to, tokenURI)` (admin, no payment); `MintPublic(id, tokenURI)` (phase 2; pays mintPrice in payDenom; caps + start/cooldown; **denom re-check** E-5; split primaryFee; refund overpay native); `MintAllowlist(id, proof string, maxQty, tokenURI)` (phase 1; **`proof` = comma-joined hex siblings, split in-realm** — a vm/MsgCall arg cannot encode a `[]string` (VM converts only scalars + base64 `[]byte`), so a `[]string` proof would be uncallable from a wallet; tagged-Merkle verify of `(caller.String(),maxQty)`; per-wallet qty). All: minter = `PreviousRealm()`; isSelfMint = `minter==admin||minter==royaltyRecip`; supply gate on `nextAutoTokenID` (S-2).
**Owner:** `Approve`, `SetApprovalForAll`, `Burn(id,tid)` (caller must own; clears tokenRoyalty[tid]; does NOT reopen supply).
**Settlement (registered-market only):** `MarketTransfer(cur, id, from, to, tid)` — FINAL minimal signature; registered-market gate; `c.nft.TransferFrom(caller,from,to,tid)`; no receiver callback.
**Platform governance:** `RegisterMarket`/`UnregisterMarket` (platformAdmin, drain key, event-logged), `Pause`/`Unpause` (**pauser** OR platformAdmin), `SetCreateFee`/`SetPrimaryFeeBPS`(≤MaxPrimaryFeeBPS, S-3)/`SetFeeRecipient`/`SetMaxCreatorRoyaltyBPS`/`AllowDenom`/`DisallowDenom` (platformAdmin), `SetPauser` (platformAdmin), `TransferPlatformAdmin`/`AcceptPlatformAdmin` (2-step), `ForceSetCollectionAdmin(id,newAdmin)` (platformAdmin break-glass, event-logged), `SetCollectionMeta(id,key,value)`/`GetCollectionMeta(id,key)` (platformAdmin write).
**Reads:** standard `IGRC721Reader` + `TokenURI` + `RoyaltyInfo(id,tid,salePrice)→(recip,amount)` (in-realm; §3a precedence; `overflow.Mul64p`/10000) + `CollectionInfo`/`MintInfo`/`IsRegisteredMarket`/`Render` (**paginated** mux).

### 3a. FROZEN royalty resolution (S-1)
```
resolve(id, tid):
    if tokenRoyalty[id] has key tid:          # PRESENCE wins, even bps==0
        (recip, bps) = tokenRoyalty[id][tid]   # explicit per-token (bps==0 ⇒ royalty OFF for this token)
    else:
        (recip, bps) = (c.royaltyRecip, c.royaltyBPS)   # collection default
RoyaltyInfo: if bps==0 || recip=="" → return ("", 0); else (recip, salePrice*bps/10000 via Mul64p)
```

## 4. Payment / proceeds (unified; CEI frozen; both denoms transit the realm)
`platformCut = overflow.Mul64p(mintPrice, primaryFeeBPS) / 10000`; `creatorAmt = mintPrice - platformCut`.

**CEI ORDER (identical for both denoms, frozen — B-1):**
1. **Checks:** `mintGuard==false` (set true); IsUserCall; !paused (global+collection); phase; `nextAutoTokenID < maxSupply` (if capped); `maxPerWallet`; `mintStartBlock`; cooldown; **`allowedDenoms[payDenom]`** (E-5).
2. **Effects (BEFORE any value movement):** mint token `tid=itoa(nextAutoTokenID)`; `nextAutoTokenID++`; `mintedByWallet[minter]++`; `lastMintBlock[minter]=height`; `proceeds[denom] += creatorAmt`.
3. **Interactions:**
   - **Native** (`payDenom`∈{"","ugnot"}): minter `OriginSend`s ≥ mintPrice (IsUserCall guard); if `platformCut>0` send platformCut→feeRecipient (banker); refund `OriginSend-mintPrice`→minter (banker) — refund inside mintGuard (E-8).
   - **GRC20:** `tok := grc20reg.Get(denom)`; `teller := tok.RealmTeller()` (**realm is spender** — B-1); `teller.TransferFrom(minter, realm, mintPrice)` (requires minter pre-`Approve(realm,mintPrice)` — frozen prereq); if `platformCut>0` `teller.Transfer(feeRecipient, platformCut)` (exact pull, no overpay/refund).
4. `mintGuard=false`.

`WithdrawProceeds(id,denom)`: admin; `amt=proceeds[denom]`; require `amt>0`; **zero `proceeds[denom]` first (CEI)**; then send `amt`→`mintCustody` (banker for ugnot / `RealmTeller().Transfer` for grc20). `mintGuard` wraps it.

## 5. Merkle allowlist (frozen verifier)
`leaf = sha256(0x00 ‖ addr.String() ‖ ":" ‖ itoa(maxQty))` — **bech32 string form of the address** (S-5); internal `node = sha256(0x01 ‖ sortedConcat(l,r))` (domain-separated, sorted-pair → second-preimage safe). `MintAllowlist` reconstructs the leaf from `(caller.String(),maxQty)`, verifies against `allowlistRoot`, enforces `mintedByWallet[caller] + 1 <= maxQty` before mint. Reputation gating (gnolove/badges) is computed off-chain into the root.

## 6. FROZEN event schema (immutable — the indexer/points ledger depends on it)
Emit (exact keys):
- `CollectionCreated`(collectionID,creator,name,symbol,royaltyBPS,royaltyRecip,maxSupply,createFee,block)
- `Mint`(collectionID,tokenId,minter,to,block) — admin no-pay mint
- `MintPublic`/`MintAllowlist`(collectionID,tokenId,minter,payer,price,denom,**primaryFee,creatorAmt**,phase,isSelfMint,mintedAfter,block) — E-3
- `Burned`(collectionID,tokenId,owner)
- `RoyaltySet`(collectionID,bps,recip) · `TokenRoyaltySet`(collectionID,tokenId,bps,recip) · `TokenRoyaltyCleared`(collectionID,tokenId)
- **`MintPhaseSet`(collectionID,phase,allowlistRoot,block)** — E-2
- **`MintConfigChanged`(collectionID,mintPrice,payDenom,maxSupply,maxPerWallet,mintStartBlock,mintCooldownBlocks,block)** — E-2 (all caps)
- `ProceedsWithdrawn`(collectionID,denom,amount,to)
- `CollectionAdminTransferred`/`...Accepted` · `ForceAdminSet`(collectionID,newAdmin)
- `PlatformAdminTransferred`/`...Accepted` · `PauserSet`(old,new)
- `MarketRegistered`/`MarketUnregistered`(market)
- `Paused`/`Unpaused`/`CollectionPaused`/`CollectionUnpaused`
- `CollectionMetaSet`(collectionID,key,value)
- `MarketTransfer`(collectionID,from,to,tokenId)
- **platform-param events (E-1, each old/new/block):** `CreateFeeSet`(old,new,block) · `PrimaryFeeBPSSet`(old,new,block) · `MaxCreatorRoyaltyBPSSet`(old,new,block) · `FeeRecipientSet`(old,new,block) · `DenomAllowed`(denom,block) · `DenomDisallowed`(denom,block)

(Secondary-sale economics — price/fee/royalty/denom — come from the market engine's `PurchaseConfirmed`/`OfferAccepted`; the indexer joins by collectionID+tokenId.)

> **Points → $MEMBA claim (E/6 confirmation):** the claim ledger needs ONLY these events + reads. Points are computed off-chain from `MintPublic`/`MintAllowlist` (primary) and engine settlement (secondary) events; `$MEMBA` claim is a future engine/airdrop that reads the indexed totals. No on-chain points state in `memba_collections` — keeps this irreversible realm minimal.

## 7. Security invariants (carry + v2 re-audit additions)
Drain-key (RegisterMarket) platformAdmin-only+events · MarketTransfer the ONLY transfer path, in-realm verified, no callback · no ungated transfer ever · IsUserCall on both mint branches · in-realm BPS royalty, clamped, never grc721's path · **CEI: effects before interactions, both denoms (B-1)** · **GRC20 = RealmTeller, minter pre-Approve (B-1)** · mintGuard wraps mint+withdraw+refund · **supply gate on nextAutoTokenID, never TokenCount (S-2)** · **slug `^[a-z0-9-]{1,64}$` (B-2)** · **primaryFeeBPS ≤ MaxPrimaryFeeBPS, no overflow (S-3)** · auto tid (no collision) · separated mintCustody · curated allowedDenoms + **mint-time re-check (E-5)** · **zero-value transfer guard (E-6)** · trust boundary: registered engines are trusted to honor RoyaltyInfo (drain-key governance is the protection) · no SetNFTImpl · Render paginated · **membaNFT interface has zero royalty methods (S-4)**.

## 8. Migration
Deploy `memba_collections`; engines statically import BOTH it and live `memba_nft_v2`, routing by collectionID; genesis tokens keep trading on the old realm. "We got it wrong" recovery = new registry + dual-import + frontend repoint (zero orphaning).

## 9. Recommended platform params (launch)
`createFee=1 GNOT` · `primaryFeeBPS=0` (lever to ~250–500 later, ≤2000 hard) · `maxCreatorRoyaltyBPS=750` · `DefaultRoyaltyBPS=500` · `MaxRoyaltyBPS=1000` · `allowedDenoms={ugnot}` (add $MEMBA + bridged stables later) · secondary fee = **engine-side**, set the next engine to 200 bps (2.0%) per strategy (currently 250 live — reconcile in the engine build). pauser=multisig; platformAdmin=multisig→DAO executor.

## 10. Re-audit verdict (v2 → v3)
v2 re-audit returned **2 HIGH blockers (B-1 GRC20 CEI/teller, B-2 slug spoof)** + 8 must-fix-before-code (S-1..S-5, E-1..E-8). All folded in above. **v3 is build-ready.** Implementation order: Task 1 verify `membaNFT` vs vendored `*metadataNFT` → Task 2 state+CreateCollection (slug validation TDD) → Task 3 mint branches (CEI/teller TDD) → Task 4 royalty resolution → Task 5 governance/events → Task 6 Merkle → Task 7 Render/reads.

## 11. BUILD STATUS — realm implemented & tested (2026-06-17)
The `memba_collections` realm is implemented per this v3 freeze in
`samcrew-deployer/projects/memba/realms/memba_collections/` (8 source files:
collection, payment, royalty, config, mint, merkle, transfer, governance,
render). **60 tests green, `gno lint` clean**, CI-classified in deployer
`test.yml`. All v3 blockers/must-fixes covered by tests: slug charset (B-2),
GRC20 RealmTeller + CEI end-to-end (B-1, incl. registry key + minter Approve),
royalty presence-wins incl. explicit-zero (S-1), supply gate on nextAutoTokenID
(S-2), primaryFeeBPS bound (S-3), Merkle 1/2/4-leaf + bad-hex (S-5), MarketTransfer
moat (registered-only + paused), proceeds CEI withdrawal, all governance auth +
param events. **Test-harness note:** `IsUserCall` payable entrypoints are split
into a thin guarded wrapper + an internal helper (explicit caller/sent) so logic
is unit-testable; the bare `IsUserCall` one-liner is verified on-chain (same as
live `memba_nft_market_v2`). PreviousRealm address checks are exercised via
in-package `do*(arg, rlm realm, …)` helpers that `SetRealm(user)` then cross.
**Remaining (user-gated):** (a) multisig deploy — order: `grc721` (already live)
then `memba_collections`; post-deploy config = RegisterMarket(engine) +
AllowDenom(ugnot seeded) + per-creator CreateCollection. (b) launchpad UI +
creator profiles (Phase 2). (c) marketplace engine v3 wiring (statically import
this realm; FeeBPS 250→200; denom in settlement events; dedupe OfferAccepted+TokenSold).
