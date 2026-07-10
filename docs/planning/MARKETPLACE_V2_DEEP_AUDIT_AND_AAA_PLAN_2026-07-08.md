# Memba Marketplace — Deep Audit & AAA New-Version Plan (2026-07-08)

> **Status (updated 2026-07-10):** 🟢 MERGED — Phases 0–8 landed on `main` via **#851** (+ theme-token fixes #868), still behind `VITE_ENABLE_MARKETPLACE_V2` (off in prod; **owner cutover flip pending**). Remaining = Wave E of the next-cycle plan: Phase 5 connect-then-continue + token select (`TokenLane.tsx` TODOs), Phase 6 purchase-gated reviews (deploy-gated on `nft_market_v3_2`), seeding ceremony, item-level browse. The resume handoff is spent → archived at [`archive/shipped-2026-07/MARKETPLACE_V2_HANDOFF_2026-07-09.md`](archive/shipped-2026-07/MARKETPLACE_V2_HANDOFF_2026-07-09.md).
> **Method:** 7-expert cross-perspective panel (Visual/UI · UX/IA · Product/Growth · Business Model · Frontend Architecture · Trust & Safety · A11y/Mobile), each grounded in source (`file:line`) and benchmarked against Fiverr, Upwork, OpenSea, Blur, Magic Eden, Uniswap, Airbnb, Shopify, Stripe, Linear.
> **Scope:** The Memba Marketplace = a unified tabbed shell over 3 asset lanes — **NFT** (live), **Services** (freelance, gated), **Tokens** (OTC, gated) — plus a secondary **Agents** registry and the adjacent **App Store**.
> **Builds on (does NOT relitigate):** the locked *Marketplace Unified Audit v2* SoT — unify the shell only, each lane owns its trade panel, "sell anything" routes by asset type, per-lane fee→DAO spine, never redeploy `tokenfactory_v2`, per-lane safety-gated flags, no "coming soon" tabs.

---

## 0. One-paragraph verdict

