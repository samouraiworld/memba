# Memba NFT Marketplace — Strategy & Roadmap

**Status:** Strategy locked 2026-06-17 (founder-directed, informed by a 5-lens expert council).
**Builds on:** [`NFT_MARKETPLACE_V2_DESIGN.md`](./NFT_MARKETPLACE_V2_DESIGN.md) (the live v1 realms). This is the strategic layer above it.
**Current live state (test13):** `r/samcrew/memba_nft_v2` (collection, curated mint, 3-token "genesis") + `r/samcrew/memba_nft_market_v2` (fixed-price + offers + atomic settle + 2.5% fee + enforced royalty) + vendored `p/samcrew/grc721`; frontend wired; lightweight indexer built.

---

## 1. Positioning (locked)

> **The open NFT marketplace + launchpad for gno.land.**

Open to **all** creators and collectors (not builders-only). The Magic-Eden model — **open marketplace + open launchpad + a rewards token + multi-token pricing** — adapted to gno.land's strengths. We go broad on funnel while keeping the one structurally uncopyable moat.

**The moat (kept while going broad):**
1. **Enforced, un-bypassable royalties.** `MarketTransfer` is the *only* transfer path → a sale physically cannot skip the royalty leg. The EVM royalty war happened because anyone could `transferFrom` around it; we are immune by construction. *Bonus:* it's a ~7% wash-trade tax, which protects the points program (§4).
2. **Builder identity as a trust layer (not a gate).** gnolove score + gnobuilders badges surface as verification/trust signals on creators and collections — uncopyable, but they *broaden* trust rather than *narrow* access.
3. **Permanent on-chain provenance.**
4. **The composable stack:** marketplace + tokenfactory + escrow + DAO treasury + builder-reputation behind one brand → a creator launch-and-sustain stack no competitor has.

**Invariant (security *and* economic):** **never add an ungated transfer path to any collection, ever.** The moment that breaks, royalty enforcement collapses platform-wide and we're in the race we can't win.

---

## 2. Locked decisions (founder)

| Decision | Choice | Consequence |
|---|---|---|
| Audience | **Open / for all** | builder identity = trust layer, not gate |
| Launchpad model | **A — Memba-hosted registry** | creators launch INTO Memba's collection realm with **delegated per-collection admin**; every launch is atomically tradable on the central marketplace. (Model B, user-deployed independent realms, is a later "advanced/sovereign" option — those are *not* centrally tradable due to gno's no-dynamic-dispatch limit.) |
| Mint/listing pricing | **GNOT + GRC20 now; EVM (ETH/USDC) later via HyperGno** | gno has no native EVM tokens; EVM raises are bridge-gated (HyperGno) → a later phase |
| Incentives | **Points → $MEMBA** (existing tokenomics) | off-chain points now, on-chain claim later; anti-sybil baked in from day one |
| Curation | **Open, with optional DAO-curated badge** | anyone can launch; DAO vote earns a "DAO-Certified" quality badge (trust signal, not a gate) |

---

## 3. Architecture (target)

```
                  memba_dao (governance executor — admin authority, mainnet)
                                     │
   ┌─────── Collection layer (IMMUTABLE truth — design once, never redeploy) ───────┐
   │  memba_nft_v2 (live genesis)        memba_collections (CANONICAL registry)      │
   │   └ trades via MarketTransfer        └ open launchpad: fee-gated CreateCollection│
   │                                        creator-delegated admin, public/allowlist │
   │                                        mint, GRC20 pricing, burn, per-token royalty│
   └────────────────────────────▲───────────────────────────────────────────────────┘
                                 │ registered-market allowlist (drain key; DAO/multisig)
   ┌──────────────────────────────┴──── Market engine layer (versionable, registered) ──────────┐
   │ fixed-price+offers (v2 live)  auction house   sweep/bundle   GRC20-priced desk              │
   └──────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                 │ chain.Emit events
        Off-chain Go backend: event-tailing indexer → discovery/rarity/portfolio + POINTS LEDGER → Frontend
   shared pure pkg: /p/samcrew/memba_market (split math, escrow, Merkle verify, auction curves)
```

