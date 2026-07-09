# Expert 2 — UX / Interaction Design & Information Architecture Audit

**Scope:** cross-lane discovery/search/filter/sort, navigation & IA, buy/list/offer/hire funnels, empty/loading/error states, "Sell anything" entry, first-visit onboarding, browse→detail→trade funnel, wallet-connect friction, mobile task completion, cross-lane consistency.
**Benchmarks:** Fiverr, OpenSea/Blur, Magic Eden, Uniswap, Airbnb, Stripe, Linear.
**Verdict:** The NFT lane is *functionally* complete and the price/fee transparency is genuinely tier-1. Everything *around* it — discovery, IA, mobile reachability, cross-lane consistency, trust, and the sell funnel — is pre-tier-1. The marketplace today reads as **three unrelated admin panels stapled behind a shared hero**, and on mobile it is **effectively unreachable**.

---

## TOP FINDINGS

### P0 — Marketplace is unreachable in the entire mobile navigation
**What:** `navManifest.ts` mobile sets — `PRIMARY_TABS_MEMBER = ['home','dao','tokens','alerts']`, `PRIMARY_TABS_VISITOR = ['home','dao','tokens','directory']` (ln 111‑112) and `MORE_NAV_IDS = ['dashboard','directory','validators','gnolove','quests','feed','blog','changelogs','extensions','alerts']` (ln 117) — contain **none** of `marketplace / nft / services / appstore`. The quick-action FAB (`ActFab.tsx` ln 25‑29) has no sell/list action either. Net: on mobile the *entire commerce surface* is absent from the tab bar, the "More" sheet nav, and the FAB. It is reachable only by typing into the command palette or a deep link.
**Why it matters:** Mobile is the majority of web3 social traffic. A marketplace you cannot navigate to on a phone has ~0 organic mobile funnel. Fiverr, OpenSea, Magic Eden all put "shop/explore" in the primary bottom bar. This single gap invalidates most other mobile findings below because no one reaches them.
**Fix:** Add a single **"Market"** (or "Shop") primary mobile tab routed to `/marketplace`, plus a **Sell** action in `ActFab`. Collapse the four legacy `launch` entries (below) into it.

### P0 — IA is fragmented and self-contradicting: one shell, four front doors
**What:** Despite the unified shell at `/marketplace` (`UnifiedMarketplace.tsx`), `navManifest.ts` still exposes four separate `launch`-group destinations: `marketplace` → `/marketplace` (icon **Robot** — wrong metaphor), `services` → `/services`, `nft` → `/nft`, `appstore` → `/apps` (ln 77‑80). The unified shell's tabs (`/marketplace/nfts|tokens|…`) and these sidebar links overlap and compete. `Marketplace.tsx`, `MarketplaceHub.tsx`, `FreelanceServices.tsx` still on disk.
**Why it matters:** Users can't form a mental model — is the NFT market "NFT", "Marketplace", or a tab inside Marketplace? Airbnb/Fiverr have exactly one entry into the marketplace. Multiple doors to the same room is the classic IA failure.
**Fix:** Single canonical entry: **Marketplace** with a **Storefront** icon. Retire `services`/`nft` sidebar entries (they become lane tabs); keep App Store as an adjacent surface only if the product intends it as distinct. Delete the three orphaned pages.

### P0 — No unified (or even functional cross-lane) search/filter/sort
**What:** Shell renders one search box writing `?q` (`UnifiedMarketplace.tsx` ln 156‑169). Only `NftLane` reads `q` (ln 22, filters `collection.name.includes`). `TokenLane`, `ServiceLane`, `AgentLane` ignore `q` entirely. So "Search marketplace…" silently searches **NFT collection names only**. Sort exists only in NFT (`volume/floor/name`, ln 73‑84); zero filters anywhere (no price range, category, trait, delivery time, rating, verified-except an NFT checkbox). Input is uncontrolled (`defaultValue`) + no debounce → every keystroke rewrites the URL.
**Why it matters:** Discovery *is* the marketplace. OpenSea = trait facets; Fiverr = category/budget/delivery/rating filters; Airbnb = faceted search + map. A global box that quietly filters one lane's names is worse than no box — it lies about scope.
**Fix:** Build a shared discovery bar: debounced controlled query, faceted filters per asset type (price, category, verified, rating), unified sort, and a **cross-lane results view** ("3 collections, 2 services, 5 tokens"). Persist `q` + filters across tab switches.

