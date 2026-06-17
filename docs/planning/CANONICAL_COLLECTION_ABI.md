# Canonical Collection Registry — ABI Spec (the one irreversible deploy)

**Status:** DRAFT for adversarial audit — 2026-06-17. Phase 2 of [`NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md`](./NFT_MARKETPLACE_STRATEGY_AND_ROADMAP.md).
**Why this doc exists:** gno realms are immutable. A collection realm that holds minted NFTs can **never** be redeployed without orphaning them. This is the open launchpad's foundation, so its **public ABI + state must be frozen correctly on day one** — every function the roadmap needs (public/allowlist mint, GRC20 pricing, burn, per-token royalty, DAO-governable admin, creator delegation) must exist now, even if gated off. Audit this before writing a line of realm code.

**Proposed path:** `gno.land/r/samcrew/memba_collections` (name-neutral, not version-locked). Coexists with the live `memba_nft_v2` (3 genesis tokens keep trading there) via dual-import; all *new* supply lands here.

---

## 1. Design anchors (verified, non-negotiable)

- **test13 grc721 = Reader/Writer split** (`p/samcrew/grc721`, vendored): the only interface is `IGRC721Reader`; writes are concrete methods on `*royaltyNFT` that take an **explicit `caller address`**; the owning realm holds the concrete pointer (via a local `membaNFT` interface) and exposes `cur`-validating wrappers that derive `caller := unsafe.PreviousRealm().Address()`. Constructor: `grc721.NewNFTWithRoyalty(0, cur, name, symbol)`.
- **The royalty invariant (moat):** `MarketTransfer` is the *only* token-movement path; there is NO public `TransferFrom`/gift/airdrop. Never add one. (Security AND economic invariant.)
- **No dynamic dispatch:** the marketplace statically imports THIS realm and trades all collections in it by `collectionID`. New collections = state writes, never a redeploy.
- **Payment guard:** every function trusting `unsafe.OriginSend()` must guard `unsafe.PreviousRealm().IsUserCall()` (not `IsUser()`).
- **No persisted `realm` values** (gno forbids it); store addresses/strings only.

---

## 2. State

```go
package memba_collections

const (
    MaxRoyaltyBPS   = 1000          // 10% cap on creator royalty
    MaxPriceUgnot   = 1_000_000_000_000_000  // 1e15 overflow guard
    DefaultCreateFee = 1_000_000    // 1 GNOT anti-spam launch fee (admin-tunable)
)

// platformAdmin holds RegisterMarket (drain key), global pause, platform params.
// MUTABLE (seeded at deploy from the deployer); on mainnet → a memba_dao executor addr.
var platformAdmin address
var pendingPlatformAdmin address      // 2-step transfer (propose/accept)
var createFee int64                   // launch fee (admin-tunable), → feeRecipient
var feeRecipient address              // launch-fee + platform-fee sink (DAO treasury)
var paused bool                       // global kill switch (platformAdmin)
var registeredMarkets avl.Tree        // marketAddr.String() -> bool  (DRAIN KEY)

var collections avl.Tree              // collectionID -> *collection

type collection struct {
    nft            membaNFT          // *grc721.royaltyNFT (internal ledger) via composite iface
    admin          address           // CREATOR-delegated admin (mutable, transferable)
    pendingAdmin   address           // 2-step admin transfer
    // royalty
    royaltyRecip   address
    royaltyBPS     int64             // <= MaxRoyaltyBPS (collection default)
    perTokenRoyalty bool             // if true, RoyaltyInfo consults the grc721 per-token table
    // mint config
    phase          int               // 0 draft (admin-mint only), 1 allowlist, 2 public, 3 closed
    allowlistRoot  string            // hex sha256 Merkle root (phase 1)
    mintPrice      int64             // per-token mint price
    payDenom       string            // "" or "ugnot" = native GNOT; else a grc20reg token key
    maxSupply      int64             // 0 = unlimited
    maxPerWallet   int64             // 0 = unlimited
    mintedByWallet avl.Tree          // minter.String() -> count
    nextAutoTokenID int64            // sequential public/allowlist mint id
    mintCustody    address           // mint-proceeds sink (creator withdrawal); SEPARATE from any escrow
    mintProceeds   int64             // accrued native-GNOT proceeds withdrawable by creator (per-collection ledger)
    paused         bool              // per-collection pause (admin or platformAdmin)
}
```

---

## 3. Public API