Key properties (from the architecture council):
- **~70% of competitive features are market-only** (collection offers, sweep, bundles, auctions, GRC20-desk) → new *registered engine realms*, cheap to deploy/version/kill. No collection redeploy.
- **The collection registry is the one irreversible asset.** Live `memba_nft_v2` is terminal for the launchpad (admin-only mint, dormant phase fields, const admin) → we deploy **one canonical registry** (§5) designed to never redeploy. The 3 genesis tokens keep trading via **dual-collection coexistence** (zero orphaning).
- **Indexer = event-tailing** (block_results → full addresses, real floor, full history, real-time) — also the data source for the points ledger.
- **teller-grc721 migration is near-free** (current `MarketTransfer` is teller-isomorphic) → don't block on the unmerged PRs.

---

## 4. Economic & incentive model

- **Platform fee 2.0%** (→ DAO treasury). **0% on primary mints** + 90-day fee waiver on new launches (creator-acquisition).
- **Enforced royalty, default 5% (5–7.5% creator-set, 10% cap)** — atomic, the headline differentiator. Publish **royalty-bearing net volume** as the honest headline; gross labeled unverified.
- **Open launchpad fee:** small fixed `CreateCollection` fee (anti-spam) → DAO treasury.
- **Points → $MEMBA (anti-sybil by design):**
  - Accrue off-chain in the backend from indexed events (mint / list / buy / sell / accept-offer).
  - **Weighted to royalty-bearing, non-self, non-cluster volume** (enforced royalty already taxes wash ~7%); reputation (gnolove/badges) multipliers; per-wallet caps; indexer cluster/self-trade detection excludes farmed activity.
  - Token-claim is a *later* on-chain step that fits the existing $MEMBA tokenomics.
