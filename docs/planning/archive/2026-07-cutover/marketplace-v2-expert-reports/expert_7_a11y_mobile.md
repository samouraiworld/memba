# Expert 7 — Accessibility + Mobile-First + Conversion Audit

**Lens:** WCAG 2.2 AA, mobile-first responsive, JS-hover/touch parity, conversion friction.
**Benchmarks:** Shopify mobile checkout, Fiverr app, OpenSea/Blur/Magic Eden mobile, Apple HIG, Stripe.
**Verdict:** The desktop marketplace is competent; the **mobile experience is effectively broken as a funnel** — the marketplace is unreachable from mobile navigation, and the primary trade surface (TradeModal) has no mobile layout and no real focus management. This is the single biggest gap to tier-1.

---

## Top findings

### P0 — Marketplace is UNREACHABLE from mobile navigation
`src/lib/navManifest.ts:111-118`. The mobile IA is curated from three id-lists: `PRIMARY_TABS_*`, `MORE_NAV_IDS`, `MORE_ACCOUNT_IDS`. **None** of them include `marketplace`, `nft`, `services`, or `appstore` — the entire `'launch'` group (navManifest.ts:77-80) exists only in the desktop sidebar. On mobile the marketplace has **zero** nav entry: not a tab, not in the "More" sheet, not in ActFab. The only paths in are the command palette ("Search…") or a bookmarked URL.
- **Why it matters:** Fiverr, OpenSea, Magic Eden all put the marketplace/browse surface one thumb-tap away — it is the store. A commerce surface you cannot navigate to on mobile converts at ~0. The brief called it "buried in the More sheet"; it's worse — it isn't in the sheet at all.
- **Fix:** Add `marketplace` (+ `appstore`) to `MORE_NAV_IDS`, and strongly consider promoting `marketplace` to `PRIMARY_TABS_*` (replace a low-value tab). Flag-gate the same way the sidebar does (`renderMoreLink` already badges "soon"). This is a 1-line array edit — ship immediately.

### P0 — TradeModal has no mobile layout and can trap the CTA off-screen
`src/components/nft/TradeModal.tsx` + `TradeModal.css`. The modal is a **vertically centered** `width: min(480px, 92vw)` box with **no `@media` rules, no `max-height`, no `overflow` scroll**, and no mobile bottom-sheet variant. The List flow stacks title + info + 2-step indicator + price input + PriceBreakdown + royalty notice + actions. On a 375–667px viewport that column exceeds the height; because the modal is centered with no scroll, **the Confirm/List button can render below the viewport with no way to reach it** — checkout dead-ends.
- **Why it matters:** Shopify/Stripe mobile checkout is a full-height sheet with a **sticky bottom pay button** — the CTA is always reachable and thumb-anchored. A center-float desktop dialog reused verbatim on mobile is the classic conversion killer.
- **Fix:** On `≤640px`, dock TradeModal to the bottom as a full-width sheet (`inset: auto 0 0 0`), `max-height: 90dvh`, `overflow-y: auto`, and pin `.trade-modal__actions` sticky to the bottom with a safe-area inset. Reuse the existing `k-bottom-sheet` visual language.

### P0 — TradeModal is not a real modal dialog (no focus trap / focus return / aria-modal)
`TradeModal.tsx:341-346`. It sets `role="dialog"` + `aria-label` but is **missing `aria-modal="true"`, focus is never moved into the dialog on open, focus is never trapped (Tab escapes to the page behind), and focus is never returned to the trigger on close.** Only Escape is wired. `BottomSheet.tsx:24-29` has the same defect — the comment claims "focus trap" but it only calls `contentRef.current?.focus()` once; Tab still walks out.
- **Why it matters:** WCAG 2.4.3 (Focus Order) / 2.1.2 (No Keyboard Trap — inverse) / ARIA APG dialog pattern. A keyboard or screen-reader user opening Buy/List lands on nothing and can Tab into the dead page underneath while a transaction dialog is "open." Every serious checkout (Stripe, Shopify) traps and restores focus.
- **Fix:** Adopt one focus-trap primitive (roll a small `useFocusTrap`, or wrap in a library dialog) used by both `TradeModal` and `BottomSheet`: move focus to first interactive element on open, cycle Tab within, restore focus to opener on close, add `aria-modal="true"` and `aria-labelledby` pointing at the `<h3>` title.