### 3a. Launchpad (open, fee-gated)
```go
// Permissionless. Caller sends >= createFee ugnot (→ feeRecipient); becomes the collection admin.
func CreateCollection(cur realm, id, name, symbol string, royaltyBPS int64,
                      royaltyRecip address, maxSupply, maxPerWallet int64)
// guards: IsUserCall; !paused; OriginSend ugnot >= createFee; id unique + charset; valid name/symbol;
//         royaltyBPS <= MaxRoyaltyBPS. Sets admin = PreviousRealm(). Emits CollectionCreated.
func SetCollectionAdmin(cur realm, id string, newAdmin address)   // collection admin; 2-step (propose)
func AcceptCollectionAdmin(cur realm, id string)                  // pendingAdmin accepts
```

### 3b. Collection config (collection admin)
```go
func SetMintPhase(cur realm, id string, phase int, allowlistRoot string)  // 0..3
func SetMintConfig(cur realm, id string, mintPrice int64, payDenom string, maxPerWallet int64)
func SetRoyalty(cur realm, id string, recip address, bps int64)           // bps <= MaxRoyaltyBPS
func SetTokenRoyalty(cur realm, id string, tid grc721.TokenID, recip address, bps int64) // per-token
func PauseCollection(cur realm, id string) / UnpauseCollection(cur realm, id string)      // admin OR platformAdmin
func WithdrawMintProceeds(cur realm, id string)  // collection admin pulls mintProceeds (native) to admin; CEI + banker
```

### 3c. Mint
```go
// Curated/admin mint — any phase, no payment. Admin chooses tokenId + URI.
func Mint(cur realm, id string, to address, tid grc721.TokenID, tokenURI string)   // collection admin
// Public mint — phase 2. Pays mintPrice in payDenom; caps enforced; sequential tokenId; refunds overpay (native).
func MintPublic(cur realm, id string, tokenURI string)   // tokenURI optional (admin may set a base later)
//   guards: IsUserCall; !paused && !c.paused; phase==2; supply/ perWallet caps; payment (see §4);
//   tid = nextAutoTokenID++; mints to PreviousRealm(); records mintedByWallet; accrues proceeds.
// Allowlist mint — phase 1. Merkle proof of caller (+ optional max qty) against allowlistRoot.
func MintAllowlist(cur realm, id string, proof []string, maxQty int64, tokenURI string)
//   guards: as MintPublic but phase==1 + verifyMerkle(root, leaf(caller,maxQty), proof) + per-proof qty cap.
```

### 3d. Owner-driven
```go
func Approve(cur realm, id string, operator address, tid grc721.TokenID)       // caller=PreviousRealm
func SetApprovalForAll(cur realm, id string, operator address, approved bool)
func Burn(cur realm, id string, tid grc721.TokenID)                            // owner-only (caller must own)
```

### 3e. Settlement (registered-market only) — THE ONLY TRANSFER PATH
```go
func MarketTransfer(cur realm, id string, from, to address, tid grc721.TokenID)
//   caller := PreviousRealm(); require registeredMarkets[caller]; !paused && !c.paused;
//   c.nft.TransferFrom(caller, from, to, tid) -> grc721 re-verifies owner/approval + clears approval.
//   NO receiver callback. Byte-compatible with the live realm so market engines port verbatim.
```

### 3f. Platform governance (platformAdmin = DAO/multisig)
```go
func RegisterMarket(cur realm, marketAddr address)      // DRAIN KEY — platformAdmin only, event-logged
func UnregisterMarket(cur realm, marketAddr address)
func Pause(cur realm) / Unpause(cur realm)              // global kill switch
func SetCreateFee(cur realm, fee int64)
func SetFeeRecipient(cur realm, addr address)
func TransferPlatformAdmin(cur realm, newAdmin address) // 2-step: propose
func AcceptPlatformAdmin(cur realm)                     // pendingPlatformAdmin accepts (→ DAO executor on mainnet)
```

### 3g. Reads (no `cur`)
`OwnerOf/BalanceOf/GetApproved/IsApprovedForAll/TokenURI(id,…)`, `RoyaltyInfo(id,tid,salePrice)→(recip,amount)` (honors per-token), `CollectionInfo(id)`, `MintInfo(id)→(phase,price,denom,minted,maxSupply,maxPerWallet)`, `IsRegisteredMarket(addr)`, `Render(path)` mux (home / `{id}` / `{id}/{tid}`).

---