### P0 — Marketplace has no front door / cold-start is hollow
**What:** Landing routes straight to the default lane (NFT collections). `ServiceLane` = empty stub with dead "coming soon" copy (`ServiceLane.tsx` ln 10, 33 — contradicts the lanes.ts "never show coming-soon" doctrine). `AgentLane` = mock `SEED_AGENTS`. Only NFT is real. There is no cross-lane "discover/trending/featured/activity" home.
**Why it matters:** First impression of a marketplace with one populated lane + one empty + one fake reads as vaporware. OpenSea/Magic Eden open on curated featured + trending + live activity, not a raw grid.
**Fix:** A **Marketplace home** above the lanes: featured hero, "Trending across the market," live cross-lane activity ticker, and category entry tiles. Only render lanes that are live (already the doctrine) — but give the shell a reason to exist beyond a tab strip.

### P1 — Wallet-connect friction is inconsistent and jarring
**What:** Four different disconnected-user patterns: `ServiceLane` + `TokenLane` fire native `alert("Please connect your wallet first.")` (ServiceLane ln 19, TokenLane ln 47, 83); `CollectionPublic`/`TokenDetail` render a dead **"Connect wallet"** text hint (not a button); `NftLane` grid shows nothing actionable; only `MyListingsView` (ln 108) offers a real connect button. `alert()` blocks the thread and looks like a phishing popup.
**Why it matters:** Uniswap/OpenSea never block a browse action — the trade CTA *is* the connect CTA; it opens the wallet modal in-context and resumes the intended action. Memba drops the user's intent on the floor.
**Fix:** One shared "connect-then-continue" pattern: any trade CTA on a disconnected wallet opens the connect modal and, on success, re-triggers the original action (buy/list/offer/hire). Kill every `alert()`.

### P1 — Trust signals absent from listings (reviews exist but unwired)
**What:** `ReviewsSection`/`StarRating`/`lib/reviews.ts` exist but appear nowhere in `NftLane`, `CollectionPublic`, `TokenLane`, `ServiceLane`. Agent ratings are mock. Collections show no verified reputation beyond a badge; sellers show a truncated address (`item.seller.slice(0,8)`).
**Why it matters:** Trust is the conversion lever. Fiverr seller levels + reviews, Airbnb Superhost + review counts, OpenSea verified + owner history. A raw address seller with no reputation is a hard stop for buyers.
**Fix:** Surface seller/creator reputation on every card and detail (rating, review count, verified, sales history). Wire the existing reviews realm into collection + service + agent detail.

### P1 — Buy funnel is too deep; no item-level browse, no sweep/quick-buy
**What:** NFT lane shows **collections only**. To buy you must: card → `CollectionPublic` → Items tab → per-token grid → per-card "Buy" → `TradeModal`. There is no marketplace-level view of individual *listed* items, no floor sweep (engine supports it per brief), no quick-buy from grid.
**Why it matters:** Blur/OpenSea let you buy a specific NFT or sweep the floor in ~1‑2 clicks from the browse surface. Memba adds 3+ navigations before a buy is even possible.
**Fix:** Add an item-level "Listed now" browse (across collections), quick-buy on hover/tap, and expose floor-sweep. Keep the collection page for depth, don't make it the only path to a purchase.

