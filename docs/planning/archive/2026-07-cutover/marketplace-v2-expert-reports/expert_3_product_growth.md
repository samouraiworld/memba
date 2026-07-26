# Expert 3 — Product & Growth / Marketplace-Liquidity Audit

**Lens:** two-sided marketplace product; cold-start/liquidity; merchandising; trust-as-growth; taxonomy; seller funnel; retention; 3-lane coherence; differentiation.
**Verdict:** The shell is competent engineering with a **fatal marketplace-product gap**: it was built supply-out (list objects) instead of demand-in (solve a job). Only NFT has any real supply, and even NFT reads as a block explorer with cards, not a place you'd come to *shop*. This is a **pre-liquidity marketplace shipped as if it were a post-liquidity one.** The single most important reframe: **do not launch 3 half-cold lanes. Launch 1 lane you can make feel alive, and stage the others behind demonstrated liquidity.**

---

## TOP FINDINGS (ranked)

### P0-1 — Three-lane breadth is a cold-start multiplier, not a feature
**What's wrong:** `lanes.ts` registers nft/service/token/agent as co-equal tabs. Services = `SERVICES: Service[] = []` (`ServiceLane.tsx:10`), Agents = 1 seed row (`agentRegistry.ts:87`), Tokens defaults symbol to `"MEMBATEST"` (`TokenLane.tsx:51`). Only NFT reads real supply.
**Why it matters:** Every marketplace dies of the same disease — no demand because no supply, no supply because no demand. Breadth **divides** your scarce early liquidity across 3 order books instead of concentrating it in one. Fiverr didn't launch with 700 categories; it launched with gigs concentrated enough that a buyer always found *something*. OpenSea won by going deep on one behavior (trade PFPs) before "everything." a16z's marketplace playbook is explicit: **win one market, one geography, one category first.** Memba is doing the opposite — maximum surface, minimum depth.
**Benchmark:** Fiverr (concentrate), OpenSea (one behavior first), Airbnb (one city — NYC — before the world).
**Recommendation:** Pick **NFT as the beachhead lane** (only one with real supply + on-chain-native buyers). Services + Tokens stay gated until NFT shows a *repeat-buyer loop*. Reframe the shell honestly: it is an **NFT marketplace with a roadmap**, not a "unified everything marketplace" that is 70% empty.

### P0-2 — No supply-seeding strategy; lanes ship empty and honest instead of full and curated
**What's wrong:** ServiceLane renders "coming soon"; AgentLane shows 1 self-listing; NFT shows whatever happens to be on-chain. There is **no seeded inventory, no house listings, no featured curation set.** The brief's own constraint ("no fake listings, no coming-soon tabs") is correct for *integrity* but has been implemented as *emptiness* rather than *real seeded supply.*
**Why it matters:** Marketplaces do not bootstrap by waiting — they **manufacture the first side.** OpenTable seeded restaurants manually. DoorDash's founders *were the drivers.* Reddit seeded with fake-then-real users. The rule: **the house is the first seller.** Memba has a DAO, a treasury, a team, and a community — it can seed 30-50 *real* listings (real art, real services offered by the core team/community, real token blocks) that are genuinely fulfillable. "10+ template listings per category" in the ask is exactly right, but they must be **real inventory the DAO stands behind, not mock rows.**
**Recommendation:** Ship a **"Founding Supply" program**: DAO commissions/lists 30-50 real items across the beachhead lane before public launch. Curated "Featured" and "Verified Founding Creator" shelves. This is a growth investment, not a hack.

### P0-3 — Reputation exists but is not wired into listings — trust is the #1 conversion lever and it's disconnected
**What's wrong:** `ReviewsSection.tsx`/`StarRating.tsx`/`reviews.ts` exist (per brief), and `memba_reviews_v1` is deployed, but **no lane card shows a rating, review count, seller history, or trust badge.** NftLane cards show floor/volume only; ServiceLane/AgentLane cards would show a raw `★ rating` from mock data. Verification is a binary badge with no substance behind it.
**Why it matters:** On Fiverr, **rating + review count + response time + "Level 2 Seller" is the entire click decision** — buyers de-risk a stranger via social proof. On Airbnb, reviews *are* the product (they replaced the need to trust a host). A marketplace with no visible reputation on the listing card is asking buyers to send money to a hex address on faith. This is the highest-ROI unshipped asset Memba already owns.
**Benchmark:** Fiverr seller levels, Airbnb Superhost, Upwork Job Success Score, OpenSea verified + holder count.
**Recommendation:** Wire `reviews` into **every lane card and detail page**: star rating, review count, "verified creator," seller sales count, "member since." Introduce a **seller-tier system** (New → Trusted → Top, gated on completed sales + rating) — the single most proven marketplace trust/retention primitive.