### P1 — Broken tablist ARIA on the marketplace lane tabs
`UnifiedMarketplace.tsx:134-155`. `<nav role="tablist">` wraps `<NavLink role="tab">`, but there is **no `aria-selected` on the active tab, no `role="tabpanel"`/`aria-controls` on `<main>`, no roving `tabindex`, and no arrow-key handling.** These are router links, not tabs. Screen readers announce "tab, 1 of N" and users expect arrow-key navigation and a selected state that don't exist. The mobile tab bar (`MobileTabBar.tsx:98`) correctly uses `aria-current="page"`; the marketplace tabs do not even do that.
- **Why it matters:** WCAG 4.1.2 (Name, Role, Value). A misapplied composite widget role is worse than none — it promises interaction semantics the code doesn't honor.
- **Fix:** Simplest correct path — **drop the tablist/tab roles**, keep it a `<nav aria-label="Marketplace sections">` of links, and add `aria-current="page"` to the active `NavLink` (NavLink supplies `isActive`). If you truly want a tablist, implement the full APG pattern (aria-selected, tabpanel, roving tabindex, arrows).

### P1 — NFT cards: JS hover with no touch/keyboard parity + hardcoded, light-theme-hostile colors
`NftLane.tsx:107-127`. Card lift/shadow/border-glow is driven by `onMouseEnter`/`onMouseLeave` inline handlers, so **touch and keyboard users get no affordance** (and the effect never fires on tap). Worse, the resting border is `border: "1px solid rgba(255,255,255,0.05)"` and the hover shadow `rgba(0,0,0,0.4)` are **hardcoded**, violating the tokenized-color rule and rendering a near-invisible white border on the light theme. Same inline-color pattern repeats on the Activity rows (`NftLane.tsx:181-182`).
- **Why it matters:** WCAG 2.1.1 (Keyboard) / 1.4.11 non-text contrast; and the CSS-var design system exists precisely to make light theme + AA work. OpenSea/Blur cards do all state in CSS (`:hover`, `:focus-visible`) so keyboard focus and touch behave.
- **Fix:** Move the lift/shadow into a `.mkt-card` CSS class with `:hover` and `:focus-visible` (the card is a `<Link>`, already focusable), delete the JS handlers, and replace the raw rgba with `--color-border` / token shadows. Wrap the transition in `@media (prefers-reduced-motion)`.

### P1 — Unlabeled controls: sort `<select>` and marketplace search
`NftLane.tsx:73-84` — the sort `<select>` has **no accessible name** (no `<label>`, no `aria-label`); a screen reader announces only "Volume, combobox." `UnifiedMarketplace.tsx:157-168` — the search `<input type="search">` relies on placeholder only (placeholders are not labels, WCAG 3.3.2) and fires `setSearchParams` on **every keystroke** (no debounce → history/URL churn, and only the NFT lane actually reads `?q`, so "Search marketplace" silently searches one lane).
- **Fix:** Add `aria-label="Sort collections"` to the select and `aria-label="Search marketplace"` (or a visually-hidden `<label>`) to the input. Debounce the query (~250ms). Decide the search scope contract (cross-lane vs current-lane) and label it honestly.

### P1 — Loading states are bare text, not skeletons
`NftLane.tsx:64` returns a centered "Loading collections…" string; `UnifiedMarketplace.tsx:174` uses a `ConnectingLoader`. No skeleton grid, so first paint is an empty jump then a full reflow (CLS).
- **Why it matters:** OpenSea/Blur/Magic Eden render skeleton cards in the final grid geometry — perceived performance + layout stability (Core Web Vitals CLS). A blockchain read is slow; skeletons are mandatory at this tier.
- **Fix:** Skeleton card grid matching `.um-grid` shape while loading.

### P2 — Emoji tab icons are announced and render inconsistently
`UnifiedMarketplace.tsx:36-41` uses `🖼️💼🪙🤖🏷️` as tab glyphs, not `aria-hidden`, so SR reads "framed picture, NFTs." The rest of the app uses Phosphor icons (navManifest). Inconsistent + noisy.
- **Fix:** Swap to Phosphor icons (ImageSquare/Handshake/Coins/Robot already imported in navManifest) or at minimum wrap the emoji in `aria-hidden="true"`.