Memba has already shipped the **hard, good parts**: a correct unified shell (lazy lanes, live-lane gating, splat-safe redirects, a clean `UnifiedListing` discriminated union), a genuinely tier-1 **fee/royalty transparency** on the NFT trade path, a **DAO-owned per-lane fee spine** better-engineered than most L1 marketplaces, and a **full on-chain reputation/reviews engine**. The failure is not invention — it is **inheritance, wiring, and merchandising**. The App Store (#808) and the `um-hero` already define a tier-1 visual language the *lanes never adopted*. The reputation engine exists but is *plugged into nothing*. The fee spine exists but the *strategy on top is one-dimensional*. The result reads as **three engineers' admin panels behind a shared hero** — and on mobile, the commerce surface is **literally unreachable**. The new version is ~70% wiring/unifying assets Memba already owns and ~30% net-new (seed liquidity, purchase-gated trust, promoted-listing revenue, mobile trade sheet).

---

## 1. Convergent findings (flagged by ≥2 experts = highest confidence)

Ranked by CTO priority. Each cites the experts who independently raised it.

### P0-A — The reputation engine is wired to zero marketplace surfaces *(Trust, Product, UX, Business)*
`memba_reviews_v1.gno` + `lib/reviews.ts` (incl. `fetchReputation`) + `ReviewsSection.tsx` + `StarRating.tsx` are mounted **only** on `ValidatorProfile.tsx:670` and `ProfilePage.tsx:373` — on **no** NFT/Token/Agent/App/Service card or detail. `TradeModal.tsx:356` shows a bare `g1…` seller with **zero** reputation at the sign moment. Trust is the #1 conversion lever (Fiverr seller levels, Airbnb Superhost, Amazon stars-on-every-card) and the **only real cross-lane compounding vector** (business expert: breadth otherwise *fragments* liquidity). **Highest-ROI unshipped asset Memba already owns.**
> **Caveat (Trust P0):** reviews are **not purchase-gated** — `PostReview` (realm:209) lets any free wallet rate any subject; surfacing gameable stars is *worse than none*. Purchase-gating (tie to on-chain settlement, "Verified Purchase") is a prerequisite, not a nice-to-have.

### P0-B — Mobile funnel is broken at both ends that convert *(A11y, UX)*
- Marketplace has **zero mobile nav entry** — not a tab, not in the More sheet, not in ActFab (`navManifest.ts` `PRIMARY_TABS_*`/`MORE_NAV_IDS` L111-117 contain none of `marketplace/nft/services/appstore`; the whole `'launch'` group L77-80 is desktop-sidebar-only). Reachable only via command palette. **Launch blocker; ~1-line fix.**
- `TradeModal.css` has **no `@media`, no max-height, no scroll** — the List-flow Confirm CTA can render **below the fold with no way to scroll to it** → checkout dead-ends on a phone.
- `TradeModal`/`BottomSheet` are **not real dialogs** — `role="dialog"` but no `aria-modal`, no focus trap, no focus restore; keyboard/SR users Tab into the dead page behind an open *transaction* dialog.

### P0-C — Hollow cold-start: hollow lanes shipped as if live *(Product, UX, Business, Trust)*
`ServiceLane` is `SERVICES: Service[] = []`; `AgentLane` renders `SEED_AGENTS` mock **with fabricated ★ ratings + ✓ verified** (`AgentLane.tsx:73` — a cardinal trust violation); `TokenLane` hardcodes `symbol="MEMBATEST"` (`TokenLane.tsx:51`). Only NFT has real supply. Launching 3–4 co-equal empty lanes **divides scarce early liquidity** — the opposite of how Fiverr/OpenSea/Airbnb won (go deep on one behavior first, manufacture the first side of supply). **Fabricated trust signals and demo-tells (`window.location.reload()` `TokenLane.tsx:111`, `MEMBATEST`) must not ship.**

### P0-D — Four design systems where there should be one *(Visual, Frontend, UX, A11y)*
Four card systems (`.k-card` / `.mhub-collection-card` / `.cpub-token-card` / `.appcard`), four grids (300/170/180/240px), radii 12/16/lg. `NftLane.tsx:107-160` uses **inline style objects + JS `onMouseEnter` hover** — which (a) allocates a new style literal per render (kills memoization; the "15s-per-card" driver), (b) has **no touch/keyboard state**, and (c) is an **active light-theme rendering bug** (hardcoded `rgba(255,255,255,0.05)` border vanishes; `rgba(0,0,0,0.4)` hover shadow becomes a black slab). **Monospace monoculture:** JetBrains Mono is on prices, titles, CTAs, tabs, search — reads as a Bloomberg terminal; mono is a *data* typeface (hashes/addresses only). Emoji as nav icons (`LANE_TAB_ICONS`) next to a shipped Phosphor set = amateur tell.

### P0-E — Business model is transaction-fee-only, optimized at GMV ≈ 0 *(Business)*
100% of treasury revenue is a % of GMV during the 12–24 months when GMV is thinnest and rates are being suppressed to attract supply. Every tier-1 marketplace has ≥2 revenue lines (Fiverr: take + Promoted Gigs + Seller Plus; Amazon Sponsored > $50B/yr). The take rate is a **growth dial, not a revenue lever** at this scale (marginal cost/trade ≈ 0 — no Stripe ~3%, no chargebacks, no human arbitration; costs are *fixed*). At $1M GMV, 1.5% = ~$15k/yr — transaction fees don't fund a team until tens of $M GMV.

### P1 — No unified discovery *(UX, Product, Frontend)*
Shell writes `?q` (`UnifiedMarketplace.tsx:156-169`) but **only `NftLane` reads it**, filtering collection *names* only, uncontrolled + undebounced. Zero filters anywhere; sort in NFT only; **no category taxonomy / browse-by-intent** on any lane → no merchandising, no curation surface, no SEO.

### P1 — Data-layer fragility that will not scale *(Frontend)*
Lanes **bypass the configured TanStack Query** (only `MyListingsView` uses it) → raw `useEffect`+`setState`, no cache, refetch-all on every tab switch, N+1 fan-out uncached on mount. Trade reads ride on **unescaped markdown/CSV string-scraping** (`tokenOtcApi.ts:17-31` blind `BigInt()` with no length guard; `agentRegistry.ts` parses markdown tables via a dozen regexes) → one realm-render tweak silently sinks a lane. No virtualization; client-side full-table-scan pagination (`myListings.ts:40-71` pages 2000 global rows).

### P1 — Four front doors + 1,320 lines of dead code *(UX, Frontend)*
Sidebar still exposes separate `marketplace`/`services`/`nft`/`appstore` entries competing with the unified `/marketplace` tabs (`navManifest.ts:77-80`). Orphaned pages `Marketplace.tsx` (318) + `MarketplaceHub.tsx` (292) + `FreelanceServices.tsx` (710) remain on disk; `App.routes.test.tsx` **tests a fiction** (asserts `/nft → MarketplaceHub`, now a redirect — passes only via inline stub routes).

### P1 — Trust at the sign moment *(Trust, A11y)*
`PriceBreakdown` shows *"Seller Receives,"* not an all-in *"You pay X (fee + royalty + gas)."* No slippage/min-received on OTC partial fills (`TokenTradeModal.tsx:100` — stale-quote risk; Uniswap has this). "Leaving Memba" is a **text span** (`AppStore.tsx:148-150`), not a phishing interstitial (no URL shown, no seed-phrase warning) — web3's #1 attack vector. "Verified" is one binary curated flag with **no copymint/impersonation defense** (`NftLane.tsx:55` matches by name, never shows the collection address).

---

## 2. Per-lens tier-1 bar & the gap (condensed)

| Lens | Already tier-1 | The gap to close |
|------|----------------|------------------|
| **Visual/UI** | `um-hero`, App Store #808 masthead/monogram | Lanes never inherited it; kill mono-on-chrome; one card/grid/button/type system; media zone on every card |
| **UX/IA** | NFT price/fee/royalty transparency | Mobile reachability; one front door; honest cross-lane search+filters; connect-then-continue; sell-anything entry |
| **Product** | Unified shell as container | Sequence lanes to liquidity; seed real supply; category taxonomy; first-listing seller funnel; wire reputation |
| **Business** | Fee spine (per-lane, no-redeploy, fail-safe, 5% ceiling) | Non-transaction revenue (promoted + primary-mint); GMV-first public ratchet; per-lane ceiling; FX/treasury policy |
| **Frontend** | Shell, lazy lanes, `UnifiedListing` union | `<ListingCard>`+adapters; TanStack Query everywhere; validated codec; virtualization; delete dead code |
| **Trust** | On-chain reputation engine; fail-closed escrow; link hygiene | Wire + purchase-gate reviews; all-in cost + slippage; leaving-Memba interstitial; copymint defense; dispute path |
| **A11y/Mobile** | `:focus-visible`, 44px targets, `dvh`+safe-area, reduced-motion | Mobile nav entry; mobile trade sheet w/ sticky CTA; real dialog semantics; tablist ARIA; tokenized money-path colors |

---

## 3. Recommended category taxonomy per lane (from Product expert; feeds the mockup deliverable)

`*` = Gno-native differentiation categories — the reason to choose Memba over Fiverr/OpenSea; must be merchandised, not buried.

- **NFT** — Art · On-chain/Generative Art\* · PFPs & Avatars · Photography · Music & Audio · Memberships & Passes\* · Community/Contributor Badges\* · Domains & Names · Collectibles/Gaming. *Shelves:* Trending · Top Movers · New Mints · Verified Founding Creators.
- **Services** (Web3-native wedge first) — Smart Contract/Realm Dev\* · Security Audits\* · DAO Setup & Governance Ops\* · Graphics & Design · Programming & Tech · Writing & Translation · Marketing & Community · Video & Animation · AI & Data. *Categories 1–3 are the wedge — nobody else has a Gno freelance market; 2% undercuts Fiverr's ~25% IF trust signals are present.*
- **Tokens** (reframe as **OTC Block Desk**, not retail swap) — Community/Social Tokens · DAO Governance · New/Fair-Launch Allocations\* · Large Blocks/OTC · Vesting/Locked · Utility · Stable pairs. *Every card framed by why OTC beats the AMM here (price certainty, no slippage, large size).*

---

## 4. What must NOT ship (demo-tells & trust violations to delete)
- Fabricated agent ★ ratings + ✓ from `SEED_AGENTS` (`AgentLane.tsx:73`).
- `window.location.reload()` post-trade (`TokenLane.tsx:111`) → `invalidateQueries`.
- `symbol:"MEMBATEST"` hardcode (`TokenLane.tsx:51`).
- Native `alert()` for wallet-connect in Service/Token lanes.
- Emoji nav icons.
- Ungated reviews surfaced as trust signals.
- Hardcoded colors on money-path components (light-theme + AA break).

---

## 5. Full per-expert reports
`scratchpad/audit/expert_{1..7}_*.md` — Visual/UI, UX/IA, Product/Growth, Business Model, Frontend Arch, Trust & Safety, A11y/Mobile. (To be copied into `docs/planning/archive/` on plan approval.)

---

## 6. Owner decisions (locked 2026-07-08)

1. **Lane strategy → Build all 3 lanes to tier-1; launch is per-lane, flag-gated by liquidity.** NFT live; Services/Tokens ship UI-complete behind `VITE_ENABLE_SERVICES`/`VITE_ENABLE_TOKENS` and de-gate only when real seed supply + trust wiring land. No hollow/mock lane ships as "live."
2. **Monetization → Document the strategy, build it later.** This version is UI/UX/frontend + trust wiring. The GMV-first ratchet, promoted-listings realm, launchpad primary-mint fee, and per-lane ceiling escalation are captured as an **owner/DAO decision doc** (§10) — no monetization realm code in v2.
3. **Reviews → Purchase-gated reviews (new realm version).** Add verified-purchase gating (reviews tied to on-chain settlement) AND wire reputation into every listing/detail/trade surface. No ungated stars are ever surfaced.
4. **Mockups → Founding-Supply seed fixtures (real, fulfillable).** 30+ typed seed listings that drive the design fixtures now and convert to real on-chain listings at launch.

---

# PART 2 — Vision & Target Architecture

## 2.1 Product principles (the tier-1 bar, made concrete)
1. **One marketplace, one language.** A single front door, one `<MarketCard>`, one grid, one type ramp, one button — across NFT, Services, Tokens, and CollectionPublic. The App Store #808 / `um-hero` language is the canonical reference; the lanes inherit it.
2. **Never sign blind.** At the sign moment a buyer always sees *who* (identity + reputation + level), *whether authentic* (verified / official address / no copymint), *exact all-in cost* (fee + royalty + gas + slippage), and *recourse* (dispute/refund where applicable).
3. **Honest liquidity.** A lane renders as "live" only when it has real supply. Empty/seed states are curated and honest, never fake. No fabricated ratings, ever.
4. **Mobile is a first-class buyer.** Every buy/list/hire/offer flow completes one-thumb on a 375px phone: reachable nav entry, bottom-sheet trade, sticky always-reachable CTA, real focus-trapped dialogs.
5. **Merchandising over admin.** Browse by intent (taxonomy + shelves: Trending / New / Movers / Verified Founders), not an address→address ledger.
6. **Zero hardcoded color; mono is data-only.** Tokenized `--color-k-*` everywhere; JetBrains Mono only on hashes/addresses/raw amounts, Inter (`--font-sans`) on all chrome/CTAs/titles. WCAG AA in both themes.

## 2.2 Launch-gating model (satisfies decision 1)
- All 3 lanes are **built** to tier-1 in v2. **Launch** is controlled by the existing per-lane flags, which stay per-lane inside the unified tabbed shell (tabs render conditionally — no "coming soon" tabs).
- `VITE_ENABLE_NFT=true` (live). `VITE_ENABLE_SERVICES` / `VITE_ENABLE_TOKENS` remain `false` in prod until: (a) Founding-Supply real listings seeded, (b) trust wiring live, (c) for Services, `escrow_v3` fork + dispute path, (d) money-path hard gate cleared (sig-verify enforce flip + restore drill + fund-recovery e2e).
- These flags are **not** in `SAFETY_GATED_FLAGS` (they don't move money by merely being on — the engines guard funds), but a lane only trades when its realm is deployed + valid (`lanes.ts` already enforces flag AND realm-valid).

## 2.3 Design-system unification
- **Type:** upgrade `--font-sans` to Inter; audit every marketplace CSS class currently using `--font-mono` for chrome (`.k-value`, `.mhub-launch-link`, `.cpub-token-card__price`, `.cpub-action-btn`, `.mhub-section-title`, tabs, search) → move to `--font-sans`; keep mono only on `.address`, raw hashes, and monospace numeric amounts where alignment matters.
- **Color:** build a real **4-lane accent scale** (nft/service/token/agent) with AA-passing light + dark variants as `--color-k-lane-*` tokens; retire the 44-entry inline-hex migration bucket and the hardcoded `#4caf50`/`#1a7f4b`/`#00a88a`/`#444`.
- **Card:** one `<MarketCard>` (CSS-only hover, `.mkt-card`), 12px radius, media zone top (real art OR monogram gradient tile — the sanctioned per-item hardcoded-gradient exception), title + verified, seller row (identity + reputation), price/stat row, one primary action. Fed by a `CardModel` (see 2.6).
- **Grid:** one `<ListingGrid>` metric — `repeat(auto-fill, minmax(260px, 1fr))`, consistent gap, used by all lanes + CollectionPublic.
- **Buttons:** one `.k-btn-primary` / `.k-btn-secondary` for all marketplace CTAs (retire link-styled and modal-styled CTAs used as primary).
- **Icons:** Phosphor for lane tabs (retire `LANE_TAB_ICONS` emoji), `aria-hidden` on all decorative glyphs.

## 2.4 Information architecture / shell
- **One front door.** Remove the competing sidebar entries (`marketplace`/`services`/`nft`/`appstore` in `navManifest.ts:77-80`) collapsing to a single **Marketplace** entry (App Store stays separate as a curated dApp surface). Delete the 3 orphaned legacy pages.
- **Sell-anything entry.** A single "Sell / List" CTA in the shell that routes to the right create flow by asset type (NFT launchpad / Service gig / Token OTC list) — one entry, per-lane destination.
- **Mobile reachability (P0).** Add `marketplace` to the mobile IA (`PRIMARY_TABS_*` or `MORE_NAV_IDS`) + a "Sell" action in `ActFab`.

## 2.5 Unified discovery
- One URL-synced `useMarketFilters()` hook: `q` (debounced), `lane`, `category`, `sort`, `verifiedOnly`, `priceMin/Max`, `cursor`. Shared `<LaneToolbar>` renders search + category chips + sort + filters; each lane declares which facets it supports.
- **Honest search:** either search all live lanes (aggregated) or clearly scope to the active lane with a labeled scope switch — never silently NFT-names-only.
- **Taxonomy** per §3 drives category chips + curated shelves (Trending / New / Movers / Verified Founders).

## 2.6 Component architecture (from Frontend expert)
```
<UnifiedMarketplace>            // shell (mostly unchanged; add mobile + sell-anything + honest search)
  <LaneToolbar filters=useMarketFilters()/>
  <LaneView lane>               // ~30 lines: useLaneQuery -> data.map(adapter) -> <ListingGrid>
    <ListingGrid virtualized>   // one grid, windowed
      <MarketCard model=CardModel/>   // one memoized, CSS-only card
```
- Per-lane pure adapters: `nftToCard`, `serviceToCard`, `tokenToCard`, `agentToCard` : `(LaneListing) => CardModel`.
- Reuse existing primitives (`EmptyState`, `LoadingSkeleton`, `StatStrip`, `CopyableAddress`) instead of per-lane inlining; add `<ReputationBadge>`, `<VerifiedBadge>` (already exists), `<AllInPrice>`, `<LeavingMembaInterstitial>`.
- The `UnifiedListing` union (`types.ts`) becomes real: every lane's query maps into it.

## 2.7 Data architecture (from Frontend expert)
- **One validated codec** per realm read: a zod schema + `parse(): Result<T>` that **never throws into render**; on parse failure returns a typed error the card renders as a soft "unavailable" (never a `0 GNOT` that looks real).
- **All lane books through TanStack Query** — `useInfiniteQuery` keyed `['market', lane, filters, cursor]`; trades call `invalidateQueries` (kill `window.location.reload()`).
- **Realm-team asks (documented in §10, not blocking v2 FE):** machine-readable JSON reads (retire markdown/CSV scraping), `GetListingsBySeller`, server-side pagination + sort. v2 FE hardens the existing string parsers with length/shape guards in the meantime.
- **Virtualization** for grids (`@tanstack/react-virtual`) so large books don't mount every card.

## 2.8 Trust system (decision 3 + Trust expert)
- **Reuse the shipped shared reviews engine `p/samcrew/memba_reviews_core_v1`** (deployer #66, deep+CTO reviewed) via a **new marketplace consumer realm** (`memba_marketplace_reviews_v1`, mirroring the `memba_appstore_reviews_v1` pattern for reputation isolation) — do **not** fork `memba_reviews_v1`. Add/confirm the **verified-purchase gate**: `PostReview` requires proof of a settled on-chain trade between reviewer and subject (in the core engine if absent, else in the consumer); auto-hide at a flag-count threshold; keep moderation. Reviews for a listing/seller surface a **"Verified Purchase"** marker.
- **Wire reputation everywhere:** `<ReputationBadge>` (rating + count + seller level) on every `MarketCard`, listing detail, and inside `TradeModal` at the sign moment; seller identity resolves handle + reputation, never a bare `g1…`.
- **All-in cost:** `<AllInPrice>` shows *"You pay X"* = price + fee + royalty + est. gas (replaces "Seller Receives" as the headline); breakdown expandable.
- **Slippage/min-received** on OTC partial fills (`TokenTradeModal`): show min received + max pay, guard on stale quote.
- **Leaving-Memba interstitial** (`<LeavingMembaInterstitial>`): shows destination URL, seed-phrase warning, explicit confirm — replaces the `AppStore.tsx:148` text span; used on all external listing links.
- **Copymint/impersonation defense:** every collection/token card shows the **realm/collection address** (`CopyableAddress`) alongside the name; verified chip distinct from name-match; a name-collision heuristic flags dupes.

## 2.9 Mobile & accessibility (A11y expert)
- Marketplace mobile nav entry (2.4). **Mobile trade sheet:** `TradeModal`/`TokenTradeModal` render as a full-height `BottomSheet` on mobile with a **sticky, always-reachable CTA**; `@media` + `max-height` + internal scroll.
- **Real dialogs:** `aria-modal`, focus-move-in, focus-trap, focus-restore on `TradeModal` + `BottomSheet` (fix the fake "focus trap"); Escape guarded during broadcast (already correct), overlay-click disabled mid-broadcast.
- **Tablist ARIA:** lane tabs get `aria-selected` + roving `tabindex` + `aria-controls`/tabpanel; `aria-current` parity with the mobile bar.
- Tokenize all money-path colors; skeletons replace bare-text loading; label sort `<select>` + search input.

## 2.10 Founding-Supply seed fixtures (decision 4)
- Typed `foundingSupply.seed.ts` (`SeedNft`/`SeedService`/`SeedToken`, `seedTier`, `verified`/`foundingCreator` curation flags, `rating:null`/`reviewsCount:null` — no fabricated reviews). 12 NFT + 12 Services + 10 Tokens across the §3 taxonomy.
- Uses: (a) design fixtures / visual-regression stories for `<MarketCard>` in all lanes + states; (b) the honest "curated founding supply" empty-state population for gated lanes in non-prod; (c) a `seed→on-chain` conversion path (a script that turns a seed row into the corresponding create/list realm call) the DAO/founders run to make them real at launch.
- Seed data is **clearly labeled** in non-prod and is **never** presented as live traded inventory in prod until converted on-chain.

## 2.11 Target file structure (frontend)
```
frontend/src/
  pages/UnifiedMarketplace.tsx            // shell (modified: mobile, sell-anything, honest search)
  components/marketplace/
    MarketCard.tsx  MarketCard.css        // NEW — the one card
    ListingGrid.tsx                        // NEW — one virtualized grid
    LaneToolbar.tsx                        // NEW — search/filter/sort/taxonomy
    LaneView.tsx                           // NEW — generic lane renderer
    adapters/{nftToCard,serviceToCard,tokenToCard,agentToCard}.ts   // NEW
    ReputationBadge.tsx  AllInPrice.tsx  LeavingMembaInterstitial.tsx // NEW
    NftLane.tsx ServiceLane.tsx AgentLane.tsx  (TokenLane.tsx→components/) // SHRINK to ~30 lines each
    MyListingsView.tsx                      // keep
  lib/marketplace/
    useMarketFilters.ts                     // NEW — URL-synced filter state
    codec.ts                                // NEW — zod Result<T> parsers
    useLaneQuery.ts                         // NEW — TanStack infinite query per lane
    types.ts                                // UnifiedListing + CardModel (extend)
    seed/foundingSupply.seed.ts             // NEW — seed fixtures
    seed/seedToOnchain.ts                   // NEW — conversion script
  (delete) pages/Marketplace.tsx MarketplaceHub.tsx FreelanceServices.tsx  // dead code
```
On-chain (samcrew-deployer): `projects/memba/realms/memba_marketplace_reviews_v1/` (NEW consumer of the shipped `p/samcrew/memba_reviews_core_v1` engine — reputation-isolated, purchase-gated).

## 2.12 Out of scope for v2 (explicit YAGNI)
- Monetization realms (promoted listings, primary-mint fee, per-lane ceiling) — documented only (§10).
- AMM/DEX lane (deferred per backlog).
- Escrow `escrow_v3` fork ships only as a **Services de-gate prerequisite**, not on the NFT critical path.

---

# PART 3 — Founding-Supply seed catalog (30+ listings)

**Artifact:** [`marketplace-v2-founding-supply.seed.ts`](./marketplace-v2-founding-supply.seed.ts) — self-contained, strict-TypeScript-valid (`tsc --strict` green). Lands in the app at `frontend/src/lib/marketplace/seed/foundingSupply.seed.ts` in Phase 0.4.

**Shape:** `SeedNft` / `SeedService` / `SeedToken` extend a common `SeedBase` (id, title, category, tagline, description, seller `{handle, address, verified, foundingCreator}`, tags, `seedTier`, `media {kind:'art'|'monogram'}`). **All `rating`/`reviewsCount` are `null`** — curation is carried by `seedTier` + `verified`/`foundingCreator`, never by fabricated review numbers. Prices in GNOT; addresses well-formed fictional `g1…`.

| Lane | Count | Category coverage | Range / structure |
|------|-------|-------------------|-------------------|
| **NFT** | 12 | Art · On-chain/Generative · PFPs & Avatars · Photography · Music & Audio · Memberships & Passes · Contributor Badges · Domains & Names · Collectibles/Gaming | Floor 2→480 GNOT; royalties ≤1000 bps (soulbound badge = 0); 5 founding creators; media mixes art + monogram |
| **Services** | 12 | **Gno-native wedge ×6** (Realm Dev · Security Audit · DAO Setup/Governance Ops · Tokenomics/Launch · Test Suites/CI · Realm Migration) + Graphics · Programming · Writing · Marketing · Video · AI/Data | Each = 3 tiers (Basic/Standard/Premium) w/ GNOT price + delivery days + revisions; Fiverr "I will…" voice |
| **Tokens** | 10 | Community/Social · DAO Governance · Fair-Launch Allocations · Large Blocks/OTC · Vesting/Locked · Utility · Stable pairs | Real symbols/amounts/unit/minFill; 4 vested; every `whyOtc` makes a concrete case OTC beats an AMM |

**Representative titles** (tone check):
- **NFT:** *Gnomes Genesis* (PFP, founding) · *Lattice — Fully On-Chain Generative* (realm-rendered SVG) · *gno.name — Human-Readable Addresses* (domains) · *Validator Crest* (generative heraldic badge).
- **Services:** *"I will audit your Gno realm for fund-drain and access-control bugs"* · *"I will set up your on-chain DAO with treasury and governance ops"* · *"I will build a React frontend wired to your Gno realm"* · *"I will migrate your realm to a new testnet or stdlib version"*.
- **Tokens:** *MEMBA Community — Founding Block* · *FORGE Large Block — Desk Placement* (1.2M, 100k minFill) · *AXIS Seed Tranche — Vested* (cliff+linear) · *PRISM DAO Treasury — Diversification Block*.

**Uses:** (1) design fixtures / visual-regression stories for `<MarketCard>` across all lanes × states; (2) honest curated population of gated lanes in **non-prod only**; (3) `seedToOnchain.ts` converts each row → the correct create/list realm call so the DAO/founders make them **real on-chain supply at launch** (growth spend, per the Product expert). Seed rows are labeled and **never** shown as live traded inventory in prod until converted.

---

# PART 4 — AAA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Phase 1 is fully bite-sized as the exemplar; Phases 2–8 are specified to task + acceptance granularity and each **spins out its own bite-sized execution plan** (`docs/superpowers/plans/2026-07-…-marketplace-v2-phaseN.md`) when that phase begins.

**Goal:** Rebuild the Memba Marketplace to a tier-1 (Fiverr/OpenSea/Uniswap-grade) unified experience — one design system, unified discovery, mobile-first trade, purchase-gated trust, all 3 lanes built (launch flag-gated by liquidity) — on a dedicated branch merged only when the full version is complete and reviewed.

**Architecture:** One `<MarketCard>` + per-lane adapters over a validated TanStack-Query data layer; a URL-synced filter shell; a mobile bottom-sheet trade flow with real dialog semantics; a purchase-gated `memba_reviews_v2` realm wired into every listing surface; Founding-Supply seed fixtures that convert to real on-chain supply.

**Tech stack:** React 19 + TS, Vite 7, React Router 7, TanStack Query + `@tanstack/react-virtual`, zod, ConnectRPC/ABCI qeval, custom CSS-var "K" design system, Vitest + Playwright. On-chain: Gno realms (samcrew-deployer).

## Global Constraints (every task inherits these — verbatim)
- **NEVER redeploy `tokenfactory_v2`.** Frozen realms get NEW versions only; record in `realm-versions.json`.
- Per-lane fee → single DAO treasury; `MaxFeeBPS=500` (5%) clamp; `memba_market_config` has **no Pause**; engines clamp + fall back, never revert on config. Services 5% cancel fee → freelancer, **never** labeled "→ DAO".
- `NewBanker` built with `cur` (`IsCurrent()==true`), never `cur.Previous()`.
- **Feature-flag safety gating:** prod build FAILS if a `SAFETY_GATED_FLAGS` flag = "true" (`assertSafeFlags`). Per-lane flags stay per-lane; tabs render conditionally; **no "coming soon" tabs**; a lane trades only when flag AND realm-valid.
- **Zero hardcoded colors** — `var(--color-k-*)` only (monogram gradient tile is the ONE sanctioned exception). **Mono = data only**; Inter for chrome/CTAs. WCAG AA (≥4.5:1 text) in light + dark.
- **No fabricated trust signals** — no mock ratings/verified; seed data labeled + non-prod only until converted on-chain.
- Money-path de-gate hard gate (Services/Tokens): sig-verify enforce flip + Litestream restore drill + fund-recovery e2e — all three, before de-gate.
- **Never commit to `main`.** Work on `feat/marketplace-v2` in a worktree; `cd` into the worktree before every commit. No Claude attribution in commits/PRs.
- Frontend is standalone npm: `cd frontend && npm ci`; verify with `npm run build` (not `tsc --noEmit`); vitest one file at a time via the bounded self-killing wrapper.

## Realm-dependency reconciliation (state as of 2026-07-08 — verify at implementation)
> My initial on-chain exploration ran on a **stale** deployer branch. Authoritative source at implementation time = **latest deployer `main` + Memba `main` + `realm-versions.json`** (pull first). Per current merged state:
- **P0 OriginSend/IsUserCall fund-drain class is CLOSED on test13** — `candidature_v3` / `escrow_v3` / `agent_registry_v2` / `token_otc_v2` deployed & LIVE (guarded); `candidature_v2` PAUSED (deployer #63/#64, Memba #821). **⚠️ Mainnet still needs the guarded realms** — old unguarded realms must NEVER ship to mainnet. So the money-path hard gate for Services/Tokens de-gate is about the *hard-gate trio* (sig-verify flip + restore drill + fund-recovery e2e), not about building guards (done).
- **Reviews engine already shipped** — `p/samcrew/memba_reviews_core_v1` (shared engine) + `memba_appstore_reviews_v1` (consumer), deep+CTO reviewed, hard-gated (deployer #66). Phase 6 **reuses** the core engine via a new marketplace consumer, not a `reviews_v1` fork.
- Lanes target the **v2/v3 guarded engines**: Services→`escrow_v3`, Tokens→`token_otc_v2`, Agents→`agent_registry_v2`, NFT→`memba_nft_market_v3_1` (unchanged). Confirm exact paths in `realm-versions.json` at wire-up.

## Branch / rollout strategy
- **Default (per your instruction):** one long-lived integration branch `feat/marketplace-v2` (git worktree `Memba-worktrees/marketplace-v2`); each phase merges into it via reviewed PR; the integration branch merges to `main` only when the full version is complete + reviewed. Behind `VITE_ENABLE_MARKETPLACE_V2` during build-out.
- **CTO-recommended alternative (lower risk, your call):** since v2 lives behind `VITE_ENABLE_MARKETPLACE_V2` (off in prod), land each phase as its own PR **directly to `main` behind the flag** — the feature stays invisible to users until you flip the flag when it's complete + reviewed, which honors "merged only when complete" while avoiding a weeks-long integration branch drifting from a fast-moving `main` (big-bang merge risk). Recommended unless you specifically want the work isolated off-main.
- Definition of done per phase = tests green (`npm run build` + vitest + relevant Playwright projects incl. `iphone`/`pixel`), acceptance criteria met, `docs/DESIGN_SYSTEM.md` §13 color-grep clean, PR reviewed.

---

## Phase 0 — Foundation, cleanup & guardrails
**Outcome:** dead code gone, lying tests fixed, worktree + flag + fixtures scaffolded, so later phases build on solid ground.

- **Task 0.1 — Worktree + integration flag.** Create `feat/marketplace-v2` worktree; add `VITE_ENABLE_MARKETPLACE_V2` reader in `config.ts` (ordinary flag, default off in prod). *Acceptance:* `npm run build` green; flag toggles a placeholder v2 route.
- **Task 0.2 — Delete dead code + fix the fiction test.** Remove `pages/Marketplace.tsx`, `MarketplaceHub.tsx`, `FreelanceServices.tsx` + their tests; rewrite `App.routes.test.tsx` to assert the real `/nft → /marketplace/nfts` redirect. *Acceptance:* build green; no orphan imports; route test asserts current behavior.
- **Task 0.3 — Kill demo-tells.** Replace `window.location.reload()` (`TokenLane.tsx:111`) with a TODO-marked `invalidateQueries` shim; remove `SEED_AGENTS` fabricated `rating`/`verified` from `AgentLane` render; replace `alert()` connect prompts with the existing connect-and-continue affordance; remove `symbol:"MEMBATEST"` hardcode (make it a real symbol select). *Acceptance:* grep shows none of these tokens in marketplace components; tests updated.
- **Task 0.4 — Seed fixtures landed.** Add `lib/marketplace/seed/foundingSupply.seed.ts` (from §3/Part 3) + a `seed.test.ts` asserting counts (12/12/10), schema validity, no non-null ratings, well-formed addresses. *Acceptance:* `vitest run seed.test.ts` green.

## Phase 1 — Design system + the one card (EXEMPLAR — bite-sized TDD)
**Outcome:** `<MarketCard>` + `<ListingGrid>` + tokens, CSS-only, theme-safe, replacing the 4 card systems. This phase is detailed to step level; it is the template for how every later task is executed.

**Files:**
- Create: `frontend/src/components/marketplace/MarketCard.tsx`, `MarketCard.css`
- Create: `frontend/src/components/marketplace/ListingGrid.tsx`
- Modify: `frontend/src/lib/marketplace/types.ts` (add `CardModel`)
- Modify: `frontend/src/tokens.css` (Inter `--font-sans`; `--color-k-lane-*` scale)
- Test: `frontend/src/components/marketplace/MarketCard.test.tsx`, `ListingGrid.test.tsx`

**Interfaces:**
- Produces: `type CardModel = { id: string; lane: Lane; title: string; media: {kind:'art'|'monogram'; src?:string; seed?:string}; verified: boolean; seller: {handle:string; address:string; reputation?: {rating:number; count:number; level:string}|null}; stats: {label:string; value:string; mono?:boolean}[]; priceLabel: string; href: string; action?: {label:string; onClick?:()=>void} }`
- Produces: `<MarketCard model={CardModel} />`, `<ListingGrid items={CardModel[]} renderItem?/>`

- [ ] **Step 1 — Failing test for `CardModel` typing + render.** In `MarketCard.test.tsx`: render a `MarketCard` with a monogram model, assert title text, seller handle, a stat value, verified badge present, and that the card is an `<a>` to `href`.
```tsx
it('renders identity, stats, verified, and links to href', () => {
  render(<MemoryRouter><MarketCard model={monogramModel} /></MemoryRouter>);
  expect(screen.getByText('Gnomes Genesis')).toBeInTheDocument();
  expect(screen.getByText(/@gnome.dev/)).toBeInTheDocument();
  expect(screen.getByLabelText(/verified/i)).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/nft/collection/…');
});
```
- [ ] **Step 2 — Run it, verify it fails** (`MarketCard` not defined). Run the bounded vitest wrapper on this file. Expected: FAIL.
- [ ] **Step 3 — Implement `MarketCard.tsx`** (memoized, no inline style objects; all styling via `MarketCard.css` classes; monogram gradient computed once from `seed`; media zone / identity row / stat row / action).
- [ ] **Step 4 — Implement `MarketCard.css`** (`.mkt-card`, CSS `:hover` translateY(-2px) + token shadow, 12px radius, tokenized colors, `--font-sans` on title/price, mono only on `stats[].mono`). Run color-grep (`DESIGN_SYSTEM.md §13`): expect clean.
- [ ] **Step 5 — Run test, verify pass.** Expected: PASS.
- [ ] **Step 6 — Theme + a11y test.** Add tests: no hardcoded rgba in computed style path (snapshot class names not inline styles), keyboard focus reaches the card link, `:focus-visible` ring present. Run → PASS.
- [ ] **Step 7 — `ListingGrid` failing test** (renders N cards; one grid class; empty→`<EmptyState>`). Run → FAIL.
- [ ] **Step 8 — Implement `ListingGrid.tsx`** (one grid class `minmax(260px,1fr)`; virtualization deferred to Phase 2 behind the same API). Run → PASS.
- [ ] **Step 9 — Tokens.** Upgrade `--font-sans` to Inter (add `@font-face`/import); add `--color-k-lane-{nft,service,token,agent}` with AA light+dark variants; add a Vitest/CSS check or Playwright contrast assertion. Run build → green.
- [ ] **Step 10 — Commit** (in the worktree). `feat(marketplace): one MarketCard + ListingGrid + lane tokens`.

**Phase 1 acceptance:** one card + one grid render all four lanes' models in Storybook-style fixture tests (using the seed data); zero inline style objects; zero hardcoded colors; Inter on chrome; light + dark AA pass.

## Phase 1.5 — Felt quick-wins on the live NFT lane (added per CTO review)
**Why:** the audit's #1/#2 P0s (reputation wired to nothing; marketplace unreachable on mobile) otherwise land 4–6 phases deep behind plumbing. Ship them on the ONE live lane now, before the big refactor, so users feel a win early. Small, isolated, high-ROI.
- **Task 1.5a — Mobile nav entry (P0-B, ~1-line).** Add `marketplace` to the mobile IA (`navManifest.ts` `MORE_NAV_IDS`/primary tabs) + a "Sell" action in `ActFab`. *Test (Playwright iphone):* marketplace reachable from the bottom bar/More sheet.
- **Task 1.5b — `<ReputationBadge>` component: BUILT; live data wiring DEFERRED to Phase 6.** ✅ The reusable, safe `ReputationBadge` (rating/level/count or "New seller"; never fabricated) is built + tested and used by `MarketCard`. ⚠️ **Live wiring reversed after firsthand verification:** the only reputation data available today is UNGATED (`fetchReputation` returns a bare score; `VITE_ENABLE_REVIEWS` off; reviews are not purchase-gated until Phase 6). The trust expert is explicit that surfacing ungated reputation is *worse than none* (sybil-farmable). So wiring real reputation onto `TokenDetail`/cards now would ship the exact anti-pattern the audit flags → **deferred to Phase 6**, which populates the badge from the purchase-gated source. The component is ready to consume that data with a one-line swap.
- **Task 1.5c — `<AllInPrice>` on NFT detail + a recourse/no-refund honesty line.** Headline "You pay X" (price+fee+royalty+est gas) replacing "Seller Receives"; add a short "On-chain sales are final — no refunds" recourse line (CTO #5). *Test:* buyer total correct; recourse copy present.
> Note: 1.5b DISPLAYS reputation using the existing (ungated) read for the live lane's felt win; Phase 6 adds the verified-purchase WRITE gate + swaps the display source to the purchase-gated realm. Until Phase 6, mark surfaced ratings as unverified if any exist.

## Phase 2 — Data layer (validated codec + TanStack Query + adapters)
Status: **foundation built** (2.1 + 2.2 + seed adapters); lane wiring + virtualization move to Phase 7 (avoid throwaway on lanes being replaced).
- **Task 2.0 — Funnel instrumentation (added per CTO #5).** DEFERRED to Phase 7/8 (wire when the lanes render live, behind the existing analytics util). Emit view → detail → sign → settle events; no PII.
- **Task 2.1 ✅ DONE** (`32ee457`) — `result.ts` (`Result<T>`) + `codec.ts`: zod-validated decoders that never throw into render; `decodeOtcCsv` drops malformed rows (fixes the blind-`BigInt` risk); `tokenOtcApi` refactored onto it. Tests: 4 codec + tokenOtc green. (Markdown-table paths — `agentRegistry` — get the same treatment when the Agents lane is rebuilt.)
- **Task 2.2 ✅ DONE** (this commit) — `useLaneQuery.ts`: cached `useQuery` keyed `['market', lane, …filters]`, adapter-mapped to `CardModel`, `enabled` gate, error→[] soft-fail. Replaces the lanes' `useEffect`+`setState` fetches (wired per-lane in Phase 7; trades call `invalidateQueries(['market', lane])`). Tests: 3 green. *(Cursor/`useInfiniteQuery` upgrade waits on the server-side-pagination realm ask, §10.)*
- **Task 2.3 — partial:** ✅ `seed→CardModel` adapters done (`cf9eb27`, drive fixtures + the preview harness). The real `UnifiedListing→CardModel` adapters are built with the lane rebuilds (Phase 7), since real UnifiedListings only flow then.
- **Task 2.4 — DEFERRED** — virtualize `ListingGrid` with `@tanstack/react-virtual` (NOT yet a dep). Premature for realistic book sizes; the `ListingGrid` API is already virtualization-ready, so this slots in behind it in Phase 7 when books can grow. *Test then:* 500-item book mounts a bounded window.
- *Acceptance (met for the foundation):* codec never throws into render; `useLaneQuery` caches + soft-fails; no `0 GNOT` masquerade. Remaining acceptance (every lane through Query, no raw setState) lands with the Phase 7 lane rebuilds.

## Phase 3 — Unified discovery (filters / search / sort / taxonomy)
Status: **core built** (3.1 + 3.2 + 3.3); shelves (3.4) + price-range facet deferred to Phase 7.
- **Task 3.1 ✅ DONE** — `marketFilters.ts` (pure `applyFilters` + `parseFilters`/`filtersToParams`, `MarketFilters` = q/category/sort/verifiedOnly) + `useMarketFilters()` (URL-synced via `useSearchParams`, merge-patch, `clear`). `CardModel` gained `category?`/`priceValue?`; seed adapters populate them. Tests: 8 logic + 4 hook. *(price-range facet + cursor deferred — cursor waits on the server-side-pagination realm ask §10.)*
- **Task 3.2 ✅ DONE** — `<LaneToolbar>`: debounced search (no per-keystroke writes), category chips (aria-pressed), labelled sort `<select>`, verified toggle, optional result count; tokens-only CSS, all controls labelled. Tests: 5.
- **Task 3.3 ✅ DONE (honest search)** — `applyFilters` filters the lane's ACTUAL items (title + seller + category), not names-only-silently; wired into the preview harness across all lanes with the shared toolbar. Wiring into live lanes lands with the Phase 7 rebuilds (via `useLaneQuery` + `applyFilters`).
- **Task 3.4 — DEFERRED to Phase 7** — curated shelves (Trending / New / Movers / Verified Founders); need real ranking data + the live lanes. The sort/filter foundation they sit on is done.
- *Acceptance (met for core):* filters/sort share one URL-synced state; search filters real items with a clear scope. Shelves + per-lane facet declaration land in Phase 7.

## Phase 4 — Shell & IA (one front door, sell-anything, mobile nav)
Status: **effectively done** (much was already collapsed on main — stale audit findings).
- **Task 4.1 ✅ DONE** — the sidebar already has ONE `marketplace` entry (+ App Store, intentionally separate); the standalone NFT/Services entries were removed on main 2026-07-08 (the "four front doors" was a stale-snapshot finding). Fixed the wrong **Robot** icon → `ShoppingBag` (visual expert flag).
- **Task 4.2 ✅ DONE** — `buildSellOptions` (live-lanes-only routing map, no coming-soon rows) + `<SellAnythingButton>` (single lane → direct link; multiple → accessible disclosure menu with Escape/outside-click close). Wired into the preview; live-shell wiring lands with the Phase 7 shell modifications. Tests: 3 + 4.
- **Task 4.3 ✅ DONE (already on main)** — `navManifest.ts` `MORE_NAV_IDS` already includes `marketplace` (verified in Phase 1.5); mobile reachable via the More sheet. (Optional "Sell" in `ActFab` can piggyback the Phase 7 shell work.)
- *Acceptance:* exactly one front door ✅; marketplace reachable on mobile ✅; sell-anything routes by asset type ✅.

## Phase 5 — Mobile trade & real dialogs (A11y P0s)
> **Firsthand finding (2026-07-08):** the primitives ALREADY EXIST — `src/hooks/useFocusTrap.ts` + `src/components/AccessibleDialog.tsx`. So 5.2 is *adopt them in `TradeModal`* (which has `role="dialog"` but no `aria-modal`/trap and doesn't use them) + upgrade `BottomSheet`'s single-`focus()` "fake trap" to the real hook. `TradeModal.css` confirmed to have **0 `@media`** (the "no mobile layout" P0 is real). **This phase modifies the LIVE, money-path `TradeModal`** → needs real browser verification (currently blocked by the preview-proxy caching bug). Recommend fixing preview / doing this with e2e before touching the trade modal.
- **Task 5.1** `TradeModal`/`TokenTradeModal` render as full-height `BottomSheet` on mobile with **sticky always-reachable CTA**; `@media` + `max-height` + internal scroll. *Test (Playwright iphone 375px):* List-flow CTA visible + tappable without page scroll; no horizontal scroll.
- **Task 5.2** Real dialog semantics — **adopt `AccessibleDialog`/`useFocusTrap`** in `TradeModal`; add `aria-modal`, focus-move-in, focus-trap, focus-restore; fix `BottomSheet`'s fake trap; disable overlay-click mid-broadcast. *Test:* Tab cycles within dialog; focus returns to trigger on close; SR sees modal.
- **Task 5.3** Tablist ARIA on lane tabs (`aria-selected`, roving `tabindex`, `aria-controls`); skeletons replace bare-text loading. *Test:* axe/a11y assertions pass on shell + tabs.
- *Acceptance:* every trade completes one-thumb on a phone; all transaction dialogs trap+restore focus; WCAG AA on the money path.

## Phase 6 — Trust: purchase-gated reviews realm + wiring (decision 3)
> **⚠️ Settlement-read spike result (2026-07-08, verified on `nft_market_v3_1` source):** the NFT engine DOES persist settled sales on-chain (`type Sale{Buyer,Seller,price,fee,royalty,block}`, `salesLog avl.Tree`, `recordSale()` called in `BuyNFT`) — so the record exists. **BUT** the only public getters are `GetListingsPage`/`GetOffersForToken`/`ListingsCount`; there is **no getter to query "did buyer X purchase from seller Y"** (`salesLog` is exposed only via a `render("sales")` markdown view). **Implication:** the on-chain purchase-gate needs a **new engine version** (`nft_market_v3_2`) that adds a pure read getter (e.g. `HasPurchased(buyer, seller) bool` / `GetSalesByBuyer`), with `salesLog` **state-migration** considered (a fresh realm starts with an empty log → lost purchase history for gating). Options to resolve in Phase 6 design: (a) new engine version + read getter + state migration; (b) settlement-time vouching (engine grants review-eligibility on sale — couples engine↔reviews); (c) hardened parse of `render("sales")` as an interim (fragile — avoid for anything but a boolean gate). **Do NOT redeploy the frozen engine in place — new version only.** Verify escrow_v3 / token_otc_v2 expose the equivalent record against current deployer `main` before their lanes de-gate. This is a realm-design task to resolve WITH the deployer team; it does not block Phases 1.5–5.
- **Task 6.1 (realm)** New consumer `memba_marketplace_reviews_v1` on the shipped `p/samcrew/memba_reviews_core_v1` engine (deployer #66) — reputation-isolated per the `memba_appstore_reviews_v1` precedent; do NOT fork `reviews_v1`. Add the **verified-purchase gate**: `PostReview` requires proof of a settled on-chain trade between reviewer↔subject — the gate must verify settlement from the **authoritative trade-engine on-chain record** (buyer, seller, trade/listing id read from `nft_market_v3_1`/`escrow_v3`/`token_otc_v2`), **never a client-supplied flag**; auto-hide at flag-count threshold. Gno TDD (`*_test.gno`). Deploy to test13; record in `realm-versions.json`. **First:** read the current `memba_reviews_core_v1` source (deployer main) to confirm whether purchase-gating already exists before adding it. *Acceptance:* ungated wallet cannot review; a settled purchaser can; over-threshold flags auto-hide.
- **Task 6.2** `<ReputationBadge>` + `fetchReputation` codec; render on every `MarketCard`, listing detail, and inside `TradeModal` at sign moment. **Trust signals (verified badge + reputation) are read ONLY from the authoritative curation/reviews realms keyed by seller address — NEVER from seller-controlled listing metadata** (prevents forged badges/reputation). *Test:* card shows rating+count+level or a neutral "new seller" (never fabricated); a listing that self-claims `verified:true` in its metadata does NOT render the badge unless the curation realm confirms it.
- **Task 6.3** `<AllInPrice>` — headline "You pay X" = price+fee+royalty+est gas; expandable breakdown (repurpose `PriceBreakdown`). *Test:* buyer total correct; replaces "Seller Receives" headline.
- **Task 6.4** Slippage/min-received on OTC partial fills + stale-quote guard. *Test:* min-received shown; fill rejects on price drift beyond tolerance.
- **Task 6.5** `<LeavingMembaInterstitial>` (URL + seed-phrase warning + confirm) on all external links (replace `AppStore.tsx:148` span). *Test:* external nav gated by confirm.
- **Task 6.6** Copymint defense — show collection/token **address** on every card/detail; name-collision heuristic flags dupes; verified chip decoupled from name match. *Test:* two same-name collections are distinguishable by address; dupe flagged.
- *Acceptance:* a buyer never signs blind — identity+reputation, authenticity, all-in cost, and recourse all present.

## Phase 7 — Per-lane merchandising + seed conversion
> **Core built ahead (`LaneView`):** the generic lane renderer is done + tested — `useLaneQuery` (validated fetch) → adapter → `applyFilters` → `LaneToolbar` + `ListingGrid`, with skeleton / retry-error / empty states. Each lane rebuild is now: write the real row→CardModel adapter + `<LaneView lane fetchFn toCard categories />`, then swap it into the live shell (browser-verify — needs the preview working). Remaining Phase-7 wiring modifies LIVE prod lanes, so it should be done with the browser preview up.
- **Task 7.1 (NFT)** Rebuild `NftLane` on `LaneView`/`MarketCard` (~30 lines); collection + **item-level** browse, trending/movers shelves, real media zone, quick-buy; retire inline-style/JS-hover. *Acceptance:* NFT lane reads as a storefront, not a ledger; parity with OpenSea browse basics.
- **Task 7.2 (Services)** Build `ServiceLane` for real — gig cards (tiered packages Basic/Standard/Premium), category taxonomy, seller level (curation), first-listing seller funnel, `HireServiceModal` wired to the **live P0-guarded `escrow_v3`** (gated). *Acceptance:* full Fiverr-style gig browse + detail + order flow behind `VITE_ENABLE_SERVICES` (off in prod).
- **Task 7.3 (Tokens)** Rebuild `TokenLane` as **OTC Block Desk** on the **live P0-guarded `token_otc_v2`** — `whyOtc` framing, real symbol select, amount/unit/minFill, slippage; retire `MEMBATEST`. *Acceptance:* OTC desk UX behind `VITE_ENABLE_TOKENS` (off in prod).
- **Task 7.4** `seedToOnchain.ts` — script converting a seed row → the correct create/list realm call; run to seed real Founding Supply at launch. *Acceptance:* dry-run produces valid msgs for each lane.
- *Acceptance:* all 3 lanes tier-1 and consistent; launch controlled purely by flags + real supply.

## Phase 8 — Launch gating, QA, docs, cutover
- **Task 8.1** e2e coverage — Playwright flows per lane (browse→detail→trade) on desktop + `iphone`/`pixel`; gating specs (gated lane redirects; no coming-soon tabs). 
- **Task 8.2** Perf pass — verify no per-card 15s regression; virtualization; Lighthouse mobile.
- **Task 8.2b — Craft/polish pass (the tier-1 differentiator).** Motion tokens (card enter/hover, tab transitions, respecting `prefers-reduced-motion`); crafted empty/loading/error states per lane (not generic); a light **first-visit onboarding** (what the marketplace is + "Sell anything" affordance); perceived-performance (optimistic UI on trade, skeleton→content transitions). *Acceptance:* a first-time visitor understands and can act within 5s; motion feels intentional (Linear-grade, ≤2px lifts), not "web3-bro."
- **Task 8.3** Docs — update `DESIGN_SYSTEM.md`, `CHANGELOG.md`, `realm-versions.json`; archive expert reports; write the §10 monetization decision doc.
- **Task 8.4** Cutover — flip `VITE_ENABLE_MARKETPLACE_V2` on; remove old paths; integration branch → `main` PR (reviewed).
- *Acceptance:* full new version green across build + vitest + e2e (desktop + mobile), reviewed, ready to merge.

## Testing strategy
- **Unit (Vitest):** codec parse/guards, adapters, `useMarketFilters` round-trip, `MarketCard`/`ListingGrid`, reputation gating logic, seed schema. One file at a time via the bounded wrapper.
- **Realm (Gno):** `memba_reviews_v2` purchase-gate + auto-hide `*_test.gno`.
- **E2E (Playwright):** per-lane browse→trade on desktop + `iphone`/`pixel`; mobile CTA reachability; dialog focus-trap; gating.
- **Visual:** seed-driven fixture stories for `MarketCard` in all lanes × states (art/monogram, verified, new-seller, loading, empty, error).
- **A11y:** axe assertions on shell, tabs, dialogs; contrast checks light+dark.

## Risks & mitigations
- **Realm string-scraping fragility** → codec guards now; JSON-read realm ask documented (§10) as the durable fix.
- **Purchase-gate realm scope creep** → build a thin consumer on the shipped `memba_reviews_core_v1` engine (gate + auto-hide only); deploy to test13 first; confirm whether the core already gates before adding.
- **Services/Tokens de-gate blocked on the money-path hard-gate trio** (sig-verify flip + restore drill + fund-recovery e2e) → guards themselves are already live (`escrow_v3`/`token_otc_v2`); Services/Tokens ship UI-complete but flag-off; de-gate is a separate gated milestone.
- **Cutover risk** → `VITE_ENABLE_MARKETPLACE_V2` lets v2 co-exist until green; integration branch merges to main only when complete + reviewed.
- **GNOT FX / treasury** → documented owner/DAO policy (§10), not a v2 code dependency.

## §10 — Documented owner/DAO decisions (monetization; build later, per decision 2)
1. **GMV-first fee ratchet** — hold NFT 2%; keep Services/Token low now; pre-commit a public ratchet (Services → 8–12%) tied to liquidity milestones via the already-built `SetFeeBPS` (no redeploy).
2. **Non-transaction revenue** — promoted/featured listings (GNOT boost → treasury) + launchpad primary-mint fee. New realm/field; zero `tokenfactory_v2` risk. Can out-earn the take in years 1–2.
3. **Per-lane fee ceiling** — escalate `MaxFeeBPS` to per-lane at the DAO (NFT/Token 5%, Services ~15%) so Services isn't permanently capped at ¼ of Fiverr.
4. **Treasury/FX policy** — don't plan USD runway off a GNOT-denominated treasury; diversification + stablecoin-lane roadmap.
5. **Realm read contract** — machine-readable JSON reads + `GetListingsBySeller` + server-side pagination/sort (retire markdown/CSV scraping).
6. **Reputation = trust flywheel** — keep zero-XP-for-volume; tie future reputation to completed + reviewed trades with counterparty diversity, never raw volume.

---