### P1-4 — No taxonomy / no browse-by-category — buyers can't form intent
**What's wrong:** NftLane has one flat "Trending Collections" grid with sort=volume/floor/name + a verified toggle. No categories. ServiceLane/AgentLane have a single `category` string field but no category *navigation*. There is no way to browse "Art" or "Smart-contract audits" or "Governance agents." Search is a single cross-nothing `?q` box that only filters names client-side (`NftLane.tsx:55`).
**Why it matters:** Category taxonomy **is** how buyers convert intent into a shortlist. Etsy, Fiverr, OpenSea all lead with categories because "I want a logo" / "I want a PFP" is how humans shop. No taxonomy = no merchandising surface, no SEO landing pages, no "featured in category" curation, no way to make a thin catalog *feel* organized rather than *empty*.
**Benchmark:** Fiverr's category tree, Etsy's category + attribute filters, OpenSea's category chips.
**Recommendation:** Ship the taxonomy below per lane, with category chips + category landing shelves. Even 15 real listings feel like a store when organized into 5 named aisles; 15 listings in one flat grid feel like a garage sale.

### P1-5 — No first-listing seller funnel; "list" is a raw wallet action
**What's wrong:** Selling = `navigate(np("nft/create"))` (NftLane empty-state), or a "List Tokens" button that hardcodes `symbol="MEMBATEST"` (`TokenLane.tsx:51`), or "coming soon." There is no onboarding, no guided first-listing, no template picker, no "what sells here," no pricing guidance.
**Why it matters:** Supply is the constrained side of every young marketplace, and **activation of the first listing is where sellers drop.** Fiverr, Etsy, Gumroad all invest heavily in the *create-your-first-listing* wizard (templates, examples, pricing hints, preview) because a seller who publishes once is 10x more likely to return. Memba treats listing as an expert wallet operation.
**Recommendation:** Build a **guided "Sell on Memba" funnel**: pick asset type → pick category → template-prefilled form → live preview → publish → share card. Show "similar listings sell for X." This is core marketplace infrastructure, not polish.

### P1-6 — NFT lane reads as an admin panel, not a storefront (merchandising gap)
**What's wrong:** The live lane shows collection cards with floor/volume/name and a "Recent Activity" ledger of `g1abc… → g1def…` sales (`NftLane.tsx:184-205`). No hero item, no featured collection, no editorial, no "trending this week," no price movement, no items (only collections), no imagery beyond seeded fallback art.
**Why it matters:** The brief already diagnosed this ("correct but un-merchandised"). Best-in-class NFT marketplaces (Magic Eden, Blur, OpenSea) lead with **a merchandised hero, trending carousels, top movers, live mints, and item-level browse** — they sell *desire*, not a database. An address-to-address activity ledger is a block-explorer aesthetic that suppresses emotional conversion.
**Recommendation:** Add featured hero, "Trending" / "Top Movers" / "New Mints" shelves, item-level grid (not just collections), real media pipeline. Merchandising is the difference between "correct" and "wanted."