## 4. GRC20 pricing design (the multi-token hook)
- `payDenom == "" || "ugnot"` → native: minter `OriginSend`s `mintPrice`; overpay refunded via banker to the minter; `mintProceeds += mintPrice` (creator withdraws via `WithdrawMintProceeds`).
- `payDenom == <grc20reg key>` → GRC20: the realm looks up the token via `grc20reg`, and pulls payment with the grc20 **teller** `TransferFrom(minter → mintCustody, mintPrice)` (minter must have `Approve`d this realm as spender on that token first; the launchpad UI guides a 2-step approve→mint). No native OriginSend in this branch. GRC20 proceeds accrue to `mintCustody` directly (creator-owned). EVM tokens are out of scope until HyperGno bridges them in as GRC20.
- The `payDenom` field + both branches are in the frozen ABI even if v1 enables only native GNOT.

## 5. Allowlist (Merkle) design
- `allowlistRoot` = hex sha256 Merkle root. Leaf = `sha256(addr)` (or `sha256(addr ":" maxQty)` to cap per-address). Proof = ordered sibling hashes; verify with sorted-pair hashing (`crypto/sha256`, pure). Per-address mint count enforced via `mintedByWallet`. Reputation-gated allowlists (gnolove/badges) are computed OFF-chain into the root by the launchpad/DAO.

## 6. Governance & upgrade model
- **platformAdmin is MUTABLE** (the live realm's fatal flaw was a const admin): seeded from the deployer multisig; 2-step transfer to a **memba_dao executor** on mainnet. `RegisterMarket` (drain key), `SetCreateFee`, `SetFeeRecipient`, global pause are platformAdmin-gated.
- **Per-collection admin = creator** (mutable, 2-step transfer) — owns their collection's config/mint/royalty/proceeds.
- **Fast pause** stays multisig-reachable for incident response even under DAO governance.
- **Upgrades:** the registered-market allowlist is the seam — new market engines attach without touching this realm. This realm itself is designed to never redeploy; if a teller-grc721 lands, a *future* collection realm adopts it for *new* supply (dual-import), existing tokens untouched.

## 7. Security invariants (carry from the v1 audits + councils)
1. `RegisterMarket`/`UnregisterMarket` = drain key → platformAdmin-only, event-logged.
2. `MarketTransfer` is the ONLY transfer path; verifies in-realm (grc721 re-checks owner/approval, clears approval); no receiver callback.
3. No ungated transfer/gift/airdrop — ever (royalty moat).
4. `IsUserCall()` guard on all OriginSend-trusting fns (CreateCollection, MintPublic, MintAllowlist).
5. Money math: `MaxPriceUgnot` bound; royalty clamp to `MaxRoyaltyBPS`; `overflow.Mul64p`; refund overpay; no underflow.
6. Per-wallet/supply caps enforced before mint; sequential tokenId is server-blind (front-run-resistant for fungible drops; commit-reveal deferred for "rare-slot" drops).
7. Mint custody SEPARATE from any market escrow; refund path for failed/over-cap mints.
8. CEI on all coin-moving fns (effects before banker sends / cross-calls).
9. Mint auth: curated `Mint` = collection admin; `MintPublic/Allowlist` = the minter is the payer, gated by phase+payment+caps (no admin check) — never current-realm ownable.

## 8. Migration (dual-collection coexistence)
Deploy `memba_collections`; the marketplace (engines) statically import BOTH it and the live `memba_nft_v2`, routing by `collectionID`. The 3 genesis tokens keep trading on `memba_nft_v2` (zero orphaning). All new launches use `memba_collections`. Pre-import a few collection-realm "slots" only if multi-realm scale is anticipated (otherwise this single registry holds N collections).

## 9. Open questions for the audit
- Leaf format for the allowlist (addr-only vs addr+maxQty) and whether per-address qty belongs on-chain.
- Should `mintProceeds` be a per-collection native ledger withdrawn by the creator (as drafted) vs sent immediately to `mintCustody` each mint? (Draft: native accrues + withdraw; GRC20 goes straight to custody. Audit the consistency.)
- Commit-reveal for rare-slot drops — in the frozen ABI now (reserve fns) or a future engine?
- Does `MarketTransfer`'s signature need any addition (e.g. price/denom for on-chain royalty on GRC20-denominated trades) to stay future-proof, given it's byte-frozen?
- Platform fee on secondary sales is enforced by the *market engine*, not here — confirm nothing about it belongs in the collection ABI.