- **No fee discounts tied to raw trading volume** (that's the wash incentive). Liquidity also via DAO-backed creator revenue guarantees + reputation-gated allowlists + DAO treasury floor-bids.

---

## 5. The canonical collection realm — ABI spec (THE one irreversible deploy)

Design goal: **freeze this ABI forever.** Everything that mints into the ledger or that an engine reads must exist on day one, even if dormant. (4-perspective audit before deploy, like the v2 realms.)

**Per-collection state (registry keyed by `collectionID`):**
```
nft            membaNFT        // composite grc721 (internal ledger)
admin          address         // CREATOR-DELEGATED (mutable) — set at CreateCollection, transferable
royaltyRecip   address; royaltyBPS int64; perTokenRoyalty bool
phase          int             // 0 draft, 1 allowlist, 2 public, 3 closed
allowlistRoot  []byte          // Merkle root (reputation- or address-gated)
mintPrice      int64; payDenom string   // GNOT or a GRC20 token path (pricing hook)
maxSupply, maxPerWallet int64
mintedByWallet avl.Tree        // wallet -> count (enforce maxPerWallet)
nextAutoTokenID int64          // sequential public-mint id assignment
mintCustody    address         // mint-fee custody, SEPARATE from market escrow
paused         bool
```
**Public functions (carry all from day one; gate dormant ones off):**
- Launchpad: **`CreateCollection(cur, …)` — fee-gated, permissionless** (anyone launches; caller becomes `admin`); `SetCollectionAdmin` (transfer/delegate); `SetMintPhase`, `SetRoyalty`, `SetTokenRoyalty`, `SetMintConfig(price, denom, caps)`.
- Mint family: `Mint` (admin/curated), **`MintPublic(cur, id)`** (phase 2; OriginSend GNOT *or* GRC20 transferFrom; caps; refund overpay via `mintCustody`), **`MintAllowlist(cur, id, proof)`** (phase 1; Merkle proof of caller).
- Owner-driven: `Approve`, `SetApprovalForAll`, **`Burn`** (live realm lacks it — irreversible omission).
- Settlement: `MarketTransfer` (byte-identical signature to live → engines port verbatim). **Only transfer path.**
- Registry/governance: `RegisterMarket`/`UnregisterMarket` (drain key, admin/DAO, event-logged), global + per-collection `Pause`.
- Reads: full `IGRC721`+`IGRC2981`+metadata + `MintInfo(id)`, `RoyaltyInfo` honoring per-token override.

**Admin authority:** store `admin` as a **mutable var** (per-collection creator) and a **platform admin** that is DAO-governable on mainnet (the live realm's const admin is why it's terminal). Keep a fast multisig pause for incident response.

---

## 6. Roadmap (phased, with validation gates)

### Phase 1 — "Premium & Honest" (NOW; zero realm risk, on the live genesis collection)
Make the existing marketplace genuinely competitive + lay the moat + the points data layer. All frontend/backend.
- **Event-tailing indexer** (block_results → full addresses, real floor, complete history, real-time) + **IPFS image/metadata proxy + thumbnails** (images must load) + WAL. Replaces Render-scraping for activity/floor.
- **Points-data foundation:** the indexer normalizes the events the points ledger needs (no token yet — token-fit per existing $MEMBA plan).
- **UX overhaul:** kill the `window.prompt()` list flow; image-first cards; **collection stats bar** (floor/volume/listed/royalty); **"My Items" tab** (owned / listed / offers-sent / offers-received with Accept); optimistic tx feedback + tx-hash; NFT error mapping; price formatting; connect-to-trade banner; mobile.
- **Ship the wedge:** **"Royalty enforced on-chain" badge** on every card + buy modal.
- **In parallel:** design + 4-perspective audit the **canonical collection ABI** (§5).
- *Gate:* the genesis collection feels like a real, premium, honest marketplace; indexer serves real-time floor/activity; points events captured.

### Phase 2 — "Open Launchpad" (the front door)
- Deploy the **canonical collection registry** (§5) — open fee-gated `CreateCollection`, creator-delegated admin, public/allowlist Merkle mint, GNOT+GRC20 pricing, burn, per-token royalty. Dual-import with live genesis (zero orphaning).
- **Launchpad UI:** create-collection flow (art/metadata upload → IPFS, royalty, supply, mint phases, GRC20 denom), mint page (public + allowlist proof), creator dashboard.
- **Creator profile panel** (gnolove + badges as trust layer). Ship one real open launch end-to-end.
- *Gate:* an external creator launches a collection and it mints + trades with enforced royalties + points.

### Phase 3 — "Liquidity, pricing depth & rewards"
- **Collection offers + sweep/floor-buy** (engine realms) → secondary liquidity.
- **GRC20-priced listings desk** (engine) — trade in project tokens.
- **English/Dutch auctions** (engine) — drop formats.
- **DAO-curated badge** flow (proposal → vote → "DAO-Certified").
- **Points → $MEMBA on-chain claim** (fit existing tokenomics) + notifications/watchlists (reuse alerts infra) + rarity/trait search at scale.
- *Gate:* a liquid floor forms; rewards loop live; honest volume credible.

### Later
- **EVM-token raises via HyperGno** (bridge) — ETH/USDC funding for launches.
- **Pro-trader surface** (bid-ladder/depth/portfolio P&L) — *only* once organic volume exists.
- **Model B self-hosted collections** (advanced/sovereign).
- **DAO-governed admin** migration on mainnet; teller-grc721 adoption for new collections if it lands upstream.

---

## 7. Anti-features / invariants
- **No ungated transfer path, ever** (the moat — §1 invariant).
- **Never reward raw trading volume** with monetary value (wash incentive); points are royalty-bearing/non-cluster-weighted only.
- **Don't redeploy a collection that holds minted tokens** (orphaning) — iterate engines + backend instead; new supply → new registry collection via dual-import.
- **Don't build pro-trader UI on an empty book.**
- **Generic any-collection trading of arbitrary external realms is not feasible** on gno (no dynamic dispatch) — the registry model (A) is the answer.

---

## 8. Open inputs needed (non-blocking for Phase 1)
- $MEMBA tokenomics params (supply, claim mechanism, points→token conversion) — to finalize the points-claim design in Phase 3.
- HyperGno bridge interface/timeline — to scope EVM-token raises.
- Launchpad fee + per-drop economic defaults (mint price ranges, allowlist policy).