### P1-7 — Marketplace buried in mobile "More" overflow — discovery starved
**What's wrong:** Per brief, marketplace lives in mobile "More" sheet (`navManifest.ts`), not a primary tab.
**Why it matters:** If the marketplace is the treasury-utility flywheel (the whole revenue thesis), burying it contradicts the strategy. Discovery placement is a growth decision, not an IA nicety. On any commerce app the store is a primary destination.
**Recommendation:** Promote marketplace to a primary mobile tab once it has real supply. (Chicken-egg: don't promote an empty store — sequence after P0-2.)

### P2-8 — 3-lane thesis is coherent as *treasury strategy*, incoherent as *user product*
**What's wrong:** NFT + Services + Tokens + Agents share a shell and a fee-spine, but they serve **four different buyers with four different jobs** (collect art / hire a human / trade a token / deploy an MCP). Nothing about buying an NFT primes you to hire a freelancer.
**Why it matters:** The fee-flywheel logic (all lanes → one treasury) is sound *finance*, but a marketplace's user-facing value is **network density within a category**, not breadth across categories. Cross-lane synergy is near-zero at the user level. This is fine — *if* framed as "one front door to several independent markets" and each is allowed to reach liquidity on its own timeline. It is NOT fine if breadth is used as a substitute for depth.
**Recommendation:** Keep the unified shell (locked decision — don't relitigate), but **internally treat each lane as a separate marketplace with its own liquidity KPI and its own go/no-go.** Ship order, not simultaneity.

### P2-9 — Agents lane is a category error (secondary), and Tokens competes with a job DEXes do better
**What's wrong:** Agents = MCP registry (a *directory*, not a marketplace — one seed listing, free, no real trade). Tokens = OTC desk at 0.5% competing with ~0.3% AMMs for a job (swap tokens) that AMMs do with better UX and instant liquidity.
**Why it matters:** OTC is for *large blocks / illiquid / price-sensitive* trades — a real niche, but a *thin, expert* one that will never "feel alive" with retail listing cards. Agents-as-marketplace has no proven demand yet.
**Recommendation:** Reposition Tokens explicitly as **"OTC block desk"** (large/illiquid/community-launch allocations), not "trade tokens" (which invites a losing AMM comparison). Demote Agents to a **directory/registry** surface, not a marketplace lane — remove it from the trade shell until there's pay-per-use demand.

---

## RECOMMENDED CATEGORY TAXONOMY (per lane)

Design rule: 6-9 categories per lane (Fiverr-depth without sprawl), each seeded with **10+ real listings** at launch. Web3-native categories are the **differentiation wedge** — do NOT just clone Fiverr/OpenSea; lead with what only an on-chain community marketplace can offer.

### NFT lane (benchmark: OpenSea / Magic Eden collections)
1. **Art** — 1/1s, illustration, generative
2. **On-chain / Generative Art** *(Gno wedge — fully on-chain SVG, provenance-native)*
3. **PFPs & Avatars** — collection profile pictures
4. **Photography**
5. **Music & Audio**
6. **Memberships & Passes** *(Gno wedge — DAO access, gated realms, event passes)*
7. **Community & Contributor Badges** *(Gno wedge — validator/gnolove/quest badges as tradeable proof-of-work)*
8. **Domains & Names** — gno.land namespace assets
9. **Collectibles & Gaming items**
Featured shelves: *Trending · Top Movers · New Mints · Verified Founding Creators.*

### Services lane (benchmark: Fiverr categories — but Web3-native first)
1. **Smart Contract / Realm Development** *(Gno wedge — the killer category; nobody else has a Gno freelance market)*
2. **Security Audits & Reviews** *(Gno wedge — high-value, trust-heavy, escrow-perfect)*
3. **DAO Setup & Governance Ops** *(Gno wedge — tokenomics, proposal drafting, treasury ops)*
4. **Graphics & Design** — logos, NFT art, brand
5. **Programming & Tech** — dApp/front-end, integrations, MCP
6. **Writing & Translation** — docs, whitepapers, proposals
7. **Marketing & Community** — growth, community management, KOL
8. **Video & Animation**
9. **AI & Data Services**
Fiverr-parity for breadth; categories 1-3 are the reason a Gno builder chooses Memba over Fiverr. Escrow milestone settlement is the trust primitive Fiverr charges 20% for — Memba at 2% is a wedge *if* trust (reviews/tiers) is present.

### Tokens lane (benchmark: OTC desks / Uniswap token lists — NOT retail swap)
Reposition as **OTC Block Desk**:
1. **Community & Social Tokens** — creator/community grc20s
2. **DAO Governance Tokens**
3. **New Launches / Fair-Launch Allocations** *(wedge — primary distribution, not just secondary)*
4. **Large Blocks / OTC** — size that would slip on an AMM
5. **Vesting / Locked Allocations** — structured, time-locked deals
6. **Utility Tokens** — realm/app utility
7. **Stable-value pairs**
Frame every card by *why OTC beats the AMM here* (size, price certainty, no slippage, no pool needed).

*(Agents — if retained at all: Governance / Development / Analytics / Portfolio / Content / Security / Custom already exist in `agentRegistry.ts:75`. Keep as a **registry/directory**, not a trade lane.)*

---

## TIER-1 BAR & GAP

| Dimension | Tier-1 bar (who does it) | Memba today | Gap |
|---|---|---|---|
| **Cold-start** | Manufacture first side; house is first seller (DoorDash, OpenTable) | Empty/mock lanes; wait for supply | **Total** — no seeding strategy |
| **Liquidity focus** | Win one category deep before breadth (a16z, OpenSea, Airbnb) | 3-4 co-equal thin lanes | **Severe** — breadth before depth |
| **Trust/reputation** | Rating + reviews + seller tiers on every card (Fiverr, Airbnb) | Reviews realm exists, unwired | **High** — owned asset unused |
| **Taxonomy/merch** | Category browse + featured + trending (Etsy, Magic Eden) | Flat grid, one sort, no categories | **High** |
| **Seller funnel** | Guided first-listing wizard w/ templates (Fiverr, Etsy, Gumroad) | Raw wallet call, hardcoded symbol | **High** |
| **"Feels alive"** | Hero, movers, live activity, real media (Blur, OpenSea) | Address ledger, seeded fallback art | **Medium-High** |
| **Differentiation** | A reason to pick this over incumbent | Fee is lower; nothing else surfaced | **Medium** — Gno-native categories not merchandised |

**One-line gap:** Memba built a *marketplace container* to tier-1 engineering standard and shipped it *before doing any of the tier-1 marketplace-growth work* (seeding, one-lane focus, reputation, taxonomy, seller activation, merchandising).

---

## QUICK WINS (days–2 weeks)
1. **Wire reviews/ratings into every lane card + detail** (asset already exists). Highest ROI.
2. **Add category taxonomy + chips** to NFT lane (and Services/Tokens data models) — organize even a thin catalog.
3. **Add "Featured" + "Trending" shelf** to NFT lane; kill the raw address→address ledger as the primary "activity" surface (or humanize it with avatars/ENS-style names).
4. **Reframe copy honestly**: NFT-first marketplace with roadmap; remove implied "everything store" until real.
5. **Ship a guided first-listing preview** on the existing NFT create path (template + live preview + "share your listing").
6. **Reposition Tokens as "OTC Block Desk"** in HERO_META copy; reposition/demote Agents out of trade shell.

## DEEPER REWORK (weeks–quarter)
1. **Founding Supply program** — DAO seeds 30-50 real listings in the beachhead lane pre-launch.
2. **Seller-tier / reputation system** (New→Trusted→Top on completed sales + rating) across lanes.
3. **Sell-on-Memba funnel** — full guided create flow with templates + pricing guidance per category.
4. **Item-level NFT browse + merchandised home** (hero, movers, new mints, real media pipeline).
5. **Per-lane liquidity KPI + staged go/no-go** — Services/Tokens de-gate only on demonstrated repeat-buyer loop, not calendar.
6. **Category landing pages** (SEO + curation surface) once taxonomy exists.

## CTO MUST-FIXES (before shipping the new version)
1. **Do not launch 3-4 co-equal lanes.** Ship NFT as the focused beachhead; gate the rest behind liquidity metrics. Breadth now is a cold-start liability.
2. **Wire the reputation you already own into listings.** Sending money to a hex address with zero trust signal is a conversion killer and a scam-risk. Non-negotiable.
3. **Seed real supply (Founding Supply).** A marketplace that ships empty stays empty. Budget it as growth spend.
4. **Ship a category taxonomy and a first-listing funnel.** Without browse-by-intent and seller activation, this is a database with a fee, not a marketplace.
5. **Fix the honesty/UX debt that signals "unfinished":** hardcoded `symbol="MEMBATEST"` (`TokenLane.tsx:51`), mock single-agent lane, `window.location.reload()` post-trade (`TokenLane.tsx:111`) — small, but they read as a demo, not a product, to the crypto-native audience you're courting.