### P2 — Hardcoded success color in TradeModal + contrast risk on micro-labels
`TradeModal.tsx:362` inline `background: 'rgba(0,168,138,0.1)', color: '#00a88a'` — hardcoded, unverified against AA, and off-token. Across NftLane, 11px uppercase `--color-text-muted` stat labels on `--color-bg-secondary` are a real ≥4.5:1 risk at that size/weight.
- **Fix:** Tokenize the success banner (`--color-success` / `--color-success-bg`); run a contrast pass on all `--color-text-muted` at ≤12px and bump to `--color-text-secondary` where it fails.

### P2 — BottomSheet handle is a keyboard-dead `role="button"`
`BottomSheet.tsx:100-110` — the drag handle is `role="button"` `aria-label="Drag to dismiss"` but only has pointer handlers; keyboard users can't activate it. Escape + overlay click cover dismissal, so the role is a false promise.
- **Fix:** Make it `aria-hidden="true"` (decorative grabber) since real dismissal is Escape/overlay, or add an accessible close control.

### P2 — Overlay-click closes TradeModal mid-transaction
`TradeModal.tsx:340` — overlay `onClick={onClose}` closes unconditionally, while the Escape handler (line 112) is correctly guarded against closing during `confirming`/submitting. Inconsistent: a user can dismiss the modal (and lose UI state/feedback) while a broadcast is in flight.
- **Fix:** Gate overlay-close with the same in-flight guard as Escape.

---

## Tier-1 bar & the gap

| Dimension | Tier-1 (Fiverr / OpenSea / Shopify / Stripe) | Memba today | Gap |
|---|---|---|---|
| Mobile discoverability | Store is a primary bottom tab | Not in any mobile nav | **Critical** |
| Mobile checkout | Full-height sheet, sticky thumb CTA | Centered desktop dialog, CTA can be off-screen | **Critical** |
| Dialog a11y | Focus trap + return + aria-modal (APG) | role only; no trap/return | **High** |
| Tab semantics | Correct APG or `aria-current` | Broken tablist, no aria-selected | High |
| Hover/touch parity | State in CSS `:hover`+`:focus-visible` | JS mouse handlers only | High |
| Control labelling | Every control named | Select + search unlabeled | Medium |
| Loading | Skeletons in final geometry | Bare text | Medium |
| Contrast/tokens | AA-verified tokens, no hardcodes | Inline rgba hardcodes, unverified micro-labels | Medium |
| Trust at point of sale | Ratings/reviews on card + checkout | Reviews realm exists, not surfaced | Medium (cross-lens) |

Foundation is decent: global `:focus-visible` (index.css:209), `--mb-touch-min: 44px` token, 44px min-height on buttons in the mobile band (index.css:1810-1816), 16px inputs to kill iOS zoom (1924-1930), `dvh` + safe-area insets, reduced-motion on the hero pulse. The failures are concentrated in **the two surfaces that convert**: mobile navigation and the trade modal.

---

## Quick wins (hours)
1. Add `marketplace` (+`appstore`) to `MORE_NAV_IDS` in navManifest.ts — restores mobile reachability. **Do first.**
2. `aria-label` on the sort select and the search input; debounce search.
3. Drop tablist/tab roles → `aria-current="page"` on active NavLink.
4. `aria-hidden` the emoji tab icons (or swap to Phosphor).
5. Tokenize the TradeModal success banner; gate overlay-close during submit.
6. `aria-hidden` the BottomSheet grabber.

## Deeper rework (days)
1. **Mobile TradeModal → bottom sheet** with sticky, safe-area-anchored CTA and scroll. Highest conversion ROI.
2. **Shared focus-trap primitive** for TradeModal + BottomSheet (focus in / trap / return / aria-modal / aria-labelledby).
3. Move NFT-card interaction state from JS to CSS `:hover`/`:focus-visible`; kill hardcoded rgba; reduced-motion gate.
4. Skeleton loading grid for lanes.
5. Full-page AA contrast pass on ≤12px muted labels.
6. Surface reviews/ratings on cards and in the trade sheet (trust at point of sale).

## CTO must-fix before shipping the new version
1. **Marketplace must have a mobile nav entry** (tab or More sheet) — non-negotiable; it currently has none.
2. **Trade/checkout modal must have a mobile bottom-sheet layout with an always-reachable, thumb-anchored CTA** — today the primary CTA can be off-screen with no scroll.
3. **Every transaction dialog must trap focus, set `aria-modal`, and return focus on close** — legal/a11y baseline and a real keyboard trap-behind risk.
4. Kill all hardcoded colors on the money-path components (NftLane cards, TradeModal success) so light theme + AA hold.