### P1 — Lanes are visually and behaviorally inconsistent (three design systems)
**What:** `NftLane` = `um-grid` + `k-card` + heavy inline styles + JS hover. `TokenLane` imports a *different* stylesheet (`marketplace-v2.css`) and a *different* class taxonomy (`mhub-collection-card`, `mhub-grid`, `mhub-launch-link`). `AgentLane`/`ServiceLane` = `um-grid` + inline. Sell CTAs differ per lane: NFT "Launch a collection" (EmptyState button), Token "List Tokens" (text link), Agent "Deploy Agent" (primary button). Loading text differs per lane; errors differ (`k-card` red vs `mhub-error`); no retry anywhere. `TokenLane` onSuccess does `window.location.reload()` (ln 111) — nukes SPA state; MyListings is optimistic.
**Why it matters:** Tier-1 marketplaces feel like *one product* across categories (Amazon, Fiverr). Memba's lanes feel bolted together, which erodes trust in a money surface.
**Fix:** One shared component set: `<MarketCard>`, `<MarketToolbar>`, `<MarketGrid>`, skeleton loaders, standardized empty/error-with-retry. Remove `marketplace-v2.css`/`mhub-*` from the Token lane. Replace `window.location.reload()` with query invalidation.

### P1 — No unified "Sell anything" entry (a locked decision, unbuilt)
**What:** Locked spec: "Sell anything single entry routes by asset type." Reality: NFT create is reachable only via an EmptyState action or deep link; Token list is a text button defaulting `symbol:"MEMBATEST"` hardcoded (`TokenLane.tsx` ln 51 — you can't even choose the token); Agent register is a separate modal. No global "List / Sell" CTA in the shell or nav.
**Why it matters:** Supply is half the marketplace. Fiverr "Create a Gig" and OpenSea "Create" are top-level, always-present. Memba hides selling behind empty states and a broken token picker.
**Fix:** Persistent **"Sell"** CTA in shell header + mobile FAB → asset-type chooser → correct create flow. Fix the token list flow to pick a real token.

### P2 — Interaction details below tier-1
- **JS hover, no touch/keyboard state:** `NftLane.tsx` ln 118‑127 (cards) + 181‑182 (activity rows) use `onMouseEnter/Leave` inline. Mobile has no hover → cards feel dead; no `:focus-visible` → keyboard users get nothing. Move to CSS `:hover`/`:focus-visible`; add active/pressed state for touch.
- **Emoji tab icons** (`UnifiedMarketplace.tsx` ln 36‑41 🖼️💼🪙🤖🏷️) clash with Phosphor icons in the nav manifest and read informal for a money surface. Use the tokenized Phosphor set.
- **A11y:** `role="tab"` NavLinks have no `aria-selected`/`aria-controls` tie to a `tabpanel`; search `<input>` has placeholder but no label; no skip-to-content on the long grid.
- **No skeletons:** every lane shows a plain "Loading…" string. Skeleton cards are table stakes (OpenSea/Fiverr).
- **Cluttered token cards:** `CollectionPublic` crams up to List/Delist/Accept/Buy/Make-offer buttons under each grid card — move secondary actions into an overflow or the detail page.
- **My Listings covers only nft+token** (`MANAGED_LANES`), not services/agents → fragmented seller dashboard.
- **First-visit onboarding: none.** No "what is this / how it works / why on-chain" for a non-crypto-native. Hero chips assume literacy ("Milestone escrow", "Atomic OTC settlement").

---

## TIER-1 BAR & THE GAP

| Dimension | Tier-1 bar (benchmark) | Memba today | Gap |
|---|---|---|---|
| Discovery | Faceted cross-category search + filters + sort (Airbnb, Fiverr) | NFT-name-only `?q`, sort in one lane, no filters | **Severe** |
| Front door | Curated featured/trending/activity home (OpenSea, Magic Eden) | Routes straight to a raw lane grid | **Severe** |
| Mobile IA | Commerce in primary bottom nav (all majors) | Unreachable except via search | **Critical** |
| Funnel depth | 1‑2 clicks to buy / sweep (Blur, OpenSea) | 4+ navigations, collections-only, no item browse | **High** |
| Trust | Reputation/reviews on every listing (Fiverr, Airbnb) | Reviews exist, unwired; raw addresses | **High** |
| Consistency | One system across categories (Amazon, Fiverr) | Three class taxonomies, per-lane CTAs | **High** |
| Wallet flow | Connect-then-continue in-context (Uniswap) | `alert()` + dead text hints, intent lost | **High** |
| Sell entry | Always-present top-level Sell/Create | Hidden in empty states; token picker hardcoded | **High** |
| Price transparency | Clear fee/royalty breakdown (Uniswap, Stripe) | `PriceBreakdown` + royalty notice | **At bar — keep** |

**The one strength to protect:** the `TradeModal`/`PriceBreakdown` fee+royalty transparency and the escrow/offer copy are genuinely tier-1. Do not regress these in the rebuild.

---

## QUICK WINS (days)
1. Add **Market** primary mobile tab + **Sell** in `ActFab` → restores mobile reachability. *(P0, small)*
2. Collapse `services`/`nft` sidebar entries into one **Marketplace** (Storefront icon); delete `Marketplace.tsx`/`MarketplaceHub.tsx`/`FreelanceServices.tsx`. *(P0 IA)*
3. Replace all `alert()` connect prompts with the shared connect modal; make "Connect wallet" hints actual buttons. *(P1)*
4. Debounce + control the search input; make `TokenLane`/`ServiceLane`/`AgentLane` honor `?q` (or scope the box to the active lane and label it so). *(P1)*
5. Swap emoji tab icons for Phosphor; add `aria-selected`; add skeleton loaders + retry buttons. *(P2)*
6. Replace `window.location.reload()` (TokenLane) with query invalidation. *(P2)*
7. Move NFT card hover from JS inline to CSS `:hover`/`:focus-visible`. *(P2, also perf)*

## DEEPER REWORK (weeks)
1. **Shared discovery layer** — faceted filters + unified sort + cross-lane results. *(P0)*
2. **Marketplace home** — featured/trending/activity front door. *(P0)*
3. **Shared component set** — `MarketCard`/`MarketToolbar`/`MarketGrid`/empty/error, one taxonomy across lanes. *(P1)*
4. **Item-level browse + quick-buy + floor sweep** for NFT; shorten the buy funnel. *(P1)*
5. **Trust layer** — wire reviews/reputation into every card + detail. *(P1)*
6. **Unified "Sell anything"** router + fixed token-list picker; unify My Listings across all lanes. *(P1)*
7. **First-visit onboarding** — progressive "how it works" for non-crypto-natives. *(P2)*

---

## CTO MUST-FIXES BEFORE SHIPPING THE NEW VERSION
1. **Mobile reachability is a launch blocker.** A marketplace absent from mobile nav has no mobile funnel — fix `navManifest` primary tabs + `ActFab` before anything else.
2. **Kill the multi-door IA.** One canonical Marketplace entry; retire the legacy sidebar entries and orphaned pages, or the unified shell is theater.
3. **Search must not lie.** Either make it truly cross-lane or scope+label it to the active lane. A global box that silently filters NFT names only will burn trust on a money surface.
4. **One design system across lanes.** Ripping `mhub-*`/`marketplace-v2.css` out of Token and standardizing cards/toolbars/states is non-negotiable for a "unified" claim.
5. **Connect-then-continue, no `alert()`.** Never drop user intent at the wallet gate.
6. **Don't ship empty/mock lanes as if live.** Services (empty) + Agents (mock) undercut the whole surface — either populate, hide, or clearly frame them; the current half-real state reads as vaporware.
7. **Protect the price/fee/royalty transparency** — it's the one already-tier-1 asset; carry it forward intact.
