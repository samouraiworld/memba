# Expert 1 — Visual / UI Design & Art Direction Audit

**Lens:** visual hierarchy, typography, color/tokens, card & hero design, merchandising, spacing/grid, motion, dark+light polish, brand consistency.
**Verdict:** The marketplace reads as an **engineer's terminal/admin panel**, not a merchandised marketplace. The App Store (#808) and the `um-hero` prove the team *can* hit a tier-1 bar — the lanes just haven't inherited it. The gap is closable and mostly systemic (one card, one type system, one hover), not a redesign-from-zero.

---

## Top Findings

### P0 — Monospace monoculture kills the "product" read
- **Where:** `index.css` `.k-label` (373), `.k-value` (383), `.k-btn-wallet` (355); `marketplace-v2.css` `.mhub-search` (48), `.mhub-launch-link` (70), `.mhub-section-title` (89), `.mhub-activity-row__*` (219/227/234), `.cpub-tab` (400), `.cpub-token-card__id/__price` (477/484), `.cpub-action-btn` (517), `.cpub-about-row__term` (571); `.mhub-loading/empty/error` all mono.
- **What's wrong:** JetBrains Mono is applied to **prices, section titles, search inputs, primary buttons, tabs, and body-ish labels** — i.e. everywhere. Mono is a DATA typeface; using it for chrome and CTAs makes the whole surface read as a Bloomberg terminal / dev console.
- **Benchmark:** OpenSea, Magic Eden, Blur, Fiverr all set prices and UI in a humanist sans; mono (if any) is reserved for hashes/addresses. Linear/Stripe never put mono on a button or a section header.
- **Fix:** Enforce the locked rule literally — `--font-sans` (upgrade to **Inter**, not `system-ui`) for all display, titles, buttons, prices, body; `--font-mono` only for addresses, tx hashes, token IDs, contract paths. This one change alone shifts the perceived tier the most.

### P0 — Inline-style + JS-hover anti-pattern (visual cost, not just perf)
- **Where:** `NftLane.tsx` 107–160 (card), 118–127 (`onMouseEnter/Leave` mutating `transform/boxShadow/borderColor`), 181–182 (activity row hover).
- **What's wrong visually:** (1) Hardcoded `border: 1px solid rgba(255,255,255,0.05)` (114/126) and hover `box-shadow: 0 20px 40px rgba(0,0,0,0.4)` (120) are **dark-theme-only** — on light theme the border is invisible and the shadow is a black slab. The JS path *bypasses* the theme-aware `.k-card:hover`. (2) Card radius is overridden inline to 16px while every sibling card is 12px. (3) The hover motion — `translateY(-6px)` + 40px shadow — is a heavy "web3-bro" lift; tier-1 (Linear, Stripe) lifts 1–2px with a hairline border-color shift. (4) State lives in JS, so it can't be tuned in the design system.
- **Benchmark:** Magic Eden / Linear cards: CSS-only `:hover`, ≤2px translate, GPU-composited, identical in both themes.
- **Fix:** Delete all inline styles + mouse handlers; move to a single `.mkt-card` class with `:hover` transition. Restrained lift, token-driven border/shadow, works in both themes for free.

### P0 — No single card primitive → four card systems, four grids
- **Where:** `.k-card` (index 271, r12/p20) vs `.mhub-collection-card` (v2 107, r12, media-forward) vs `.cpub-token-card` (v2 434, `--radius-lg`) vs `.appcard` (appstore 57, r12) — plus NftLane's inline r16 override. Grids: `.um-grid` `minmax(300px)` (247) / `.mhub-grid` `minmax(170px)` (102) / `.cpub-token-grid` `minmax(180px)` (430) / `.appstore__grid` `minmax(240px)` (53).
- **What's wrong:** Radii (12/16/lg), paddings, borders (`0.5px` vs `1px`), hovers, and **column widths all differ** between lanes and between the lane grid and the collection detail grid. There is no shared rhythm; the eye can't lock onto a consistent unit.
- **Benchmark:** OpenSea/Blur ship ONE collection card and ONE item card, reused everywhere, one grid metric.
- **Fix:** One `<MarketCard>` component + one `.mkt-grid` metric (recommend `minmax(220px,1fr)`, gap `--space-5`) used by every lane and the collection page.

### P1 — Merchandising void: text-only cards, placeholder-only art
- **Where:** `TokenLane.tsx` 70–99 (card = symbol + one stats line + Buy — **no media, no monogram, no visual anchor**); `NftLane.tsx` 130–131 (`<NFTMedia uri="" …>` — always the seed-generated placeholder, real collection banners never rendered).
- **What's wrong:** The Token lane is a spreadsheet row styled as a card. The NFT lane never shows real imagery. A marketplace's whole job is to *merchandise* — this reads cold and empty, exactly the "un-merchandised admin panel" diagnosis.
- **Benchmark:** Fiverr leads with gig thumbnails + seller avatar + rating; OpenSea with collection art + floor + 24h trend; App Store (#808, in-repo) already uses **monogram gradient tiles** — the sanctioned pattern.
- **Fix:** Every card gets a media zone: real art when present, else the App-Store monogram gradient tile (the ONE sanctioned hardcoded-color exception) seeded per item. Token cards get a token monogram + symbol lockup. Add price/trend + a trust chip (rating/verified) to the card body.

### P1 — Emoji as navigation iconography
- **Where:** `UnifiedMarketplace.tsx` `LANE_TAB_ICONS` 36–41 (🖼️💼🪙🤖) + My Listings 🏷️ (152).
- **What's wrong:** Emoji render differently per OS/browser, don't inherit color, and read as unfinished next to the Phosphor set the app already ships. Instant "amateur" tell in the primary nav.
- **Benchmark:** Linear/Stripe/OpenSea use a single monoline icon set in chrome; never emoji.
- **Fix:** Swap to Phosphor duotone icons that inherit the lane accent + `currentColor`.

### P1 — Token palette is two palettes; hardcoded colors leak
- **Where:** `tokens.css` 99–133 — a 44-entry "inline-hex migration" bucket with **4 purples** (`-purple/-alt/-deep/-soft`), 6 golds/ambers, and `-surface-void/abyss/black`. Lane accents (`unified-marketplace.css` 42–45) pull from this un-designed bucket (`--color-accent-purple` NFTs, `-blue-bright` services, `-amber` agents, `-teal` tokens). Hardcoded: `--color-success: #4caf50` (24) and `--color-info: #2196f3` (25) — despite marketplace-v2's own header banning `#4caf50`; `.cpub-token-card__best-offer` `#1a7f4b` (497); `.cpub-action-btn--accept #1a7f4b` (531); `--color-text-dim: #444` (29).
- **What's wrong:** Lane color is a good idea executed as random hex, not a scale. Success/info greens are hardcoded and off-brand vs the teal `--color-k-accent`.
- **Benchmark:** Stripe/Linear ship a small semantic scale + one accent ramp; no parallel "migration" palette.
- **Fix:** Define a real **4-lane accent scale** (`--lane-nft/service/token/agent`, each with `-subtle/-border/-text` and AA-checked light variants). Route success/info to `--color-k-*` tokens. Delete dead hex once migrated.

### P1 — Primary-action button has no canonical form
- **Where:** `.k-btn-primary` (index 298, glow, r8) vs `.mhub-launch-link` (v2 62, a *link* style, mono) used as the "List Tokens" **button** in `TokenLane.tsx` 44 vs `.cpub-action-btn` (v2 510, mono) vs `TokenLane.tsx` 80 reusing `.trade-modal__confirm` (a modal class) as the card **Buy** CTA.
- **What's wrong:** ≥4 visual treatments for "the primary action," including a link masquerading as a button and a modal-confirm class on a card. Users can't learn "this shape = buy."
- **Benchmark:** Stripe/Linear: exactly one primary, one secondary, one ghost — everywhere.
- **Fix:** Collapse to `.k-btn-primary/secondary/ghost`; ban link/modal classes as marketplace CTAs.

### P2 — Type scale + spacing tokens exist but are bypassed
- **Where:** `tokens.css` defines `--text-xs…4xl` (59–66) and a 4px grid (69–79); `NftLane.tsx` hardcodes `18px/14px/12px/11px` and `16/24/60px` inline; `um-hero-title` uses `clamp` (91). Display weight ladder is inconsistent: hero 800 (`um-hero-title`), lane titles 700, card names 700, values 600.
- **Fix:** Bind all sizes/spacing to tokens; define one display-weight ladder (e.g. 700 display / 600 heading / 500 label).

### P2 — Hero has no visual anchor / featured merchandising
- **Where:** `unified-marketplace.css` 12–151 + `UnifiedMarketplace.tsx` 115–130. The terminal-grid hero is genuinely well-crafted and theme-aware (keep it) — but it's **pure copy**; there's no featured collection/hero art, no "trending" strip.
- **Benchmark:** OpenSea/Magic Eden lead with a featured hero image/carousel; that's the merchandising hook.
- **Fix:** Add an optional featured-item slot in the hero (or a "Featured" rail directly beneath) showing real art with price/CTA.

---

## Tier-1 Bar & Memba's Gap
**World-class marketplace visual bar:** (1) one card, one grid, one button set, one type ramp — total consistency; (2) media/merchandising leads every card (art or a deliberate generative tile) with price + a trust signal; (3) humanist sans for everything, mono only for on-chain data; (4) a designed accent system, zero stray hex; (5) restrained, GPU-composited, theme-safe motion; (6) pixel-parity light/dark.

**Memba today:** hero + App Store already at ~tier-1; the lanes sit at ~tier-3 — mono-everything, four card systems, JS hover that breaks light theme, text-only/placeholder cards, emoji nav. **The gap is inheritance, not invention:** propagate the App-Store/`um-hero` language down into a shared card + button + type system.

## Quick Wins (days)
1. Global font swap: sans for chrome/CTAs/prices, mono only for addresses/IDs.
2. Replace emoji tab icons with Phosphor.
3. Kill NftLane inline styles + JS hover → one `.mkt-card:hover` (fixes light-theme border/shadow bugs for free).
4. Route `--color-success/-info` and the `#1a7f4b`/`#444` literals to tokens.

## Deeper Rework (1–2 sprints)
1. One `<MarketCard>` + `.mkt-grid` adopted by every lane and CollectionPublic.
2. Merchandising: media zone on every card (art or monogram tile) + price/trend + trust chip.
3. Designed 4-lane accent scale with AA light variants; retire the 44-hex migration bucket.
4. Featured/hero merchandising slot.

## CTO Must-Fix Before Shipping the New Version
- **No mono on buttons, prices, titles, or inputs.** It's the single biggest "looks like a dev tool" signal.
- **Delete inline-style + JS-hover in NftLane** — it's an active light-theme rendering bug (invisible borders, black-slab shadow), not just tech debt.
- **One card, one grid, one button, one type ramp** shared across all lanes — ship this before adding Services/Tokens breadth, or the inconsistency compounds per lane.
- **No emoji in primary nav.**
- Every card must carry imagery/merchandising; a text-only card (TokenLane) is not shippable at this bar.
